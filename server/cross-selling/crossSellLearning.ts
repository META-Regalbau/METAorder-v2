import type { IStorage } from "../storage";
import type { Order, ShopwareSettings, InsertAiInsight, CrossSellEventPairStats } from "@shared/schema";
import { ShopwareClient } from "../shopware/shopware";
import { getMirrorOrdersLikeLive } from "../routes/routeHelpers";
import { crossSellEventLookupKey, buildCrossSellEventStatsMap } from "./crossSellHybridRanker";
import { loadCrossSellPairFilter } from "./crossSellMemory";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellLearning" });

export type LearningSettings = {
  minSupport: number;
  minConfidence: number;
  minLift: number;
  minPairCount: number;
  maxRulesPerProduct: number;
  maxRecommendationsPerProduct: number;
  /** Hybrid-Ranker: Gewichte (Summe ~1 empfohlen). */
  wCoOcc?: number;
  wEmbed?: number;
  wSignal?: number;
  wRule?: number;
  /** Beta-Prior fuer Add-Rate aus Events. */
  signalAlpha?: number;
  signalBeta?: number;
  /** GPT-Re-Rank in Suggestions/Staging (UI + Server-Default). */
  useLlmRerank?: boolean;
};

const DEFAULT_SETTINGS: LearningSettings = {
  minSupport: 0.01,
  minConfidence: 0.1,
  minLift: 1.1,
  minPairCount: 2,
  maxRulesPerProduct: 5,
  maxRecommendationsPerProduct: 10,
  wCoOcc: 0.35,
  wEmbed: 0.25,
  wSignal: 0.3,
  wRule: 0.1,
  signalAlpha: 2,
  signalBeta: 20,
  useLlmRerank: true,
};

type LearningStatus = {
  status: "idle" | "running" | "failed" | "completed";
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  processedOrders?: number;
  rulesCount?: number;
  recommendationsCount?: number;
  insightsCount?: number;
};

export async function getCrossSellLearningSettings(
  storage: IStorage,
  tenantId?: string | null
): Promise<LearningSettings> {
  const stored = (await storage.getSetting("cross_sell_learning_settings", tenantId)) || {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
  } as LearningSettings;
}

export async function runCrossSellLearning(
  storage: IStorage,
  shopwareSettings: ShopwareSettings,
  tenantId?: string | null
): Promise<LearningStatus> {
  const statusKey = "cross_sell_learning_status";
  const startedAt = new Date().toISOString();
  await storage.saveSetting(statusKey, { status: "running", startedAt }, tenantId);

  try {
    const settings = await getCrossSellLearningSettings(storage, tenantId);
    const client = new ShopwareClient(shopwareSettings);
    // Bestellungen aus dem Bestell-Spiegel statt alle live aus Shopware
    const orders = await getMirrorOrdersLikeLive(client, tenantId);
    const ordersWithProducts = orders.filter((order) => order.items?.length > 0);

    // Load manual rules to use as training data
    const manualRules = await storage.getAllCrossSellingRules(tenantId);
    const categorizedManualRules = manualRules.filter(r => r.active && r.category);

    moduleLog.debug({ settings }, "[CrossSellLearning] Settings:");
    moduleLog.debug({ total: orders.length, withProducts: ordersWithProducts.length }, "[CrossSellLearning] Orders:");
    moduleLog.debug({ total: manualRules.length, categorized: categorizedManualRules.length }, "[CrossSellLearning] Manual Rules:");

    // #endregion

    // Gedaechtnis: abgelehnte Paare nie als Regel, einzeln freigegebene verstaerken
    const pairFilter = await loadCrossSellPairFilter(storage, tenantId ?? null);

    const { productCounts, pairCounts, totalOrders, pairCategoryMap } = buildCooccurrence(
      ordersWithProducts,
      categorizedManualRules,
      pairFilter.approvedPairs,
    );
    const cooccurrences = buildCooccurrenceRows(pairCounts, productCounts, totalOrders);
    const { rules, recommendations, insights } = buildLearningOutputs(
      cooccurrences,
      settings,
      pairCategoryMap,
      buildProductNameMap(ordersWithProducts),
      { isBlocked: pairFilter.isBlocked },
    );

    const sinceEvents = new Date();
    sinceEvents.setDate(sinceEvents.getDate() - 90);
    let eventPairRows: CrossSellEventPairStats[] = [];
    try {
      eventPairRows = await storage.getCrossSellEventStats(tenantId ?? null, sinceEvents);
    } catch (e) {
      moduleLog.warn({ err: e }, "[CrossSellLearning] getCrossSellEventStats failed:");
    }
    const eventStatsMap = buildCrossSellEventStatsMap(eventPairRows);
    const rulesAdjusted = applyEventQualityToAiRules(rules, eventStatsMap);
    const eventInsights = buildEventQualityInsights(eventPairRows, new Date());
    const allInsights = [...insights, ...eventInsights];

    moduleLog.debug({ totalOrders, productCount: productCounts.size, pairCount: pairCounts.size, cooccurrenceCount: cooccurrences.length, categorizedPairs: pairCategoryMap.size }, "[CrossSellLearning] Cooccurrence:");
    moduleLog.info({ rules: rules.length, recommendations: recommendations.length, insights: allInsights.length }, "[CrossSellLearning] Output:");

    // #endregion

    await storage.replaceCrossSellCooccurrences(cooccurrences, tenantId);
    await storage.replaceAiCrossSellRules(rulesAdjusted, tenantId);
    await storage.replaceAiRecommendations(recommendations, tenantId);
    await storage.replaceAiInsights(allInsights, tenantId);

    const finishedAt = new Date().toISOString();
    const completedStatus: LearningStatus = {
      status: "completed",
      startedAt,
      finishedAt,
      processedOrders: totalOrders,
      rulesCount: rules.length,
      recommendationsCount: recommendations.length,
      insightsCount: allInsights.length,
    };
    await storage.saveSetting(statusKey, completedStatus, tenantId);
    return completedStatus;
  } catch (error: any) {
    const failedStatus: LearningStatus = {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error?.message || "Unknown error",
    };
    await storage.saveSetting(statusKey, failedStatus, tenantId);
    return failedStatus;
  }
}

function isNegativeBasketOrder(order: Order): boolean {
  return (
    order.status === "cancelled" ||
    order.paymentStatus === "refunded" ||
    order.paymentStatus === "cancelled"
  );
}

export function buildCooccurrence(
  orders: Order[],
  manualRules: any[] = [],
  approvedPairs: Array<{ source: string; target: string }> = [],
): {
  productCounts: Map<string, number>;
  pairCounts: Map<string, number>;
  totalOrders: number;
  pairCategoryMap: Map<string, string>;
} {
  const productCounts = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  const pairCategoryMap = new Map<string, string>(); // "prodA||prodB" -> category
  let totalOrders = 0;

  const goodOrders = orders.filter((o) => !isNegativeBasketOrder(o));
  const badOrders = orders.filter((o) => isNegativeBasketOrder(o));

  // Positive signal: abgeschlossene / laufende Bestellungen (kein Cancel/Refund)
  goodOrders.forEach((order) => {
    const productNumbers = (order.items || [])
      .map((item) => item.productNumber)
      .filter((value): value is string => !!value)
      .map((value) => value.trim())
      .filter(Boolean);

    const uniqueProducts = Array.from(new Set(productNumbers));
    if (uniqueProducts.length === 0) return;
    totalOrders += 1;

    uniqueProducts.forEach((productNumber) => {
      productCounts.set(productNumber, (productCounts.get(productNumber) || 0) + 1);
    });

    for (let i = 0; i < uniqueProducts.length; i += 1) {
      for (let j = i + 1; j < uniqueProducts.length; j += 1) {
        const a = uniqueProducts[i];
        const b = uniqueProducts[j];
        const key = [a, b].sort().join("||");
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  });

  // Negatives Signal: stornierte/refundierte Bestellungen reduzieren Paar-Counts (nicht totalOrders)
  badOrders.forEach((order) => {
    const productNumbers = (order.items || [])
      .map((item) => item.productNumber)
      .filter((value): value is string => !!value)
      .map((value) => value.trim())
      .filter(Boolean);
    const uniqueProducts = Array.from(new Set(productNumbers));
    if (uniqueProducts.length < 2) return;
    for (let i = 0; i < uniqueProducts.length; i += 1) {
      for (let j = i + 1; j < uniqueProducts.length; j += 1) {
        const a = uniqueProducts[i];
        const b = uniqueProducts[j];
        const key = [a, b].sort().join("||");
        pairCounts.set(key, Math.max(0, (pairCounts.get(key) || 0) - 1));
      }
    }
  });

  // Process manual rules as synthetic training data
  manualRules.forEach((rule) => {
    if (!rule.category) return;
    
    // Extract source and target product numbers from rule conditions/criteria
    // This is simplified - in reality would need to evaluate conditions more thoroughly
    const sourceConditions = rule.sourceConditions || [];
    const targetCriteria = rule.targetCriteria || [];
    
    // Look for productNumber equality conditions
    sourceConditions.forEach((sourceCond: any) => {
      if (sourceCond.field === 'productNumber' && sourceCond.operator === 'equals') {
        const sourceProduct = String(sourceCond.value);
        
        targetCriteria.forEach((targetCrit: any) => {
          if (targetCrit.field === 'productNumber' && targetCrit.matchType === 'exact' && targetCrit.value) {
            const targetProduct = String(targetCrit.value);
            
            // Boost these pairs from manual rules
            const key = [sourceProduct, targetProduct].sort().join("||");
            pairCounts.set(key, (pairCounts.get(key) || 0) + 5); // Boost by 5 "synthetic orders"
            productCounts.set(sourceProduct, (productCounts.get(sourceProduct) || 0) + 5);
            productCounts.set(targetProduct, (productCounts.get(targetProduct) || 0) + 5);
            
            // Store category for this pair
            pairCategoryMap.set(key, rule.category);
          }
        });
      }
    });
  });

  // Einzeln freigegebene Paare (Cross-Selling-Gedaechtnis) wie Handregeln verstaerken.
  approvedPairs.forEach(({ source, target }) => {
    if (!source || !target || source === target) return;
    const key = [source, target].sort().join("||");
    pairCounts.set(key, (pairCounts.get(key) || 0) + 5);
    productCounts.set(source, (productCounts.get(source) || 0) + 5);
    productCounts.set(target, (productCounts.get(target) || 0) + 5);
  });

  return { productCounts, pairCounts, totalOrders, pairCategoryMap };
}

function buildCooccurrenceRows(
  pairCounts: Map<string, number>,
  productCounts: Map<string, number>,
  totalOrders: number
) {
  const rows: Array<{
    productNumberA: string;
    productNumberB: string;
    pairCount: number;
    ordersWithA: number;
    ordersWithB: number;
    totalOrders: number;
    support: number;
    confidence: number;
    lift: number;
    generatedAt: Date;
  }> = [];
  if (totalOrders === 0) return rows;

  for (const [key, pairCount] of Array.from(pairCounts.entries())) {
    const [a, b] = key.split("||");
    const ordersWithA = productCounts.get(a) || 0;
    const ordersWithB = productCounts.get(b) || 0;
    if (ordersWithA === 0 || ordersWithB === 0) continue;

    const support = pairCount / totalOrders;
    const confidence = pairCount / ordersWithA;
    const lift = confidence / (ordersWithB / totalOrders);

    rows.push({
      productNumberA: a,
      productNumberB: b,
      pairCount,
      ordersWithA,
      ordersWithB,
      totalOrders,
      support,
      confidence,
      lift,
      generatedAt: new Date(),
    });
  }

  return rows;
}

/** Artikelnummer -> Name aus den Bestellpositionen (fuer die Paare der Insights) */
export function buildProductNameMap(orders: Order[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const order of orders) {
    for (const item of order.items || []) {
      const number = item.productNumber?.trim();
      const name = item.name?.trim();
      if (number && name && !names.has(number)) names.set(number, name);
    }
  }
  return names;
}

type InsightPair = {
  source: string;
  target: string;
  sourceName?: string;
  targetName?: string;
  support: number;
  confidence: number;
  lift: number;
};

/**
 * Insights der Warenkorb-Analyse. Vorher: "Upsell-Potenzial" war eine Kopie von "Top kombinierte
 * Artikel" unter data.recommendations - die Statistik zeigt aber nur data.pairs, die Karte blieb leer.
 * Jedes Paar stand ausserdem doppelt drin (A->B und B->A, gleicher Lift).
 * Jetzt: Top-Paare nach Lift, je Paar einmal; Upsell nach Kaufwahrscheinlichkeit x Lift
 * (wer A kauft, nimmt oft B dazu), ohne die Top-Paare; beide mit Produktnamen.
 */
export function buildLearningOutputs(
  cooccurrences: Array<{
    productNumberA: string;
    productNumberB: string;
    pairCount: number;
    ordersWithA: number;
    ordersWithB: number;
    totalOrders: number;
    support: number;
    confidence: number;
    lift: number;
  }>,
  settings: LearningSettings,
  pairCategoryMap: Map<string, string> = new Map(),
  productNames: Map<string, string> = new Map(),
  options: { isBlocked?: (source: string, target: string) => boolean } = {},
) {
  const rulesBySource = new Map<string, any[]>();
  const recommendationsBySource = new Map<string, any[]>();
  const now = new Date();

  const addRule = (
    source: string,
    target: string,
    support: number,
    confidence: number,
    lift: number,
    category?: string | null
  ) => {
    if (support < settings.minSupport) return;
    if (confidence < settings.minConfidence) return;
    if (lift < settings.minLift) return;
    if (options.isBlocked?.(source, target)) return;
    const reason = `Gemeinsam in ${(support * 100).toFixed(1)}% der Bestellungen`;
    const entry = {
      sourceProductNumber: source,
      targetProductNumber: target,
      support,
      confidence,
      lift,
      reason,
      category: category || null,
      active: 1,
      generatedAt: now,
    };
    const currentRules = rulesBySource.get(source) || [];
    currentRules.push(entry);
    rulesBySource.set(source, currentRules);

    const recommendation = {
      productNumber: source,
      recommendedProductNumber: target,
      score: confidence * lift,
      reason,
      generatedAt: now,
    };
    const currentRecs = recommendationsBySource.get(source) || [];
    currentRecs.push(recommendation);
    recommendationsBySource.set(source, currentRecs);
  };

  cooccurrences.forEach((pair) => {
    if (pair.pairCount < settings.minPairCount) return;
    const { productNumberA, productNumberB, support, confidence, lift } = pair;
    const confidenceAtoB = pair.pairCount / pair.ordersWithA;
    const confidenceBtoA = pair.pairCount / pair.ordersWithB;
    const liftAtoB = confidenceAtoB / (pair.ordersWithB / pair.totalOrders);
    const liftBtoA = confidenceBtoA / (pair.ordersWithA / pair.totalOrders);

    // Check if this pair has a category from manual rules
    const keyAB = [productNumberA, productNumberB].sort().join("||");
    const category = pairCategoryMap.get(keyAB) || null;

    addRule(productNumberA, productNumberB, support, confidenceAtoB, liftAtoB, category);
    addRule(productNumberB, productNumberA, support, confidenceBtoA, liftBtoA, category);
  });

  const rules = Array.from(rulesBySource.entries()).flatMap(([source, rules]) => {
    return rules
      .sort((a, b) => b.lift - a.lift || b.confidence - a.confidence)
      .slice(0, settings.maxRulesPerProduct);
  });

  const recommendations = Array.from(recommendationsBySource.entries()).flatMap(([source, recs]) => {
    return recs
      .sort((a, b) => b.score - a.score)
      .slice(0, settings.maxRecommendationsPerProduct);
  });

  const pairKey = (a: string, b: string) => [a, b].sort().join("||");
  const toPair = (rule: { sourceProductNumber: string; targetProductNumber: string; support: number; confidence: number; lift: number }): InsightPair => ({
    source: rule.sourceProductNumber,
    target: rule.targetProductNumber,
    sourceName: productNames.get(rule.sourceProductNumber),
    targetName: productNames.get(rule.targetProductNumber),
    support: rule.support,
    confidence: rule.confidence,
    lift: rule.lift,
  });
  /** die ersten `limit` Regeln, je Artikelpaar nur eine Richtung, ohne ausgeschlossene Paare */
  const pickPairs = (sorted: typeof rules, limit: number, exclude = new Set<string>()) => {
    const seen = new Set(exclude);
    const picked: InsightPair[] = [];
    for (const rule of sorted) {
      const key = pairKey(rule.sourceProductNumber, rule.targetProductNumber);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(toPair(rule));
      if (picked.length >= limit) break;
    }
    return picked;
  };

  const topPairs = pickPairs(rules.slice().sort((a, b) => b.lift - a.lift || b.confidence - a.confidence), 5);
  const byUpsell = rules.slice().sort((a, b) => b.confidence * b.lift - a.confidence * a.lift || b.support - a.support);
  const topKeys = new Set(topPairs.map((pair) => pairKey(pair.source, pair.target)));
  // Upsell ohne die Top-Paare; gibt es nur wenige Regeln, lieber dieselben Paare als eine leere Karte
  const upsellPairs = pickPairs(byUpsell, 5, topKeys);
  const upsell = upsellPairs.length > 0 ? upsellPairs : pickPairs(byUpsell, 5);

  const insights = [
    {
      insightType: "top_pairs",
      title: "Top kombinierte Artikel",
      description: "Artikelpaare mit hoher Kaufwahrscheinlichkeit",
      data: { pairs: topPairs },
      generatedAt: now,
    },
    {
      insightType: "upsell_opportunities",
      title: "Upsell-Potenzial",
      description: "Empfehlungen mit hohem Lift für den Warenkorb",
      data: { pairs: upsell },
      generatedAt: now,
    },
  ];

  return { rules, recommendations, insights };
}

type AiRuleDraft = {
  sourceProductNumber: string;
  targetProductNumber: string;
  support: number;
  confidence: number;
  lift: number;
  reason?: string;
  category?: string | null;
  active: number;
  generatedAt: Date;
};

/** AI-Regeln mit genug schlechtem Funnel-Feedback deaktivieren (bleiben in DB mit active=0). */
function applyEventQualityToAiRules(rules: AiRuleDraft[], eventStatsMap: Map<string, CrossSellEventPairStats>): AiRuleDraft[] {
  const MIN_IMP = 20;
  const MAX_ADD_RATE = 0.03;
  for (const rule of rules) {
    const key = crossSellEventLookupKey(rule.sourceProductNumber, rule.targetProductNumber);
    const st = eventStatsMap.get(key);
    if (!st || st.impressions < MIN_IMP) continue;
    const addRate = st.adds / st.impressions;
    if (addRate <= MAX_ADD_RATE && st.adds <= 1) {
      rule.active = 0;
      const tag = `[Auto: schwaches Nutzersignal ${(addRate * 100).toFixed(1)}% Adds bei ${st.impressions} Impr.]`;
      rule.reason = `${rule.reason ?? ""} ${tag}`.trim();
    }
  }
  return rules;
}

function buildEventQualityInsights(rows: CrossSellEventPairStats[], generatedAt: Date): InsertAiInsight[] {
  const scored = rows
    .filter((r) => r.impressions >= 3)
    .map((r) => ({
      sourceProductNumber: r.sourceProductNumber,
      targetProductNumber: r.targetProductNumber,
      impressions: r.impressions,
      clicks: r.clicks,
      adds: r.adds,
      removes: r.removes,
      returns: r.returns,
      score: r.impressions > 0 ? (r.adds + 0.35 * r.clicks) / r.impressions : 0,
    }))
    .sort((a, b) => b.score - a.score || b.adds - a.adds);

  const top_quality_pairs = scored.slice(0, 20).map((r) => ({
    source: r.sourceProductNumber,
    target: r.targetProductNumber,
    impressions: r.impressions,
    clicks: r.clicks,
    adds: r.adds,
    addRatePct: r.impressions ? Math.round((r.adds / r.impressions) * 1000) / 10 : 0,
  }));

  const low_quality_pairs = rows
    .filter((r) => r.impressions >= 20 && r.adds / r.impressions <= 0.03)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30)
    .map((r) => ({
      source: r.sourceProductNumber,
      target: r.targetProductNumber,
      impressions: r.impressions,
      adds: r.adds,
      addRatePct: Math.round((r.adds / r.impressions) * 1000) / 10,
    }));

  return [
    {
      insightType: "top_quality_pairs",
      title: "Top-Qualitaets-Paare (Funnel)",
      description: "Richtung Quelle→Ziel mit hoher relativer Interaktion (letzte 90 Tage)",
      data: { pairs: top_quality_pairs },
      generatedAt,
    },
    {
      insightType: "low_quality_pairs",
      title: "Schwache Paare (Funnel)",
      description: "Ausreichend Impressions, aber sehr niedrige Add-Rate",
      data: { pairs: low_quality_pairs },
      generatedAt,
    },
  ];
}
