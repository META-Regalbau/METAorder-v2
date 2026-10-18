/**
 * Shop-Puls Stufe 2 (S2-3), B2B-Warenkorb-Alarm: Einstellungen, Speicherung (shop_pulse_carts, Migration 0059)
 * und Lauf. Der Zeitplan (shopPulseScheduler.ts) ruft runCartAlarm in jedem Takt auf, wenn der Schalter
 * „Warenkorb-Alarm“ an ist (Standard aus). Datenquellen sind austauschbar (Tests in
 * tests/unit/shopPulseCartAlarm.test.ts).
 *
 * Alarm: interne E-Mail an den Empfänger (Außendienst laut Zuordnung bzw. Ersatz-Empfänger), wenn der
 * E-Mail-Versand eingerichtet ist; immer eine Teams-Karte in die Shop-Puls-Direktnachricht (mit @Erwähnung des
 * Empfängers) und die Glocke (Empfänger, wenn er METAorder-Nutzer ist, sonst die Administratoren). Kunden
 * schreibt METAorder nie an. In der Lernwoche geht nichts raus.
 */
import { randomBytes } from "crypto";
import { and, eq, isNull, lt, type AnyColumn } from "drizzle-orm";
import { salesRepAssignments, shopPulseCarts, type ShopPulseCartRow } from "@shared/schema";
import {
  normalizeShopPulseCartSettings,
  SHOP_PULSE_CART_RECIPIENTS,
  SHOP_PULSE_CART_RULES as RULES,
  type CartSignal,
  type ShopPulseCart,
  type ShopPulseCartRecipientSource,
  type ShopPulseCartSettings,
  type ShopPulseCartSettingsUpdate,
} from "@shared/shopPulseCart";
import type { IStorage } from "../storage";
import { db } from "../db";
import { decrypt, encrypt } from "../lib/encryption";
import { logger } from "../lib/logger";
import { adaptiveCardMessage, teamsPlain } from "../lib/teamsOutbox";
import type { ActionCandidate } from "./actionLog";
import { cartAlarmLines, cartAlarmSubject, cartState, cartWonAction, planCartAlarms, recipientFor, type CartRecipient, type CustomerOrder } from "./cartAlarm";

const log = logger.child({ component: "shopPulse/cartAlarmRun" });

export const SHOP_PULSE_CART_SETTINGS_KEY = "shop_pulse_cart_alarm";
const DAY_MS = 24 * 60 * 60 * 1000;

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

// ---------------------------------------------------------------------------------------------
// Einstellungen (Schlüssel verschlüsselt, wie GA4)

type Store = Pick<IStorage, "getSetting" | "saveSetting">;
type StoredCartSettings = ShopPulseCartSettings & { secret?: string; lastSignalAt?: string | null };

async function readStored(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<StoredCartSettings> {
  const raw = await store.getSetting(SHOP_PULSE_CART_SETTINGS_KEY, tenantId);
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { ...normalizeShopPulseCartSettings(r), secret: typeof r.secret === "string" ? r.secret : undefined, lastSignalAt: typeof r.lastSignalAt === "string" ? r.lastSignalAt : null };
}

export async function getCartSettings(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<ShopPulseCartSettings & { hasSecret: boolean; lastSignalAt: string | null }> {
  const s = await readStored(store, tenantId);
  const { secret, ...rest } = s;
  return { ...normalizeShopPulseCartSettings(rest), hasSecret: !!secret, lastSignalAt: s.lastSignalAt ?? null };
}

/** Geheimer Schlüssel im Klartext (nur für die Prüfung der Signatur); null = keiner */
export async function getCartSecret(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<string | null> {
  const s = await readStored(store, tenantId);
  if (!s.secret) return null;
  try {
    return decrypt(s.secret) || null;
  } catch {
    return null;
  }
}

export async function updateCartSettings(store: Store, tenantId: string | null, update: ShopPulseCartSettingsUpdate): Promise<void> {
  const current = await readStored(store, tenantId);
  await store.saveSetting(SHOP_PULSE_CART_SETTINGS_KEY, { ...current, ...normalizeShopPulseCartSettings({ ...current, ...update }) }, tenantId);
}

/** Neuen Schlüssel erzeugen (der alte gilt dann nicht mehr); liefert ihn einmal im Klartext */
export async function rotateCartSecret(store: Store, tenantId: string | null): Promise<string> {
  const secret = randomBytes(32).toString("base64url");
  const current = await readStored(store, tenantId);
  await store.saveSetting(SHOP_PULSE_CART_SETTINGS_KEY, { ...current, secret: encrypt(secret) }, tenantId);
  return secret;
}

export async function touchLastSignal(store: Store, tenantId: string | null, at: Date): Promise<void> {
  const current = await readStored(store, tenantId);
  await store.saveSetting(SHOP_PULSE_CART_SETTINGS_KEY, { ...current, lastSignalAt: at.toISOString() }, tenantId);
}

// ---------------------------------------------------------------------------------------------
// Speicherung

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function rowToCart(row: ShopPulseCartRow, settings: Pick<ShopPulseCartSettings, "thresholdNet">): ShopPulseCart {
  const source = (SHOP_PULSE_CART_RECIPIENTS as readonly string[]).includes(row.alarmRecipientSource ?? "") ? (row.alarmRecipientSource as ShopPulseCartRecipientSource) : null;
  const cart: Omit<ShopPulseCart, "state"> = {
    id: row.id,
    customerNumber: row.customerNumber,
    company: row.company,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone ?? null,
    netTotal: row.netTotal,
    currency: row.currency,
    positionCount: row.positionCount,
    positions: Array.isArray(row.positions) ? row.positions : [],
    cartUpdatedAt: row.cartUpdatedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    alarmedAt: iso(row.alarmedAt),
    alarmRecipient: row.alarmRecipient ?? null,
    alarmRecipientSource: source,
    alarmMailed: row.alarmMailed,
    orderedAt: iso(row.orderedAt),
    orderNumber: row.orderNumber ?? null,
  };
  return { ...cart, state: cartState(cart, settings) };
}

async function findRow(tenantId: string | null, customerNumber: string): Promise<ShopPulseCartRow | undefined> {
  const rows = await db
    .select()
    .from(shopPulseCarts)
    .where(and(tenantIs(shopPulseCarts.tenantId, tenantId), eq(shopPulseCarts.customerNumber, customerNumber)))
    .limit(1);
  return rows[0];
}

/**
 * Meldung des Plugins speichern: „Warenkorb gespeichert“ ersetzt den Warenkorb des Kunden (ein neuer
 * Warenkorb ist noch nicht bestellt; Stand des letzten Alarms bleibt für die Wochen-Grenze), „bestellt“ trägt
 * die Bestellung ein.
 */
export async function storeCartSignal(tenantId: string | null, signal: CartSignal, receivedAt: Date): Promise<"stored" | "ordered" | "unknownCart"> {
  const c = signal.customer;
  const existing = await findRow(tenantId, c.customerNumber);
  if (signal.event === "order.placed") {
    if (!existing || existing.orderedAt) return "unknownCart";
    await db.update(shopPulseCarts).set({ orderedAt: new Date(signal.occurredAt), orderNumber: signal.order.orderNumber || null }).where(eq(shopPulseCarts.id, existing.id));
    return "ordered";
  }
  const values = {
    customerId: c.id,
    company: c.company,
    contactName: c.contactName,
    contactEmail: c.email,
    contactPhone: c.phone,
    netTotal: signal.cart.netTotal,
    currency: signal.cart.currency,
    positionCount: signal.cart.positionCount,
    positions: signal.cart.positions,
    cartUpdatedAt: new Date(signal.occurredAt),
    receivedAt,
    orderedAt: null,
    orderNumber: null,
  };
  if (existing) await db.update(shopPulseCarts).set(values).where(eq(shopPulseCarts.id, existing.id));
  else await db.insert(shopPulseCarts).values({ tenantId, customerNumber: c.customerNumber, ...values }).onConflictDoNothing();
  return "stored";
}

export async function listCarts(tenantId: string | null): Promise<ShopPulseCartRow[]> {
  return db.select().from(shopPulseCarts).where(tenantIs(shopPulseCarts.tenantId, tenantId));
}

/** Aufbewahrung: Warenkörbe älter als 30 Tage löschen */
export async function purgeCarts(tenantId: string | null, now: Date): Promise<void> {
  await db.delete(shopPulseCarts).where(and(tenantIs(shopPulseCarts.tenantId, tenantId), lt(shopPulseCarts.receivedAt, new Date(now.getTime() - RULES.retentionDays * DAY_MS))));
}

/** Alles löschen (Schalter aus, „Daten löschen“) */
export async function deleteAllCarts(tenantId: string | null): Promise<void> {
  await db.delete(shopPulseCarts).where(tenantIs(shopPulseCarts.tenantId, tenantId));
}

// ---------------------------------------------------------------------------------------------
// Lauf

export type CartAlarmDeps = {
  settings(tenantId: string | null): Promise<ShopPulseCartSettings>;
  listCarts(tenantId: string | null): Promise<ShopPulseCart[]>;
  purge(tenantId: string | null, now: Date): Promise<void>;
  /** MO-Bestellungen mit Kundennummer ab dem Zeitpunkt (Bestellspiegel) */
  loadOrders(tenantId: string | null, since: Date): Promise<CustomerOrder[]>;
  /** Außendienst je Kundennummer (Schlüssel in Großbuchstaben) */
  salesReps(tenantId: string | null, customerNumbers: string[]): Promise<Map<string, { name: string; email: string }>>;
  markAlarmed(id: string, at: Date, recipient: CartRecipient, mailed: boolean): Promise<void>;
  markOrdered(id: string, orderNumber: string, at: Date): Promise<void>;
  /** interne E-Mail; wirft, wenn nicht eingerichtet */
  sendMail(tenantId: string | null, to: string, subject: string, text: string): Promise<void>;
  /** Teams-Karte in die Shop-Puls-Warteschlange */
  enqueueTeams(tenantId: string | null, message: Record<string, unknown>, now: Date): Promise<void>;
  /** Glocke: an den Nutzer mit dieser E-Mail, sonst an die Administratoren */
  notify(tenantId: string | null, email: string | null, text: { title: string; message: string }): Promise<void>;
  insertActions(tenantId: string | null, candidates: ActionCandidate[]): Promise<unknown>;
};

export type CartAlarmRunResult = { alarms: number; mailed: number; ordered: number; won: number };

/** Teams-Karte mit @Erwähnung des Empfängers (wenn eine E-Mail bekannt ist) */
export function buildCartAlarmCard(cart: ShopPulseCart, recipient: CartRecipient, pageUrl: string | null): Record<string, unknown> {
  const mention = recipient.email ? `<at>${teamsPlain(recipient.name, 80)}</at>` : null;
  const lines = cartAlarmLines(cart, recipient);
  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: `🛒 ${teamsPlain(cartAlarmSubject(cart), 200)}`, weight: "Bolder", size: "Medium", wrap: true },
    ...(mention ? [{ type: "TextBlock", text: `${mention}, bitte kurz beim Kunden melden.`, wrap: true }] : []),
    ...lines.map((l, i) => ({ type: "TextBlock", text: teamsPlain(l, 400), wrap: true, spacing: i ? "None" : "Small", ...(l.startsWith("- ") ? { isSubtle: true } : {}) })),
  ];
  const message = adaptiveCardMessage(body, pageUrl ? [{ title: "Warenkorb-Alarm öffnen", url: pageUrl }] : []);
  if (mention) {
    const content = ((message.attachments as Array<{ content: Record<string, unknown> }>)[0]).content;
    content.msteams = { entities: [{ type: "mention", text: mention, mentioned: { id: recipient.email, name: teamsPlain(recipient.name, 80) } }] };
  }
  return message;
}

export async function runCartAlarm(deps: CartAlarmDeps, tenantId: string | null, now: Date, opts: { silent: boolean; pageUrl: string | null }): Promise<CartAlarmRunResult | null> {
  const settings = await deps.settings(tenantId);
  if (!settings.enabled) return null;
  await deps.purge(tenantId, now);
  const carts = await deps.listCarts(tenantId);
  const result: CartAlarmRunResult = { alarms: 0, mailed: 0, ordered: 0, won: 0 };
  if (!carts.length) return result;
  const earliest = carts.reduce((m, c) => Math.min(m, Date.parse(c.cartUpdatedAt), c.alarmedAt ? Date.parse(c.alarmedAt) : Infinity), Infinity);
  const orders = await deps.loadOrders(tenantId, new Date(earliest));
  const plan = planCartAlarms(carts, orders, settings, now);

  for (const o of plan.ordered) {
    await deps.markOrdered(o.id, o.orderNumber, o.orderedAt);
    result.ordered += 1;
  }
  if (plan.won.length) {
    await deps.insertActions(tenantId, plan.won.map(cartWonAction));
    result.won = plan.won.length;
  }
  if (opts.silent || !plan.alarm.length) return result;

  const reps = await deps.salesReps(tenantId, plan.alarm.map((c) => c.customerNumber));
  for (const cart of plan.alarm) {
    const recipient = recipientFor(cart.customerNumber, reps, settings);
    let mailed = false;
    if (recipient.email) {
      try {
        await deps.sendMail(tenantId, recipient.email, cartAlarmSubject(cart), [...cartAlarmLines(cart, recipient), "", opts.pageUrl ? `Shop-Puls in METAorder: ${opts.pageUrl}` : ""].join("\n").trim());
        mailed = true;
        result.mailed += 1;
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err), tenantId, customerNumber: cart.customerNumber }, "Warenkorb-Alarm: E-Mail nicht gesendet, nur Teams/Glocke");
      }
    }
    await deps.enqueueTeams(tenantId, buildCartAlarmCard(cart, recipient, opts.pageUrl), now);
    await deps.notify(tenantId, recipient.email, { title: cartAlarmSubject(cart), message: cartAlarmLines(cart, recipient).join("\n").slice(0, 1000) });
    await deps.markAlarmed(cart.id, now, recipient, mailed);
    result.alarms += 1;
    log.info({ tenantId, customerNumber: cart.customerNumber, net: cart.netTotal, recipient: recipient.source, mailed }, "Warenkorb-Alarm gesendet");
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Echte Datenquellen

export async function loadSalesReps(tenantId: string | null, customerNumbers: string[]): Promise<Map<string, { name: string; email: string }>> {
  const out = new Map<string, { name: string; email: string }>();
  if (!customerNumbers.length) return out;
  const rows = await db
    .select({ customerNumber: salesRepAssignments.customerNumber, name: salesRepAssignments.repName, email: salesRepAssignments.repEmail })
    .from(salesRepAssignments)
    .where(tenantIs(salesRepAssignments.tenantId, tenantId));
  const wanted = new Set(customerNumbers.map((n) => n.trim().toUpperCase()));
  for (const r of rows) {
    const key = r.customerNumber.trim().toUpperCase();
    if (wanted.has(key) && r.email?.trim()) out.set(key, { name: r.name?.trim() ?? "", email: r.email.trim() });
  }
  return out;
}

export async function markCartAlarmed(id: string, at: Date, recipient: CartRecipient, mailed: boolean): Promise<void> {
  await db
    .update(shopPulseCarts)
    .set({ alarmedAt: at, alarmRecipient: recipient.email ? `${recipient.name} <${recipient.email}>` : recipient.name, alarmRecipientSource: recipient.source, alarmMailed: mailed })
    .where(eq(shopPulseCarts.id, id));
}

export async function markCartOrdered(id: string, orderNumber: string, at: Date): Promise<void> {
  await db.update(shopPulseCarts).set({ orderedAt: at, orderNumber }).where(eq(shopPulseCarts.id, id));
}
