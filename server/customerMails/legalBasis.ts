/**
 * Kundenmails B1: reine Regeln ohne Datenbank (Tests in tests/unit/customerMails.test.ts).
 *
 * - Rechtsgrundlage je Kontakt: Widerspruch schlägt alles; dann Einwilligung; dann Bestandskunde, aber nur mit einer
 *   Bestellung ab dem Stichtag des Hinweises (vorher wurde beim Erheben der Adresse nicht auf Werbung hingewiesen).
 * - Kontaktbremse: gesendete Werbemails der letzten 7 bzw. 30 Tage je Empfänger.
 * - Empfängerplanung einer Aussendung: Rechtsgrundlage der Mailart, Bounce, Kanal, Bremse, doppelte Adressen.
 * - Abgleich: Kaufdaten aus dem Spiegel + Newsletter-Empfänger aus Shopware + Brevo-Sperrkennzeichen -> Kontaktzeilen.
 * - Grund einer Brevo-Sperre: nur Abmeldelink und Spam-Meldung sind ein Widerspruch (brevoBlockEffect).
 */
import {
  CUSTOMER_MAIL_TYPE_RULES,
  type CustomerMailBasis,
  type CustomerMailChannel,
  type CustomerMailConsentSource,
  type CustomerMailObjectionSource,
  type CustomerMailSettings,
  type CustomerMailSkipReason,
  type CustomerMailType,
} from "@shared/customerMails";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ContactFacts = {
  email: string;
  lastOrderAt: Date | null;
  consentAt: Date | null;
  objectionAt: Date | null;
  bouncedAt: Date | null;
};

/**
 * Stichtag (YYYY-MM-DD) als Zeitpunkt 00:00 UTC. Das ist 01:00 bzw. 02:00 Uhr Berliner Zeit, also bewusst etwas
 * später als Mitternacht: Eine Bestellung kurz vor dem Stichtag zählt so sicher nicht mit.
 */
export function cutoffDate(since: string | null): Date | null {
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return null;
  const d = new Date(`${since}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function basisOf(c: ContactFacts, existingCustomerSince: string | null): CustomerMailBasis {
  if (c.objectionAt) return "objected";
  if (c.consentAt) return "consent";
  const cutoff = cutoffDate(existingCustomerSince);
  if (cutoff && c.lastOrderAt && c.lastOrderAt.getTime() >= cutoff.getTime()) return "existingCustomer";
  return "none";
}

export const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

export function normalizeEmail(raw: unknown): string | null {
  const e = String(raw ?? "")
    .trim()
    .toLowerCase();
  return e && e.length <= 254 && EMAIL_PATTERN.test(e) ? e : null;
}

/** Kontaktbremse: true = darf noch eine Werbemail bekommen */
export function frequencyOk(sentAdvertising: Date[], now: Date, maxPerWeek: number, maxPerMonth: number): boolean {
  const week = sentAdvertising.filter((d) => now.getTime() - d.getTime() < 7 * DAY_MS).length;
  const month = sentAdvertising.filter((d) => now.getTime() - d.getTime() < 30 * DAY_MS).length;
  return week < maxPerWeek && month < maxPerMonth;
}

export type PlanCandidate = {
  email: string;
  customerNumber?: string | null;
  salesChannelId?: string | null;
  attributes?: Record<string, string | number | null>;
  /** Ausschluss der Mailart selbst (z. B. offene Reklamation); schlägt alles außer Widerspruch */
  skipReason?: CustomerMailSkipReason | null;
};
export type PlannedRecipient = {
  email: string;
  customerNumber: string | null;
  basis: CustomerMailBasis | "test";
  status: "planned" | "skipped";
  skipReason: CustomerMailSkipReason | null;
  attributes: Record<string, string | number | null>;
};

/**
 * Empfänger einer Aussendung festlegen. contacts: bekannte Kontakte je E-Mail; sentAdvertising: Zeitpunkte
 * gesendeter Werbemails je E-Mail (für die Bremse, auch die im selben Lauf schon geplanten zählen nicht doppelt,
 * weil jede Adresse nur einmal vorkommt).
 */
export function planRecipients(
  mailType: CustomerMailType,
  candidates: PlanCandidate[],
  contacts: Map<string, ContactFacts & { customerNumber?: string | null; salesChannelId?: string | null; brevoBlocklisted?: boolean }>,
  sentAdvertising: Map<string, Date[]>,
  settings: Pick<CustomerMailSettings, "existingCustomerSince" | "maxPerWeek" | "maxPerMonth" | "channels" | "testRecipients">,
  now: Date,
): PlannedRecipient[] {
  const rule = CUSTOMER_MAIL_TYPE_RULES[mailType];
  const seen = new Set<string>();
  const enabledChannels = new Map<string, CustomerMailChannel>(settings.channels.map((c) => [c.salesChannelId, c]));
  const tests = new Set(settings.testRecipients.map((e) => e.toLowerCase()));
  const out: PlannedRecipient[] = [];
  for (const cand of candidates) {
    const email = normalizeEmail(cand.email);
    const base = { customerNumber: cand.customerNumber ?? null, attributes: cand.attributes ?? {} };
    if (!email) {
      out.push({ email: String(cand.email ?? "").slice(0, 254), ...base, basis: "none", status: "skipped", skipReason: "invalidEmail" });
      continue;
    }
    if (seen.has(email)) {
      out.push({ email, ...base, basis: "none", status: "skipped", skipReason: "duplicate" });
      continue;
    }
    seen.add(email);
    const contact = contacts.get(email);
    if (mailType === "test") {
      // Testaussendungen nur an die internen Testadressen, ein Widerspruch gilt trotzdem
      if (!tests.has(email)) out.push({ email, ...base, basis: "none", status: "skipped", skipReason: "noBasis" });
      else if (contact?.objectionAt) out.push({ email, ...base, basis: "objected", status: "skipped", skipReason: "objected" });
      else out.push({ email, ...base, basis: "test", status: "planned", skipReason: null });
      continue;
    }
    const basis = contact ? basisOf(contact, settings.existingCustomerSince) : "none";
    const channelId = cand.salesChannelId ?? contact?.salesChannelId ?? null;
    let skipReason: CustomerMailSkipReason | null = null;
    if (basis === "objected") skipReason = "objected";
    else if (cand.skipReason) skipReason = cand.skipReason;
    else if (contact?.bouncedAt) skipReason = "bounced";
    // In Brevo gesperrt (meist vom Shop-Plugin, weil kein Newsletter): Brevo würde die Mail stillschweigend
    // auslassen. Entsperren gehört bewusst in den jeweiligen Baustein (B2 ff.), nicht hierher.
    else if (contact?.brevoBlocklisted) skipReason = "brevoBlocked";
    else if (!rule.bases.includes(basis)) skipReason = "noBasis";
    else if (channelId && enabledChannels.size > 0 && enabledChannels.get(channelId)?.enabled !== true) skipReason = "channelOff";
    else if (rule.advertising && !frequencyOk(sentAdvertising.get(email) ?? [], now, settings.maxPerWeek, settings.maxPerMonth)) skipReason = "frequency";
    out.push({ email, ...base, customerNumber: base.customerNumber ?? contact?.customerNumber ?? null, basis, status: skipReason ? "skipped" : "planned", skipReason });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Abgleich

export type MirrorCustomer = {
  email: string;
  customerNumber: string | null;
  company: string | null;
  contactName: string | null;
  salesChannelId: string | null;
  salesChannelName: string | null;
  orderCount: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  lastOrderNumber: string;
};

export type MirrorOrder = {
  orderNumber: string;
  email: string;
  customerNumber: string;
  company: string;
  contactName: string;
  salesChannelId: string | null;
  salesChannelName: string | null;
  status: string | null;
  createdAt: Date;
};

/** Shop- und Portal-Bestellungen (nur MO, ohne Storno und durchgeschleuste) je E-Mail zusammenfassen */
export function summarizeMirrorOrders(orders: MirrorOrder[], isPassthrough: (o: MirrorOrder) => boolean): Map<string, MirrorCustomer> {
  const out = new Map<string, MirrorCustomer>();
  for (const o of [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!/^MO/i.test(o.orderNumber) || o.status === "cancelled" || isPassthrough(o)) continue;
    const email = normalizeEmail(o.email);
    if (!email) continue;
    const prev = out.get(email);
    const blank = (s: string) => (s.trim() ? s.trim() : null);
    out.set(email, {
      email,
      // jüngste Bestellung bestimmt Kunde, Firma und Kanal
      customerNumber: blank(o.customerNumber) ?? prev?.customerNumber ?? null,
      company: blank(o.company) ?? prev?.company ?? null,
      contactName: blank(o.contactName) ?? prev?.contactName ?? null,
      salesChannelId: o.salesChannelId ?? prev?.salesChannelId ?? null,
      salesChannelName: o.salesChannelName ?? prev?.salesChannelName ?? null,
      orderCount: (prev?.orderCount ?? 0) + 1,
      firstOrderAt: prev?.firstOrderAt ?? o.createdAt,
      lastOrderAt: o.createdAt,
      lastOrderNumber: o.orderNumber,
    });
  }
  return out;
}

export type NewsletterRecipient = { id: string; email: string; status: string; confirmedAt: Date | null; updatedAt: Date | null };

/** Bestätigte Anmeldung = Einwilligung; „direct“ (ohne Double-Opt-in angelegt) zählt bewusst nicht */
export function newsletterConsentAt(r: NewsletterRecipient): Date | null {
  return r.status === "optIn" && r.confirmedAt ? r.confirmedAt : null;
}

export type ContactRowState = {
  email: string;
  customerNumber: string | null;
  company: string | null;
  contactName: string | null;
  salesChannelId: string | null;
  salesChannelName: string | null;
  orderCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  lastOrderNumber: string | null;
  consentAt: Date | null;
  consentSource: CustomerMailConsentSource | null;
  consentNote: string | null;
  objectionAt: Date | null;
  objectionSource: CustomerMailObjectionSource | null;
  objectionNote: string | null;
  newsletterRecipientId: string | null;
  newsletterStatus: string | null;
  shopOptOutPending: boolean;
  brevoBlocklisted: boolean;
};

const emptyRow = (email: string): ContactRowState => ({
  email,
  customerNumber: null,
  company: null,
  contactName: null,
  salesChannelId: null,
  salesChannelName: null,
  orderCount: 0,
  firstOrderAt: null,
  lastOrderAt: null,
  lastOrderNumber: null,
  consentAt: null,
  consentSource: null,
  consentNote: null,
  objectionAt: null,
  objectionSource: null,
  objectionNote: null,
  newsletterRecipientId: null,
  newsletterStatus: null,
  shopOptOutPending: false,
  brevoBlocklisted: false,
});

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Neuer Stand je Kontakt aus den drei Quellen. Erfasste Einwilligungen (crm/manual) und Widersprüche bleiben
 * erhalten; ein Widerspruch wird nie durch eine spätere Quelle aufgehoben. Liefert nur geänderte bzw. neue Zeilen.
 */
export function mergeContacts(
  existing: Map<string, ContactRowState>,
  mirror: Map<string, MirrorCustomer>,
  newsletter: NewsletterRecipient[],
  brevoBlocked: Map<string, Date>,
  now: Date,
): { changed: ContactRowState[]; newObjections: string[] } {
  const next = new Map<string, ContactRowState>();
  const get = (email: string) => {
    let row = next.get(email);
    if (!row) {
      const prev = existing.get(email);
      row = prev ? { ...prev } : emptyRow(email);
      next.set(email, row);
    }
    return row;
  };
  const newObjections: string[] = [];
  const object = (row: ContactRowState, at: Date, source: CustomerMailObjectionSource) => {
    if (row.objectionAt) return;
    row.objectionAt = at;
    row.objectionSource = source;
    newObjections.push(row.email);
  };

  for (const m of Array.from(mirror.values())) {
    const row = get(m.email);
    row.customerNumber = m.customerNumber ?? row.customerNumber;
    row.company = m.company ?? row.company;
    row.contactName = m.contactName ?? row.contactName;
    row.salesChannelId = m.salesChannelId ?? row.salesChannelId;
    row.salesChannelName = m.salesChannelName ?? row.salesChannelName;
    row.orderCount = m.orderCount;
    row.firstOrderAt = m.firstOrderAt;
    row.lastOrderAt = m.lastOrderAt;
    row.lastOrderNumber = m.lastOrderNumber;
  }

  for (const r of newsletter) {
    const email = normalizeEmail(r.email);
    if (!email) continue;
    const row = get(email);
    row.newsletterRecipientId = r.id;
    row.newsletterStatus = r.status;
    const consentAt = newsletterConsentAt(r);
    if (r.status === "optOut") {
      // Abmeldung vom Newsletter = Widerruf der Einwilligung und Widerspruch gegen Werbung (der Widerspruch schlägt
      // die alte Einwilligung, deshalb bleibt sie als Nachweis stehen)
      object(row, r.updatedAt ?? now, "shopNewsletterOptOut");
      row.shopOptOutPending = false;
    } else if (consentAt && !row.consentAt) {
      row.consentAt = consentAt;
      row.consentSource = "shopNewsletter";
    }
  }

  // In Brevo gesperrt heißt nicht „widersprochen“: Das Shop-Plugin sperrt jeden ohne Newsletter-Anmeldung. Der Grund
  // wird je Kontakt nachgelesen (brevoBlockEffect); hier nur das Kennzeichen.
  for (const email of Array.from(brevoBlocked.keys())) {
    const row = get(email);
    row.brevoBlocklisted = true;
  }

  const changed: ContactRowState[] = [];
  for (const row of Array.from(next.values())) {
    const prev = existing.get(row.email);
    if (
      !prev ||
      prev.customerNumber !== row.customerNumber ||
      prev.company !== row.company ||
      prev.contactName !== row.contactName ||
      prev.salesChannelId !== row.salesChannelId ||
      prev.salesChannelName !== row.salesChannelName ||
      prev.orderCount !== row.orderCount ||
      !sameTime(prev.firstOrderAt, row.firstOrderAt) ||
      !sameTime(prev.lastOrderAt, row.lastOrderAt) ||
      prev.lastOrderNumber !== row.lastOrderNumber ||
      !sameTime(prev.consentAt, row.consentAt) ||
      prev.consentSource !== row.consentSource ||
      !sameTime(prev.objectionAt, row.objectionAt) ||
      prev.objectionSource !== row.objectionSource ||
      prev.newsletterRecipientId !== row.newsletterRecipientId ||
      prev.newsletterStatus !== row.newsletterStatus ||
      prev.shopOptOutPending !== row.shopOptOutPending ||
      prev.brevoBlocklisted !== row.brevoBlocklisted
    )
      changed.push(row);
  }
  return { changed, newObjections };
}

// ---------------------------------------------------------------------------------------------
// Brevo-Webhook

export type BrevoEvent = { email: string; event: string; campaignId: number | null; url: string | null; occurredAt: Date; payload: Record<string, unknown> };

/** Marketing-Webhook (einzeln oder gebündelt als Liste); unbrauchbare Einträge fallen weg */
export function parseBrevoEvents(body: unknown, now: Date): BrevoEvent[] {
  const items = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
  const out: BrevoEvent[] = [];
  for (const raw of items.slice(0, 500)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const email = normalizeEmail(r.email);
    const event = String(r.event ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z_]/g, "")
      .slice(0, 40);
    if (!email || !event) continue;
    const ts = Number(r.ts_event ?? r.ts);
    const occurredAt = Number.isFinite(ts) && ts > 1e9 ? new Date(ts * 1000) : now;
    const campaignId = Number(r.camp_id);
    const url = typeof r.URL === "string" ? r.URL.slice(0, 1000) : typeof r.url === "string" ? r.url.slice(0, 1000) : null;
    out.push({ email, event, campaignId: Number.isInteger(campaignId) && campaignId > 0 ? campaignId : null, url, occurredAt, payload: r });
  }
  return out;
}

export type BrevoContactHistory = {
  emailBlacklisted: boolean;
  userUnsubscriptions: Date[];
  adminUnsubscriptions: Date[];
  complaints: Date[];
  hardBounces: Date[];
};

/**
 * Grund einer Brevo-Sperre (Live-Befund 20.10.2026: das Shop-Plugin sperrt alle Kunden ohne Newsletter-Anmeldung).
 * Widerspruch nur bei Abmeldung über den Link in einer Kampagne oder Spam-Meldung (jeweils der früheste Zeitpunkt).
 * Sperre durch Admin/Plugin ist kein Widerspruch, wird aber vermerkt (vor einem Entsperren von Hand prüfen).
 */
export function brevoBlockEffect(h: BrevoContactHistory): {
  objection: { source: "brevoUnsubscribe" | "brevoSpam"; at: Date } | null;
  bouncedAt: Date | null;
  adminBlocked: boolean;
} {
  const earliest = (ds: Date[]) => (ds.length ? new Date(Math.min(...ds.map((d) => d.getTime()))) : null);
  const unsub = earliest(h.userUnsubscriptions);
  const spam = earliest(h.complaints);
  const objection = unsub ? { source: "brevoUnsubscribe" as const, at: unsub } : spam ? { source: "brevoSpam" as const, at: spam } : null;
  return { objection, bouncedAt: earliest(h.hardBounces), adminBlocked: h.emailBlacklisted && !objection };
}

/** Ereignis -> Folge für den Kontakt */
export function eventEffect(event: string): "objection:brevoUnsubscribe" | "objection:brevoSpam" | "bounce" | null {
  if (event === "unsubscribe" || event === "unsubscribed") return "objection:brevoUnsubscribe";
  if (event === "spam") return "objection:brevoSpam";
  if (event === "hard_bounce" || event === "hardbounce") return "bounce";
  return null;
}

/** Brevo-Kontaktfelder für eine Aussendung (Basisfelder + Felder des Laufs, nur MO_…) */
export function brevoAttributes(
  contact: { company: string | null; contactName: string | null; customerNumber: string | null; salesChannelName: string | null; lastOrderAt: Date | null } | undefined,
  basis: CustomerMailBasis | "test",
  extra: Record<string, string | number | null>,
): Record<string, string | number | null> {
  const grund = basis === "consent" ? "einwilligung" : basis === "existingCustomer" ? "bestandskunde" : basis === "test" ? "test" : "";
  const attrs: Record<string, string | number | null> = {
    MO_FIRMA: contact?.company ?? "",
    MO_NAME: contact?.contactName ?? "",
    MO_KUNDENNR: contact?.customerNumber ?? "",
    MO_KANAL: contact?.salesChannelName ?? "",
    MO_GRUNDLAGE: grund,
    MO_LETZTE_BESTELLUNG: contact?.lastOrderAt ? contact.lastOrderAt.toISOString().slice(0, 10) : null,
  };
  for (const [k, v] of Object.entries(extra)) if (/^MO_[A-Z0-9_]{1,40}$/.test(k)) attrs[k] = v;
  return attrs;
}

export function channelKindOf(name: string | null | undefined): "shop" | "portal" {
  return /portal/i.test(name ?? "") ? "portal" : "shop";
}
