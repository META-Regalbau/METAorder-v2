// Cross-Selling: kombinierte Regeln, Ranking, Vorschlaege und Staging-Generierung (aus server/routes.ts; genutzt von Produkt-, Entwurfs-, KI- und Cross-Selling-Routen).
import { type CrossSellingRule, type Product, type CrossSellCooccurrence, type CrossSellEventPairStats, type RuleCondition, type RuleTargetCriteria, CROSS_SELL_CATEGORIES } from "@shared/schema";
import { type LearningSettings, getCrossSellLearningSettings } from "./crossSellLearning";
import { hybridWeightsFromLearningSettings, buildCrossSellEventStatsMap } from "./crossSellHybridRanker";
import { storage } from "../storage";
import { type SuggestCrossSellingOptions, RuleEngine } from "./ruleEngine";
import { ShopwareClient } from "../shopware/shopware";
import { loadCrossSellShelvingPatternConfig, findShelvingSupplements, mergeStagingCandidatesWithQuotas } from "./crossSellShelvingHeuristics";

export function getRulePairKey(rule: CrossSellingRule): string | null {
  const sourceCondition = rule.sourceConditions.find(
    (condition) => condition.field === "productNumber" && condition.operator === "equals"
  );
  const targetCriterion = rule.targetCriteria.find(
    (criterion) => criterion.field === "productNumber" && criterion.matchType === "exact"
  );

  const source = typeof sourceCondition?.value === "string" ? sourceCondition.value : null;
  const target = typeof targetCriterion?.value === "string" ? targetCriterion.value : null;

  if (!source || !target) {
    return null;
  }

  return `${source}::${target}`;
}

export function dedupeAndLimitSuggestions<T extends Product>(suggestions: T[], limit: number = 10): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const suggestion of suggestions) {
    const key = suggestion.productNumber || suggestion.id;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(suggestion);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

export const CROSS_SELL_EVENT_STATS_DAYS = 90;

export type CrossSellRankingBundle = {
  learningSettings: LearningSettings;
  cooccurrences: CrossSellCooccurrence[];
  eventStatsMap: Map<string, CrossSellEventPairStats>;
  weights: ReturnType<typeof hybridWeightsFromLearningSettings>;
  topK: number;
  ttlHours: number;
};

export async function loadCrossSellRankingBundle(tenantId: string | null): Promise<CrossSellRankingBundle | null> {
  try {
    const learningSettings = await getCrossSellLearningSettings(storage, tenantId);
    const cooccurrences = await storage.getCrossSellCooccurrences(tenantId);
    const since = new Date();
    since.setDate(since.getDate() - CROSS_SELL_EVENT_STATS_DAYS);
    const eventStats = await storage.getCrossSellEventStats(tenantId, since);
    const eventStatsMap = buildCrossSellEventStatsMap(eventStats);
    const weights = hybridWeightsFromLearningSettings(learningSettings);
    const envTopK = Number(process.env.CROSS_SELL_LLM_RERANK_TOPK);
    const topK = Number.isFinite(envTopK) && envTopK > 0 ? Math.floor(envTopK) : 25;
    const envTtl = Number(process.env.CROSS_SELL_LLM_RERANK_TTL_HOURS);
    const ttlHours = Number.isFinite(envTtl) && envTtl > 0 ? envTtl : 24;
    return { learningSettings, cooccurrences, eventStatsMap, weights, topK, ttlHours };
  } catch (e) {
    console.warn("[CrossSell] loadRankingBundle failed:", e);
    return null;
  }
}

export function crossSellSuggestOptions(
  tenantId: string | null,
  bundle: CrossSellRankingBundle | null,
  mode: "full" | "hybrid_only",
): SuggestCrossSellingOptions | undefined {
  if (!bundle) return undefined;
  const hybridRank = {
    storage,
    tenantId,
    cooccurrences: bundle.cooccurrences,
    eventStatsMap: bundle.eventStatsMap,
    weights: bundle.weights,
  };
  if (mode === "hybrid_only") {
    return { hybridRank };
  }
  return {
    hybridRank,
    llmRerank: {
      storage,
      topK: bundle.topK,
      topN: 10,
      ttlHours: bundle.ttlHours,
      useLlmFromSettings: bundle.learningSettings.useLlmRerank !== false,
    },
  };
}

export async function getCombinedCrossSellingRules(tenantId?: string | null): Promise<CrossSellingRule[]> {
  const combined = await getCombinedCrossSellingRulesWithSource(tenantId);
  return combined.map((entry) => entry.rule);
}

export async function getCombinedCrossSellingRulesWithSource(tenantId?: string | null): Promise<
  Array<{ rule: CrossSellingRule; sourceType: "ai" | "manual" }>
> {
  const manualRules = (await storage.getAllCrossSellingRules(tenantId)).filter((rule) => rule.active === 1);
  const aiRules = (await storage.getAiCrossSellRules(tenantId)).filter((rule) => rule.active === 1);

  const mappedAiRules = aiRules.map((rule) => ({
    rule: {
      id: rule.id,
      name: `AI: ${rule.sourceProductNumber} -> ${rule.targetProductNumber}`,
      description: rule.reason || "AI-generated rule",
      active: rule.active,
      category: rule.category ?? null,
      sourceConditions: [
        {
          field: "productNumber",
          operator: "equals" as RuleCondition["operator"],
          value: rule.sourceProductNumber,
        },
      ],
      targetCriteria: [
        {
          field: "productNumber",
          matchType: "exact" as RuleTargetCriteria["matchType"],
          value: rule.targetProductNumber,
        },
      ],
      createdAt: rule.generatedAt,
      updatedAt: rule.generatedAt,
    },
    sourceType: "ai" as const,
  }));

  const mappedManualRules = manualRules.map((rule) => ({
    rule,
    sourceType: "manual" as const,
  }));

  // Manual rules first: higher priority in suggestCrossSelling / dedupe-by-pair semantics
  const combined = [...mappedManualRules, ...mappedAiRules];
  const seenPairs = new Set<string>();
  const seenIds = new Set<string>();
  const result: Array<{ rule: CrossSellingRule; sourceType: "ai" | "manual" }> = [];

  for (const entry of combined) {
    const { rule } = entry;
    if (seenIds.has(rule.id)) {
      continue;
    }

    const pairKey = getRulePairKey(rule);
    if (pairKey) {
      if (seenPairs.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);
    }

    seenIds.add(rule.id);
    result.push(entry);
  }

  return result;
}

export async function fetchAllProductsForStaging(client: ShopwareClient): Promise<Product[]> {
  const limit = 200;
  let page = 1;
  const allProducts: Product[] = [];

  while (true) {
    const result = await client.fetchProducts(limit, page, undefined, undefined, false, undefined, undefined, undefined, true);
    allProducts.push(...result.products);
    const total = result.total ?? allProducts.length;
    if (result.products.length === 0 || allProducts.length >= total) {
      break;
    }
    page += 1;
  }

  return allProducts;
}

export function getFallbackSuggestionsByProperties(
  source: Product,
  allProducts: Product[],
  limit: number = 10
): Product[] {
  const sourceCategories = new Set(
    (source.categoryNames || []).map((name) => name.trim().toLowerCase()).filter(Boolean)
  );
  const sourceProperties = new Set(
    (source.properties || [])
      .map((prop) => `${prop.groupName}::${prop.optionName}`.toLowerCase())
      .filter(Boolean)
  );

  if (sourceCategories.size === 0 && sourceProperties.size === 0) {
    return [];
  }

  const scored: Array<{ product: Product; score: number }> = [];
  for (const candidate of allProducts) {
    if (candidate.id === source.id) {
      continue;
    }
    const candidateCategories = new Set(
      (candidate.categoryNames || []).map((name) => name.trim().toLowerCase()).filter(Boolean)
    );
    const candidateProperties = new Set(
      (candidate.properties || [])
        .map((prop) => `${prop.groupName}::${prop.optionName}`.toLowerCase())
        .filter(Boolean)
    );

    let score = 0;
    sourceCategories.forEach((value) => {
      if (candidateCategories.has(value)) {
        score += 1;
      }
    });
    sourceProperties.forEach((value) => {
      if (candidateProperties.has(value)) {
        score += 1;
      }
    });

    if (score > 0) {
      scored.push({ product: candidate, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.product);
}

export async function generateCrossSellStaging(
  tenantId: string | null,
  userId: string | null
): Promise<{
  batchId: string;
  rulesCount: number;
  suggestionsCount: number;
  productsWithSuggestions: number;
  productsWithoutSuggestions: number;
}> {
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) {
    throw new Error("Shopware settings not configured");
  }

  const client = new ShopwareClient(settings);
  const ruleEngine = new RuleEngine();

  const combined = await getCombinedCrossSellingRulesWithSource(tenantId);
  const rules = combined.map((entry) => entry.rule);

  const batch = await storage.createCrossSellStagingBatch(
    {
      tenantId,
      createdByUserId: userId,
      status: "draft",
    },
    tenantId
  );

  const stagingRules = combined.map((entry) => {
    const pairKey = getRulePairKey(entry.rule);
    const [sourceProductNumber, targetProductNumber] = pairKey ? pairKey.split("::") : [null, null];
    return {
      batchId: batch.id,
      tenantId,
      ruleType: entry.sourceType,
      name: entry.rule.name,
      description: entry.rule.description ?? null,
      active: entry.rule.active ?? 1,
      category: entry.rule.category ?? null,
      sourceConditions: entry.rule.sourceConditions,
      targetCriteria: entry.rule.targetCriteria,
      sourceProductNumber,
      targetProductNumber,
    };
  });

  await storage.replaceCrossSellStagingRules(batch.id, stagingRules, tenantId);

  const allProducts = await fetchAllProductsForStaging(client);
  const rankingBundle = await loadCrossSellRankingBundle(tenantId);
  const suggestOpts = crossSellSuggestOptions(tenantId, rankingBundle, "hybrid_only");
  const shelfCfg = await loadCrossSellShelvingPatternConfig((k, t) => storage.getSetting(k, t), tenantId);
  const stagingSuggestions: Array<{
    batchId: string;
    tenantId: string | null;
    sourceProductId: string | null;
    sourceProductNumber: string;
    targetProductId: string | null;
    targetProductNumber: string;
    category?: string | null;
    active: number;
  }> = [];
  let productsWithSuggestions = 0;
  let productsWithoutSuggestions = 0;

  for (const product of allProducts) {
    if (!product.productNumber) {
      continue;
    }
    const suggestions = await ruleEngine.suggestCrossSelling(product, rules, client, suggestOpts);
    const rulesLimited = dedupeAndLimitSuggestions(suggestions, 40);

    let fallbackLimited: Product[] = [];
    if (rulesLimited.length === 0) {
      fallbackLimited = dedupeAndLimitSuggestions(
        getFallbackSuggestionsByProperties(product, allProducts, 40),
        40,
      );
    }

    const ruleHits = rulesLimited.map((s) => ({
      product: s,
      category:
        (s as Product & { suggestCategory?: string }).suggestCategory ??
        CROSS_SELL_CATEGORIES.COMPONENTS,
    }));
    const fallbackHits = fallbackLimited.map((s) => ({
      product: s,
      category: CROSS_SELL_CATEGORIES.OTHER,
    }));
    const ruleOrFallback = ruleHits.length > 0 ? ruleHits : fallbackHits;

    const heur = findShelvingSupplements(product, allProducts, shelfCfg);
    const merged = mergeStagingCandidatesWithQuotas(ruleOrFallback, heur, shelfCfg);

    if (merged.length === 0) {
      productsWithoutSuggestions += 1;
      continue;
    }

    productsWithSuggestions += 1;
    for (const row of merged) {
      const suggestion = row.product;
      if (!suggestion.productNumber) {
        continue;
      }
      stagingSuggestions.push({
        batchId: batch.id,
        tenantId,
        sourceProductId: product.id ?? null,
        sourceProductNumber: product.productNumber,
        targetProductId: suggestion.id ?? null,
        targetProductNumber: suggestion.productNumber,
        category: row.category,
        active: 1,
      });
    }
  }

  await storage.replaceCrossSellStagingSuggestions(batch.id, stagingSuggestions, tenantId);

  return {
    batchId: batch.id,
    rulesCount: stagingRules.length,
    suggestionsCount: stagingSuggestions.length,
    productsWithSuggestions,
    productsWithoutSuggestions,
  };
}
