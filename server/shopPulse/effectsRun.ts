/**
 * Shop-Puls Stufe 2 (S2-6), Wirkung messen: Lauf und Speicherung. Der Zeitplan (shopPulseScheduler.ts) rechnet
 * einmal am Tag ab 5 Uhr (Berlin) neu, der Wochenbericht vor dem Bauen, „Neu berechnen“ auf der Seite sofort.
 * Datenquellen sind austauschbar (Tests in tests/unit/shopPulseEffects.test.ts).
 *
 * Nur lesend: Bestell- und Produktspiegel, Herstellpreise, Maßnahmen-Protokoll aus der eigenen Datenbank;
 * GA4 nur, wenn eingerichtet. Frühe GA4-Signale werden je Maßnahme einmal je abgeschlossenem Zeitraum gelesen
 * (14, dann 28 Tage) und gespeichert; je Lauf höchstens GA4_ACTIONS_PER_RUN Maßnahmen, Abfragen nacheinander.
 */
import { and, eq, inArray, isNull, type AnyColumn } from "drizzle-orm";
import { shopPulseActionEffects, type ShopPulseActionEffectRow } from "@shared/schema";
import {
  SHOP_PULSE_EFFECT_RULES as RULES,
  SHOP_PULSE_EFFECT_VERDICTS,
  type ShopPulseActionEffect,
  type ShopPulseEarlySignal,
  type ShopPulseEffectWindow,
} from "@shared/shopPulseEffects";
import type { ShopPulseAction } from "@shared/shopPulseWeekly";
import type { IStorage } from "../storage";
import { db } from "../db";
import { logger } from "../lib/logger";
import { addDays, berlinTime, loadPulseOrders, type PulseOrder } from "./pulseOrders";
import { ga4Access, Ga4NotConfiguredError, type Ga4Property } from "./ga4Client";
import { listActions } from "./actionLogRepository";
import { conversionSignal, earlySignal, evaluateAction, longestCompleteWindow, normPage, type EffectOrder } from "./effects";
import { berlinMidnight } from "./weeklyReport";
import { loadHerstellpreiseForNumbers } from "./weeklyReportRun";

const log = logger.child({ component: "shopPulse/effectsRun" });

const DAY_MS = 24 * 60 * 60 * 1000;
/** So viele Maßnahmen bekommen je Lauf neue GA4-Signale (je bis zu 4 Abfragen) */
export const GA4_ACTIONS_PER_RUN = 8;
/** So viele Artikel bzw. Seiten gehen höchstens in den GA4-Filter */
const GA4_FILTER_MAX = 200;
/** Einmal am Tag ab dieser Stunde (Berlin) neu rechnen */
const EFFECTS_FROM_HOUR = 5;

export type ShopPulseEffectsDeps = {
  /** MO-Bestellungen mit Positionen und Verkaufskanal ab dem Zeitpunkt */
  loadOrders(tenantId: string | null, since: Date): Promise<PulseOrder[]>;
  herstellpreise(tenantId: string | null, productNumbers: string[]): Promise<Map<string, number>>;
  /** Maßnahmen ab dem Zeitpunkt (ohne gelöschte) */
  listActions(tenantId: string | null, since: Date): Promise<ShopPulseAction[]>;
  /** GA4-Property; wirft Ga4NotConfiguredError, wenn nicht eingerichtet */
  ga4(tenantId: string | null): Promise<Ga4Property>;
  listEffects(tenantId: string | null): Promise<ShopPulseActionEffect[]>;
  saveEffects(tenantId: string | null, effects: ShopPulseActionEffect[]): Promise<void>;
};

/** Neu rechnen fällig: ab 5 Uhr (Berlin), heute noch nicht */
export function isEffectsDue(lastDay: string | undefined, now: Date): boolean {
  const { day, hour } = berlinTime(now);
  return hour >= EFFECTS_FROM_HOUR && lastDay !== day;
}

const toEffectOrder = (o: PulseOrder): EffectOrder => ({ day: o.day, channel: o.channel ?? null, items: o.items ?? [] });

/** Frühe GA4-Signale des längsten abgeschlossenen Zeitraums (Abfragen nacheinander) */
export async function readEarlySignals(property: Ga4Property, effect: Pick<ShopPulseActionEffect, "scope">, w: ShopPulseEffectWindow): Promise<ShopPulseEarlySignal[]> {
  const total = async (metrics: string[], range: { from: string; to: string }, filter?: { field: string; inList: string[] }) => {
    const rows = await property.report({ dimensions: [], metrics, startDate: range.from, endDate: range.to, ...(filter ? { filter } : {}) });
    return metrics.map((_, i) => rows.reduce((s, r) => s + (r.m[i] ?? 0), 0));
  };
  const scope = effect.scope;
  if (scope.type === "products" || scope.type === "pages") {
    const metrics = scope.type === "products" ? ["itemsViewed", "itemsAddedToCart"] : ["sessions", "ecommercePurchases"];
    const values = scope.type === "products" ? scope.values : Array.from(new Set(scope.values.map(normPage)));
    const filter = { field: scope.type === "products" ? "itemId" : "landingPage", inList: values.slice(0, GA4_FILTER_MAX) };
    const tPre = await total(metrics, w.pre, filter);
    const tPost = await total(metrics, w.post, filter);
    const aPre = await total(metrics, w.pre);
    const aPost = await total(metrics, w.post);
    return metrics.map((m, i) => earlySignal(m as ShopPulseEarlySignal["metric"], w.days, { pre: tPre[i], post: tPost[i] }, { pre: aPre[i], post: aPost[i] }));
  }
  // ganzer Shop bzw. Kanal: GA4 kennt den Verkaufskanal nicht, also der ganze Shop ohne Vergleich
  const [sPre, pPre] = await total(["sessions", "ecommercePurchases"], w.pre);
  const [sPost, pPost] = await total(["sessions", "ecommercePurchases"], w.post);
  return [
    earlySignal("sessions", w.days, { pre: sPre, post: sPost }, null),
    earlySignal("ecommercePurchases", w.days, { pre: pPre, post: pPost }, null),
    conversionSignal(w.days, { pre: sPre, post: sPost }, { pre: pPre, post: pPost }),
  ];
}

export type EffectsRunResult = { effects: ShopPulseActionEffect[]; actions: ShopPulseAction[]; ga4Read: number };

/**
 * Wirkung aller Maßnahmen der letzten 180 Tage neu rechnen und speichern. Ältere behalten ihr letztes
 * Ergebnis. Liefert alle gespeicherten Wirkungen der aufgeführten Maßnahmen und die Maßnahmen selbst.
 */
export async function refreshEffects(deps: ShopPulseEffectsDeps, tenantId: string | null, now: Date, opts: { ga4Max?: number } = {}): Promise<EffectsRunResult> {
  const lookbackFrom = new Date(now.getTime() - RULES.lookbackDays * DAY_MS);
  const actions = await deps.listActions(tenantId, new Date(lookbackFrom.getTime() - 28 * DAY_MS));
  const stored = new Map((await deps.listEffects(tenantId)).map((e) => [e.actionId, e]));
  const toEvaluate = actions.filter((a) => Date.parse(a.occurredAt) >= lookbackFrom.getTime());
  if (!toEvaluate.length) return { effects: [], actions, ga4Read: 0 };

  // Bestellungen ab 28 Tage vor der ältesten Maßnahme, dazu ein Jahr für die Vergleichsgruppe „Vorjahr“
  const earliest = toEvaluate.reduce((m, a) => Math.min(m, Date.parse(a.occurredAt)), Number.POSITIVE_INFINITY);
  const earliestDay = berlinTime(new Date(earliest)).day;
  const pulseOrders = await deps.loadOrders(tenantId, berlinMidnight(addDays(earliestDay, -(28 + 364 + 1))));
  const orders = pulseOrders.map(toEffectOrder);
  const dataFrom = orders.length ? orders.reduce((m, o) => (o.day < m ? o.day : m), orders[0].day) : null;
  let hk: Map<string, number> | null = null;
  try {
    hk = await deps.herstellpreise(tenantId, Array.from(new Set(orders.flatMap((o) => o.items.map((i) => i.productNumber)))));
  } catch (err) {
    log.warn({ err, tenantId }, "Wirkung: Herstellpreise nicht gelesen, nur Umsatz");
  }
  const hkOf = hk ? (pn: string) => hk!.get(pn) ?? null : null;

  let property: Ga4Property | null = null;
  let ga4State: "unknown" | "ok" | "notConfigured" = "unknown";
  let ga4Budget = opts.ga4Max ?? GA4_ACTIONS_PER_RUN;
  let ga4Read = 0;
  const effects: ShopPulseActionEffect[] = [];
  for (const action of toEvaluate) {
    const base = evaluateAction(action, { orders, hkOf, now, dataFrom, allActions: actions });
    const w = longestCompleteWindow(base);
    const prev = stored.get(action.id)?.early ?? null;
    let early: ShopPulseActionEffect["early"] = w ? prev : { state: "pending", signals: [] };
    const fresh = !!prev && prev.state === "ok" && prev.signals.length > 0 && prev.signals[0].days === w?.days;
    if (w && !fresh && ga4State !== "notConfigured" && ga4Budget > 0) {
      try {
        if (ga4State === "unknown") {
          property = await deps.ga4(tenantId);
          ga4State = "ok";
        }
        ga4Budget -= 1;
        early = { state: "ok", signals: await readEarlySignals(property!, base, w) };
        ga4Read += 1;
      } catch (err) {
        if (err instanceof Ga4NotConfiguredError) {
          ga4State = "notConfigured";
        } else {
          early = { state: "error", signals: prev?.signals ?? [], error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
          log.warn({ err: early.error, tenantId, actionId: action.id }, "Wirkung: GA4-Signale nicht gelesen");
        }
      }
    }
    if (w && ga4State === "notConfigured" && !fresh) early = { state: "notConfigured", signals: [] };
    effects.push({ ...base, early });
  }
  await deps.saveEffects(tenantId, effects);
  const evaluated = new Set(effects.map((e) => e.actionId));
  const listed = new Set(actions.map((a) => a.id));
  const older = Array.from(stored.values()).filter((e) => !evaluated.has(e.actionId) && listed.has(e.actionId));
  return { effects: [...effects, ...older], actions, ga4Read };
}

// ---------------------------------------------------------------------------------------------
// Datenbank

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

export function rowToEffect(row: ShopPulseActionEffectRow): ShopPulseActionEffect {
  const data = row.data as ShopPulseActionEffect;
  const verdict = (SHOP_PULSE_EFFECT_VERDICTS as readonly string[]).includes(row.verdict) ? (row.verdict as ShopPulseActionEffect["verdict"]) : "pending";
  return { ...data, actionId: row.actionId, verdict, computedAt: row.computedAt.toISOString() };
}

export async function listEffects(tenantId: string | null): Promise<ShopPulseActionEffect[]> {
  const rows = await db.select().from(shopPulseActionEffects).where(tenantIs(shopPulseActionEffects.tenantId, tenantId));
  return rows.map(rowToEffect);
}

/** Wirkungen der berechneten Maßnahmen ersetzen (in einer Transaktion) */
export async function saveEffects(tenantId: string | null, effects: ShopPulseActionEffect[]): Promise<void> {
  if (!effects.length) return;
  await db.transaction(async (tx) => {
    const ids = effects.map((e) => e.actionId);
    for (let i = 0; i < ids.length; i += 500) {
      await tx.delete(shopPulseActionEffects).where(and(tenantIs(shopPulseActionEffects.tenantId, tenantId), inArray(shopPulseActionEffects.actionId, ids.slice(i, i + 500))));
    }
    for (let i = 0; i < effects.length; i += 100) {
      await tx.insert(shopPulseActionEffects).values(
        effects.slice(i, i + 100).map((e) => ({ tenantId, actionId: e.actionId, verdict: e.verdict, data: e, computedAt: new Date(e.computedAt) })),
      );
    }
  });
}

export function shopPulseEffectsDeps(storage: IStorage): ShopPulseEffectsDeps {
  return {
    loadOrders: (tenantId, since) => loadPulseOrders(tenantId, since, { items: true, channel: true }),
    herstellpreise: (tenantId, numbers) => loadHerstellpreiseForNumbers(storage, tenantId, numbers),
    listActions: (tenantId, since) => listActions(tenantId, { from: since, limit: 5000 }),
    ga4: (tenantId) => ga4Access(storage, tenantId).property(),
    listEffects,
    saveEffects,
  };
}
