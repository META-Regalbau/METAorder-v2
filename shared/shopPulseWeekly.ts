/**
 * Shop-Puls Stufe 2, Baustein S2-1 (Konzept 18.10.2026, Abschnitt 2): Maßnahmen-Protokoll und Wochenbericht.
 * Typen für Server (server/shopPulse/actionLog*.ts, weeklyReport*.ts) und Oberfläche (/admin/shop-puls).
 *
 * Maßnahmen-Protokoll (Tabelle shop_pulse_actions): jede Änderung am Shop mit Zeitpunkt, Art, Titel,
 * Beschreibung, betroffenem Bereich, Quelle und wer. Automatische Einträge haben einen festen Schlüssel je
 * Quelle (source_key), damit nichts doppelt kommt; von Hand eingetragene keinen. Der Bereich ist die Grundlage
 * der Wirkungsmessung (S2-6): genau eine Art je Eintrag (ganzer Shop, Artikel, Seiten oder Kanal).
 *
 * Wochenbericht (Tabelle shop_pulse_weekly_reports): montags statt des Tagesberichts, je Woche einer.
 */
import { z } from "zod";
import type { AdsSetupProblem, GscSetupProblem, ShopPulseAiRejection, ShopPulseCode, ShopPulseLossBasis, ShopPulseSeverity } from "./shopPulse";
import type { ShopPulseWeeklyEffect } from "./shopPulseEffects";

// ---------------------------------------------------------------------------------------------
// Maßnahmen-Protokoll

/**
 * Art eines Eintrags: Shop-Inhalt live veröffentlicht bzw. zurückgenommen, Shop-Puls-Meldung von Hand
 * erledigt, vom Shop-Wächter erkannter Deploy, Preisänderungen eines Tages, Live-Schreiblauf aus den
 * importierten Protokollen, Bestellung nach einem Warenkorb-Alarm (S2-3), von Hand eingetragen
 */
export const SHOP_PULSE_ACTION_KINDS = [
  "contentPublish",
  "contentRevert",
  "signalResolved",
  "deploy",
  "priceChanges",
  "liveRun",
  "cartAlarmWon",
  "manual",
  // Stufe 3 (S3-1): Weitergabe an Oliver (für Agentur/Smarketer), Ticket, Jana-Liste, Suchwort eingetragen/zurückgenommen
  "handoff",
  "ticket",
  "janaList",
  "searchKeyword",
  "searchKeywordRevert",
  // Stufe 3 (S3-2): Reparatur des Shop-Wächters per Knopf und ihre Rücknahme
  "watchRepair",
  "watchRepairRevert",
] as const;
export type ShopPulseActionKind = (typeof SHOP_PULSE_ACTION_KINDS)[number];

/** Woher der Eintrag kommt */
export const SHOP_PULSE_ACTION_SOURCES = ["shopContent", "shopPulse", "shopWatch", "priceHistory", "import", "cartAlarm", "manual"] as const;
export type ShopPulseActionSource = (typeof SHOP_PULSE_ACTION_SOURCES)[number];

/** Betroffener Bereich: ganzer Shop, Artikelnummern, Seiten (Pfade/URLs) oder Verkaufskanal */
export const SHOP_PULSE_ACTION_SCOPES = ["shop", "products", "pages", "channel"] as const;
export type ShopPulseActionScopeType = (typeof SHOP_PULSE_ACTION_SCOPES)[number];

export type ShopPulseActionScope = { type: ShopPulseActionScopeType; values: string[] };

export type ShopPulseAction = {
  id: string;
  occurredAt: string;
  kind: ShopPulseActionKind;
  title: string;
  description: string;
  scope: ShopPulseActionScope;
  source: ShopPulseActionSource;
  /** fester Schlüssel automatischer Einträge; null = von Hand */
  sourceKey: string | null;
  /** wer die Änderung gemacht hat, soweit bekannt */
  actor: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** So viele Werte (Artikelnummern, Seiten) hält ein Bereich höchstens */
export const SHOP_PULSE_SCOPE_MAX_VALUES = 20_000;

/** Bereich bereinigen: Werte getrimmt, ohne leere und doppelte; „ganzer Shop“ ohne Werte */
export function normalizeActionScope(scope: { type: ShopPulseActionScopeType; values?: string[] }): ShopPulseActionScope {
  if (scope.type === "shop") return { type: "shop", values: [] };
  const values = Array.from(new Set((scope.values ?? []).map((v) => v.trim()).filter(Boolean))).slice(0, SHOP_PULSE_SCOPE_MAX_VALUES);
  return values.length ? { type: scope.type, values } : { type: "shop", values: [] };
}

/** Eingabe beim Eintragen bzw. Bearbeiten von Hand */
export const shopPulseActionInputSchema = z
  .object({
    occurredAt: z.string().datetime({ offset: true }),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).default(""),
    scope: z
      .object({
        type: z.enum(SHOP_PULSE_ACTION_SCOPES),
        values: z.array(z.string().trim().min(1).max(500)).max(2000).default([]),
      })
      .strict(),
    actor: z.string().trim().max(120).nullable().default(null),
  })
  .strict();
export type ShopPulseActionInput = z.infer<typeof shopPulseActionInputSchema>;

/** Upload der Live-Protokolle: Dateiname und Inhalt (Text) je Datei */
export const shopPulseActionImportSchema = z
  .object({
    files: z
      .array(z.object({ name: z.string().trim().min(1).max(200), content: z.string().max(2_000_000) }).strict())
      .min(1)
      .max(100),
  })
  .strict();

/** Warum eine Protokoll-Datei nicht übernommen wurde */
export const SHOP_PULSE_IMPORT_SKIPS = ["notLive", "invalidJson", "noTime", "otherTenant", "duplicate"] as const;
export type ShopPulseImportSkip = (typeof SHOP_PULSE_IMPORT_SKIPS)[number];

export type ShopPulseImportResult = {
  imported: number;
  skipped: Array<{ name: string; reason: ShopPulseImportSkip }>;
};

// ---------------------------------------------------------------------------------------------
// Zuständige

/** Wer handeln muss (Reihenfolge der Listen „offen je Zuständigem“) */
export const SHOP_PULSE_OWNER_IDS = ["agency", "marketing", "pim", "sales", "oliver"] as const;
export type ShopPulseOwnerId = (typeof SHOP_PULSE_OWNER_IDS)[number];

/** Namen wie in Teams und den KI-Texten (Stufe 1) */
export const SHOP_PULSE_OWNER_NAMES: Record<ShopPulseOwnerId, string> = {
  agency: "Agentur wirduzen",
  marketing: "Marketing/Smarketer",
  pim: "Jana (PIM)",
  sales: "Vertrieb",
  oliver: "Oliver",
};

/** Nächster Schritt je Art von Meldung (Texte shopPulse.weekly.nextSteps.<step>) */
export const SHOP_PULSE_NEXT_STEPS = ["mirror", "orderGap", "storefront", "payment", "product", "delivery", "price", "demand", "traffic", "search", "notFound", "offer", "offerEmpty", "offerBacklog", "ads", "adsShopping", "adsMeasurement", "gscDrop", "gscMeta", "gscContent", "gscIndex", "gscSitemap", "gscCanonical", "paymentPending"] as const;
export type ShopPulseNextStep = (typeof SHOP_PULSE_NEXT_STEPS)[number];

/** Zuständiger und nächster Schritt je Fund-Art (fest, damit Seite, Teams und KI dasselbe sagen) */
export const SHOP_PULSE_RESPONSIBILITY: Record<ShopPulseCode, { owner: ShopPulseOwnerId; step: ShopPulseNextStep }> = {
  mirrorStale: { owner: "oliver", step: "mirror" },
  mirrorError: { owner: "oliver", step: "mirror" },
  orderGap: { owner: "oliver", step: "orderGap" },
  paymentGone: { owner: "agency", step: "payment" },
  weekOrdersDown: { owner: "sales", step: "demand" },
  weekRevenueDown: { owner: "sales", step: "demand" },
  weekAovDown: { owner: "sales", step: "demand" },
  topsellerInactive: { owner: "pim", step: "product" },
  topsellerHidden: { owner: "pim", step: "product" },
  topsellerMissing: { owner: "pim", step: "product" },
  productsUnavailable: { owner: "pim", step: "product" },
  topsellerPriceZero: { owner: "pim", step: "product" },
  productsPriceZero: { owner: "pim", step: "product" },
  priceJump: { owner: "pim", step: "price" },
  topsellerSoldOut: { owner: "pim", step: "product" },
  productsSoldOut: { owner: "pim", step: "product" },
  topsellersNoDeliveryTime: { owner: "pim", step: "delivery" },
  topsellersLongRestock: { owner: "pim", step: "delivery" },
  paymentMethodGone: { owner: "agency", step: "payment" },
  shippingMethodGone: { owner: "agency", step: "payment" },
  productPageStatus: { owner: "agency", step: "storefront" },
  productPageNoBuyButton: { owner: "agency", step: "storefront" },
  productPageUnavailable: { owner: "agency", step: "storefront" },
  productPagePrice: { owner: "agency", step: "storefront" },
  cartProbeHome: { owner: "agency", step: "storefront" },
  cartProbeSearch: { owner: "agency", step: "storefront" },
  cartProbeAdd: { owner: "agency", step: "storefront" },
  cartProbeCart: { owner: "agency", step: "storefront" },
  cartProbeCheckout: { owner: "agency", step: "storefront" },
  orderGapConfirmed: { owner: "agency", step: "storefront" },
  orderGapCheckout: { owner: "agency", step: "storefront" },
  orderGapVisitors: { owner: "marketing", step: "traffic" },
  ga4LiveNoAddToCart: { owner: "agency", step: "storefront" },
  ga4LiveNoCheckout: { owner: "agency", step: "storefront" },
  ga4FunnelCart: { owner: "agency", step: "storefront" },
  ga4FunnelCheckout: { owner: "agency", step: "storefront" },
  ga4FunnelPurchase: { owner: "agency", step: "storefront" },
  ga4ChannelDrop: { owner: "marketing", step: "traffic" },
  ga4LandingDrop: { owner: "marketing", step: "traffic" },
  ga4NotFoundUp: { owner: "agency", step: "notFound" },
  ga4SearchNoHits: { owner: "marketing", step: "search" },
  ga4MeasurementDrop: { owner: "marketing", step: "traffic" },
  offerUnanswered: { owner: "sales", step: "offer" },
  offerEmpty: { owner: "sales", step: "offerEmpty" },
  offerBacklog: { owner: "sales", step: "offerBacklog" },
  // Google Ads (S2-4): Vorschläge gehen zuerst an Oliver, er entscheidet, was an Smarketer weitergeht
  adsCostNoResult: { owner: "oliver", step: "ads" },
  adsCostAboveMargin: { owner: "oliver", step: "ads" },
  adsShoppingUnbuyable: { owner: "oliver", step: "adsShopping" },
  adsSearchTermsWaste: { owner: "oliver", step: "ads" },
  adsMeasurementDrop: { owner: "oliver", step: "adsMeasurement" },
  adsBudgetLimited: { owner: "oliver", step: "ads" },
  // Search Console (S2-5)
  gscClickDrop: { owner: "oliver", step: "gscDrop" },
  gscLowCtr: { owner: "oliver", step: "gscMeta" },
  gscNearPageOne: { owner: "oliver", step: "gscContent" },
  gscNotIndexed: { owner: "agency", step: "gscIndex" },
  gscSitemapIssues: { owner: "agency", step: "gscSitemap" },
  gscCannibalization: { owner: "oliver", step: "gscCanonical" },
  // Zahlungsanbieter-Wache (S3-3): Ausfall einer Zahlart klärt die Agentur mit dem Anbieter; hängende Zahlungen der Innendienst
  paymentFailStreak: { owner: "agency", step: "payment" },
  paymentFailRate: { owner: "agency", step: "payment" },
  paymentsPending: { owner: "sales", step: "paymentPending" },
};

// ---------------------------------------------------------------------------------------------
// Wochenbericht

/** Zahlen einer Woche (MO-Bestellungen, ohne stornierte) */
export type ShopPulseWeekFigures = {
  /** Montag der Woche (Berlin), YYYY-MM-DD */
  from: string;
  /** Sonntag der Woche */
  to: string;
  orders: number;
  /** Umsatz brutto */
  revenue: number;
  /** Ø Bestellwert brutto; 0 ohne Bestellungen */
  aov: number;
  /**
   * Deckungsbeitrag (DB1 netto: Netto-Umsatz der Positionen mit Herstellpreis − Herstellkosten), gleiche
   * Rechnung wie Bestellliste und CRM; null = keine Position mit Herstellpreis
   */
  db1: number | null;
  /** Anteil des Netto-Artikelumsatzes mit Herstellpreis (0–100); der DB gilt nur für diesen Teil */
  db1CoveragePercent: number | null;
};

export type ShopPulseWeekGa4 = { sessions: number; users: number; purchases: number; conversionPercent: number | null };

export type ShopPulseWeeklyNumbers = {
  current: ShopPulseWeekFigures;
  previous: ShopPulseWeekFigures;
  /** gleiche Wochentage 52 Wochen davor; null = Spiegel reicht nicht so weit zurück */
  yearAgo: ShopPulseWeekFigures | null;
  /** null = GA4 nicht eingerichtet oder nicht gelesen */
  ga4: { current: ShopPulseWeekGa4; previous: ShopPulseWeekGa4 } | null;
};

/** Ein Hebel: offene Meldung mit Beleg, geschätztem Betrag, Zuständigem und nächstem Schritt */
export type ShopPulseLever = {
  signalId: string;
  code: ShopPulseCode;
  severity: ShopPulseSeverity;
  params: Record<string, string | number>;
  firstSeenAt: string;
  /** geschätzter Verlust pro Stunde und je Woche (84 Geschäftsstunden), brutto; null = nicht abschätzbar */
  perHour: number | null;
  perWeek: number | null;
  basis: ShopPulseLossBasis | null;
  owner: ShopPulseOwnerId;
  step: ShopPulseNextStep;
};

export type ShopPulseOwnerList = {
  owner: ShopPulseOwnerId;
  items: Array<Pick<ShopPulseLever, "signalId" | "code" | "severity" | "params" | "firstSeenAt" | "perWeek" | "step">>;
  /** deutscher Text zum Weiterleiten (Teams, E-Mail) */
  text: string;
};

export type ShopPulseWeeklyDone = Pick<ShopPulseAction, "id" | "occurredAt" | "kind" | "title" | "scope" | "actor" | "source">;

// ---------------------------------------------------------------------------------------------
// Angebotsanfragen und B2B-Anteil (Stufe 2, S2-2)

/** Wer eine Angebotsanfrage bearbeiten soll: Außendienst laut Zuordnung, sonst Standard-Bearbeiter, sonst niemand */
export const SHOP_PULSE_ASSIGNEE_SOURCES = ["rep", "default", "none"] as const;
export type ShopPulseAssigneeSource = (typeof SHOP_PULSE_ASSIGNEE_SOURCES)[number];

/** Eine offene Angebotsanfrage im Bericht (aus der Meldung) */
export type ShopPulseOfferItem = {
  signalId: string;
  offerNumber: string;
  customer: string;
  customerNumber: string;
  /** Wert netto */
  net: number;
  businessDays: number;
  /** Kalendertag (Berlin) des Eingangs */
  since: string;
  assignee: string;
  assigneeSource: ShopPulseAssigneeSource;
  channel: string;
  severity: ShopPulseSeverity;
  /** 0 Positionen (Datenfehler) */
  empty: boolean;
};

/** Angebotsanfragen-Wache im Tages- und Wochenbericht: Stand der offenen Meldungen */
export type ShopPulseOfferSummary = {
  /** seit mindestens einem Werktag unbeantwortet (mit Positionen) */
  unanswered: number;
  critical: number;
  /** Wert der unbeantworteten netto */
  net: number;
  /** leere Anfragen (0 Positionen, Datenfehler) */
  empty: number;
  /** älter als 4 Wochen, noch „Angefragt von Kunde“ (Sammelmeldung) */
  backlog: number;
  backlogNet: number;
  /** größter Wert zuerst, höchstens 10 */
  items: ShopPulseOfferItem[];
};

/** Anteil der Geschäftskunden in einem Zeitraum (MO-Bestellungen ohne stornierte, netto) */
export type ShopPulseB2bPeriod = {
  from: string;
  to: string;
  orders: number;
  b2bOrders: number;
  net: number;
  b2bNet: number;
  /** 0–100, eine Nachkommastelle; null ohne Bestellungen */
  ordersPercent: number | null;
  netPercent: number | null;
};

/** Bestellwert-Stufe (netto, von einschließlich bis ausschließlich; to null = offen) */
export type ShopPulseValueBucket = { from: number; to: number | null; b2b: number; private: number };

/** Messung B2B-Anteil im Wochenbericht: Grundlage der Schwelle des Warenkorb-Alarms (S2-3) */
export type ShopPulseB2bShare = {
  week: ShopPulseB2bPeriod;
  /** 13 Wochen bis einschließlich der Berichtswoche (ein Quartal), damit die Verteilung trägt */
  quarter: ShopPulseB2bPeriod;
  /** Woran die Geschäftskunden im Quartal erkannt wurden: Firma in der Rechnungsadresse bzw. nur B2B-Kennzeichen */
  basis: { company: number; flagOnly: number };
  /** Verteilung der Bestellwerte im Quartal */
  buckets: ShopPulseValueBucket[];
  /** Bestellwerte der Geschäftskunden im Quartal (netto): Median, 75 % und 90 %; null ohne Bestellungen */
  b2bQuantiles: { p50: number; p75: number; p90: number } | null;
  /** Geschäftskunden-Bestellungen ab Schwelle im Quartal: Anzahl, Anteil, je Woche */
  atLeast: Array<{ threshold: number; orders: number; percent: number | null; perWeek: number }>;
};

export type ShopPulseWeeklyReportData = {
  numbers: ShopPulseWeeklyNumbers | null;
  levers: ShopPulseLever[];
  /** Summe der geschätzten Beträge der Top 5 je Woche */
  leversPerWeek: number;
  openCount: number;
  done: ShopPulseWeeklyDone[];
  openByOwner: ShopPulseOwnerList[];
  /** Angebotsanfragen (S2-2); fehlt in älteren Berichten */
  offers?: ShopPulseOfferSummary;
  /** B2B-Anteil (S2-2); null = Bestellabgleich hängt bzw. nicht gelesen; fehlt in älteren Berichten */
  b2b?: ShopPulseB2bShare | null;
  /**
   * Gesicherte Wirkungen (S2-6): Maßnahmen, deren 28 Tage danach in der Berichtswoche zu Ende gingen und deren
   * Wirkung „sicher“ ist; null = nicht berechnet; fehlt in älteren Berichten
   */
  effects?: ShopPulseWeeklyEffect[] | null;
  /** Google Ads der Woche (S2-4); fehlt in älteren Berichten */
  ads?: ShopPulseWeeklyAds;
  /** Search Console (S2-5); fehlt in älteren Berichten */
  gsc?: ShopPulseWeeklyGsc;
};

/** Search Console im Wochenbericht: Google-Klicks der letzten 7 Tage mit Daten (Verzögerung 3 Tage) und Listen */
export type ShopPulseWeeklyGsc =
  | {
      configured: true;
      /** Zeitraum der Zahlen (endet 3 Tage vor dem Bericht) */
      from: string;
      to: string;
      /** null = nicht gelesen */
      clicks: number | null;
      impressions: number | null;
      previousClicks: number | null;
      /** Suchanfragen auf Position 5–15 mit viel Volumen (aus der offenen Meldung) */
      nearPageOne: Array<{ query: string; impressions: number; clicks: number; position: number }>;
      /** Suchanfragen, für die sich zwei eigene Seiten abwechseln */
      cannibalization: Array<{ query: string; impressions: number; pages: string[] }>;
      notIndexed: number;
      openCount: number;
    }
  | { configured: false; problem: GscSetupProblem };

/** Vorschlag zum Ausschließen eines Suchbegriffs (aus der Meldung „teure Suchbegriffe“, 28 Tage) */
export type ShopPulseAdsSuggestion = { term: string; cost: number; clicks: number; negative: string };

/** Google Ads im Wochenbericht: Kosten der Woche, Kosten je Conversion gegen Ø Deckungsbeitrag, Vorschläge */
export type ShopPulseWeeklyAds =
  | {
      configured: true;
      /** null = Woche nicht gelesen (Fehler) */
      cost: number | null;
      clicks: number | null;
      conversions: number | null;
      costPerConversion: number | null;
      /** Ø Deckungsbeitrag je MO-Bestellung der Woche; null = keiner */
      avgDb1PerOrder: number | null;
      /** offene Ads-Meldungen */
      openCount: number;
      suggestions: ShopPulseAdsSuggestion[];
    }
  | { configured: false; problem: AdsSetupProblem };

export type ShopPulseWeeklyReport = {
  id: string;
  /** Montag der berichteten Woche */
  weekStart: string;
  weekEnd: string;
  /** ISO-Kalenderwoche */
  isoWeek: number;
  createdAt: string;
  /** null = noch nicht gesendet (Lernwoche, ausgeschaltet, von Hand erstellt) */
  sentAt: string | null;
  data: ShopPulseWeeklyReportData;
  ai: { at: string; text: string | null; rejected?: ShopPulseAiRejection } | null;
};

/** Veränderung in Prozent (gerundet); null ohne Vergleichswert */
export function changePercent(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** ISO-Kalenderwoche eines Tages (YYYY-MM-DD) */
export function isoWeekOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const jan1 = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - jan1) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

/** Antwort von GET /api/shop-pulse/weekly-reports */
export type ShopPulseWeeklyOverview = { reports: ShopPulseWeeklyReport[] };

/** Antwort von GET /api/shop-pulse/actions */
export type ShopPulseActionsOverview = { actions: ShopPulseAction[] };
