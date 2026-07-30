/**
 * ERP API-Routen: Warenwirtschaft, Einkauf, Retouren, Fibu, Produktion, Versand.
 */
import type { Express, Request } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs";
import multer from "multer";
import type { User } from "@shared/schema";
import {
  requireAuth,
  requireCsrf,
  requirePermission,
} from "../auth";
import { getTenantIdFromContext } from "../tenantContext";
import { getUploadsRoot } from "../uploadsRoot";
import { erpStorage } from "./erpStorage";
import { isSafeUploadBasename } from "./erpLogic";
import { storage } from "../storage";
import { ShopwareClient } from "../shopware";
import { encrypt } from "../encryption";
import {
  getLabelProvider,
  getSendcloudSettingsDecrypted,
  SENDCLOUD_PROVIDER,
} from "./shipping/getLabelProvider";
import { SENDCLOUD_TEST_METHOD_CODE } from "./shipping/sendcloudProvider";
import { createShippingLabelForTenant, voidShippingLabelForTenant } from "./shipping/labelService";
import { labelAbsolutePath } from "./shipping/labelFiles";
import { handleSendcloudWebhook } from "./shipping/sendcloudWebhook";
import { parseSupplierPriceListFromBuffer } from "./supplierPriceListImport";
import { isOrderEligibleForShippingPick } from "@shared/orderShippingEligibility";

const supplierPriceListUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

const requireViewInventory = requirePermission("viewInventory");
const requireManageInventory = requirePermission("manageInventory");
const requireViewPurchasing = requirePermission("viewPurchasing");
const requireManagePurchasing = requirePermission("managePurchasing");
const requireViewReturns = requirePermission("viewReturns");
const requireManageReturns = requirePermission("manageReturns");
const requireViewAccounting = requirePermission("viewAccounting");
const requireManageAccounting = requirePermission("manageAccounting");
const requireViewProduction = requirePermission("viewProduction");
const requireManageProduction = requirePermission("manageProduction");
const requireManageShippingLabels = requirePermission("manageShippingLabels");

function requireTenant(req: Request): string {
  const tid = getTenantIdFromContext() || (req.user as User | undefined)?.activeTenantId || null;
  if (!tid) {
    const err = new Error("TENANT_REQUIRED");
    (err as any).status = 403;
    throw err;
  }
  return tid;
}

function mapErpError(error: any, res: any, fallback: string) {
  const message = error?.message || fallback;
  if (message === "TENANT_REQUIRED") {
    return res.status(403).json({ error: "Active tenant required" });
  }
  if (message.includes("not found") || message.includes("Not found")) {
    return res.status(404).json({ error: message });
  }
  return res.status(400).json({ error: message });
}

function userId(req: Request): string | null {
  return (req.user as User | undefined)?.id ?? null;
}

function allowAdminOr(permissionMw: ReturnType<typeof requirePermission>) {
  return (req: any, res: any, next: any) => {
    const user = req.user as any;
    const isAdmin =
      user?.roleDetails?.name === "Administrator" || user?.role === "admin";
    if (isAdmin) return next();
    return permissionMw(req, res, next);
  };
}

function userHasPermission(user: any, permission: string): boolean {
  const permissions = user?.roleDetails?.permissions;
  if (!permissions) return false;
  if (Array.isArray(permissions)) return permissions.includes(permission);
  return !!permissions[permission];
}

/** Admin oder mindestens eine der genannten Permissions. */
function allowAdminOrAnyPermission(...permissions: string[]) {
  return (req: any, res: any, next: any) => {
    const user = req.user as any;
    const isAdmin =
      user?.roleDetails?.name === "Administrator" || user?.role === "admin";
    if (isAdmin) return next();
    if (!user) return res.status(401).json({ error: "Unauthorized: Please login" });
    if (permissions.some((p) => userHasPermission(user, p))) return next();
    return res.status(403).json({
      error: `Forbidden: one of [${permissions.join(", ")}] required`,
    });
  };
}

async function writeCreditNoteStub(ret: {
  id: string;
  creditNoteNumber?: string | null;
  creditAmount?: number | null;
  shopwareOrderNumber?: string | null;
  customerEmail?: string | null;
}): Promise<string> {
  if (!isSafeUploadBasename(ret.id)) {
    throw new Error("Invalid return id for credit note path");
  }
  const dir = path.join(getUploadsRoot(), "credit-notes");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${ret.id}.txt`);
  const body = [
    "GUTSCHRIFT / CREDIT NOTE",
    `Nummer: ${ret.creditNoteNumber || "-"}`,
    `Bestellung: ${ret.shopwareOrderNumber || "-"}`,
    `Kunde: ${ret.customerEmail || "-"}`,
    `Betrag: ${(ret.creditAmount || 0).toFixed(2)} EUR`,
    `Erstellt: ${new Date().toISOString()}`,
    "",
    "Stub-Dokument — PDF-Erzeugung kann später durch META-Briefpapier ersetzt werden.",
  ].join("\n");
  fs.writeFileSync(filePath, body, "utf8");
  return filePath;
}

export function registerErpRoutes(app: Express) {
  // ---------- Inventory ----------
  app.get(
    "/api/erp/warehouses",
    requireAuth,
    allowAdminOr(requireViewInventory),
    async (req, res) => {
      try {
        const warehouses = await erpStorage.listWarehouses(requireTenant(req));
        res.json({ warehouses });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list warehouses");
      }
    },
  );

  app.post(
    "/api/erp/warehouses",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({
            code: z.string().min(1),
            name: z.string().min(1),
            address: z.record(z.string()).optional(),
            isDefault: z.boolean().optional(),
            active: z.boolean().optional(),
          })
          .parse(req.body);
        const warehouse = await erpStorage.createWarehouse(body, requireTenant(req));
        res.status(201).json({ warehouse });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create warehouse");
      }
    },
  );

  app.patch(
    "/api/erp/warehouses/:id",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({
            code: z.string().min(1).optional(),
            name: z.string().min(1).optional(),
            address: z.record(z.string()).optional(),
            isDefault: z.boolean().optional(),
            active: z.boolean().optional(),
          })
          .parse(req.body);
        const warehouse = await erpStorage.updateWarehouse(req.params.id, body, requireTenant(req));
        if (!warehouse) return res.status(404).json({ error: "Not found" });
        res.json({ warehouse });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to update warehouse");
      }
    },
  );

  app.get(
    "/api/erp/warehouses/:id/locations",
    requireAuth,
    allowAdminOr(requireViewInventory),
    async (req, res) => {
      try {
        const locations = await erpStorage.listLocations(req.params.id, requireTenant(req));
        res.json({ locations });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list locations");
      }
    },
  );

  const locationBodySchema = z.object({
    code: z.string().min(1).optional(),
    name: z.string().optional().nullable(),
    shelfTypeId: z.string().optional().nullable(),
    regalzeile: z.string().optional().nullable(),
    regalfeld: z.string().optional().nullable(),
    regalfach: z.string().optional().nullable(),
    regalplatz: z.string().optional().nullable(),
    active: z.boolean().optional(),
  });

  app.post(
    "/api/erp/warehouses/:id/locations",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = locationBodySchema.parse(req.body);
        const location = await erpStorage.createLocation(req.params.id, body, requireTenant(req));
        res.status(201).json({ location });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create location");
      }
    },
  );

  app.patch(
    "/api/erp/warehouses/:id/locations/:locationId",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = locationBodySchema.parse(req.body);
        const location = await erpStorage.updateLocation(
          req.params.id,
          req.params.locationId,
          body,
          requireTenant(req),
        );
        if (!location) return res.status(404).json({ error: "Not found" });
        res.json({ location });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to update location");
      }
    },
  );

  // ---------- Shelf types (Regaltypen) ----------
  app.get(
    "/api/erp/shelf-types",
    requireAuth,
    allowAdminOr(requireViewInventory),
    async (req, res) => {
      try {
        const shelfTypes = await erpStorage.listShelfTypes(requireTenant(req));
        res.json({ shelfTypes });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list shelf types");
      }
    },
  );

  app.post(
    "/api/erp/shelf-types",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({
            manufacturer: z.string().optional(),
            code: z.string().min(1),
            name: z.string().min(1),
            description: z.string().optional().nullable(),
            active: z.boolean().optional(),
          })
          .parse(req.body);
        const shelfType = await erpStorage.createShelfType(body, requireTenant(req));
        res.status(201).json({ shelfType });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create shelf type");
      }
    },
  );

  app.patch(
    "/api/erp/shelf-types/:id",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({
            manufacturer: z.string().optional(),
            code: z.string().min(1).optional(),
            name: z.string().min(1).optional(),
            description: z.string().optional().nullable(),
            active: z.boolean().optional(),
          })
          .parse(req.body);
        const shelfType = await erpStorage.updateShelfType(req.params.id, body, requireTenant(req));
        if (!shelfType) return res.status(404).json({ error: "Not found" });
        res.json({ shelfType });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to update shelf type");
      }
    },
  );

  app.get(
    "/api/erp/stock",
    requireAuth,
    allowAdminOr(requireViewInventory),
    async (req, res) => {
      try {
        const stock = await erpStorage.listStockLevels(requireTenant(req), {
          warehouseId: typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined,
          productNumber:
            typeof req.query.productNumber === "string" ? req.query.productNumber : undefined,
          belowReorder: req.query.belowReorder === "true",
        });
        res.json({ stock });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list stock");
      }
    },
  );

  app.post(
    "/api/erp/stock/movements",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({
            warehouseId: z.string().min(1),
            productNumber: z.string().min(1),
            quantity: z.number(),
            movementType: z.enum([
              "receipt",
              "issue",
              "transfer",
              "adjustment",
              "reservation",
              "release",
              "return",
              "production_issue",
              "production_receipt",
            ]),
            locationId: z.string().optional().nullable(),
            note: z.string().optional(),
            minQuantity: z.number().optional(),
            reorderPoint: z.number().optional(),
          })
          .parse(req.body);

        if (body.minQuantity != null || body.reorderPoint != null) {
          await erpStorage.upsertStockLevel(
            {
              warehouseId: body.warehouseId,
              productNumber: body.productNumber,
              locationId: body.locationId,
              minQuantity: body.minQuantity,
              reorderPoint: body.reorderPoint,
            },
            requireTenant(req),
          );
        }

        const result = await erpStorage.recordStockMovement(
          {
            warehouseId: body.warehouseId,
            productNumber: body.productNumber,
            quantity: body.quantity,
            movementType: body.movementType,
            locationId: body.locationId,
            note: body.note,
            createdBy: userId(req) || undefined,
          },
          requireTenant(req),
        );
        res.status(201).json(result);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to record movement");
      }
    },
  );

  app.get(
    "/api/erp/stock/movements",
    requireAuth,
    allowAdminOr(requireViewInventory),
    async (req, res) => {
      try {
        const movements = await erpStorage.listMovements(requireTenant(req), {
          productNumber:
            typeof req.query.productNumber === "string" ? req.query.productNumber : undefined,
          warehouseId: typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined,
          limit: req.query.limit ? Number(req.query.limit) : 100,
        });
        res.json({ movements });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list movements");
      }
    },
  );

  app.get(
    "/api/erp/stock/reconcile",
    requireAuth,
    allowAdminOr(requireViewInventory),
    async (req, res) => {
      try {
        const { buildStockReconcileDiff } = await import("./erpStockReconcile");
        const onlyDiffs = req.query.onlyDiffs !== "false";
        const result = await buildStockReconcileDiff(requireTenant(req), { onlyDiffs });
        res.json(result);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to build stock reconcile diff");
      }
    },
  );

  app.post(
    "/api/erp/stock/reconcile/refresh-mirror",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const { refreshShopwareMirrorForStock, buildStockReconcileDiff } = await import(
          "./erpStockReconcile"
        );
        await refreshShopwareMirrorForStock(requireTenant(req));
        const result = await buildStockReconcileDiff(requireTenant(req), { onlyDiffs: true });
        res.json({ ok: true, ...result });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to refresh Shopware mirror for stock");
      }
    },
  );

  app.post(
    "/api/erp/stock/reconcile/apply",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({
            productNumbers: z.array(z.string()).optional(),
            allDiffs: z.boolean().optional(),
          })
          .parse(req.body || {});
        if (!body.allDiffs && !(body.productNumbers && body.productNumbers.length)) {
          return res.status(400).json({ error: "productNumbers or allDiffs required" });
        }
        const { applyStockReconcileFromShopware } = await import("./erpStockReconcile");
        const result = await applyStockReconcileFromShopware(requireTenant(req), {
          productNumbers: body.productNumbers,
          allDiffs: body.allDiffs === true,
          createdBy: userId(req) || undefined,
        });
        res.json(result);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to apply stock reconcile");
      }
    },
  );

  /** ERP-Bestand (Default-Lager) als absolute Menge nach Shopware schreiben. */
  app.post(
    "/api/erp/stock/reconcile/push-to-shopware",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({
            productNumbers: z.array(z.string()).optional(),
            allDiffs: z.boolean().optional(),
          })
          .parse(req.body || {});
        if (!body.allDiffs && !(body.productNumbers && body.productNumbers.length)) {
          return res.status(400).json({ error: "productNumbers or allDiffs required" });
        }
        const { pushErpStockToShopware } = await import("./erpStockReconcile");
        const result = await pushErpStockToShopware(requireTenant(req), {
          productNumbers: body.productNumbers,
          allDiffs: body.allDiffs === true,
        });
        res.json(result);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to push ERP stock to Shopware");
      }
    },
  );

  /** Mirror + Differenzen ins Hauptlager in einem Schritt (für Bestände-Tab). */
  app.post(
    "/api/erp/stock/import-from-shopware",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({ skipMirrorRefresh: z.boolean().optional() })
          .parse(req.body || {});
        const { importShopwareStockToHauptlager } = await import("./erpStockReconcile");
        const result = await importShopwareStockToHauptlager(requireTenant(req), {
          createdBy: userId(req) || undefined,
          skipMirrorRefresh: body.skipMirrorRefresh === true,
        });
        res.json(result);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to import Shopware stock");
      }
    },
  );

  app.post(
    "/api/erp/stock/sync-shopware-sales",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({ fullScan: z.boolean().optional() })
          .parse(req.body || {});
        const { syncShopwareSalesToErpStock } = await import("./erpShopwareSalesStock");
        const result = await syncShopwareSalesToErpStock(requireTenant(req), {
          fullScan: body.fullScan === true,
          createdBy: userId(req) || undefined,
        });
        res.json(result);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to sync Shopware sales to ERP stock");
      }
    },
  );

  app.get(
    "/api/erp/inventory-counts",
    requireAuth,
    allowAdminOr(requireViewInventory),
    async (req, res) => {
      try {
        const counts = await erpStorage.listInventoryCounts(requireTenant(req));
        res.json({ counts });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list inventory counts");
      }
    },
  );

  app.get(
    "/api/erp/inventory-counts/:id",
    requireAuth,
    allowAdminOr(requireViewInventory),
    async (req, res) => {
      try {
        const tid = requireTenant(req);
        const count = await erpStorage.getInventoryCount(req.params.id, tid);
        if (!count) return res.status(404).json({ error: "Not found" });
        const { resolveErpProductLabels } = await import("./erpProductLabels");
        const productNumbers = count.lines.map((l) => l.productNumber);
        // Mirror zuerst (schnell); Shopware-Fallback nur für Lücken
        const labels = await resolveErpProductLabels(tid, productNumbers, {
          shopwareFallback: true,
        });
        res.json({ count, labels });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to get inventory count");
      }
    },
  );

  app.post(
    "/api/erp/inventory-counts",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({ warehouseId: z.string().min(1), notes: z.string().optional() })
          .parse(req.body);
        const count = await erpStorage.createInventoryCount(
          { ...body, createdBy: userId(req) || undefined },
          requireTenant(req),
        );
        res.status(201).json({ count });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create inventory count");
      }
    },
  );

  app.post(
    "/api/erp/inventory-counts/:id/lines",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({
            productNumber: z.string().min(1),
            expectedQty: z.number().optional(),
            countedQty: z.number().optional(),
          })
          .parse(req.body);
        const tid = requireTenant(req);
        const count = await erpStorage.getInventoryCount(req.params.id, tid);
        if (!count) return res.status(404).json({ error: "Not found" });

        let expectedQty = body.expectedQty;
        if (expectedQty == null) {
          const stock = await erpStorage.findStockLevel(
            tid,
            count.warehouseId,
            body.productNumber.trim(),
          );
          expectedQty = stock?.quantity ?? 0;
        }

        const line = await erpStorage.addInventoryCountLine(
          req.params.id,
          {
            productNumber: body.productNumber,
            expectedQty,
            countedQty: body.countedQty,
          },
          tid,
        );
        res.status(201).json({ line });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to add line");
      }
    },
  );

  app.patch(
    "/api/erp/inventory-counts/:id/lines/:lineId",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({
            countedQty: z.number().nullable().optional(),
            expectedQty: z.number().optional(),
          })
          .parse(req.body);
        const line = await erpStorage.updateInventoryCountLine(
          req.params.id,
          req.params.lineId,
          body,
          requireTenant(req),
        );
        if (!line) return res.status(404).json({ error: "Not found" });
        res.json({ line });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to update line");
      }
    },
  );

  app.post(
    "/api/erp/inventory-counts/:id/seed-from-stock",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const result = await erpStorage.seedInventoryFromStock(req.params.id, requireTenant(req));
        const count = await erpStorage.getInventoryCount(req.params.id, requireTenant(req));
        res.json({ ...result, count });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to seed from stock");
      }
    },
  );

  app.post(
    "/api/erp/inventory-counts/:id/seed-from-shopware",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const body = z
          .object({
            search: z.string().optional(),
            limit: z.number().int().min(1).max(5000).optional(),
            activeOnly: z.boolean().optional(),
          })
          .parse(req.body ?? {});
        const tid = requireTenant(req);
        const count = await erpStorage.getInventoryCount(req.params.id, tid);
        if (!count) return res.status(404).json({ error: "Not found" });

        const { storage } = await import("../storage");
        const limit = body.limit ?? 2000;
        const { rows, total } = await storage.getShopwareProductMirrors(
          {
            search: body.search,
            activeOnly: body.activeOnly === true,
            page: 1,
            limit,
          },
          tid,
        );

        if (rows.length === 0 && total === 0) {
          return res.status(400).json({
            error:
              "Keine Shopware-Produkte im Mirror. Bitte unter Produkte/Einstellungen Sync prüfen oder Produkte einzeln hinzufügen.",
          });
        }

        const stock = await erpStorage.listStockLevels(tid, { warehouseId: count.warehouseId });
        const stockByProduct = new Map(stock.map((s) => [s.productNumber, s.quantity]));

        const lines = rows
          .map((row) => {
            const productNumber = String(row.productNumber || "").trim();
            if (!productNumber) return null;
            const payload = row.payload as { childCount?: number } | null;
            if (payload && Number(payload.childCount ?? 0) > 0) return null;
            return {
              productNumber,
              expectedQty: stockByProduct.get(productNumber) ?? 0,
            };
          })
          .filter((l): l is { productNumber: string; expectedQty: number } => !!l);

        const result = await erpStorage.seedInventoryCountLines(req.params.id, lines, tid);
        const updated = await erpStorage.getInventoryCount(req.params.id, tid);
        res.json({
          ...result,
          mirrorTotal: total,
          importedCandidates: lines.length,
          count: updated,
        });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to seed from Shopware");
      }
    },
  );

  app.post(
    "/api/erp/inventory-counts/:id/complete",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const count = await erpStorage.completeInventoryCount(
          req.params.id,
          requireTenant(req),
          userId(req) || undefined,
        );
        if (!count) return res.status(404).json({ error: "Not found" });
        res.json({ count });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to complete inventory count");
      }
    },
  );

  /** Nach abgeschlossener Inventur: ERP-Bestand der Positionen nach Shopware schreiben. */
  app.post(
    "/api/erp/inventory-counts/:id/push-to-shopware",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const { pushInventoryCountStockToShopware } = await import("./erpStockReconcile");
        const result = await pushInventoryCountStockToShopware(
          requireTenant(req),
          req.params.id,
        );
        res.json(result);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to push inventory stock to Shopware");
      }
    },
  );

  // ---------- Purchasing ----------
  app.get(
    "/api/erp/suppliers",
    requireAuth,
    allowAdminOrAnyPermission("viewPurchasing", "viewProduction", "manageProduction"),
    async (req, res) => {
      try {
        const suppliers = await erpStorage.listSuppliers(requireTenant(req));
        res.json({ suppliers });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list suppliers");
      }
    },
  );

  app.post(
    "/api/erp/suppliers",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManagePurchasing),
    async (req, res) => {
      try {
        const body = z
          .object({
            number: z.string().min(1),
            name: z.string().min(1),
            email: z.string().optional(),
            phone: z.string().optional(),
            address: z.record(z.string()).optional(),
            paymentTerms: z.string().optional(),
            active: z.boolean().optional(),
          })
          .parse(req.body);
        const supplier = await erpStorage.createSupplier(body, requireTenant(req));
        res.status(201).json({ supplier });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create supplier");
      }
    },
  );

  app.patch(
    "/api/erp/suppliers/:id",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManagePurchasing),
    async (req, res) => {
      try {
        const body = z
          .object({
            number: z.string().min(1).optional(),
            name: z.string().min(1).optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
            address: z.record(z.string()).optional(),
            paymentTerms: z.string().optional(),
            active: z.boolean().optional(),
          })
          .parse(req.body);
        const supplier = await erpStorage.updateSupplier(req.params.id, body, requireTenant(req));
        if (!supplier) return res.status(404).json({ error: "Not found" });
        res.json({ supplier });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to update supplier");
      }
    },
  );

  app.get(
    "/api/erp/suppliers/:id/price-list",
    requireAuth,
    allowAdminOrAnyPermission("viewPurchasing", "viewProduction", "manageProduction"),
    async (req, res) => {
      try {
        const priceList = await erpStorage.getActivePriceList(req.params.id, requireTenant(req));
        if (!priceList) return res.status(404).json({ error: "Not found" });
        res.json({ priceList });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to get supplier price list");
      }
    },
  );

  app.get(
    "/api/erp/suppliers/:id/price-list/products",
    requireAuth,
    allowAdminOrAnyPermission("viewPurchasing", "viewProduction", "manageProduction"),
    async (req, res) => {
      try {
        const search = typeof req.query.search === "string" ? req.query.search : undefined;
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
        const products = await erpStorage.searchPriceListProducts(
          req.params.id,
          search,
          limit,
          requireTenant(req),
        );
        res.json({ products });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to search price list products");
      }
    },
  );

  app.get(
    "/api/erp/suppliers/:id/price-list/lookup",
    requireAuth,
    allowAdminOrAnyPermission("viewPurchasing", "viewProduction", "manageProduction"),
    async (req, res) => {
      try {
        const productNumber =
          typeof req.query.productNumber === "string" ? req.query.productNumber : "";
        if (!productNumber.trim()) {
          return res.status(400).json({ error: "productNumber required" });
        }
        const unitPrice = await erpStorage.lookupSupplierPrice(
          req.params.id,
          productNumber,
          requireTenant(req),
        );
        res.json({ unitPrice });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to lookup supplier price");
      }
    },
  );

  app.post(
    "/api/erp/suppliers/:id/price-list/import",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManagePurchasing),
    supplierPriceListUpload.single("file"),
    async (req, res) => {
      try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file?.buffer) {
          return res.status(400).json({ error: "Keine Datei hochgeladen" });
        }
        const apply =
          req.body?.apply === true || req.body?.apply === "true" || req.body?.apply === "1";
        let rows;
        try {
          rows = parseSupplierPriceListFromBuffer(file.buffer);
        } catch (parseError: any) {
          return res.status(400).json({ error: parseError?.message || "Datei konnte nicht gelesen werden" });
        }
        const result = await erpStorage.importSupplierPriceList(
          req.params.id,
          rows,
          {
            apply,
            sourceFilename: file.originalname || undefined,
            createdBy: userId(req) || undefined,
          },
          requireTenant(req),
        );
        res.json(result);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to import supplier price list");
      }
    },
  );

  app.get(
    "/api/erp/purchase-orders",
    requireAuth,
    allowAdminOr(requireViewPurchasing),
    async (req, res) => {
      try {
        const tid = requireTenant(req);
        const purchaseOrders = await erpStorage.listPurchaseOrders(tid);
        const withLines = await Promise.all(
          purchaseOrders.map(
            async (po) => (await erpStorage.getPurchaseOrder(po.id, tid)) || { ...po, lines: [] },
          ),
        );
        res.json({ purchaseOrders: withLines });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list purchase orders");
      }
    },
  );

  app.get(
    "/api/erp/purchase-orders/:id",
    requireAuth,
    allowAdminOr(requireViewPurchasing),
    async (req, res) => {
      try {
        const purchaseOrder = await erpStorage.getPurchaseOrder(req.params.id, requireTenant(req));
        if (!purchaseOrder) return res.status(404).json({ error: "Not found" });
        res.json({ purchaseOrder });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to get purchase order");
      }
    },
  );

  app.post(
    "/api/erp/purchase-orders",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManagePurchasing),
    async (req, res) => {
      try {
        const body = z
          .object({
            supplierId: z.string().min(1),
            warehouseId: z.string().optional(),
            notes: z.string().optional(),
            expectedAt: z.string().datetime().optional(),
            lines: z
              .array(
                z.object({
                  productNumber: z.string().min(1),
                  quantity: z.number().positive(),
                  unitPrice: z.number().optional(),
                  herstellkostenNet: z.number().optional(),
                }),
              )
              .min(1),
          })
          .parse(req.body);
        const purchaseOrder = await erpStorage.createPurchaseOrder(
          {
            ...body,
            expectedAt: body.expectedAt ? new Date(body.expectedAt) : undefined,
            createdBy: userId(req) || undefined,
          },
          requireTenant(req),
        );
        res.status(201).json({ purchaseOrder });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create purchase order");
      }
    },
  );

  app.post(
    "/api/erp/purchase-orders/:id/status",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManagePurchasing),
    async (req, res) => {
      try {
        const body = z
          .object({
            status: z.enum(["draft", "ordered", "partial", "received", "cancelled"]),
          })
          .parse(req.body);
        const purchaseOrder = await erpStorage.updatePurchaseOrderStatus(
          req.params.id,
          body.status,
          requireTenant(req),
        );
        if (!purchaseOrder) return res.status(404).json({ error: "Not found" });
        res.json({ purchaseOrder });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to update status");
      }
    },
  );

  app.post(
    "/api/erp/goods-receipts",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManagePurchasing),
    async (req, res) => {
      try {
        const body = z
          .object({
            purchaseOrderId: z.string().min(1),
            warehouseId: z.string().min(1),
            notes: z.string().optional(),
            lines: z
              .array(
                z.object({
                  purchaseOrderLineId: z.string().optional(),
                  productNumber: z.string().min(1),
                  quantity: z.number().positive(),
                }),
              )
              .min(1),
          })
          .parse(req.body);
        const goodsReceipt = await erpStorage.createGoodsReceipt(
          { ...body, createdBy: userId(req) || undefined },
          requireTenant(req),
        );
        res.status(201).json({ goodsReceipt });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create goods receipt");
      }
    },
  );

  app.get(
    "/api/erp/supplier-invoices",
    requireAuth,
    allowAdminOr(requireViewPurchasing),
    async (req, res) => {
      try {
        const invoices = await erpStorage.listSupplierInvoices(requireTenant(req));
        res.json({ invoices });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list supplier invoices");
      }
    },
  );

  app.post(
    "/api/erp/supplier-invoices",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManagePurchasing),
    async (req, res) => {
      try {
        const body = z
          .object({
            supplierId: z.string().min(1),
            purchaseOrderId: z.string().optional(),
            number: z.string().min(1),
            amountNet: z.number(),
            amountGross: z.number(),
            invoiceDate: z.string().datetime().optional(),
            filePath: z.string().optional(),
          })
          .parse(req.body);
        const invoice = await erpStorage.createSupplierInvoice(
          {
            ...body,
            invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : undefined,
          },
          requireTenant(req),
        );
        res.status(201).json({ invoice });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create supplier invoice");
      }
    },
  );

  app.get(
    "/api/erp/reorder-suggestions",
    requireAuth,
    allowAdminOr(requireViewPurchasing),
    async (req, res) => {
      try {
        const suggestions = await erpStorage.getReorderSuggestions(requireTenant(req));
        res.json({ suggestions });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to get reorder suggestions");
      }
    },
  );

  // ---------- Returns ----------
  app.get(
    "/api/erp/returns",
    requireAuth,
    allowAdminOr(requireViewReturns),
    async (req, res) => {
      try {
        const tid = requireTenant(req);
        const returns = await erpStorage.listReturns(tid);
        const withLines = await Promise.all(
          returns.map(async (r) => (await erpStorage.getReturn(r.id, tid)) || { ...r, lines: [] }),
        );
        res.json({ returns: withLines });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list returns");
      }
    },
  );

  app.get(
    "/api/erp/returns/:id",
    requireAuth,
    allowAdminOr(requireViewReturns),
    async (req, res) => {
      try {
        const ret = await erpStorage.getReturn(req.params.id, requireTenant(req));
        if (!ret) return res.status(404).json({ error: "Not found" });
        res.json({ return: ret });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to get return");
      }
    },
  );

  app.post(
    "/api/erp/returns",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageReturns),
    async (req, res) => {
      try {
        const body = z
          .object({
            shopwareOrderId: z.string().optional(),
            shopwareOrderNumber: z.string().optional(),
            customerEmail: z.string().optional(),
            reason: z.string().optional(),
            warehouseId: z.string().optional(),
            lines: z
              .array(
                z.object({
                  productNumber: z.string().min(1),
                  quantity: z.number().positive(),
                  restock: z.boolean().optional(),
                  unitPrice: z.number().optional(),
                }),
              )
              .min(1),
          })
          .parse(req.body);
        const ret = await erpStorage.createReturn(
          { ...body, createdBy: userId(req) || undefined },
          requireTenant(req),
        );
        res.status(201).json({ return: ret });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create return");
      }
    },
  );

  app.post(
    "/api/erp/returns/:id/status",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageReturns),
    async (req, res) => {
      try {
        const body = z
          .object({
            status: z.enum(["requested", "approved", "received", "refunded", "rejected"]),
            creditAmount: z.number().optional(),
          })
          .parse(req.body);

        let creditPdfPath: string | undefined;
        if (body.status === "refunded") {
          const existing = await erpStorage.getReturn(req.params.id, requireTenant(req));
          if (existing) {
            creditPdfPath = await writeCreditNoteStub({
              id: existing.id,
              creditNoteNumber: existing.creditNoteNumber,
              creditAmount: body.creditAmount,
              shopwareOrderNumber: existing.shopwareOrderNumber,
              customerEmail: existing.customerEmail,
            });
          }
        }

        const ret = await erpStorage.updateReturnStatus(req.params.id, body.status, requireTenant(req), {
          creditAmount: body.creditAmount,
          creditPdfPath,
        });
        if (!ret) return res.status(404).json({ error: "Not found" });
        res.json({ return: ret });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to update return");
      }
    },
  );

  // ---------- Finance ----------
  app.get(
    "/api/erp/open-items",
    requireAuth,
    allowAdminOr(requireViewAccounting),
    async (req, res) => {
      try {
        const openItems = await erpStorage.listOpenItems(requireTenant(req), {
          type: typeof req.query.type === "string" ? req.query.type : undefined,
          status: typeof req.query.status === "string" ? req.query.status : undefined,
        });
        res.json({ openItems });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list open items");
      }
    },
  );

  app.post(
    "/api/erp/open-items",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageAccounting),
    async (req, res) => {
      try {
        const body = z
          .object({
            type: z.enum(["receivable", "payable"]),
            partnerType: z.enum(["customer", "supplier"]),
            partnerId: z.string().optional(),
            partnerName: z.string().optional(),
            documentNumber: z.string().min(1),
            documentDate: z.string().datetime().optional(),
            dueDate: z.string().datetime().optional(),
            amount: z.number(),
            openAmount: z.number().optional(),
            currency: z.string().optional(),
          })
          .parse(req.body);
        const openItem = await erpStorage.createOpenItem(
          {
            ...body,
            openAmount: body.openAmount ?? body.amount,
            documentDate: body.documentDate ? new Date(body.documentDate) : undefined,
            dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          },
          requireTenant(req),
        );
        res.status(201).json({ openItem });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create open item");
      }
    },
  );

  app.post(
    "/api/erp/payments",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageAccounting),
    async (req, res) => {
      try {
        const body = z
          .object({
            openItemId: z.string().min(1),
            amount: z.number().positive(),
            paymentDate: z.string().datetime().optional(),
            method: z.string().optional(),
            reference: z.string().optional(),
          })
          .parse(req.body);
        const result = await erpStorage.recordPayment(
          {
            ...body,
            paymentDate: body.paymentDate ? new Date(body.paymentDate) : undefined,
            createdBy: userId(req) || undefined,
          },
          requireTenant(req),
        );
        res.status(201).json(result);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to record payment");
      }
    },
  );

  app.get(
    "/api/erp/finance/datev-export",
    requireAuth,
    allowAdminOr(requireViewAccounting),
    async (req, res) => {
      try {
        const csv = await erpStorage.exportDatevCsv(requireTenant(req));
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="datev-export.csv"');
        res.send(csv);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to export DATEV");
      }
    },
  );

  app.get(
    "/api/erp/finance/vat-summary",
    requireAuth,
    allowAdminOr(requireViewAccounting),
    async (req, res) => {
      try {
        const summary = await erpStorage.getVatSummary(requireTenant(req));
        res.json({ summary });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to get VAT summary");
      }
    },
  );

  // ---------- BOM master ----------
  app.get(
    "/api/erp/boms",
    requireAuth,
    allowAdminOr(requireViewProduction),
    async (req, res) => {
      try {
        const boms = await erpStorage.listBoms(requireTenant(req));
        res.json({ boms });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list BOMs");
      }
    },
  );

  app.get(
    "/api/erp/boms/by-product/:productNumber",
    requireAuth,
    allowAdminOr(requireViewProduction),
    async (req, res) => {
      try {
        const bom = await erpStorage.getBomByProduct(
          decodeURIComponent(req.params.productNumber),
          requireTenant(req),
        );
        if (!bom) return res.status(404).json({ error: "Not found" });
        res.json({ bom });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to get BOM by product");
      }
    },
  );

  app.get(
    "/api/erp/boms/:id",
    requireAuth,
    allowAdminOr(requireViewProduction),
    async (req, res) => {
      try {
        const bom = await erpStorage.getBom(req.params.id, requireTenant(req));
        if (!bom) return res.status(404).json({ error: "Not found" });
        res.json({ bom });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to get BOM");
      }
    },
  );

  app.post(
    "/api/erp/boms",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageProduction),
    async (req, res) => {
      try {
        const body = z
          .object({
            productNumber: z.string().min(1),
            name: z.string().optional(),
            notes: z.string().optional(),
            active: z.boolean().optional(),
            lines: z
              .array(
                z.object({
                  productNumber: z.string().min(1),
                  quantity: z.number().positive(),
                  notes: z.string().optional().nullable(),
                }),
              )
              .min(1),
          })
          .parse(req.body);
        const bom = await erpStorage.createBom(
          { ...body, createdBy: userId(req) || undefined },
          requireTenant(req),
        );
        res.status(201).json({ bom });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create BOM");
      }
    },
  );

  app.put(
    "/api/erp/boms/:id",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageProduction),
    async (req, res) => {
      try {
        const body = z
          .object({
            name: z.string().optional().nullable(),
            notes: z.string().optional().nullable(),
            active: z.boolean().optional(),
            lines: z
              .array(
                z.object({
                  productNumber: z.string().min(1),
                  quantity: z.number().positive(),
                  notes: z.string().optional().nullable(),
                }),
              )
              .min(1)
              .optional(),
          })
          .parse(req.body);
        const bom = await erpStorage.updateBom(req.params.id, body, requireTenant(req));
        if (!bom) return res.status(404).json({ error: "Not found" });
        res.json({ bom });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to update BOM");
      }
    },
  );

  app.delete(
    "/api/erp/boms/:id",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageProduction),
    async (req, res) => {
      try {
        const ok = await erpStorage.deleteBom(req.params.id, requireTenant(req));
        if (!ok) return res.status(404).json({ error: "Not found" });
        res.json({ ok: true });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to delete BOM");
      }
    },
  );

  // ---------- Production ----------
  app.get(
    "/api/erp/production-orders",
    requireAuth,
    allowAdminOr(requireViewProduction),
    async (req, res) => {
      try {
        const productionOrders = await erpStorage.listProductionOrders(requireTenant(req));
        res.json({ productionOrders });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list production orders");
      }
    },
  );

  app.get(
    "/api/erp/production-orders/:id",
    requireAuth,
    allowAdminOr(requireViewProduction),
    async (req, res) => {
      try {
        const productionOrder = await erpStorage.getProductionOrder(req.params.id, requireTenant(req));
        if (!productionOrder) return res.status(404).json({ error: "Not found" });
        res.json({ productionOrder });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to get production order");
      }
    },
  );

  app.post(
    "/api/erp/production-orders",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageProduction),
    async (req, res) => {
      try {
        const body = z
          .object({
            productNumber: z.string().min(1),
            quantity: z.number().positive(),
            warehouseId: z.string().optional(),
            bom: z
              .array(z.object({ productNumber: z.string().min(1), quantity: z.number().positive() }))
              .optional(),
            plannedStart: z.string().datetime().optional(),
            plannedEnd: z.string().datetime().optional(),
            notes: z.string().optional(),
          })
          .parse(req.body);
        const productionOrder = await erpStorage.createProductionOrder(
          {
            ...body,
            plannedStart: body.plannedStart ? new Date(body.plannedStart) : undefined,
            plannedEnd: body.plannedEnd ? new Date(body.plannedEnd) : undefined,
            createdBy: userId(req) || undefined,
          },
          requireTenant(req),
        );
        res.status(201).json({ productionOrder });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create production order");
      }
    },
  );

  app.post(
    "/api/erp/production-orders/:id/status",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageProduction),
    async (req, res) => {
      try {
        const body = z
          .object({
            status: z.enum(["planned", "released", "in_progress", "completed", "cancelled"]),
          })
          .parse(req.body);
        const productionOrder = await erpStorage.updateProductionStatus(
          req.params.id,
          body.status,
          requireTenant(req),
          userId(req) || undefined,
        );
        if (!productionOrder) return res.status(404).json({ error: "Not found" });
        res.json({ productionOrder });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to update production status");
      }
    },
  );

  app.get(
    "/api/erp/mrp-suggestions",
    requireAuth,
    allowAdminOr(requireViewProduction),
    async (req, res) => {
      try {
        const suggestions = await erpStorage.getMrpSuggestions(requireTenant(req));
        res.json({ suggestions });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to get MRP suggestions");
      }
    },
  );

  // ---------- Sendcloud inbound webhook (no session auth; HMAC via Secret Key) ----------
  app.post("/api/erp/shipping/webhooks/sendcloud/:tenantId", async (req, res) => {
    try {
      const tenantId = String(req.params.tenantId || "").trim();
      if (!tenantId) return res.status(400).json({ error: "tenantId required" });

      const rawBody = (req as any).rawBody as Buffer | undefined;
      if (!rawBody) {
        return res.status(500).json({ error: "Raw body not available" });
      }

      const signature =
        (req.headers["sendcloud-signature"] as string | undefined) ||
        (req.headers["Sendcloud-Signature"] as string | undefined);

      const result = await handleSendcloudWebhook(tenantId, rawBody, signature, req.body);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error || "Webhook rejected" });
      }
      return res.status(200).json({
        ok: true,
        labelId: result.labelId,
        updated: result.updated,
      });
    } catch (error: any) {
      console.error("[SendcloudWebhook]", error?.message || error);
      return res.status(500).json({ error: error?.message || "Webhook failed" });
    }
  });

  // ---------- Shipping provider (Sendcloud) ----------
  app.get(
    "/api/erp/shipping-provider/sendcloud",
    requireAuth,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const tid = requireTenant(req);
        const row = await erpStorage.getShippingProviderSettings(tid, SENDCLOUD_PROVIDER);
        const hasPublic = !!row?.publicKey;
        const hasSecret = !!row?.secretKey;
        const base =
          process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ||
          process.env.METAORDER_BASE_URL?.replace(/\/$/, "") ||
          `${req.protocol}://${req.get("host")}`;
        const webhookUrl = `${base}/api/erp/shipping/webhooks/sendcloud/${tid}`;
        res.json({
          settings: {
            provider: SENDCLOUD_PROVIDER,
            enabled: row?.enabled ?? false,
            sandboxMode: row?.sandboxMode ?? true,
            defaultShippingMethodId: row?.defaultShippingMethodId ?? null,
            defaultShippingMethodCode: row?.defaultShippingMethodCode ?? null,
            senderAddressId: row?.senderAddressId ?? null,
            hasPublicKey: hasPublic,
            hasSecretKey: hasSecret,
            publicKeyMasked: hasPublic ? "••••••••" : "",
            secretKeyMasked: hasSecret ? "••••••••" : "",
            testMethodHint: SENDCLOUD_TEST_METHOD_CODE,
            activeProvider: (await getLabelProvider(tid)).name,
            webhookUrl,
            webhookDocs: "https://sendcloud.dev/api/v3/webhooks/parcel-status-changed",
          },
        });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to load Sendcloud settings");
      }
    },
  );

  app.put(
    "/api/erp/shipping-provider/sendcloud",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const tid = requireTenant(req);
        const body = z
          .object({
            publicKey: z.string().optional(),
            secretKey: z.string().optional(),
            enabled: z.boolean().optional(),
            sandboxMode: z.boolean().optional(),
            defaultShippingMethodId: z.string().nullable().optional(),
            defaultShippingMethodCode: z.string().nullable().optional(),
            senderAddressId: z.string().nullable().optional(),
            clearKeys: z.boolean().optional(),
          })
          .parse(req.body);

        const existing = await erpStorage.getShippingProviderSettings(tid, SENDCLOUD_PROVIDER);
        let publicKey: string | null | undefined = undefined;
        let secretKey: string | null | undefined = undefined;

        if (body.clearKeys) {
          publicKey = null;
          secretKey = null;
        } else {
          if (body.publicKey != null && body.publicKey.trim() && !body.publicKey.includes("•")) {
            publicKey = encrypt(body.publicKey.trim());
          }
          if (body.secretKey != null && body.secretKey.trim() && !body.secretKey.includes("•")) {
            secretKey = encrypt(body.secretKey.trim());
          }
        }

        const saved = await erpStorage.upsertShippingProviderSettings(
          {
            provider: SENDCLOUD_PROVIDER,
            publicKey,
            secretKey,
            enabled: body.enabled,
            sandboxMode: body.sandboxMode,
            defaultShippingMethodId: body.defaultShippingMethodId,
            defaultShippingMethodCode: body.defaultShippingMethodCode,
            senderAddressId: body.senderAddressId,
          },
          tid,
        );

        res.json({
          settings: {
            provider: SENDCLOUD_PROVIDER,
            enabled: saved.enabled,
            sandboxMode: saved.sandboxMode,
            defaultShippingMethodId: saved.defaultShippingMethodId,
            defaultShippingMethodCode: saved.defaultShippingMethodCode,
            senderAddressId: saved.senderAddressId,
            hasPublicKey: !!saved.publicKey || !!existing?.publicKey,
            hasSecretKey: !!saved.secretKey || !!existing?.secretKey,
            activeProvider: (await getLabelProvider(tid)).name,
          },
        });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to save Sendcloud settings");
      }
    },
  );

  app.get(
    "/api/erp/shipping-provider/sendcloud/methods",
    requireAuth,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const tid = requireTenant(req);
        const decrypted = await getSendcloudSettingsDecrypted(tid);
        if (!decrypted?.publicKey || !decrypted?.secretKey) {
          return res.status(400).json({ error: "Sendcloud keys not configured" });
        }
        const provider = await getLabelProvider(tid);
        if (provider.name !== "sendcloud") {
          return res.status(400).json({ error: "Enable Sendcloud and set keys first" });
        }
        const methods = await provider.fetchShippingMethods();
        res.json({ methods });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list shipping methods");
      }
    },
  );

  app.post(
    "/api/erp/shipping-provider/sendcloud/test",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const tid = requireTenant(req);
        const provider = await getLabelProvider(tid);
        const result = await provider.testConnection();
        res.json({ ...result, provider: provider.name });
      } catch (error: any) {
        return mapErpError(error, res, "Sendcloud test failed");
      }
    },
  );

  // ---------- Shipping labels ----------
  app.get(
    "/api/erp/shipping-labels",
    requireAuth,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const labels = await erpStorage.listShippingLabels(requireTenant(req));
        res.json({ labels });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list shipping labels");
      }
    },
  );

  app.post(
    "/api/erp/shipping-labels",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const body = z
          .object({
            shopwareOrderId: z.string().optional(),
            orderNumber: z.string().optional(),
            carrierCode: z.string().optional(),
            packageWeight: z.number().optional(),
            packageCount: z.number().int().positive().optional(),
            recipient: z.record(z.string()).optional(),
            shippingMethodId: z.string().optional(),
            shippingMethodCode: z.string().optional(),
          })
          .parse(req.body);
        const label = await createShippingLabelForTenant(requireTenant(req), {
          ...body,
          createdBy: userId(req) || undefined,
        });
        res.status(201).json({ label });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create shipping label");
      }
    },
  );

  app.get(
    "/api/erp/shipping-labels/:id/pdf",
    requireAuth,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const tid = requireTenant(req);
        const label = await erpStorage.getShippingLabel(req.params.id, tid);
        if (!label) return res.status(404).json({ error: "Not found" });
        if (!label.labelFilePath) return res.status(404).json({ error: "Label PDF not available" });
        const abs = labelAbsolutePath(label.labelFilePath);
        if (!fs.existsSync(abs)) return res.status(404).json({ error: "Label file missing" });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="label-${label.trackingNumber || label.id}.pdf"`,
        );
        fs.createReadStream(abs).pipe(res);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to load label PDF");
      }
    },
  );

  /** Versandlabel-PDF an Zebra Browser Print (PDF Direct) senden. */
  app.post(
    "/api/erp/shipping-labels/:id/print",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const tid = requireTenant(req);
        const label = await erpStorage.getShippingLabel(req.params.id, tid);
        if (!label) return res.status(404).json({ error: "Not found" });
        if (!label.labelFilePath) return res.status(404).json({ error: "Label PDF not available" });
        const abs = labelAbsolutePath(label.labelFilePath);
        if (!fs.existsSync(abs)) return res.status(404).json({ error: "Label file missing" });

        const body = z
          .object({
            device: z
              .object({
                name: z.string(),
                uid: z.string().min(1),
                connection: z.string(),
                deviceType: z.string(),
                version: z.number().optional(),
                provider: z.string().optional(),
                manufacturer: z.string().optional(),
              })
              .optional(),
          })
          .parse(req.body || {});

        const { proxyListPrinters, proxySendPdf } = await import("./zebraBrowserPrint");
        let device = body.device;
        if (!device) {
          const listed = await proxyListPrinters();
          const match = listed.printers.find((p) => p.uid === listed.defaultUid) || listed.printers[0];
          if (!match) {
            return res.status(502).json({
              error: "No Zebra printer found (is Browser Print running?)",
              code: "browser_print_unreachable",
            });
          }
          device = match;
        }

        const pdf = await fs.promises.readFile(abs);
        await proxySendPdf(device, pdf);
        res.json({ ok: true, printerUid: device.uid, printerName: device.name });
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res.status(400).json({ error: "Invalid print payload" });
        }
        if (error?.code && typeof error.status === "number") {
          return res.status(error.status).json({
            error: error.message || "Print failed",
            code: error.code,
          });
        }
        return mapErpError(error, res, "Failed to print shipping label");
      }
    },
  );

  app.post(
    "/api/erp/shipping-labels/:id/void",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const label = await voidShippingLabelForTenant(requireTenant(req), req.params.id);
        if (!label) return res.status(404).json({ error: "Not found" });
        res.json({ label });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to void label");
      }
    },
  );

  app.get(
    "/api/erp/pick-lists",
    requireAuth,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const tid = requireTenant(req);
        const pickLists = await erpStorage.listPickListsWithStock(tid);
        res.json({ pickLists });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to list pick lists");
      }
    },
  );

  app.post(
    "/api/erp/pick-lists",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const body = z
          .object({
            warehouseId: z.string().optional(),
            orderRefs: z
              .array(z.object({ orderId: z.string().optional(), orderNumber: z.string().optional() }))
              .default([]),
            lines: z
              .array(
                z.object({
                  productNumber: z.string().min(1),
                  quantity: z.number().positive(),
                  locationCode: z.string().optional(),
                  orderNumber: z.string().optional(),
                }),
              )
              .min(1),
          })
          .parse(req.body);
        const pickList = await erpStorage.createPickList(
          { ...body, createdBy: userId(req) || undefined },
          requireTenant(req),
        );
        res.status(201).json({ pickList });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create pick list");
      }
    },
  );

  app.post(
    "/api/erp/pick-lists/from-orders",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const body = z
          .object({
            warehouseId: z.string().min(1),
            orderIds: z.array(z.string().min(1)).min(1),
          })
          .parse(req.body);

        const tid = requireTenant(req);
        const settings = await storage.getShopwareSettings(tid);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        const client = new ShopwareClient(settings);
        const uniqueIds = Array.from(new Set(body.orderIds));
        const fetched = await Promise.all(
          uniqueIds.map((id) => client.fetchOrderById(id, null)),
        );

        const orderRefs: Array<{ orderId: string; orderNumber: string }> = [];
        const lines: Array<{
          productNumber: string;
          quantity: number;
          orderNumber: string;
        }> = [];
        const skippedItems: Array<{
          orderId: string;
          orderNumber?: string;
          itemName?: string;
          reason: string;
        }> = [];
        const rejectedOrders: Array<{ orderId: string; reason: string }> = [];

        for (let i = 0; i < uniqueIds.length; i++) {
          const orderId = uniqueIds[i];
          const order = fetched[i];
          if (!order) {
            rejectedOrders.push({ orderId, reason: "not_found" });
            continue;
          }
          if (!isOrderEligibleForShippingPick(order)) {
            const paymentOk =
              order.paymentStatus === "paid" || order.paymentStatus === "authorized";
            rejectedOrders.push({
              orderId,
              reason: !paymentOk ? "payment_not_ready" : "status_not_ready",
            });
            continue;
          }

          orderRefs.push({ orderId: order.id, orderNumber: order.orderNumber });
          for (const item of order.items || []) {
            const productNumber = String(item.productNumber || "").trim();
            if (!productNumber) {
              skippedItems.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                itemName: item.name,
                reason: "missing_product_number",
              });
              continue;
            }
            const quantity = Number(item.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) {
              skippedItems.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                itemName: item.name,
                reason: "invalid_quantity",
              });
              continue;
            }
            lines.push({
              productNumber,
              quantity,
              orderNumber: order.orderNumber,
            });
          }
        }

        if (orderRefs.length === 0) {
          return res.status(400).json({
            error: "No eligible orders for pick list",
            rejectedOrders,
            skippedItems,
          });
        }
        if (lines.length === 0) {
          return res.status(400).json({
            error: "No pickable lines with product numbers",
            rejectedOrders,
            skippedItems,
          });
        }

        const pickList = await erpStorage.createPickList(
          {
            warehouseId: body.warehouseId,
            orderRefs,
            lines,
            createdBy: userId(req) || undefined,
          },
          tid,
        );
        res.status(201).json({ pickList, skippedItems, rejectedOrders });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to create pick list from orders");
      }
    },
  );

  app.post(
    "/api/erp/pick-lists/:id/scan",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const body = z
          .object({
            productNumber: z.string().min(1),
            delta: z.union([z.literal(1), z.literal(-1)]).optional(),
          })
          .parse(req.body);
        const result = await erpStorage.scanPickListProduct(
          req.params.id,
          body.productNumber,
          requireTenant(req),
          body.delta ?? 1,
        );
        res.json(result);
      } catch (error: any) {
        return mapErpError(error, res, "Failed to scan pick list product");
      }
    },
  );

  app.post(
    "/api/erp/pick-lists/:id/complete",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const pickList = await erpStorage.completePickList(
          req.params.id,
          requireTenant(req),
          userId(req) || undefined,
        );
        if (!pickList) return res.status(404).json({ error: "Not found" });
        res.json({ pickList });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to complete pick list");
      }
    },
  );

  app.post(
    "/api/erp/pick-lists/:id/cancel",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageShippingLabels),
    async (req, res) => {
      try {
        const pickList = await erpStorage.cancelPickList(req.params.id, requireTenant(req));
        if (!pickList) return res.status(404).json({ error: "Not found" });
        res.json({ pickList });
      } catch (error: any) {
        return mapErpError(error, res, "Failed to cancel pick list");
      }
    },
  );

  // ---------- Zebra Browser Print (Artikeletiketten) ----------
  // Proxy: Browser → META Order API → host.docker.internal:9100 (Browser Print).
  // Vermeidet CORS / Private Network Access im Client.
  app.get("/api/erp/zebra/printers", requireAuth, async (_req, res) => {
    try {
      const { proxyListPrinters } = await import("./zebraBrowserPrint");
      const result = await proxyListPrinters();
      res.json(result);
    } catch (error: any) {
      if (error?.code && typeof error.status === "number") {
        return res.status(error.status).json({
          error: error.message || "Browser Print unavailable",
          code: error.code,
        });
      }
      return mapErpError(error, res, "Failed to list Zebra printers");
    }
  });

  app.post("/api/erp/zebra/print", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { proxySendZpl } = await import("./zebraBrowserPrint");
      const body = z
        .object({
          device: z.object({
            name: z.string(),
            uid: z.string().min(1),
            connection: z.string(),
            deviceType: z.string(),
            version: z.number().optional(),
            provider: z.string().optional(),
            manufacturer: z.string().optional(),
          }),
          data: z.string().min(1),
        })
        .parse(req.body);
      await proxySendZpl(body.device, body.data);
      res.json({ ok: true });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid print payload" });
      }
      if (error?.code && typeof error.status === "number") {
        return res.status(error.status).json({
          error: error.message || "Print failed",
          code: error.code,
        });
      }
      return mapErpError(error, res, "Failed to print via Browser Print");
    }
  });
}
