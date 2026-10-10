// Bewertung von Cross-Selling-Kandidaten (reine Funktionen, ohne Datenbank).
// Kaufstatistik je Artikelfamilie mit vorsichtigen Untergrenzen (Wilson), damit wenige
// Bestellungen nicht als sichere Evidenz zaehlen; dazu KI-Urteil, Reaktionen und Freigaben.
import type { Order } from "@shared/schema";
import type { CrossSellAutomationSettings } from "./crossSellAutomationSettings";

/** Wilson-Untergrenze eines Anteils x/n (z = 1,645 entspricht 90 % einseitig). */
export function wilsonLowerBound(x: number, n: number, z = 1.645): number {
  if (n <= 0) return 0;
  const p = Math.min(1, Math.max(0, x / n));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (center - margin) / denom);
}

export type PairStats = {
  /** Bestellungen mit Quelle und Ziel */
  pairOrders: number;
  /** verschiedene Kunden unter diesen Bestellungen */
  distinctCustomers: number;
  sourceOrders: number;
  targetOrders: number;
  totalOrders: number;
  confLB: number;
  liftLB: number;
};

export type OrderBasketStats = {
  totalOrders: number;
  ordersByFamily: Map<string, number>;
  /** key "Quelle\0Ziel" (ungerichtet sortiert) -> Bestellungen und Kunden */
  pairs: Map<string, { orders: number; customers: Set<string> }>;
};

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

function isNegativeOrder(order: Order): boolean {
  return order.status === "cancelled" || order.paymentStatus === "refunded" || order.paymentStatus === "cancelled";
}

/** Kunde einer Bestellung: Kundennummer, sonst E-Mail. Sammelkunden zaehlen als ein Kunde. */
export function orderCustomerKey(order: Pick<Order, "customerNumber" | "customerEmail" | "orderNumber">): string {
  const cn = (order.customerNumber || "").trim();
  if (cn) return `c:${cn}`;
  const mail = (order.customerEmail || "").trim().toLowerCase();
  if (mail) return `m:${mail}`;
  return `o:${order.orderNumber}`;
}

/**
 * Warenkorb-Statistik je Artikelfamilie: nur Bestellungen ab `since`, ohne Stornos.
 * Varianten werden ueber `canonical` auf die Familie abgebildet.
 */
export function buildOrderBasketStats(
  orders: Order[],
  canonical: (productNumber: string) => string,
  since: Date,
): OrderBasketStats {
  const ordersByFamily = new Map<string, number>();
  const pairs = new Map<string, { orders: number; customers: Set<string> }>();
  let totalOrders = 0;
  const sinceMs = since.getTime();
  for (const order of orders) {
    if (isNegativeOrder(order)) continue;
    const when = new Date(order.orderDate || (order as any).createdAt || 0).getTime();
    if (!Number.isFinite(when) || when < sinceMs) continue;
    const families = Array.from(
      new Set(
        (order.items || [])
          .map((i) => (i.productNumber || "").trim())
          .filter(Boolean)
          .map((pn) => canonical(pn)),
      ),
    );
    if (families.length === 0) continue;
    totalOrders += 1;
    for (const f of families) ordersByFamily.set(f, (ordersByFamily.get(f) ?? 0) + 1);
    if (families.length < 2) continue;
    const customer = orderCustomerKey(order);
    for (let i = 0; i < families.length; i++) {
      for (let j = i + 1; j < families.length; j++) {
        const key = pairKey(families[i], families[j]);
        let entry = pairs.get(key);
        if (!entry) {
          entry = { orders: 0, customers: new Set() };
          pairs.set(key, entry);
        }
        entry.orders += 1;
        entry.customers.add(customer);
      }
    }
  }
  return { totalOrders, ordersByFamily, pairs };
}

/** Gerichtete Kennzahlen Quelle -> Ziel. */
export function pairStatsFor(basket: OrderBasketStats, source: string, target: string): PairStats {
  const entry = basket.pairs.get(pairKey(source, target));
  const pairOrders = entry?.orders ?? 0;
  const sourceOrders = basket.ordersByFamily.get(source) ?? 0;
  const targetOrders = basket.ordersByFamily.get(target) ?? 0;
  const totalOrders = basket.totalOrders;
  const confLB = wilsonLowerBound(pairOrders, sourceOrders);
  const baseRate = totalOrders > 0 ? targetOrders / totalOrders : 0;
  return {
    pairOrders,
    distinctCustomers: entry?.customers.size ?? 0,
    sourceOrders,
    targetOrders,
    totalOrders,
    confLB,
    liftLB: baseRate > 0 ? confLB / baseRate : 0,
  };
}

/** Haeufige Paare (ungerichtet) als Kandidaten in beide Richtungen. */
export function candidatePairsFromBasket(
  basket: OrderBasketStats,
  minPairOrders: number,
): Array<{ source: string; target: string }> {
  const out: Array<{ source: string; target: string }> = [];
  for (const [key, entry] of basket.pairs) {
    if (entry.orders < minPairOrders) continue;
    const [a, b] = key.split("\u0000");
    out.push({ source: a, target: b }, { source: b, target: a });
  }
  return out;
}

export type LlmVerdict = {
  verdict: "fit" | "unsure" | "no_fit";
  relation: string | null;
  confidence: number;
};

export type ScoreInputs = {
  stats: PairStats;
  /** Statt der eigenen Kaufstatistik (z. B. Musterstaerke bei Produkten ohne Bestellungen) */
  statOverride?: number;
  llm: LlmVerdict | null;
  /** Reaktionen in METAorder (Vorschau/Entwuerfe) */
  signal: { impressions: number; clicks: number; adds: number } | null;
  /** Freigabequote des Ziels ueber alle Entscheidungen */
  feedback: { approved: number; rejected: number } | null;
};

export type ScoreResult = {
  score: number;
  components: { stat: number; llm: number | null; signal: number; feedback: number };
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function statScore(stats: PairStats): number {
  return (
    0.5 * clamp01(stats.confLB / 0.25) +
    0.3 * clamp01(Math.log2(Math.max(stats.liftLB, 1)) / 3) +
    0.2 * clamp01(stats.pairOrders / 10)
  );
}

export function llmScore(llm: LlmVerdict | null): number | null {
  if (!llm) return null;
  if (llm.verdict === "fit") return clamp01(llm.confidence);
  if (llm.verdict === "unsure") return 0.3;
  return 0;
}

export function signalScore(signal: ScoreInputs["signal"]): number {
  if (!signal || signal.impressions < 5) return 0.5;
  const rate = (signal.adds + 0.35 * signal.clicks + 2) / (signal.impressions + 22);
  return clamp01(rate / 0.25);
}

export function feedbackScore(feedback: ScoreInputs["feedback"]): number {
  const approved = feedback?.approved ?? 0;
  const rejected = feedback?.rejected ?? 0;
  return (approved + 1) / (approved + rejected + 2);
}

/**
 * Gesamtwert 0..1 zum Sortieren: 45 % Statistik, 35 % KI, 10 % Reaktionen, 10 % Freigaben.
 * Ohne KI-Urteil faellt dessen Gewicht weg, die anderen werden hochgerechnet.
 */
export function scorePair(inputs: ScoreInputs): ScoreResult {
  const stat = inputs.statOverride ?? statScore(inputs.stats);
  const llm = llmScore(inputs.llm);
  const signal = signalScore(inputs.signal);
  const feedback = feedbackScore(inputs.feedback);
  const weights = { stat: 0.45, llm: llm === null ? 0 : 0.35, signal: 0.1, feedback: 0.1 };
  const total = weights.stat + weights.llm + weights.signal + weights.feedback;
  const score = (weights.stat * stat + weights.llm * (llm ?? 0) + weights.signal * signal + weights.feedback * feedback) / total;
  return { score, components: { stat, llm, signal, feedback } };
}

export type AutoGateInput = {
  stats: PairStats;
  llm: (LlmVerdict & { current: boolean }) | null;
  signal: ScoreInputs["signal"];
  targetEligible: boolean;
  blocked: boolean;
  alreadyInShop: boolean;
  sameFamily: boolean;
  heuristicOnly?: boolean;
  /** Kandidat aus einem Muster (aehnliche Produkte mit Bestellungen) statt eigener Bestellungen */
  pattern?: { sources: number } | null;
};

export type GateFailure =
  | "min_pair_orders"
  | "min_customers"
  | "confidence"
  | "lift"
  | "llm_missing"
  | "llm_not_fit"
  | "llm_relation"
  | "llm_confidence"
  | "target_not_eligible"
  | "blocked"
  | "already_in_shop"
  | "same_family"
  | "negative_signal"
  | "no_order_evidence"
  | "pattern_sources";

const COMPLEMENT_RELATIONS = new Set(["accessory", "component", "consumable"]);

/** Bedingungen fuer automatisches Setzen; leere Liste = alle erfuellt. */
export function evaluateAutoGates(input: AutoGateInput, settings: CrossSellAutomationSettings): GateFailure[] {
  const fails: GateFailure[] = [];
  const pattern = input.pattern ?? null;
  if (pattern) {
    // Muster: Beleg ueber aehnliche Produkte statt eigener Bestellungen, dafuer strengere KI-Schwelle
    if (pattern.sources < settings.patternMinSources) fails.push("pattern_sources");
  } else {
    if (input.heuristicOnly) fails.push("no_order_evidence");
    if (input.stats.pairOrders < settings.minPairOrders) fails.push("min_pair_orders");
    if (input.stats.distinctCustomers < settings.minDistinctCustomers) fails.push("min_customers");
    if (input.stats.confLB < settings.minConfidenceLB) fails.push("confidence");
    if (input.stats.liftLB < settings.minLiftLB) fails.push("lift");
  }
  const minLlm = pattern ? settings.patternMinLlmConfidence : settings.minLlmConfidence;
  if (!input.llm || !input.llm.current) {
    fails.push("llm_missing");
  } else {
    if (input.llm.verdict !== "fit") fails.push("llm_not_fit");
    if (!input.llm.relation || !COMPLEMENT_RELATIONS.has(input.llm.relation)) fails.push("llm_relation");
    if (input.llm.confidence < minLlm) fails.push("llm_confidence");
  }
  if (!input.targetEligible) fails.push("target_not_eligible");
  if (input.blocked) fails.push("blocked");
  if (input.alreadyInShop) fails.push("already_in_shop");
  if (input.sameFamily) fails.push("same_family");
  if (input.signal && input.signal.impressions >= 10) {
    const rate = (input.signal.adds + 2) / (input.signal.impressions + 22);
    if (rate < 0.02) fails.push("negative_signal");
  }
  return fails;
}

/** Bestbewertete Kandidaten innerhalb der Obergrenzen je Lauf und je Quelle. */
export function selectWithinCaps<T extends { source: string; score: number }>(
  items: T[],
  caps: { perRun: number; perSource: number; perSourceUsed?: Map<string, number> },
): T[] {
  const used = new Map(caps.perSourceUsed ?? []);
  const out: T[] = [];
  for (const item of [...items].sort((a, b) => b.score - a.score)) {
    if (out.length >= caps.perRun) break;
    const n = used.get(item.source) ?? 0;
    if (n >= caps.perSource) continue;
    used.set(item.source, n + 1);
    out.push(item);
  }
  return out;
}

/** Musterstaerke 0..1 (10 belegte Produkte = voll). */
export function patternStrength(sources: number): number {
  return clamp01(sources / 10);
}
