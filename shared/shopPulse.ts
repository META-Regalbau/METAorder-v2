/**
 * Shop-Puls: meldet, was im Onlineshop nicht gut läuft (Konzept Stufe 1, 17.10.2026). Typen für Server
 * (server/shopPulse/*) und Oberfläche (/admin/shop-puls).
 *
 * Prüfungen („Detektoren“) liefern Funde mit festem Schlüssel; daraus werden Meldungen (Tabelle
 * shop_pulse_signals). Je Schlüssel gibt es eine Meldung, die offen bleibt, solange der Fund besteht.
 * Texte übersetzt der Client: shopPulse.codes.<code>.title / .message mit den params des Funds.
 */
import { isAllowedTeamsWebhookUrl } from "./emailIntake";

/** Woher ein Fund kommt */
export const SHOP_PULSE_SOURCES = ["system", "revenue", "buyability", "ga4"] as const;
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
] as const;
export type ShopPulseCode = (typeof SHOP_PULSE_CODES)[number];

/**
 * Ereignisse statt Zustände: der Fund gilt nur für den Lauf nach der Änderung (Preissprung). Verschwindet
 * er danach, ist nichts „behoben“ – es gibt deshalb keine Entwarnung.
 */
export const SHOP_PULSE_EVENT_CODES: readonly ShopPulseCode[] = ["priceJump"];

/** Prüfungen in Lauf-Reihenfolge (server/shopPulse/detectors); die Seite zeigt sie so an */
export const SHOP_PULSE_DETECTOR_IDS = [
  "mirrorFreshness",
  "orderGap",
  "paymentGone",
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
] as const;

/**
 * Warum GA4 nicht eingerichtet ist (Einstellungen → Google Analytics): ausgeschaltet, keine Property-ID,
 * Mess-ID „G-…“ statt numerischer Property-ID, Property-ID keine Zahl, kein bzw. ungültiges Dienstkonto-JSON
 */
export const GA4_SETUP_PROBLEMS = ["disabled", "noProperty", "measurementId", "invalidProperty", "noServiceAccount", "invalidServiceAccount"] as const;
export type Ga4SetupProblem = (typeof GA4_SETUP_PROBLEMS)[number];

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
};

/** Einstellungen je Mandant (Settings-Key shop_pulse_settings) */
export type ShopPulseSettings = {
  enabled: boolean;
  /** Bis dahin nur sammeln, keine Nachrichten (Lernwoche, Entscheidung 17.10.2026); null = keine */
  learningUntil: string | null;
  /** Teams-Workflow „Bei Empfang einer Webhook-Anforderung in einem Chat posten“ (Direktnachricht); "" = keine */
  teamsWebhookUrl: string;
  /** Meldungen des Shop-Wächters ebenfalls an diese Direktnachricht statt an den Kanal des E-Mail-Eingangs */
  shopWatchDirect: boolean;
};

export const DEFAULT_SHOP_PULSE_SETTINGS: ShopPulseSettings = {
  enabled: false,
  learningUntil: null,
  teamsWebhookUrl: "",
  shopWatchDirect: false,
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
  /**
   * skipped "mirror": ausgesetzt, weil der Bestellabgleich hängt; "busy": der Shop-Wächter fragt den Shop
   * gerade ab; "ga4": GA4 nicht eingerichtet (ga4Problem sagt, was fehlt)
   */
  detectors?: Record<
    string,
    { at: string; ok: boolean; error?: string; skipped?: "mirror" | "busy" | "ga4"; ga4Problem?: Ga4SetupProblem; findings: number }
  >;
};

/**
 * Datenlücken der Artikel für die PIM-Sammlung (Jana): werden nicht gemeldet und nicht im Shop
 * korrigiert, sondern als CSV ausgegeben (Format wie Datenfehler-PIM-Artikel.csv).
 */
export const SHOP_PULSE_DATA_GAP_CODES = ["noImage", "noCategory", "salesUnit"] as const;
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
  learning: boolean;
  state: ShopPulseState;
  signals: ShopPulseSignal[];
  teamsPending: number;
  running: boolean;
  /** Soll-Stand der Kaufbarkeit (kaufbare Artikel mit Umsatz, Zahl- und Versandarten) */
  buyabilityBaseline: { takenAt: string; products: number; paymentMethods: number; shippingMethods: number } | null;
  /** Datenlücken für die PIM-Sammlung: Anzahl je Art, Stand des letzten Nachtlaufs */
  dataGaps: { at: string; counts: Partial<Record<ShopPulseDataGapCode, number>> } | null;
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
