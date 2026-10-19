/**
 * Shop-Puls Stufe 3 (S3-4), Stammkunden-Wache mit Datenbank und Versand. Einmal am Tag (Montag bis Freitag
 * ab 8 Uhr Berlin) rechnet der Lauf die Stammkunden neu (regulars.ts) und meldet überfällige:
 *
 * - an den Außendienst laut Zuordnung (sales_rep_assignments): interne E-Mail, wenn der Versand eingerichtet
 *   ist, und die Glocke, wenn er METAorder-Nutzer ist; sonst an Oliver (Glocke der Administratoren);
 * - immer eine Teams-Karte in die Shop-Puls-Direktnachricht (an Oliver), damit er sieht, was rausging;
 * - höchstens eine Meldung je Kunde in 90 Tagen; Kunden schreibt METAorder nie an.
 *
 * Erster Lauf: Wer da schon überfällig ist, wird als Altbestand markiert und nur per Knopf gemeldet (sonst kämen
 * nach dem Deploy alle auf einmal). Bestellt ein gemeldeter Kunde danach, zählt das als Erfolg im
 * Maßnahmen-Protokoll (Wirkungsmessung). Lernwoche und ausgeschalteter Shop-Puls: nur rechnen, nichts senden.
 */
import { and, eq, isNull, sql, type AnyColumn } from "drizzle-orm";
import { shopPulseRegulars, shopwareOrders, shopwareProducts } from "@shared/schema";
import {
  normalizeRegularSettings,
  SHOP_PULSE_REGULAR_ALERT_DAYS,
  type ShopPulseRegularCustomer,
  type ShopPulseRegularSettings,
  type ShopPulseRegularState,
} from "@shared/shopPulseRegulars";
import type { IStorage } from "../storage";
import { db } from "../db";
import { logger } from "../lib/logger";
import { adaptiveCardMessage, teamsPlain } from "../lib/teamsOutbox";
import type { ActionCandidate } from "./actionLog";
import { loadPriceChanges } from "./buyabilityData";
import { berlinTime } from "./pulseOrders";
import { analyzeRegulars, deliveryMaxDays, regularAlertLines, regularCauses, type RegularAnalysis, type RegularOrder, type RegularPriceChange, type RegularProductInfo } from "./regulars";

const log = logger.child({ component: "shopPulse/regularsRun" });

export const REGULAR_SETTINGS_KEY = "shop_pulse_regular_settings";
export const REGULAR_STATE_KEY = "shop_pulse_regular_state";
const DAY_MS = 24 * 60 * 60 * 1000;
/** So weit zurück wird der Bestellabstand berechnet */
const LOOKBACK_DAYS = 3 * 365;
const RUN_FROM_HOUR = 8;
const RUN_TO_HOUR = 17;

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

export type RegularRow = {
  customerNumber: string;
  backlog: boolean;
  alertedAt: Date | null;
  alertLastOrderAt: Date | null;
  recipient: string | null;
  recipientSource: string | null;
  wonAt: Date | null;
  wonOrderNumber: string | null;
};

export type RegularRecipient = { name: string; email: string | null; source: "rep" | "oliver" };

export type RegularDeps = {
  storage: Pick<IStorage, "getSetting" | "saveSetting">;
  loadOrders(tenantId: string | null, since: Date): Promise<RegularOrder[]>;
  products(tenantId: string | null): Promise<Map<string, RegularProductInfo>>;
  priceChanges(tenantId: string | null, since: Date): Promise<RegularPriceChange[]>;
  salesReps(tenantId: string | null, customerNumbers: string[]): Promise<Map<string, { name: string; email: string }>>;
  rows(tenantId: string | null): Promise<RegularRow[]>;
  saveRow(tenantId: string | null, row: RegularRow & { alertMailed?: boolean; alertText?: string | null }): Promise<void>;
  sendMail?(tenantId: string | null, to: string, subject: string, text: string): Promise<void>;
  enqueueTeams(tenantId: string | null, message: Record<string, unknown>, now: Date): Promise<void>;
  notify(tenantId: string | null, email: string | null, text: { title: string; message: string }): Promise<void>;
  insertActions(tenantId: string | null, candidates: ActionCandidate[]): Promise<unknown>;
  pageUrl: string | null;
};

export async function getRegularSettings(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<ShopPulseRegularSettings> {
  return normalizeRegularSettings(await store.getSetting(REGULAR_SETTINGS_KEY, tenantId));
}

type RunState = { lastRunAt?: string; lastRunDay?: string };

export async function getRegularState(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<RunState> {
  const raw = await store.getSetting(REGULAR_STATE_KEY, tenantId);
  return raw && typeof raw === "object" ? (raw as RunState) : {};
}

/** Fällig: Montag bis Freitag 8–17 Uhr Berlin, heute noch nicht */
export function isRegularsDue(state: RunState, now: Date): boolean {
  const { day, hour, weekday } = berlinTime(now);
  return weekday <= 5 && hour >= RUN_FROM_HOUR && hour < RUN_TO_HOUR && state.lastRunDay !== day;
}

/** Zustand eines Kunden aus Kennzahlen und gespeichertem Stand */
export function regularState(a: Pick<RegularAnalysis, "overdue" | "lastOrderAt">, row: RegularRow | undefined): ShopPulseRegularState {
  if (row?.alertedAt && row.wonAt && row.wonAt.getTime() >= row.alertedAt.getTime()) return a.overdue ? "overdue" : "won";
  if (row?.alertedAt && Date.parse(a.lastOrderAt) <= row.alertedAt.getTime()) return "alerted";
  if (!a.overdue) return "ok";
  return row?.backlog ? "backlog" : "overdue";
}

/** Darf jetzt gemeldet werden? Überfällig, kein Altbestand (außer von Hand), letzte Meldung über 90 Tage her */
export function mayAlert(a: Pick<RegularAnalysis, "overdue">, row: RegularRow | undefined, now: Date, manual = false): boolean {
  if (!a.overdue) return false;
  if (row?.backlog && !manual) return false;
  return !row?.alertedAt || now.getTime() - row.alertedAt.getTime() >= SHOP_PULSE_REGULAR_ALERT_DAYS * DAY_MS;
}

export function regularRecipient(customerNumber: string, reps: Map<string, { name: string; email: string }>): RegularRecipient {
  const rep = reps.get(customerNumber.trim().toUpperCase());
  return rep ? { name: rep.name || rep.email, email: rep.email, source: "rep" } : { name: "Oliver", email: null, source: "oliver" };
}

const subjectOf = (c: Pick<ShopPulseRegularCustomer, "company" | "contactName" | "customerNumber">) => `Stammkunde bestellt nicht mehr: ${c.company || c.contactName || c.customerNumber}`;

function alertCard(c: RegularAnalysis, recipient: RegularRecipient, pageUrl: string | null): Record<string, unknown> {
  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: teamsPlain(`🔔 ${subjectOf(c)}`, 200), weight: "Bolder", size: "Medium", wrap: true },
    ...regularAlertLines(c).map((l) => ({ type: "TextBlock", text: teamsPlain(l, 600), wrap: true, spacing: "Small" })),
    { type: "TextBlock", text: teamsPlain(recipient.source === "rep" ? `Gemeldet an ${recipient.name}${recipient.email ? ` (${recipient.email})` : ""}` : "Kein Außendienst zugeordnet – an dich", 300), wrap: true, isSubtle: true },
  ];
  return adaptiveCardMessage(body, pageUrl ? [{ title: "In METAorder öffnen", url: `${pageUrl}?tab=regulars` }] : []);
}

export type RegularsContext = {
  settings: ShopPulseRegularSettings;
  analyses: RegularAnalysis[];
  rows: Map<string, RegularRow>;
  reps: Map<string, { name: string; email: string }>;
};

/** Kennzahlen, Ursachen und gespeicherter Stand (für Lauf und Seite) */
export async function loadRegularsContext(deps: RegularDeps, tenantId: string | null, now: Date): Promise<RegularsContext> {
  const settings = await getRegularSettings(deps.storage, tenantId);
  const orders = await deps.loadOrders(tenantId, new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS));
  const analyses = analyzeRegulars(orders, now, settings);
  if (analyses.length) {
    const since = new Date(Math.min(...analyses.map((a) => Date.parse(a.lastOrderAt))));
    const [products, prices] = await Promise.all([deps.products(tenantId), deps.priceChanges(tenantId, since)]);
    for (const a of analyses) a.causes = regularCauses(a, prices, products);
  }
  const [rows, reps] = await Promise.all([deps.rows(tenantId), deps.salesReps(tenantId, analyses.map((a) => a.customerNumber))]);
  return { settings, analyses, rows: new Map(rows.map((r) => [r.customerNumber, r])), reps };
}

export function toCustomer(a: RegularAnalysis, ctx: Pick<RegularsContext, "rows" | "reps">): ShopPulseRegularCustomer {
  const row = ctx.rows.get(a.customerNumber);
  const { regularNumbers: _n, ...rest } = a;
  return {
    ...rest,
    state: regularState(a, row),
    recipient: regularRecipient(a.customerNumber, ctx.reps),
    alertedAt: row?.alertedAt?.toISOString() ?? null,
    wonAt: row?.wonAt?.toISOString() ?? null,
    wonOrderNumber: row?.wonOrderNumber ?? null,
  };
}

/** Eine Meldung senden und speichern (Lauf und Knopf „Jetzt melden“) */
async function sendAlert(deps: RegularDeps, tenantId: string | null, a: RegularAnalysis, ctx: RegularsContext, now: Date, by: string | null): Promise<RegularRecipient> {
  const recipient = regularRecipient(a.customerNumber, ctx.reps);
  const lines = regularAlertLines(a);
  let mailed = false;
  if (recipient.email && deps.sendMail) {
    try {
      await deps.sendMail(tenantId, recipient.email, subjectOf(a), [...lines, "", deps.pageUrl ? `Shop-Puls in METAorder: ${deps.pageUrl}?tab=regulars` : ""].join("\n").trim());
      mailed = true;
    } catch (err) {
      log.warn({ err, tenantId, customer: a.customerNumber }, "Shop-Puls: Stammkunden-Mail nicht gesendet");
    }
  }
  await deps.enqueueTeams(tenantId, alertCard(a, recipient, deps.pageUrl), now);
  await deps.notify(tenantId, recipient.email, { title: subjectOf(a), message: lines.join("\n").slice(0, 1000) });
  const row = ctx.rows.get(a.customerNumber);
  const saved: RegularRow = {
    customerNumber: a.customerNumber,
    backlog: false,
    alertedAt: now,
    alertLastOrderAt: new Date(a.lastOrderAt),
    recipient: recipient.email ? `${recipient.name} <${recipient.email}>` : recipient.name,
    recipientSource: recipient.source,
    wonAt: null,
    wonOrderNumber: null,
  };
  await deps.saveRow(tenantId, { ...saved, alertMailed: mailed, alertText: lines.join("\n") });
  ctx.rows.set(a.customerNumber, { ...(row ?? saved), ...saved });
  await deps.insertActions(tenantId, [
    {
      occurredAt: now.toISOString(),
      kind: "regularAlert",
      title: `Stammkunde überfällig gemeldet: ${a.company || a.customerNumber} (an ${recipient.name})`.slice(0, 300),
      description: lines.join("\n"),
      scope: { type: "shop", values: [] },
      source: "shopPulse",
      sourceKey: `regular:${a.customerNumber}:${now.toISOString()}`,
      actor: by,
    },
  ]);
  return recipient;
}

export type RegularsRunResult = { customers: number; overdue: number; alerts: number; backlog: number; won: number };

/** Täglicher Lauf (siehe Dateikopf); silent: nur rechnen und Erfolge festhalten, nichts senden */
export async function runRegulars(deps: RegularDeps, tenantId: string | null, now: Date, opts: { silent: boolean }): Promise<RegularsRunResult | null> {
  const settings = await getRegularSettings(deps.storage, tenantId);
  if (!settings.enabled) return null;
  const state = await getRegularState(deps.storage, tenantId);
  const firstRun = !state.lastRunAt;
  const ctx = await loadRegularsContext(deps, tenantId, now);
  const result: RegularsRunResult = { customers: ctx.analyses.length, overdue: 0, alerts: 0, backlog: 0, won: 0 };
  for (const a of ctx.analyses) {
    const row = ctx.rows.get(a.customerNumber);
    // Erfolg: nach der Meldung bestellt
    if (row?.alertedAt && !row.wonAt && Date.parse(a.lastOrderAt) > row.alertedAt.getTime()) {
      const won = { ...row, wonAt: new Date(a.lastOrderAt), wonOrderNumber: null };
      await deps.saveRow(tenantId, won);
      ctx.rows.set(a.customerNumber, won);
      result.won++;
      await deps.insertActions(tenantId, [
        {
          occurredAt: a.lastOrderAt,
          kind: "regularWon",
          title: `Stammkunde hat wieder bestellt: ${a.company || a.customerNumber}`.slice(0, 300),
          description: `Nach der Meldung vom ${row.alertedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} (an ${row.recipient ?? "–"}) wieder bestellt.`,
          scope: { type: "shop", values: [] },
          source: "shopPulse",
          sourceKey: `regular:${a.customerNumber}:won:${a.lastOrderAt}`,
          actor: null,
        },
      ]);
    }
    // Altbestand erledigt sich, sobald der Kunde wieder bestellt hat
    if (row?.backlog && !a.overdue) await deps.saveRow(tenantId, { ...row, backlog: false });
    if (!a.overdue) continue;
    result.overdue++;
    if (firstRun && !row) {
      await deps.saveRow(tenantId, { customerNumber: a.customerNumber, backlog: true, alertedAt: null, alertLastOrderAt: null, recipient: null, recipientSource: null, wonAt: null, wonOrderNumber: null });
      result.backlog++;
      continue;
    }
    if (opts.silent || !mayAlert(a, ctx.rows.get(a.customerNumber), now)) continue;
    await sendAlert(deps, tenantId, a, ctx, now, null);
    result.alerts++;
  }
  await deps.storage.saveSetting(REGULAR_STATE_KEY, { lastRunAt: now.toISOString(), lastRunDay: berlinTime(now).day }, tenantId);
  return result;
}

export class RegularError extends Error {
  constructor(readonly reason: "notFound" | "notOverdue" | "recentlyAlerted") {
    super(reason);
  }
}

/** Knopf „Jetzt melden“ (auch für Altbestand); 90-Tage-Regel gilt weiter */
export async function alertRegularNow(deps: RegularDeps, tenantId: string | null, customerNumber: string, by: string, now = new Date()): Promise<ShopPulseRegularCustomer> {
  const ctx = await loadRegularsContext(deps, tenantId, now);
  const a = ctx.analyses.find((x) => x.customerNumber === customerNumber);
  if (!a) throw new RegularError("notFound");
  if (!a.overdue) throw new RegularError("notOverdue");
  if (!mayAlert(a, ctx.rows.get(customerNumber), now, true)) throw new RegularError("recentlyAlerted");
  await sendAlert(deps, tenantId, a, ctx, now, by);
  return toCustomer(a, ctx);
}

// ---------------------------------------------------------------------------------------------
// Datenbank

export async function listRegularRows(tenantId: string | null): Promise<RegularRow[]> {
  const rows = await db.select().from(shopPulseRegulars).where(tenantIs(shopPulseRegulars.tenantId, tenantId));
  return rows.map((r) => ({
    customerNumber: r.customerNumber,
    backlog: r.backlog,
    alertedAt: r.alertedAt,
    alertLastOrderAt: r.alertLastOrderAt,
    recipient: r.recipient,
    recipientSource: r.recipientSource,
    wonAt: r.wonAt,
    wonOrderNumber: r.wonOrderNumber,
  }));
}

export async function saveRegularRow(tenantId: string | null, row: RegularRow & { alertMailed?: boolean; alertText?: string | null }): Promise<void> {
  const values = {
    backlog: row.backlog,
    alertedAt: row.alertedAt,
    alertLastOrderAt: row.alertLastOrderAt,
    recipient: row.recipient,
    recipientSource: row.recipientSource,
    wonAt: row.wonAt,
    wonOrderNumber: row.wonOrderNumber,
    ...(row.alertMailed !== undefined ? { alertMailed: row.alertMailed } : {}),
    ...(row.alertText !== undefined ? { alertText: row.alertText } : {}),
    updatedAt: new Date(),
  };
  const existing = await db
    .select({ id: shopPulseRegulars.id })
    .from(shopPulseRegulars)
    .where(and(eq(shopPulseRegulars.customerNumber, row.customerNumber), tenantIs(shopPulseRegulars.tenantId, tenantId)))
    .limit(1);
  if (existing[0]) await db.update(shopPulseRegulars).set(values).where(eq(shopPulseRegulars.id, existing[0].id));
  else await db.insert(shopPulseRegulars).values({ tenantId, customerNumber: row.customerNumber, ...values }).onConflictDoNothing();
}

/** Shop- und Portal-Bestellungen mit Kunde und Positionen aus dem Spiegel (alle Kanäle, je Nummer die zuletzt geänderte) */
export async function loadRegularOrders(tenantId: string | null, since: Date): Promise<RegularOrder[]> {
  const p = shopwareOrders.payload;
  const rows = await db
    .select({
      orderNumber: shopwareOrders.orderNumber,
      swUpdatedAt: shopwareOrders.swUpdatedAt,
      createdAt: sql<string | null>`${p}->>'createdAt'`,
      status: sql<string | null>`${p}->>'status'`,
      net: sql<string | null>`${p}->>'netTotalAmount'`,
      customerNumber: sql<string | null>`${p}->>'customerNumber'`,
      company: sql<string | null>`${p}->'billingAddress'->>'company'`,
      contactName: sql<string | null>`${p}->>'customerName'`,
      customerEmail: sql<string | null>`${p}->>'customerEmail'`,
      items: sql<unknown>`${p}->'items'`,
    })
    .from(shopwareOrders)
    .where(and(tenantIs(shopwareOrders.tenantId, tenantId), sql`(${p}->>'createdAt')::timestamptz >= ${since.toISOString()}::timestamptz`));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const n = String(r.orderNumber ?? "").trim();
    if (!n) continue;
    const prev = latest.get(n);
    if (!prev || (r.swUpdatedAt?.getTime() ?? 0) > (prev.swUpdatedAt?.getTime() ?? 0)) latest.set(n, r);
  }
  const out: RegularOrder[] = [];
  for (const [orderNumber, r] of Array.from(latest.entries())) {
    const createdAt = r.createdAt ? new Date(r.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
    out.push({
      orderNumber,
      customerNumber: String(r.customerNumber ?? "").trim(),
      company: String(r.company ?? "").trim(),
      contactName: String(r.contactName ?? "").trim(),
      customerEmail: String(r.customerEmail ?? "").trim(),
      createdAt,
      status: r.status ?? null,
      net: Number(r.net ?? 0) || 0,
      items: (Array.isArray(r.items) ? r.items : [])
        .map((i: any) => ({ productNumber: String(i?.productNumber ?? "").trim(), name: String(i?.name ?? "").trim(), quantity: Number(i?.quantity ?? 0) || 0, netTotal: Number(i?.netTotal ?? 0) || 0 }))
        .filter((i) => i.productNumber),
    });
  }
  return out;
}

/** Kaufbarkeit und Lieferzeit der Artikel aus dem Produktspiegel */
export async function loadRegularProducts(tenantId: string | null): Promise<Map<string, RegularProductInfo>> {
  const p = shopwareProducts.payload;
  const rows = await db
    .select({
      productNumber: shopwareProducts.productNumber,
      name: shopwareProducts.name,
      active: shopwareProducts.active,
      restockTime: sql<string | null>`${p}->>'restockTime'`,
      deliveryMax: sql<string | null>`${p}->>'deliveryTimeMax'`,
      deliveryUnit: sql<string | null>`${p}->>'deliveryTimeUnit'`,
    })
    .from(shopwareProducts)
    .where(tenantIs(shopwareProducts.tenantId, tenantId));
  const out = new Map<string, RegularProductInfo>();
  for (const r of rows) {
    // Kaufbar = aktiv (Portal-Kunden kaufen auch Artikel, die nicht im DE-Shop stehen)
    out.set(r.productNumber, {
      name: String(r.name ?? r.productNumber),
      sellable: r.active === true,
      restockTime: r.restockTime != null && r.restockTime !== "" ? Number(r.restockTime) : null,
      deliveryTimeMaxDays: deliveryMaxDays(r.deliveryMax, r.deliveryUnit),
    });
  }
  return out;
}

export const loadRegularPriceChanges = (tenantId: string | null, since: Date) => loadPriceChanges(tenantId, since);
