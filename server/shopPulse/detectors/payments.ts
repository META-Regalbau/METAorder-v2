/**
 * Shop-Puls Stufe 3 (S3-3), Zahlungsanbieter-Wache (Konzept 19.10.2026, Abschnitt 3; Tests in
 * tests/unit/shopPulsePayments.test.ts).
 *
 * Anlass: Die Mollie-Kartenzahlung scheiterte ab dem 13.09.2026 bei jedem Versuch, und niemand merkte es.
 * „Zahlart verschwunden“ (Stufe 1) griff nicht, weil die Bestellungen angelegt werden – sie bleiben nur
 * unbezahlt. Darum zählt hier der Zahlungsstatus der Shop-Bestellungen (MO, auch stornierte, je Nummer die
 * zuletzt geänderte) aus dem Bestellspiegel, ohne Zugang bei den Anbietern:
 *
 * - Online-Zahlarten (Karte, Apple/Google Pay, PayPal, Echtzeitüberweisung, Mondu): Fehlschlag = Zahlung
 *   „fehlgeschlagen“ oder „abgebrochen“, oder nach 24 Stunden noch „offen“. Bei Vorkasse, „wie vereinbart“
 *   und Rechnung ist „offen“ normal, dort zählt nur „fehlgeschlagen“.
 * - Kritisch: zwei Fehlschläge in Folge (ohne Erfolg dazwischen) bei einer Zahlart, die sonst klappt
 *   (180 Tage davor mindestens 3 erfolgreiche Zahlungen und mindestens die Hälfte erfolgreich), der letzte
 *   Fehlschlag höchstens 30 Tage alt. Erledigt sich mit der nächsten erfolgreichen Zahlung.
 * - Warnung: Fehlerquote der letzten 14 Tage mindestens 50 % (mindestens 2 Fehlschläge) und mindestens
 *   doppelt so hoch wie in den 180 Tagen davor; nicht zusätzlich zur kritischen Meldung derselben Zahlart.
 * - Warnung: hängende Online-Zahlungen (offen seit mehr als 24 Stunden, Bestellung nicht storniert, höchstens
 *   30 Tage alt) als Liste; bei Mondu mit Verweis auf „Mondu-Zahlung erneut senden“ (#184).
 *
 * Rückblick am Live-Spiegel (19.10.2026): Die Regel hätte die Karte am 23.09.2026 kritisch gemeldet
 * (Fehlschläge 14.09. und 23.09. nach der letzten Zahlung am 13.09.), statt gar nicht. Seit dem 17.10.2026 heißt
 * die Karte „Kredit- oder Debitkarte“ (PayPal ACDC); die alte Meldung läuft 30 Tage nach dem letzten
 * Fehlschlag aus. Der erste Lauf meldet den Altbestand still (nur Tagesbericht).
 */
import type { ShopPulseDetection } from "@shared/shopPulse";
import { addDays, berlinTime } from "../pulseOrders";
import type { ShopPulseDetector } from "./types";

export type PaymentOrder = {
  orderNumber: string;
  createdAt: Date;
  method: string | null;
  /** Zahlungsstatus laut Shopware (paid, authorized, open, failed, cancelled, …) */
  paymentStatus: string | null;
  /** Bestellstatus (open, in_progress, completed, cancelled) */
  orderStatus: string | null;
  total: number;
};

export type PaymentOutcome = "success" | "failed" | "pending" | "ignore";

export const PAYMENT_RULES = {
  /** Offene Online-Zahlung gilt danach als hängend bzw. gescheitert */
  pendingHours: 24,
  streakMin: 2,
  streakMaxAgeDays: 30,
  baselineDays: 180,
  baselineMinSuccess: 3,
  baselineMinShare: 0.5,
  rateWindowDays: 14,
  rateMinFails: 2,
  rateMinShare: 0.5,
  rateFactor: 2,
  pendingMaxAgeDays: 30,
} as const;

const ONLINE = /karte|card|apple\s*pay|google\s*pay|paypal|echtzeit|sofort|klarna|giropay|\beps\b|ideal|mondu|rechnungskauf|lastschrift/i;
const MONDU = /mondu|rechnungskauf|lastschrift/i;
const SUCCESS = new Set(["paid", "paid_partially", "partially_paid", "authorized", "refunded", "refunded_partially", "partially_refunded", "chargeback"]);
const FAILED = new Set(["failed"]);
const PENDING = new Set(["open", "unconfirmed", "in_progress", "reminded"]);

export const isOnlineMethod = (method: string | null) => !!method && ONLINE.test(method);
export const isMonduMethod = (method: string | null) => !!method && MONDU.test(method);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Ergebnis einer Zahlung zum Zeitpunkt now (siehe Dateikopf) */
export function paymentOutcome(o: PaymentOrder, now: Date): PaymentOutcome {
  const ps = (o.paymentStatus ?? "").toLowerCase();
  if (SUCCESS.has(ps)) return "success";
  const online = isOnlineMethod(o.method);
  if (FAILED.has(ps)) return "failed";
  if (!online) return "ignore";
  if (ps === "cancelled") return "failed";
  if (PENDING.has(ps)) {
    if (o.orderStatus === "cancelled") return "failed";
    return now.getTime() - o.createdAt.getTime() >= PAYMENT_RULES.pendingHours * HOUR_MS ? "failed" : "pending";
  }
  return "ignore";
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60);
const round = (x: number) => Math.round(x);
const pct = (x: number) => Math.round(x * 1000) / 10;

/** Zahlungen je Zahlart, chronologisch, mit Ergebnis (ohne frische offene und ohne „normal offen“) */
export function attemptsByMethod(orders: PaymentOrder[], now: Date): Map<string, Array<PaymentOrder & { outcome: "success" | "failed" }>> {
  const out = new Map<string, Array<PaymentOrder & { outcome: "success" | "failed" }>>();
  for (const o of [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!o.method || o.createdAt.getTime() > now.getTime()) continue;
    const outcome = paymentOutcome(o, now);
    if (outcome !== "success" && outcome !== "failed") continue;
    const list = out.get(o.method) ?? [];
    list.push({ ...o, outcome });
    out.set(o.method, list);
  }
  return out;
}

export function paymentDetections(orders: PaymentOrder[], now: Date): ShopPulseDetection[] {
  const out: ShopPulseDetection[] = [];
  const critical = new Set<string>();
  const byMethod = attemptsByMethod(orders, now);

  // 1. Fehlschläge in Folge bei einer Zahlart, die sonst klappt
  for (const [method, attempts] of Array.from(byMethod.entries())) {
    let i = attempts.length;
    while (i > 0 && attempts[i - 1].outcome === "failed") i--;
    const streak = attempts.slice(i);
    if (streak.length < PAYMENT_RULES.streakMin) continue;
    const lastFail = streak[streak.length - 1].createdAt;
    if (now.getTime() - lastFail.getTime() > PAYMENT_RULES.streakMaxAgeDays * DAY_MS) continue;
    const from = streak[0].createdAt.getTime() - PAYMENT_RULES.baselineDays * DAY_MS;
    const base = attempts.slice(0, i).filter((a) => a.createdAt.getTime() >= from);
    const ok = base.filter((a) => a.outcome === "success");
    const lastSuccess = ok[ok.length - 1]?.createdAt ?? null;
    if (ok.length < PAYMENT_RULES.baselineMinSuccess || ok.length / base.length < PAYMENT_RULES.baselineMinShare) continue;
    critical.add(method);
    out.push({
      key: `revenue:payfail:${slug(method)}`,
      source: "revenue",
      code: "paymentFailStreak",
      severity: "critical",
      params: {
        method: method.slice(0, 80),
        count: streak.length,
        since: berlinTime(streak[0].createdAt).day,
        lastSuccess: lastSuccess ? berlinTime(lastSuccess).day : "",
        orders: streak.slice(-5).map((a) => a.orderNumber).join(", "),
      },
      evidence: {
        failures: streak.map((a) => ({ number: a.orderNumber, at: a.createdAt.toISOString(), status: a.paymentStatus, total: a.total })),
        baseline: { attempts: base.length, success: ok.length, from: new Date(from).toISOString() },
        lastSuccessAt: lastSuccess?.toISOString() ?? null,
      },
      lossPerHour: null,
    });
  }

  // 2. Fehlerquote der letzten 14 Tage gegen die 180 Tage davor
  const windowFrom = now.getTime() - PAYMENT_RULES.rateWindowDays * DAY_MS;
  const baseFrom = windowFrom - PAYMENT_RULES.baselineDays * DAY_MS;
  for (const [method, attempts] of Array.from(byMethod.entries())) {
    if (critical.has(method)) continue;
    const recent = attempts.filter((a) => a.createdAt.getTime() >= windowFrom);
    const fails = recent.filter((a) => a.outcome === "failed").length;
    if (fails < PAYMENT_RULES.rateMinFails || fails / recent.length < PAYMENT_RULES.rateMinShare) continue;
    const base = attempts.filter((a) => a.createdAt.getTime() >= baseFrom && a.createdAt.getTime() < windowFrom);
    const baseRate = base.length ? base.filter((a) => a.outcome === "failed").length / base.length : 0;
    if (base.length && fails / recent.length < baseRate * PAYMENT_RULES.rateFactor) continue;
    out.push({
      key: `revenue:payfail-rate:${slug(method)}`,
      source: "revenue",
      code: "paymentFailRate",
      severity: "warning",
      params: { method: method.slice(0, 80), fails, attempts: recent.length, share: pct(fails / recent.length), expected: pct(baseRate), days: PAYMENT_RULES.rateWindowDays },
      evidence: { failures: recent.filter((a) => a.outcome === "failed").map((a) => ({ number: a.orderNumber, at: a.createdAt.toISOString(), status: a.paymentStatus })), baseline: { attempts: base.length, rate: baseRate } },
    });
  }

  // 3. Hängende Online-Zahlungen
  const pending = orders
    .filter((o) => {
      const ps = (o.paymentStatus ?? "").toLowerCase();
      const age = now.getTime() - o.createdAt.getTime();
      return isOnlineMethod(o.method) && PENDING.has(ps) && o.orderStatus !== "cancelled" && age >= PAYMENT_RULES.pendingHours * HOUR_MS && age <= PAYMENT_RULES.pendingMaxAgeDays * DAY_MS;
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (pending.length) {
    out.push({
      key: "revenue:payment:pending",
      source: "revenue",
      code: "paymentsPending",
      severity: "warning",
      params: {
        count: pending.length,
        total: round(pending.reduce((s, o) => s + o.total, 0)),
        mondu: pending.filter((o) => isMonduMethod(o.method)).length,
        orders: pending.slice(0, 8).map((o) => o.orderNumber).join(", "),
      },
      evidence: {
        orders: pending.map((o) => ({ number: o.orderNumber, method: o.method, total: o.total, at: o.createdAt.toISOString(), status: o.paymentStatus, mondu: isMonduMethod(o.method) })),
      },
    });
  }
  return out;
}

/**
 * Rückblick zur Kontrolle der Schwellen: je Fund-Schlüssel die Zeiträume, in denen die Regel täglich um
 * 12 Uhr (Berlin, Sommerzeit-Näherung) angeschlagen hätte (Beginn, Ende, Schwere).
 */
export function backtestPayments(orders: PaymentOrder[], fromDay: string, toDay: string): Array<{ key: string; from: string; to: string; severity: string }> {
  const open = new Map<string, { from: string; to: string; severity: string }>();
  const episodes: Array<{ key: string; from: string; to: string; severity: string }> = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    const now = new Date(`${day}T10:00:00Z`);
    const found = new Map(paymentDetections(orders.filter((o) => o.createdAt.getTime() <= now.getTime()), now).map((d) => [d.key, d.severity]));
    for (const [key, ep] of Array.from(open.entries())) {
      if (found.has(key)) ep.to = day;
      else {
        episodes.push({ key, ...ep });
        open.delete(key);
      }
    }
    for (const [key, severity] of Array.from(found.entries())) if (!open.has(key)) open.set(key, { from: day, to: day, severity });
  }
  for (const [key, ep] of Array.from(open.entries())) episodes.push({ key, ...ep });
  return episodes.sort((x, y) => x.from.localeCompare(y.from));
}

export type PaymentSources = { orders: (since: Date) => Promise<PaymentOrder[]> };

export const paymentWatchDetector: ShopPulseDetector = {
  id: "paymentWatch",
  source: "revenue",
  needsFreshMirror: true,
  async run(ctx) {
    const since = new Date(ctx.now.getTime() - (PAYMENT_RULES.baselineDays + PAYMENT_RULES.rateWindowDays + PAYMENT_RULES.streakMaxAgeDays + 30) * DAY_MS);
    const found = paymentDetections(await ctx.payments.orders(since), ctx.now);
    // Erster Lauf nach dem Deploy: Altbestand still (Tagesbericht), keine Sofort-Meldung für längst Bekanntes
    return ctx.firstRun ? found.map((d) => ({ ...d, quiet: true })) : found;
  },
};
