// Cross-Selling: Vorschlaege, Staging (Pruefen/Uebernehmen), Analytics, Lern-Einstellungen und Regel-Verwaltung.
import { requireAuth, requireManageCrossSellingGroups, requireManageCrossSellingRules, requireCsrf } from "../auth/auth";
import { storage } from "../storage";
import { ShopwareClient } from "../shopware/shopware";
import { getCrossSellLearningSettings } from "../cross-selling/crossSellLearning";
import { z } from "zod";
import { insertCrossSellingRuleSchema, type CrossSellingRule, type RuleCondition, type RuleTargetCriteria, type Product, CROSS_SELL_CATEGORIES } from "@shared/schema";
import { RuleEngine } from "../cross-selling/ruleEngine";
import { fetchAllProductsForStaging, loadCrossSellRankingBundle, crossSellSuggestOptions, dedupeAndLimitSuggestions, getCombinedCrossSellingRules, computeStagingRowsForProduct, generateCrossSellStaging, regenerateCrossSellStagingBatch } from "../cross-selling/crossSellService";
import { loadCrossSellShelvingPatternConfig } from "../cross-selling/crossSellShelvingHeuristics";
import { applyCrossSellPlan, diffAssignments, type CrossSellApplyOperation } from "../cross-selling/crossSellApply";
import { startCrossSellJob, getCrossSellJobStatus } from "../cross-selling/crossSellJobs";
import { productCacheRegistry } from "../products/productCache";
import { getCrossSellAutomationSettings, saveCrossSellAutomationSettings, crossSellAutomationSettingsSchema } from "../cross-selling/crossSellAutomationSettings";
import { loadCrossSellCatalog } from "../cross-selling/crossSellCatalog";
import { createCrossSellChangeRecorder, rejectCrossSellPair } from "../cross-selling/crossSellMemory";
import { runCrossSellImport } from "../cross-selling/crossSellImport";
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


/** Shopware-IDs zu Artikelnummern (gebuendelt, 25 je Abfrage). */
async function resolveProductIdsByNumber(client: ShopwareClient, productNumbers: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(productNumbers.map((n) => n.trim()).filter(Boolean)));
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const map = await client.fetchProductsByNumbers(unique);
  for (const pn of unique) {
    const id = map.get(pn)?.id;
    if (typeof id === "string" && id) out.set(pn, id);
  }
  return out;
}

/**
 * Staging-Vorschlaege -> Schreib-Operationen je Ausgangsartikel (Ziele in Kategorie-Reihenfolge).
 * Quellen ohne Shopware-ID landen in `skipped`.
 */
async function buildStagingApplyOperations(
  client: ShopwareClient,
  suggestions: Parameters<typeof groupActiveStagingSuggestionsBySourceAndCategory>[0],
): Promise<{ operations: CrossSellApplyOperation[]; skipped: Array<{ sourceProductNumber: string; error: string }> }> {
  const grouped = groupActiveStagingSuggestionsBySourceAndCategory(suggestions);
  const sourceIdByNumber = new Map<string, string>();
  for (const s of suggestions) {
    const id = (s as { sourceProductId?: string | null }).sourceProductId;
    if (s.active === 1 && id) sourceIdByNumber.set(s.sourceProductNumber, id);
  }
  const missing: string[] = [];
  for (const [src, catMap] of grouped) {
    if (!sourceIdByNumber.has(src)) missing.push(src);
    for (const t of mergeStagingTargetsByCategoryOrder(catMap)) {
      if (!t.targetProductId) missing.push(t.targetProductNumber);
    }
  }
  const resolved = await resolveProductIdsByNumber(client, missing);

  const operations: CrossSellApplyOperation[] = [];
  const skipped: Array<{ sourceProductNumber: string; error: string }> = [];
  for (const [sourceProductNumber, catMap] of grouped) {
    const sourceProductId = sourceIdByNumber.get(sourceProductNumber) ?? resolved.get(sourceProductNumber);
    if (!sourceProductId) {
      skipped.push({ sourceProductNumber, error: "Source product not found" });
      continue;
    }
    const targetProductIds = mergeStagingTargetsByCategoryOrder(catMap)
      .map((t) => t.targetProductId ?? resolved.get(t.targetProductNumber) ?? null)
      .filter((id): id is string => !!id);
    if (targetProductIds.length > 0) {
      operations.push({ sourceProductId, sourceProductNumber, targetProductIds });
    }
  }
  return { operations, skipped };
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
  // Erst der Produkt-Cache des Mandanten (aus dem Spiegel), nur bei Fehlschlag Shopware.
  const cached = productCacheRegistry.for(tenantId).getProductById(id)?.productNumber?.trim();
  if (cached) return cached;
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

  // Neuberechnung laeuft im Hintergrund (202); Status per GET /api/cross-selling/jobs/status?type=staging.
  // Ohne bestehenden Batch wird ein neuer aus den kombinierten Regeln erzeugt.
  app.post("/api/cross-selling/staging/regenerate", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const userId = (req.user as any)?.id ?? null;
      const batchId = req.body?.batchId as string | undefined;
      const batch = batchId
        ? await storage.getCrossSellStagingBatch(batchId, tenantId)
        : await storage.getLatestCrossSellStagingBatch(tenantId);

      if (batchId && !batch) {
        return res.status(404).json({ error: "No staging batch found" });
      }

      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { started, state } = startCrossSellJob(storage, tenantId, "staging", async (job) => {
        const onProgress = (processed: number, total: number) => {
          job.processed = processed;
          job.total = total;
        };
        return batch
          ? regenerateCrossSellStagingBatch(tenantId, batch.id, onProgress)
          : generateCrossSellStaging(tenantId, userId, onProgress);
      });

      // Laeuft schon ein Lauf, haengt sich der Client per Polling an diesen an.
      res.status(202).json({
        started,
        alreadyRunning: !started,
        status: state.status,
        processed: state.processed,
        total: state.total,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error regenerating staging suggestions:");
      res.status(500).json({ error: error.message || "Failed to regenerate staging suggestions" });
    }
  });

  // Status der Hintergrund-Jobs (Staging-Neuberechnung, KI-Lernlauf).
  app.get("/api/cross-selling/jobs/status", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const known = ["staging", "ai", "import", "candidates"] as const;
      const type = (known as readonly string[]).includes(String(req.query.type)) ? (req.query.type as (typeof known)[number]) : "staging";
      res.json(await getCrossSellJobStatus(storage, req.tenantId ?? null, type));
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-selling job status:");
      res.status(500).json({ error: error.message || "Failed to fetch job status" });
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
      const { managedGroupName, maxTargetsPerManagedGroup } = await getCrossSellAutomationSettings(storage, req.tenantId ?? null);
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
        const slice = merged.slice(0, maxTargetsPerManagedGroup);
        if (slice.length === 0) continue;
        operations.push({
          sourceProductNumber,
          sourceProductName: nameFor(sourceProductNumber),
          category: null,
          shopwareGroupName: managedGroupName,
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
        maxTargetsPerGroup: maxTargetsPerManagedGroup,
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

  /**
   * Vorschau fuer EINEN Artikel ohne Schreibzugriff: Ziele aus Regeln + Regal-Heuristik
   * (wie der Staging-Lauf) und der Abgleich mit der bestehenden Gruppe im Shop – fuer
   * "nur hinzufuegen" (Standard) und "Gruppe ersetzen".
   */
  app.get("/api/cross-selling/staging/apply-preview-product", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const productNumber = typeof req.query.productNumber === "string" ? req.query.productNumber.trim() : "";
      if (!productNumber) {
        return res.status(400).json({ error: "productNumber is required" });
      }
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const rules = await getCombinedCrossSellingRules(tenantId);
      const allProducts = await fetchAllProductsForStaging(client);
      // Quelle ausserhalb des (begrenzten) Staging-Katalogs gezielt nachladen
      let sourceProduct = allProducts.find((p) => p.productNumber === productNumber);
      if (!sourceProduct) {
        const found = await client.fetchProducts(5, 1, productNumber, undefined, false, undefined, undefined, undefined, true);
        sourceProduct = found.products.find((p) => p.productNumber === productNumber);
        if (sourceProduct) allProducts.push(sourceProduct);
      }
      if (!sourceProduct || !sourceProduct.id) {
        return res.status(404).json({ error: "Source product not found" });
      }

      const rankingBundle = await loadCrossSellRankingBundle(tenantId);
      const suggestOpts = crossSellSuggestOptions(tenantId, rankingBundle, "hybrid_only");
      const shelfCfg = await loadCrossSellShelvingPatternConfig((k, t) => storage.getSetting(k, t), tenantId);
      const rows = await computeStagingRowsForProduct(
        client,
        new RuleEngine(),
        sourceProduct,
        rules,
        allProducts,
        suggestOpts,
        shelfCfg,
      );

      const categoryMap = new Map<string | null, StagingApplyCategoryGroup>();
      const categoryByTarget = new Map<string, string | null>();
      for (const row of rows) {
        const pn = row.product.productNumber;
        if (!pn) continue;
        const category = row.category || null;
        if (!categoryMap.has(category)) categoryMap.set(category, { category, targets: [] });
        categoryMap.get(category)!.targets.push({ targetProductNumber: pn, targetProductId: row.product.id ?? null });
        if (!categoryByTarget.has(pn)) categoryByTarget.set(pn, category);
      }
      const merged = mergeStagingTargetsByCategoryOrder(categoryMap);

      const byId = new Map<string, Product>();
      for (const p of allProducts) if (p.id) byId.set(p.id, p);
      const label = (id: string) => ({
        productNumber: byId.get(id)?.productNumber ?? id,
        name: (byId.get(id)?.name as string | undefined) ?? null,
      });

      const { managedGroupName, maxTargetsPerManagedGroup: max } = await getCrossSellAutomationSettings(storage, tenantId);
      const groups = await client.fetchProductCrossSelling(sourceProduct.id);
      const managed = groups.find((g) => g.type === "productList" && g.name === managedGroupName);
      const current = managed ? await client.fetchCrossSellingAssignments(managed.id) : [];
      // Wie beim Uebernehmen: Ziele, die schon in einer anderen Liste der Quelle stehen, werden nicht gesetzt.
      const inOtherGroups = new Set<string>();
      for (const g of groups) {
        if (g.type !== "productList" || g.id === managed?.id) continue;
        for (const a of await client.fetchCrossSellingAssignments(g.id)) inOtherGroups.add(a.productId);
      }
      const desiredIds = merged
        .map((t) => t.targetProductId)
        .filter((id): id is string => !!id && !inOtherGroups.has(id));
      const addOnly = diffAssignments(current, desiredIds, { removeMissing: false, maxTargets: max });
      const replace = diffAssignments(current, desiredIds, { removeMissing: true, maxTargets: max });

      const capped = merged.slice(0, max);
      res.json({
        sourceProductNumber: sourceProduct.productNumber,
        sourceProductName: (sourceProduct.name as string | undefined) ?? null,
        shopwareGroupName: managedGroupName,
        targetsTotalBeforeCap: merged.length,
        targetsApplied: capped.length,
        targets: capped.map((tg) => ({
          productNumber: tg.targetProductNumber,
          name: tg.targetProductId ? label(tg.targetProductId).name : null,
          category: categoryByTarget.get(tg.targetProductNumber) ?? null,
        })),
        current: current.map((a) => label(a.productId)),
        inOtherGroups: merged
          .filter((t) => t.targetProductId && inOtherGroups.has(t.targetProductId))
          .map((t) => label(t.targetProductId!)),
        addOnly: { toAdd: addOnly.toAdd.map((a) => label(a.productId)) },
        replace: {
          toAdd: replace.toAdd.map((a) => label(a.productId)),
          toRemove: replace.toRemove.map((r) => label(r.productId)),
        },
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error building per-product apply preview:");
      res.status(500).json({ error: error.message || "Failed to build preview" });
    }
  });

  /**
   * Staging nach Shopware: Standard ist Nur-Hinzufuegen in die Gruppe "Passende Produkte".
   * Mit replaceManagedGroup=true werden dort nicht vorgeschlagene Eintraege entfernt.
   * Andere Gruppen bleiben unberuehrt.
   */
  app.post("/api/cross-selling/staging/apply", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const batchId = req.body?.batchId as string | undefined;
      const replaceManagedGroup = req.body?.replaceManagedGroup === true;
      const batch = batchId
        ? await storage.getCrossSellStagingBatch(batchId, tenantId)
        : await storage.getLatestCrossSellStagingBatch(tenantId);

      if (!batch) {
        return res.status(404).json({ error: "No staging batch found" });
      }

      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const suggestions = await storage.getCrossSellStagingSuggestions(batch.id, tenantId);
      const { operations, skipped } = await buildStagingApplyOperations(client, suggestions);

      const { managedGroupName, maxTargetsPerManagedGroup } = await getCrossSellAutomationSettings(storage, tenantId);
      const catalog = await loadCrossSellCatalog(storage, tenantId);
      const result = await applyCrossSellPlan(client, operations, {
        mode: "staging",
        groupName: managedGroupName,
        maxTargets: maxTargetsPerManagedGroup,
        replace: replaceManagedGroup,
        onChange: createCrossSellChangeRecorder(storage, catalog, {
          tenantId,
          userId: (req.user as any)?.id ?? null,
          origin: "ai",
        }),
      });

      res.json({
        sourcesProcessed: result.sourcesProcessed,
        crossSellingsCreated: result.crossSellingsCreated,
        crossSellingsUpdated: result.crossSellingsUpdated,
        sourcesUnchanged: result.sourcesUnchanged,
        sourcesSkipped: skipped.length,
        productsAdded: result.productsAdded,
        productsRemoved: result.productsRemoved,
        replaceManagedGroup,
        errors: [
          ...skipped,
          ...result.errors.map((e) => ({
            sourceProductNumber: e.sourceProductNumber ?? e.sourceProductId,
            error: e.error,
          })),
        ],
      });
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

      // Vorschlaege je Produkt berechnen, dann gesammelt abgleichen (Nur-Hinzufuegen,
      // ausser replaceManagedGroup=true).
      const replaceManagedGroup = req.body?.replaceManagedGroup === true;
      const operations: CrossSellApplyOperation[] = [];
      const results = {
        totalProducts: allProducts.length,
        productsProcessed: 0,
        crossSellingsCreated: 0,
        crossSellingsUpdated: 0,
        productsSkipped: 0,
        productsAdded: 0,
        productsRemoved: 0,
        errors: [] as Array<{ productId: string; productName: string; error: string }>,
      };

      for (const product of allProducts) {
        try {
          const suggestions = await ruleEngine.suggestCrossSelling(product, rules, client, suggestOpts);
          const limitedSuggestions = dedupeAndLimitSuggestions(suggestions, 50);
          const targetProductIds = limitedSuggestions.map((s) => s.id).filter(Boolean) as string[];
          if (targetProductIds.length === 0 || !product.id) {
            results.productsSkipped++;
          } else {
            operations.push({ sourceProductId: product.id, sourceProductNumber: product.productNumber, targetProductIds });
          }
        } catch (error: any) {
          moduleLog.error({ err: error }, `[Bulk Execution] Error processing product ${product.name}:`);
          results.errors.push({ productId: product.id, productName: product.name, error: error.message || "Unknown error" });
        }
        results.productsProcessed++;
      }

      const nameById = new Map(allProducts.map((p) => [p.id, p.name]));
      const automation = await getCrossSellAutomationSettings(storage, req.tenantId ?? null);
      const catalog = await loadCrossSellCatalog(storage, req.tenantId ?? null);
      const applied = await applyCrossSellPlan(client, operations, {
        mode: "bulk",
        groupName: automation.managedGroupName,
        maxTargets: automation.maxTargetsPerManagedGroup,
        replace: replaceManagedGroup,
        onChange: createCrossSellChangeRecorder(storage, catalog, {
          tenantId: req.tenantId ?? null,
          userId: (req.user as any)?.id ?? null,
          origin: "manual_rule",
        }),
      });
      // Wie bisher: "erstellt" zaehlt alle beschriebenen Gruppen (neu + ergaenzt).
      results.crossSellingsCreated = applied.crossSellingsCreated + applied.crossSellingsUpdated;
      results.crossSellingsUpdated = applied.crossSellingsUpdated;
      results.productsAdded = applied.productsAdded;
      results.productsRemoved = applied.productsRemoved;
      for (const e of applied.errors) {
        results.errors.push({
          productId: e.sourceProductId,
          productName: nameById.get(e.sourceProductId) ?? e.sourceProductNumber ?? e.sourceProductId,
          error: e.error,
        });
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

      if (body.event === "draft_suggestions_impression" && body.draftId && sourceNum) {
        const targets = (body.metadata as Record<string, unknown> | undefined)?.suggestionProductNumbers;
        if (Array.isArray(targets)) {
          await storage.recordCrossSellEventsOncePerDraft(
            targets
              .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
              .map((t, i) => ({ sourceProductNumber: sourceNum, targetProductNumber: t.trim(), metadata: { rank: i + 1 } })),
            { eventType: "draft_suggestions_impression", draftId: body.draftId, context: body.context ?? null, userId },
            tid,
          );
        }
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

  // --- Cross-Selling-Gedaechtnis und Automatik-Einstellungen ---

  app.get("/api/cross-selling/automation-settings", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      res.json(await getCrossSellAutomationSettings(storage, req.tenantId ?? null));
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-selling automation settings:");
      res.status(500).json({ error: error.message || "Failed to fetch settings" });
    }
  });

  app.put("/api/cross-selling/automation-settings", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const patch = crossSellAutomationSettingsSchema.partial().parse(req.body ?? {});
      res.json(await saveCrossSellAutomationSettings(storage, patch, req.tenantId ?? null));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid settings" });
      }
      moduleLog.error({ err: error }, "Error saving cross-selling automation settings:");
      res.status(500).json({ error: error.message || "Failed to save settings" });
    }
  });

  /** Name der vom System verwalteten Liste (Vorgabe im Produkt-Dialog). */
  app.get("/api/cross-selling/managed-group", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const { managedGroupName } = await getCrossSellAutomationSettings(storage, req.tenantId ?? null);
      res.json({ name: managedGroupName });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching managed cross-selling group:");
      res.status(500).json({ error: error.message || "Failed to fetch settings" });
    }
  });

  /** Gedaechtnis-Eintraege, z. B. ?status=rejected fuer die Liste der abgelehnten Paare. */
  app.get("/api/cross-selling/pairs", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const allowed = ["suggested", "approved", "rejected", "applied", "removal_proposed", "removed"] as const;
      const statuses = String(req.query.status ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter((v): v is (typeof allowed)[number] => (allowed as readonly string[]).includes(v));
      const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
      const pairs = await storage.getCrossSellPairStates({ statuses, limit }, req.tenantId ?? null);
      res.json({ pairs });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-selling pairs:");
      res.status(500).json({ error: error.message || "Failed to fetch pairs" });
    }
  });

  /** Paar dauerhaft ablehnen: wird nie wieder vorgeschlagen, passende Staging-Vorschlaege werden abgewaehlt. */
  app.post("/api/cross-selling/pairs/reject", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const body = z
        .object({
          sourceProductNumber: z.string().trim().min(1).max(120),
          targetProductNumber: z.string().trim().min(1).max(120),
          reasonCode: z.enum(["incompatible", "other_system", "alternative", "not_relevant", "other"]),
          note: z.string().max(500).optional(),
          bothDirections: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      const catalog = await loadCrossSellCatalog(storage, tenantId);
      const pairs = await rejectCrossSellPair(storage, catalog, {
        tenantId,
        userId: (req.user as any)?.id ?? null,
        ...body,
      });

      let stagingDeactivated = 0;
      const batch = await storage.getLatestCrossSellStagingBatch(tenantId);
      if (batch && pairs.length > 0) {
        const keys = new Set(pairs.map((p) => `${p.sourceProductNumber}\u0000${p.targetProductNumber}`));
        const suggestions = await storage.getCrossSellStagingSuggestions(batch.id, tenantId);
        for (const sug of suggestions) {
          const key = `${catalog.canonicalNumber(sug.sourceProductNumber)}\u0000${catalog.canonicalNumber(sug.targetProductNumber)}`;
          if (sug.active === 1 && keys.has(key)) {
            await storage.updateCrossSellStagingSuggestion(sug.id, { active: 0 } as any, tenantId);
            stagingDeactivated += 1;
          }
        }
      }
      res.json({ pairs, stagingDeactivated });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid payload" });
      }
      moduleLog.error({ err: error }, "Error rejecting cross-selling pair:");
      res.status(500).json({ error: error.message || "Failed to reject pair" });
    }
  });

  /** Ablehnung bzw. Sperrfrist aufheben: das Paar darf wieder vorgeschlagen werden. */
  app.post("/api/cross-selling/pairs/:id/reset", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const updated = await storage.updateCrossSellPairState(
        req.params.id,
        {
          status: "suggested",
          pendingAction: null,
          cooldownUntil: null,
          decisionSource: "user",
          decidedByUserId: (req.user as any)?.id ?? null,
          decidedAt: new Date(),
          decisionReasonCode: "reset",
          decisionNote: null,
        },
        req.tenantId ?? null,
      );
      if (!updated) {
        return res.status(404).json({ error: "Pair not found" });
      }
      res.json(updated);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error resetting cross-selling pair:");
      res.status(500).json({ error: error.message || "Failed to reset pair" });
    }
  });

  /** Shop-Zuordnungen ins Gedaechtnis einlesen (nur lesend; 202, Status per jobs/status?type=import). */
  app.post("/api/cross-selling/import", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const client = new ShopwareClient(settings);
      const userId = (req.user as any)?.id ?? null;
      const { started, state } = startCrossSellJob(storage, tenantId, "import", async (job) =>
        runCrossSellImport(storage, client, {
          tenantId,
          userId,
          onProgress: (loaded) => {
            job.processed = loaded;
          },
        }),
      );
      res.status(202).json({ started, alreadyRunning: !started, status: state.status });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error starting cross-selling import:");
      res.status(500).json({ error: error.message || "Failed to start import" });
    }
  });

  app.get("/api/cross-selling/runs", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const kinds = ["learning", "candidates", "monthly_review", "import"] as const;
      const kind = (kinds as readonly string[]).includes(String(req.query.kind)) ? (req.query.kind as (typeof kinds)[number]) : undefined;
      const runs = await storage.getCrossSellRuns({ kind, limit: Number(req.query.limit) || 20 }, req.tenantId ?? null);
      res.json({ runs });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-selling runs:");
      res.status(500).json({ error: error.message || "Failed to fetch runs" });
    }
  });

  app.get("/api/cross-selling/change-log", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const entries = await storage.getCrossSellChangeLog(
        {
          limit: Number(req.query.limit) || 200,
          runId: typeof req.query.runId === "string" ? req.query.runId : undefined,
          sourceProductNumber: typeof req.query.sourceProductNumber === "string" ? req.query.sourceProductNumber : undefined,
        },
        req.tenantId ?? null,
      );
      res.json({ entries });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-selling change log:");
      res.status(500).json({ error: error.message || "Failed to fetch change log" });
    }
  });
}
