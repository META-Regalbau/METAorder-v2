// Produkte: Liste/Uebersicht/Details, Preise und Herstellpreise, Sichtbarkeits-Import, OBX-Suche, Kategorien/Kanaele/3D-Modell je Produkt, Shopware-Cross-Selling, Produktcache und Bundles.
import { requireAuth, requireCsrf, requireManageProducts, requireManageSettings, requireManageCrossSellingGroups } from "../auth/auth";
import { storage } from "../storage";
import { ShopwareClient, type ShopwareProductOverview, applyOverviewParentInheritance, normalizeShopwareEntityId, isShopwareEntityId } from "../shopware/shopware";
import { getSalesChannelFilter, uploadRateLimiter } from "./routeHelpers";
import { type Product, SHOPWARE_CROSS_SELLING_STOREFRONT_NAME } from "@shared/schema";
import path from "path";
import fsSync from "fs";
import { getHerstellpreisLookupKey } from "../products/productIdentifiers";
import { loadCrmProfitabilitySettings } from "../analytics/crmProfitabilitySettings";
import multer from "multer";
import { restoreTenantContext } from "../lib/tenantContext";
import { parseHerstellpreisRowsFromBuffer, runHerstellpreisImport } from "../products/herstellpreisImport";
import { buildVisibilityImportTemplateBuffer, parseVisibilityMatrixFromBuffer, runVisibilityImport } from "../products/productVisibilityImport";
import { productCache } from "../products/productCache";
import { type ObxArticle, type ObxHeader, parseObxContent } from "../extraction/obxParser";
import { z } from "zod";
import fs from "fs/promises";
import { executeSemanticProductSearch, interpretSemanticProductQuery } from "../semantic/semanticProductSearch";
import { takeMinuteSlot } from "../analytics/nlQueryLimit";

/** KI-Produktsuche: hoechstens so viele KI-Aufrufe je Nutzer und Minute */
export const PRODUCT_AI_PER_MINUTE = 10;
import { getCombinedCrossSellingRules, loadCrossSellRankingBundle, crossSellSuggestOptions, dedupeAndLimitSuggestions } from "../cross-selling/crossSellService";
import { RuleEngine } from "../cross-selling/ruleEngine";
import type { Express } from "express";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "routes/productRoutes" });

export function registerProductRoutes(app: Express): void {
  // Products routes
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      
      // Get pagination and search parameters
      const limit = parseInt(req.query.limit as string) || 100;
      const page = parseInt(req.query.page as string) || 1;
      const search = req.query.search as string | undefined;
      const categoryId = req.query.categoryId as string | undefined;
      
      // Get dimensions filter parameters
      const width = req.query.width ? parseFloat(req.query.width as string) : undefined;
      const height = req.query.height ? parseFloat(req.query.height as string) : undefined;
      const depth = req.query.depth ? parseFloat(req.query.depth as string) : undefined;
      
      // Determine if user is admin
      const user = req.user as any;
      
      // Check both roleDetails.name (new system) and user.role (legacy fallback)
      const isAdmin =
        user?.roleDetails?.name === 'Administrator' ||
        user?.role === 'admin';
      const canManageProducts =
        isAdmin || user?.roleDetails?.permissions?.manageProducts === true;
      
      // Admin/permission-only: Check if user wants to see only inactive products
      const showInactive = canManageProducts && req.query.showInactive === 'true';
      const withGlb = req.query.withGlb === 'true';
      const withVariantsOnly = req.query.withVariantsOnly === "true";
      const includeVariants = req.query.includeVariants === "true";

      const allowedChannelIds = await getSalesChannelFilter(req);
      const requestedChannelIds = typeof req.query.salesChannelIds === "string" && req.query.salesChannelIds.length > 0
        ? req.query.salesChannelIds.split(",")
        : [];
      let salesChannelIds: string[] | undefined = undefined;
      if (allowedChannelIds === null) {
        salesChannelIds = requestedChannelIds.length > 0 ? requestedChannelIds : undefined;
      } else if (allowedChannelIds.length > 0) {
        salesChannelIds = requestedChannelIds.length > 0
          ? requestedChannelIds.filter((id) => allowedChannelIds.includes(id))
          : allowedChannelIds;
      } else {
        return res.json({ products: [], total: 0 });
      }
      
      moduleLog.info(`[/api/products] User: ${user?.username}, Role: ${user?.roleDetails?.name || user?.role}, isAdmin: ${isAdmin}, showInactive: ${showInactive}, withGlb: ${withGlb}, withVariantsOnly: ${withVariantsOnly}, includeVariants: ${includeVariants}, categoryId: ${categoryId || "all"}, width: ${width || "any"}, height: ${height || "any"}, depth: ${depth || "any"}`);

      let result: { products: Product[]; total: number };

      // withGlb needs live pagination + filesystem matching — keep Shopware path.
      // Normal product list: serve from persistent mirror when available.
      if (!withGlb && !categoryId && width == null && height == null && depth == null && !withVariantsOnly) {
        const tenantId = (req as any).tenantId as string | null | undefined;
        const mirrorCount = await storage.countShopwareProductMirrors(tenantId);
        if (mirrorCount > 0) {
          const { mirrorRowsToProducts, mirrorPayloadToOverview, triggerShopwareMirrorSync } =
            await import("../shopware/shopwareMirror");
          // Keep mirror warm in background
          triggerShopwareMirrorSync(storage, client, tenantId ?? null, ["products"]);

          const { rows, total } = await storage.getShopwareProductMirrors(
            {
              search,
              activeOnly: !showInactive,
              salesChannelIds,
              page,
              limit,
            },
            tenantId,
          );

          // Prefer full Product shape when payload has overview fields
          const products: Product[] = [];
          for (const row of rows) {
            const overview = mirrorPayloadToOverview(row.payload);
            if (overview) {
              products.push({
                id: overview.id,
                productNumber: overview.productNumber,
                name: overview.name,
                price: overview.priceGross,
                netPrice: overview.priceNet,
                currency: overview.currency || "EUR",
                taxRate: overview.taxRate,
                stock: overview.stock ?? 0,
                available: (overview.stock ?? 0) > 0,
                active: overview.active ?? undefined,
                childCount: overview.childCount ?? undefined,
                parentId: overview.parentId,
                manufacturerName: overview.manufacturerName,
                manufacturerNumber: overview.manufacturerNumber,
                categoryNames: overview.categories,
                ean: overview.ean,
                customFields: overview.customFields as Record<string, any> | undefined,
                createdAt: overview.createdAt,
                updatedAt: overview.updatedAt,
              });
            }
          }
          // Fallback if payloads were incomplete
          if (products.length === 0 && rows.length > 0) {
            result = { products: mirrorRowsToProducts(rows), total };
          } else {
            result = { products, total };
          }
          return res.json(result);
        }
        // Cold start: trigger sync and fall through to live fetch
        const { triggerShopwareMirrorSync } = await import("../shopware/shopwareMirror");
        triggerShopwareMirrorSync(storage, client, ((req as any).tenantId as string | null) ?? null, [
          "products",
        ]);
      }

      if (withGlb) {
        result = await client.fetchProducts(
          500,
          1,
          search,
          categoryId,
          showInactive,
          width,
          height,
          depth,
          false,
          salesChannelIds,
          withVariantsOnly,
          includeVariants
        );
      } else {
        result = await client.fetchProducts(
          limit,
          page,
          search,
          categoryId,
          showInactive,
          width,
          height,
          depth,
          false,
          salesChannelIds,
          withVariantsOnly,
          includeVariants
        );
      }

      if (withGlb && result.products.length > 0) {
        const cpqGlbPath = process.env.CPQ_GLB_PATH || path.resolve(process.cwd(), "client", "public", "cpq-models");
        let glbFiles: string[] = [];
        if (fsSync.existsSync(cpqGlbPath)) {
          glbFiles = fsSync.readdirSync(cpqGlbPath).filter((f) => f.endsWith(".glb"));
        }
        const tryMatch = (pn: string) => pn && glbFiles.some((f) => f.startsWith(pn) || f.startsWith(String(pn).replace(/^0+/, "")));
        const matchesGlb = (p: { productNumber?: string; manufacturerNumber?: string }) =>
          tryMatch(p.manufacturerNumber ?? "") || tryMatch(p.productNumber ?? "");

        let filtered = result.products.filter(matchesGlb);
        let fetched = result.products.length;
        let shopwarePage = 2;
        const maxPages = 50;
        while (fetched < result.total && filtered.length < result.total && shopwarePage <= maxPages) {
          const next = await client.fetchProducts(
            500,
            shopwarePage,
            search,
            categoryId,
            showInactive,
            width,
            height,
            depth,
            false,
            salesChannelIds,
            withVariantsOnly,
            includeVariants
          );
          if (next.products.length === 0) break;
          filtered = filtered.concat(next.products.filter(matchesGlb));
          fetched += next.products.length;
          shopwarePage++;
          if (next.products.length < 500) break;
        }

        const total = filtered.length;
        const start = (page - 1) * limit;
        const products = filtered.slice(start, start + limit);
        result = { products, total };
      } else if (withGlb) {
        result = { products: [], total: 0 };
      }

      res.json(result);
    } catch (error: any) {
      const msg = error?.message || "Failed to fetch products";
      moduleLog.error({ messageText: msg, stack: error?.stack }, "[/api/products] Error:");
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/products/:productId/pricing-details", requireAuth, async (req, res) => {
    try {
      const { productId } = req.params;
      const tenantId = (req as any).tenantId as string | null | undefined;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const pricing = await client.fetchProductAdvancedPricing(productId);
      if (!pricing) {
        return res.status(404).json({ error: "Product not found" });
      }

      res.json(pricing);
    } catch (error: any) {
      moduleLog.error({ err: error }, "[/api/products/pricing-details] Error:");
      res.status(500).json({ error: "Failed to load product pricing details" });
    }
  });

  // Produkt-Übersicht: Alle Produkte inkl. Verkaufskanal-Zuordnung, erweiterten Preisen,
  // Kategorien und Customfields. Liest aus dem persistenten Shopware-Spiegel (Delta-Sync);
  // Filterung/Sortierung/Pagination passiert clientseitig.
  app.get("/api/products/overview", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId as string | null | undefined;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const includeInactive = req.query.includeInactive !== "false"; // Standard: auch inaktive zeigen

      // Verkaufskanal-Berechtigung des Nutzers (null = alle Kanäle)
      const allowedChannelIds = await getSalesChannelFilter(req);
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return res.json({ products: [], salesChannels: [], total: 0 });
      }

      // Kanal-Namen auflösen und ggf. auf erlaubte Kanäle einschränken
      const allChannels = await client.fetchSalesChannels();
      const channelNameById = new Map(allChannels.map((c) => [c.id, c.name]));
      const visibleChannels = allowedChannelIds
        ? allChannels.filter((c) => allowedChannelIds.includes(c.id))
        : allChannels;

      const { mirrorPayloadToOverview, triggerShopwareMirrorSync } = await import("../shopware/shopwareMirror");
      let overview: ShopwareProductOverview[] = [];

      const mirrorCount = await storage.countShopwareProductMirrors(tenantId);
      if (mirrorCount > 0) {
        const { rows: mirrorRows } = await storage.getShopwareProductMirrors(
          {
            includeInactive,
            activeOnly: !includeInactive,
            salesChannelIds: allowedChannelIds ?? undefined,
          },
          tenantId,
        );
        overview = mirrorRows
          .map((row) => mirrorPayloadToOverview(row.payload, row.lastPriceChangeAt))
          .filter((p): p is ShopwareProductOverview => Boolean(p));
        if (!includeInactive) {
          overview = overview.filter((p) => p.active !== false);
        }
      } else {
        // Cold-Start: Live-Fetch einmalig + Background-Sync anstossen
        triggerShopwareMirrorSync(storage, client, tenantId ?? null, ["products"]);
        const overviewById = new Map<string, ShopwareProductOverview>();
        const BATCH_SIZE = 500;
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const { products } = await client.fetchProductsOverviewPage(BATCH_SIZE, page, {
            includeInactive,
            salesChannelIds: allowedChannelIds ?? undefined,
          });
          for (const product of products) {
            overviewById.set(product.id, product);
          }
          hasMore = products.length === BATCH_SIZE;
          page++;
        }
        overview = Array.from(overviewById.values());
      }

      // Varianten ohne eigene Werte: Shopware-Vererbung vom Elternprodukt für die Listenanzeige
      overview = applyOverviewParentInheritance(overview);

      // Fehlende Lieferzeit-Namen (älterer Spiegel / falscher includes-Alias) nachladen
      const missingDeliveryTimeIds = Array.from(
        new Set(
          overview
            .filter((p) => p.deliveryTimeId && !p.deliveryTimeName)
            .map((p) => String(p.deliveryTimeId)),
        ),
      );
      if (missingDeliveryTimeIds.length > 0) {
        try {
          const deliveryById = await client.resolveDeliveryTimes(missingDeliveryTimeIds);
          if (deliveryById.size > 0) {
            overview = overview.map((p) => {
              if (!p.deliveryTimeId || p.deliveryTimeName) return p;
              const resolved = deliveryById.get(normalizeShopwareEntityId(String(p.deliveryTimeId)));
              if (!resolved?.name && resolved?.min == null && resolved?.max == null) return p;
              return {
                ...p,
                deliveryTimeName: resolved.name ?? p.deliveryTimeName,
                deliveryTimeMin: resolved.min ?? p.deliveryTimeMin,
                deliveryTimeMax: resolved.max ?? p.deliveryTimeMax,
                deliveryTimeUnit: resolved.unit ?? p.deliveryTimeUnit,
                hasDeliveryTime: true,
              };
            });

            // Spiegel nachziehen (fire-and-forget), damit nächste Loads ohne Shopware-Roundtrip Namen haben
            void (async () => {
              try {
                const { db } = await import("../db");
                const { shopwareProducts } = await import("@shared/schema");
                const { sql, and, eq } = await import("drizzle-orm");
                for (const [id, resolved] of deliveryById.entries()) {
                  if (!resolved.name && resolved.min == null && resolved.max == null) continue;
                  const patch = {
                    deliveryTimeName: resolved.name,
                    deliveryTimeMin: resolved.min,
                    deliveryTimeMax: resolved.max,
                    deliveryTimeUnit: resolved.unit,
                    hasDeliveryTime: true,
                  };
                  const conditions = [
                    sql`lower(replace(coalesce(${shopwareProducts.payload}->>'deliveryTimeId', ''), '-', '')) = ${id}`,
                    sql`coalesce(${shopwareProducts.payload}->>'deliveryTimeName', '') = ''`,
                  ];
                  if (tenantId) {
                    conditions.push(eq(shopwareProducts.tenantId, tenantId));
                  }
                  await db
                    .update(shopwareProducts)
                    .set({
                      payload: sql`${shopwareProducts.payload} || ${JSON.stringify(patch)}::jsonb`,
                    })
                    .where(and(...conditions));
                }
              } catch (err) {
                moduleLog.warn({ err }, "[/api/products/overview] delivery time mirror patch failed:");
              }
            })();
          }
        } catch (err) {
          moduleLog.warn({ err }, "[/api/products/overview] delivery time resolve failed:");
        }
      }

      // Customfield-Werte, die Shopware-UUIDs sind → übersetzte Entity-Namen auflösen
      const entityIds = new Set<string>();
      for (const p of overview) {
        const cf = p.customFields;
        if (!cf || typeof cf !== "object") continue;
        for (const value of Object.values(cf)) {
          if (isShopwareEntityId(value)) entityIds.add(String(value).trim());
          if (Array.isArray(value)) {
            for (const item of value) {
              if (isShopwareEntityId(item)) entityIds.add(String(item).trim());
            }
          }
        }
      }
      let entityNameById = new Map<string, string>();
      if (entityIds.size > 0) {
        try {
          entityNameById = await client.resolveEntityDisplayNames(Array.from(entityIds));
        } catch (err) {
          moduleLog.warn({ err }, "[/api/products/overview] entity name resolve failed:");
        }
      }

      const resolveCustomFieldDisplay = (cf: Record<string, unknown> | undefined): Record<string, string> => {
        const display: Record<string, string> = {};
        if (!cf) return display;
        for (const [key, value] of Object.entries(cf)) {
          if (isShopwareEntityId(value)) {
            const name = entityNameById.get(normalizeShopwareEntityId(String(value)));
            if (name) display[key] = name;
          } else if (Array.isArray(value)) {
            const parts = value.map((item) => {
              if (!isShopwareEntityId(item)) return String(item ?? "");
              return (
                entityNameById.get(normalizeShopwareEntityId(String(item))) || String(item)
              );
            });
            if (parts.some(Boolean)) display[key] = parts.filter(Boolean).join(", ");
          }
        }
        return display;
      };

      const lookupKeys = overview
        .map((p) => getHerstellpreisLookupKey(p.customFields as Record<string, unknown> | undefined, p.productNumber))
        .filter((key): key is string => Boolean(key));
      const herstellMap = await storage.getProductHerstellpreiseByProductNumbers(lookupKeys, tenantId);
      const profitabilitySettings = await loadCrmProfitabilitySettings(storage, tenantId);

      const rows = overview.map((p) => {
        const lookupKey = getHerstellpreisLookupKey(
          p.customFields as Record<string, unknown> | undefined,
          p.productNumber,
        );
        const customFieldsDisplay = resolveCustomFieldDisplay(
          p.customFields as Record<string, unknown> | undefined,
        );
        const visibilityByChannelId = new Map(
          (p.salesChannelVisibilities ?? []).map((v) => [v.salesChannelId, v.visibility]),
        );
        return {
          ...p,
          customFieldsDisplay:
            Object.keys(customFieldsDisplay).length > 0 ? customFieldsDisplay : undefined,
          herstellpreisNet: lookupKey ? (herstellMap.get(lookupKey) ?? null) : null,
          salesChannels: (p.salesChannelIds || []).map((id) => ({
            id,
            name: channelNameById.get(id) || id,
            // null = Sichtbarkeit unbekannt (aelterer Spiegel ohne salesChannelVisibilities)
            visibility: visibilityByChannelId.get(id) ?? null,
          })),
          hasAdvancedPrices: (p.advancedPrices || []).length > 0,
          advancedPriceCount: (p.advancedPrices || []).length,
          customFieldKeys: p.customFields ? Object.keys(p.customFields) : [],
        };
      });

      res.json({
        products: rows,
        salesChannels: visibleChannels.map((c) => ({ id: c.id, name: c.name })),
        total: rows.length,
        profitabilityMinMarginPercent: profitabilitySettings.minMarginPercent,
        fromMirror: mirrorCount > 0,
      });
    } catch (error: any) {
      const msg = error?.message || "Produkt-Übersicht fehlgeschlagen";
      moduleLog.error({ messageText: msg, stack: error?.stack }, "[/api/products/overview] Error:");
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/products/:shopwareId/price-history", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId as string | null | undefined;
      const history = await storage.getProductPriceHistory(req.params.shopwareId, tenantId);
      res.json({ history });
    } catch (error: any) {
      const msg = error?.message || "Preis-Historie fehlgeschlagen";
      moduleLog.error({ messageText: msg, stack: error?.stack }, "[/api/products/:shopwareId/price-history] Error:");
      res.status(500).json({ error: msg });
    }
  });

  /**
   * Zusatz-Stammdaten eines einzelnen Produkts, die die Übersichtsliste nicht mitliefert:
   * Beschreibung, Bild, Maße, Eigenschaften und Varianten. Wird erst beim Öffnen des
   * Produkt-Modals geladen (Live-Abruf aus Shopware, nicht aus dem Spiegel).
   */
  app.get("/api/products/:productId/detail", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId as string | null | undefined;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { productId } = req.params;

      const allowedChannelIds = await getSalesChannelFilter(req);
      if (allowedChannelIds !== null) {
        const { salesChannelIds } = await client.fetchProductSalesChannelIds(productId);
        const hasAccess = salesChannelIds.some((id) => allowedChannelIds.includes(id));
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied: no sales channel permissions" });
        }
      }

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
        true,
        productId,
      );
      const product = products[0];
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      res.json({ product });
    } catch (error: any) {
      const msg = error?.message || "Produkt-Details fehlgeschlagen";
      moduleLog.error({ messageText: msg, stack: error?.stack }, "[/api/products/:productId/detail] Error:");
      res.status(500).json({ error: msg });
    }
  });

  const herstellpreisUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });

  // Herstellkosten aus ÜbersichtVerkaufsartikel.xlsx → META Order (nicht Shopware)
  app.post(
    "/api/products/herstellpreise/import",
    requireAuth,
    requireCsrf,
    requireManageProducts,
    uploadRateLimiter,
    herstellpreisUpload.single("file"), restoreTenantContext,
    async (req, res) => {
      try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file?.buffer) {
          return res.status(400).json({ error: "Keine Excel-Datei hochgeladen" });
        }

        const tenantId = (req as any).tenantId as string | null | undefined;
        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        const apply = req.body?.apply === true || req.body?.apply === "true" || req.body?.apply === "1";

        let rows;
        try {
          rows = parseHerstellpreisRowsFromBuffer(file.buffer);
        } catch (parseError: any) {
          return res.status(400).json({ error: parseError?.message || "Excel konnte nicht gelesen werden" });
        }

        const client = new ShopwareClient(settings);
        const ifsCatalog = await client.loadIfsProductNumberCatalog({ includeInactive: true });
        const result = await runHerstellpreisImport(
          {
            storage,
            tenantId,
            ifsCatalog,
          },
          rows,
          { apply },
        );
        res.json(result);
      } catch (error: any) {
        moduleLog.error({ err: error }, "[/api/products/herstellpreise/import] Error:");
        res.status(500).json({ error: error.message || "Herstellpreis-Import fehlgeschlagen" });
      }
    },
  );

  const visibilityImportUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });

  // Excel-Vorlage: Identifier + Spalte je Verkaufskanal + Legende
  app.get(
    "/api/products/visibility/import-template",
    requireAuth,
    requireManageProducts,
    async (req, res) => {
      try {
        const tenantId = (req as any).tenantId as string | null | undefined;
        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }
        const client = new ShopwareClient(settings);
        const salesChannels = await client.fetchSalesChannels();
        const buffer = buildVisibilityImportTemplateBuffer(salesChannels);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="sichtbarkeit-import-vorlage.xlsx"',
        );
        res.send(buffer);
      } catch (error: any) {
        moduleLog.error({ err: error }, "[/api/products/visibility/import-template] Error:");
        res.status(500).json({ error: error.message || "Vorlage konnte nicht erzeugt werden" });
      }
    },
  );

  // Sichtbarkeit je Verkaufskanal per Excel-Matrix (Dry-Run / Apply)
  app.post(
    "/api/products/visibility/import",
    requireAuth,
    requireCsrf,
    requireManageProducts,
    uploadRateLimiter,
    visibilityImportUpload.single("file"), restoreTenantContext,
    async (req, res) => {
      try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file?.buffer) {
          return res.status(400).json({ error: "Keine Excel-Datei hochgeladen" });
        }

        const tenantId = (req as any).tenantId as string | null | undefined;
        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        const apply =
          req.body?.apply === true || req.body?.apply === "true" || req.body?.apply === "1";

        let rows;
        try {
          rows = parseVisibilityMatrixFromBuffer(file.buffer);
        } catch (parseError: any) {
          return res.status(400).json({
            error: parseError?.message || "Excel konnte nicht gelesen werden",
          });
        }

        if (rows.length === 0) {
          return res.status(400).json({ error: "Keine Datenzeilen in der Excel-Datei gefunden" });
        }

        const client = new ShopwareClient(settings);
        await productCache.ensurePopulated(client);
        const products = productCache.getProducts();
        const salesChannels = await client.fetchSalesChannels();

        const result = await runVisibilityImport(
          { client, products, salesChannels },
          rows,
          { apply },
          (msg) => moduleLog.info(`${msg}`),
        );
        res.json(result);
      } catch (error: any) {
        moduleLog.error({ err: error }, "[/api/products/visibility/import] Error:");
        res.status(500).json({ error: error.message || "Sichtbarkeits-Import fehlgeschlagen" });
      }
    },
  );

  // OBX-Suche: Artikel aus hochgeladenen OBX-Dateien gegen den Katalog abgleichen
  // und die NICHT gefundenen Artikel als kommagetrennte Liste zurückgeben.
  const obxUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 500 },
  });

  app.post(
    "/api/products/obx-search",
    requireAuth,
    requireCsrf,
    obxUpload.array("files", 500), restoreTenantContext,
    async (req, res) => {
      try {
        const files = ((req as any).files as Express.Multer.File[] | undefined) || [];
        if (files.length === 0) {
          return res.status(400).json({ error: "Keine OBX-Dateien hochgeladen" });
        }

        // Tenant explizit aus dem Request lesen: multer (Multipart) bricht die
        // AsyncLocalStorage-Tenant-Weitergabe, daher den über requireAuth gesetzten
        // req.tenantId direkt an storage durchreichen.
        const tenantId = (req as any).tenantId as string | null | undefined;

        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        // Bewusst KEIN gemeinsamer In-Memory-Cache: Für den Abgleich wird immer der
        // aktuelle Stand des jeweiligen Mandanten frisch aus Shopware geladen.
        const client = new ShopwareClient(settings);
        const products: Product[] = [];
        const PRODUCT_BATCH_SIZE = 500; // Shopware-Maximum pro Request
        let productPage = 1;
        let hasMoreProducts = true;
        while (hasMoreProducts) {
          const { products: batch } = await client.fetchProducts(
            PRODUCT_BATCH_SIZE,
            productPage,
            undefined, // keine Suche
            undefined, // keine Kategorie
            false, // nur aktive Produkte
          );
          products.push(...batch);
          hasMoreProducts = batch.length === PRODUCT_BATCH_SIZE;
          productPage++;
        }

        // Identifier-Normalisierung: trimmen, Trennzeichen entfernen, lowercase.
        // Bewusst KEINE führenden Nullen entfernen, um Verwechslungen zu vermeiden.
        const IDENTIFIER_SEPARATORS_RE = /[\s\u00A0\-–._/]/g;
        const normalizeIdentifier = (value: unknown): string | undefined => {
          if (typeof value !== "string") {
            if (typeof value === "number" && Number.isFinite(value)) value = String(value);
            else return undefined;
          }
          const compact = (value as string).trim().replace(IDENTIFIER_SEPARATORS_RE, "");
          return compact ? compact.toLowerCase() : undefined;
        };

        // Liest das Customfield wdu_ifs_productnumber (case-insensitiver Key-Fallback)
        const getIfsProductNumber = (customFields: Record<string, any> | undefined): string | undefined => {
          if (!customFields || typeof customFields !== "object") return undefined;
          const direct = customFields["wdu_ifs_productnumber"];
          if (typeof direct === "string" && direct.trim()) return direct.trim();
          for (const [key, value] of Object.entries(customFields)) {
            if (key.toLowerCase() === "wdu_ifs_productnumber" && typeof value === "string" && value.trim()) {
              return value.trim();
            }
          }
          return undefined;
        };

        // Lookup-Map aufbauen: normalisierter Identifier -> { product, matchedBy }
        // Abgleich über Artikelnummer (productNumber + manufacturerNumber) und wdu_ifs_productnumber.
        type CatalogHit = {
          productNumber: string;
          name: string;
          matchedBy: "productNumber" | "manufacturerNumber" | "wdu_ifs_productnumber";
        };
        const lookup = new Map<string, CatalogHit>();
        const addToLookup = (
          value: unknown,
          product: { productNumber: string; name: string },
          matchedBy: CatalogHit["matchedBy"],
        ) => {
          const norm = normalizeIdentifier(value);
          if (!norm) return;
          // Bestehenden Eintrag nicht mit schwächerer Quelle überschreiben
          if (!lookup.has(norm)) {
            lookup.set(norm, { productNumber: product.productNumber, name: product.name, matchedBy });
          }
        };

        for (const product of products) {
          const base = { productNumber: product.productNumber, name: product.name };
          // Höchste Priorität: explizite Artikelnummer-Felder
          addToLookup(product.productNumber, base, "productNumber");
          addToLookup(product.manufacturerNumber, base, "manufacturerNumber");
          addToLookup(getIfsProductNumber(product.customFields), base, "wdu_ifs_productnumber");
        }

        // OBX-Dateien parsen und eindeutige Artikel sammeln (Original-Schreibweise behalten)
        type AggregatedArticle = ObxArticle & { occurrences: number };
        const uniqueByNorm = new Map<string, AggregatedArticle>();
        const fileSummaries: Array<{ fileName: string; articleCount: number; header?: ObxHeader }> = [];

        for (const file of files) {
          const content = file.buffer.toString("utf-8");
          const parsed = parseObxContent(content, file.originalname);
          fileSummaries.push({
            fileName: parsed.fileName,
            articleCount: parsed.articles.length,
            header: parsed.header,
          });
          for (const article of parsed.articles) {
            const norm = normalizeIdentifier(article.artNr);
            if (!norm) continue;
            const existing = uniqueByNorm.get(norm);
            if (existing) {
              existing.occurrences += 1;
              if (!existing.description && article.description) existing.description = article.description;
            } else {
              uniqueByNorm.set(norm, { ...article, occurrences: 1 });
            }
          }
        }

        // Abgleich
        const missing: Array<{ artNr: string; description?: string; occurrences: number }> = [];
        const found: Array<{
          artNr: string;
          description?: string;
          occurrences: number;
          productNumber: string;
          name: string;
          matchedBy: CatalogHit["matchedBy"];
        }> = [];

        for (const [norm, article] of uniqueByNorm) {
          const hit = lookup.get(norm);
          if (hit) {
            found.push({
              artNr: article.artNr,
              description: article.description,
              occurrences: article.occurrences,
              productNumber: hit.productNumber,
              name: hit.name,
              matchedBy: hit.matchedBy,
            });
          } else {
            missing.push({
              artNr: article.artNr,
              description: article.description,
              occurrences: article.occurrences,
            });
          }
        }

        const missingCsv = missing.map((m) => m.artNr).join(",");

        res.json({
          files: fileSummaries,
          totalUniqueArticles: uniqueByNorm.size,
          foundCount: found.length,
          missingCount: missing.length,
          missing,
          found,
          missingCsv,
        });
      } catch (error: any) {
        const msg = error?.message || "OBX-Suche fehlgeschlagen";
        moduleLog.error({ messageText: msg, stack: error?.stack }, "[/api/products/obx-search] Error:");
        res.status(500).json({ error: msg });
      }
    },
  );

  // Bundles routes
  app.get("/api/bundles", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const canManageBundles =
        user?.roleDetails?.permissions?.manageProducts === true ||
        user?.role === "admin";
      const includeInactive = canManageBundles && req.query.includeInactive === "true";
      
      const bundles = await storage.getAllBundles();
      const filtered = includeInactive ? bundles : bundles.filter((bundle) => bundle.active === 1);
      
      const { productCache } = await import("../products/productCache");
      const bundlesWithDetails = filtered.map((bundle) => ({
        ...bundle,
        items: bundle.items.map((item) => {
          const product = productCache.getProductByNumber(item.productNumber);
          return {
            ...item,
            productName: product?.name,
            productId: item.productId || product?.id,
          };
        }),
      }));
      
      res.json({ bundles: bundlesWithDetails });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching bundles:");
      res.status(500).json({ error: error.message || "Failed to fetch bundles" });
    }
  });

  app.post("/api/bundles", requireAuth, requireManageProducts, async (req, res) => {
    try {
      const bundleItemSchema = z.object({
        productNumber: z.string().min(1),
        quantity: z.number().int().min(1),
      });
      const bundleSchema = z.object({
        name: z.string().min(1),
        mockProductNumber: z.string().min(1),
        description: z.string().optional(),
        active: z.boolean().optional(),
        items: z.array(bundleItemSchema).min(1),
      });
      
      const data = bundleSchema.parse(req.body);
      
      const existing = await storage.getBundleByMockNumber(data.mockProductNumber);
      if (existing) {
        return res.status(400).json({ error: "Mock product number already exists" });
      }
      
      const { productCache } = await import("../products/productCache");
      const invalidProducts: string[] = [];
      const itemMap = new Map<string, number>();
      data.items.forEach((item) => {
        const productNumber = item.productNumber.trim();
        const quantity = item.quantity;
        const nextQty = (itemMap.get(productNumber) ?? 0) + quantity;
        itemMap.set(productNumber, nextQty);
      });
      
      const normalizedItems = Array.from(itemMap.entries()).map(([productNumber, quantity], index) => {
        const product = productCache.getProductByNumber(productNumber);
        if (!product) {
          invalidProducts.push(productNumber);
        }
        return {
          productNumber,
          productId: product?.id,
          quantity,
          sortOrder: index,
        };
      });
      
      if (invalidProducts.length > 0) {
        const shopwareSettings = await storage.getShopwareSettings();
        if (shopwareSettings) {
          const shopwareClient = new ShopwareClient(shopwareSettings);
          const fallbackMap = await shopwareClient.fetchProductsByNumbers(invalidProducts);
          invalidProducts.length = 0;
          normalizedItems.forEach((item) => {
            if (!item.productId) {
              const fallback = fallbackMap.get(item.productNumber);
              if (fallback?.id) {
                item.productId = fallback.id;
              } else {
                invalidProducts.push(item.productNumber);
              }
            }
          });
        }
      }
      
      if (invalidProducts.length > 0) {
        return res.status(400).json({
          error: "Some product numbers could not be resolved",
          invalidProducts,
        });
      }
      
      const user = req.user as any;
      const created = await storage.createBundle(
        {
          name: data.name,
          mockProductNumber: data.mockProductNumber,
          description: data.description,
          active: data.active === false ? 0 : 1,
          createdByUserId: user?.id ?? null,
        },
        normalizedItems
      );
      
      res.json(created);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error creating bundle:");
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid bundle data", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to create bundle" });
    }
  });

  app.patch("/api/bundles/:id", requireAuth, requireManageProducts, async (req, res) => {
    try {
      const { id } = req.params;
      const bundleItemSchema = z.object({
        productNumber: z.string().min(1),
        quantity: z.number().int().min(1),
      });
      const updateSchema = z.object({
        name: z.string().min(1).optional(),
        mockProductNumber: z.string().min(1).optional(),
        description: z.string().optional(),
        active: z.boolean().optional(),
        items: z.array(bundleItemSchema).min(1).optional(),
      });
      const data = updateSchema.parse(req.body);
      
      if (data.mockProductNumber) {
        const existing = await storage.getBundleByMockNumber(data.mockProductNumber);
        if (existing && existing.id !== id) {
          return res.status(400).json({ error: "Mock product number already exists" });
        }
      }
      
      let normalizedItems;
      if (data.items) {
        const { productCache } = await import("../products/productCache");
        const invalidProducts: string[] = [];
        const itemMap = new Map<string, number>();
        data.items.forEach((item) => {
          const productNumber = item.productNumber.trim();
          const quantity = item.quantity;
          const nextQty = (itemMap.get(productNumber) ?? 0) + quantity;
          itemMap.set(productNumber, nextQty);
        });
        
        normalizedItems = Array.from(itemMap.entries()).map(([productNumber, quantity], index) => {
          const product = productCache.getProductByNumber(productNumber);
          if (!product) {
            invalidProducts.push(productNumber);
          }
          return {
            productNumber,
            productId: product?.id,
            quantity,
            sortOrder: index,
          };
        });
        
        if (invalidProducts.length > 0) {
          const shopwareSettings = await storage.getShopwareSettings();
          if (shopwareSettings) {
            const shopwareClient = new ShopwareClient(shopwareSettings);
            const fallbackMap = await shopwareClient.fetchProductsByNumbers(invalidProducts);
            invalidProducts.length = 0;
            normalizedItems.forEach((item) => {
              if (!item.productId) {
                const fallback = fallbackMap.get(item.productNumber);
                if (fallback?.id) {
                  item.productId = fallback.id;
                } else {
                  invalidProducts.push(item.productNumber);
                }
              }
            });
          }
        }
        
        if (invalidProducts.length > 0) {
          return res.status(400).json({
            error: "Some product numbers could not be resolved",
            invalidProducts,
          });
        }
      }
      
      const updated = await storage.updateBundle(
        id,
        {
          name: data.name,
          mockProductNumber: data.mockProductNumber,
          description: data.description,
          active: data.active === undefined ? undefined : data.active ? 1 : 0,
        },
        normalizedItems
      );
      
      if (!updated) {
        return res.status(404).json({ error: "Bundle not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error updating bundle:");
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid bundle data", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to update bundle" });
    }
  });

  app.delete("/api/bundles/:id", requireAuth, requireManageProducts, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteBundle(id);
      if (!deleted) {
        return res.status(404).json({ error: "Bundle not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error deleting bundle:");
      res.status(500).json({ error: error.message || "Failed to delete bundle" });
    }
  });

  app.patch("/api/products/:productId/active", requireAuth, requireManageProducts, async (req, res) => {
    let desiredActive: boolean | undefined;
    try {
      const schema = z.object({ active: z.boolean() });
      const { active } = schema.parse(req.body);
      desiredActive = active;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      await client.setProductActive(req.params.productId, active);
      res.json({ success: true, active });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      const errorMessage = typeof error?.message === "string" ? error.message : String(error);
      moduleLog.error({ err: error }, "Error updating product active status:");
      try {
        const settings = await storage.getShopwareSettings();
        if (settings) {
          const client = new ShopwareClient(settings);
          const currentActive = await client.fetchProductActiveStatus(req.params.productId);
          if (currentActive === desiredActive) {
            return res.json({
              success: true,
              active: currentActive,
              warning: "Shopware plugin returned 500 after write.",
            });
          }
        }
      } catch (verifyError) {
        moduleLog.error({ err: verifyError }, "Error verifying product status after failure:");
      }
      if (typeof desiredActive === "boolean") {
        return res.json({
          success: true,
          active: desiredActive,
          warning: "Shopware update returned an error after write.",
          details: errorMessage,
        });
      }
      res.status(500).json({ error: errorMessage || "Failed to update product" });
    }
  });

  app.get("/api/products/:productId/categories", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const result = await client.fetchProductCategoryIds(req.params.productId);
      res.json(result);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching product categories:");
      res.status(500).json({ error: error.message || "Failed to fetch product categories" });
    }
  });

  app.patch("/api/products/:productId/glb", requireAuth, requireManageProducts, async (req, res) => {
    try {
      const { productId } = req.params;
      const schema = z.object({ glbUrl: z.string() });
      const { glbUrl } = schema.parse(req.body);

      const cpqGlbPath = process.env.CPQ_GLB_PATH || path.resolve(process.cwd(), "client", "public", "cpq-models");
      const glbUrlWithoutQuery = glbUrl.split("?")[0].split("#")[0];
      const match = glbUrlWithoutQuery.match(/\/([^/]+\.glb)$/i);
      const filename = match ? match[1] : glbUrlWithoutQuery.split("/").pop() || "model.glb";
      const localPath = path.join(cpqGlbPath, filename);

      if (!fsSync.existsSync(localPath)) {
        return res.status(404).json({ error: `GLB-Datei nicht gefunden: ${filename}` });
      }

      const buffer = await fs.readFile(localPath);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { mediaId } = await client.uploadProductGlbMedia(productId, buffer, filename);
      res.json({ success: true, mediaId });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "glbUrl required" });
      }
      const msg = typeof error?.message === "string" ? error.message : "Failed to save GLB";
      moduleLog.error({ err: error }, "Error saving product GLB:");
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/products/:productId/categories", requireAuth, requireManageProducts, async (req, res) => {
    let desiredCategoryIds: string[] = [];
    try {
      const schema = z.object({ categoryIds: z.array(z.string()) });
      const { categoryIds } = schema.parse(req.body);
      desiredCategoryIds = categoryIds;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      await client.setProductCategories(req.params.productId, categoryIds);
      res.json({ success: true, categoryIds });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      const errorMessage = typeof error?.message === "string" ? error.message : String(error);
      moduleLog.error({ err: error }, "Error updating product categories:");
      try {
        const settings = await storage.getShopwareSettings();
        if (settings) {
          const client = new ShopwareClient(settings);
          const verified = await client.fetchProductCategoryIds(req.params.productId);
          if (verified.categoryIds.sort().join(",") === desiredCategoryIds.sort().join(",")) {
            return res.json({
              success: true,
              categoryIds: verified.categoryIds,
              warning: "Shopware plugin returned 500 after write.",
            });
          }
        }
      } catch (verifyError) {
        moduleLog.error({ err: verifyError }, "Error verifying product categories after failure:");
      }
      if (Array.isArray(desiredCategoryIds)) {
        return res.json({
          success: true,
          categoryIds: desiredCategoryIds,
          warning: "Shopware update returned an error after write.",
          details: errorMessage,
        });
      }
      res.status(500).json({ error: errorMessage || "Failed to update product categories" });
    }
  });

  app.get("/api/products/:productId/sales-channels", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const result = await client.fetchProductSalesChannelIds(req.params.productId);
      const allowedChannelIds = await getSalesChannelFilter(req);
      if (allowedChannelIds !== null) {
        const filteredIds = result.salesChannelIds.filter((id) => allowedChannelIds.includes(id));
        return res.json({ salesChannelIds: filteredIds });
      }
      res.json(result);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching product sales channels:");
      res.status(500).json({ error: error.message || "Failed to fetch product sales channels" });
    }
  });

  app.patch("/api/products/:productId/sales-channels", requireAuth, requireManageProducts, async (req, res) => {
    let desiredSalesChannelIds: string[] = [];
    try {
      const schema = z.object({ salesChannelIds: z.array(z.string()) });
      const { salesChannelIds } = schema.parse(req.body);
      desiredSalesChannelIds = salesChannelIds;

      const allowedChannelIds = await getSalesChannelFilter(req);
      if (allowedChannelIds !== null) {
        if (allowedChannelIds.length === 0) {
          return res.status(403).json({ error: "No sales channel permissions" });
        }
        desiredSalesChannelIds = desiredSalesChannelIds.filter((id) => allowedChannelIds.includes(id));
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      await client.setProductSalesChannels(req.params.productId, desiredSalesChannelIds);
      res.json({ success: true, salesChannelIds: desiredSalesChannelIds });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      const errorMessage = typeof error?.message === "string" ? error.message : String(error);
      moduleLog.error({ err: error }, "Error updating product sales channels:");
      try {
        const settings = await storage.getShopwareSettings();
        if (settings) {
          const client = new ShopwareClient(settings);
          const verified = await client.fetchProductSalesChannelIds(req.params.productId);
          if (verified.salesChannelIds.sort().join(",") === desiredSalesChannelIds.sort().join(",")) {
            return res.json({
              success: true,
              salesChannelIds: verified.salesChannelIds,
              warning: "Shopware plugin returned 500 after write.",
            });
          }
        }
      } catch (verifyError) {
        moduleLog.error({ err: verifyError }, "Error verifying product sales channels after failure:");
      }
      if (Array.isArray(desiredSalesChannelIds)) {
        return res.json({
          success: true,
          salesChannelIds: desiredSalesChannelIds,
          warning: "Shopware update returned an error after write.",
          details: errorMessage,
        });
      }
      res.status(500).json({ error: errorMessage || "Failed to update product sales channels" });
    }
  });

  app.get("/api/products/:productId/data-quality", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const allowedChannelIds = await getSalesChannelFilter(req);
      const salesChannelResult = await client.fetchProductSalesChannelIds(req.params.productId);

      if (allowedChannelIds !== null) {
        const hasAccess = salesChannelResult.salesChannelIds.some((id) => allowedChannelIds.includes(id));
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied: no sales channel permissions" });
        }
      }

      const product = await client.fetchProductDataQuality(req.params.productId);
      const visibilityCount = salesChannelResult.salesChannelIds.length;

      const criteria = [
        { key: "productNumber", ok: Boolean(product.productNumber) },
        { key: "manufacturerNumber", ok: Boolean(product.manufacturerNumber) },
        { key: "ean", ok: Boolean(product.ean) },
        { key: "description", ok: Boolean(product.description) },
        { key: "properties", ok: product.propertyCount >= 2 },
        { key: "deliveryTime", ok: Boolean(product.hasDeliveryTime) },
        { key: "salesChannels", ok: visibilityCount > 0 },
        { key: "categories", ok: product.categoryCount > 0 },
        { key: "images", ok: product.imageCount > 0 },
        { key: "width", ok: Boolean(product.width) },
        { key: "height", ok: Boolean(product.height) },
        { key: "length", ok: Boolean(product.length) },
        { key: "weight", ok: Boolean(product.weight) },
      ];

      const missingFields = criteria.filter((item) => !item.ok).map((item) => item.key);
      const criteriaCount = criteria.length;
      const score = Math.round(((criteriaCount - missingFields.length) / criteriaCount) * 100);

      res.json({
        score,
        criteriaCount,
        missingFields,
        criteria: criteria.map((item) => ({
          key: item.key,
          value: item.ok ? 100 : 0,
        })),
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching product data quality:");
      res.status(500).json({ error: error.message || "Failed to fetch product data quality" });
    }
  });

  // Semantic Product Search route - GPT-4o powered natural language search using cached products
  app.post("/api/products/semantic-search", requireAuth, async (req, res) => {
    try {
      const { query, language, interpretOnly } = req.body;
      
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: "Query is required" });
      }
      if (!takeMinuteSlot(`productAi:${(req as any).tenantId ?? ""}:${(req.user as any)?.id ?? ""}`, PRODUCT_AI_PER_MINUTE)) {
        return res.status(429).json({ error: "Too many AI requests, please wait a minute", code: "rate_limited" });
      }

      const promptOverrides = (await storage.getSetting("ai_prompt_overrides")) || {};
      const promptAddon = promptOverrides.semanticSearchSystemAddon || "";

      // Produktseite ("Mit KI auslegen"): nur die Auslegung - Treffer liefert die normale Produktsuche
      if (interpretOnly === true) {
        const interpretation = await interpretSemanticProductQuery(
          { query, language: language === "en" || language === "es" ? language : "de" },
          { promptAddon, getSetting: (key) => storage.getSetting(key) },
        );
        return res.json({ interpretation });
      }

      moduleLog.info(`[Semantic Search] Query: "${query}", Language: ${language || 'de'}`);

      // Use cached products (all products loaded at startup)
      const { productCache } = await import("../products/productCache");
      const cacheStatus = productCache.getStatus();
      
      if (!cacheStatus.isPopulated) {
        moduleLog.warn("[Semantic Search] Cache not populated, falling back to live API (batch loading all products)");
        
        // Fallback: Fetch ALL products from Shopware API in batches
        const settings = await storage.getShopwareSettings();
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }
        
        const client = new ShopwareClient(settings);
        const allProducts: Product[] = [];
        const BATCH_SIZE = 500;
        let page = 1;
        let hasMore = true;
        
        // Batch-load all products (same logic as cache)
        while (hasMore) {
          const { products } = await client.fetchProducts(BATCH_SIZE, page, undefined, undefined, false);
          allProducts.push(...products);
          moduleLog.info(`[Semantic Search Fallback] Loaded batch ${page}: ${products.length} products (total: ${allProducts.length})`);
          
          // Continue until we get less than BATCH_SIZE products
          hasMore = products.length === BATCH_SIZE;
          page++;
        }
        
        moduleLog.info(`[Semantic Search Fallback] Fetched ${allProducts.length} products from live API (${page - 1} batches)`);
        
        const searchResult = await executeSemanticProductSearch(
          { query, language: language || 'de' },
          allProducts,
          { promptAddon, getSetting: (key) => storage.getSetting(key) }
        );
        
        return res.json(searchResult);
      }
      
      // Use cached products for semantic search
      const cachedProducts = productCache.getProducts();
      moduleLog.info(`[Semantic Search] Using ${cachedProducts.length} cached products`);
      
      // Execute semantic search with GPT-4o
      const searchResult = await executeSemanticProductSearch(
        { query, language: language || 'de' },
        cachedProducts,
        { promptAddon, getSetting: (key) => storage.getSetting(key) }
      );

      res.json(searchResult);
    } catch (error: any) {
      moduleLog.error({ err: error }, "[Semantic Search] Error:");
      res.status(500).json({ error: error.message || "Semantic search failed" });
    }
  });

  // Product Cache Status endpoint - Admin only
  app.get("/api/products/cache-status", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const { productCache } = await import("../products/productCache");
      const status = productCache.getStatus();
      const tenantId = (req as any).tenantId ?? null;
      const mirrorCount = await storage.countShopwareProductMirrors(tenantId);
      const syncState = await storage.getShopwareSyncState("products", tenantId);
      
      res.json({
        isPopulated: status.isPopulated,
        productCount: status.productCount,
        lastUpdate: status.lastUpdate,
        isLoading: status.isLoading,
        error: status.error,
        mirror: {
          productCount: mirrorCount,
          lastFingerprint: syncState?.lastFingerprint ?? null,
          lastDeltaAt: syncState?.lastDeltaAt ?? null,
          lastReconcileAt: syncState?.lastReconcileAt ?? null,
          status: syncState?.status ?? null,
          error: syncState?.error ?? null,
        },
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "[Product Cache] Error fetching cache status:");
      res.status(500).json({ error: error.message || "Failed to fetch cache status" });
    }
  });

  // Product Cache Refresh endpoint - Admin only manual refresh
  app.post("/api/products/refresh-cache", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const { productCache } = await import("../products/productCache");
      const cacheStatus = productCache.getStatus();
      
      if (cacheStatus.isLoading) {
        return res.status(409).json({ error: "Cache refresh already in progress" });
      }
      
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      
      moduleLog.info("[Product Cache] Manual refresh requested");
      const client = new ShopwareClient(settings);
      const tenantId = (req as any).tenantId ?? null;
      const { syncShopwareMirrorForTenant } = await import("../shopware/shopwareMirror");
      await syncShopwareMirrorForTenant(storage, client, tenantId, {
        force: true,
        settings,
        entities: ["products"],
      });
      await productCache.refresh(client);
      
      const updatedStatus = productCache.getStatus();
      res.json({
        success: true,
        message: "Product mirror + cache refreshed successfully",
        status: {
          productCount: updatedStatus.productCount,
          lastUpdate: updatedStatus.lastUpdate
        }
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "[Product Cache] Error refreshing cache:");
      res.status(500).json({ error: error.message || "Failed to refresh cache" });
    }
  });

  // Cross-Selling routes
  app.get("/api/products/:productId/cross-selling", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { productId } = req.params;
      
      moduleLog.info(`Fetching cross-selling for product ${productId}...`);
      const crossSellings = await client.fetchProductCrossSelling(productId);
      
      // Fetch products for each cross-selling group
      moduleLog.info(`Fetching products for ${crossSellings.length} cross-selling groups...`);
      const crossSellingsWithProducts = await Promise.all(
        crossSellings.map(async (cs) => {
          const products = await client.fetchCrossSellingProducts(productId, cs.id);
          return { ...cs, products };
        })
      );
      
      // Set cache headers to prevent 304 responses during debugging
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      res.json({ crossSellings: crossSellingsWithProducts });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-selling:");
      res.status(500).json({ error: error.message || "Failed to fetch cross-selling" });
    }
  });

  app.post("/api/products/:productId/cross-selling", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      // Validate request body
      const createSchema = z.object({
        name: z.string().min(1, "Name is required"),
        productIds: z.array(z.string()).default([]),
      });

      const validation = createSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const client = new ShopwareClient(settings);
      const { productId } = req.params;
      const { productIds } = validation.data;

      const crossSellingId = await client.createProductCrossSelling(
        productId,
        SHOPWARE_CROSS_SELLING_STOREFRONT_NAME,
      );
      
      // Assign products to the group
      if (productIds.length > 0) {
        await client.assignProductsToCrossSelling(crossSellingId, productIds);
      }
      
      res.json({ id: crossSellingId, message: "Cross-selling created successfully" });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error creating cross-selling:");
      res.status(500).json({ error: error.message || "Failed to create cross-selling" });
    }
  });

  app.put("/api/products/:productId/cross-selling/:crossSellingId", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      // Validate request body
      const updateSchema = z.object({
        productIds: z.array(z.string()),
      });

      const validation = updateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const client = new ShopwareClient(settings);
      const { productId, crossSellingId } = req.params;
      const { productIds } = validation.data;
      
      moduleLog.info(`Updating cross-selling ${crossSellingId} for product ${productId}`);
      moduleLog.info(`New product IDs: ${JSON.stringify(productIds)}`);
      
      // Get current products to determine what to add/remove
      const currentProducts = await client.fetchCrossSellingProducts(productId, crossSellingId);
      const currentProductIds = currentProducts.map(p => p.id);
      
      moduleLog.info(`Current product IDs: ${JSON.stringify(currentProductIds)}`);
      
      // Determine which products to add and remove
      const toAdd = productIds.filter(id => !currentProductIds.includes(id));
      const toRemove = currentProductIds.filter(id => !productIds.includes(id));
      
      moduleLog.info(`Products to add: ${JSON.stringify(toAdd)}`);
      moduleLog.info(`Products to remove: ${JSON.stringify(toRemove)}`);
      
      // Update assignments
      if (toRemove.length > 0) {
        await client.removeProductsFromCrossSelling(crossSellingId, toRemove);
      }
      if (toAdd.length > 0) {
        moduleLog.info(`Calling assignProductsToCrossSelling with crossSellingId=${crossSellingId}, productIds=${JSON.stringify(toAdd)}`);
        await client.assignProductsToCrossSelling(crossSellingId, toAdd);
      }
      
      res.json({ message: "Cross-selling updated successfully" });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error updating cross-selling:");
      res.status(500).json({ error: error.message || "Failed to update cross-selling" });
    }
  });

  app.delete("/api/products/:productId/cross-selling/:crossSellingId", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { crossSellingId } = req.params;
      
      await client.deleteProductCrossSelling(crossSellingId);
      
      res.json({ message: "Cross-selling deleted successfully" });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error deleting cross-selling:");
      res.status(500).json({ error: error.message || "Failed to delete cross-selling" });
    }
  });

  // Cross-Selling Suggestions endpoint (rule-based)
  app.get("/api/products/:productId/cross-selling-suggestions", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const { productId } = req.params;
      moduleLog.info(`[Suggestions] Generating cross-selling suggestions for product ${productId}...`);
      
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        moduleLog.info("[Suggestions] Shopware settings not configured");
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);

      const byId = await client.fetchProducts(1, 1, undefined, undefined, false, undefined, undefined, undefined, true, undefined, false, false, productId);
      const sourceProduct = byId.products[0];

      if (!sourceProduct) {
        moduleLog.info(`[Suggestions] Source product ${productId} not found`);
        return res.status(404).json({ error: "Product not found" });
      }
      
      moduleLog.info(`[Suggestions] Source product found: ${sourceProduct.name} (${sourceProduct.productNumber})`);

      // Get all active rules
      const rules = await getCombinedCrossSellingRules(req.tenantId ?? null);
      const activeRules = rules.filter(r => r.active === 1);

      if (activeRules.length === 0) {
        moduleLog.info("[Suggestions] No active rules found, returning empty suggestions");
        return res.json({ suggestions: [] });
      }

      // Apply rules to find suggestions using Shopware search
      const ruleEngine = new RuleEngine();
      const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
      const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "full");
      const suggestions = await ruleEngine.suggestCrossSelling(
        sourceProduct,
        activeRules,
        client,
        suggestOpts,
      );
      
      const limitedSuggestions = dedupeAndLimitSuggestions(suggestions, 10);
      moduleLog.info(`[Suggestions] Generated ${limitedSuggestions.length} suggestion(s) for ${sourceProduct.productNumber}`);

      res.json({
        suggestions: limitedSuggestions.map((s) => ({
          ...s,
          crossSellReason: (s as { crossSellReason?: string }).crossSellReason,
          hybridScore: (s as { hybridScore?: number }).hybridScore,
        })),
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "[Suggestions] Error generating cross-selling suggestions:");
      moduleLog.error({ stack: error.stack }, "[Suggestions] Error stack:");
      res.status(500).json({ error: error.message || "Failed to generate suggestions" });
    }
  });
}
