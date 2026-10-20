/**
 * Kundenmails B1: Einstellungen, Kontaktabgleich, Einwilligung/Widerspruch, Brevo-Webhook und Aussendungen
 * (mit Datenbank). Regeln ohne Datenbank: ./legalBasis.ts; Brevo-API: ./brevoClient.ts.
 *
 * Abgleich (stündlich, nur mit Schalter und Schlüssel): Kaufdaten aus dem Bestell-Spiegel (MO, ohne Storno und
 * durchgeschleuste), Newsletter-Empfänger aus Shopware, Brevo-Sperrliste (seit dem letzten Abgleich). Danach gehen
 * offene Widersprüche auf die Brevo-Sperrliste und als Newsletter-Abmeldung nach Shopware.
 *
 * Aussendung: Entwurf mit geplanten und ausgelassenen Empfängern -> „Senden“ prüft Widersprüche erneut, legt in
 * Brevo eine Liste im Ordner „METAorder“ an, importiert die Kontakte mit MO_-Feldern, erstellt die Kampagne mit der
 * gewählten Vorlage und verschickt sie sofort. Ein Lauf kann nur einmal von „Entwurf“ bzw. „Fehler“ in „Versand“.
 */
import { randomBytes, timingSafeEqual } from "crypto";
import { and, desc, eq, gte, inArray, isNull, sql, type AnyColumn } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../lib/logger";
import { decrypt, encrypt } from "../lib/encryption";
import type { IStorage } from "../storage";
import { shopApi, type ShopApi } from "../shopContent/shopProducts";
import { isPassthroughOrder } from "../shopPulse/regulars";
import {
  marketingContacts,
  marketingEvents,
  marketingMailRecipients,
  marketingMailRuns,
  shopwareOrders,
  type MarketingContactRow,
  type MarketingMailRunRow,
} from "@shared/schema";
import {
  CUSTOMER_MAIL_BASE_ATTRIBUTES,
  CUSTOMER_MAIL_TYPE_RULES,
  normalizeCustomerMailSettings,
  type CustomerMailBasis,
  type CustomerMailContact,
  type CustomerMailContactStatus,
  type CustomerMailCounts,
  type CustomerMailRun,
  type CustomerMailRunDetail,
  type CustomerMailSettings,
  type CustomerMailSettingsUpdate,
  type CustomerMailState,
  type CustomerMailType,
} from "@shared/customerMails";
import { brevoClient, brevoErrorText, type BrevoClient, type FetchLike } from "./brevoClient";
import {
  basisOf,
  brevoAttributes,
  brevoBlockEffect,
  channelKindOf,
  eventEffect,
  mergeContacts,
  normalizeEmail,
  parseBrevoEvents,
  planRecipients,
  summarizeMirrorOrders,
  type ContactRowState,
  type MirrorOrder,
  type NewsletterRecipient,
  type PlanCandidate,
} from "./legalBasis";

const log = logger.child({ component: "customerMails/customerMailsRun" });

export const CUSTOMER_MAIL_SETTINGS_KEY = "customer_mail_settings";
export const CUSTOMER_MAIL_STATE_KEY = "customer_mail_state";
export const CUSTOMER_MAIL_FOLDER_NAME = "METAorder";
/** Webhook-Ereignisse, die METAorder auswertet */
export const CUSTOMER_MAIL_WEBHOOK_EVENTS = ["unsubscribed", "spam", "hardBounce", "click"];

type Store = Pick<IStorage, "getSetting" | "saveSetting">;
const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));
/** Zeitpunkt für SQL-Ausdrücke als UTC (ein roher Date-Parameter würde in der Zeitzone des Servers geschrieben) */
const utc = (d: Date) => sql`${d.toISOString()}::timestamptz AT TIME ZONE 'UTC'`;

export type CustomerMailErrorReason = "keyMissing" | "disabled" | "runNotFound" | "notDraft" | "noRecipients" | "noTestRecipients" | "invalidEmail" | "customerSendingOff";

/** Fachlicher Fehler; die Routen übersetzen reason in einen festen Text (server/routes/customerMailRoutes.ts) */
export class CustomerMailError extends Error {
  constructor(readonly reason: CustomerMailErrorReason) {
    super(reason);
    this.name = "CustomerMailError";
  }
}

// ---------------------------------------------------------------------------------------------
// Einstellungen und Stand

type StoredSettings = CustomerMailSettings & { apiKey?: string; webhookToken?: string };

async function readStored(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<StoredSettings> {
  const raw = await store.getSetting(CUSTOMER_MAIL_SETTINGS_KEY, tenantId);
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    ...normalizeCustomerMailSettings(r),
    apiKey: typeof r.apiKey === "string" ? r.apiKey : undefined,
    webhookToken: typeof r.webhookToken === "string" ? r.webhookToken : undefined,
  };
}

const plainSecret = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    return decrypt(value) || null;
  } catch {
    return null;
  }
};

export async function getCustomerMailSettings(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<{ settings: CustomerMailSettings; hasKey: boolean; hasWebhookToken: boolean }> {
  const s = await readStored(store, tenantId);
  const { apiKey, webhookToken, ...settings } = s;
  return { settings: normalizeCustomerMailSettings(settings), hasKey: !!apiKey, hasWebhookToken: !!webhookToken };
}

export async function getBrevoApiKey(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<string | null> {
  return plainSecret((await readStored(store, tenantId)).apiKey);
}

/** Speichern; apiKey undefined = alten behalten, "" = löschen */
export async function saveCustomerMailSettings(store: Store, tenantId: string | null, update: CustomerMailSettingsUpdate): Promise<void> {
  const current = await readStored(store, tenantId);
  const { apiKey, ...rest } = update;
  const next: Record<string, unknown> = { ...current, ...normalizeCustomerMailSettings({ ...current, ...rest }) };
  if (apiKey !== undefined) next.apiKey = apiKey ? encrypt(apiKey) : "";
  if (!next.apiKey) delete next.apiKey;
  if (!next.webhookToken) delete next.webhookToken;
  await store.saveSetting(CUSTOMER_MAIL_SETTINGS_KEY, next, tenantId);
}

export async function getWebhookToken(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<string | null> {
  return plainSecret((await readStored(store, tenantId)).webhookToken);
}

async function rotateWebhookToken(store: Store, tenantId: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const current = await readStored(store, tenantId);
  await store.saveSetting(CUSTOMER_MAIL_SETTINGS_KEY, { ...current, webhookToken: encrypt(token) }, tenantId);
  return token;
}

/** Token aus dem Webhook-Kopf prüfen (zeitkonstant) */
export function webhookTokenOk(expected: string | null, given: unknown): boolean {
  if (!expected || typeof given !== "string" || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

const EMPTY_STATE: CustomerMailState = { lastSyncAt: null, lastSyncError: null, lastSyncStats: null, brevoModifiedSince: null, brevoFolderId: null, webhookId: null };

export async function getCustomerMailState(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<CustomerMailState> {
  const raw = await store.getSetting(CUSTOMER_MAIL_STATE_KEY, tenantId);
  return { ...EMPTY_STATE, ...(raw && typeof raw === "object" ? (raw as Partial<CustomerMailState>) : {}) };
}

async function patchState(store: Store, tenantId: string | null, patch: Partial<CustomerMailState>): Promise<CustomerMailState> {
  const next = { ...(await getCustomerMailState(store, tenantId)), ...patch };
  await store.saveSetting(CUSTOMER_MAIL_STATE_KEY, next, tenantId);
  return next;
}

// ---------------------------------------------------------------------------------------------
// Abhängigkeiten (für Tests austauschbar)

export type CustomerMailDeps = {
  storage: Pick<IStorage, "getSetting" | "saveSetting" | "getShopwareSettings">;
  brevo: (apiKey: string) => BrevoClient;
  shop: (tenantId: string | null) => Promise<ShopApi | null>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

export function customerMailDeps(storage: CustomerMailDeps["storage"], fetchImpl?: FetchLike): CustomerMailDeps {
  return {
    storage,
    brevo: (key) => brevoClient(key, fetchImpl),
    shop: async (tenantId) => {
      const settings = await storage.getShopwareSettings(tenantId);
      return settings ? shopApi(settings).api : null;
    },
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

async function brevoFor(deps: CustomerMailDeps, tenantId: string | null): Promise<BrevoClient> {
  const key = await getBrevoApiKey(deps.storage, tenantId);
  if (!key) throw new CustomerMailError("keyMissing");
  return deps.brevo(key);
}

// ---------------------------------------------------------------------------------------------
// Kontakte

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function rowState(r: MarketingContactRow): ContactRowState {
  return {
    email: r.email,
    customerNumber: r.customerNumber,
    company: r.company,
    contactName: r.contactName,
    salesChannelId: r.salesChannelId,
    salesChannelName: r.salesChannelName,
    orderCount: r.orderCount,
    firstOrderAt: r.firstOrderAt,
    lastOrderAt: r.lastOrderAt,
    lastOrderNumber: r.lastOrderNumber,
    consentAt: r.consentAt,
    consentSource: (r.consentSource as ContactRowState["consentSource"]) ?? null,
    consentNote: r.consentNote,
    objectionAt: r.objectionAt,
    objectionSource: (r.objectionSource as ContactRowState["objectionSource"]) ?? null,
    objectionNote: r.objectionNote,
    newsletterRecipientId: r.newsletterRecipientId,
    newsletterStatus: r.newsletterStatus,
    shopOptOutPending: r.shopOptOutPending,
    brevoBlocklisted: r.brevoBlocklisted,
  };
}

export function toContact(r: MarketingContactRow, settings: Pick<CustomerMailSettings, "existingCustomerSince" | "channels">): CustomerMailContact {
  const channel = settings.channels.find((c) => c.salesChannelId === r.salesChannelId);
  return {
    email: r.email,
    customerNumber: r.customerNumber,
    company: r.company,
    contactName: r.contactName,
    salesChannelId: r.salesChannelId,
    channelKind: r.salesChannelId ? (channel?.kind ?? channelKindOf(r.salesChannelName)) : null,
    language: r.language,
    orderCount: r.orderCount,
    lastOrderAt: iso(r.lastOrderAt),
    basis: basisOf(r, settings.existingCustomerSince),
    consentAt: iso(r.consentAt),
    consentSource: (r.consentSource as CustomerMailContact["consentSource"]) ?? null,
    consentNote: r.consentNote,
    objectionAt: iso(r.objectionAt),
    objectionSource: (r.objectionSource as CustomerMailContact["objectionSource"]) ?? null,
    bouncedAt: iso(r.bouncedAt),
    newsletterStatus: r.newsletterStatus,
    brevoBlocklisted: r.brevoBlocklisted,
  };
}

export async function loadContactRows(tenantId: string | null): Promise<MarketingContactRow[]> {
  return db.select().from(marketingContacts).where(tenantIs(marketingContacts.tenantId, tenantId));
}

export function countContacts(rows: MarketingContactRow[], existingCustomerSince: string | null): CustomerMailCounts {
  const counts: CustomerMailCounts = { total: rows.length, consent: 0, existingCustomer: 0, none: 0, objected: 0, bounced: 0, newsletterUnconfirmed: 0 };
  for (const r of rows) {
    counts[basisOf(r, existingCustomerSince)] += 1;
    if (r.bouncedAt) counts.bounced += 1;
    if (r.newsletterStatus && r.newsletterStatus !== "optIn" && r.newsletterStatus !== "optOut") counts.newsletterUnconfirmed += 1;
  }
  return counts;
}

/** Bestellungen aus dem Spiegel (je Nummer die zuletzt geänderte Zeile) */
export async function loadMirrorOrders(tenantId: string | null): Promise<MirrorOrder[]> {
  const p = shopwareOrders.payload;
  const rows = await db
    .select({
      orderNumber: shopwareOrders.orderNumber,
      salesChannelId: shopwareOrders.salesChannelId,
      swUpdatedAt: shopwareOrders.swUpdatedAt,
      createdAt: sql<string | null>`${p}->>'createdAt'`,
      status: sql<string | null>`${p}->>'status'`,
      customerNumber: sql<string | null>`${p}->>'customerNumber'`,
      company: sql<string | null>`${p}->'billingAddress'->>'company'`,
      contactName: sql<string | null>`${p}->>'customerName'`,
      customerEmail: sql<string | null>`${p}->>'customerEmail'`,
      salesChannelName: sql<string | null>`${p}->>'salesChannelName'`,
    })
    .from(shopwareOrders)
    .where(and(tenantIs(shopwareOrders.tenantId, tenantId), sql`${shopwareOrders.orderNumber} ILIKE 'MO%'`));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const n = String(r.orderNumber ?? "").trim();
    if (!n) continue;
    const prev = latest.get(n);
    if (!prev || (r.swUpdatedAt?.getTime() ?? 0) > (prev.swUpdatedAt?.getTime() ?? 0)) latest.set(n, r);
  }
  const out: MirrorOrder[] = [];
  for (const [orderNumber, r] of Array.from(latest.entries())) {
    const createdAt = r.createdAt ? new Date(r.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
    out.push({
      orderNumber,
      email: String(r.customerEmail ?? ""),
      customerNumber: String(r.customerNumber ?? ""),
      company: String(r.company ?? ""),
      contactName: String(r.contactName ?? ""),
      salesChannelId: r.salesChannelId ?? null,
      salesChannelName: r.salesChannelName ?? null,
      status: r.status ?? null,
      createdAt,
    });
  }
  return out;
}

/** Kanäle mit Bestellungen im Spiegel (Vorschlag für die Einstellungen) */
export async function knownChannels(tenantId: string | null): Promise<Array<{ salesChannelId: string; name: string; kind: "shop" | "portal" }>> {
  const p = shopwareOrders.payload;
  const rows = await db
    .selectDistinct({ salesChannelId: shopwareOrders.salesChannelId, name: sql<string | null>`${p}->>'salesChannelName'` })
    .from(shopwareOrders)
    .where(and(tenantIs(shopwareOrders.tenantId, tenantId), sql`${shopwareOrders.orderNumber} ILIKE 'MO%'`));
  const map = new Map<string, string>();
  for (const r of rows) if (r.salesChannelId && !map.has(r.salesChannelId)) map.set(r.salesChannelId, r.name ?? r.salesChannelId);
  return Array.from(map.entries())
    .map(([salesChannelId, name]) => ({ salesChannelId, name, kind: channelKindOf(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Newsletter-Empfänger aus Shopware (alle Kanäle, seitenweise) */
export async function loadNewsletterRecipients(api: ShopApi): Promise<NewsletterRecipient[]> {
  const out: NewsletterRecipient[] = [];
  for (let page = 1; page <= 200; page += 1) {
    const r = await api("POST", "search/newsletter-recipient", {
      page,
      limit: 500,
      "total-count-mode": 1,
      includes: { newsletter_recipient: ["id", "email", "status", "confirmedAt", "updatedAt", "createdAt"] },
    });
    const data: any[] = Array.isArray(r?.data) ? r.data : [];
    for (const d of data) {
      const date = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
      out.push({ id: String(d.id), email: String(d.email ?? ""), status: String(d.status ?? ""), confirmedAt: date(d.confirmedAt), updatedAt: date(d.updatedAt) ?? date(d.createdAt) });
    }
    const total = Number(r?.total ?? 0);
    if (data.length < 500 || out.length >= total) break;
  }
  return out;
}

async function upsertContactRows(tenantId: string | null, rows: ContactRowState[], now: Date): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => ({ tenantId, ...r, updatedAt: now }));
    await db
      .insert(marketingContacts)
      .values(chunk)
      .onConflictDoUpdate({
        target: [marketingContacts.tenantId, marketingContacts.email],
        set: {
          customerNumber: sql`excluded.customer_number`,
          company: sql`excluded.company`,
          contactName: sql`excluded.contact_name`,
          salesChannelId: sql`excluded.sales_channel_id`,
          salesChannelName: sql`excluded.sales_channel_name`,
          orderCount: sql`excluded.order_count`,
          firstOrderAt: sql`excluded.first_order_at`,
          lastOrderAt: sql`excluded.last_order_at`,
          lastOrderNumber: sql`excluded.last_order_number`,
          // eine parallel erfasste Einwilligung bleibt stehen; ein Widerspruch schlägt sie ohnehin
          consentAt: sql`COALESCE(excluded.consent_at, ${marketingContacts.consentAt})`,
          consentSource: sql`CASE WHEN excluded.consent_at IS NULL THEN ${marketingContacts.consentSource} ELSE excluded.consent_source END`,
          // ein Widerspruch wird nie zurückgenommen, auch nicht durch einen parallelen Abgleich
          objectionAt: sql`COALESCE(${marketingContacts.objectionAt}, excluded.objection_at)`,
          objectionSource: sql`COALESCE(${marketingContacts.objectionSource}, excluded.objection_source)`,
          newsletterRecipientId: sql`excluded.newsletter_recipient_id`,
          newsletterStatus: sql`excluded.newsletter_status`,
          shopOptOutPending: sql`excluded.shop_opt_out_pending`,
          brevoBlocklisted: sql`excluded.brevo_blocklisted OR ${marketingContacts.brevoBlocklisted}`,
          updatedAt: now,
        },
      });
  }
}

/** Kontakte aus Spiegel, Shopware und Brevo abgleichen und offene Widersprüche weitergeben */
export async function syncCustomerMailContacts(deps: CustomerMailDeps, tenantId: string | null): Promise<CustomerMailState> {
  const now = deps.now();
  const brevo = await brevoFor(deps, tenantId);
  const state = await getCustomerMailState(deps.storage, tenantId);
  try {
    const mirror = summarizeMirrorOrders(await loadMirrorOrders(tenantId), (o) => isPassthroughOrder({ contactName: o.contactName, customerEmail: o.email, company: o.company }));
    const api = await deps.shop(tenantId);
    const newsletter = api ? await loadNewsletterRecipients(api) : [];

    // Brevo-Sperrliste seit dem letzten Abgleich (beim ersten Mal alle Kontakte)
    const blocked = new Map<string, Date>();
    let maxModified = state.brevoModifiedSince;
    for (let offset = 0; offset < 500_000; offset += 1000) {
      const page = await brevo.contacts(offset, state.brevoModifiedSince);
      for (const c of page.contacts) {
        if (c.emailBlacklisted && normalizeEmail(c.email)) blocked.set(c.email, c.modifiedAt ? new Date(c.modifiedAt) : now);
        // als Zeitpunkt vergleichen: Brevo liefert Zeitstempel mit Zeitzonen-Versatz
        if (c.modifiedAt && !Number.isNaN(Date.parse(c.modifiedAt)) && (!maxModified || Date.parse(c.modifiedAt) > Date.parse(maxModified))) maxModified = c.modifiedAt;
      }
      if (page.contacts.length < 1000) break;
    }

    const existingRows = await loadContactRows(tenantId);
    const existing = new Map(existingRows.map((r) => [r.email, rowState(r)]));
    const { changed } = mergeContacts(existing, mirror, newsletter, blocked, now);
    await upsertContactRows(tenantId, changed, now);

    const blockChecks = await checkBrevoBlockReasons(deps, tenantId, brevo);
    const pushed = await pushPendingObjections(deps, tenantId, brevo, api);
    const stats = {
      mirror: mirror.size,
      newsletter: newsletter.length,
      brevoBlocked: blocked.size,
      upserted: changed.length,
      pushedObjections: pushed,
      blockReasonsChecked: blockChecks.checked,
      blockReasonsOpen: blockChecks.open,
      brevoUnsubscribes: blockChecks.objections,
    };
    log.info({ tenantId, ...stats }, "Kundenmails: Kontakte abgeglichen");
    return await patchState(deps.storage, tenantId, { lastSyncAt: now.toISOString(), lastSyncError: null, lastSyncStats: stats, brevoModifiedSince: maxModified });
  } catch (err) {
    log.error({ err, tenantId }, "Kundenmails: Abgleich fehlgeschlagen");
    await patchState(deps.storage, tenantId, { lastSyncAt: now.toISOString(), lastSyncError: brevoErrorText(err) });
    throw err;
  }
}

/** Gesperrte Kontakte, deren Grund je Abgleich nachgelesen wird (Brevo-API, nacheinander) */
export const BREVO_BLOCK_CHECKS_PER_SYNC = 300;

/**
 * Grund der Brevo-Sperre je Kontakt nachlesen: Abmeldelink bzw. Spam-Meldung = Widerspruch (dann auch
 * Newsletter-Abmeldung im Shop), harter Bounce = unzustellbar, sonst Sperre durch Admin/Plugin (kein Widerspruch).
 */
async function checkBrevoBlockReasons(deps: CustomerMailDeps, tenantId: string | null, brevo: BrevoClient): Promise<{ checked: number; open: number; objections: number }> {
  const pending = () =>
    and(tenantIs(marketingContacts.tenantId, tenantId), eq(marketingContacts.brevoBlocklisted, true), isNull(marketingContacts.brevoCheckedAt));
  const rows = await db
    .select({ id: marketingContacts.id, email: marketingContacts.email })
    .from(marketingContacts)
    .where(pending())
    // Käufer zuerst: für sie zählt der Grund am meisten
    .orderBy(desc(marketingContacts.orderCount))
    .limit(BREVO_BLOCK_CHECKS_PER_SYNC);
  let checked = 0;
  let objections = 0;
  for (const r of rows) {
    const now = deps.now();
    let history;
    try {
      history = await brevo.contactHistory(r.email, now);
    } catch (err) {
      log.warn({ err, tenantId }, "Kundenmails: Sperrgrund in Brevo nicht lesbar, weiter beim nächsten Abgleich");
      break;
    }
    if (history) {
      const effect = brevoBlockEffect(history);
      if (effect.objection) {
        objections += 1;
        await recordObjection(tenantId, { email: r.email, source: effect.objection.source, at: effect.objection.at, note: "Brevo-Verlauf" }, now);
      }
      await db
        .update(marketingContacts)
        .set({
          brevoCheckedAt: now,
          brevoAdminBlocked: effect.adminBlocked,
          brevoBlocklisted: history.emailBlacklisted,
          ...(effect.bouncedAt ? { bouncedAt: sql`COALESCE(${marketingContacts.bouncedAt}, ${utc(effect.bouncedAt)})` } : {}),
          updatedAt: now,
        })
        .where(eq(marketingContacts.id, r.id));
    } else {
      await db.update(marketingContacts).set({ brevoCheckedAt: now, brevoBlocklisted: false, updatedAt: now }).where(eq(marketingContacts.id, r.id));
    }
    checked += 1;
  }
  const [{ open }] = await db.select({ open: sql<number>`count(*)::int` }).from(marketingContacts).where(pending());
  if (checked) log.info({ tenantId, checked, objections, open }, "Kundenmails: Gründe der Brevo-Sperre nachgelesen");
  return { checked, open: Number(open) || 0, objections };
}

/** Widersprüche, die noch nicht in Brevo bzw. Shopware stehen, nachtragen */
async function pushPendingObjections(deps: CustomerMailDeps, tenantId: string | null, brevo: BrevoClient, api: ShopApi | null): Promise<number> {
  const rows = await db
    .select()
    .from(marketingContacts)
    .where(and(tenantIs(marketingContacts.tenantId, tenantId), sql`${marketingContacts.objectionAt} IS NOT NULL`, sql`(${marketingContacts.brevoBlocklisted} = false OR ${marketingContacts.shopOptOutPending} = true)`))
    .limit(500);
  let pushed = 0;
  for (const r of rows) {
    try {
      if (!r.brevoBlocklisted) {
        await brevo.blocklist(r.email);
        await db.update(marketingContacts).set({ brevoBlocklisted: true, updatedAt: deps.now() }).where(eq(marketingContacts.id, r.id));
      }
      if (r.shopOptOutPending && api && r.newsletterRecipientId) {
        await api("PATCH", `newsletter-recipient/${r.newsletterRecipientId}`, { status: "optOut" });
        await db.update(marketingContacts).set({ shopOptOutPending: false, newsletterStatus: "optOut", updatedAt: deps.now() }).where(eq(marketingContacts.id, r.id));
      } else if (r.shopOptOutPending && !r.newsletterRecipientId) {
        await db.update(marketingContacts).set({ shopOptOutPending: false, updatedAt: deps.now() }).where(eq(marketingContacts.id, r.id));
      }
      pushed += 1;
    } catch (err) {
      log.warn({ err, tenantId, contactId: r.id }, "Kundenmails: Widerspruch konnte nicht weitergegeben werden");
    }
  }
  return pushed;
}

/** Einwilligung erfassen (Außendienst/CRM bzw. von Hand); überschreibt keinen Widerspruch */
export async function recordConsent(tenantId: string | null, input: { email: string; source: "crm" | "manual"; note: string; at?: string }, by: string, now: Date): Promise<MarketingContactRow> {
  const email = normalizeEmail(input.email);
  if (!email) throw new CustomerMailError("invalidEmail");
  const at = input.at ? new Date(`${input.at}T12:00:00.000Z`) : now;
  await db
    .insert(marketingContacts)
    .values({ tenantId, email, consentAt: at, consentSource: input.source, consentNote: input.note, consentBy: by, updatedAt: now })
    .onConflictDoUpdate({
      target: [marketingContacts.tenantId, marketingContacts.email],
      set: { consentAt: at, consentSource: input.source, consentNote: input.note, consentBy: by, updatedAt: now },
    });
  const [row] = await db.select().from(marketingContacts).where(and(tenantIs(marketingContacts.tenantId, tenantId), eq(marketingContacts.email, email)));
  return row;
}

/**
 * Widerspruch erfassen (bleibt dauerhaft). Brevo-Sperrliste und Shopware-Abmeldung folgen beim nächsten Abgleich
 * bzw. sofort, wenn ein Brevo-Client übergeben wird.
 */
export async function recordObjection(
  tenantId: string | null,
  input: { email: string; source: CustomerMailContact["objectionSource"] & string; note?: string | null; at?: Date },
  now: Date,
  brevo?: BrevoClient | null,
): Promise<MarketingContactRow | null> {
  const email = normalizeEmail(input.email);
  if (!email) return null;
  const at = input.at ?? now;
  const fromBrevo = input.source.startsWith("brevo");
  await db
    .insert(marketingContacts)
    .values({ tenantId, email, objectionAt: at, objectionSource: input.source, objectionNote: input.note ?? null, brevoBlocklisted: fromBrevo, shopOptOutPending: true, updatedAt: now })
    .onConflictDoUpdate({
      target: [marketingContacts.tenantId, marketingContacts.email],
      set: {
        objectionAt: sql`COALESCE(${marketingContacts.objectionAt}, ${utc(at)})`,
        objectionSource: sql`COALESCE(${marketingContacts.objectionSource}, ${input.source})`,
        objectionNote: sql`COALESCE(${marketingContacts.objectionNote}, ${input.note ?? null})`,
        brevoBlocklisted: fromBrevo ? true : sql`${marketingContacts.brevoBlocklisted}`,
        shopOptOutPending: sql`CASE WHEN ${marketingContacts.newsletterStatus} = 'optOut' THEN false ELSE true END`,
        updatedAt: now,
      },
    });
  const [row] = await db.select().from(marketingContacts).where(and(tenantIs(marketingContacts.tenantId, tenantId), eq(marketingContacts.email, email)));
  if (row && brevo && !row.brevoBlocklisted) {
    try {
      await brevo.blocklist(email);
      await db.update(marketingContacts).set({ brevoBlocklisted: true, updatedAt: now }).where(eq(marketingContacts.id, row.id));
      row.brevoBlocklisted = true;
    } catch (err) {
      log.warn({ err, tenantId }, "Kundenmails: Brevo-Sperrliste nicht erreicht, folgt beim Abgleich");
    }
  }
  return row ?? null;
}

export async function contactStatus(tenantId: string | null, emailRaw: string, settings: Pick<CustomerMailSettings, "existingCustomerSince">): Promise<CustomerMailContactStatus | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  const [r] = await db.select().from(marketingContacts).where(and(tenantIs(marketingContacts.tenantId, tenantId), eq(marketingContacts.email, email)));
  if (!r) return { email, known: false, basis: "none", consentAt: null, consentSource: null, objectionAt: null, objectionSource: null, bouncedAt: null };
  return {
    email,
    known: true,
    basis: basisOf(r, settings.existingCustomerSince),
    consentAt: iso(r.consentAt),
    consentSource: (r.consentSource as CustomerMailContactStatus["consentSource"]) ?? null,
    objectionAt: iso(r.objectionAt),
    objectionSource: (r.objectionSource as CustomerMailContactStatus["objectionSource"]) ?? null,
    bouncedAt: iso(r.bouncedAt),
  };
}

// ---------------------------------------------------------------------------------------------
// Brevo-Webhook

export async function handleBrevoWebhook(tenantId: string, body: unknown, now: Date): Promise<{ stored: number; objections: number; bounces: number }> {
  const events = parseBrevoEvents(body, now);
  let objections = 0;
  let bounces = 0;
  if (events.length) {
    await db.insert(marketingEvents).values(
      events.map((e) => ({ tenantId, email: e.email, event: e.event, campaignId: e.campaignId, url: e.url, occurredAt: e.occurredAt, payload: e.payload })),
    );
  }
  for (const e of events) {
    const effect = eventEffect(e.event);
    if (effect === "bounce") {
      bounces += 1;
      await db
        .insert(marketingContacts)
        .values({ tenantId, email: e.email, bouncedAt: e.occurredAt, updatedAt: now })
        .onConflictDoUpdate({ target: [marketingContacts.tenantId, marketingContacts.email], set: { bouncedAt: sql`COALESCE(${marketingContacts.bouncedAt}, ${utc(e.occurredAt)})`, updatedAt: now } });
    } else if (effect) {
      objections += 1;
      await recordObjection(tenantId, { email: e.email, source: effect === "objection:brevoSpam" ? "brevoSpam" : "brevoUnsubscribe", at: e.occurredAt }, now);
    }
  }
  if (objections || bounces) log.info({ tenantId, objections, bounces, events: events.length }, "Kundenmails: Brevo-Ereignisse übernommen");
  return { stored: events.length, objections, bounces };
}

/** Webhook in Brevo (neu) einrichten: neues Token, alter Webhook wird gelöscht */
export async function setupBrevoWebhook(deps: CustomerMailDeps, tenantId: string, baseUrl: string): Promise<CustomerMailState> {
  const brevo = await brevoFor(deps, tenantId);
  const state = await getCustomerMailState(deps.storage, tenantId);
  if (state.webhookId) await brevo.deleteWebhook(state.webhookId);
  const token = await rotateWebhookToken(deps.storage as Store, tenantId);
  const id = await brevo.createWebhook(`${baseUrl}/api/public/customer-mails/brevo`, { "X-Meta-Tenant": tenantId, "X-Meta-Token": token }, CUSTOMER_MAIL_WEBHOOK_EVENTS);
  log.info({ tenantId, webhookId: id }, "Kundenmails: Brevo-Webhook eingerichtet");
  return patchState(deps.storage, tenantId, { webhookId: id });
}

// ---------------------------------------------------------------------------------------------
// Aussendungen

export function toRun(r: MarketingMailRunRow): CustomerMailRun {
  return {
    id: r.id,
    mailType: r.mailType as CustomerMailType,
    previewOf: (r.previewOf as CustomerMailType | null) ?? null,
    status: r.status as CustomerMailRun["status"],
    subject: r.subject,
    templateId: r.templateId,
    senderId: r.senderId,
    plannedCount: r.plannedCount,
    skippedCount: r.skippedCount,
    sentCount: r.sentCount,
    brevoListId: r.brevoListId,
    brevoCampaignId: r.brevoCampaignId,
    error: r.error,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    sentBy: r.sentBy,
    sentAt: iso(r.sentAt),
  };
}

export async function listRuns(tenantId: string | null, limit = 30): Promise<CustomerMailRun[]> {
  const rows = await db.select().from(marketingMailRuns).where(tenantIs(marketingMailRuns.tenantId, tenantId)).orderBy(desc(marketingMailRuns.createdAt)).limit(limit);
  return rows.map(toRun);
}

export async function getRun(tenantId: string | null, id: string): Promise<CustomerMailRunDetail> {
  const [run] = await db.select().from(marketingMailRuns).where(and(eq(marketingMailRuns.id, id), tenantIs(marketingMailRuns.tenantId, tenantId)));
  if (!run) throw new CustomerMailError("runNotFound");
  const recipients = await db.select().from(marketingMailRecipients).where(eq(marketingMailRecipients.runId, id));
  return {
    ...toRun(run),
    recipients: recipients
      .map((r) => ({
        email: r.email,
        customerNumber: r.customerNumber,
        basis: r.basis as CustomerMailBasis | "test",
        status: r.status as "planned" | "skipped" | "sent",
        skipReason: (r.skipReason as CustomerMailRunDetail["recipients"][number]["skipReason"]) ?? null,
        attributes: (r.attributes as Record<string, string | number | null>) ?? {},
      }))
      .sort((a, b) => a.status.localeCompare(b.status) || a.email.localeCompare(b.email)),
  };
}

/** Gesendete Werbemails der letzten 30 Tage je Adresse (Kontaktbremse) */
async function sentAdvertisingByEmail(tenantId: string | null, emails: string[], now: Date): Promise<Map<string, Date[]>> {
  const out = new Map<string, Date[]>();
  if (!emails.length) return out;
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  for (let i = 0; i < emails.length; i += 1000) {
    const rows = await db
      .select({ email: marketingMailRecipients.email, sentAt: marketingMailRecipients.sentAt })
      .from(marketingMailRecipients)
      .where(
        and(
          tenantIs(marketingMailRecipients.tenantId, tenantId),
          eq(marketingMailRecipients.status, "sent"),
          eq(marketingMailRecipients.advertising, true),
          gte(marketingMailRecipients.sentAt, since),
          inArray(marketingMailRecipients.email, emails.slice(i, i + 1000)),
        ),
      );
    for (const r of rows) if (r.sentAt) out.set(r.email, [...(out.get(r.email) ?? []), r.sentAt]);
  }
  return out;
}

/**
 * Entwurf einer Aussendung anlegen (für alle Mailarten; B2–B5 liefern die Kandidaten). Empfänger ohne
 * Rechtsgrundlage, mit Widerspruch, Bounce oder über der Kontaktbremse werden mit Grund ausgelassen.
 */
export async function createRun(
  deps: CustomerMailDeps,
  tenantId: string | null,
  input: { mailType: CustomerMailType; subject: string; templateId: number; senderId: number; candidates: PlanCandidate[]; previewOf?: CustomerMailType | null },
  by: string,
): Promise<CustomerMailRunDetail> {
  const now = deps.now();
  const { settings } = await getCustomerMailSettings(deps.storage, tenantId);
  const emails = input.candidates.map((c) => normalizeEmail(c.email)).filter((e): e is string => !!e);
  const rows = emails.length
    ? await db
        .select()
        .from(marketingContacts)
        .where(and(tenantIs(marketingContacts.tenantId, tenantId), inArray(marketingContacts.email, emails)))
    : [];
  const contacts = new Map(rows.map((r) => [r.email, r]));
  const planned = planRecipients(input.mailType, input.candidates, contacts, await sentAdvertisingByEmail(tenantId, emails, now), settings, now);
  const plannedCount = planned.filter((p) => p.status === "planned").length;
  if (!plannedCount) throw new CustomerMailError("noRecipients");
  const advertising = CUSTOMER_MAIL_TYPE_RULES[input.mailType].advertising;
  const runId = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(marketingMailRuns)
      .values({
        tenantId,
        mailType: input.mailType,
        previewOf: input.previewOf ?? null,
        subject: input.subject,
        templateId: input.templateId,
        senderId: input.senderId,
        plannedCount,
        skippedCount: planned.length - plannedCount,
        createdBy: by,
      })
      .returning({ id: marketingMailRuns.id });
    for (let i = 0; i < planned.length; i += 500) {
      await tx.insert(marketingMailRecipients).values(
        planned.slice(i, i + 500).map((p) => {
          const c = contacts.get(p.email);
          return {
            tenantId,
            runId: run.id,
            mailType: input.mailType,
            advertising,
            email: p.email,
            customerNumber: p.customerNumber,
            basis: p.basis,
            status: p.status,
            skipReason: p.skipReason,
            attributes: p.status === "planned" ? brevoAttributes(c, p.basis, p.attributes) : {},
          };
        }),
      );
    }
    return run.id;
  });
  log.info({ tenantId, runId, mailType: input.mailType, planned: plannedCount, skipped: planned.length - plannedCount, by }, "Kundenmails: Aussendung angelegt");
  return getRun(tenantId, runId);
}

/** Testaussendung an die internen Testadressen */
export async function createTestRun(deps: CustomerMailDeps, tenantId: string | null, input: { subject: string; templateId: number; senderId: number }, by: string) {
  const { settings } = await getCustomerMailSettings(deps.storage, tenantId);
  if (!settings.testRecipients.length) throw new CustomerMailError("noTestRecipients");
  return createRun(deps, tenantId, { mailType: "test", ...input, candidates: settings.testRecipients.map((email) => ({ email })) }, by);
}

async function ensureFolder(deps: CustomerMailDeps, tenantId: string | null, brevo: BrevoClient): Promise<number> {
  const state = await getCustomerMailState(deps.storage, tenantId);
  if (state.brevoFolderId) return state.brevoFolderId;
  const existing = (await brevo.folders()).find((f) => f.name === CUSTOMER_MAIL_FOLDER_NAME);
  const id = existing?.id ?? (await brevo.createFolder(CUSTOMER_MAIL_FOLDER_NAME));
  await patchState(deps.storage, tenantId, { brevoFolderId: id });
  return id;
}

export async function ensureAttributes(brevo: BrevoClient, names: Record<string, "text" | "date" | "float" | "boolean">): Promise<void> {
  const have = new Set((await brevo.attributes()).map((a) => a.name.toUpperCase()));
  for (const [name, type] of Object.entries(names)) if (!have.has(name)) await brevo.createAttribute(name, type);
}

async function waitForImport(deps: CustomerMailDeps, brevo: BrevoClient, processId: number): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const status = await brevo.processStatus(processId);
    if (status === "completed") return;
    if (status === "failed" || status === "cancelled") throw new Error(`Brevo import ${processId}: ${status}`);
    await deps.sleep(2000);
  }
  throw new Error(`Brevo import ${processId}: timeout`);
}

/** Aussendung verschicken (nur aus „Entwurf“ oder „Fehler“) */
export async function sendRun(deps: CustomerMailDeps, tenantId: string | null, runId: string, by: string): Promise<CustomerMailRunDetail> {
  const { settings } = await getCustomerMailSettings(deps.storage, tenantId);
  if (!settings.enabled) throw new CustomerMailError("disabled");
  const [pending] = await db.select({ mailType: marketingMailRuns.mailType }).from(marketingMailRuns).where(and(eq(marketingMailRuns.id, runId), tenantIs(marketingMailRuns.tenantId, tenantId)));
  // Kundenversand je Mailart nur, wenn in den Einstellungen freigeschaltet (Testaussendungen immer)
  if (pending && pending.mailType !== "test" && !settings.liveTypes.includes(pending.mailType as CustomerMailType)) throw new CustomerMailError("customerSendingOff");
  const brevo = await brevoFor(deps, tenantId);
  const now = deps.now();
  const claimed = await db
    .update(marketingMailRuns)
    .set({ status: "sending", error: null, sentBy: by, updatedAt: now })
    .where(and(eq(marketingMailRuns.id, runId), tenantIs(marketingMailRuns.tenantId, tenantId), inArray(marketingMailRuns.status, ["draft", "failed"])))
    .returning();
  const run = claimed[0];
  if (!run) {
    await getRun(tenantId, runId); // 404, wenn es ihn nicht gibt
    throw new CustomerMailError("notDraft");
  }
  try {
    // Widersprüche und Bounces seit dem Entwurf noch einmal prüfen
    const recipients = await db.select().from(marketingMailRecipients).where(and(eq(marketingMailRecipients.runId, runId), eq(marketingMailRecipients.status, "planned")));
    const emails = recipients.map((r) => r.email);
    const blocked = emails.length
      ? await db
          .select({ email: marketingContacts.email })
          .from(marketingContacts)
          .where(and(tenantIs(marketingContacts.tenantId, tenantId), inArray(marketingContacts.email, emails), sql`(${marketingContacts.objectionAt} IS NOT NULL OR ${marketingContacts.bouncedAt} IS NOT NULL)`))
      : [];
    const blockedSet = new Set(blocked.map((b) => b.email));
    if (blockedSet.size) {
      await db
        .update(marketingMailRecipients)
        .set({ status: "skipped", skipReason: "objected" })
        .where(and(eq(marketingMailRecipients.runId, runId), inArray(marketingMailRecipients.email, Array.from(blockedSet))));
    }
    const toSend = recipients.filter((r) => !blockedSet.has(r.email));
    if (!toSend.length) throw new CustomerMailError("noRecipients");

    let campaignId = run.brevoCampaignId;
    let listId = run.brevoListId;
    if (!campaignId) {
      if (!run.templateId || !run.senderId) throw new Error("Template or sender missing");
      // Felder des Laufs: Zahlen als Zahl (für Bedingungen in der Vorlage), sonst Text
      const attrTypes: Record<string, "text" | "date" | "float"> = { ...CUSTOMER_MAIL_BASE_ATTRIBUTES };
      for (const r of toSend)
        for (const [k, v] of Object.entries((r.attributes as Record<string, unknown>) ?? {})) if (!(k in attrTypes)) attrTypes[k] = typeof v === "number" ? "float" : "text";
      await ensureAttributes(brevo, attrTypes);
      const folderId = await ensureFolder(deps, tenantId, brevo);
      const day = now.toISOString().slice(0, 10);
      if (!listId) {
        listId = await brevo.createList(`METAorder ${run.mailType} ${day} ${run.id.slice(0, 8)}`, folderId);
        await db.update(marketingMailRuns).set({ brevoListId: listId, updatedAt: deps.now() }).where(eq(marketingMailRuns.id, runId));
      }
      const processId = await brevo.importContacts(
        listId,
        toSend.map((r) => ({ email: r.email, attributes: (r.attributes as Record<string, string | number | null>) ?? {} })),
      );
      await waitForImport(deps, brevo, processId);
      campaignId = await brevo.createCampaign({
        name: `METAorder ${run.mailType} ${day} ${run.id.slice(0, 8)}`,
        subject: run.subject,
        senderId: run.senderId,
        templateId: run.templateId,
        listId,
        replyTo: settings.replyTo || undefined,
        utmCampaign: `metaorder-${run.mailType}-${day}`,
      });
      await db.update(marketingMailRuns).set({ brevoCampaignId: campaignId, updatedAt: deps.now() }).where(eq(marketingMailRuns.id, runId));
    }
    await brevo.sendCampaignNow(campaignId);
    const sentAt = deps.now();
    await db
      .update(marketingMailRecipients)
      .set({ status: "sent", sentAt })
      .where(and(eq(marketingMailRecipients.runId, runId), eq(marketingMailRecipients.status, "planned")));
    await db
      .update(marketingMailRuns)
      .set({ status: "sent", sentAt, sentCount: toSend.length, plannedCount: toSend.length, skippedCount: run.skippedCount + blockedSet.size, updatedAt: sentAt })
      .where(eq(marketingMailRuns.id, runId));
    log.info({ tenantId, runId, mailType: run.mailType, campaignId, sent: toSend.length, by }, "Kundenmails: Aussendung verschickt");
  } catch (err) {
    const message = brevoErrorText(err);
    await db.update(marketingMailRuns).set({ status: "failed", error: message, updatedAt: deps.now() }).where(eq(marketingMailRuns.id, runId));
    log.error({ err, tenantId, runId }, "Kundenmails: Versand fehlgeschlagen");
    if (err instanceof CustomerMailError) throw err;
  }
  return getRun(tenantId, runId);
}

export async function cancelRun(tenantId: string | null, runId: string, now: Date): Promise<CustomerMailRunDetail> {
  const updated = await db
    .update(marketingMailRuns)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(marketingMailRuns.id, runId), tenantIs(marketingMailRuns.tenantId, tenantId), inArray(marketingMailRuns.status, ["draft", "failed"])))
    .returning({ id: marketingMailRuns.id });
  if (!updated.length) {
    await getRun(tenantId, runId);
    throw new CustomerMailError("notDraft");
  }
  return getRun(tenantId, runId);
}
