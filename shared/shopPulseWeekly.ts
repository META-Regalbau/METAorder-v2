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
import type { ShopPulseAiRejection, ShopPulseCode, ShopPulseLossBasis, ShopPulseSeverity } from "./shopPulse";

// ---------------------------------------------------------------------------------------------
// Maßnahmen-Protokoll

/**
 * Art eines Eintrags: Shop-Inhalt live veröffentlicht bzw. zurückgenommen, Shop-Puls-Meldung von Hand
 * erledigt, vom Shop-Wächter erkannter Deploy, Preisänderungen eines Tages, Live-Schreiblauf aus den
 * importierten Protokollen, von Hand eingetragen
 */
export const SHOP_PULSE_ACTION_KINDS = ["contentPublish", "contentRevert", "signalResolved", "deploy", "priceChanges", "liveRun", "manual"] as const;
export type ShopPulseActionKind = (typeof SHOP_PULSE_ACTION_KINDS)[number];

/** Woher der Eintrag kommt */
export const SHOP_PULSE_ACTION_SOURCES = ["shopContent", "shopPulse", "shopWatch", "priceHistory", "import", "manual"] as const;
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
export const SHOP_PULSE_NEXT_STEPS = ["mirror", "orderGap", "storefront", "payment", "product", "delivery", "price", "demand", "traffic", "search", "notFound"] as const;
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

export type ShopPulseWeeklyReportData = {
  numbers: ShopPulseWeeklyNumbers | null;
  levers: ShopPulseLever[];
  /** Summe der geschätzten Beträge der Top 5 je Woche */
  leversPerWeek: number;
  openCount: number;
  done: ShopPulseWeeklyDone[];
  openByOwner: ShopPulseOwnerList[];
};

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
