/**
 * Portal-Registrierungen: Anmeldungen für das Händlerportal kommen per Mail (von Kollegen
 * weitergeleitet) in ein eigenes Postfach. n8n holt sie ab (METAorder darf M365 nicht direkt
 * anbinden) und schickt sie an METAorder. METAorder liest Firma, Kundennummer und Ansprechpartner
 * aus, sucht den Kunden im Portal und
 *  - legt bei einem sicheren Treffer den Admin-Mitarbeiter an (bzw. aktualisiert ihn), setzt den
 *    Expertenmodus, wenn die Mail ihn nennt, löst die Passwort-Mail aus und informiert den
 *    zuständigen Außendienst;
 *  - legt keinen Kunden an, wenn er im Portal fehlt, sondern bittet das Kundenstamm-Team per Mail
 *    um Prüfung. Sobald der Kunde im Portal steht, prüft METAorder die Anmeldung erneut.
 * Ausgehende Mails verschickt ebenfalls n8n (Postausgang, siehe PortalRegistrationOutboxMail).
 */
import { z } from "zod";

export const PORTAL_REGISTRATION_SETTING_KEY = "portal_registration_settings";

export const portalRegistrationSettingsSchema = z.object({
  /** Aus: der Workflow holt keine Mails und verschickt nichts */
  enabled: z.boolean(),
  /** Postfach mit den Anmeldungen (z. B. registrierung@…); leer = Postfach des n8n-Outlook-Zugangs */
  mailbox: z.string().trim().max(254),
  /** Unterordner des Posteingangs für erledigte Mails */
  processedFolderName: z.string().trim().min(1).max(120),
  maxPerRun: z.number().int().min(1).max(50),
  /** Nur Mails ab diesem Tag (JJJJ-MM-TT); leer = die letzten 2 Tage */
  processSince: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  /**
   * Sichere Treffer ohne Prüfung ausführen (Mitarbeiter anlegen, Passwort-Mail, Außendienst).
   * Aus: jede Anmeldung wartet in METAorder auf „Ausführen“.
   */
  autoExecute: z.boolean(),
  /** Kundenstamm-Team: bekommt Anmeldungen, deren Kunde im Portal fehlt */
  masterDataEmail: z.string().trim().max(254),
  /** Zuständigen Außendienst (laut Zuordnungsliste) nach erfolgreicher Registrierung informieren */
  notifySalesRep: z.boolean(),
  /** Den Kollegen, der die Anmeldung weitergeleitet hat, bei beiden Mails in CC setzen */
  ccForwarder: z.boolean(),
  /** Stammdaten des Kunden aus der Anmeldung: nur leere Felder ergänzen oder nie anfassen */
  customerUpdate: z.enum(["fill_empty", "none"]),
  /** Wartende Anmeldungen (beim Kundenstamm) alle n Stunden neu prüfen; 0 = nur von Hand */
  recheckHours: z.number().int().min(0).max(168),
  /** Portal-Adresse für den Link in der Passwort-Mail; leer = Standard-Portal */
  storefrontUrl: z.union([z.literal(""), z.string().trim().max(300).url()]),
});

export type PortalRegistrationSettings = z.infer<typeof portalRegistrationSettingsSchema>;

export const DEFAULT_PORTAL_REGISTRATION_SETTINGS: PortalRegistrationSettings = {
  // Aus, bis Postfach, Kundenstamm-Adresse und Startdatum eingetragen sind
  enabled: false,
  mailbox: "",
  processedFolderName: "METAorder Registrierungen",
  maxPerRun: 10,
  processSince: "",
  autoExecute: false,
  masterDataEmail: "",
  notifySalesRep: true,
  ccForwarder: true,
  customerUpdate: "fill_empty",
  recheckHours: 4,
  storefrontUrl: "",
};

/** Gespeicherten Wert mit Standardwerten auffüllen; Unbrauchbares fällt auf den Standard zurück. */
export function normalizePortalRegistrationSettings(stored: unknown): PortalRegistrationSettings {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const out: PortalRegistrationSettings = { ...DEFAULT_PORTAL_REGISTRATION_SETTINGS };
  for (const key of Object.keys(DEFAULT_PORTAL_REGISTRATION_SETTINGS) as Array<keyof PortalRegistrationSettings>) {
    if (!(key in raw)) continue;
    const field = portalRegistrationSettingsSchema.shape[key].safeParse(raw[key]);
    if (field.success) (out as Record<string, unknown>)[key] = field.data;
  }
  return out;
}

/** Outlook-Kategorien, die n8n an die Mail hängt */
export const PORTAL_REGISTRATION_CATEGORIES = {
  done: "METAorder: Registrierung",
  review: "METAorder: Registrierung prüfen",
  masterData: "METAorder: an Kundenstamm",
  notRegistration: "METAorder: keine Registrierung",
  failed: "METAorder: Fehler",
} as const;

export const PORTAL_REGISTRATION_STATUSES = [
  /** Mail wird gerade ausgewertet */
  "processing",
  /** Bearbeiter muss entscheiden (unsicherer Treffer, Konflikt, Daten fehlen) */
  "review",
  /** Sicherer Treffer, Plan steht – wartet auf „Ausführen“ */
  "ready",
  /** Mitarbeiter angelegt/aktualisiert, Passwort-Mail ausgelöst */
  "completed",
  /** Kunde fehlt im Portal: Kundenstamm wurde gebeten zu prüfen */
  "waiting_master_data",
  /** Ausführung gescheitert (Shopware-Fehler) */
  "failed",
  /** Keine Registrierung bzw. vom Bearbeiter verworfen */
  "discarded",
] as const;
export type PortalRegistrationStatus = (typeof PORTAL_REGISTRATION_STATUSES)[number];

export type PortalRegistrationSalutation = "mr" | "mrs" | null;

/** Aus der Mail gelesene Anmeldedaten (Bearbeiter kann sie korrigieren) */
export const portalRegistrationDataSchema = z.object({
  company: z.string().trim().max(255).nullable(),
  customerNumber: z.string().trim().max(40).nullable(),
  vatId: z.string().trim().max(40).nullable(),
  street: z.string().trim().max(255).nullable(),
  zipCode: z.string().trim().max(20).nullable(),
  city: z.string().trim().max(120).nullable(),
  /** ISO-Code (DE, AT, …) oder Name */
  country: z.string().trim().max(60).nullable(),
  phone: z.string().trim().max(60).nullable(),
  contact: z.object({
    salutation: z.enum(["mr", "mrs"]).nullable(),
    firstName: z.string().trim().max(120).nullable(),
    lastName: z.string().trim().max(120).nullable(),
    email: z.string().trim().max(254).nullable(),
    phone: z.string().trim().max(60).nullable(),
  }),
  /** Regalplaner-Expertenmodus für den Admin-Mitarbeiter; null = in der Mail nicht erwähnt */
  expertMode: z.boolean().nullable(),
  /** Regalplaner-Adminmodus; null = nicht erwähnt */
  adminMode: z.boolean().nullable(),
  /** Sonstige Hinweise aus der Mail (Wünsche, Rückfragen) */
  notes: z.string().trim().max(2000).nullable(),
});
export type PortalRegistrationData = z.infer<typeof portalRegistrationDataSchema>;

export type PortalRegistrationExtraction = {
  data: PortalRegistrationData;
  /** Ist das überhaupt eine Anmeldung fürs Portal? */
  isRegistration: boolean;
  /** 0–1 */
  confidence: number;
  source: "ai" | "rules";
  /** Begründung bzw. was unklar ist */
  reason: string | null;
};

export const EMPTY_PORTAL_REGISTRATION_DATA: PortalRegistrationData = {
  company: null,
  customerNumber: null,
  vatId: null,
  street: null,
  zipCode: null,
  city: null,
  country: null,
  phone: null,
  contact: { salutation: null, firstName: null, lastName: null, email: null, phone: null },
  expertMode: null,
  adminMode: null,
  notes: null,
};

/** Ein Kunde im Shop, wie die Registrierung ihn braucht */
export type PortalCustomerSnapshot = {
  id: string;
  customerNumber: string | null;
  company: string | null;
  email: string | null;
  active: boolean;
  salesChannelId: string | null;
  salesChannelName: string | null;
  /** Kanal ist ein Händlerportal */
  isPortal: boolean;
  vatIds: string[];
  address: {
    id: string | null;
    street: string | null;
    zipCode: string | null;
    city: string | null;
    countryIso: string | null;
    phone: string | null;
  };
  /** b2b_platform_access am Kunden (null = nicht gesetzt) */
  platformAccess: boolean | null;
  /** Interner META-Zugang (Außendienst/Supervisor): nie als Händler behandeln */
  salesRepresentative: boolean;
};

export type PortalRegistrationMatchMethod =
  | "customer_number"
  | "employee_email"
  | "customer_email"
  | "vat_id"
  | "company_zip"
  | "company_name"
  | "email_domain"
  | "manual";

export type PortalRegistrationCandidate = {
  customer: PortalCustomerSnapshot;
  score: number;
  methods: PortalRegistrationMatchMethod[];
  /** Kurze Begründungen für die Anzeige */
  reasons: string[];
};

export type PortalRegistrationMatch = {
  /** matched = ein sicherer Portal-Kunde; ambiguous = Bearbeiter wählt; not_found = nicht im Portal */
  status: "matched" | "ambiguous" | "not_found";
  customerId: string | null;
  method: PortalRegistrationMatchMethod | null;
  confidence: number;
  candidates: PortalRegistrationCandidate[];
  /** Konten im Onlineshop (nicht Portal) – nur als Hinweis für den Kundenstamm */
  shopAccounts: Array<Pick<PortalCustomerSnapshot, "id" | "customerNumber" | "company" | "salesChannelName">>;
  /** Warum unsicher (Codes, siehe PORTAL_REGISTRATION_MATCH_NOTES) */
  notes: string[];
  checkedAt: string;
};

export const PORTAL_REGISTRATION_MATCH_NOTES = {
  numberCompanyMismatch: "number_company_mismatch",
  severalPortalAccounts: "several_portal_accounts",
  closeCandidates: "close_candidates",
  numberNotFound: "number_not_found",
  salesRepAccount: "sales_rep_account",
} as const;

/** Eine geplante Änderung am Shop-Kunden (Bearbeiter kann einzelne abwählen) */
export type PortalCustomerChange = {
  field: "active" | "platformAccess" | "vatId" | "phone";
  from: string | null;
  to: string;
  apply: boolean;
};

export type PortalRegistrationBlocker =
  | "missing_email"
  | "missing_name"
  | "internal_email"
  | "employee_other_customer"
  | "no_customer"
  | "no_sales_channel";

/** Was „Ausführen“ im Shop tut */
export type PortalRegistrationPlan = {
  customerId: string;
  customerNumber: string | null;
  company: string | null;
  salesChannelId: string | null;
  employee: {
    action: "create" | "update";
    existingId: string | null;
    email: string;
    firstName: string;
    lastName: string;
    salutation: PortalRegistrationSalutation;
    phone: string | null;
    /** true = Expertenmodus einschalten; null = nicht anfassen */
    expertMode: boolean | null;
    adminMode: boolean | null;
  };
  /** Verknüpfung Mitarbeiter↔Kunde mit Admin-Recht (anlegen bzw. Admin/Aktiv nachziehen) */
  link: { action: "create" | "update" | "none" };
  customerChanges: PortalCustomerChange[];
  sendPasswordReset: boolean;
  blockers: PortalRegistrationBlocker[];
};

export type PortalRegistrationEventType =
  | "received"
  | "extracted"
  | "matched"
  | "review_needed"
  | "master_data_requested"
  | "employee_created"
  | "employee_updated"
  | "customer_updated"
  | "password_reset_sent"
  | "password_reset_failed"
  | "sales_rep_notified"
  | "sales_rep_missing"
  | "mail_sent"
  | "mail_failed"
  | "rechecked"
  | "executed"
  | "failed"
  | "discarded"
  | "edited";

export type PortalRegistrationEvent = {
  at: string;
  type: PortalRegistrationEventType;
  /** Deutscher Kurztext fürs Protokoll (Mail-/Shop-Begriffe) */
  message: string;
  userName?: string | null;
};

/** Mail, die n8n verschickt (Graph sendMail aus dem Registrierungs-Postfach) */
export type PortalRegistrationOutboxKind = "master_data_request" | "sales_rep_info";

export type PortalRegistrationOutboxMail = {
  id: string;
  kind: PortalRegistrationOutboxKind;
  /** Graph-Basis: /me oder /users/{postfach} */
  graphBase: string;
  /** Fertige Graph-Nachricht für POST {graphBase}/sendMail ({ message, saveToSentItems: true }) */
  message: Record<string, unknown>;
};

/** Konfiguration, die n8n zu Beginn jedes Laufs abruft */
export type PortalRegistrationWorkflowConfig = {
  enabled: boolean;
  ready: boolean;
  notReadyReason: string | null;
  graphBase: string;
  mailbox: string | null;
  processedFolderName: string;
  maxPerRun: number;
  receivedAfter: string;
  /** Graph-$filter: ab receivedAfter und ohne METAorder-Registrierungs-Kategorie */
  messageFilter: string;
  categories: typeof PORTAL_REGISTRATION_CATEGORIES;
};

/** Antwort auf den Upload einer Mail */
export type PortalRegistrationIntakeResponse = {
  outcome: "completed" | "ready" | "review" | "waiting_master_data" | "not_registration" | "duplicate" | "failed";
  registrationId: string | null;
  categories: string[];
  /** In den Erledigt-Ordner verschieben */
  move: boolean;
};

export function portalRegistrationMessageFilter(receivedAfter: string): string {
  const notCategorized = Object.values(PORTAL_REGISTRATION_CATEGORIES)
    .map((c) => `not(categories/any(c:c eq '${c.replace(/'/g, "''")}'))`)
    .join(" and ");
  return `receivedDateTime ge ${receivedAfter} and ${notCategorized}`;
}

/** Zeile der Außendienst-Zuordnung (Kundennummer → META-Außendienst) */
export type SalesRepAssignment = {
  customerNumber: string;
  repName: string;
  repEmail: string;
  updatedAt?: string;
};

/** Listenansicht einer Registrierung */
export type PortalRegistrationListItem = {
  id: string;
  status: PortalRegistrationStatus;
  receivedAt: string;
  subject: string;
  fromEmail: string | null;
  forwardedBy: string | null;
  company: string | null;
  customerNumber: string | null;
  contactName: string | null;
  contactEmail: string | null;
  expertMode: boolean | null;
  matchStatus: PortalRegistrationMatch["status"] | null;
  matchedCustomerNumber: string | null;
  confidence: number | null;
  updatedAt: string;
};
