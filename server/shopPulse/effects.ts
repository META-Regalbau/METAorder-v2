/**
 * Shop-Puls Stufe 2 (S2-6), Wirkung messen: Rechnung je Maßnahme, rein und ohne Datenbank (Tests in
 * tests/unit/shopPulseEffects.test.ts). Regeln und Typen in shared/shopPulseEffects.ts; den Lauf (Daten
 * laden, GA4, speichern) macht effectsRun.ts.
 *
 * Je Maßnahme und Zeitraum (14 bzw. 28 Tage) werden die MO-Bestellungen tageweise in „Bereich“ und „übriger
 * Shop“ geteilt:
 * - Artikel: Positionen dieser Artikel gegen die übrigen Positionen; Bestellungen mit mindestens einer
 *   Position im Bereich gegen Bestellungen ohne
 * - Kanal: Bestellungen dieses Verkaufskanals gegen die übrigen
 * - ganzer Shop: alles; Vergleich sind die gleichen Tage 52 Wochen davor
 * - Seiten: nicht zuordenbar (nur frühe Signale)
 *
 * Wirkung = nachher − vorher × (Vergleichsgruppe nachher / vorher), also die Differenz der Differenzen in
 * relativer Form (übriger Shop und Bereich sind verschieden groß). Die Schwankung kommt aus den Tageswerten:
 * Varianz einer Summe über n Tage = n × Varianz der Tageswerte (Tage ohne Bestellung zählen als 0), die der
 * Vergleichsgruppe geht über ihr Verhältnis ein (Delta-Methode). z = Wirkung / Schwankung.
 */
import {
  SHOP_PULSE_EFFECT_RULES as RULES,
  SHOP_PULSE_EFFECT_WINDOWS,
  type ShopPulseActionEffect,
  type ShopPulseEarlyMetric,
  type ShopPulseEarlySignal,
  type ShopPulseEffectControl,
  type ShopPulseEffectMetric,
  type ShopPulseEffectMetricId,
  type ShopPulseEffectOverlap,
  type ShopPulseEffectReason,
  type ShopPulseEffectVerdict,
  type ShopPulseEffectWindow,
  type ShopPulseEffectWindowDays,
  type ShopPulseWeeklyEffect,
} from "@shared/shopPulseEffects";
import type { ShopPulseAction, ShopPulseActionScope } from "@shared/shopPulseWeekly";
import { addDays, berlinTime, type PulseOrderItem } from "./pulseOrders";

/** Eine MO-Bestellung, so weit die Wirkungsmessung sie braucht */
export type EffectOrder = { day: string; channel: string | null; items: PulseOrderItem[] };

/** Herstellpreis netto je Einheit; null = keiner */
export type EffectHkOf = (productNumber: string) => number | null;

type Agg = { revenue: number; db1: number; covered: number; orders: number };
const emptyAgg = (): Agg => ({ revenue: 0, db1: 0, covered: 0, orders: 0 });

const round2 = (x: number) => Math.round(x * 100) / 100;
const round1 = (x: number) => Math.round(x * 10) / 10;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Varianz einer Summe über die Tage: n × Stichprobenvarianz der Tageswerte */
function sumVariance(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = sum(xs) / n;
  return (n * xs.reduce((s, x) => s + (x - mean) ** 2, 0)) / (n - 1);
}

/** Artikelnummern ohne Groß/Klein; Seiten als Pfad ohne Schrägstrich am Ende */
export const normProduct = (v: string) => v.trim().toUpperCase();
export function normPage(v: string): string {
  let path = v.trim();
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    // kein gültiger Link: so lassen
  }
  path = path.split(/[?#]/)[0].toLowerCase();
  if (!path.startsWith("/")) path = `/${path}`;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
const normChannel = (v: string) => v.trim().toLowerCase();

// ---------------------------------------------------------------------------------------------
// Tageswerte

/** Tageswerte im Bereich und im übrigen Shop (je Kalendertag) */
export type DailySplit = Map<string, { t: Agg; c: Agg }>;

/** Bestellungen nach Bereich teilen; null = Bereich lässt sich Bestellungen nicht zuordnen (Seiten) */
export function splitOrders(orders: EffectOrder[], scope: ShopPulseActionScope, hkOf: EffectHkOf | null): DailySplit | null {
  if (scope.type === "pages") return null;
  const products = scope.type === "products" ? new Set(scope.values.map(normProduct)) : null;
  const channels = scope.type === "channel" ? new Set(scope.values.map(normChannel)) : null;
  const out: DailySplit = new Map();
  const add = (agg: Agg, i: PulseOrderItem) => {
    agg.revenue += i.netTotal;
    const hk = hkOf?.(i.productNumber) ?? null;
    if (hk != null && hk > 0) {
      agg.db1 += i.netTotal - hk * i.quantity;
      agg.covered += i.netTotal;
    }
  };
  for (const o of orders) {
    const day = out.get(o.day) ?? { t: emptyAgg(), c: emptyAgg() };
    out.set(o.day, day);
    if (products) {
      let inScope = false;
      for (const i of o.items) {
        if (products.has(normProduct(i.productNumber))) {
          add(day.t, i);
          inScope = true;
        } else add(day.c, i);
      }
      if (inScope) day.t.orders += 1;
      else day.c.orders += 1;
      continue;
    }
    const treated = channels ? !!o.channel && channels.has(normChannel(o.channel)) : true;
    const agg = treated ? day.t : day.c;
    for (const i of o.items) add(agg, i);
    agg.orders += 1;
  }
  return out;
}

const daysOf = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

const series = (split: DailySplit, days: string[], group: "t" | "c", key: keyof Agg) => days.map((d) => split.get(d)?.[group][key] ?? 0);

// ---------------------------------------------------------------------------------------------
// Vergleich einer Kennzahl

/**
 * Vorher/nachher im Bereich gegen die Vergleichsgruppe (Tageswerte). Ohne Vergleichsgruppe (oder wenn sie
 * vorher oder nachher nichts hat) ist „erwartet“ einfach „vorher“.
 */
export function compareMetric(tPre: number[], tPost: number[], cPre: number[] | null, cPost: number[] | null): ShopPulseEffectMetric {
  const Tpre = sum(tPre);
  const Tpost = sum(tPost);
  const Cpre = cPre ? sum(cPre) : 0;
  const Cpost = cPost ? sum(cPost) : 0;
  const hasControl = !!cPre && !!cPost && Cpre > 0 && Cpost > 0;
  const r = hasControl ? Cpost / Cpre : 1;
  const expected = Tpre * r;
  const effect = Tpost - expected;
  let variance = sumVariance(tPost) + r * r * sumVariance(tPre);
  if (hasControl) variance += Tpre * Tpre * r * r * (sumVariance(cPost!) / (Cpost * Cpost) + sumVariance(cPre!) / (Cpre * Cpre));
  const se = Math.sqrt(variance);
  return {
    pre: round2(Tpre),
    post: round2(Tpost),
    expected: round2(expected),
    controlChangePercent: hasControl ? round1((r - 1) * 100) : null,
    effect: round2(effect),
    effectPercent: expected !== 0 ? round1((effect / Math.abs(expected)) * 100) : null,
    z: se > 0 ? round2(effect / se) : null,
    detectablePercent: se > 0 && expected !== 0 ? Math.round(((RULES.zSure * se) / Math.abs(expected)) * 100) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Überlagernde Maßnahmen

/** Bereiche überschneiden sich (Shop nur mit Shop, Kanal mit gleichem Kanal oder Shop, sonst gemeinsame Werte) */
export function scopesOverlap(a: ShopPulseActionScope, b: ShopPulseActionScope): boolean {
  if (a.type === "shop") return b.type === "shop";
  if (a.type === "channel") {
    if (b.type === "shop") return true;
    if (b.type !== "channel") return false;
  } else if (b.type !== a.type) return false;
  const norm = a.type === "products" ? normProduct : a.type === "pages" ? normPage : normChannel;
  const set = new Set(a.values.map(norm));
  return b.values.some((v) => set.has(norm(v)));
}

const MAX_DAYS = Math.max(...SHOP_PULSE_EFFECT_WINDOWS);

/** Andere Maßnahmen im selben Bereich in den 28 Tagen davor und danach (einschließlich des Tags selbst) */
export function overlapsOf(action: ShopPulseAction, all: ShopPulseAction[]): ShopPulseEffectOverlap[] {
  const day = berlinTime(new Date(action.occurredAt)).day;
  const from = addDays(day, -MAX_DAYS);
  const to = addDays(day, MAX_DAYS);
  return all
    .filter((o) => o.id !== action.id)
    .filter((o) => {
      const d = berlinTime(new Date(o.occurredAt)).day;
      return d >= from && d <= to && scopesOverlap(action.scope, o.scope);
    })
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .map((o) => ({ id: o.id, occurredAt: o.occurredAt, title: o.title, kind: o.kind }));
}

// ---------------------------------------------------------------------------------------------
// Zeitraum und Einstufung

export type EffectContext = {
  /** Tag der Maßnahme (Berlin) */
  day: string;
  scope: ShopPulseActionScope;
  /** Bereich/übriger Shop je Tag; null = Bereich nicht zuordenbar */
  split: DailySplit | null;
  /** heute (Berlin); vollständig sind Tage bis gestern */
  today: string;
  /** erster Tag mit Bestellungen im Spiegel; null = keine */
  dataFrom: string | null;
  overlaps: ShopPulseEffectOverlap[];
  /** Herstellpreise vorhanden (sonst kein Deckungsbeitrag) */
  withDb1: boolean;
};

const NO_METRICS: Record<ShopPulseEffectMetricId, ShopPulseEffectMetric | null> = { db1: null, revenue: null, orders: null };

export function evaluateWindow(days: ShopPulseEffectWindowDays, ctx: EffectContext): ShopPulseEffectWindow {
  const pre = { from: addDays(ctx.day, -days), to: addDays(ctx.day, -1) };
  const post = { from: addDays(ctx.day, 1), to: addDays(ctx.day, days) };
  const complete = post.to < ctx.today;
  const base = { days, pre, post, complete, control: "none" as ShopPulseEffectControl, main: "db1" as const, metrics: NO_METRICS, db1CoveragePercent: null };
  if (!ctx.split) return { ...base, verdict: "notMeasurable", reasons: ["pagesNotAttributable"] };
  if (!complete) return { ...base, verdict: "pending", reasons: [] };
  if (!ctx.dataFrom || ctx.dataFrom > pre.from) return { ...base, verdict: "notMeasurable", reasons: ["noHistory"] };

  const split = ctx.split;
  const preDays = daysOf(pre.from, pre.to);
  const postDays = daysOf(post.from, post.to);
  const ordersPre = sum(series(split, preDays, "t", "orders"));
  const ordersPost = sum(series(split, postDays, "t", "orders"));
  if (ctx.scope.type === "channel" && ordersPre + ordersPost === 0) return { ...base, verdict: "notMeasurable", reasons: ["channelNoOrders"] };

  // Vergleichsgruppe: übriger Shop, wenn er vorher und nachher Bestellungen hat; sonst die gleichen Tage
  // 52 Wochen davor, wenn der Spiegel so weit reicht
  const restOk = ctx.scope.type !== "shop" && sum(series(split, preDays, "c", "orders")) > 0 && sum(series(split, postDays, "c", "orders")) > 0;
  const yearAgoOk = !restOk && ctx.dataFrom <= addDays(pre.from, -364);
  const control: ShopPulseEffectControl = restOk ? "rest" : yearAgoOk ? "yearAgo" : "none";
  const shift = (list: string[]) => list.map((d) => addDays(d, -364));
  const metric = (key: keyof Agg) => {
    const tPre = series(split, preDays, "t", key);
    const tPost = series(split, postDays, "t", key);
    if (control === "rest") return compareMetric(tPre, tPost, series(split, preDays, "c", key), series(split, postDays, "c", key));
    if (control === "yearAgo") return compareMetric(tPre, tPost, series(split, shift(preDays), "t", key), series(split, shift(postDays), "t", key));
    return compareMetric(tPre, tPost, null, null);
  };
  const revenue = metric("revenue");
  const orders = metric("orders");
  const covered = sum(series(split, [...preDays, ...postDays], "t", "covered"));
  const totalRevenue = revenue.pre + revenue.post;
  const db1CoveragePercent = ctx.withDb1 && totalRevenue > 0 ? round1((covered / totalRevenue) * 100) : null;
  const db1 = ctx.withDb1 && covered > 0 ? metric("db1") : null;
  const main = db1 && db1CoveragePercent != null && db1CoveragePercent >= RULES.minDb1CoveragePercent ? "db1" : "revenue";

  const reasons: ShopPulseEffectReason[] = [];
  if (main === "revenue") reasons.push("db1Coverage");
  let verdict: ShopPulseEffectVerdict;
  if (ordersPre + ordersPost < RULES.minOrdersMeasurable) {
    verdict = "notMeasurable";
    reasons.unshift("tooFewOrders");
  } else {
    if (days < RULES.sureWindowDays) reasons.push("windowShort");
    if (ordersPre < RULES.minOrdersSure || ordersPost < RULES.minOrdersSure) reasons.push("fewOrders");
    if (control === "none") reasons.push("noControl");
    if (ctx.overlaps.some((o) => {
      const d = berlinTime(new Date(o.occurredAt)).day;
      return d >= pre.from && d <= post.to;
    }))
      reasons.push("overlap");
    const z = (main === "db1" ? db1 : revenue)?.z ?? null;
    if (z == null || Math.abs(z) < RULES.zSure) reasons.push("weak");
    verdict = reasons.some((r) => r !== "db1Coverage") ? "unsure" : "sure";
  }
  return { ...base, control, main, metrics: { db1, revenue, orders }, db1CoveragePercent, verdict, reasons };
}

/** Wirkung einer Maßnahme: beide Zeiträume, Einstufung aus 28 Tagen (wenn vorbei), sonst aus 14 Tagen */
export function evaluateAction(
  action: ShopPulseAction,
  input: { orders: EffectOrder[]; hkOf: EffectHkOf | null; now: Date; dataFrom: string | null; allActions: ShopPulseAction[] },
): Omit<ShopPulseActionEffect, "early"> {
  const day = berlinTime(new Date(action.occurredAt)).day;
  const overlaps = overlapsOf(action, input.allActions);
  const ctx: EffectContext = {
    day,
    scope: action.scope,
    split: splitOrders(input.orders, action.scope, input.hkOf),
    today: berlinTime(input.now).day,
    dataFrom: input.dataFrom,
    overlaps,
    withDb1: !!input.hkOf,
  };
  const windows = SHOP_PULSE_EFFECT_WINDOWS.map((d) => evaluateWindow(d, ctx));
  const headline = [...windows].reverse().find((w) => w.complete && w.verdict !== "pending") ?? null;
  const verdict: ShopPulseEffectVerdict = headline?.verdict ?? (windows.some((w) => w.verdict === "notMeasurable" && w.reasons.includes("pagesNotAttributable")) ? "notMeasurable" : "pending");
  return { actionId: action.id, computedAt: input.now.toISOString(), day, scope: action.scope, verdict, headlineDays: headline?.days ?? null, windows, overlaps };
}

/** Der längste abgeschlossene Zeitraum (für frühe Signale); null = noch keiner */
export function longestCompleteWindow(effect: Pick<ShopPulseActionEffect, "windows">): ShopPulseEffectWindow | null {
  return [...effect.windows].reverse().find((w) => w.complete) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Frühe Signale (GA4)

const changePct = (pre: number, post: number) => (pre > 0 ? round1(((post - pre) / pre) * 100) : null);

/** Frühes Signal aus Summen im Bereich und (optional) im ganzen Shop; übriger Shop = ganzer Shop − Bereich */
export function earlySignal(
  metric: ShopPulseEarlyMetric,
  days: ShopPulseEffectWindowDays,
  treated: { pre: number; post: number },
  total: { pre: number; post: number } | null,
): ShopPulseEarlySignal {
  const change = changePct(treated.pre, treated.post);
  const control = total ? changePct(total.pre - treated.pre, total.post - treated.post) : null;
  return {
    source: "ga4",
    metric,
    days,
    pre: round2(treated.pre),
    post: round2(treated.post),
    changePercent: change,
    controlChangePercent: control,
    relativePercent: change != null && control != null ? round1(change - control) : null,
  };
}

/** Conversion-Rate (Käufe je Sitzung in Prozent) vorher/nachher, ganzer Shop */
export function conversionSignal(days: ShopPulseEffectWindowDays, sessions: { pre: number; post: number }, purchases: { pre: number; post: number }): ShopPulseEarlySignal {
  const rate = (p: number, s: number) => (s > 0 ? (p / s) * 100 : 0);
  const pre = rate(purchases.pre, sessions.pre);
  const post = rate(purchases.post, sessions.post);
  return { source: "ga4", metric: "conversionPercent", days, pre: round2(pre), post: round2(post), changePercent: changePct(pre, post), controlChangePercent: null, relativePercent: null };
}

// ---------------------------------------------------------------------------------------------
// Wochenbericht

/** Gesicherte Wirkungen, deren 28 Tage in der Woche ab weekStart zu Ende gingen (größte Wirkung zuerst) */
export function weeklyEffects(effects: ShopPulseActionEffect[], actions: ShopPulseAction[], weekStart: string): ShopPulseWeeklyEffect[] {
  const weekEnd = addDays(weekStart, 6);
  const byId = new Map(actions.map((a) => [a.id, a]));
  const out: ShopPulseWeeklyEffect[] = [];
  for (const e of effects) {
    const action = byId.get(e.actionId);
    const w = e.windows.find((x) => x.days === RULES.sureWindowDays);
    if (!action || !w || w.verdict !== "sure" || w.post.to < weekStart || w.post.to > weekEnd) continue;
    const m = w.metrics[w.main];
    if (!m) continue;
    out.push({
      actionId: e.actionId,
      title: action.title,
      occurredAt: action.occurredAt,
      scope: { type: action.scope.type, values: action.scope.values.slice(0, 20) },
      main: w.main,
      effect: m.effect,
      effectPercent: m.effectPercent,
      revenueEffect: w.metrics.revenue?.effect ?? null,
      positive: m.effect > 0,
      postTo: w.post.to,
    });
  }
  return out.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}
