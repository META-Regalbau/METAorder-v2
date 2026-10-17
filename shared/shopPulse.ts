/**
 * Shop-Puls: meldet, was im Onlineshop nicht gut läuft (Konzept Stufe 1, 17.10.2026). Typen für Server
 * (server/shopPulse/*) und Oberfläche (/admin/shop-puls).
 *
 * Prüfungen („Detektoren“) liefern Funde mit festem Schlüssel; daraus werden Meldungen (Tabelle
 * shop_pulse_signals). Je Schlüssel gibt es eine Meldung, die offen bleibt, solange der Fund besteht.
 * Texte übersetzt der Client: shopPulse.codes.<code>.title / .message mit den params des Funds.
 */
import { isAllowedTeamsWebhookUrl } from "./emailIntake";

/** Woher ein Fund kommt; PR A bringt nur „system“, Umsatz/Kaufbarkeit/GA4 folgen (PR B–E) */
export const SHOP_PULSE_SOURCES = ["system", "revenue", "buyability", "ga4"] as const;
export type ShopPulseSource = (typeof SHOP_PULSE_SOURCES)[number];

/** critical = sofort melden, warning = Tagesbericht */
export const SHOP_PULSE_SEVERITIES = ["warning", "critical"] as const;
export type ShopPulseSeverity = (typeof SHOP_PULSE_SEVERITIES)[number];

export const SHOP_PULSE_STATUSES = ["open", "resolved"] as const;
export type ShopPulseStatus = (typeof SHOP_PULSE_STATUSES)[number];

/** Fund-Arten (je eine Übersetzung shopPulse.codes.<code>) */
export const SHOP_PULSE_CODES = ["mirrorStale", "mirrorError"] as const;
export type ShopPulseCode = (typeof SHOP_PULSE_CODES)[number];

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
  detectors?: Record<string, { at: string; ok: boolean; error?: string; findings: number }>;
};

/** Antwort von GET /api/shop-pulse */
export type ShopPulseOverview = {
  settings: Omit<ShopPulseSettings, "teamsWebhookUrl"> & { teamsConfigured: boolean };
  learning: boolean;
  state: ShopPulseState;
  signals: ShopPulseSignal[];
  teamsPending: number;
  running: boolean;
};
