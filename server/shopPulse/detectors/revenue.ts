/**
 * Shop-Puls, Umsatz-Prüfungen aus dem Bestellspiegel (Konzept Stufe 1, Abschnitt 2A; PR B). Alle rein auf
 * den Shop-Bestellungen (pulseOrders.ts), Tests in tests/unit/shopPulseRevenue.test.ts.
 *
 * Der Shop hat nur rund 4–5 MO-Bestellungen pro Werktag (Live, 90 Tage bis 17.10.2026). Stundenweise
 * Vergleiche wären Zufall; die Regeln prüfen deshalb ganze Vormittage, Wochen und Zahlarten und melden
 * nur „Warnung“ (Tagesbericht). „Kritisch“ wird eine Bestell-Lücke erst, wenn spätere Prüfungen
 * (Warenkorb-Probe, GA4) sie bestätigen.
 *
 * Alle drei setzen aus, solange der Bestellabgleich hängt (Spiegel-Frische), sonst wären es Fehlalarme.
 */
import type { ShopPulseDetection } from "@shared/shopPulse";
import { addDays, berlinTime, weekdayOfDay, type PulseOrder } from "../pulseOrders";
import type { ShopPulseDetector } from "./types";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

function byDay(orders: PulseOrder[]): Map<string, PulseOrder[]> {
  const m = new Map<string, PulseOrder[]>();
  for (const o of orders) {
    const list = m.get(o.day);
    if (list) list.push(o);
    else m.set(o.day, [o]);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Bestell-Lücke

/** Ab dieser Stunde (Berlin) wird geprüft, ob der Tag noch ohne Bestellung ist */
export const ORDER_GAP_FROM_HOUR = 15;
/** So viele Bestellungen bis 15 Uhr müssen an den Vergleichstagen im Schnitt üblich sein */
export const ORDER_GAP_MIN_EXPECTED = 3;
const ORDER_GAP_WEEKS = 8;

/**
 * Werktag, ab 15 Uhr, heute noch keine Shop-Bestellung, obwohl an den letzten 8 gleichen Wochentagen bis
 * 15 Uhr im Schnitt mehr als 3 kamen (Wahrscheinlichkeit für 0 bei 3,3 erwarteten: rund 4 %). Bleibt
 * offen, bis eine Bestellung kommt oder der Tag endet. Geschätzter Verlust: üblicher Umsatz einer
 * Geschäftsstunde (7–19 Uhr) an den Vergleichstagen.
 */
export function orderGapDetections(orders: PulseOrder[], now: Date): ShopPulseDetection[] {
  const { day, hour, weekday } = berlinTime(now);
  if (weekday > 5 || hour < ORDER_GAP_FROM_HOUR) return [];
  const days = byDay(orders);
  if (days.get(day)?.length) return [];
  const compare = Array.from({ length: ORDER_GAP_WEEKS }, (_, k) => addDays(day, -7 * (k + 1)));
  const counts = compare.map((d) => (days.get(d) ?? []).filter((o) => o.hour < ORDER_GAP_FROM_HOUR).length);
  const expected = mean(counts);
  if (expected <= ORDER_GAP_MIN_EXPECTED) return [];
  const businessRevenue = compare.map((d) => sum((days.get(d) ?? []).filter((o) => o.hour >= 7 && o.hour < 19).map((o) => o.total)));
  const lossPerHour = Math.round(mean(businessRevenue) / 12);
  return [
    {
      key: "revenue:order-gap",
      source: "revenue",
      code: "orderGap",
      severity: "warning",
      params: { expected: Math.round(expected) },
      evidence: { day, expected: round1(expected), compareDays: compare, counts, probabilityOfZero: round1(Math.exp(-expected) * 100) / 100 },
      lossPerHour: lossPerHour > 0 ? lossPerHour : null,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Zahlart verschwunden

export const PAYMENT_MIN_PER_WEEK = 3;
const PAYMENT_BASELINE_WEEKS = 8;
const PAYMENT_GAP_DAYS = 7;

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * Eine Zahlart mit sonst mindestens 3 Bestellungen pro Woche (8 Wochen vor den letzten 7 Tagen) hatte in
 * den letzten 7 Tagen (inkl. heute) keine einzige: Zahlart vermutlich kaputt oder ausgeblendet.
 */
export function paymentGoneDetections(orders: PulseOrder[], now: Date): ShopPulseDetection[] {
  const today = berlinTime(now).day;
  const recentFrom = addDays(today, -(PAYMENT_GAP_DAYS - 1));
  const baseFrom = addDays(recentFrom, -7 * PAYMENT_BASELINE_WEEKS);
  const base = new Map<string, number>();
  const recent = new Set<string>();
  const last = new Map<string, Date>();
  for (const o of orders) {
    if (!o.paymentMethod) continue;
    if (o.day >= recentFrom) recent.add(o.paymentMethod);
    else if (o.day >= baseFrom) base.set(o.paymentMethod, (base.get(o.paymentMethod) ?? 0) + 1);
    if (o.day < recentFrom) last.set(o.paymentMethod, o.createdAt);
  }
  const out: ShopPulseDetection[] = [];
  for (const [method, count] of Array.from(base.entries())) {
    const perWeek = count / PAYMENT_BASELINE_WEEKS;
    if (perWeek < PAYMENT_MIN_PER_WEEK || recent.has(method)) continue;
    out.push({
      key: `revenue:payment:${slug(method)}`,
      source: "revenue",
      code: "paymentGone",
      severity: "warning",
      params: { method: method.slice(0, 80), perWeek: Math.round(perWeek), days: PAYMENT_GAP_DAYS },
      evidence: { baselineFrom: baseFrom, baselineOrders: count, recentFrom, lastOrderAt: last.get(method)?.toISOString() ?? null },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Woche gegen die letzten 4 Wochen und die Vorjahreswoche

export type PeriodStats = { orders: number; revenue: number; aov: number };

export function periodStats(orders: PulseOrder[], fromDay: string, toDay: string): PeriodStats {
  const list = orders.filter((o) => o.day >= fromDay && o.day <= toDay);
  const revenue = sum(list.map((o) => o.total));
  return { orders: list.length, revenue, aov: list.length ? revenue / list.length : 0 };
}

/*
 * Schwellen nach dem Live-Spiegel (300 Tage bis 17.10.2026, gleitende 7-Tage-Fenster, an wie vielen Tagen
 * die Regel angeschlagen hätte): Bestellungen −30 % und > 2σ: 31 Tage (4–5 Phasen im Jahr). Umsatz und
 * Ø-Bestellwert schwanken mit einzelnen Großaufträgen stark – Umsatz −40 % gegen 4 Wochen allein: 86 Tage,
 * Ø-Bestellwert −30 %: 95 Tage. Darum beide erst ab −50 % gegen 4 Wochen UND Vorjahr: 29 bzw. 13 Tage.
 */
const ORDERS_DROP = 0.3;
const ORDERS_MIN_EXPECTED = 10;
const REVENUE_DROP = 0.5;
const AOV_DROP = 0.5;
const AOV_MIN_ORDERS = 10;
/** Vorjahres-Ø nur mit mindestens so vielen Bestellungen in der Vorjahreswoche */
const AOV_YEAR_MIN_ORDERS = 5;

/**
 * Die letzten 7 vollen Tage (bis gestern) gegen den Schnitt der 4 Wochen davor und dieselben 7 Tage
 * vor 52 Wochen (gleiche Wochentage). Gemeldet werden nur deutliche Einbrüche; mehr Umsatz ist kein
 * Fund. Ohne Vorjahresdaten zählt beim Umsatz und Ø-Bestellwert nur der 4-Wochen-Vergleich.
 */
export function weekComparisonDetections(orders: PulseOrder[], now: Date): ShopPulseDetection[] {
  const today = berlinTime(now).day;
  const to = addDays(today, -1);
  const window = (offsetDays: number) => periodStats(orders, addDays(to, -6 - offsetDays), addDays(to, -offsetDays));
  const cur = window(0);
  const prev = [1, 2, 3, 4].map((k) => window(7 * k));
  const yearAgo = window(364);
  const hasYearAgo = yearAgo.orders > 0;
  const expOrders = mean(prev.map((p) => p.orders));
  const expRevenue = mean(prev.map((p) => p.revenue));
  const prevOrders = sum(prev.map((p) => p.orders));
  const expAov = prevOrders ? sum(prev.map((p) => p.revenue)) / prevOrders : 0;
  const pct = (curV: number, expV: number) => Math.round((1 - curV / expV) * 100);
  const common = { from: addDays(to, -6), to, yearOrders: yearAgo.orders, yearRevenue: Math.round(yearAgo.revenue) };
  const evidence = { current: cur, previous4: prev, yearAgo, hasYearAgo };
  const out: ShopPulseDetection[] = [];

  if (expOrders >= ORDERS_MIN_EXPECTED && cur.orders < expOrders * (1 - ORDERS_DROP) && expOrders - cur.orders > 2 * Math.sqrt(expOrders)) {
    out.push({
      key: "revenue:week:orders",
      source: "revenue",
      code: "weekOrdersDown",
      severity: "warning",
      params: { ...common, current: cur.orders, expected: Math.round(expOrders), pct: pct(cur.orders, expOrders) },
      evidence,
    });
  }

  const yearRevenueDrop = hasYearAgo && yearAgo.revenue > 0 ? 1 - cur.revenue / yearAgo.revenue : null;
  if (expRevenue > 0 && 1 - cur.revenue / expRevenue >= REVENUE_DROP && (yearRevenueDrop === null || yearRevenueDrop >= REVENUE_DROP)) {
    out.push({
      key: "revenue:week:revenue",
      source: "revenue",
      code: "weekRevenueDown",
      severity: "warning",
      params: { ...common, current: Math.round(cur.revenue), expected: Math.round(expRevenue), pct: pct(cur.revenue, expRevenue) },
      evidence,
    });
  }

  const yearAov = yearAgo.orders >= AOV_YEAR_MIN_ORDERS ? yearAgo.aov : null;
  if (cur.orders >= AOV_MIN_ORDERS && expAov > 0 && 1 - cur.aov / expAov >= AOV_DROP && (yearAov === null || 1 - cur.aov / yearAov >= AOV_DROP)) {
    out.push({
      key: "revenue:week:aov",
      source: "revenue",
      code: "weekAovDown",
      severity: "warning",
      params: { ...common, current: Math.round(cur.aov), expected: Math.round(expAov), pct: pct(cur.aov, expAov) },
      evidence,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Zahlen für den Tagesbericht

export type DailyNumbers = {
  /** "yesterday" bzw. am Montag "weekend" (Samstag + Sonntag) */
  period: "yesterday" | "weekend";
  days: string[];
  current: PeriodStats;
  /** Schnitt derselben Wochentage der 4 Wochen davor */
  previous4: PeriodStats;
  /** dieselben Wochentage vor 52 Wochen; null ohne Daten */
  yearAgo: PeriodStats | null;
};

/** Gestern (am Montag: das Wochenende) mit Vergleich; Sonntags gibt es keinen Bericht */
export function dailyNumbers(orders: PulseOrder[], now: Date): DailyNumbers {
  const today = berlinTime(now).day;
  const monday = weekdayOfDay(today) === 1;
  const days = monday ? [addDays(today, -2), addDays(today, -1)] : [addDays(today, -1)];
  const stats = (offset: number) => periodStats(orders, addDays(days[0], -offset), addDays(days[days.length - 1], -offset));
  const prev = [1, 2, 3, 4].map((k) => stats(7 * k));
  const prevOrders = sum(prev.map((p) => p.orders));
  const prevRevenue = sum(prev.map((p) => p.revenue));
  const yearAgo = stats(364);
  return {
    period: monday ? "weekend" : "yesterday",
    days,
    current: stats(0),
    previous4: { orders: prevOrders / 4, revenue: prevRevenue / 4, aov: prevOrders ? prevRevenue / prevOrders : 0 },
    yearAgo: yearAgo.orders > 0 ? yearAgo : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Detektoren

export const orderGapDetector: ShopPulseDetector = {
  id: "orderGap",
  source: "revenue",
  needsFreshMirror: true,
  async run({ orders, now }) {
    return orderGapDetections(await orders(), now);
  },
};

export const paymentGoneDetector: ShopPulseDetector = {
  id: "paymentGone",
  source: "revenue",
  needsFreshMirror: true,
  async run({ orders, now }) {
    return paymentGoneDetections(await orders(), now);
  },
};

export const weekComparisonDetector: ShopPulseDetector = {
  id: "weekComparison",
  source: "revenue",
  needsFreshMirror: true,
  async run({ orders, now }) {
    return weekComparisonDetections(await orders(), now);
  },
};
