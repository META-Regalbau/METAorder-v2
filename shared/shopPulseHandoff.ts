/**
 * Shop-Puls Stufe 3, S3-1 „Vom Befund zur Umsetzung“ (Konzept 19.10.2026, Abschnitt 1): Typen für Server
 * (server/shopPulse/handoff*.ts, searchKeywords*.ts) und Oberfläche (/admin/shop-puls).
 *
 * - Weitergabe einer Meldung „für die Agentur“ (wirduzen) oder „für Smarketer“: Entscheidung 19.10.2026,
 *   alles geht an Oliver, er klärt es mit dem Zuständigen. Fertiger Text mit Belegen, Status „weitergegeben
 *   am …“, Erinnerung nach 2 Werktagen ohne Erledigung.
 * - Ticket aus einer Meldung (interne Aufgaben für Vertrieb, Innendienst) mit Fälligkeit.
 * - Jana-Liste: Datenlücken einmal je Woche als CSV im Jana-Format, vorerst an Oliver.
 * - Suchwörter: für Suchbegriffe ohne Treffer passende Artikel finden; nur bei eindeutiger Zuordnung direkt am
 *   Produkt in Shopware (Feld customSearchKeywords, ergänzend) eintragen, mit Hinweis an Oliver und
 *   „Rückgängig“. Unklare Fälle bleiben Vorschläge.
 */
import { z } from "zod";

/** agency = für wirduzen, marketing = für Smarketer (Text an Oliver), ticket = METAorder-Ticket */
export const SHOP_PULSE_HANDOFF_KINDS = ["agency", "marketing", "ticket"] as const;
export type ShopPulseHandoffKind = (typeof SHOP_PULSE_HANDOFF_KINDS)[number];

/** An wen der weitergeleitete Text gerichtet ist (Name im Text) */
export const SHOP_PULSE_HANDOFF_RECIPIENT_NAMES: Record<Exclude<ShopPulseHandoffKind, "ticket">, string> = {
  agency: "wirduzen (Agentur)",
  marketing: "Smarketer",
};

/** Nach so vielen Werktagen ohne Erledigung kommt eine Erinnerung (einmal) */
export const SHOP_PULSE_HANDOFF_REMIND_BUSINESS_DAYS = 2;

export type ShopPulseHandoff = {
  id: string;
  signalId: string;
  signalKey: string;
  kind: ShopPulseHandoffKind;
  /** Agentur/Smarketer: Name im Text; Ticket: zugewiesener Benutzer (leer = keiner) */
  recipient: string;
  /** fertiger, weiterleitbarer Text (deutsch); beim Ticket die Beschreibung */
  text: string;
  ticketId: string | null;
  ticketNumber: string | null;
  createdAt: string;
  createdBy: string | null;
  /** erledigt (von Hand, oder von selbst, sobald die Meldung erledigt ist) */
  doneAt: string | null;
  doneBy: string | null;
  remindedAt: string | null;
};

export const shopPulseForwardSchema = z.object({ kind: z.enum(["agency", "marketing"]) }).strict();

export const SHOP_PULSE_TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export const shopPulseTicketSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(8000).default(""),
    assignedToUserId: z.string().trim().min(1).max(64).nullable().default(null),
    /** Fälligkeit als Kalendertag (YYYY-MM-DD) */
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    priority: z.enum(SHOP_PULSE_TICKET_PRIORITIES).default("normal"),
  })
  .strict();
export type ShopPulseTicketInput = z.infer<typeof shopPulseTicketSchema>;

// ---------------------------------------------------------------------------------------------
// Jana-Liste

/** Settings-Key shop_pulse_jana_state: zuletzt gesendete Jana-Liste */
export type ShopPulseJanaState = {
  /** Montag der Woche, für die die Liste rausging */
  week: string;
  sentAt: string;
  /** Schlüssel „Fund|Artikelnummer“ der gesendeten Punkte (für neu/erledigt beim nächsten Mal) */
  keys: string[];
  total: number;
  added: number;
  fixed: number;
};

// ---------------------------------------------------------------------------------------------
// Suchwörter

/**
 * suggested = Vorschlag (unklar oder noch nicht eingetragen), applied = eingetragen, reverted = rückgängig
 * gemacht, failed = Eintragen gescheitert (error), dismissed = verworfen (kommt nicht wieder)
 */
export const SHOP_PULSE_KEYWORD_STATUSES = ["suggested", "applied", "reverted", "failed", "dismissed"] as const;
export type ShopPulseKeywordStatus = (typeof SHOP_PULSE_KEYWORD_STATUSES)[number];

/**
 * Wie der Begriff zu den Artikeln passt:
 * number = genau ein Artikel mit dieser Artikel-, EAN- oder Herstellernummer (eindeutig, automatisch),
 * name = genau ein Artikel, dessen Name alle Wörter des Begriffs enthält, mindestens eins nur ähnlich
 *   geschrieben oder als Wortteil (eindeutig, automatisch),
 * ambiguous = mehrere Artikel (Vorschlag), exact = ein Artikel enthält alle Wörter genau so, die Suche
 *   hätte ihn finden müssen (Vorschlag, Suchindex prüfen), none = kein passender Artikel
 */
export const SHOP_PULSE_KEYWORD_MATCH_KINDS = ["number", "name", "ambiguous", "exact", "none"] as const;
export type ShopPulseKeywordMatchKind = (typeof SHOP_PULSE_KEYWORD_MATCH_KINDS)[number];

/** Eindeutige Zuordnungen, die automatisch eingetragen werden */
export const SHOP_PULSE_KEYWORD_AUTO_KINDS: readonly ShopPulseKeywordMatchKind[] = ["number", "name"];

export const SHOP_PULSE_KEYWORD_REASONS = ["productNumber", "ean", "manufacturerNumber", "name"] as const;
export type ShopPulseKeywordReason = (typeof SHOP_PULSE_KEYWORD_REASONS)[number];

export type ShopPulseKeywordCandidate = {
  productId: string;
  productNumber: string;
  name: string;
  /** Netto-Umsatz der letzten 365 Tage (MO), zum Sortieren */
  revenue: number;
  reason: ShopPulseKeywordReason;
};

export type ShopPulseKeywordApplied = {
  productId: string;
  productNumber: string;
  name: string;
  /** eigener Wert des Feldes vor dem Eintragen (null = keiner, erbte bzw. leer) */
  before: string[] | null;
  after: string[];
};

export const SHOP_PULSE_KEYWORD_SOURCES = ["ga4", "manual"] as const;
export type ShopPulseKeywordSource = (typeof SHOP_PULSE_KEYWORD_SOURCES)[number];

export type ShopPulseSearchKeyword = {
  id: string;
  term: string;
  source: ShopPulseKeywordSource;
  /** Suchen mit diesem Begriff (GA4, Vortag); von Hand 0 */
  searches: number;
  status: ShopPulseKeywordStatus;
  matchKind: ShopPulseKeywordMatchKind;
  candidates: ShopPulseKeywordCandidate[];
  applied: ShopPulseKeywordApplied[];
  appliedAt: string | null;
  appliedBy: string | null;
  revertedAt: string | null;
  revertedBy: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Settings-Key shop_pulse_keyword_settings */
export type ShopPulseKeywordSettings = {
  /** Eindeutige Zuordnungen automatisch eintragen (Entscheidung 19.10.2026: ja, ohne vorherige Freigabe) */
  autoApply: boolean;
};
export const DEFAULT_SHOP_PULSE_KEYWORD_SETTINGS: ShopPulseKeywordSettings = { autoApply: true };

export function normalizeKeywordSettings(raw: unknown): ShopPulseKeywordSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { autoApply: r.autoApply !== false };
}

/** Antwort von GET /api/shop-pulse/keywords */
export type ShopPulseKeywordsOverview = {
  settings: ShopPulseKeywordSettings;
  items: ShopPulseSearchKeyword[];
  /** letzter automatischer Durchlauf (Begriffe aus der GA4-Prüfung) */
  lastRunAt: string | null;
};

export const shopPulseKeywordTermSchema = z.object({ term: z.string().trim().min(3).max(60) }).strict();
export const shopPulseKeywordApplySchema = z.object({ productNumbers: z.array(z.string().trim().min(1).max(64)).min(1).max(10) }).strict();
export const shopPulseKeywordSettingsSchema = z.object({ autoApply: z.boolean() }).strict();
