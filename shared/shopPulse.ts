/**
 * Shop-Puls: meldet, was im Onlineshop nicht gut läuft (Konzept Stufe 1, 17.10.2026). Typen für Server
 * (server/shopPulse/*) und Oberfläche (/admin/shop-puls).
 *
 * Prüfungen („Detektoren“) liefern Funde mit festem Schlüssel; daraus werden Meldungen (Tabelle
 * shop_pulse_signals). Je Schlüssel gibt es eine Meldung, die offen bleibt, solange der Fund besteht.
 * Texte übersetzt der Client: shopPulse.codes.<code>.title / .message mit den params des Funds.
 */
import { isAllowedTeamsWebhookUrl } from "./emailIntake";
import type { ShopPulseHandoff, ShopPulseJanaState } from "./shopPulseHandoff";

/** Woher ein Fund kommt */
export const SHOP_PULSE_SOURCES = ["system", "revenue", "buyability", "ga4", "b2b", "ads", "gsc"] as const;
export type ShopPulseSource = (typeof SHOP_PULSE_SOURCES)[number];

/** critical = sofort melden, warning = Tagesbericht */
export const SHOP_PULSE_SEVERITIES = ["warning", "critical"] as const;
export type ShopPulseSeverity = (typeof SHOP_PULSE_SEVERITIES)[number];

export const SHOP_PULSE_STATUSES = ["open", "resolved"] as const;
export type ShopPulseStatus = (typeof SHOP_PULSE_STATUSES)[number];

/** Fund-Arten (je eine Übersetzung shopPulse.codes.<code>) */
export const SHOP_PULSE_CODES = [
  "mirrorStale",
  "mirrorError",
  "orderGap",
  "paymentGone",
  "weekOrdersDown",
  "weekRevenueDown",
  "weekAovDown",
  "topsellerInactive",
  "topsellerHidden",
  "topsellerMissing",
  "productsUnavailable",
  "topsellerPriceZero",
  "productsPriceZero",
  "priceJump",
  "topsellerSoldOut",
  "productsSoldOut",
  "topsellersNoDeliveryTime",
  "topsellersLongRestock",
  "paymentMethodGone",
  "shippingMethodGone",
  "productPageStatus",
  "productPageNoBuyButton",
  "productPageUnavailable",
  "productPagePrice",
  "cartProbeHome",
  "cartProbeSearch",
  "cartProbeAdd",
  "cartProbeCart",
  "cartProbeCheckout",
  "orderGapConfirmed",
  "orderGapCheckout",
  "orderGapVisitors",
  "ga4LiveNoAddToCart",
  "ga4LiveNoCheckout",
  "ga4FunnelCart",
  "ga4FunnelCheckout",
  "ga4FunnelPurchase",
  "ga4ChannelDrop",
  "ga4LandingDrop",
  "ga4NotFoundUp",
  "ga4SearchNoHits",
  "ga4MeasurementDrop",
  "offerUnanswered",
  "offerEmpty",
  "offerBacklog",
  "adsCostNoResult",
  "adsCostAboveMargin",
  "adsShoppingUnbuyable",
  "adsSearchTermsWaste",
  "adsMeasurementDrop",
  "adsBudgetLimited",
  "gscClickDrop",
  "gscLowCtr",
  "gscNearPageOne",
  "gscNotIndexed",
  "gscSitemapIssues",
  "gscCannibalization",
  // Stufe 3 (S3-3): Zahlungsanbieter-Wache
  "paymentFailStreak",
  "paymentFailRate",
  "paymentsPending",
  // Stufe 3 (S3-5): Ladezeit
  "speedAfterDeploy",
  "speedHtmlComments",
] as const;
export type ShopPulseCode = (typeof SHOP_PULSE_CODES)[number];

/**
 * Ereignisse statt Zustände: der Fund gilt nur für den Lauf nach der Änderung (Preissprung). Verschwindet
 * er danach, ist nichts „behoben“ – es gibt deshalb keine Entwarnung.
 */
export const SHOP_PULSE_EVENT_CODES: readonly ShopPulseCode[] = ["priceJump"];

/**
 * Ohne Entwarnung, auch wenn die Meldung per Nachricht rausging: Angebotsanfragen verschwinden, wenn sie
 * beantwortet sind oder älter als 4 Wochen werden (dann zählt sie die Sammelmeldung). Ein „Behoben“ wäre im
 * zweiten Fall falsch; offene Anfragen stehen ohnehin im Tagesbericht.
 */
export const SHOP_PULSE_NO_RESOLVE_NOTICE_CODES: readonly ShopPulseCode[] = [...SHOP_PULSE_EVENT_CODES, "offerUnanswered", "offerEmpty", "offerBacklog"];

/** Prüfungen in Lauf-Reihenfolge (server/shopPulse/detectors); die Seite zeigt sie so an */
export const SHOP_PULSE_DETECTOR_IDS = [
  "mirrorFreshness",
  "orderGap",
  "paymentGone",
  "paymentWatch",
  "weekComparison",
  "channelMethods",
  "buyability",
  "productPages",
  "cartProbe",
  "ga4Live",
  "ga4Funnel",
  "ga4Channels",
  "ga4LandingPages",
  "ga4SearchTerms",
  "ga4Measurement",
  "offerWatch",
  "googleAds",
  "gscSearch",
  "gscIndex",
  "pageWeight",
  "pageSpeed",
] as const;

/**
 * Warum GA4 nicht eingerichtet ist (Einstellungen → Google Analytics): ausgeschaltet, keine Property-ID,
 * Mess-ID „G-…“ statt numerischer Property-ID, Property-ID keine Zahl, kein bzw. ungültiges Dienstkonto-JSON
 */
export const GA4_SETUP_PROBLEMS = ["disabled", "noProperty", "measurementId", "invalidProperty", "noServiceAccount", "invalidServiceAccount"] as const;
export type Ga4SetupProblem = (typeof GA4_SETUP_PROBLEMS)[number];

/**
 * Warum Google Ads nicht eingerichtet ist (Einstellungen → Google Ads, Stufe 2 S2-4): ausgeschaltet, keine
 * Kunden-ID, Zugangsdaten (Developer-Token, OAuth-Client, Refresh-Token) unvollständig
 */
export const ADS_SETUP_PROBLEMS = ["disabled", "noCustomer", "noCredentials"] as const;
export type AdsSetupProblem = (typeof ADS_SETUP_PROBLEMS)[number];

/**
 * Warum die Search Console nicht eingerichtet ist (Shop-Puls → Search Console, Stufe 2 S2-5): ausgeschaltet,
 * keine Property, Property weder „sc-domain:…“ noch URL-Präfix, kein bzw. ungültiges Dienstkonto-JSON
 */
export const GSC_SETUP_PROBLEMS = ["disabled", "noProperty", "invalidProperty", "noServiceAccount", "invalidServiceAccount"] as const;
export type GscSetupProblem = (typeof GSC_SETUP_PROBLEMS)[number];

/** Warum PageSpeed nicht eingerichtet ist (Shop-Puls → Ladezeit, Stufe 3 S3-5): ausgeschaltet, kein API-Schlüssel */
export const SPEED_SETUP_PROBLEMS = ["disabled", "noKey"] as const;
export type SpeedSetupProblem = (typeof SPEED_SETUP_PROBLEMS)[number];

export const PAGE_SPEED_TYPES = ["home", "landing", "listing", "product", "cart", "search"] as const;
export type PageSpeedType = (typeof PAGE_SPEED_TYPES)[number];

/** Antwort von GET /api/shop-pulse/speed (der Schlüssel wird nie zurückgegeben) */
export type ShopPulseSpeedOverview = {
  enabled: boolean;
  hasKey: boolean;
  problem: SpeedSetupProblem | null;
  paths: Record<PageSpeedType, string>;
  /** Messungen der letzten Tage, neueste zuerst */
  days: Array<{
    day: string;
    at: string;
    results: Array<{ type: PageSpeedType; url: string; score: number | null; lcpMs: number | null; cls: number | null; tbtMs: number | null; field: { source: "url" | "origin"; lcpMs: number | null; inpMs: number | null; cls: number | null } | null; error?: string }>;
  }>;
};

/** Antwort von GET /api/shop-pulse/search-console (das Dienstkonto-JSON wird nie zurückgegeben) */
export type ShopPulseGscOverview = {
  enabled: boolean;
  property: string;
  hasServiceAccount: boolean;
  serviceAccountEmail: string | null;
  /** null = eingerichtet */
  problem: GscSetupProblem | null;
};

/** KI-Vorschlag für Meta-Title/-Description (nur zur Freigabe, nichts wird geschrieben) */
export type ShopPulseMetaSuggestionResult = {
  page: string;
  current: { title: string; description: string };
  queries: string[];
  /** null = beide Versuche durchgefallen (rejected sagt warum) */
  suggestion: { metaTitle: string; metaDescription: string } | null;
  rejected: string | null;
};

export const SEVERITY_RANK: Record<ShopPulseSeverity, number> = { warning: 1, critical: 2 };

/** Ein Fund aus einem Prüflauf */
export type ShopPulseDetection = {
  /** fester Schlüssel, z. B. "system:mirror:orders"; gleicher Schlüssel = dieselbe Meldung */
  key: string;
  source: ShopPulseSource;
  code: ShopPulseCode;
  severity: ShopPulseSeverity;
  params?: Record<string, string | number>;
  /** Belege für die Seite und später für die KI (Zahlen, Zeitpunkte) */
  evidence?: Record<string, unknown>;
  /** geschätzter Umsatzverlust pro Stunde in Euro brutto, falls abschätzbar */
  lossPerHour?: number | null;
  /**
   * Schwere still berücksichtigen (keine Sofort-Meldung, steht im Tagesbericht), z. B. der Altbestand beim
   * ersten Lauf einer neuen Prüfung, damit nach dem Deploy nicht Dutzende Nachrichten auf einmal kommen
   */
  quiet?: boolean;
};

/**
 * Geschätzter Verlust pro Stunde (Euro brutto) und woher die Schätzung kommt: detector = vom Fund selbst,
 * products = Shop-Umsatz der betroffenen Artikel (365 Tage, je Geschäftsstunde), paymentShare = Anteil
 * der Zahlart an den Bestellungen × üblicher Umsatz dieser Tageszeit, hourOfDay = üblicher Umsatz dieser
 * Tageszeit (server/shopPulse/lossEstimate.ts)
 */
export const SHOP_PULSE_LOSS_BASES = ["detector", "products", "paymentShare", "hourOfDay"] as const;
export type ShopPulseLossBasis = (typeof SHOP_PULSE_LOSS_BASES)[number];
export type ShopPulseLossEstimate = { perHour: number; basis: ShopPulseLossBasis };

/**
 * Warum ein KI-Text nicht verwendet wurde (dann ging die feste Vorlage raus): Zahl nicht in den
 * Eingabedaten, leer bzw. unbrauchbar, zu lang, Fehler des Anbieters, Zeitüberschreitung
 */
export const SHOP_PULSE_AI_REJECTIONS = ["number", "empty", "tooLong", "error", "timeout"] as const;
export type ShopPulseAiRejection = (typeof SHOP_PULSE_AI_REJECTIONS)[number];

/**
 * KI-Text an einer Meldung (Spalte ai_note): höchstens ein Aufruf je Schwere und Vorfall. Auch ein
 * verworfener Versuch wird gespeichert, damit der nächste Takt nicht erneut fragt.
 */
export type ShopPulseAiNote = {
  /** Schwere, für die der Text geschrieben wurde */
  severity: ShopPulseSeverity;
  at: string;
  /** deutscher Text; null = verworfen (siehe rejected) */
  text: string | null;
  rejected?: ShopPulseAiRejection;
  /** bei rejected "number": die Zahlen, die nicht in den Eingabedaten standen */
  badNumbers?: string[];
  lossEstimate: ShopPulseLossEstimate | null;
};

/** Meldung, wie sie Seite und Teams sehen */
export type ShopPulseSignal = {
  id: string;
  key: string;
  source: ShopPulseSource;
  code: ShopPulseCode;
  severity: ShopPulseSeverity;
  status: ShopPulseStatus;
  params: Record<string, string | number>;
  evidence: Record<string, unknown>;
  lossPerHour: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  /** von Hand erledigt (statt von selbst verschwunden) */
  resolvedBy: string | null;
  mutedUntil: string | null;
  notifiedAt: string | null;
  notifiedSeverity: ShopPulseSeverity | null;
  /** KI-Text (PR F); fehlt bei Meldungen ohne KI-Versuch */
  aiNote?: ShopPulseAiNote | null;
};

/**
 * Braucht die Meldung (noch) einen KI-Text? Ja, wenn es keinen gibt, er für eine andere Schwere geschrieben
 * wurde oder für einen früheren Vorfall (Meldung inzwischen erledigt und wieder offen).
 */
export function needsAiNote(s: Pick<ShopPulseSignal, "aiNote" | "severity" | "firstSeenAt">): boolean {
  const n = s.aiNote;
  return !n || n.severity !== s.severity || Date.parse(n.at) < Date.parse(s.firstSeenAt);
}

/** KI-Text, der zum jetzigen Stand der Meldung passt; null = keiner (dann gilt die Vorlage) */
export function currentAiText(s: Pick<ShopPulseSignal, "aiNote" | "severity" | "firstSeenAt">): string | null {
  return !needsAiNote(s) ? (s.aiNote?.text ?? null) : null;
}

/** Einstellungen je Mandant (Settings-Key shop_pulse_settings) */
export type ShopPulseSettings = {
  enabled: boolean;
  /** Bis dahin nur sammeln, keine Nachrichten (Lernwoche, Entscheidung 17.10.2026); null = keine */
  learningUntil: string | null;
  /** Teams-Workflow „Bei Empfang einer Webhook-Anforderung in einem Chat posten“ (Direktnachricht); "" = keine */
  teamsWebhookUrl: string;
  /** Meldungen des Shop-Wächters ebenfalls an diese Direktnachricht statt an den Kanal des E-Mail-Eingangs */
  shopWatchDirect: boolean;
  /** Meldungen und Tagesbericht formuliert die KI des Mandanten (nur wenn ein Anbieter eingerichtet ist) */
  aiTexts: boolean;
};

export const DEFAULT_SHOP_PULSE_SETTINGS: ShopPulseSettings = {
  enabled: false,
  learningUntil: null,
  teamsWebhookUrl: "",
  shopWatchDirect: false,
  aiTexts: true,
};

export const SHOP_PULSE_LEARNING_DAYS = 7;

export function normalizeShopPulseSettings(raw: unknown): ShopPulseSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const learning = typeof r.learningUntil === "string" && !Number.isNaN(Date.parse(r.learningUntil)) ? r.learningUntil : null;
  const url = typeof r.teamsWebhookUrl === "string" ? r.teamsWebhookUrl.trim() : "";
  return {
    enabled: r.enabled === true,
    learningUntil: learning,
    teamsWebhookUrl: url && isAllowedTeamsWebhookUrl(url) ? url : "",
    shopWatchDirect: r.shopWatchDirect === true,
    aiTexts: r.aiTexts !== false,
  };
}

export function isLearning(settings: Pick<ShopPulseSettings, "learningUntil">, now: Date): boolean {
  return !!settings.learningUntil && Date.parse(settings.learningUntil) > now.getTime();
}

/** Stand des Zeitplans je Mandant (Settings-Key shop_pulse_state) */
export type ShopPulseState = {
  lastTickAt?: string;
  /** Kalendertag (Berlin) des letzten Tagesberichts */
  lastDailyReportDay?: string;
  /** Montag der zuletzt berichteten Woche (Wochenbericht, Stufe 2 S2-1) */
  lastWeeklyReportWeek?: string;
  /** Kalendertag (Berlin) der letzten Wirkungsmessung (Stufe 2 S2-6, einmal am Tag) */
  lastEffectsDay?: string;
  /** KI-Zusammenfassung des letzten Tagesberichts (null-Text = verworfen, Vorlage ging raus) */
  lastDailyAi?: { at: string; text: string | null; rejected?: ShopPulseAiRejection };
  /**
   * skipped "mirror": ausgesetzt, weil der Bestellabgleich hängt; "busy": der Shop-Wächter fragt den Shop
   * gerade ab; "ga4": GA4 nicht eingerichtet (ga4Problem sagt, was fehlt); "ads": Google Ads nicht
   * eingerichtet (adsProblem); "gsc": Search Console nicht eingerichtet (gscProblem)
   */
  detectors?: Record<
    string,
    {
      at: string;
      ok: boolean;
      error?: string;
      skipped?: "mirror" | "busy" | "ga4" | "ads" | "gsc" | "speed";
      /** PageSpeed nicht eingerichtet (Stufe 3, S3-5) */
      speedProblem?: SpeedSetupProblem;
      ga4Problem?: Ga4SetupProblem;
      adsProblem?: AdsSetupProblem;
      gscProblem?: GscSetupProblem;
      findings: number;
    }
  >;
};

/**
 * Datenlücken der Artikel für die PIM-Sammlung (Jana): werden nicht gemeldet und nicht im Shop
 * korrigiert, sondern als CSV ausgegeben (Format wie Datenfehler-PIM-Artikel.csv).
 */
export const SHOP_PULSE_DATA_GAP_CODES = ["noImage", "noCategory", "salesUnit", "noDeliveryTime"] as const;
export type ShopPulseDataGapCode = (typeof SHOP_PULSE_DATA_GAP_CODES)[number];

export type ShopPulseDataGap = {
  code: ShopPulseDataGapCode;
  productNumber: string;
  name: string;
  active: boolean;
  /** Wert im Shop (z. B. Verkaufseinheit „1“) */
  value: string;
  /** Soll / Hinweis */
  hint: string;
};

/** Settings-Key shop_pulse_data_gaps: Ergebnis des letzten Nachtlaufs */
export type ShopPulseDataGaps = { at: string; items: ShopPulseDataGap[] };

/** Antwort von GET /api/shop-pulse */
export type ShopPulseOverview = {
  settings: Omit<ShopPulseSettings, "teamsWebhookUrl"> & { teamsConfigured: boolean };
  /** KI-Anbieter des Mandanten eingerichtet (Voraussetzung für KI-Texte) */
  aiConfigured: boolean;
  learning: boolean;
  state: ShopPulseState;
  signals: ShopPulseSignal[];
  teamsPending: number;
  running: boolean;
  /** Soll-Stand der Kaufbarkeit (kaufbare Artikel mit Umsatz, Zahl- und Versandarten) */
  buyabilityBaseline: { takenAt: string; products: number; paymentMethods: number; shippingMethods: number } | null;
  /** Datenlücken für die PIM-Sammlung: Anzahl je Art, Stand des letzten Nachtlaufs */
  dataGaps: { at: string; counts: Partial<Record<ShopPulseDataGapCode, number>> } | null;
  /** Stufe 3 (S3-1): Weitergaben (offen und in den letzten 30 Tagen erledigt), neueste zuerst */
  handoffs: ShopPulseHandoff[];
  /** Stufe 3 (S3-1): zuletzt gesendete Jana-Liste (ohne die Schlüssel) */
  janaList: Omit<ShopPulseJanaState, "keys"> | null;
};

/** Parameter, die vor dem Einsetzen formatiert werden (Seite in der Sprache der Oberfläche, Teams deutsch) */
const PARAM_KINDS: Partial<Record<ShopPulseCode, Record<string, "money" | "date" | "number" | "percent">>> = {
  orderGap: { expected: "number" },
  orderGapConfirmed: { expected: "number" },
  paymentGone: { perWeek: "number" },
  weekOrdersDown: { from: "date", to: "date", current: "number", expected: "number", yearOrders: "number" },
  weekRevenueDown: { from: "date", to: "date", current: "money", expected: "money", yearRevenue: "money" },
  weekAovDown: { from: "date", to: "date", current: "money", expected: "money" },
  priceJump: { oldPrice: "money", newPrice: "money" },
  topsellerPriceZero: { revenue: "money" },
  topsellerInactive: { revenue: "money" },
  topsellerHidden: { revenue: "money" },
  topsellerMissing: { revenue: "money" },
  topsellerSoldOut: { revenue: "money" },
  productPageStatus: { revenue: "money" },
  productPageNoBuyButton: { revenue: "money" },
  productPageUnavailable: { revenue: "money" },
  productPagePrice: { revenue: "money", shown: "money", expected: "money" },
  orderGapCheckout: { expected: "number" },
  orderGapVisitors: { expected: "number" },
  ga4LiveNoAddToCart: { pageViews: "number", expected: "number" },
  ga4LiveNoCheckout: { pageViews: "number", expected: "number" },
  ga4FunnelCart: { date: "date", current: "percent", expected: "percent" },
  ga4FunnelCheckout: { date: "date", current: "percent", expected: "percent" },
  ga4FunnelPurchase: { date: "date", current: "percent", expected: "percent" },
  ga4ChannelDrop: { date: "date", share: "percent", expectedShare: "percent" },
  ga4LandingDrop: { date: "date", share: "percent", expectedShare: "percent" },
  ga4NotFoundUp: { date: "date", current: "number", expected: "number", share: "percent", expectedShare: "percent" },
  ga4SearchNoHits: { date: "date", count: "number", searches: "number" },
  ga4MeasurementDrop: { from: "date", to: "date", current: "percent", expected: "percent", orders: "number" },
  offerUnanswered: { net: "money", since: "date", businessDays: "number" },
  offerEmpty: { since: "date", businessDays: "number" },
  offerBacklog: { count: "number", net: "money", oldestSince: "date" },
  adsCostNoResult: { cost: "money", clicks: "number" },
  adsCostAboveMargin: { cost: "money", conversions: "number", costPerConversion: "money", avgDb1: "money" },
  adsShoppingUnbuyable: { count: "number", cost: "money" },
  adsSearchTermsWaste: { count: "number", cost: "money" },
  adsMeasurementDrop: { from: "date", to: "date", current: "percent", expected: "percent", orders: "number" },
  adsBudgetLimited: { lost: "percent", cost: "money", estDb1: "money", conversions: "number" },
  gscClickDrop: { current: "number", expected: "number", from: "date", to: "date" },
  gscLowCtr: { impressions: "number", ctr: "percent", expected: "percent", lostClicks: "number", to: "date" },
  gscNearPageOne: { count: "number", to: "date" },
  gscNotIndexed: { since: "date" },
  gscSitemapIssues: { errors: "number", warnings: "number" },
  gscCannibalization: { count: "number", to: "date" },
  paymentFailStreak: { count: "number", since: "date", lastSuccess: "date" },
  paymentFailRate: { fails: "number", attempts: "number", share: "percent", expected: "percent" },
  paymentsPending: { count: "number", total: "money", mondu: "number" },
  speedAfterDeploy: { deployDay: "date", scoreBefore: "number", scoreAfter: "number" },
  speedHtmlComments: { commentsKb: "number", totalKb: "number", share: "percent" },
};

export type ShopPulseParamFormatters = {
  money: (v: number) => string;
  date: (isoDay: string) => string;
  number: (v: number) => string;
  /** Wert schon in Prozent, eine Nachkommastelle (3.2 → „3,2 %“) */
  percent: (v: number) => string;
};

export function formatShopPulseParams(
  code: ShopPulseCode,
  params: Record<string, string | number>,
  f: ShopPulseParamFormatters,
): Record<string, string | number> {
  const kinds = PARAM_KINDS[code];
  if (!kinds) return params;
  const out: Record<string, string | number> = { ...params };
  for (const [name, kind] of Object.entries(kinds)) {
    const v = params[name];
    if (v === undefined || v === null || v === "") continue;
    if (kind === "date") out[name] = f.date(String(v));
    else if (typeof v === "number") out[name] = kind === "money" ? f.money(v) : kind === "percent" ? f.percent(v) : f.number(v);
  }
  return out;
}
