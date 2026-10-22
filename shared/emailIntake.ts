/**
 * E-Mail-Eingang über n8n: Einstellungen und Antwortformat für den Workflow.
 *
 * n8n ruft das Postfach ab (METAorder darf M365 nicht direkt anbinden), schickt jede Mail an
 * /api/commercial-drafts/upload und handelt danach anhand des `intake`-Blocks der Antwort:
 * Kategorien setzen, „Sonstiges“ weiterleiten, Mail in den Verarbeitet-Ordner verschieben.
 */
import { z } from "zod";

export const EMAIL_INTAKE_SETTING_KEY = "email_intake_settings";

/**
 * Ein abgerufenes Postfach. „order“ = Bestellpostfach: erledigte Mails werden verschoben,
 * „Sonstiges“ weitergeleitet. „personal“ = persönliches Postfach: nichts wird verschoben oder
 * weitergeleitet, METAorder setzt nur Kategorien (die Mail bleibt, wo sie ist).
 * „route“ = Verteilpostfach (z. B. digital-service@): kein Entwurf; Produkt- und Angebotsanfragen
 * leitet n8n an `inquiryForwardTo` weiter (dort entsteht der Entwurf), alles andere bleibt liegen.
 */
export const EMAIL_INTAKE_MAILBOX_MODES = ["order", "personal", "route"] as const;

export const emailIntakeMailboxSchema = z.object({
  /** Freigegebenes Postfach (z. B. bestellung@…); leer = Postfach des n8n-Outlook-Zugangs */
  address: z.string().trim().max(254),
  mode: z.enum(EMAIL_INTAKE_MAILBOX_MODES),
  enabled: z.boolean(),
});
export type EmailIntakeMailbox = z.infer<typeof emailIntakeMailboxSchema>;
export type EmailIntakeMailboxMode = EmailIntakeMailbox["mode"];

/** Absender als volle Adresse (name@firma.de) oder Domain (firma.de bzw. @firma.de) */
const senderPatternSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^@/, ""))
  .pipe(z.string().regex(/^([^\s@]+@)?[a-z0-9.-]+\.[a-z]{2,}$/, "Adresse oder Domain"));

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^@/, ""))
  .pipe(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Domain"));

/**
 * Filter vor der Einordnung (ohne KI): aussortierte Mails bekommen nur die Kategorie
 * „METAorder: ignoriert“ und bleiben im Posteingang — kein Entwurf, keine Weiterleitung.
 * Reihenfolge: Erlaubtliste → Sperrliste → Betreff-Stichwörter → intern → Newsletter.
 */
export const emailIntakeFilterSchema = z.object({
  /** Newsletter und Massenmails (List-Unsubscribe, Precedence: bulk, noreply-Absender) */
  ignoreBulk: z.boolean(),
  /** Mails von Kollegen (interne Domains); weitergeleitete Kundenmails bleiben drin */
  ignoreInternal: z.boolean(),
  /** Eigene Domains zusätzlich zu den Domains der Postfächer */
  internalDomains: z.array(domainSchema).max(20),
  /** Immer ignorieren */
  blockSenders: z.array(senderPatternSchema).max(200),
  /** Immer verarbeiten (vor allen anderen Regeln) */
  allowSenders: z.array(senderPatternSchema).max(200),
  /** Betreff enthält eines dieser Stichwörter → ignorieren */
  blockSubjectKeywords: z.array(z.string().trim().min(2).max(100)).max(100),
});
export type EmailIntakeFilterSettings = z.infer<typeof emailIntakeFilterSchema>;

export const DEFAULT_EMAIL_INTAKE_FILTER: EmailIntakeFilterSettings = {
  ignoreBulk: true,
  ignoreInternal: true,
  internalDomains: [],
  blockSenders: [],
  allowSenders: [],
  blockSubjectKeywords: [],
};

export const emailIntakeSettingsSchema = z.object({
  /** Aus: der Workflow holt keine Mails (n8n fragt die Einstellungen bei jedem Lauf ab) */
  enabled: z.boolean(),
  /** Abgerufene Postfächer (ein Workflow für alle) */
  mailboxes: z
    .array(emailIntakeMailboxSchema)
    .min(1)
    .max(10)
    .refine(
      (list) => new Set(list.map((m) => m.address.toLowerCase())).size === list.length,
      "Jedes Postfach nur einmal",
    ),
  filter: emailIntakeFilterSchema,
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
  /**
   * Verteilpostfächer (Modus „route“): Produkt-, Angebotsanfragen und Bestellungen gehen an diese Adresse,
   * in der Regel das Shop-Postfach. Leer = nichts weiterleiten, nur markieren.
   */
  inquiryForwardTo: z.string().trim().max(254),
  /** Ab dieser Sicherheit der KI wird eine Anfrage aus einem Verteilpostfach weitergeleitet */
  inquiryMinConfidence: z.number().min(0.5).max(1),
  /** Letzte Stufe der Zuweisung: bekommt das Ticket, wenn sonst niemand zuständig ist */
  defaultAssigneeUserId: z.string().trim().max(64).nullable(),
  ticketOnFailure: z.boolean(),
  ticketOnShopwareError: z.boolean(),
  ticketOnMarginRed: z.boolean(),
  /**
   * Teams-Workflow-Webhook („Post to a channel when a webhook request is received“): n8n postet dorthin
   * je neuem Problem-Ticket eine Karte mit @Erwähnung des Zuständigen. Leer = keine Teams-Info.
   */
  teamsWebhookUrl: z.union([
    z.literal(""),
    z
      .string()
      .trim()
      .max(2000)
      .url()
      .refine((v) => isAllowedTeamsWebhookUrl(v), "Nur https-Adressen von Microsoft (Power Automate / Logic Apps / Teams)"),
  ]),
  /**
   * Kundenantworten (Entscheidung 19.10.2026): je Mailart ein Ticket „Kundenanfrage“ mit KI-Antwortentwurf.
   * Verschickt wird erst nach Freigabe im Ticket, über n8n aus dem Postfach der Mail. Ab Werk aus.
   */
  replyDrafts: z.object({
    order_status: z.boolean(),
    complaint: z.boolean(),
    general: z.boolean(),
    offer_request: z.boolean(),
  }),
  /** Gruß unter jedem Antwortentwurf (z. B. „Ihr META-Shop-Team“) */
  replySignature: z.string().trim().max(1000),
});

/** Mailarten mit Antwortentwurf */
export const EMAIL_INTAKE_REPLY_KINDS = ["order_status", "complaint", "general", "offer_request"] as const;
export type EmailIntakeReplyKind = (typeof EMAIL_INTAKE_REPLY_KINDS)[number];

export const EMAIL_INTAKE_REPLY_KIND_LABELS: Record<EmailIntakeReplyKind, string> = {
  order_status: "Lieferstatus / Rückfrage zur Bestellung",
  complaint: "Reklamation",
  general: "Kundenfrage",
  offer_request: "Angebotsanfrage",
};

/** Platzhalter im Entwurf („[Liefertermin eintragen]“): solange einer drinsteht, wird nicht verschickt */
export const REPLY_PLACEHOLDER_RE = /\[[^\[\]\n]{2,80}\]/g;

export function replyPlaceholders(text: string): string[] {
  return [...new Set(text.match(REPLY_PLACEHOLDER_RE) ?? [])];
}

const TEAMS_WEBHOOK_HOST_RE = /(^|\.)(logic\.azure\.com|powerplatform\.com|powerautomate\.com|webhook\.office\.com)$/i;

/** Teams-Webhooks laufen über Microsoft-Dienste; andere Ziele würden Ticketdaten nach außen geben. */
export function isAllowedTeamsWebhookUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && TEAMS_WEBHOOK_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

export type EmailIntakeSettings = z.infer<typeof emailIntakeSettingsSchema>;

export const DEFAULT_EMAIL_INTAKE_SETTINGS: EmailIntakeSettings = {
  // Aus, bis jemand Postfach und Startdatum geprüft hat: sonst verarbeitet der erste Lauf schon Erledigtes
  enabled: false,
  mailboxes: [{ address: "", mode: "order", enabled: true }],
  filter: DEFAULT_EMAIL_INTAKE_FILTER,
  processedFolderName: "METAorder verarbeitet",
  maxPerRun: 10,
  processSince: "",
  forwardOtherTo: "",
  otherMinConfidence: 0.7,
  inquiryForwardTo: "",
  // Niedriger als bei „Sonstiges“: eine Mail zu viel im Shop-Postfach ist harmloser als eine verlorene Anfrage
  inquiryMinConfidence: 0.6,
  defaultAssigneeUserId: null,
  ticketOnFailure: true,
  ticketOnShopwareError: true,
  ticketOnMarginRed: true,
  teamsWebhookUrl: "",
  replyDrafts: { order_status: false, complaint: false, general: false, offer_request: false },
  replySignature: "",
};

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidIntakeEmail(value: string): boolean {
  return SIMPLE_EMAIL_RE.test(value.trim());
}

/** Gespeicherten Wert mit Standardwerten auffüllen; Unbrauchbares fällt auf den Standard zurück. */
export function normalizeEmailIntakeSettings(stored: unknown): EmailIntakeSettings {
  const raw = stored && typeof stored === "object" ? { ...(stored as Record<string, unknown>) } : {};
  // Bis 12.10.2026 gab es nur ein Postfach (Feld `mailbox`): als Bestellpostfach übernehmen
  if (!("mailboxes" in raw) && typeof raw.mailbox === "string") {
    raw.mailboxes = [{ address: raw.mailbox, mode: "order", enabled: true }];
  }
  const out: EmailIntakeSettings = { ...DEFAULT_EMAIL_INTAKE_SETTINGS };
  for (const key of Object.keys(DEFAULT_EMAIL_INTAKE_SETTINGS) as Array<keyof EmailIntakeSettings>) {
    if (!(key in raw)) continue;
    if (key === "filter") {
      out.filter = normalizeFilter(raw.filter);
      continue;
    }
    if (key === "replyDrafts") {
      const stored = raw.replyDrafts && typeof raw.replyDrafts === "object" ? (raw.replyDrafts as Record<string, unknown>) : {};
      out.replyDrafts = { ...DEFAULT_EMAIL_INTAKE_SETTINGS.replyDrafts };
      for (const kind of EMAIL_INTAKE_REPLY_KINDS) if (typeof stored[kind] === "boolean") out.replyDrafts[kind] = stored[kind] as boolean;
      continue;
    }
    const field = emailIntakeSettingsSchema.shape[key].safeParse(raw[key]);
    if (field.success) (out as Record<string, unknown>)[key] = field.data;
  }
  return out;
}

function normalizeFilter(stored: unknown): EmailIntakeFilterSettings {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const out: EmailIntakeFilterSettings = { ...DEFAULT_EMAIL_INTAKE_FILTER };
  for (const key of Object.keys(DEFAULT_EMAIL_INTAKE_FILTER) as Array<keyof EmailIntakeFilterSettings>) {
    if (!(key in raw)) continue;
    const field = emailIntakeFilterSchema.shape[key].safeParse(raw[key]);
    if (field.success) (out as Record<string, unknown>)[key] = field.data;
  }
  return out;
}

/** Postfach-Eintrag zu einer Adresse ("" bzw. unbekannt = Postfach des n8n-Zugangs bzw. null) */
export function findIntakeMailbox(settings: EmailIntakeSettings, address: string | null | undefined): EmailIntakeMailbox | null {
  const wanted = (address ?? "").trim().toLowerCase();
  return settings.mailboxes.find((m) => m.address.trim().toLowerCase() === wanted) ?? null;
}

/** Domains, die als „intern“ gelten: eingetragene plus die der Postfächer */
export function internalDomainsFor(settings: EmailIntakeSettings): string[] {
  const fromMailboxes = settings.mailboxes
    .map((m) => m.address.trim().toLowerCase().split("@")[1] ?? "")
    .filter(Boolean);
  return [...new Set([...settings.filter.internalDomains, ...fromMailboxes])];
}

/** Outlook-Kategorien, die n8n an die Mail hängt (in Outlook für alle sichtbar). */
export const EMAIL_INTAKE_CATEGORIES = {
  order: "METAorder: Bestellung",
  offer: "METAorder: Angebot",
  other: "METAorder: Sonstiges",
  ticket: "METAorder: Ticket",
  failed: "METAorder: Fehler",
  /** Vom Filter aussortiert (Newsletter, intern, Sperrliste): bleibt im Posteingang */
  ignored: "METAorder: ignoriert",
  /** Verteilpostfach: als Anfrage erkannt und weitergeleitet (bleibt im Posteingang) */
  routed: "METAorder: weitergeleitet",
  /** Verteilpostfach: geprüft, keine Anfrage (bleibt im Posteingang) */
  checked: "METAorder: geprüft",
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
  | "failed"
  /** Vom Filter aussortiert (ohne KI, ohne Entwurf, bleibt im Posteingang) */
  | "ignored"
  /** Verteilpostfach: Anfrage erkannt, an `inquiryForwardTo` weitergeleitet */
  | "routed"
  /** Verteilpostfach: keine Anfrage, bleibt liegen */
  | "kept";

export type EmailIntakeTicketRef = {
  ticketNumber: string;
  reason: EmailIntakeProblemReason;
  /** Benutzername des Zuständigen */
  assignedTo: string | null;
  ticketId?: string;
  /** false: Ticket gab es schon (n8n-Wiederholung) → keine zweite Teams-Info */
  isNew?: boolean;
  /** E-Mail des Zuständigen (= Teams-Anmeldename für die @Erwähnung) */
  assignedToEmail?: string | null;
  subject?: string;
  /** Firma bzw. Absender der Kundenmail */
  customer?: string | null;
  /** Relativer Link zum Entwurf */
  draftPath?: string | null;
};

/** Fertige Teams-Nachrichten; n8n schickt jede per POST an `webhookUrl`. */
export type EmailIntakeTeamsBlock = {
  webhookUrl: string;
  messages: Array<Record<string, unknown>>;
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
  /** Teams-Info zu neuen Problem-Tickets; null = nichts posten */
  teams?: EmailIntakeTeamsBlock | null;
  /** Filter-Regel, die die Mail aussortiert hat */
  filter?: { rule: EmailIntakeFilterRule; reason: string } | null;
  /** Verteilpostfach: Einordnung der KI */
  route?: { kind: EmailIntakeRouteKind; confidence: number; reason: string } | null;
};

/** Einordnung im Verteilpostfach; die ersten drei werden weitergeleitet */
export const EMAIL_INTAKE_ROUTE_KINDS = ["order", "quote_request", "product_question", "other"] as const;
export type EmailIntakeRouteKind = (typeof EMAIL_INTAKE_ROUTE_KINDS)[number];

export const EMAIL_INTAKE_ROUTE_KIND_LABELS: Record<EmailIntakeRouteKind, string> = {
  order: "Bestellung",
  quote_request: "Angebotsanfrage",
  product_question: "Produktanfrage",
  other: "keine Anfrage",
};

export type EmailIntakeFilterRule = "allow_list" | "block_list" | "subject_keyword" | "internal" | "bulk" | "metaorder_forward";

/**
 * Anfang des Hinweises, den METAorder beim Weiterleiten von „Sonstiges“ über die Mail setzt. Kommt eine
 * solche Mail wieder im Eingang an (Weiterleitungsziel ist selbst angebunden), wird sie nicht erneut
 * verarbeitet, sonst entsteht eine Schleife.
 */
export const METAORDER_FORWARD_MARKER = "METAorder hat diese E-Mail weder als Bestellung noch als Angebotsanfrage erkannt";

/**
 * Anfang des Hinweises über einer Anfrage, die METAorder aus einem Verteilpostfach weitergeleitet hat. Anders als
 * bei „Sonstiges“ wird so eine Mail im Zielpostfach (Shop) ganz normal verarbeitet; nur ein anderes
 * Verteilpostfach leitet sie nicht noch einmal weiter.
 */
export const METAORDER_ROUTE_MARKER = "METAorder hat diese E-Mail als Anfrage an den Shop erkannt";

function mailContains(marker: string, texts: Array<string | null | undefined>): boolean {
  return texts.some((text) => {
    if (!text) return false;
    const plain = text
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
      .replace(/\s+/g, " ");
    return plain.includes(marker);
  });
}

/** Enthält der Mailtext (Text oder HTML) den Weiterleitungshinweis von METAorder? */
export function isMetaorderForwardedMail(...texts: Array<string | null | undefined>): boolean {
  return mailContains(METAORDER_FORWARD_MARKER, texts);
}

/** Hat METAorder die Mail schon aus einem Verteilpostfach weitergeleitet? */
export function isMetaorderRoutedMail(...texts: Array<string | null | undefined>): boolean {
  return mailContains(METAORDER_ROUTE_MARKER, texts);
}

/** Weiterleitungsziel ist selbst ein angebundenes Postfach (Schleife)? */
export function isForwardTargetIntakeMailbox(settings: Pick<EmailIntakeSettings, "forwardOtherTo" | "mailboxes">): boolean {
  const target = settings.forwardOtherTo.trim().toLowerCase();
  return Boolean(target) && settings.mailboxes.some((m) => m.address.trim().toLowerCase() === target);
}

/**
 * Ziel der Anfragen ist selbst ein Verteilpostfach (Schleife)? Ein Bestellpostfach als Ziel ist gewollt: dort
 * entsteht der Entwurf.
 */
export function isInquiryTargetRouteMailbox(settings: Pick<EmailIntakeSettings, "inquiryForwardTo" | "mailboxes">): boolean {
  const target = settings.inquiryForwardTo.trim().toLowerCase();
  return Boolean(target) && settings.mailboxes.some((m) => m.mode === "route" && m.address.trim().toLowerCase() === target);
}

/** Ein Postfach im Lauf: alles, was n8n für Abruf und Ablage braucht */
export type EmailIntakeWorkflowMailbox = {
  /** Graph-Basis: /me oder /users/{postfach} */
  graphBase: string;
  /** Adresse wie in den Einstellungen; null = Postfach des n8n-Zugangs (an METAorder zurückgeben) */
  mailbox: string | null;
  mode: EmailIntakeMailboxMode;
  /** Unterordner für erledigte Mails (nur Bestellpostfach; persönliches und Verteilpostfach verschieben nicht) */
  processedFolderName: string;
  maxPerRun: number;
  /** Untergrenze für receivedDateTime (ISO, UTC) */
  receivedAfter: string;
  /**
   * Fertiger Graph-$filter: ab receivedAfter und ohne METAorder-Kategorie. So holt n8n weder
   * aussortierte noch im persönlichen Postfach liegengelassene Mails erneut.
   */
  messageFilter: string;
};

/** Konfiguration, die n8n zu Beginn jedes Laufs abruft */
export type EmailIntakeWorkflowConfig = {
  enabled: boolean;
  /** Aktive Postfächer */
  mailboxes: EmailIntakeWorkflowMailbox[];
  /** Ältere Workflows (ein Postfach): erstes aktives Postfach */
  graphBase: string;
  mailbox: string | null;
  processedFolderName: string;
  maxPerRun: number;
  receivedAfter: string;
};

/** Graph-$filter: ab dem Startzeitpunkt und ohne eine der METAorder-Kategorien */
export function intakeMessageFilter(receivedAfter: string): string {
  const notCategorized = Object.values(EMAIL_INTAKE_CATEGORIES)
    .map((c) => `not(categories/any(c:c eq '${c.replace(/'/g, "''")}'))`)
    .join(" and ");
  return `receivedDateTime ge ${receivedAfter} and ${notCategorized}`;
}

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
