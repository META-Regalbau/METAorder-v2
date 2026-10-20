/**
 * Kundenmails über Brevo, Baustein B1 „Fundament“ (Konzept 19./20.10.2026, Kundenmails-Brevo-Konzept-2026-10-19.html):
 * Typen und Regeln für Server (server/customerMails/*) und Oberfläche (/admin/kundenmails).
 *
 * METAorder entscheidet, wer welche Mail bekommt; Brevo verschickt als Kampagne an eine von METAorder gefüllte Liste
 * (Abmeldelink und Sperrliste von Brevo greifen damit von selbst). Werbung nur mit Rechtsgrundlage:
 * - consent: bestätigte Newsletter-Anmeldung (Shopware, Double-Opt-in) oder erfasste Einwilligung (CRM/Außendienst)
 * - existingCustomer: Bestandskunde nach § 7 Abs. 3 UWG, nur mit Bestellung ab dem Stichtag des Hinweises (B0)
 * Ein Widerspruch (Abmeldung, Spam-Meldung, Newsletter-Abmeldung, Brevo-Sperrliste, Erfassung) schlägt alles.
 */
import { z } from "zod";

export const CUSTOMER_MAIL_TYPES = [
  "test",
  "newsletter",
  "regularLetter",
  "regularOverdue",
  "afterSalesService",
  "afterSalesAccessories",
  "reactivation",
] as const;
export type CustomerMailType = (typeof CUSTOMER_MAIL_TYPES)[number];

export const CUSTOMER_MAIL_BASES = ["consent", "existingCustomer", "none", "objected"] as const;
/** Rechtsgrundlage je Kontakt: objected = Widerspruch (schlägt Einwilligung), none = keine */
export type CustomerMailBasis = (typeof CUSTOMER_MAIL_BASES)[number];

/**
 * Regeln je Mailart. advertising = zählt für die Kontaktbremse; bases = zulässige Rechtsgrundlagen.
 * test geht nur an die internen Testadressen aus den Einstellungen. Nur „test“ ist in B1 schon nutzbar,
 * die übrigen Mailarten kommen mit B2–B5.
 */
export const CUSTOMER_MAIL_TYPE_RULES: Record<CustomerMailType, { advertising: boolean; bases: CustomerMailBasis[]; available: boolean }> = {
  test: { advertising: false, bases: [], available: true },
  newsletter: { advertising: true, bases: ["consent"], available: false },
  regularLetter: { advertising: true, bases: ["consent", "existingCustomer"], available: false },
  regularOverdue: { advertising: true, bases: ["consent", "existingCustomer"], available: false },
  afterSalesService: { advertising: false, bases: ["consent", "existingCustomer", "none"], available: false },
  afterSalesAccessories: { advertising: true, bases: ["consent", "existingCustomer"], available: false },
  reactivation: { advertising: true, bases: ["consent", "existingCustomer"], available: false },
};

export const CUSTOMER_MAIL_CONSENT_SOURCES = ["shopNewsletter", "crm", "manual"] as const;
export type CustomerMailConsentSource = (typeof CUSTOMER_MAIL_CONSENT_SOURCES)[number];

/** brevoBlocklist entsteht seit Migration 0066 nicht mehr (Sperre ≠ Widerspruch), bleibt für alte Zeilen lesbar */
export const CUSTOMER_MAIL_OBJECTION_SOURCES = ["brevoUnsubscribe", "brevoSpam", "brevoBlocklist", "shopNewsletterOptOut", "manual"] as const;
export type CustomerMailObjectionSource = (typeof CUSTOMER_MAIL_OBJECTION_SOURCES)[number];

export const CUSTOMER_MAIL_SKIP_REASONS = ["objected", "bounced", "noBasis", "frequency", "invalidEmail", "duplicate", "channelOff", "brevoBlocked"] as const;
export type CustomerMailSkipReason = (typeof CUSTOMER_MAIL_SKIP_REASONS)[number];

export const CUSTOMER_MAIL_RUN_STATUSES = ["draft", "sending", "sent", "failed", "cancelled"] as const;
export type CustomerMailRunStatus = (typeof CUSTOMER_MAIL_RUN_STATUSES)[number];

/** Eigene Kontaktfelder in Brevo (Präfix MO_, damit nichts mit dem Brevo-Plugin kollidiert) */
export const CUSTOMER_MAIL_BASE_ATTRIBUTES = {
  MO_FIRMA: "text",
  MO_NAME: "text",
  MO_KUNDENNR: "text",
  MO_KANAL: "text",
  /** einwilligung | bestandskunde | test – für die passende Fußzeile in der Vorlage */
  MO_GRUNDLAGE: "text",
  MO_LETZTE_BESTELLUNG: "date",
} as const;
export const CUSTOMER_MAIL_ATTRIBUTE_NAME = /^MO_[A-Z0-9_]{1,40}$/;

export type CustomerMailChannelKind = "shop" | "portal";

/** Verkaufskanal: Absender und Sprache je Kanal (Töchter bekommen später eigene Kanäle bzw. Mandanten) */
export type CustomerMailChannel = {
  salesChannelId: string;
  name: string;
  kind: CustomerMailChannelKind;
  language: string;
  enabled: boolean;
  /** Brevo-Absender (GET /senders); null = noch keiner gewählt */
  senderId: number | null;
};

export type CustomerMailSettings = {
  /** Not-Aus: aus = kein Abgleich, kein Versand */
  enabled: boolean;
  /** Stichtag des Bestandskunden-Hinweises (YYYY-MM-DD); null = Bestandskunden-Regel noch nicht nutzbar */
  existingCustomerSince: string | null;
  /** Kontaktbremse für Werbemails je Empfänger */
  maxPerWeek: number;
  maxPerMonth: number;
  /** interne Adressen für Testaussendungen */
  testRecipients: string[];
  /** Antwortadresse (überwachtes Postfach); leer = Absender */
  replyTo: string;
  channels: CustomerMailChannel[];
};

export const DEFAULT_CUSTOMER_MAIL_SETTINGS: CustomerMailSettings = {
  enabled: false,
  existingCustomerSince: null,
  maxPerWeek: 1,
  maxPerMonth: 4,
  testRecipients: [],
  replyTo: "",
  channels: [],
};

const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const customerMailChannelSchema = z
  .object({
    salesChannelId: z.string().trim().min(1).max(64),
    name: z.string().trim().max(200),
    kind: z.enum(["shop", "portal"]),
    language: z.string().trim().min(2).max(10),
    enabled: z.boolean(),
    senderId: z.number().int().positive().nullable(),
  })
  .strict();

export const customerMailSettingsSchema = z
  .object({
    enabled: z.boolean(),
    existingCustomerSince: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    maxPerWeek: z.number().int().min(0).max(7),
    maxPerMonth: z.number().int().min(0).max(31),
    testRecipients: z.array(emailSchema).max(20),
    replyTo: z.union([emailSchema, z.literal("")]),
    channels: z.array(customerMailChannelSchema).max(50),
    /** Brevo-API-Schlüssel: undefined = unverändert, "" = löschen */
    apiKey: z.string().trim().max(200),
  })
  .partial()
  .strict();
export type CustomerMailSettingsUpdate = z.infer<typeof customerMailSettingsSchema>;

export function normalizeCustomerMailSettings(raw: unknown): CustomerMailSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const { apiKey: _ignored, ...rest } = r;
  const parsed = customerMailSettingsSchema.omit({ apiKey: true }).safeParse(
    Object.fromEntries(Object.entries(rest).filter(([k]) => k in DEFAULT_CUSTOMER_MAIL_SETTINGS)),
  );
  return { ...DEFAULT_CUSTOMER_MAIL_SETTINGS, ...(parsed.success ? parsed.data : {}) } as CustomerMailSettings;
}

export const customerMailConsentSchema = z
  .object({
    email: emailSchema,
    source: z.enum(["crm", "manual"]),
    /** z. B. Gesprächspartner und Anlass; Pflicht, damit die Einwilligung nachweisbar bleibt */
    note: z.string().trim().min(3).max(500),
    at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export const customerMailObjectionSchema = z
  .object({
    email: emailSchema,
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const customerMailTestRunSchema = z
  .object({
    templateId: z.number().int().positive(),
    senderId: z.number().int().positive(),
    subject: z.string().trim().min(1).max(200),
  })
  .strict();

export type CustomerMailContact = {
  email: string;
  customerNumber: string | null;
  company: string | null;
  contactName: string | null;
  salesChannelId: string | null;
  channelKind: CustomerMailChannelKind | null;
  language: string;
  orderCount: number;
  lastOrderAt: string | null;
  basis: CustomerMailBasis;
  consentAt: string | null;
  consentSource: CustomerMailConsentSource | null;
  consentNote: string | null;
  objectionAt: string | null;
  objectionSource: CustomerMailObjectionSource | null;
  bouncedAt: string | null;
  newsletterStatus: string | null;
  brevoBlocklisted: boolean;
};

export type CustomerMailCounts = Record<CustomerMailBasis, number> & { total: number; bounced: number; newsletterUnconfirmed: number };

export type CustomerMailRun = {
  id: string;
  mailType: CustomerMailType;
  status: CustomerMailRunStatus;
  subject: string;
  templateId: number | null;
  senderId: number | null;
  plannedCount: number;
  skippedCount: number;
  sentCount: number;
  brevoListId: number | null;
  brevoCampaignId: number | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  sentBy: string | null;
  sentAt: string | null;
};

export type CustomerMailRunRecipient = {
  email: string;
  customerNumber: string | null;
  basis: CustomerMailBasis | "test";
  status: "planned" | "skipped" | "sent";
  skipReason: CustomerMailSkipReason | null;
};

export type CustomerMailRunDetail = CustomerMailRun & { recipients: CustomerMailRunRecipient[] };

export type CustomerMailState = {
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastSyncStats: {
    mirror: number;
    newsletter: number;
    brevoBlocked: number;
    upserted: number;
    pushedObjections: number;
    /** Gründe der Brevo-Sperre in diesem Abgleich nachgelesen / noch offen / davon echte Abmeldungen */
    blockReasonsChecked?: number;
    blockReasonsOpen?: number;
    brevoUnsubscribes?: number;
  } | null;
  /** Brevo-Kontakte bis hierhin abgeglichen (modifiedSince) */
  brevoModifiedSince: string | null;
  brevoFolderId: number | null;
  webhookId: number | null;
};

/** Antwort von GET /api/customer-mails */
export type CustomerMailOverview = {
  settings: CustomerMailSettings;
  hasKey: boolean;
  hasWebhook: boolean;
  webhookUrl: string | null;
  state: CustomerMailState;
  counts: CustomerMailCounts;
  /** Verkaufskanäle mit Bestellungen im Spiegel (Vorschlag für die Kanal-Liste) */
  knownChannels: Array<{ salesChannelId: string; name: string; kind: CustomerMailChannelKind }>;
  runs: CustomerMailRun[];
};

/** Antwort von GET /api/customer-mails/brevo */
export type CustomerMailBrevoInfo = {
  account: { email: string; companyName: string; plans: string[] } | null;
  senders: Array<{ id: number; name: string; email: string; active: boolean }>;
  templates: Array<{ id: number; name: string; subject: string }>;
  error: string | null;
};

/** Antwort von GET /api/customer-mails/contact-status (CRM-Kundendetail) */
export type CustomerMailContactStatus = {
  email: string;
  known: boolean;
  basis: CustomerMailBasis;
  consentAt: string | null;
  consentSource: CustomerMailConsentSource | null;
  objectionAt: string | null;
  objectionSource: CustomerMailObjectionSource | null;
  bouncedAt: string | null;
};
