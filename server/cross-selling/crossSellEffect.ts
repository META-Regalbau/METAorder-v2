// Wirkungsmessung fuer Cross-Selling-Paare im Shop (reine Funktionen).
// Kennzahl: Anteil der Shop-Bestellungen (MO) mit der Quelle, die auch das Ziel enthalten
// ("Mitnahmequote"), 365 Tage vor dem Setzen gegen die Zeit danach. Bei wenigen Bestellungen
// gibt es bewusst kein Urteil. Ein Urteil fuehrt nie selbst zu einer Aenderung.
import type { Order } from "@shared/schema";
import { isMoOrderNumber } from "@shared/orderNumberFilter";

const DAY_MS = 24 * 60 * 60 * 1000;

export const EFFECT_BASELINE_DAYS = 365;
export const EFFECT_GRACE_DAYS = 7;
export const EFFECT_MIN_POST_DAYS = 90;
export const EFFECT_MIN_SOURCE_ORDERS = 30;
export const EFFECT_ZERO_HIT_ORDERS = 50;

export type EffectWindow = { from: string; to: string; sourceOrders: number; pairOrders: number; rate: number };

export type EffectResult = {
  verdict: "insufficient_data" | "positive" | "ineffective" | "inconclusive";
  baseline: EffectWindow;
  post: EffectWindow;
  /** Wahrscheinlichkeit, dass die Quote nach dem Setzen hoeher ist (Beta-Posterior, Normalnaeherung). */
  pBetter: number | null;
  /** 90-%-Obergrenze der Quote danach. */
  postUpper: number | null;
  computedAt: string;
};

function betaMoments(x: number, n: number): { mean: number; variance: number } {
  const a = 1 + x;
  const b = 1 + Math.max(0, n - x);
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
  return { mean, variance };
}

/** Standardnormalverteilung (Abramowitz-Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Bestellungen fuer die Messung vorbereiten: nur MO, ohne Stornos, je Bestellung die Familien. */
export function prepareEffectOrders(orders: Order[], canonical: (pn: string) => string): Array<{ at: number; families: Set<string> }> {
  const out: Array<{ at: number; families: Set<string> }> = [];
  for (const o of orders) {
    if (!isMoOrderNumber(o.orderNumber)) continue;
    if (o.status === "cancelled" || o.paymentStatus === "refunded" || o.paymentStatus === "cancelled") continue;
    const at = new Date(o.orderDate || 0).getTime();
    if (!Number.isFinite(at)) continue;
    const families = new Set((o.items || []).map((i) => (i.productNumber || "").trim()).filter(Boolean).map(canonical));
    if (families.size > 0) out.push({ at, families });
  }
  return out;
}

function windowStats(orders: Array<{ at: number; families: Set<string> }>, source: string, target: string, from: number, to: number): EffectWindow {
  let sourceOrders = 0;
  let pairOrders = 0;
  for (const o of orders) {
    if (o.at < from || o.at >= to || !o.families.has(source)) continue;
    sourceOrders += 1;
    if (o.families.has(target)) pairOrders += 1;
  }
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    sourceOrders,
    pairOrders,
    rate: sourceOrders > 0 ? pairOrders / sourceOrders : 0,
  };
}

/**
 * Urteil fuer ein Paar, das seit `appliedAt` im Shop steht.
 * - insufficient_data: weniger als 90 Tage oder weniger als `minSourceOrders` Bestellungen danach
 * - positive: Quote mit mindestens 90 % Wahrscheinlichkeit gestiegen
 * - ineffective: >= 50 Bestellungen danach ohne einen Treffer, oder kaum Chance auf Besserung
 *   und Quote sicher unter 2 %
 * - inconclusive: alles dazwischen
 */
export function computeCrossSellEffect(
  orders: Array<{ at: number; families: Set<string> }>,
  source: string,
  target: string,
  appliedAt: Date,
  now: Date,
  opts: { minSourceOrders?: number } = {},
): EffectResult {
  const t0 = appliedAt.getTime();
  const baseline = windowStats(orders, source, target, t0 - EFFECT_BASELINE_DAYS * DAY_MS, t0);
  const postFrom = t0 + EFFECT_GRACE_DAYS * DAY_MS;
  const post = windowStats(orders, source, target, postFrom, now.getTime());
  const minSourceOrders = opts.minSourceOrders ?? EFFECT_MIN_SOURCE_ORDERS;
  const result: EffectResult = { verdict: "insufficient_data", baseline, post, pBetter: null, postUpper: null, computedAt: now.toISOString() };
  const postDays = (now.getTime() - t0) / DAY_MS;
  if (postDays < EFFECT_MIN_POST_DAYS || post.sourceOrders < minSourceOrders) return result;

  const b = betaMoments(baseline.pairOrders, baseline.sourceOrders);
  const p = betaMoments(post.pairOrders, post.sourceOrders);
  const pBetter = normalCdf((p.mean - b.mean) / Math.sqrt(b.variance + p.variance));
  const postUpper = Math.min(1, p.mean + 1.2816 * Math.sqrt(p.variance));
  result.pBetter = pBetter;
  result.postUpper = postUpper;

  const zeroHitThreshold = Math.max(EFFECT_ZERO_HIT_ORDERS, Math.ceil(minSourceOrders * (EFFECT_ZERO_HIT_ORDERS / EFFECT_MIN_SOURCE_ORDERS)));
  if (pBetter >= 0.9) result.verdict = "positive";
  else if ((post.pairOrders === 0 && post.sourceOrders >= zeroHitThreshold) || (pBetter <= 0.2 && postUpper < 0.02)) result.verdict = "ineffective";
  else result.verdict = "inconclusive";
  return result;
}
