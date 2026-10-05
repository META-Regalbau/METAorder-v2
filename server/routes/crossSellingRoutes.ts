// Cross-Selling: Vorschlaege, Staging (Pruefen/Uebernehmen), Analytics, Lern-Einstellungen und Regel-Verwaltung.
import { requireAuth, requireManageCrossSellingGroups, requireManageCrossSellingRules, requireCsrf } from "../auth/auth";
import { storage } from "../storage";
import { ShopwareClient } from "../shopware/shopware";
import { getCrossSellLearningSettings } from "../cross-selling/crossSellLearning";
import { z } from "zod";
import { insertCrossSellingRuleSchema, type CrossSellingRule, type RuleCondition, type RuleTargetCriteria, type Product, CROSS_SELL_CATEGORIES, SHOPWARE_CROSS_SELLING_STOREFRONT_NAME } from "@shared/schema";
import { RuleEngine } from "../cross-selling/ruleEngine";
import { fetchAllProductsForStaging, loadCrossSellRankingBundle, crossSellSuggestOptions, dedupeAndLimitSuggestions, getFallbackSuggestionsByProperties, getCombinedCrossSellingRules } from "../cross-selling/crossSellService";
import { loadCrossSellShelvingPatternConfig, findShelvingSupplements, mergeStagingCandidatesWithQuotas } from "../cross-selling/crossSellShelvingHeuristics";
import type { Express } from "express";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "routes/crossSellingRoutes" });


type StagingApplyCategoryGroup = {
  category: string | null;
  targets: Array<{ targetProductNumber: string; targetProductId?: string | null }>;
};


/** Wie POST /staging/apply: nur aktive Vorschlaege, gruppiert nach Ausgangsartikel und Kategorie. */
function groupActiveStagingSuggestionsBySourceAndCategory(
  suggestions: Array<{
    active: number;
    sourceProductNumber: string;
    targetProductNumber: string;
    category?: string | null;
    targetProductId?: string | null;
  }>,
): Map<string, Map<string | null, StagingApplyCategoryGroup>> {
  const groupedBySourceAndCategory = new Map<string, Map<string | null, StagingApplyCategoryGroup>>();

  for (const suggestion of suggestions) {
    if (suggestion.active !== 1) continue;
    const sourceKey = suggestion.sourceProductNumber;
    if (!sourceKey) continue;

    if (!groupedBySourceAndCategory.has(sourceKey)) {
      groupedBySourceAndCategory.set(sourceKey, new Map());
    }

    const categoryMap = groupedBySourceAndCategory.get(sourceKey)!;
    const category = suggestion.category || null;

    if (!categoryMap.has(category)) {
      categoryMap.set(category, { category, targets: [] });
    }

    categoryMap.get(category)!.targets.push({
      targetProductNumber: suggestion.targetProductNumber,
      targetProductId: suggestion.targetProductId ?? null,
    });
  }

  return groupedBySourceAndCategory;
}


function getCategoryPosition(category: string | null): number {
  switch (category) {
    case "regale":
      return 1;
    case "boeden":
      return 2;
    case "komponenten":
      return 3;
    case "diagonal":
      return 4;
    case "zubehoer":
      return 5;
    case "kleinteile":
      return 6;
    case "sonstiges":
      return 7;
    default:
      return 8;
  }
}


function mergeStagingTargetsByCategoryOrder(
  categoryMap: Map<string | null, StagingApplyCategoryGroup>,
): Array<{ targetProductNumber: string; targetProductId?: string | null }> {
  const sorted = Array.from(categoryMap.entries()).sort(
    (a, b) => getCategoryPosition(a[0]) - getCategoryPosition(b[0]),
  );
  const seen = new Set<string>();
  const out: Array<{ targetProductNumber: string; targetProductId?: string | null }> = [];
  for (const [, group] of sorted) {
    for (const t of group.targets) {
      const pn = (t.targetProductNumber || "").trim();
      if (!pn || seen.has(pn)) continue;
      seen.add(pn);
      out.push(t);
    }
  }
  return out;
}


/** Artikelnummer fuer Cross-Sell-Analytics: direkt oder per Shopware-Produkt-ID. */
async function resolveCrossSellProductNumberForAnalytics(
  tenantId: string | null,
  explicitNumber: string | undefined,
  productId: string | undefined,
): Promise<string | null> {
  const n = explicitNumber?.trim();
  if (n) return n;
  const id = productId?.trim();
  if (!id) return null;
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) return null;
  const client = new ShopwareClient(settings);
  const { products } = await client.fetchProducts(
    1,
    1,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    true,
    undefined,
    false,
    false,
    id,
  );
  return products[0]?.productNumber?.trim() || null;
}

export function registerCrossSellingRoutes(app: Express): void {
  // Cross-Selling Rules routes
  app.get("/api/cross-selling-rules/available-fields", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        // Return default fields if Shopware not configured
        return res.json({
          standardFields: [
            { field: 'name', label: 'Product Name', description: 'The product name' },
            { field: 'productNumber', label: 'Product Number', description: 'The unique product number/SKU' },
            { field: 'manufacturerNumber', label: 'Manufacturer Number', description: 'Manufacturer\'s product number' },
            { field: 'ean', label: 'EAN', description: 'European Article Number / Barcode' },
            { field: 'stock', label: 'Stock', description: 'Current stock level' },
            { field: 'available', label: 'Available', description: 'Product availability status' },
            { field: 'price', label: 'Price', description: 'Product price' },
            { field: 'weight', label: 'Weight', description: 'Product weight' },
            { field: 'dimensions.width', label: 'Width', description: 'Product width dimension' },
            { field: 'dimensions.height', label: 'Height', description: 'Product height dimension' },
            { field: 'dimensions.length', label: 'Length', description: 'Product length/depth dimension' },
            { field: 'categoryNames', label: 'Categories', description: 'Product categories (array)' },
            { field: 'manufacturer.name', label: 'Manufacturer Name', description: 'Name of the manufacturer' },
          ],
          customFields: []
        });
      }

      const shopware = new ShopwareClient(settings);
      const fields = await shopware.fetchAvailableFields();
      res.json(fields);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching available fields:");
      res.status(500).json({ error: error.message || "Failed to fetch available fields" });
    }
  });

  app.get("/api/cross-selling-rules", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const rules = await storage.getAllCrossSellingRules(tenantId);
      res.json({ rules });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-selling rules:");
      res.status(500).json({ error: error.message || "Failed to fetch rules" });
    }
  });

  app.get("/api/cross-selling/learning-settings", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const settings = await getCrossSellLearningSettings(storage, req.tenantId ?? null);
      res.json(settings);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching learning settings:");
      res.status(500).json({ error: error.message || "Failed to fetch settings" });
    }
  });

  app.put("/api/cross-selling/learning-settings", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const schema = z.object({
        minSupport: z.number().min(0).max(1),
        minConfidence: z.number().min(0).max(1),
        minLift: z.number().min(0),
        minPairCount: z.number().min(1),
        maxRulesPerProduct: z.number().min(1),
        maxRecommendationsPerProduct: z.number().min(1),
        wCoOcc: z.number().min(0).max(1).optional(),
        wEmbed: z.number().min(0).max(1).optional(),
        wSignal: z.number().min(0).max(1).optional(),
        wRule: z.number().min(0).max(1).optional(),
        signalAlpha: z.number().min(0.01).max(50).optional(),
        signalBeta: z.number().min(0.01).max(200).optional(),
        useLlmRerank: z.boolean().optional(),
      });
      const validated = schema.parse(req.body);
      const merged = { ...(await getCrossSellLearningSettings(storage, req.tenantId ?? null)), ...validated };
      await storage.saveSetting("cross_sell_learning_settings", merged, req.tenantId ?? null);
      res.json(merged);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      moduleLog.error({ err: error }, "Error saving learning settings:");
      res.status(500).json({ error: error.message || "Failed to save settings" });
    }
  });

  app.get("/api/cross-selling/staging", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const batch = await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null);
      if (!batch) {
        return res.json({ batch: null, rules: [], suggestions: [] });
      }
      const [rules, suggestions] = await Promise.all([
        storage.getCrossSellStagingRules(batch.id, req.tenantId ?? null),
        storage.getCrossSellStagingSuggestions(batch.id, req.tenantId ?? null),
      ]);
      res.json({ batch, rules, suggestions });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-sell staging:");
      res.status(500).json({ error: error.message || "Failed to fetch staging data" });
    }
  });

  app.put("/api/cross-selling/staging/rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const validation = insertCrossSellingRuleSchema.partial().safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const updates: any = { ...validation.data };
      const updated = await storage.updateCrossSellStagingRule(req.params.id, updates, req.tenantId ?? null);
      if (!updated) {
        return res.status(404).json({ error: "Staging rule not found" });
      }
      res.json(updated);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error updating staging rule:");
      res.status(500).json({ error: error.message || "Failed to update staging rule" });
    }
  });

  app.put("/api/cross-selling/staging/suggestions/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const schema = z.object({
        targetProductNumber: z.string().min(1).optional(),
        active: z.union([z.number().min(0).max(1), z.boolean()]).optional(),
      });
      const validation = schema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const updates: any = { ...validation.data };
      if (typeof updates.active === "boolean") {
        updates.active = updates.active ? 1 : 0;
      }
      if (updates.targetProductNumber) {
        updates.targetProductId = null;
      }

      const updated = await storage.updateCrossSellStagingSuggestion(req.params.id, updates, req.tenantId ?? null);
      if (!updated) {
        return res.status(404).json({ error: "Staging suggestion not found" });
      }
      res.json(updated);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error updating staging suggestion:");
      res.status(500).json({ error: error.message || "Failed to update staging suggestion" });
    }
  });

  app.post("/api/cross-selling/staging/regenerate", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const batchId = req.body?.batchId as string | undefined;
      const batch = batchId
        ? await storage.getCrossSellStagingBatch(batchId, req.tenantId ?? null)
        : await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null);

      if (!batch) {
        return res.status(404).json({ error: "No staging batch found" });
      }

      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const ruleEngine = new RuleEngine();
      const stagingRules = await storage.getCrossSellStagingRules(batch.id, req.tenantId ?? null);
      const activeRules = stagingRules.filter((rule) => rule.active === 1);

      const rulesForEngine: CrossSellingRule[] = activeRules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        description: rule.description ?? undefined,
        active: rule.active,
        category: rule.category ?? undefined,
        sourceConditions: rule.sourceConditions as RuleCondition[],
        targetCriteria: rule.targetCriteria as RuleTargetCriteria[],
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      }));

      const allProducts = await fetchAllProductsForStaging(client);
      const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
      const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "hybrid_only");
      const shelfCfg = await loadCrossSellShelvingPatternConfig((k, t) => storage.getSetting(k, t), req.tenantId ?? null);
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
        const suggestions = await ruleEngine.suggestCrossSelling(product, rulesForEngine, client, suggestOpts);
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
            tenantId: batch.tenantId ?? null,
            sourceProductId: product.id ?? null,
            sourceProductNumber: product.productNumber,
            targetProductId: suggestion.id ?? null,
            targetProductNumber: suggestion.productNumber,
            category: row.category,
            active: 1,
          });
        }
      }

      await storage.replaceCrossSellStagingSuggestions(batch.id, stagingSuggestions, batch.tenantId ?? null);
      res.json({
        batchId: batch.id,
        suggestionsCount: stagingSuggestions.length,
        productsWithSuggestions,
        productsWithoutSuggestions,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error regenerating staging suggestions:");
      res.status(500).json({ error: error.message || "Failed to regenerate staging suggestions" });
    }
  });

  app.post("/api/cross-selling/staging/execute-rule", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const ruleId = typeof req.body?.ruleId === "string" ? req.body.ruleId.trim() : "";
      if (!ruleId) {
        return res.status(400).json({ error: "ruleId is required" });
      }

      const manualRule = await storage.getCrossSellingRule(ruleId, req.tenantId ?? null);
      if (!manualRule) {
        return res.status(404).json({ error: "Rule not found" });
      }

      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const ruleEngine = new RuleEngine();

      // Get or create staging batch
      let batch = await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null);
      if (!batch) {
        batch = await storage.createCrossSellStagingBatch(
          {
            tenantId: req.tenantId ?? null,
            createdByUserId: (req.user as any)?.id ?? null,
            status: "draft",
          },
          req.tenantId ?? null
        );
      }

      // Load all products
      const allProducts = await fetchAllProductsForStaging(client);
      const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
      const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "hybrid_only");

      // Execute rule on all products
      const suggestionsBySource = new Map<string, Product[]>();
      
      for (const product of allProducts) {
        if (!product.productNumber) {
          continue;
        }
        const suggestions = await ruleEngine.suggestCrossSelling(product, [manualRule], client, suggestOpts);
        const limited = dedupeAndLimitSuggestions(suggestions, 10);
        
        if (limited.length > 0) {
          suggestionsBySource.set(product.productNumber, limited);
        }
      }

      // Save suggestions to staging for each source product
      for (const [sourceProductNumber, suggestions] of Array.from(suggestionsBySource.entries())) {
        const sourceProduct = allProducts.find(p => p.productNumber === sourceProductNumber);
        if (!sourceProduct) continue;

        const stagingSuggestions = suggestions.map((suggestion: Product) => ({
          batchId: batch.id,
          tenantId: req.tenantId ?? null,
          sourceProductId: sourceProduct.id ?? null,
          sourceProductNumber: sourceProduct.productNumber!,
          targetProductId: suggestion.id ?? null,
          targetProductNumber: suggestion.productNumber!,
          active: 1,
        }));

        await storage.replaceCrossSellStagingSuggestionsForSource(
          batch.id,
          sourceProductNumber,
          stagingSuggestions,
          req.tenantId ?? null
        );
      }

      // Build preview data
      const preview = Array.from(suggestionsBySource.entries()).map(([sourceProductNumber, targets]) => {
        const sourceProduct = allProducts.find(p => p.productNumber === sourceProductNumber);
        return {
          sourceProductNumber,
          sourceProductName: sourceProduct?.name || sourceProductNumber,
          targetProducts: targets.map(t => ({
            productNumber: t.productNumber || "",
            productName: t.name || t.productNumber || "",
          })),
          count: targets.length,
        };
      });

      const totalSuggestions = Array.from(suggestionsBySource.values()).reduce(
        (sum, targets) => sum + targets.length,
        0
      );

      res.json({
        suggestionsCount: totalSuggestions,
        preview,
        batchId: batch.id,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error executing rule:");
      res.status(500).json({ error: error.message || "Failed to execute rule" });
    }
  });

  app.post("/api/cross-selling/staging/targeted", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const productNumber = typeof req.body?.productNumber === "string" ? req.body.productNumber.trim() : "";
      if (!productNumber) {
        return res.status(400).json({ error: "productNumber is required" });
      }

      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const ruleEngine = new RuleEngine();
      const rules = await getCombinedCrossSellingRules(req.tenantId ?? null);

      const byNumber = await client.fetchProductsByNumbers([productNumber]);
      const resolvedByNumber = byNumber.get(productNumber) || null;
      const productResult = await client.fetchProducts(
        5,
        1,
        productNumber,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        true
      );
      const sourceProduct =
        resolvedByNumber ||
        productResult.products.find((p) => p.productNumber === productNumber) ||
        productResult.products[0];

      if (!sourceProduct) {
        return res.status(404).json({ error: "Source product not found" });
      }

      const batch =
        (await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null)) ||
        (await storage.createCrossSellStagingBatch(
          {
            tenantId: req.tenantId ?? null,
            createdByUserId: (req.user as any)?.id ?? null,
            status: "draft",
          },
          req.tenantId ?? null
        ));

      const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
      const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "full");
      const suggestions = await ruleEngine.suggestCrossSelling(sourceProduct, rules, client, suggestOpts);
      let limited = dedupeAndLimitSuggestions(suggestions, 10);

      if (limited.length === 0) {
        const recommendations = await storage.getAiRecommendations(
          sourceProduct.productNumber as string,
          10,
          req.tenantId ?? null
        );
        const recommendedNumbers = Array.from(
          new Set(recommendations.map((rec) => rec.recommendedProductNumber).filter(Boolean))
        );
        if (recommendedNumbers.length > 0) {
          const productsByNumber = await client.fetchProductsByNumbers(recommendedNumbers);
          limited = recommendedNumbers
            .map((number) => productsByNumber.get(number))
            .filter(Boolean);
        }
      }

      const sourceCategories = (sourceProduct.categoryNames || [])
        .map((name: string) => name.trim().toLowerCase())
        .filter(Boolean);
      const sourceProperties = (sourceProduct.properties || [])
        .map((prop: { groupName: string; optionName: string }) => `${prop.groupName}::${prop.optionName}`.toLowerCase())
        .filter(Boolean);

      const filtered = limited.filter((target) => {
        if (sourceCategories.length > 0) {
          const targetCategories = new Set(
            (target.categoryNames || []).map((name: string) => name.trim().toLowerCase()).filter(Boolean)
          );
          if (!sourceCategories.every((name: string) => targetCategories.has(name))) {
            return false;
          }
        }

        if (sourceProperties.length > 0) {
          const targetProperties = new Set(
            (target.properties || [])
              .map((prop) => `${prop.groupName}::${prop.optionName}`.toLowerCase())
              .filter(Boolean)
          );
          if (!sourceProperties.every((value: string) => targetProperties.has(value))) {
            return false;
          }
        }

        return true;
      });

      const stagingSuggestions = filtered
        .filter((suggestion) => !!suggestion.productNumber)
        .map((suggestion) => ({
          batchId: batch.id,
          tenantId: req.tenantId ?? null,
          sourceProductId: sourceProduct.id ?? null,
          sourceProductNumber: sourceProduct.productNumber as string,
          targetProductId: suggestion.id ?? null,
          targetProductNumber: suggestion.productNumber as string,
          active: 1,
        }));

      await storage.replaceCrossSellStagingSuggestionsForSource(
        batch.id,
        sourceProduct.productNumber as string,
        stagingSuggestions,
        req.tenantId ?? null
      );

      res.json({ batchId: batch.id, sourceProductNumber: sourceProduct.productNumber, suggestionsCount: stagingSuggestions.length });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error generating targeted staging suggestions:");
      res.status(500).json({ error: error.message || "Failed to generate targeted suggestions" });
    }
  });

  /** Shopware-Artikelbezeichnungen zu Nummern (max. 400) fuer UI-Tabellen und Insights. */
  app.post("/api/cross-selling/product-labels", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const schema = z.object({
        productNumbers: z.array(z.string()).max(400),
      });
      const { productNumbers } = schema.parse(req.body);
      const unique = Array.from(new Set(productNumbers.map((n) => n.trim()).filter(Boolean))).slice(0, 400);
      if (unique.length === 0) {
        return res.json({ labels: {} as Record<string, { name: string | null; id: string | null }> });
      }
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const client = new ShopwareClient(settings);
      const map = await client.fetchProductsByNumbers(unique);
      const labels: Record<string, { name: string | null; id: string | null }> = {};
      for (const pn of unique) {
        const p = map.get(pn);
        labels[pn] = {
          name: (p?.name as string | undefined) ?? null,
          id: (p?.id as string | undefined) ?? null,
        };
      }
      res.json({ labels });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid body" });
      }
      moduleLog.error({ err: error }, "Error resolving cross-selling product labels:");
      res.status(500).json({ error: error.message || "Failed to resolve labels" });
    }
  });

  /**
   * Vorschau der geplanten Shopware-Uebertragung (gleiche Gruppierung wie POST /staging/apply, ohne Schreibzugriff).
   */
  app.get("/api/cross-selling/staging/apply-preview", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const batchId = typeof req.query.batchId === "string" ? req.query.batchId.trim() : undefined;
      const batch = batchId
        ? await storage.getCrossSellStagingBatch(batchId, req.tenantId ?? null)
        : await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null);

      if (!batch) {
        return res.status(404).json({ error: "No staging batch found" });
      }

      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const suggestions = await storage.getCrossSellStagingSuggestions(batch.id, req.tenantId ?? null);
      const activeSuggestions = suggestions.filter((s) => s.active === 1);
      const grouped = groupActiveStagingSuggestionsBySourceAndCategory(suggestions);

      const allNumbers = new Set<string>();
      for (const [src, catMap] of grouped) {
        allNumbers.add(src);
        const merged = mergeStagingTargetsByCategoryOrder(catMap);
        for (const t of merged) {
          allNumbers.add(t.targetProductNumber);
        }
      }

      const productMap = await client.fetchProductsByNumbers(Array.from(allNumbers));
      const nameFor = (pn: string) => {
        const p = productMap.get(pn);
        return (p?.name as string | undefined) ?? null;
      };

      const operations: Array<{
        sourceProductNumber: string;
        sourceProductName: string | null;
        category: string | null;
        shopwareGroupName: string;
        targets: Array<{ productNumber: string; name: string | null }>;
        targetsTotalBeforeCap: number;
        targetsApplied: number;
      }> = [];

      for (const [sourceProductNumber, categoryMap] of grouped) {
        const merged = mergeStagingTargetsByCategoryOrder(categoryMap);
        const slice = merged.slice(0, 10);
        if (slice.length === 0) continue;
        operations.push({
          sourceProductNumber,
          sourceProductName: nameFor(sourceProductNumber),
          category: null,
          shopwareGroupName: SHOPWARE_CROSS_SELLING_STOREFRONT_NAME,
          targets: slice.map((t) => ({
            productNumber: t.targetProductNumber,
            name: nameFor(t.targetProductNumber),
          })),
          targetsTotalBeforeCap: merged.length,
          targetsApplied: slice.length,
        });
      }

      res.json({
        batchId: batch.id,
        summary: {
          activeSuggestions: activeSuggestions.length,
          operations: operations.length,
        },
        operations,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error building staging apply preview:");
      res.status(500).json({ error: error.message || "Failed to build preview" });
    }
  });

  app.post("/api/cross-selling/staging/apply", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const batchId = req.body?.batchId as string | undefined;
      const batch = batchId
        ? await storage.getCrossSellStagingBatch(batchId, req.tenantId ?? null)
        : await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null);

      if (!batch) {
        return res.status(404).json({ error: "No staging batch found" });
      }

      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const suggestions = await storage.getCrossSellStagingSuggestions(batch.id, req.tenantId ?? null);
      const groupedBySourceAndCategory = groupActiveStagingSuggestionsBySourceAndCategory(suggestions);

      const productIdCache = new Map<string, string | null>();
      const resolveProductId = async (productNumber: string): Promise<string | null> => {
        if (productIdCache.has(productNumber)) {
          return productIdCache.get(productNumber) ?? null;
        }
        const result = await client.fetchProducts(5, 1, productNumber, undefined, false, undefined, undefined, undefined, true);
        const match = result.products.find((p) => p.productNumber === productNumber) || result.products[0];
        const id = match?.id ?? null;
        productIdCache.set(productNumber, id);
        return id;
      };

      const results = {
        sourcesProcessed: 0,
        crossSellingsCreated: 0,
        crossSellingsUpdated: 0,
        sourcesSkipped: 0,
        errors: [] as Array<{ sourceProductNumber: string; error: string }>,
      };

      // Process each source product
      for (const [sourceProductNumber, categoryMap] of Array.from(groupedBySourceAndCategory.entries())) {
        const sourceProductId = await resolveProductId(sourceProductNumber);
        if (!sourceProductId) {
          results.sourcesSkipped++;
          results.errors.push({ sourceProductNumber, error: "Source product not found" });
          continue;
        }

        const existingGroups = await client.fetchProductCrossSelling(sourceProductId);

        const mergedTargets = mergeStagingTargetsByCategoryOrder(categoryMap);
        const targetIds: string[] = [];
        for (const target of mergedTargets.slice(0, 10)) {
          const targetId = target.targetProductId ?? (await resolveProductId(target.targetProductNumber));
          if (targetId) {
            targetIds.push(targetId);
          }
        }

        if (targetIds.length === 0) {
          results.sourcesProcessed++;
          continue;
        }

        try {
          const shopwareGroupName = SHOPWARE_CROSS_SELLING_STOREFRONT_NAME;
          const existingGroup = existingGroups.find(
            (g) => g.name === shopwareGroupName && g.type === "productList",
          );

          let crossSellingId = existingGroup?.id;
          let createdNew = false;

          if (!crossSellingId) {
            crossSellingId = await client.createProductCrossSelling(sourceProductId, shopwareGroupName, "productList");
            createdNew = true;
          } else {
            const existingProducts = await client.fetchCrossSellingProducts(sourceProductId, crossSellingId);
            const existingIds = existingProducts.map((product) => product.id).filter(Boolean);
            if (existingIds.length > 0) {
              await client.removeProductsFromCrossSelling(crossSellingId, existingIds);
            }
          }

          await client.assignProductsToCrossSelling(crossSellingId, targetIds);

          if (createdNew) {
            results.crossSellingsCreated++;
          } else {
            results.crossSellingsUpdated++;
          }
        } catch (error: any) {
          results.errors.push({
            sourceProductNumber,
            error: `${SHOPWARE_CROSS_SELLING_STOREFRONT_NAME}: ${error.message || "Failed"}`,
          });
        }

        results.sourcesProcessed++;
      }

      res.json(results);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error applying staging cross-selling:");
      res.status(500).json({ error: error.message || "Failed to apply staging" });
    }
  });

  app.get("/api/cross-selling-rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const rule = await storage.getCrossSellingRule(req.params.id, tenantId);
      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json(rule);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-selling rule:");
      res.status(500).json({ error: error.message || "Failed to fetch rule" });
    }
  });

  app.post("/api/cross-selling-rules", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      // Validate request body
      const validation = insertCrossSellingRuleSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      // Convert arrays to JSON strings for storage
      const ruleData = {
        ...validation.data,
        sourceConditions: JSON.stringify(validation.data.sourceConditions),
        targetCriteria: JSON.stringify(validation.data.targetCriteria),
      } as any;

      const rule = await storage.createCrossSellingRule(ruleData, tenantId);
      res.json(rule);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error creating cross-selling rule:");
      res.status(500).json({ error: error.message || "Failed to create rule" });
    }
  });

  app.put("/api/cross-selling-rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      // Validate request body (partial updates allowed)
      const validation = insertCrossSellingRuleSchema.partial().safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      // Convert arrays to JSON strings for storage
      const updates: any = { ...validation.data };
      if (updates.sourceConditions) {
        updates.sourceConditions = JSON.stringify(updates.sourceConditions);
      }
      if (updates.targetCriteria) {
        updates.targetCriteria = JSON.stringify(updates.targetCriteria);
      }

      const rule = await storage.updateCrossSellingRule(req.params.id, updates, tenantId);

      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json(rule);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error updating cross-selling rule:");
      res.status(500).json({ error: error.message || "Failed to update rule" });
    }
  });

  app.delete("/api/cross-selling-rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const deleted = await storage.deleteCrossSellingRule(req.params.id, req.tenantId ?? null);
      if (!deleted) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json({ message: "Rule deleted successfully" });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error deleting cross-selling rule:");
      res.status(500).json({ error: error.message || "Failed to delete rule" });
    }
  });

  // Bulk execution of cross-selling rules
  app.post("/api/cross-selling-rules/execute-bulk", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      if (process.env.CROSS_SELL_BULK_ENABLED === "false") {
        return res.status(403).json({
          error: "Bulk cross-selling execution is disabled (CROSS_SELL_BULK_ENABLED=false).",
        });
      }

      const { ruleId } = req.body; // Optional: if provided, only execute this rule
      
      moduleLog.info(`[Bulk Execution] Starting bulk execution${ruleId ? ` for rule ${ruleId}` : ' for all rules'}...`);
      
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const ruleEngine = new RuleEngine();

      // Fetch rules to execute
      const rules = ruleId
        ? await storage.getCrossSellingRule(ruleId, req.tenantId ?? null).then((r) => (r ? [r] : []))
        : await getCombinedCrossSellingRules(req.tenantId ?? null);
      
      if (rules.length === 0) {
        return res.status(404).json({ error: "No rules found" });
      }

      moduleLog.info(`[Bulk Execution] Executing ${rules.length} rule(s)...`);

      const allProducts = await fetchAllProductsForStaging(client);
      const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
      const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "hybrid_only");
      
      moduleLog.info(`[Bulk Execution] Processing ${allProducts.length} products (paginated catalog)...`);

      // Track results
      const results = {
        totalProducts: allProducts.length,
        productsProcessed: 0,
        crossSellingsCreated: 0,
        productsSkipped: 0,
        errors: [] as Array<{ productId: string; productName: string; error: string }>,
      };

      // Process each product
      for (const product of allProducts) {
        try {
          moduleLog.info(`[Bulk Execution] Processing product: ${product.name} (${product.productNumber})`);
          
          // Get cross-selling suggestions for this product using rule engine
          const suggestions = await ruleEngine.suggestCrossSelling(product, rules, client, suggestOpts);
          const limitedSuggestions = dedupeAndLimitSuggestions(suggestions, 10);
          
          if (limitedSuggestions.length === 0) {
            moduleLog.info(`[Bulk Execution] No suggestions for product ${product.name}`);
            results.productsSkipped++;
            results.productsProcessed++;
            continue;
          }

          moduleLog.info(`[Bulk Execution] Found ${limitedSuggestions.length} suggestions for product ${product.name}`);

          try {
            const existingGroups = await client.fetchProductCrossSelling(product.id);
            const existingGroup = existingGroups.find(
              (g) => g.name === SHOPWARE_CROSS_SELLING_STOREFRONT_NAME && g.type === "productList",
            );
            let crossSellingId = existingGroup?.id;

            if (!crossSellingId) {
              crossSellingId = await client.createProductCrossSelling(
                product.id,
                SHOPWARE_CROSS_SELLING_STOREFRONT_NAME,
              );
              moduleLog.info(`[Bulk Execution] Created cross-selling group ${crossSellingId} for product ${product.name}`);
            } else {
              const existingProducts = await client.fetchCrossSellingProducts(product.id, crossSellingId);
              const existingIds = existingProducts.map((p) => p.id).filter(Boolean) as string[];
              if (existingIds.length > 0) {
                await client.removeProductsFromCrossSelling(crossSellingId, existingIds);
              }
              moduleLog.info(`[Bulk Execution] Updated cross-selling group ${crossSellingId} for product ${product.name}`);
            }

            const suggestionIds = limitedSuggestions.map((s) => s.id).filter(Boolean) as string[];
            await client.assignProductsToCrossSelling(crossSellingId, suggestionIds);
            moduleLog.info(`[Bulk Execution] Assigned ${suggestionIds.length} products to cross-selling group`);

            results.crossSellingsCreated++;
          } catch (error: any) {
            moduleLog.error({ err: error }, `[Bulk Execution] Error creating cross-selling for product ${product.name}:`);
            results.errors.push({
              productId: product.id,
              productName: product.name,
              error: error.message || 'Unknown error',
            });
          }
          
          results.productsProcessed++;
        } catch (error: any) {
          moduleLog.error({ err: error }, `[Bulk Execution] Error processing product ${product.name}:`);
          results.errors.push({
            productId: product.id,
            productName: product.name,
            error: error.message || 'Unknown error',
          });
          results.productsProcessed++;
        }
      }

      moduleLog.info(`[Bulk Execution] Complete. Processed: ${results.productsProcessed}, Created: ${results.crossSellingsCreated}, Skipped: ${results.productsSkipped}, Errors: ${results.errors.length}`);
      
      res.json(results);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error executing bulk cross-selling:");
      res.status(500).json({ error: error.message || "Failed to execute bulk cross-selling" });
    }
  });

  /** Cross-selling funnel events: Server-Log + Persistenz in cross_sell_events (Quality-Ranker). */
  app.post("/api/cross-selling/analytics-events", requireAuth, requireCsrf, async (req, res) => {
    try {
      const bodySchema = z.object({
        event: z.enum([
          "product_suggestions_impression",
          "product_suggestion_impression",
          "product_suggestion_click",
          "product_suggestion_add_to_group",
          "product_suggestion_remove",
          "product_suggestion_return",
          "draft_suggestions_impression",
          "draft_suggestion_add",
          "staging_apply",
          "bulk_execute",
          "learning_run",
        ]),
        context: z.string().max(200).optional(),
        draftId: z.string().optional(),
        sourceProductId: z.string().optional(),
        targetProductId: z.string().optional(),
        sourceProductNumber: z.string().optional(),
        targetProductNumber: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      });
      const body = bodySchema.parse(req.body);
      const payload = {
        type: "cross_sell_analytics",
        at: new Date().toISOString(),
        tenantId: req.tenantId ?? null,
        userId: (req.user as { id?: string })?.id ?? null,
        ...body,
      };
      moduleLog.info(`[cross_sell_analytics] ${JSON.stringify(payload)}`);

      const tid = req.tenantId ?? null;
      const userId = (req.user as { id?: string })?.id ?? null;

      const persistPair = async (
        dbEventType: string,
        sourceNum: string,
        targetNum: string,
        meta?: Record<string, unknown> | null,
      ) => {
        await storage.recordCrossSellEvent(
          {
            eventType: dbEventType,
            sourceProductNumber: sourceNum,
            targetProductNumber: targetNum,
            context: body.context ?? null,
            draftId: body.draftId ?? null,
            userId: userId ?? null,
            metadata: meta ?? null,
          },
          tid,
        );
      };

      const sourceNum = await resolveCrossSellProductNumberForAnalytics(
        tid,
        body.sourceProductNumber,
        body.sourceProductId,
      );
      const targetNum = await resolveCrossSellProductNumberForAnalytics(
        tid,
        body.targetProductNumber,
        body.targetProductId,
      );

      const pairDbTypes = new Set([
        "product_suggestion_click",
        "product_suggestion_add_to_group",
        "product_suggestion_remove",
        "product_suggestion_return",
        "draft_suggestion_add",
      ]);

      if (pairDbTypes.has(body.event) && sourceNum && targetNum) {
        await persistPair(body.event, sourceNum, targetNum, body.metadata as Record<string, unknown> | null);
      }

      if (body.event === "product_suggestion_impression" && sourceNum && targetNum) {
        await persistPair("product_suggestion_impression", sourceNum, targetNum, body.metadata as Record<string, unknown> | null);
      }

      if (body.event === "product_suggestions_impression") {
        const src =
          sourceNum ||
          (await resolveCrossSellProductNumberForAnalytics(tid, undefined, body.sourceProductId));
        const meta = (body.metadata || {}) as Record<string, unknown>;
        const targets = meta.suggestionProductNumbers;
        if (src && Array.isArray(targets)) {
          for (const t of targets) {
            if (typeof t === "string" && t.trim()) {
              await persistPair("product_suggestion_impression", src, t.trim(), { ...meta, batch: true });
            }
          }
        }
      }

      res.json({ ok: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid payload" });
      }
      moduleLog.error({ err: error }, "[cross_sell_analytics] Error:");
      res.status(500).json({ error: error.message || "Failed to record event" });
    }
  });
}
