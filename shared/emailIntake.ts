/**
 * E-Mail-Eingang über n8n: Einstellungen und Antwortformat für den Workflow.
 *
 * n8n ruft das Postfach ab (METAorder darf M365 nicht direkt anbinden), schickt jede Mail an
 * /api/commercial-drafts/upload und handelt danach anhand des `intake`-Blocks der Antwort:
 * Kategorien setzen, „Sonstiges“ weiterleiten, Mail in den Verarbeitet-Ordner verschieben.
 */
import { z } from "zod";

export const EMAIL_INTAKE_SETTING_KEY = "email_intake_settings";

export const emailIntakeSettingsSchema = z.object({
  /** Aus: der Workflow holt keine Mails (n8n fragt die Einstellungen bei jedem Lauf ab) */
  enabled: z.boolean(),
  /** Freigegebenes Postfach (z. B. bestellung@…); leer = Postfach des n8n-Outlook-Zugangs */
  mailbox: z.string().trim().max(254),
  /** Unterordner des Posteingangs, in den verarbeitete Mails verschoben werden */
  processedFolderName: z.string().trim().min(1).max(120),
  /** Mails je Lauf (der Workflow läuft alle 2 Minuten) */
  maxPerRun: z.number().int().min(1).max(50),
  /**
   * Nur Mails ab diesem Tag (JJJJ-MM-TT). Schützt vor dem Altbestand des Postfachs: der Abruf nimmt
   * die ältesten Mails zuerst. Leer = die letzten 2 Tage.
   */
  processSince: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  /** Weder Bestellung noch Angebot: Weiterleitung an diese Adresse; leer = nur verschieben */
  forwardOtherTo: z.string().trim().max(254),
  /** Ab dieser Sicherheit gilt eine Mail als „Sonstiges“ (darunter wird ein Entwurf angelegt) */
  otherMinConfidence: z.number().min(0.5).max(1),
  /** Letzte Stufe der Zuweisung: bekommt das Ticket, wenn sonst niemand zuständig ist */
  defaultAssigneeUserId: z.string().trim().max(64).nullable(),
  ticketOnFailure: z.boolean(),
  ticketOnShopwareError: z.boolean(),
  ticketOnMarginRed: z.boolean(),
});

export type EmailIntakeSettings = z.infer<typeof emailIntakeSettingsSchema>;

export const DEFAULT_EMAIL_INTAKE_SETTINGS: EmailIntakeSettings = {
  // Aus, bis jemand Postfach und Startdatum geprüft hat: sonst verarbeitet der erste Lauf schon Erledigtes
  enabled: false,
  mailbox: "",
  processedFolderName: "METAorder verarbeitet",
  maxPerRun: 10,
  processSince: "",
  forwardOtherTo: "",
  otherMinConfidence: 0.7,
  defaultAssigneeUserId: null,
  ticketOnFailure: true,
  ticketOnShopwareError: true,
  ticketOnMarginRed: true,
};

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidIntakeEmail(value: string): boolean {
  return SIMPLE_EMAIL_RE.test(value.trim());
}

/** Gespeicherten Wert mit Standardwerten auffüllen; Unbrauchbares fällt auf den Standard zurück. */
export function normalizeEmailIntakeSettings(stored: unknown): EmailIntakeSettings {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const out: EmailIntakeSettings = { ...DEFAULT_EMAIL_INTAKE_SETTINGS };
  for (const key of Object.keys(DEFAULT_EMAIL_INTAKE_SETTINGS) as Array<keyof EmailIntakeSettings>) {
    if (!(key in raw)) continue;
    const field = emailIntakeSettingsSchema.shape[key].safeParse(raw[key]);
    if (field.success) (out as Record<string, unknown>)[key] = field.data;
  }
  return out;
}

/** Outlook-Kategorien, die n8n an die Mail hängt (in Outlook für alle sichtbar). */
export const EMAIL_INTAKE_CATEGORIES = {
  order: "METAorder: Bestellung",
  offer: "METAorder: Angebot",
  other: "METAorder: Sonstiges",
  ticket: "METAorder: Ticket",
  failed: "METAorder: Fehler",
} as const;

/** Art der Mail, wenn sie weder Bestellung noch Anfrage ist (für Hinweis und Ticket) */
export const EMAIL_INTAKE_OTHER_TYPES = [
  "invoice",
  "delivery",
  "order_status",
  "complaint",
  "newsletter",
  "auto_reply",
  "application",
  "spam",
  "general",
] as const;
export type EmailIntakeOtherType = (typeof EMAIL_INTAKE_OTHER_TYPES)[number];

export const EMAIL_INTAKE_OTHER_TYPE_LABELS: Record<EmailIntakeOtherType, string> = {
  invoice: "Rechnung/Zahlung",
  delivery: "Lieferschein/Versand",
  order_status: "Rückfrage zu einem Vorgang",
  complaint: "Reklamation",
  newsletter: "Newsletter/Werbung",
  auto_reply: "Automatische Antwort",
  application: "Bewerbung",
  spam: "Spam",
  general: "Allgemeine Nachricht",
};

export type EmailIntakeOutcome =
  /** Mindestens ein Bestellentwurf (ggf. schon in Shopware angelegt) */
  | "order"
  | "offer"
  /** Bestellung und Angebot aus derselben Mail */
  | "mixed"
  /** Weder Bestellung noch Angebot */
  | "other"
  /** Schon verarbeitet (n8n-Wiederholung) */
  | "duplicate"
  /** Konnte nicht verarbeitet werden — Ticket angelegt */
  | "failed";

export type EmailIntakeTicketRef = {
  ticketNumber: string;
  reason: EmailIntakeProblemReason;
  assignedTo: string | null;
};

export type EmailIntakeProblemReason = "processing_failed" | "shopware_failed" | "margin_red";

/** Block `intake` in der Upload-Antwort: sagt n8n, was mit der Mail in Outlook passiert. */
export type EmailIntakeResponse = {
  outcome: EmailIntakeOutcome;
  /** Kategorien, die n8n setzt (vorhandene bleiben) */
  categories: string[];
  /** Weiterleitung („Sonstiges“); null = nicht weiterleiten */
  forward: { to: string; comment: string } | null;
  /** In den Verarbeitet-Ordner verschieben (false: in der Inbox lassen, z. B. „läuft schon“) */
  move: boolean;
  tickets: EmailIntakeTicketRef[];
  /** Einordnung „Sonstiges“: Art und Begründung */
  other: { type: EmailIntakeOtherType; confidence: number; reason: string } | null;
};

/** Konfiguration, die n8n zu Beginn jedes Laufs abruft */
export type EmailIntakeWorkflowConfig = {
  enabled: boolean;
  /** Graph-Basis: /me oder /users/{postfach} */
  graphBase: string;
  mailbox: string | null;
  processedFolderName: string;
  maxPerRun: number;
  /** Untergrenze für receivedDateTime (ISO, UTC) */
  receivedAfter: string;
};

const FALLBACK_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

export function receivedAfterFor(processSince: string, now = new Date()): string {
  if (processSince) return `${processSince}T00:00:00Z`;
  return new Date(now.getTime() - FALLBACK_LOOKBACK_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function graphBaseForMailbox(mailbox: string): string {
  const trimmed = mailbox.trim();
  return trimmed
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(trimmed)}`
    : "https://graph.microsoft.com/v1.0/me";
}
