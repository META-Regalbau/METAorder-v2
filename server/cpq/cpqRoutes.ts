/**
 * CPQ API Routes
 */

import { type Express, type Request, type Response } from "express";
import { cpqStorage } from "./cpqStorage";
import { evaluateRules } from "./constraintEngine";
import { resolveBillOfMaterials } from "./cpqBillOfMaterials";
import { getCpqCrossSelling, validateCpqCart } from "./cpqCrossSelling";
import { prepareCpqCartTransfer } from "./cpqCartTransfer";
import { evaluateDiscountLevel } from "./discountEvaluator";
import type { requireAuth, requireViewCPQ, requireManageCPQ } from "../auth";

export function registerCpqRoutes(
  app: Express,
  auth: {
    requireAuth: typeof requireAuth;
    requireViewCPQ: typeof requireViewCPQ;
    requireManageCPQ: typeof requireManageCPQ;
    requireManageCPQDiscountLevels?: (req: any, res: any, next: any) => void;
    requireApproveCPQQuotes?: (req: any, res: any, next: any) => void;
  }
) {
  const { requireAuth: ra, requireViewCPQ: rv, requireManageCPQ: rm, requireManageCPQDiscountLevels: rd, requireApproveCPQQuotes: rApprove } = auth;
  const rDiscount = rd || rm;
  const rApproveOrManage = rApprove || rm;

  // GET /api/cpq/systems - list active systems
  app.get("/api/cpq/systems", ra, rv, async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId ?? null;
      const systems = await cpqStorage.getSystems(tenantId);
      res.json(systems);
    } catch (error: any) {
      console.error("[CPQ] Error fetching systems:", error);
      res.status(500).json({ error: error.message || "Failed to fetch systems" });
    }
  });

  // POST /api/cpq/systems - create system (admin)
  app.post("/api/cpq/systems", ra, rm, async (req: Request, res: Response) => {
    try {
      const { name, slug, description, status } = req.body;
      if (!name || !slug) return res.status(400).json({ error: "name and slug required" });
      const system = await cpqStorage.createSystem(
        { name, slug, description: description || null, status: status || "active" },
        req.tenantId ?? null
      );
      res.json(system);
    } catch (error: any) {
      console.error("[CPQ] Error creating system:", error);
      res.status(500).json({ error: error.message || "Failed to create system" });
    }
  });

  // GET /api/cpq/systems/:id - get single system
  app.get("/api/cpq/systems/:id", ra, rv, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const tenantId = req.tenantId ?? null;
      const system = await cpqStorage.getSystem(id, tenantId);
      if (!system) return res.status(404).json({ error: "System not found" });
      res.json(system);
    } catch (error: any) {
      console.error("[CPQ] Error fetching system:", error);
      res.status(500).json({ error: error.message || "Failed to fetch system" });
    }
  });

  // GET /api/cpq/systems/:id/components - get components for system (mappings enriched with productName from Shopware)
  app.get("/api/cpq/systems/:id/components", ra, rv, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const componentTypes = await cpqStorage.getComponentTypesBySystem(id);
      const mappings = await cpqStorage.getProductMappingsBySystem(id, req.tenantId ?? null);
      const { productCache } = await import("../productCache");
      const mappingsWithName = mappings.map((m) => {
        const product = productCache.getProductByIdentifier(m.shopwareProductNumber);
        const productName = m.productName ?? product?.name ?? null;
        const height = product?.dimensions?.height;
        const depth = product?.dimensions?.length;
        const loadCapacity = product?.customFields?.loadCapacity ?? product?.customFields?.tragfahigkeit ?? product?.customFields?.tragfähigkeit ?? product?.customFields?.load_capacity;
        const price = product?.price;
        const manufacturerNumber = product?.manufacturerNumber ?? null;
        const productDetails =
          height != null || depth != null || loadCapacity != null || price != null || manufacturerNumber != null
            ? { height: height ?? null, depth: depth ?? null, loadCapacity: loadCapacity ?? null, price: price ?? null, manufacturerNumber }
            : null;
        return { ...m, productName, productDetails };
      });
      res.json({ componentTypes, mappings: mappingsWithName });
    } catch (error: any) {
      console.error("[CPQ] Error fetching components:", error);
      res.status(500).json({ error: error.message || "Failed to fetch components" });
    }
  });

  // GET /api/cpq/product-mappings/:id/geometry - geometry for detail panel (anchor points, GLB, etc.)
  app.get("/api/cpq/product-mappings/:id/geometry", ra, rv, async (req: Request, res: Response) => {
    try {
      const { id: productMappingId } = req.params;
      const geometry = await cpqStorage.getGeometryByProductMapping(productMappingId);
      if (!geometry) return res.status(404).json({ error: "No geometry for this mapping" });
      res.json(geometry);
    } catch (error: any) {
      console.error("[CPQ] Error fetching geometry:", error);
      res.status(500).json({ error: error.message || "Failed to fetch geometry" });
    }
  });

  // PUT /api/cpq/product-mappings/:id/geometry - upsert geometry (admin)
  app.put("/api/cpq/product-mappings/:id/geometry", ra, rm, async (req: Request, res: Response) => {
    try {
      const { id: productMappingId } = req.params;
      const { origin, anchorPoints, boundingBox, glbAssetUrl, lodLevels } = req.body;
      const geometry = await cpqStorage.upsertGeometryByProductMapping(productMappingId, {
        origin,
        anchorPoints,
        boundingBox,
        glbAssetUrl: glbAssetUrl ?? null,
        lodLevels,
      });
      res.json(geometry);
    } catch (error: any) {
      console.error("[CPQ] Error upserting geometry:", error);
      res.status(500).json({ error: error.message || "Failed to upsert geometry" });
    }
  });

  // GET /api/cpq/glb-resolve?productNumber=X&manufacturerNumber=Y - resolve to GLB filename (admin)
  // productNumber = GTIN/EAN, manufacturerNumber = Artikelnummer (oft für GLB-Namen wie 10023_VZK.glb)
  app.get("/api/cpq/glb-resolve", ra, rm, async (req: Request, res: Response) => {
    try {
      const { resolveCpqGlbFromDisk, resolveCpqGlbPresentationPlaceholder } = await import("../cpqGlbResolve");
      const presentationOnly =
        req.query.presentationPlaceholder === "1" || req.query.presentationPlaceholder === "true";
      if (presentationOnly) {
        res.json(resolveCpqGlbPresentationPlaceholder());
        return;
      }
      const productNumber = (req.query.productNumber as string)?.trim();
      const manufacturerNumber = (req.query.manufacturerNumber as string)?.trim();
      if (!productNumber && !manufacturerNumber) {
        return res.status(400).json({ error: "productNumber or manufacturerNumber required" });
      }
      res.json(resolveCpqGlbFromDisk(productNumber || undefined, manufacturerNumber || undefined));
    } catch (error: any) {
      console.error("[CPQ] Error resolving GLB:", error);
      res.status(500).json({ error: error.message || "Failed to resolve GLB" });
    }
  });

  // GET /api/cpq/systems/:id/options - get available options for step (incl. derived from mappings)
  app.get("/api/cpq/systems/:id/options", ra, rv, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const step = parseInt(req.query.step as string) || 1;
      const config = typeof req.query.config === "string" ? JSON.parse(req.query.config || "{}") : {};
      const rules = await cpqStorage.getRulesBySystem(id, req.tenantId ?? null);
      const result = evaluateRules(rules, config);

      const defaultHeights = [1800, 2000, 2200, 2500, 3000];
      const defaultDepths = [400, 500, 600, 800];
      const defaultWidths = [800, 1000, 1200];
      const defaultFieldCounts = [1, 2, 3, 4, 5, 6, 8, 10];
      const defaultLevelCounts = [2, 3, 4, 5, 6, 8, 10];

      let availableOptions: {
        heights: number[];
        depths: number[];
        widths: number[];
        field_counts: number[];
        level_counts: number[];
      } = {
        heights: [...defaultHeights],
        depths: [...defaultDepths],
        widths: [...defaultWidths],
        field_counts: [...defaultFieldCounts],
        level_counts: [...defaultLevelCounts],
      };

      try {
        const [componentTypes, mappings] = await Promise.all([
          cpqStorage.getComponentTypesBySystem(id),
          cpqStorage.getProductMappingsBySystem(id, req.tenantId ?? null),
        ]);
        const { productCache } = await import("../productCache");
        const activeMappings = mappings.filter((m) => m.status === "active");
        const heights = new Set<number>();
        const depths = new Set<number>();
        const widths = new Set<number>();

        const roleNorm = (r: string) => r.toLowerCase().trim();
        const isFrame = (r: string) => ["frame", "steher", "ständer", "rahmen"].includes(roleNorm(r)) || roleNorm(r).includes("ständer") || roleNorm(r).includes("steher");
        const isBeam = (r: string) => ["beam", "traverse", "träger"].includes(roleNorm(r)) || roleNorm(r).includes("träger") || roleNorm(r).includes("traverse");
        const isShelf = (r: string) => ["shelf", "boden", "böden", "fachboden"].includes(roleNorm(r)) || roleNorm(r).includes("boden");

        for (const m of activeMappings) {
          const ct = componentTypes.find((c) => c.id === m.componentTypeId);
          const role = ct?.role ?? ct?.name ?? "";
          const attrs = (m.attributes as Record<string, number>) ?? {};
          const product = productCache.getProductByIdentifier(m.shopwareProductNumber);
          const dims = product?.dimensions;

          if (attrs.height) heights.add(attrs.height);
          if (attrs.depth) depths.add(attrs.depth);
          if (attrs.width) widths.add(attrs.width);
          if (dims) {
            if (dims.height) heights.add(dims.height);
            if (dims.length) depths.add(dims.length);
            if (dims.width) widths.add(dims.width);
          }
          if (isFrame(role)) {
            if (attrs.height) heights.add(attrs.height);
            if (attrs.depth) depths.add(attrs.depth);
            if (dims?.height) heights.add(dims.height);
            if (dims?.length) depths.add(dims.length);
          }
          if (isBeam(role) || isShelf(role)) {
            if (attrs.width) widths.add(attrs.width);
            if (dims?.width) widths.add(dims.width);
          }
        }

        if (heights.size > 0) availableOptions.heights = [...heights].sort((a, b) => a - b);
        if (depths.size > 0) availableOptions.depths = [...depths].sort((a, b) => a - b);
        if (widths.size > 0) availableOptions.widths = [...widths].sort((a, b) => a - b);
      } catch (e) {
        // keep defaults if productCache or mappings fail
      }

      res.json({
        options: result.config,
        availableOptions,
        messages: result.messages,
        errors: result.errors,
        warnings: result.warnings,
      });
    } catch (error: any) {
      console.error("[CPQ] Error fetching options:", error);
      res.status(500).json({ error: error.message || "Failed to fetch options" });
    }
  });

  // POST /api/cpq/configure - validate config and compute bill of materials
  app.post("/api/cpq/configure", ra, rv, async (req: Request, res: Response) => {
    try {
      const { systemId, config } = req.body;
      if (!systemId || !config) return res.status(400).json({ error: "systemId and config required" });
      const rules = await cpqStorage.getRulesBySystem(systemId, req.tenantId ?? null);
      const result = evaluateRules(rules, config);
      res.json(result);
    } catch (error: any) {
      console.error("[CPQ] Error configuring:", error);
      res.status(500).json({ error: error.message || "Failed to configure" });
    }
  });

  // POST /api/cpq/systems/:id/bill-of-materials - resolve config to Stückliste with product details
  app.post("/api/cpq/systems/:id/bill-of-materials", ra, rv, async (req: Request, res: Response) => {
    try {
      const { id: systemId } = req.params;
      const config = req.body.config ?? req.body;
      if (!systemId || !config) return res.status(400).json({ error: "systemId and config required" });

      const [componentTypes, mappings, rules] = await Promise.all([
        cpqStorage.getComponentTypesBySystem(systemId),
        cpqStorage.getProductMappingsBySystem(systemId, req.tenantId ?? null),
        cpqStorage.getRulesBySystem(systemId, req.tenantId ?? null),
      ]);

      const activeMappings = mappings.filter((m) => m.status === "active");
      if (componentTypes.length === 0) {
        return res.json({
          items: [],
          totalPrice: 0,
          errors: ["Bitte legen Sie zuerst Komponententypen im CPQ Admin an (Tab Produkt-Mappings → Komponententyp)."],
          warnings: [],
        });
      }
      if (activeMappings.length === 0) {
        return res.json({
          items: [],
          totalPrice: 0,
          errors: ["Keine Produkt-Mappings für dieses System. Bitte ordnen Sie im CPQ Admin Shopware-Produkte den Komponententypen zu (Tab Produkt-Mappings → Neues Mapping)."],
          warnings: [],
        });
      }

      const { productCache } = await import("../productCache");
      const getProduct = (productNumber: string) => {
        const p = productCache.getProductByIdentifier(productNumber);
        return p
          ? {
              id: p.id,
              name: p.name ?? productNumber,
              price: p.price ?? 0,
              dimensions: p.dimensions,
            }
          : undefined;
      };

      const bom = await resolveBillOfMaterials(
        systemId,
        config,
        componentTypes,
        mappings,
        rules,
        getProduct
      );
      res.json(bom);
    } catch (error: any) {
      console.error("[CPQ] Error bill-of-materials:", error);
      res.status(500).json({ error: error.message || "Failed to resolve bill of materials" });
    }
  });

  // POST /api/cpq/configurations - save configuration
  app.post("/api/cpq/configurations", ra, rv, async (req: Request, res: Response) => {
    try {
      const { systemId, customerId, name, configData, validationStatus, totalPrice } = req.body;
      if (!systemId || !name || !configData) return res.status(400).json({ error: "systemId, name and configData required" });
      const config = await cpqStorage.createConfiguration(
        { systemId, customerId: customerId || null, name, configData, validationStatus: validationStatus || "valid", totalPrice: totalPrice || null },
        req.tenantId ?? null
      );
      res.json(config);
    } catch (error: any) {
      console.error("[CPQ] Error saving configuration:", error);
      res.status(500).json({ error: error.message || "Failed to save configuration" });
    }
  });

  // POST /api/cpq/preview/scene - scene data for 3D preview (config-aware, uses scene builder)
  app.post("/api/cpq/preview/scene", ra, rv, async (req: Request, res: Response) => {
    try {
      const { systemId, config } = req.body;
      if (!systemId || !config) return res.status(400).json({ error: "systemId and config required" });
      const [componentTypes, mappings, rules] = await Promise.all([
        cpqStorage.getComponentTypesBySystem(systemId),
        cpqStorage.getProductMappingsBySystem(systemId, req.tenantId ?? null),
        cpqStorage.getRulesBySystem(systemId, req.tenantId ?? null),
      ]);
      const { productCache } = await import("../productCache");
      const getProduct = (productNumber: string) => {
        const p = productCache.getProductByIdentifier(productNumber);
        return p
          ? { id: p.id, name: p.name ?? productNumber, price: p.price ?? 0, dimensions: p.dimensions }
          : undefined;
      };
      const getGeometry = (id: string) => cpqStorage.getGeometryByProductMapping(id);
      const { buildScene } = await import("./sceneBuilder");
      const { components, config: cfg } = await buildScene(
        systemId,
        config,
        componentTypes,
        mappings,
        rules,
        getProduct,
        getGeometry
      );
      res.json({
        components: components.map((c) => ({
          productMappingId: c.productMappingId,
          instanceIndex: c.instanceIndex,
          glbUrl: c.glbUrl,
          position: c.position,
          scale: c.scale,
        })),
        config: cfg,
      });
    } catch (error: any) {
      console.error("[CPQ] Error building scene:", error);
      res.status(500).json({ error: error.message || "Failed to build scene" });
    }
  });

  // GET /api/cpq/configurations/:id - load configuration
  app.get("/api/cpq/configurations/:id", ra, rv, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const config = await cpqStorage.getConfiguration(id, req.tenantId ?? null);
      if (!config) return res.status(404).json({ error: "Configuration not found" });
      res.json(config);
    } catch (error: any) {
      console.error("[CPQ] Error loading configuration:", error);
      res.status(500).json({ error: error.message || "Failed to load configuration" });
    }
  });

  // Admin: GET /api/cpq/admin/rules
  app.get("/api/cpq/admin/rules", ra, rm, async (req: Request, res: Response) => {
    try {
      const systemId = req.query.system_id as string | undefined;
      if (!systemId) return res.status(400).json({ error: "system_id required" });
      const rules = await cpqStorage.getRulesBySystem(systemId, req.tenantId ?? null);
      res.json(rules);
    } catch (error: any) {
      console.error("[CPQ] Error fetching rules:", error);
      res.status(500).json({ error: error.message || "Failed to fetch rules" });
    }
  });

  // Admin: POST /api/cpq/admin/rules
  app.post("/api/cpq/admin/rules", ra, rm, async (req: Request, res: Response) => {
    try {
      const { systemId, name, type, priority, condition, action, fallback, message, status } = req.body;
      if (!systemId || !name || !type) return res.status(400).json({ error: "systemId, name and type required" });
      const user = req.user as any;
      const rule = await cpqStorage.createRule(
        {
          systemId,
          name,
          type,
          priority: priority ?? 0,
          condition: condition ?? null,
          action: action ?? null,
          fallback: fallback ?? null,
          message: message ?? null,
          status: status ?? "active",
          createdBy: user?.id || user?.username,
        },
        req.tenantId ?? null
      );
      res.json(rule);
    } catch (error: any) {
      console.error("[CPQ] Error creating rule:", error);
      res.status(500).json({ error: error.message || "Failed to create rule" });
    }
  });

  // Admin: PUT /api/cpq/admin/rules/:id
  app.put("/api/cpq/admin/rules/:id", ra, rm, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, type, priority, condition, action, fallback, message, status } = req.body;
      const existing = await cpqStorage.getRule(id, req.tenantId ?? null);
      if (!existing) return res.status(404).json({ error: "Rule not found" });
      await cpqStorage.createRuleVersion({ ruleId: id, version: existing.version, condition: existing.condition, action: existing.action, changedBy: (req.user as any)?.id });
      const rule = await cpqStorage.updateRule(id, {
        name: name ?? existing.name,
        type: type ?? existing.type,
        priority: priority ?? existing.priority,
        condition: condition ?? existing.condition,
        action: action ?? existing.action,
        fallback: fallback !== undefined ? fallback : existing.fallback,
        message: message !== undefined ? message : existing.message,
        status: status ?? existing.status,
        version: existing.version + 1,
      });
      res.json(rule);
    } catch (error: any) {
      console.error("[CPQ] Error updating rule:", error);
      res.status(500).json({ error: error.message || "Failed to update rule" });
    }
  });

  // Admin: DELETE /api/cpq/admin/rules/:id
  app.delete("/api/cpq/admin/rules/:id", ra, rm, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await cpqStorage.getRule(id, req.tenantId ?? null);
      if (!existing) return res.status(404).json({ error: "Rule not found" });
      await cpqStorage.updateRule(id, { status: "disabled" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("[CPQ] Error deleting rule:", error);
      res.status(500).json({ error: error.message || "Failed to delete rule" });
    }
  });

  // Admin: GET /api/cpq/admin/rules/:id/versions - versionsverlauf
  app.get("/api/cpq/admin/rules/:id/versions", ra, rm, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const rule = await cpqStorage.getRule(id, req.tenantId ?? null);
      if (!rule) return res.status(404).json({ error: "Rule not found" });
      const versions = await cpqStorage.getRuleVersions(id);
      res.json(versions);
    } catch (error: any) {
      console.error("[CPQ] Error fetching rule versions:", error);
      res.status(500).json({ error: error.message || "Failed to fetch versions" });
    }
  });

  // Admin: POST /api/cpq/admin/rules/:id/rollback/:version - rollback auf Version
  app.post("/api/cpq/admin/rules/:id/rollback/:version", ra, rm, async (req: Request, res: Response) => {
    try {
      const { id, version } = req.params;
      const v = parseInt(version, 10);
      if (isNaN(v)) return res.status(400).json({ error: "Invalid version" });
      const rule = await cpqStorage.getRule(id, req.tenantId ?? null);
      if (!rule) return res.status(404).json({ error: "Rule not found" });
      const versions = await cpqStorage.getRuleVersions(id);
      const target = versions.find((x: any) => x.version === v);
      if (!target) return res.status(404).json({ error: "Version not found" });
      await cpqStorage.createRuleVersion({ ruleId: id, version: rule.version, condition: rule.condition, action: rule.action, changedBy: (req.user as any)?.id });
      const updated = await cpqStorage.updateRule(id, {
        condition: target.condition,
        action: target.action,
        version: rule.version + 1,
      });
      res.json(updated);
    } catch (error: any) {
      console.error("[CPQ] Error rolling back rule:", error);
      res.status(500).json({ error: error.message || "Failed to rollback" });
    }
  });

  // Admin: POST /api/cpq/admin/rules/preview - Vorschau: Treffer gegen Konfigurationen/Mappings des Systems
  app.post("/api/cpq/admin/rules/preview", ra, rm, async (req: Request, res: Response) => {
    try {
      const { systemId: bodySystemId, ruleId, condition, action, type: ruleType } = req.body;
      const cond = condition ?? null;
      const act = action ?? null;

      let rule = ruleId ? await cpqStorage.getRule(ruleId, req.tenantId ?? null) : null;
      if (ruleId && !rule) return res.status(404).json({ error: "Rule not found" });

      const sysId = rule?.systemId ?? bodySystemId;
      if (!sysId) return res.status(400).json({ error: "systemId or ruleId required" });

      const c = rule ? (rule.condition as object) : cond;

      const { evaluateCondition } = await import("./ruleEvaluator");

      // 1. Gespeicherte Konfigurationen des Systems verwenden
      const savedConfigs = await cpqStorage.getConfigurationsBySystem(sysId, req.tenantId ?? null);
      let configs: Array<{ config: Record<string, unknown>; name?: string }> = [];
      if (savedConfigs.length > 0) {
        configs = savedConfigs
          .filter((sc) => sc.configData && typeof sc.configData === "object")
          .map((sc) => ({
            config: enrichConfigForEval(sc.configData as Record<string, unknown>),
            name: sc.name,
          }));
      }

      // 2. Falls keine Konfigurationen: Kombinationen aus Mappings-Attributen (height, depth etc.)
      if (configs.length === 0) {
        const mappings = await cpqStorage.getProductMappingsBySystem(sysId, req.tenantId ?? null);
        const heights = new Set<number>();
        const depths = new Set<number>();
        const fieldCounts = new Set<number>();
        const levelCounts = new Set<number>();
        for (const m of mappings) {
          const attrs = (m.attributes as Record<string, number> | null) ?? {};
          if (typeof attrs.height === "number") heights.add(attrs.height);
          if (typeof attrs.depth === "number") depths.add(attrs.depth);
          if (typeof attrs.field_count === "number") fieldCounts.add(attrs.field_count);
          if (typeof attrs.level_count === "number") levelCounts.add(attrs.level_count);
        }
        const hArr = heights.size > 0 ? Array.from(heights) : [2000, 2500];
        const dArr = depths.size > 0 ? Array.from(depths) : [600, 800];
        const fcArr = fieldCounts.size > 0 ? Array.from(fieldCounts) : [2, 4];
        const lcArr = levelCounts.size > 0 ? Array.from(levelCounts) : [2, 4, 5];
        for (const h of hArr) {
          for (const d of dArr) {
            for (const fc of fcArr) {
              for (const lc of lcArr) {
                configs.push({
                  config: enrichConfigForEval({ height: h, depth: d, field_count: fc, level_count: lc }),
                });
              }
            }
          }
        }
      }

      const matches: Array<{ config: Record<string, unknown>; name?: string }> = [];
      for (const item of configs) {
        const m = evaluateCondition(c as any, item.config as any);
        if (m) matches.push(item);
      }

      res.json({
        ruleId: rule?.id ?? null,
        ruleName: rule?.name ?? "Entwurf",
        totalTested: configs.length,
        matchCount: matches.length,
        sampleMatches: matches.slice(0, 5).map((x) => ({ ...x.config, _name: x.name })),
        source: savedConfigs.length > 0 ? "saved_configurations" : "mapping_attributes",
      });
    } catch (error: any) {
      console.error("[CPQ] Error rule preview:", error);
      res.status(500).json({ error: error.message || "Failed to preview rule" });
    }
  });

  function enrichConfigForEval(cfg: Record<string, unknown>): Record<string, unknown> {
    const h = (cfg.height as number) ?? 2000;
    const d = (cfg.depth as number) ?? 800;
    const fc = (cfg.field_count as number) ?? 4;
    const lc = (cfg.level_count as number) ?? 4;
    return {
      ...cfg,
      height: h,
      depth: d,
      field_count: fc,
      level_count: lc,
      frame_quantity: (cfg.frame_quantity as number) ?? fc + 1,
      beam_quantity: (cfg.beam_quantity as number) ?? lc * fc * 2,
      shelf_quantity: (cfg.shelf_quantity as number) ?? lc * fc,
      selected_frame: (cfg.selected_frame as object) ?? { height: h, depth: d },
      selected_beam: (cfg.selected_beam as object) ?? { width: 1000, length: d },
      selected_shelf: (cfg.selected_shelf as object) ?? { width: 1000, depth: d },
    };
  }

  // Admin: POST /api/cpq/admin/rules/:id/impact - Impact-Analyse
  app.post("/api/cpq/admin/rules/:id/impact", ra, rm, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const rule = await cpqStorage.getRule(id, req.tenantId ?? null);
      if (!rule) return res.status(404).json({ error: "Rule not found" });
      const configCount = await cpqStorage.countConfigurationsBySystem(rule.systemId, req.tenantId ?? null);
      res.json({
        ruleId: id,
        systemId: rule.systemId,
        configurationsAffected: configCount,
        message: `${configCount} Konfiguration(en) nutzen dieses System und könnten von Regeländerungen betroffen sein.`,
      });
    } catch (error: any) {
      console.error("[CPQ] Error impact analysis:", error);
      res.status(500).json({ error: error.message || "Failed to analyze impact" });
    }
  });

  // Admin: GET /api/cpq/admin/sync-status - Shopware-Sync-Status (Stub)
  app.get("/api/cpq/admin/sync-status", ra, rm, async (req: Request, res: Response) => {
    try {
      res.json({
        lastSync: null,
        status: "not_implemented",
        message: "Shopware-Sync wird über die bestehende META Order Produkt-API abgewickelt. Kein separater CPQ-Sync-Job.",
      });
    } catch (error: any) {
      console.error("[CPQ] Error sync status:", error);
      res.status(500).json({ error: error.message || "Failed to fetch sync status" });
    }
  });

  // POST /api/cpq/cross-selling - cross-selling recommendations for cart
  app.post("/api/cpq/cross-selling", ra, rv, async (req: Request, res: Response) => {
    try {
      const { cart_items } = req.body;
      if (!Array.isArray(cart_items)) return res.status(400).json({ error: "cart_items required as array" });
      const result = await getCpqCrossSelling(cart_items, req.tenantId ?? null);
      res.json(result);
    } catch (error: any) {
      console.error("[CPQ] Error cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to get cross-selling" });
    }
  });

  // POST /api/cpq/validate-cart - validate cart against CPQ rules
  app.post("/api/cpq/validate-cart", ra, rv, async (req: Request, res: Response) => {
    try {
      const { cart_items } = req.body;
      if (!Array.isArray(cart_items)) return res.status(400).json({ error: "cart_items required as array" });
      const result = await validateCpqCart(cart_items, req.tenantId ?? null);
      res.json(result);
    } catch (error: any) {
      console.error("[CPQ] Error validating cart:", error);
      res.status(500).json({ error: error.message || "Failed to validate cart" });
    }
  });

  // POST /api/cpq/cart/transfer - Warenkorb-Transfer nach Shopware (Phase 6)
  // Übertragt CPQ-Konfiguration in ein Shopware-Angebot über die B2B-Sellers-Suite Admin API.
  // Nutzt dieselbe Admin API wie Angebote, Bestellungen etc. – keine Store API erforderlich.
  app.post("/api/cpq/cart/transfer", ra, rv, async (req: Request, res: Response) => {
    try {
      const { cart_items, customer_id, sales_channel_id, create_offer } = req.body;
      const transfer = await prepareCpqCartTransfer({
        cartItems: cart_items,
        tenantId: req.tenantId ?? null,
        customerId: customer_id,
        salesChannelId: sales_channel_id,
        createOffer: create_offer,
      });
      res.json(transfer);
    } catch (error: any) {
      console.error("[CPQ] Error cart transfer:", error);
      const validationDetails = error?.details as unknown;
      if (validationDetails) {
        return res.status(400).json({
          error: error.message || "Warenkorb entspricht nicht den CPQ-Regeln",
          validation: validationDetails,
        });
      }
      if (
        typeof error?.message === "string" &&
        (error.message.includes("cart_items required") ||
          error.message.includes("cart_items.product_id") ||
          error.message.includes("cart_items.quantity"))
      ) {
        return res.status(400).json({ error: error.message });
      }
      if (typeof error?.message === "string" && error.message.includes("Shopware-Einstellungen")) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: error.message || "Failed to prepare cart transfer" });
    }
  });

  // GET /api/cpq/discount-levels - list active discount levels
  app.get("/api/cpq/discount-levels", ra, rv, async (req: Request, res: Response) => {
    try {
      const levels = await cpqStorage.getDiscountLevels(req.tenantId ?? null);
      res.json(levels);
    } catch (error: any) {
      console.error("[CPQ] Error fetching discount levels:", error);
      res.status(500).json({ error: error.message || "Failed to fetch discount levels" });
    }
  });

  // GET /api/cpq/discount-levels/evaluate - evaluate discount against levels (Rabatt-Ampel)
  app.get("/api/cpq/discount-levels/evaluate", ra, rv, async (req: Request, res: Response) => {
    try {
      const discount = parseFloat(String(req.query.discount || 0));
      const systemId = req.query.system_id as string | undefined;
      const customerGroup = req.query.customer_group as string | undefined;
      const orderValue = req.query.order_value ? parseFloat(String(req.query.order_value)) : undefined;
      const listPrice = req.query.list_price ? parseFloat(String(req.query.list_price)) : undefined;
      const discountedPrice = req.query.discounted_price ? parseFloat(String(req.query.discounted_price)) : undefined;
      const result = await evaluateDiscountLevel(
        discount,
        { systemId, customerGroup, orderValue },
        req.tenantId ?? null
      );
      if (!result) return res.json(null);
      const revenueLoss = listPrice && discountedPrice ? listPrice - discountedPrice : undefined;
      res.json({ ...result, revenueLoss, listPrice, discountedPrice });
    } catch (error: any) {
      console.error("[CPQ] Error evaluating discount:", error);
      res.status(500).json({ error: error.message || "Failed to evaluate discount" });
    }
  });

  // Admin: GET /api/cpq/admin/discount-levels - list all discount levels (incl. inactive)
  app.get("/api/cpq/admin/discount-levels", ra, rDiscount, async (req: Request, res: Response) => {
    try {
      const levels = await cpqStorage.getAllDiscountLevels(req.tenantId ?? null);
      res.json(levels);
    } catch (error: any) {
      console.error("[CPQ] Error fetching admin discount levels:", error);
      res.status(500).json({ error: error.message || "Failed to fetch discount levels" });
    }
  });

  // Admin: POST /api/cpq/admin/discount-levels - create discount level
  app.post("/api/cpq/admin/discount-levels", ra, rDiscount, async (req: Request, res: Response) => {
    try {
      const { name, color, icon, discountMin, discountMax, messageTemplate, approvalType, justificationRequired } = req.body;
      if (!name || !color || discountMax === undefined) return res.status(400).json({ error: "name, color, discountMax required" });
      const level = await cpqStorage.createDiscountLevel(
        {
          name,
          color,
          icon: icon || null,
          discountMin: discountMin ?? 0,
          discountMax,
          messageTemplate: messageTemplate || null,
          approvalType: approvalType || "none",
          justificationRequired: justificationRequired ?? false,
        },
        req.tenantId ?? null
      );
      res.json(level);
    } catch (error: any) {
      console.error("[CPQ] Error creating discount level:", error);
      res.status(500).json({ error: error.message || "Failed to create discount level" });
    }
  });

  // Admin: PUT /api/cpq/admin/discount-levels/:id - update discount level
  app.put("/api/cpq/admin/discount-levels/:id", ra, rDiscount, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, color, icon, discountMin, discountMax, messageTemplate, approvalType, justificationRequired, status } = req.body;
      const level = await cpqStorage.getDiscountLevelById(id, req.tenantId ?? null);
      if (!level) return res.status(404).json({ error: "Discount level not found" });
      const updated = await cpqStorage.updateDiscountLevel(id, {
        name: name ?? level.name,
        color: color ?? level.color,
        icon: icon !== undefined ? icon : level.icon,
        discountMin: discountMin !== undefined ? discountMin : level.discountMin,
        discountMax: discountMax !== undefined ? discountMax : level.discountMax,
        messageTemplate: messageTemplate !== undefined ? messageTemplate : level.messageTemplate,
        approvalType: approvalType ?? level.approvalType,
        justificationRequired: justificationRequired !== undefined ? justificationRequired : level.justificationRequired,
        status: status ?? level.status,
      });
      res.json(updated);
    } catch (error: any) {
      console.error("[CPQ] Error updating discount level:", error);
      res.status(500).json({ error: error.message || "Failed to update discount level" });
    }
  });

  // Admin: DELETE /api/cpq/admin/discount-levels/:id - delete discount level
  app.delete("/api/cpq/admin/discount-levels/:id", ra, rDiscount, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const level = await cpqStorage.getDiscountLevelById(id, req.tenantId ?? null);
      if (!level) return res.status(404).json({ error: "Discount level not found" });
      await cpqStorage.deleteDiscountLevel(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[CPQ] Error deleting discount level:", error);
      res.status(500).json({ error: error.message || "Failed to delete discount level" });
    }
  });

  // Admin: POST /api/cpq/admin/component-types - create component type
  app.post("/api/cpq/admin/component-types", ra, rm, async (req: Request, res: Response) => {
    try {
      const { systemId, name, role, required, sortOrder, icon, attributeSchema } = req.body;
      if (!systemId || !name || !role) return res.status(400).json({ error: "systemId, name and role required" });
      const ct = await cpqStorage.createComponentType({
        systemId,
        name,
        role,
        required: required ?? false,
        sortOrder: sortOrder ?? 0,
        icon: icon || null,
        attributeSchema: attributeSchema ?? null,
      });
      res.json(ct);
    } catch (error: any) {
      console.error("[CPQ] Error creating component type:", error);
      res.status(500).json({ error: error.message || "Failed to create component type" });
    }
  });

  // POST /api/cpq/offers/:id/request-approval - Freigabe anfordern (bei Rabatt-Ampel Gelb/Orange)
  app.post("/api/cpq/offers/:id/request-approval", ra, rv, async (req: Request, res: Response) => {
    try {
      const { id: offerId } = req.params;
      const { justification, listPrice, discountedPrice, discountPercent, discountLevelId } = req.body;
      const user = req.user as any;
      if (!offerId || !listPrice || discountedPrice === undefined || !discountPercent || !discountLevelId) {
        return res.status(400).json({ error: "offerId, listPrice, discountedPrice, discountPercent, discountLevelId required" });
      }
      const revenueLoss = Number(listPrice) - Number(discountedPrice);
      const level = await cpqStorage.getDiscountLevelById(discountLevelId, req.tenantId ?? null);
      const approvalType = level?.approvalType ?? "department_lead";
      const log = await cpqStorage.createQuoteLog(
        {
          offerId,
          userId: user?.id || user?.username || "unknown",
          discountPercent: String(discountPercent),
          discountLevelId,
          listPrice: String(listPrice),
          discountedPrice: String(discountedPrice),
          revenueLoss: String(revenueLoss),
          justification: justification || null,
          approvalType,
          approvalStatus: "pending",
        },
        req.tenantId ?? null
      );
      res.json({ success: true, quoteLog: log });
    } catch (error: any) {
      console.error("[CPQ] Error request approval:", error);
      res.status(500).json({ error: error.message || "Failed to request approval" });
    }
  });

  // GET /api/cpq/offers/:id/approval-status - Freigabe-Status eines Angebots
  app.get("/api/cpq/offers/:id/approval-status", ra, rv, async (req: Request, res: Response) => {
    try {
      const { id: offerId } = req.params;
      const log = await cpqStorage.getQuoteLogByOfferId(offerId, req.tenantId ?? null);
      if (!log) return res.json(null);
      res.json(log);
    } catch (error: any) {
      console.error("[CPQ] Error approval status:", error);
      res.status(500).json({ error: error.message || "Failed to fetch approval status" });
    }
  });

  // PUT /api/cpq/offers/:id/approve - Freigabe erteilen oder ablehnen
  app.put("/api/cpq/offers/:id/approve", ra, rApproveOrManage, async (req: Request, res: Response) => {
    try {
      const { id: offerId } = req.params;
      const { action, comment } = req.body;
      const user = req.user as any;
      if (!action || !["approve", "reject"].includes(action)) {
        return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
      }
      const log = await cpqStorage.getQuoteLogByOfferId(offerId, req.tenantId ?? null);
      if (!log || log.approvalStatus !== "pending") {
        return res.status(404).json({ error: "No pending approval found for this offer" });
      }
      const updated = await cpqStorage.updateQuoteLog(log.id, {
        approvalStatus: action === "approve" ? "approved" : "rejected",
        approvedBy: user?.id || user?.username,
        approvalComment: comment || null,
        approvedAt: new Date(),
      });
      res.json({ success: true, quoteLog: updated });
    } catch (error: any) {
      console.error("[CPQ] Error approve/reject:", error);
      res.status(500).json({ error: error.message || "Failed to process approval" });
    }
  });

  // GET /api/cpq/reporting/discount-overview - Rabatt-Reporting (Phase 6)
  app.get("/api/cpq/reporting/discount-overview", ra, rv, async (req: Request, res: Response) => {
    try {
      const from = (req.query.from as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
      const logs = await cpqStorage.getQuoteLogsForReporting(from, to, req.tenantId ?? null);
      const byLevel: Record<string, { count: number; totalRevenueLoss: number }> = {};
      let totalRevenueLoss = 0;
      for (const log of logs) {
        const key = log.discountLevelId || "unknown";
        if (!byLevel[key]) byLevel[key] = { count: 0, totalRevenueLoss: 0 };
        byLevel[key].count++;
        byLevel[key].totalRevenueLoss += Number(log.revenueLoss) || 0;
        totalRevenueLoss += Number(log.revenueLoss) || 0;
      }
      res.json({
        from,
        to,
        totalEntries: logs.length,
        totalRevenueLoss,
        byLevel,
        entries: logs.slice(0, 100),
      });
    } catch (error: any) {
      console.error("[CPQ] Error discount overview:", error);
      res.status(500).json({ error: error.message || "Failed to fetch discount overview" });
    }
  });

  // Admin: POST /api/cpq/admin/mappings - map Shopware product to CPQ
  app.post("/api/cpq/admin/mappings", ra, rm, async (req: Request, res: Response) => {
    try {
      const { shopwareProductId, shopwareProductNumber, productName, systemId, componentTypeId, attributes, status } = req.body;
      if (!shopwareProductId || !shopwareProductNumber || !systemId || !componentTypeId) {
        return res.status(400).json({ error: "shopwareProductId, shopwareProductNumber, systemId and componentTypeId required" });
      }
      const mapping = await cpqStorage.createProductMapping(
        {
          shopwareProductId,
          shopwareProductNumber,
          productName: productName ?? null,
          systemId,
          componentTypeId,
          attributes: attributes ?? null,
          status: status ?? "active",
        },
        req.tenantId ?? null
      );
      res.json(mapping);
    } catch (error: any) {
      console.error("[CPQ] Error creating mapping:", error);
      res.status(500).json({ error: error.message || "Failed to create mapping" });
    }
  });
}
