/**
 * ERP Storage — Warenwirtschaft, Einkauf, Retouren, Fibu, Produktion, Versand.
 */
import { and, asc, desc, eq, sql, isNull, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  erpWarehouses,
  erpShelfTypes,
  erpWarehouseLocations,
  erpStockLevels,
  erpStockMovements,
  erpInventoryCounts,
  erpInventoryCountLines,
  erpSuppliers,
  erpSupplierPriceLists,
  erpSupplierPriceListLines,
  erpPurchaseOrders,
  erpPurchaseOrderLines,
  erpGoodsReceipts,
  erpGoodsReceiptLines,
  erpSupplierInvoices,
  erpReturns,
  erpReturnLines,
  erpOpenItems,
  erpPayments,
  erpBoms,
  erpBomLines,
  erpProductionOrders,
  erpProductionMaterials,
  erpShippingLabels,
  erpShippingProviderSettings,
  erpPickLists,
  erpPickListLines,
  shopwareProducts,
  type ErpWarehouse,
  type ErpShelfType,
  type ErpWarehouseLocation,
  type ErpStockLevel,
  type ErpStockMovement,
  type ErpInventoryCount,
  type ErpInventoryCountLine,
  type ErpSupplier,
  type ErpSupplierPriceList,
  type ErpSupplierPriceListLine,
  type ErpPurchaseOrder,
  type ErpPurchaseOrderLine,
  type ErpGoodsReceipt,
  type ErpSupplierInvoice,
  type ErpReturn,
  type ErpReturnLine,
  type ErpOpenItem,
  type ErpPayment,
  type ErpBom,
  type ErpBomLine,
  type ErpProductionOrder,
  type ErpProductionMaterial,
  type ErpShippingLabel,
  type ErpShippingProviderSettings,
  type ErpPickList,
  type ErpPickListLine,
  type StockMovementType,
} from "@shared/schema";
import type {
  SupplierPriceListImportResult,
  SupplierPriceListImportRowResult,
  SupplierPriceListRow,
} from "./supplierPriceListImport";
import {
  applyPickedQuantityDelta,
  applyStockMovementBalance,
  assertPaymentWithinOpen,
  aggregateStockForProduct,
  buildDatevRow,
  nextOpenAmount,
  pickStockStatus,
  requireTenantId,
  shouldBookProductionReceipt,
  shouldRestockOnReturnStatus,
} from "./erpLogic";

function tenantEq(col: any, tenantId: string) {
  return eq(col, tenantId);
}

/** Zusammengesetzter Lagerplatz-Code aus Regalzeile-Feld-Fach-Platz (z. B. A-01-02-03). */
export function buildLocationCode(parts: {
  regalzeile?: string | null;
  regalfeld?: string | null;
  regalfach?: string | null;
  regalplatz?: string | null;
  code?: string | null;
}): string {
  const explicit = String(parts.code || "").trim();
  if (explicit) return explicit;
  const segments = [parts.regalzeile, parts.regalfeld, parts.regalfach, parts.regalplatz]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  return segments.join("-");
}

type LocationHierarchyInput = {
  code?: string;
  name?: string | null;
  shelfTypeId?: string | null;
  regalzeile?: string | null;
  regalfeld?: string | null;
  regalfach?: string | null;
  regalplatz?: string | null;
  active?: boolean;
};

async function nextNumber(prefix: string, tenantId?: string | null): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${stamp}-${rand}${tenantId ? `-${tenantId.slice(0, 4)}` : ""}`;
}

export const erpStorage = {
  // ----- Warehouses -----
  async listWarehouses(tenantId?: string | null): Promise<ErpWarehouse[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpWarehouses)
      .where(tenantEq(erpWarehouses.tenantId, tid))
      .orderBy(asc(erpWarehouses.code));
  },

  async getWarehouse(id: string, tenantId?: string | null): Promise<ErpWarehouse | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpWarehouses)
      .where(and(eq(erpWarehouses.id, id), tenantEq(erpWarehouses.tenantId, tid)))
      .limit(1);
    return rows[0];
  },

  async createWarehouse(
    data: {
      code: string;
      name: string;
      address?: Record<string, string>;
      isDefault?: boolean;
      active?: boolean;
    },
    tenantId?: string | null,
  ): Promise<ErpWarehouse> {
    const tid = requireTenantId(tenantId);
    if (data.isDefault) {
      await db
        .update(erpWarehouses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(tenantEq(erpWarehouses.tenantId, tid));
    }
    const [row] = await db
      .insert(erpWarehouses)
      .values({
        ...data,
        tenantId: tid,
        address: data.address || {},
      })
      .returning();
    return row;
  },

  async updateWarehouse(
    id: string,
    data: Partial<{
      code: string;
      name: string;
      address: Record<string, string>;
      isDefault: boolean;
      active: boolean;
    }>,
    tenantId?: string | null,
  ): Promise<ErpWarehouse | undefined> {
    const tid = requireTenantId(tenantId);
    if (data.isDefault) {
      await db
        .update(erpWarehouses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(tenantEq(erpWarehouses.tenantId, tid));
    }
    const [row] = await db
      .update(erpWarehouses)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(erpWarehouses.id, id), tenantEq(erpWarehouses.tenantId, tid)))
      .returning();
    return row;
  },

  async listLocations(warehouseId: string, tenantId?: string | null): Promise<ErpWarehouseLocation[]> {
    const warehouse = await this.getWarehouse(warehouseId, tenantId);
    if (!warehouse) throw new Error("Warehouse not found");
    return db
      .select()
      .from(erpWarehouseLocations)
      .where(eq(erpWarehouseLocations.warehouseId, warehouseId))
      .orderBy(asc(erpWarehouseLocations.code));
  },

  async createLocation(
    warehouseId: string,
    data: LocationHierarchyInput,
    tenantId?: string | null,
  ): Promise<ErpWarehouseLocation> {
    const warehouse = await this.getWarehouse(warehouseId, tenantId);
    if (!warehouse) throw new Error("Warehouse not found");
    const code = buildLocationCode(data);
    if (!code) throw new Error("Location code or hierarchy (Regalzeile) required");
    if (data.shelfTypeId) {
      const shelf = await this.getShelfType(data.shelfTypeId, tenantId);
      if (!shelf) throw new Error("Shelf type not found");
    }
    const [row] = await db
      .insert(erpWarehouseLocations)
      .values({
        warehouseId,
        code,
        name: data.name || null,
        shelfTypeId: data.shelfTypeId || null,
        regalzeile: data.regalzeile?.trim() || null,
        regalfeld: data.regalfeld?.trim() || null,
        regalfach: data.regalfach?.trim() || null,
        regalplatz: data.regalplatz?.trim() || null,
        active: data.active ?? true,
      })
      .returning();
    return row;
  },

  async updateLocation(
    warehouseId: string,
    locationId: string,
    data: LocationHierarchyInput,
    tenantId?: string | null,
  ): Promise<ErpWarehouseLocation | undefined> {
    const warehouse = await this.getWarehouse(warehouseId, tenantId);
    if (!warehouse) throw new Error("Warehouse not found");
    const existing = await db
      .select()
      .from(erpWarehouseLocations)
      .where(
        and(eq(erpWarehouseLocations.id, locationId), eq(erpWarehouseLocations.warehouseId, warehouseId)),
      )
      .limit(1);
    if (!existing[0]) return undefined;

    if (data.shelfTypeId) {
      const shelf = await this.getShelfType(data.shelfTypeId, tenantId);
      if (!shelf) throw new Error("Shelf type not found");
    }

    const nextParts = {
      regalzeile: data.regalzeile !== undefined ? data.regalzeile : existing[0].regalzeile,
      regalfeld: data.regalfeld !== undefined ? data.regalfeld : existing[0].regalfeld,
      regalfach: data.regalfach !== undefined ? data.regalfach : existing[0].regalfach,
      regalplatz: data.regalplatz !== undefined ? data.regalplatz : existing[0].regalplatz,
      code: data.code !== undefined ? data.code : undefined,
    };
    const code =
      data.code !== undefined ||
      data.regalzeile !== undefined ||
      data.regalfeld !== undefined ||
      data.regalfach !== undefined ||
      data.regalplatz !== undefined
        ? buildLocationCode({ ...nextParts, code: data.code ?? null }) || existing[0].code
        : existing[0].code;

    const [row] = await db
      .update(erpWarehouseLocations)
      .set({
        code,
        name: data.name !== undefined ? data.name || null : existing[0].name,
        shelfTypeId: data.shelfTypeId !== undefined ? data.shelfTypeId || null : existing[0].shelfTypeId,
        regalzeile:
          data.regalzeile !== undefined ? data.regalzeile?.trim() || null : existing[0].regalzeile,
        regalfeld: data.regalfeld !== undefined ? data.regalfeld?.trim() || null : existing[0].regalfeld,
        regalfach: data.regalfach !== undefined ? data.regalfach?.trim() || null : existing[0].regalfach,
        regalplatz:
          data.regalplatz !== undefined ? data.regalplatz?.trim() || null : existing[0].regalplatz,
        active: data.active !== undefined ? data.active : existing[0].active,
      })
      .where(
        and(eq(erpWarehouseLocations.id, locationId), eq(erpWarehouseLocations.warehouseId, warehouseId)),
      )
      .returning();
    return row;
  },

  // ----- Shelf types (Regaltypen) -----
  async listShelfTypes(tenantId?: string | null): Promise<ErpShelfType[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpShelfTypes)
      .where(tenantEq(erpShelfTypes.tenantId, tid))
      .orderBy(asc(erpShelfTypes.code));
  },

  async getShelfType(id: string, tenantId?: string | null): Promise<ErpShelfType | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpShelfTypes)
      .where(and(eq(erpShelfTypes.id, id), tenantEq(erpShelfTypes.tenantId, tid)))
      .limit(1);
    return rows[0];
  },

  async createShelfType(
    data: {
      manufacturer?: string;
      code: string;
      name: string;
      description?: string | null;
      active?: boolean;
    },
    tenantId?: string | null,
  ): Promise<ErpShelfType> {
    const tid = requireTenantId(tenantId);
    const [row] = await db
      .insert(erpShelfTypes)
      .values({
        tenantId: tid,
        manufacturer: (data.manufacturer || "META").trim() || "META",
        code: data.code.trim(),
        name: data.name.trim(),
        description: data.description?.trim() || null,
        active: data.active ?? true,
      })
      .returning();
    return row;
  },

  async updateShelfType(
    id: string,
    data: {
      manufacturer?: string;
      code?: string;
      name?: string;
      description?: string | null;
      active?: boolean;
    },
    tenantId?: string | null,
  ): Promise<ErpShelfType | undefined> {
    const tid = requireTenantId(tenantId);
    const patch: Partial<typeof erpShelfTypes.$inferInsert> = { updatedAt: new Date() };
    if (data.manufacturer !== undefined) {
      patch.manufacturer = data.manufacturer.trim() || "META";
    }
    if (data.code !== undefined) patch.code = data.code.trim();
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.description !== undefined) patch.description = data.description?.trim() || null;
    if (data.active !== undefined) patch.active = data.active;
    const [row] = await db
      .update(erpShelfTypes)
      .set(patch)
      .where(and(eq(erpShelfTypes.id, id), tenantEq(erpShelfTypes.tenantId, tid)))
      .returning();
    return row;
  },

  // ----- Stock -----
  async listStockLevels(
    tenantId?: string | null,
    opts?: { warehouseId?: string; productNumber?: string; belowReorder?: boolean },
  ): Promise<ErpStockLevel[]> {
    const tid = requireTenantId(tenantId);
    const conditions = [eq(erpStockLevels.tenantId, tid)];
    if (opts?.warehouseId) conditions.push(eq(erpStockLevels.warehouseId, opts.warehouseId));
    if (opts?.productNumber) conditions.push(eq(erpStockLevels.productNumber, opts.productNumber));
    if (opts?.belowReorder) {
      conditions.push(sql`${erpStockLevels.quantity} - ${erpStockLevels.reservedQuantity} <= ${erpStockLevels.reorderPoint}`);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    return db.select().from(erpStockLevels).where(where).orderBy(asc(erpStockLevels.productNumber));
  },

  async findStockLevel(
    tenantId: string | null | undefined,
    warehouseId: string,
    productNumber: string,
    locationId?: string | null,
  ): Promise<ErpStockLevel | undefined> {
    const tid = requireTenantId(tenantId);
    const conditions = [
      eq(erpStockLevels.warehouseId, warehouseId),
      eq(erpStockLevels.productNumber, productNumber),
      eq(erpStockLevels.tenantId, tid),
    ];
    if (locationId) conditions.push(eq(erpStockLevels.locationId, locationId));
    else conditions.push(isNull(erpStockLevels.locationId));
    const rows = await db.select().from(erpStockLevels).where(and(...conditions)).limit(1);
    return rows[0];
  },

  async upsertStockLevel(
    data: {
      warehouseId: string;
      productNumber: string;
      locationId?: string | null;
      quantity?: number;
      reservedQuantity?: number;
      minQuantity?: number;
      reorderPoint?: number;
    },
    tenantId?: string | null,
  ): Promise<ErpStockLevel> {
    const tid = requireTenantId(tenantId);
    const warehouse = await this.getWarehouse(data.warehouseId, tid);
    if (!warehouse) throw new Error("Warehouse not found");
    const existing = await this.findStockLevel(
      tid,
      data.warehouseId,
      data.productNumber,
      data.locationId,
    );
    if (existing) {
      const [row] = await db
        .update(erpStockLevels)
        .set({
          quantity: data.quantity ?? existing.quantity,
          reservedQuantity: data.reservedQuantity ?? existing.reservedQuantity,
          minQuantity: data.minQuantity ?? existing.minQuantity,
          reorderPoint: data.reorderPoint ?? existing.reorderPoint,
          updatedAt: new Date(),
        })
        .where(eq(erpStockLevels.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(erpStockLevels)
      .values({
        tenantId: tid,
        warehouseId: data.warehouseId,
        locationId: data.locationId || null,
        productNumber: data.productNumber,
        quantity: data.quantity ?? 0,
        reservedQuantity: data.reservedQuantity ?? 0,
        minQuantity: data.minQuantity ?? 0,
        reorderPoint: data.reorderPoint ?? 0,
      })
      .returning();
    return row;
  },

  async recordStockMovement(
    data: {
      warehouseId: string;
      productNumber: string;
      quantity: number;
      movementType: StockMovementType;
      locationId?: string | null;
      referenceType?: string;
      referenceId?: string;
      note?: string;
      createdBy?: string;
      skipBalanceUpdate?: boolean;
    },
    tenantId?: string | null,
  ): Promise<{ movement: ErpStockMovement; stock: ErpStockLevel }> {
    const tid = requireTenantId(tenantId);
    const warehouse = await this.getWarehouse(data.warehouseId, tid);
    if (!warehouse) throw new Error("Warehouse not found");
    const [movement] = await db
      .insert(erpStockMovements)
      .values({
        tenantId: tid,
        warehouseId: data.warehouseId,
        locationId: data.locationId || null,
        productNumber: data.productNumber,
        quantity: data.quantity,
        movementType: data.movementType,
        referenceType: data.referenceType || null,
        referenceId: data.referenceId || null,
        note: data.note || null,
        createdBy: data.createdBy || null,
      })
      .returning();

    let stock = await this.findStockLevel(
      tenantId,
      data.warehouseId,
      data.productNumber,
      data.locationId,
    );
    if (!data.skipBalanceUpdate) {
      const currentQty = stock?.quantity ?? 0;
      const currentReserved = stock?.reservedQuantity ?? 0;
      const { quantity: nextQty, reservedQuantity: nextReserved } = applyStockMovementBalance({
        currentQty,
        currentReserved,
        quantity: data.quantity,
        movementType: data.movementType,
      });

      stock = await this.upsertStockLevel(
        {
          warehouseId: data.warehouseId,
          productNumber: data.productNumber,
          locationId: data.locationId,
          quantity: nextQty,
          reservedQuantity: nextReserved,
          minQuantity: stock?.minQuantity,
          reorderPoint: stock?.reorderPoint,
        },
        tenantId,
      );
    }

    if (!stock) {
      stock = await this.upsertStockLevel(
        {
          warehouseId: data.warehouseId,
          productNumber: data.productNumber,
          locationId: data.locationId,
        },
        tenantId,
      );
    }

    return { movement, stock };
  },

  async findStockMovementByReference(
    tenantId: string | null | undefined,
    referenceType: string,
    referenceId: string,
  ): Promise<ErpStockMovement | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpStockMovements)
      .where(
        and(
          eq(erpStockMovements.tenantId, tid),
          eq(erpStockMovements.referenceType, referenceType),
          eq(erpStockMovements.referenceId, referenceId),
        ),
      )
      .limit(1);
    return rows[0];
  },

  /**
   * Findet issue-Buchungen zu einer Bestellnummer (Shopware-Verkauf oder Pickliste).
   */
  async findIssueForOrderProduct(
    tenantId: string | null | undefined,
    productNumber: string,
    orderNumber: string,
  ): Promise<ErpStockMovement | undefined> {
    const tid = requireTenantId(tenantId);
    const on = String(orderNumber || "").trim();
    const pn = String(productNumber || "").trim();
    if (!on || !pn) return undefined;

    const byShopwareNote = await db
      .select()
      .from(erpStockMovements)
      .where(
        and(
          eq(erpStockMovements.tenantId, tid),
          eq(erpStockMovements.productNumber, pn),
          eq(erpStockMovements.movementType, "issue"),
          eq(erpStockMovements.referenceType, "shopware_order"),
          sql`${erpStockMovements.note} LIKE ${`%#${on}%`}`,
        ),
      )
      .limit(1);
    if (byShopwareNote[0]) return byShopwareNote[0];

    const byPick = await db
      .select()
      .from(erpStockMovements)
      .where(
        and(
          eq(erpStockMovements.tenantId, tid),
          eq(erpStockMovements.productNumber, pn),
          eq(erpStockMovements.movementType, "issue"),
          eq(erpStockMovements.referenceType, "pick_list"),
          sql`${erpStockMovements.note} LIKE ${`%${on}%`}`,
        ),
      )
      .limit(1);
    return byPick[0];
  },

  async listMovements(
    tenantId?: string | null,
    opts?: { productNumber?: string; warehouseId?: string; limit?: number },
  ): Promise<ErpStockMovement[]> {
    const tid = requireTenantId(tenantId);
    const conditions = [eq(erpStockMovements.tenantId, tid)];
    if (opts?.productNumber) conditions.push(eq(erpStockMovements.productNumber, opts.productNumber));
    if (opts?.warehouseId) conditions.push(eq(erpStockMovements.warehouseId, opts.warehouseId));
    return db
      .select()
      .from(erpStockMovements)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(erpStockMovements.createdAt))
      .limit(opts?.limit ?? 100);
  },

  // ----- Inventory counts -----
  async listInventoryCounts(tenantId?: string | null): Promise<ErpInventoryCount[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpInventoryCounts)
      .where(eq(erpInventoryCounts.tenantId, tid))
      .orderBy(desc(erpInventoryCounts.createdAt));
  },

  async createInventoryCount(
    data: { warehouseId: string; notes?: string; createdBy?: string },
    tenantId?: string | null,
  ): Promise<ErpInventoryCount> {
    const tid = requireTenantId(tenantId);
    const warehouse = await this.getWarehouse(data.warehouseId, tid);
    if (!warehouse) throw new Error("Warehouse not found");
    const [row] = await db
      .insert(erpInventoryCounts)
      .values({
        tenantId: tid,
        warehouseId: data.warehouseId,
        notes: data.notes || null,
        createdBy: data.createdBy || null,
        status: "draft",
      })
      .returning();
    return row;
  },

  async getInventoryCount(
    id: string,
    tenantId?: string | null,
  ): Promise<(ErpInventoryCount & { lines: ErpInventoryCountLine[] }) | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpInventoryCounts)
      .where(and(eq(erpInventoryCounts.id, id), eq(erpInventoryCounts.tenantId, tid)))
      .limit(1);
    const count = rows[0];
    if (!count) return undefined;
    const lines = await this.getInventoryCountLines(id);
    return { ...count, lines };
  },

  async addInventoryCountLine(
    inventoryCountId: string,
    data: { productNumber: string; expectedQty: number; countedQty?: number },
    tenantId?: string | null,
  ): Promise<ErpInventoryCountLine> {
    const tid = requireTenantId(tenantId);
    const counts = await db
      .select()
      .from(erpInventoryCounts)
      .where(and(eq(erpInventoryCounts.id, inventoryCountId), eq(erpInventoryCounts.tenantId, tid)))
      .limit(1);
    if (!counts[0]) throw new Error("Inventory count not found");
    if (counts[0].status === "completed") {
      throw new Error("Inventory count already completed");
    }

    const productNumber = data.productNumber.trim();
    if (!productNumber) throw new Error("Product number required");

    const existing = await db
      .select()
      .from(erpInventoryCountLines)
      .where(
        and(
          eq(erpInventoryCountLines.inventoryCountId, inventoryCountId),
          eq(erpInventoryCountLines.productNumber, productNumber),
        ),
      )
      .limit(1);
    if (existing[0]) {
      throw new Error("Product already on inventory count");
    }

    const difference =
      data.countedQty !== undefined && data.countedQty !== null
        ? data.countedQty - data.expectedQty
        : null;
    const [row] = await db
      .insert(erpInventoryCountLines)
      .values({
        inventoryCountId,
        productNumber,
        expectedQty: data.expectedQty,
        countedQty: data.countedQty ?? null,
        difference,
      })
      .returning();
    return row;
  },

  async updateInventoryCountLine(
    inventoryCountId: string,
    lineId: string,
    data: { countedQty?: number | null; expectedQty?: number },
    tenantId?: string | null,
  ): Promise<ErpInventoryCountLine | undefined> {
    const tid = requireTenantId(tenantId);
    const counts = await db
      .select()
      .from(erpInventoryCounts)
      .where(and(eq(erpInventoryCounts.id, inventoryCountId), eq(erpInventoryCounts.tenantId, tid)))
      .limit(1);
    if (!counts[0]) throw new Error("Inventory count not found");
    if (counts[0].status === "completed") {
      throw new Error("Inventory count already completed");
    }

    const lines = await db
      .select()
      .from(erpInventoryCountLines)
      .where(
        and(
          eq(erpInventoryCountLines.id, lineId),
          eq(erpInventoryCountLines.inventoryCountId, inventoryCountId),
        ),
      )
      .limit(1);
    const line = lines[0];
    if (!line) return undefined;

    const expectedQty = data.expectedQty ?? line.expectedQty;
    const countedQty =
      data.countedQty === undefined ? line.countedQty : data.countedQty;
    const difference =
      countedQty !== undefined && countedQty !== null ? countedQty - expectedQty : null;

    const [row] = await db
      .update(erpInventoryCountLines)
      .set({
        expectedQty,
        countedQty,
        difference,
      })
      .where(eq(erpInventoryCountLines.id, lineId))
      .returning();
    return row;
  },

  async seedInventoryCountLines(
    inventoryCountId: string,
    lines: Array<{ productNumber: string; expectedQty: number }>,
    tenantId?: string | null,
  ): Promise<{ added: number; skipped: number }> {
    const tid = requireTenantId(tenantId);
    const count = await this.getInventoryCount(inventoryCountId, tid);
    if (!count) throw new Error("Inventory count not found");
    if (count.status === "completed") {
      throw new Error("Inventory count already completed");
    }

    const existing = new Set(count.lines.map((l) => l.productNumber));
    let added = 0;
    let skipped = 0;
    for (const line of lines) {
      const productNumber = String(line.productNumber || "").trim();
      if (!productNumber) {
        skipped += 1;
        continue;
      }
      if (existing.has(productNumber)) {
        skipped += 1;
        continue;
      }
      await db.insert(erpInventoryCountLines).values({
        inventoryCountId,
        productNumber,
        expectedQty: line.expectedQty ?? 0,
        countedQty: null,
        difference: null,
      });
      existing.add(productNumber);
      added += 1;
    }
    return { added, skipped };
  },

  async seedInventoryFromStock(
    inventoryCountId: string,
    tenantId?: string | null,
  ): Promise<{ added: number; skipped: number }> {
    const tid = requireTenantId(tenantId);
    const count = await this.getInventoryCount(inventoryCountId, tid);
    if (!count) throw new Error("Inventory count not found");
    const stock = await this.listStockLevels(tid, { warehouseId: count.warehouseId });
    return this.seedInventoryCountLines(
      inventoryCountId,
      stock.map((s) => ({ productNumber: s.productNumber, expectedQty: s.quantity })),
      tid,
    );
  },

  async getInventoryCountLines(inventoryCountId: string): Promise<ErpInventoryCountLine[]> {
    return db
      .select()
      .from(erpInventoryCountLines)
      .where(eq(erpInventoryCountLines.inventoryCountId, inventoryCountId))
      .orderBy(asc(erpInventoryCountLines.productNumber));
  },

  async completeInventoryCount(
    id: string,
    tenantId?: string | null,
    createdBy?: string,
  ): Promise<ErpInventoryCount | undefined> {
    const tid = requireTenantId(tenantId);
    const filter = and(eq(erpInventoryCounts.id, id), eq(erpInventoryCounts.tenantId, tid));
    const counts = await db.select().from(erpInventoryCounts).where(filter).limit(1);
    const count = counts[0];
    if (!count) return undefined;
    if (count.status === "completed") {
      throw new Error("Inventory count already completed");
    }

    const lines = await this.getInventoryCountLines(id);
    for (const line of lines) {
      if (line.countedQty == null) continue;
      const diff = line.countedQty - line.expectedQty;
      if (diff === 0) continue;
      await this.recordStockMovement(
        {
          warehouseId: count.warehouseId,
          productNumber: line.productNumber,
          quantity: diff,
          movementType: "adjustment",
          referenceType: "inventory_count",
          referenceId: id,
          note: `Inventur-Differenz`,
          createdBy,
        },
        tenantId,
      );
    }

    const [row] = await db
      .update(erpInventoryCounts)
      .set({ status: "completed", countedAt: new Date(), updatedAt: new Date() })
      .where(eq(erpInventoryCounts.id, id))
      .returning();
    return row;
  },

  // ----- Suppliers / Purchasing -----
  async listSuppliers(tenantId?: string | null): Promise<ErpSupplier[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpSuppliers)
      .where(eq(erpSuppliers.tenantId, tid))
      .orderBy(asc(erpSuppliers.number));
  },

  async getSupplier(id: string, tenantId?: string | null): Promise<ErpSupplier | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpSuppliers)
      .where(and(eq(erpSuppliers.id, id), eq(erpSuppliers.tenantId, tid)))
      .limit(1);
    return rows[0];
  },

  async createSupplier(
    data: {
      number: string;
      name: string;
      email?: string;
      phone?: string;
      address?: Record<string, string>;
      paymentTerms?: string;
      active?: boolean;
    },
    tenantId?: string | null,
  ): Promise<ErpSupplier> {
    const [row] = await db
      .insert(erpSuppliers)
      .values({ ...data, tenantId: requireTenantId(tenantId), address: data.address || {} })
      .returning();
    return row;
  },

  async updateSupplier(
    id: string,
    data: Partial<{
      number: string;
      name: string;
      email: string;
      phone: string;
      address: Record<string, string>;
      paymentTerms: string;
      active: boolean;
    }>,
    tenantId?: string | null,
  ): Promise<ErpSupplier | undefined> {
    const tid = requireTenantId(tenantId);
    const [row] = await db
      .update(erpSuppliers)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(erpSuppliers.id, id), eq(erpSuppliers.tenantId, tid)))
      .returning();
    return row;
  },

  async getActivePriceList(
    supplierId: string,
    tenantId?: string | null,
  ): Promise<(ErpSupplierPriceList & { lines: ErpSupplierPriceListLine[] }) | undefined> {
    const tid = requireTenantId(tenantId);
    const supplier = await this.getSupplier(supplierId, tid);
    if (!supplier) return undefined;
    const rows = await db
      .select()
      .from(erpSupplierPriceLists)
      .where(
        and(
          eq(erpSupplierPriceLists.tenantId, tid),
          eq(erpSupplierPriceLists.supplierId, supplierId),
          eq(erpSupplierPriceLists.active, true),
        ),
      )
      .limit(1);
    const list = rows[0];
    if (!list) return undefined;
    const lines = await db
      .select()
      .from(erpSupplierPriceListLines)
      .where(eq(erpSupplierPriceListLines.priceListId, list.id))
      .orderBy(asc(erpSupplierPriceListLines.sortOrder), asc(erpSupplierPriceListLines.productNumber));
    return { ...list, lines };
  },

  async searchPriceListProducts(
    supplierId: string,
    search: string | undefined,
    limit: number,
    tenantId?: string | null,
  ): Promise<ErpSupplierPriceListLine[]> {
    const list = await this.getActivePriceList(supplierId, tenantId);
    if (!list) return [];
    const q = (search || "").trim();
    if (!q) {
      return list.lines.slice(0, limit);
    }
    const needle = q.toLowerCase();
    return list.lines
      .filter((l) => l.productNumber.toLowerCase().includes(needle))
      .slice(0, limit);
  },

  async lookupSupplierPrice(
    supplierId: string,
    productNumber: string,
    tenantId?: string | null,
  ): Promise<number | null> {
    const list = await this.getActivePriceList(supplierId, tenantId);
    if (!list) return null;
    const pn = productNumber.trim();
    const line = list.lines.find((l) => l.productNumber === pn);
    return line ? line.unitPrice : null;
  },

  async catalogProductNumbersExist(
    productNumbers: string[],
    tenantId?: string | null,
  ): Promise<Set<string>> {
    const tid = requireTenantId(tenantId);
    const unique = [...new Set(productNumbers.map((p) => p.trim()).filter(Boolean))];
    const found = new Set<string>();
    const chunkSize = 200;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const rows = await db
        .select({ productNumber: shopwareProducts.productNumber })
        .from(shopwareProducts)
        .where(
          and(eq(shopwareProducts.tenantId, tid), inArray(shopwareProducts.productNumber, chunk)),
        );
      for (const r of rows) {
        if (r.productNumber) found.add(r.productNumber);
      }
    }
    return found;
  },

  async importSupplierPriceList(
    supplierId: string,
    rows: SupplierPriceListRow[],
    options: {
      apply: boolean;
      sourceFilename?: string;
      name?: string;
      createdBy?: string;
    },
    tenantId?: string | null,
  ): Promise<SupplierPriceListImportResult> {
    const tid = requireTenantId(tenantId);
    const supplier = await this.getSupplier(supplierId, tid);
    if (!supplier) throw new Error("Supplier not found");

    const catalog = await this.catalogProductNumbersExist(
      rows.map((r) => r.productNumber),
      tid,
    );

    const resultRows: SupplierPriceListImportRowResult[] = rows.map((r) => ({
      productNumber: r.productNumber,
      unitPrice: r.unitPrice,
      catalogMatch: catalog.has(r.productNumber) ? "matched" : "unmatched",
      status: options.apply ? "imported" : "would_import",
    }));

    const matched = resultRows.filter((r) => r.catalogMatch === "matched").length;
    const unmatched = resultRows.length - matched;

    if (!options.apply) {
      return {
        mode: "dry-run",
        totalRows: resultRows.length,
        matched,
        unmatched,
        imported: 0,
        errors: 0,
        rows: resultRows,
      };
    }

    const now = new Date();
    const priceListId = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(erpSupplierPriceLists)
        .where(
          and(
            eq(erpSupplierPriceLists.tenantId, tid),
            eq(erpSupplierPriceLists.supplierId, supplierId),
          ),
        )
        .limit(1);

      let listId: string;
      if (existing[0]) {
        const [updated] = await tx
          .update(erpSupplierPriceLists)
          .set({
            name: options.name || options.sourceFilename || existing[0].name,
            sourceFilename: options.sourceFilename || existing[0].sourceFilename,
            importedAt: now,
            active: true,
            updatedAt: now,
            createdBy: options.createdBy || existing[0].createdBy,
          })
          .where(eq(erpSupplierPriceLists.id, existing[0].id))
          .returning();
        listId = updated.id;
        await tx
          .delete(erpSupplierPriceListLines)
          .where(eq(erpSupplierPriceListLines.priceListId, listId));
      } else {
        const [created] = await tx
          .insert(erpSupplierPriceLists)
          .values({
            tenantId: tid,
            supplierId,
            name: options.name || options.sourceFilename || null,
            sourceFilename: options.sourceFilename || null,
            importedAt: now,
            active: true,
            createdBy: options.createdBy || null,
          })
          .returning();
        listId = created.id;
      }

      for (let i = 0; i < rows.length; i++) {
        await tx.insert(erpSupplierPriceListLines).values({
          priceListId: listId,
          productNumber: rows[i].productNumber,
          unitPrice: rows[i].unitPrice,
          sortOrder: i,
        });
      }
      return listId;
    });

    return {
      mode: "apply",
      totalRows: resultRows.length,
      matched,
      unmatched,
      imported: resultRows.length,
      errors: 0,
      rows: resultRows,
      priceListId,
    };
  },

  async listPurchaseOrders(tenantId?: string | null): Promise<ErpPurchaseOrder[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpPurchaseOrders)
      .where(eq(erpPurchaseOrders.tenantId, tid))
      .orderBy(desc(erpPurchaseOrders.createdAt));
  },

  async getPurchaseOrder(
    id: string,
    tenantId?: string | null,
  ): Promise<(ErpPurchaseOrder & { lines: ErpPurchaseOrderLine[] }) | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpPurchaseOrders)
      .where(and(eq(erpPurchaseOrders.id, id), eq(erpPurchaseOrders.tenantId, tid)))
      .limit(1);
    const po = rows[0];
    if (!po) return undefined;
    const lines = await db
      .select()
      .from(erpPurchaseOrderLines)
      .where(eq(erpPurchaseOrderLines.purchaseOrderId, id));
    return { ...po, lines };
  },

  async createPurchaseOrder(
    data: {
      supplierId: string;
      warehouseId?: string;
      notes?: string;
      expectedAt?: Date;
      createdBy?: string;
      lines: Array<{
        productNumber: string;
        quantity: number;
        unitPrice?: number;
        herstellkostenNet?: number;
      }>;
    },
    tenantId?: string | null,
  ): Promise<ErpPurchaseOrder & { lines: ErpPurchaseOrderLine[] }> {
    const tid = requireTenantId(tenantId);
    const number = await nextNumber("PO", tid);
    const [po] = await db
      .insert(erpPurchaseOrders)
      .values({
        tenantId: tid,
        supplierId: data.supplierId,
        number,
        warehouseId: data.warehouseId || null,
        notes: data.notes || null,
        expectedAt: data.expectedAt || null,
        createdBy: data.createdBy || null,
        status: "draft",
      })
      .returning();

    const lines: ErpPurchaseOrderLine[] = [];
    for (const line of data.lines) {
      const [row] = await db
        .insert(erpPurchaseOrderLines)
        .values({
          purchaseOrderId: po.id,
          productNumber: line.productNumber,
          quantity: line.quantity,
          unitPrice: line.unitPrice ?? 0,
          herstellkostenNet: line.herstellkostenNet ?? null,
        })
        .returning();
      lines.push(row);
    }
    return { ...po, lines };
  },

  async updatePurchaseOrderStatus(
    id: string,
    status: string,
    tenantId?: string | null,
  ): Promise<ErpPurchaseOrder | undefined> {
    const tid = requireTenantId(tenantId);
    const patch: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "ordered") patch.orderedAt = new Date();
    const [row] = await db
      .update(erpPurchaseOrders)
      .set(patch)
      .where(and(eq(erpPurchaseOrders.id, id), eq(erpPurchaseOrders.tenantId, tid)))
      .returning();
    return row;
  },

  async createGoodsReceipt(
    data: {
      purchaseOrderId: string;
      warehouseId: string;
      notes?: string;
      createdBy?: string;
      lines: Array<{
        purchaseOrderLineId?: string;
        productNumber: string;
        quantity: number;
      }>;
    },
    tenantId?: string | null,
  ): Promise<ErpGoodsReceipt> {
    const tid = requireTenantId(tenantId);
    const poCheck = await this.getPurchaseOrder(data.purchaseOrderId, tid);
    if (!poCheck) throw new Error("Purchase order not found");
    const whCheck = await this.getWarehouse(data.warehouseId, tid);
    if (!whCheck) throw new Error("Warehouse not found");
    const number = await nextNumber("WE", tid);
    const [gr] = await db
      .insert(erpGoodsReceipts)
      .values({
        tenantId: tid,
        purchaseOrderId: data.purchaseOrderId,
        warehouseId: data.warehouseId,
        number,
        notes: data.notes || null,
        createdBy: data.createdBy || null,
      })
      .returning();

    for (const line of data.lines) {
      await db.insert(erpGoodsReceiptLines).values({
        goodsReceiptId: gr.id,
        purchaseOrderLineId: line.purchaseOrderLineId || null,
        productNumber: line.productNumber,
        quantity: line.quantity,
      });

      await this.recordStockMovement(
        {
          warehouseId: data.warehouseId,
          productNumber: line.productNumber,
          quantity: Math.abs(line.quantity),
          movementType: "receipt",
          referenceType: "goods_receipt",
          referenceId: gr.id,
          note: `Wareneingang ${number}`,
          createdBy: data.createdBy,
        },
        tenantId,
      );

      if (line.purchaseOrderLineId) {
        const poLines = await db
          .select()
          .from(erpPurchaseOrderLines)
          .where(
            and(
              eq(erpPurchaseOrderLines.id, line.purchaseOrderLineId),
              eq(erpPurchaseOrderLines.purchaseOrderId, data.purchaseOrderId),
            ),
          )
          .limit(1);
        const poLine = poLines[0];
        if (poLine) {
          await db
            .update(erpPurchaseOrderLines)
            .set({ receivedQuantity: (poLine.receivedQuantity || 0) + line.quantity })
            .where(eq(erpPurchaseOrderLines.id, poLine.id));
        }
      }
    }

    const po = await this.getPurchaseOrder(data.purchaseOrderId, tenantId);
    if (po) {
      const allReceived = po.lines.every((l) => (l.receivedQuantity || 0) >= l.quantity);
      const anyReceived = po.lines.some((l) => (l.receivedQuantity || 0) > 0);
      await this.updatePurchaseOrderStatus(
        po.id,
        allReceived ? "received" : anyReceived ? "partial" : po.status,
        tenantId,
      );
    }

    return gr;
  },

  async listSupplierInvoices(tenantId?: string | null): Promise<ErpSupplierInvoice[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpSupplierInvoices)
      .where(eq(erpSupplierInvoices.tenantId, tid))
      .orderBy(desc(erpSupplierInvoices.createdAt));
  },

  async createSupplierInvoice(
    data: {
      supplierId: string;
      purchaseOrderId?: string;
      number: string;
      amountNet: number;
      amountGross: number;
      invoiceDate?: Date;
      filePath?: string;
    },
    tenantId?: string | null,
  ): Promise<ErpSupplierInvoice> {
    const tid = requireTenantId(tenantId);
    const supplier = await this.getSupplier(data.supplierId, tid);
    if (!supplier) throw new Error("Supplier not found");
    if (data.purchaseOrderId) {
      const po = await this.getPurchaseOrder(data.purchaseOrderId, tid);
      if (!po) throw new Error("Purchase order not found");
    }
    const [row] = await db
      .insert(erpSupplierInvoices)
      .values({
        tenantId: tid,
        supplierId: data.supplierId,
        purchaseOrderId: data.purchaseOrderId || null,
        number: data.number,
        amountNet: data.amountNet,
        amountGross: data.amountGross,
        invoiceDate: data.invoiceDate || null,
        filePath: data.filePath || null,
        status: "open",
      })
      .returning();

    await this.createOpenItem(
      {
        type: "payable",
        partnerType: "supplier",
        partnerId: data.supplierId,
        documentNumber: data.number,
        documentDate: data.invoiceDate,
        amount: data.amountGross,
        openAmount: data.amountGross,
        referenceType: "supplier_invoice",
        referenceId: row.id,
      },
      tenantId,
    );

    return row;
  },

  async getReorderSuggestions(tenantId?: string | null) {
    return this.listStockLevels(tenantId, { belowReorder: true });
  },

  // ----- Returns -----
  async listReturns(tenantId?: string | null): Promise<ErpReturn[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpReturns)
      .where(eq(erpReturns.tenantId, tid))
      .orderBy(desc(erpReturns.createdAt));
  },

  async getReturn(
    id: string,
    tenantId?: string | null,
  ): Promise<(ErpReturn & { lines: ErpReturnLine[] }) | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpReturns)
      .where(and(eq(erpReturns.id, id), eq(erpReturns.tenantId, tid)))
      .limit(1);
    const ret = rows[0];
    if (!ret) return undefined;
    const lines = await db.select().from(erpReturnLines).where(eq(erpReturnLines.returnId, id));
    return { ...ret, lines };
  },

  async createReturn(
    data: {
      shopwareOrderId?: string;
      shopwareOrderNumber?: string;
      customerEmail?: string;
      reason?: string;
      warehouseId?: string;
      createdBy?: string;
      lines: Array<{
        productNumber: string;
        quantity: number;
        restock?: boolean;
        unitPrice?: number;
      }>;
    },
    tenantId?: string | null,
  ): Promise<ErpReturn & { lines: ErpReturnLine[] }> {
    const tid = requireTenantId(tenantId);
    if (data.warehouseId) {
      const warehouse = await this.getWarehouse(data.warehouseId, tid);
      if (!warehouse) throw new Error("Warehouse not found");
    }
    const [ret] = await db
      .insert(erpReturns)
      .values({
        tenantId: tid,
        shopwareOrderId: data.shopwareOrderId || null,
        shopwareOrderNumber: data.shopwareOrderNumber || null,
        customerEmail: data.customerEmail || null,
        reason: data.reason || null,
        warehouseId: data.warehouseId || null,
        createdBy: data.createdBy || null,
        status: "requested",
      })
      .returning();

    const lines: ErpReturnLine[] = [];
    for (const line of data.lines) {
      const [row] = await db
        .insert(erpReturnLines)
        .values({
          returnId: ret.id,
          productNumber: line.productNumber,
          quantity: line.quantity,
          restock: line.restock ?? true,
          unitPrice: line.unitPrice ?? 0,
        })
        .returning();
      lines.push(row);
    }
    return { ...ret, lines };
  },

  async updateReturnStatus(
    id: string,
    status: string,
    tenantId?: string | null,
    extras?: { creditNoteNumber?: string; creditAmount?: number; creditPdfPath?: string },
  ): Promise<ErpReturn | undefined> {
    const existing = await this.getReturn(id, tenantId);
    if (!existing) return undefined;

    if (shouldRestockOnReturnStatus(existing.status, status) && existing.warehouseId) {
      for (const line of existing.lines) {
        if (!line.restock) continue;
        await this.recordStockMovement(
          {
            warehouseId: existing.warehouseId,
            productNumber: line.productNumber,
            quantity: Math.abs(line.quantity),
            movementType: "return",
            referenceType: "return",
            referenceId: id,
            note: `Retoureneingang ${existing.shopwareOrderNumber || id}`,
          },
          tenantId,
        );
      }
    }

    if (status === "refunded") {
      if (existing.status === "refunded") {
        throw new Error("Return already refunded");
      }
      const creditAmount =
        extras?.creditAmount ??
        existing.lines.reduce((sum, l) => sum + l.quantity * (l.unitPrice || 0), 0);
      const creditNoteNumber = extras?.creditNoteNumber || (await nextNumber("GS", tenantId));
      await this.createOpenItem(
        {
          type: "receivable",
          partnerType: "customer",
          partnerName: existing.customerEmail || undefined,
          documentNumber: creditNoteNumber,
          amount: -Math.abs(creditAmount),
          openAmount: -Math.abs(creditAmount),
          referenceType: "return",
          referenceId: id,
        },
        tenantId,
      );
      const [row] = await db
        .update(erpReturns)
        .set({
          status,
          creditNoteNumber,
          creditAmount: Math.abs(creditAmount),
          creditPdfPath: extras?.creditPdfPath || null,
          updatedAt: new Date(),
        })
        .where(eq(erpReturns.id, id))
        .returning();
      return row;
    }

    const [row] = await db
      .update(erpReturns)
      .set({ status, updatedAt: new Date(), ...extras })
      .where(eq(erpReturns.id, id))
      .returning();
    return row;
  },

  // ----- Fibu -----
  async listOpenItems(
    tenantId?: string | null,
    opts?: { type?: string; status?: string },
  ): Promise<ErpOpenItem[]> {
    const tid = requireTenantId(tenantId);
    const conditions = [eq(erpOpenItems.tenantId, tid)];
    if (opts?.type) conditions.push(eq(erpOpenItems.type, opts.type));
    if (opts?.status) conditions.push(eq(erpOpenItems.status, opts.status));
    return db
      .select()
      .from(erpOpenItems)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(erpOpenItems.createdAt));
  },

  async createOpenItem(
    data: {
      type: string;
      partnerType: string;
      partnerId?: string;
      partnerName?: string;
      documentNumber: string;
      documentDate?: Date;
      dueDate?: Date;
      amount: number;
      openAmount: number;
      currency?: string;
      referenceType?: string;
      referenceId?: string;
    },
    tenantId?: string | null,
  ): Promise<ErpOpenItem> {
    const [row] = await db
      .insert(erpOpenItems)
      .values({
        tenantId: requireTenantId(tenantId),
        type: data.type,
        partnerType: data.partnerType,
        partnerId: data.partnerId || null,
        partnerName: data.partnerName || null,
        documentNumber: data.documentNumber,
        documentDate: data.documentDate || null,
        dueDate: data.dueDate || null,
        amount: data.amount,
        openAmount: data.openAmount,
        currency: data.currency || "EUR",
        referenceType: data.referenceType || null,
        referenceId: data.referenceId || null,
        status: data.openAmount === 0 ? "paid" : "open",
      })
      .returning();
    return row;
  },

  async recordPayment(
    data: {
      openItemId: string;
      amount: number;
      paymentDate?: Date;
      method?: string;
      reference?: string;
      createdBy?: string;
    },
    tenantId?: string | null,
  ): Promise<{ payment: ErpPayment; openItem: ErpOpenItem }> {
    const items = await db
      .select()
      .from(erpOpenItems)
      .where(and(eq(erpOpenItems.id, data.openItemId), eq(erpOpenItems.tenantId, requireTenantId(tenantId))))
      .limit(1);
    const item = items[0];
    if (!item) throw new Error("Open item not found");
    assertPaymentWithinOpen(item.openAmount, data.amount);

    const tid = requireTenantId(tenantId);
    const [payment] = await db
      .insert(erpPayments)
      .values({
        tenantId: tid,
        openItemId: data.openItemId,
        amount: data.amount,
        paymentDate: data.paymentDate || new Date(),
        method: data.method || null,
        reference: data.reference || null,
        createdBy: data.createdBy || null,
      })
      .returning();

    const { openAmount: nextOpen, status } = nextOpenAmount(item.openAmount, data.amount);

    const [openItem] = await db
      .update(erpOpenItems)
      .set({ openAmount: nextOpen, status, updatedAt: new Date() })
      .where(eq(erpOpenItems.id, item.id))
      .returning();

    return { payment, openItem };
  },

  async listPayments(openItemId: string, tenantId?: string | null): Promise<ErpPayment[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpPayments)
      .where(and(eq(erpPayments.openItemId, openItemId), eq(erpPayments.tenantId, tid)))
      .orderBy(desc(erpPayments.paymentDate));
  },

  async exportDatevCsv(tenantId?: string | null): Promise<string> {
    const items = await this.listOpenItems(tenantId);
    const header = "Umsatz;SollHaben;WKZ;Belegdatum;Belegfeld1;Buchungstext;Konto;Gegenkonto;Status";
    const lines = items.map((item) => buildDatevRow(item));
    return [header, ...lines].join("\n");
  },

  async getVatSummary(tenantId?: string | null) {
    const items = await this.listOpenItems(tenantId);
    const receivables = items.filter((i) => i.type === "receivable");
    const payables = items.filter((i) => i.type === "payable");
    const sum = (arr: ErpOpenItem[]) => arr.reduce((s, i) => s + Math.abs(i.amount), 0);
    const openSum = (arr: ErpOpenItem[]) => arr.reduce((s, i) => s + Math.abs(i.openAmount), 0);
    return {
      receivablesTotal: sum(receivables),
      receivablesOpen: openSum(receivables),
      payablesTotal: sum(payables),
      payablesOpen: openSum(payables),
      estimatedVat19: sum(receivables) * (19 / 119),
      currency: "EUR",
    };
  },

  // ----- BOM master -----
  async listBoms(
    tenantId?: string | null,
  ): Promise<Array<ErpBom & { lineCount: number }>> {
    const tid = requireTenantId(tenantId);
    const heads = await db
      .select()
      .from(erpBoms)
      .where(eq(erpBoms.tenantId, tid))
      .orderBy(desc(erpBoms.updatedAt));
    if (heads.length === 0) return [];
    const counts = await db
      .select({
        bomId: erpBomLines.bomId,
        lineCount: sql<number>`count(*)::int`,
      })
      .from(erpBomLines)
      .where(
        inArray(
          erpBomLines.bomId,
          heads.map((h) => h.id),
        ),
      )
      .groupBy(erpBomLines.bomId);
    const countMap = new Map(counts.map((c) => [c.bomId, Number(c.lineCount)]));
    return heads.map((h) => ({ ...h, lineCount: countMap.get(h.id) ?? 0 }));
  },

  async getBom(
    id: string,
    tenantId?: string | null,
  ): Promise<(ErpBom & { lines: ErpBomLine[] }) | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpBoms)
      .where(and(eq(erpBoms.id, id), eq(erpBoms.tenantId, tid)))
      .limit(1);
    const bom = rows[0];
    if (!bom) return undefined;
    const lines = await db
      .select()
      .from(erpBomLines)
      .where(eq(erpBomLines.bomId, id))
      .orderBy(asc(erpBomLines.sortOrder), asc(erpBomLines.productNumber));
    return { ...bom, lines };
  },

  async getBomByProduct(
    productNumber: string,
    tenantId?: string | null,
  ): Promise<(ErpBom & { lines: ErpBomLine[] }) | undefined> {
    const tid = requireTenantId(tenantId);
    const pn = productNumber.trim();
    if (!pn) return undefined;
    const rows = await db
      .select()
      .from(erpBoms)
      .where(
        and(
          eq(erpBoms.tenantId, tid),
          eq(erpBoms.productNumber, pn),
          eq(erpBoms.active, true),
        ),
      )
      .limit(1);
    const bom = rows[0];
    if (!bom) return undefined;
    return this.getBom(bom.id, tid);
  },

  normalizeBomLines(
    finishedProductNumber: string,
    lines: Array<{ productNumber: string; quantity: number; notes?: string | null }>,
  ): Array<{ productNumber: string; quantity: number; notes: string | null; sortOrder: number }> {
    const finished = finishedProductNumber.trim();
    if (!finished) throw new Error("Finished product number required");
    if (!lines.length) throw new Error("BOM requires at least one line");
    const seen = new Set<string>();
    const normalized: Array<{
      productNumber: string;
      quantity: number;
      notes: string | null;
      sortOrder: number;
    }> = [];
    for (let i = 0; i < lines.length; i++) {
      const productNumber = String(lines[i].productNumber || "").trim();
      const quantity = Number(lines[i].quantity);
      if (!productNumber) throw new Error("BOM line product number required");
      if (!(quantity > 0)) throw new Error("BOM line quantity must be positive");
      if (productNumber === finished) {
        throw new Error("BOM material cannot equal finished product");
      }
      if (seen.has(productNumber)) {
        throw new Error(`Duplicate BOM material: ${productNumber}`);
      }
      seen.add(productNumber);
      normalized.push({
        productNumber,
        quantity,
        notes: lines[i].notes?.trim() || null,
        sortOrder: i,
      });
    }
    return normalized;
  },

  async createBom(
    data: {
      productNumber: string;
      name?: string;
      notes?: string;
      active?: boolean;
      lines: Array<{ productNumber: string; quantity: number; notes?: string | null }>;
      createdBy?: string;
    },
    tenantId?: string | null,
  ): Promise<ErpBom & { lines: ErpBomLine[] }> {
    const tid = requireTenantId(tenantId);
    const productNumber = data.productNumber.trim();
    const lines = this.normalizeBomLines(productNumber, data.lines);

    const existing = await db
      .select({ id: erpBoms.id })
      .from(erpBoms)
      .where(and(eq(erpBoms.tenantId, tid), eq(erpBoms.productNumber, productNumber)))
      .limit(1);
    if (existing[0]) {
      throw new Error("BOM already exists for this product");
    }

    return db.transaction(async (tx) => {
      const [bom] = await tx
        .insert(erpBoms)
        .values({
          tenantId: tid,
          productNumber,
          name: data.name?.trim() || null,
          notes: data.notes?.trim() || null,
          active: data.active !== false,
          createdBy: data.createdBy || null,
        })
        .returning();

      const inserted: ErpBomLine[] = [];
      for (const line of lines) {
        const [row] = await tx
          .insert(erpBomLines)
          .values({
            bomId: bom.id,
            productNumber: line.productNumber,
            quantity: line.quantity,
            sortOrder: line.sortOrder,
            notes: line.notes,
          })
          .returning();
        inserted.push(row);
      }
      return { ...bom, lines: inserted };
    });
  },

  async updateBom(
    id: string,
    data: {
      name?: string | null;
      notes?: string | null;
      active?: boolean;
      lines?: Array<{ productNumber: string; quantity: number; notes?: string | null }>;
    },
    tenantId?: string | null,
  ): Promise<(ErpBom & { lines: ErpBomLine[] }) | undefined> {
    const tid = requireTenantId(tenantId);
    const current = await this.getBom(id, tid);
    if (!current) return undefined;

    const lines =
      data.lines !== undefined
        ? this.normalizeBomLines(current.productNumber, data.lines)
        : null;

    await db.transaction(async (tx) => {
      await tx
        .update(erpBoms)
        .set({
          name: data.name !== undefined ? data.name?.trim() || null : current.name,
          notes: data.notes !== undefined ? data.notes?.trim() || null : current.notes,
          active: data.active !== undefined ? data.active : current.active,
          updatedAt: new Date(),
        })
        .where(and(eq(erpBoms.id, id), eq(erpBoms.tenantId, tid)));

      if (lines) {
        await tx.delete(erpBomLines).where(eq(erpBomLines.bomId, id));
        for (const line of lines) {
          await tx.insert(erpBomLines).values({
            bomId: id,
            productNumber: line.productNumber,
            quantity: line.quantity,
            sortOrder: line.sortOrder,
            notes: line.notes,
          });
        }
      }
    });

    return this.getBom(id, tid);
  },

  async deleteBom(id: string, tenantId?: string | null): Promise<boolean> {
    const tid = requireTenantId(tenantId);
    const deleted = await db
      .delete(erpBoms)
      .where(and(eq(erpBoms.id, id), eq(erpBoms.tenantId, tid)))
      .returning({ id: erpBoms.id });
    return deleted.length > 0;
  },

  // ----- Production -----
  async listProductionOrders(tenantId?: string | null): Promise<ErpProductionOrder[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpProductionOrders)
      .where(eq(erpProductionOrders.tenantId, tid))
      .orderBy(desc(erpProductionOrders.createdAt));
  },

  async getProductionOrder(
    id: string,
    tenantId?: string | null,
  ): Promise<(ErpProductionOrder & { materials: ErpProductionMaterial[] }) | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpProductionOrders)
      .where(and(eq(erpProductionOrders.id, id), eq(erpProductionOrders.tenantId, tid)))
      .limit(1);
    const order = rows[0];
    if (!order) return undefined;
    const materials = await db
      .select()
      .from(erpProductionMaterials)
      .where(eq(erpProductionMaterials.productionOrderId, id));
    return { ...order, materials };
  },

  async createProductionOrder(
    data: {
      productNumber: string;
      quantity: number;
      warehouseId?: string;
      bom?: Array<{ productNumber: string; quantity: number }>;
      plannedStart?: Date;
      plannedEnd?: Date;
      notes?: string;
      createdBy?: string;
    },
    tenantId?: string | null,
  ): Promise<ErpProductionOrder & { materials: ErpProductionMaterial[] }> {
    const tid = requireTenantId(tenantId);
    if (data.warehouseId) {
      const warehouse = await this.getWarehouse(data.warehouseId, tid);
      if (!warehouse) throw new Error("Warehouse not found");
    }
    const number = await nextNumber("FA", tid);
    const bom = data.bom || [];
    const [order] = await db
      .insert(erpProductionOrders)
      .values({
        tenantId: tid,
        number,
        productNumber: data.productNumber,
        quantity: data.quantity,
        warehouseId: data.warehouseId || null,
        bom,
        plannedStart: data.plannedStart || null,
        plannedEnd: data.plannedEnd || null,
        notes: data.notes || null,
        createdBy: data.createdBy || null,
        status: "planned",
      })
      .returning();

    const materials: ErpProductionMaterial[] = [];
    for (const m of bom) {
      const [row] = await db
        .insert(erpProductionMaterials)
        .values({
          productionOrderId: order.id,
          productNumber: m.productNumber,
          requiredQty: m.quantity * data.quantity,
        })
        .returning();
      materials.push(row);
    }
    return { ...order, materials };
  },

  async updateProductionStatus(
    id: string,
    status: string,
    tenantId?: string | null,
    createdBy?: string,
  ): Promise<ErpProductionOrder | undefined> {
    const order = await this.getProductionOrder(id, tenantId);
    if (!order) return undefined;

    if (status === "in_progress" && order.warehouseId && order.status === "released") {
      for (const mat of order.materials) {
        const issueQty = mat.requiredQty - (mat.issuedQty || 0);
        if (issueQty <= 0) continue;
        await this.recordStockMovement(
          {
            warehouseId: order.warehouseId,
            productNumber: mat.productNumber,
            quantity: -Math.abs(issueQty),
            movementType: "production_issue",
            referenceType: "production_order",
            referenceId: id,
            createdBy,
          },
          tenantId,
        );
        await db
          .update(erpProductionMaterials)
          .set({ issuedQty: mat.requiredQty })
          .where(eq(erpProductionMaterials.id, mat.id));
      }
    }

    if (shouldBookProductionReceipt(order.status, status) && order.warehouseId) {
      await this.recordStockMovement(
        {
          warehouseId: order.warehouseId,
          productNumber: order.productNumber,
          quantity: Math.abs(order.quantity),
          movementType: "production_receipt",
          referenceType: "production_order",
          referenceId: id,
          createdBy,
        },
        tenantId,
      );
    }

    const [row] = await db
      .update(erpProductionOrders)
      .set({
        status,
        completedAt: status === "completed" ? new Date() : order.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(erpProductionOrders.id, id))
      .returning();
    return row;
  },

  async getMrpSuggestions(tenantId?: string | null) {
    const orders = await this.listProductionOrders(tenantId);
    const planned = orders.filter((o) => ["planned", "released", "in_progress"].includes(o.status));
    const demand = new Map<string, number>();
    for (const order of planned) {
      const full = await this.getProductionOrder(order.id, tenantId);
      if (!full) continue;
      for (const mat of full.materials) {
        const need = mat.requiredQty - (mat.issuedQty || 0);
        if (need > 0) demand.set(mat.productNumber, (demand.get(mat.productNumber) || 0) + need);
      }
    }
    const stock = await this.listStockLevels(tenantId);
    const available = new Map<string, number>();
    for (const s of stock) {
      available.set(
        s.productNumber,
        (available.get(s.productNumber) || 0) + (s.quantity - s.reservedQuantity),
      );
    }
    return Array.from(demand.entries()).map(([productNumber, required]) => ({
      productNumber,
      required,
      available: available.get(productNumber) || 0,
      shortfall: Math.max(0, required - (available.get(productNumber) || 0)),
    }));
  },

  // ----- Shipping provider settings -----
  async getShippingProviderSettings(
    tenantId: string,
    provider: string,
  ): Promise<ErpShippingProviderSettings | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpShippingProviderSettings)
      .where(
        and(
          eq(erpShippingProviderSettings.tenantId, tid),
          eq(erpShippingProviderSettings.provider, provider),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async upsertShippingProviderSettings(
    data: {
      provider: string;
      publicKey?: string | null;
      secretKey?: string | null;
      enabled?: boolean;
      sandboxMode?: boolean;
      defaultShippingMethodId?: string | null;
      defaultShippingMethodCode?: string | null;
      senderAddressId?: string | null;
      rawConfig?: Record<string, unknown>;
    },
    tenantId?: string | null,
  ): Promise<ErpShippingProviderSettings> {
    const tid = requireTenantId(tenantId);
    const existing = await this.getShippingProviderSettings(tid, data.provider);
    if (existing) {
      const [row] = await db
        .update(erpShippingProviderSettings)
        .set({
          publicKey: data.publicKey !== undefined ? data.publicKey : existing.publicKey,
          secretKey: data.secretKey !== undefined ? data.secretKey : existing.secretKey,
          enabled: data.enabled ?? existing.enabled,
          sandboxMode: data.sandboxMode ?? existing.sandboxMode,
          defaultShippingMethodId:
            data.defaultShippingMethodId !== undefined
              ? data.defaultShippingMethodId
              : existing.defaultShippingMethodId,
          defaultShippingMethodCode:
            data.defaultShippingMethodCode !== undefined
              ? data.defaultShippingMethodCode
              : existing.defaultShippingMethodCode,
          senderAddressId:
            data.senderAddressId !== undefined ? data.senderAddressId : existing.senderAddressId,
          rawConfig: data.rawConfig ?? existing.rawConfig,
          updatedAt: new Date(),
        })
        .where(eq(erpShippingProviderSettings.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(erpShippingProviderSettings)
      .values({
        tenantId: tid,
        provider: data.provider,
        publicKey: data.publicKey ?? null,
        secretKey: data.secretKey ?? null,
        enabled: data.enabled ?? false,
        sandboxMode: data.sandboxMode ?? true,
        defaultShippingMethodId: data.defaultShippingMethodId ?? null,
        defaultShippingMethodCode: data.defaultShippingMethodCode ?? null,
        senderAddressId: data.senderAddressId ?? null,
        rawConfig: data.rawConfig ?? {},
      })
      .returning();
    return row;
  },

  // ----- Shipping labels / pick lists -----
  async listShippingLabels(tenantId?: string | null): Promise<ErpShippingLabel[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpShippingLabels)
      .where(eq(erpShippingLabels.tenantId, tid))
      .orderBy(desc(erpShippingLabels.createdAt));
  },

  async getShippingLabel(
    id: string,
    tenantId?: string | null,
  ): Promise<ErpShippingLabel | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpShippingLabels)
      .where(and(eq(erpShippingLabels.id, id), eq(erpShippingLabels.tenantId, tid)))
      .limit(1);
    return rows[0];
  },

  async findShippingLabelByExternalParcelId(
    tenantId: string,
    externalParcelId: string,
  ): Promise<ErpShippingLabel | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpShippingLabels)
      .where(
        and(
          eq(erpShippingLabels.tenantId, tid),
          eq(erpShippingLabels.externalParcelId, externalParcelId),
        ),
      )
      .orderBy(desc(erpShippingLabels.createdAt))
      .limit(1);
    return rows[0];
  },

  async findShippingLabelByTracking(
    tenantId: string,
    trackingNumber: string,
  ): Promise<ErpShippingLabel | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpShippingLabels)
      .where(
        and(eq(erpShippingLabels.tenantId, tid), eq(erpShippingLabels.trackingNumber, trackingNumber)),
      )
      .orderBy(desc(erpShippingLabels.createdAt))
      .limit(1);
    return rows[0];
  },

  async findShippingLabelByOrderNumber(
    tenantId: string,
    orderNumber: string,
  ): Promise<ErpShippingLabel | undefined> {
    const tid = requireTenantId(tenantId);
    const rows = await db
      .select()
      .from(erpShippingLabels)
      .where(and(eq(erpShippingLabels.tenantId, tid), eq(erpShippingLabels.orderNumber, orderNumber)))
      .orderBy(desc(erpShippingLabels.createdAt))
      .limit(1);
    return rows[0];
  },

  async createShippingLabel(
    data: {
      shopwareOrderId?: string;
      orderNumber?: string;
      carrierCode: string;
      packageWeight?: number;
      packageCount?: number;
      recipient?: Record<string, string>;
      trackingNumber?: string;
      labelUrl?: string;
      labelStatus?: string;
      provider?: string;
      externalParcelId?: string;
      labelFilePath?: string;
      shippingMethodCode?: string;
      rawResponse?: Record<string, unknown>;
      createdBy?: string;
    },
    tenantId?: string | null,
  ): Promise<ErpShippingLabel> {
    const [row] = await db
      .insert(erpShippingLabels)
      .values({
        tenantId: requireTenantId(tenantId),
        shopwareOrderId: data.shopwareOrderId || null,
        orderNumber: data.orderNumber || null,
        carrierCode: data.carrierCode,
        trackingNumber: data.trackingNumber || null,
        labelUrl: data.labelUrl || null,
        labelStatus: data.labelStatus || "created",
        packageWeight: data.packageWeight ?? null,
        packageCount: data.packageCount ?? 1,
        recipient: data.recipient || {},
        rawResponse: data.rawResponse || null,
        provider: data.provider || null,
        externalParcelId: data.externalParcelId || null,
        labelFilePath: data.labelFilePath || null,
        shippingMethodCode: data.shippingMethodCode || null,
        createdBy: data.createdBy || null,
      })
      .returning();
    return row;
  },

  async updateShippingLabel(
    id: string,
    patch: Partial<{
      trackingNumber: string | null;
      labelUrl: string | null;
      labelStatus: string;
      labelFilePath: string | null;
      externalParcelId: string | null;
      rawResponse: Record<string, unknown> | null;
      carrierStatus: string | null;
      carrierStatusMessage: string | null;
      carrierStatusId: number | null;
      lastWebhookAt: Date | null;
      lastWebhookPayload: Record<string, unknown> | null;
    }>,
    tenantId?: string | null,
  ): Promise<ErpShippingLabel | undefined> {
    const tid = requireTenantId(tenantId);
    const [row] = await db
      .update(erpShippingLabels)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(erpShippingLabels.id, id), eq(erpShippingLabels.tenantId, tid)))
      .returning();
    return row;
  },

  async voidShippingLabel(
    id: string,
    tenantId?: string | null,
  ): Promise<ErpShippingLabel | undefined> {
    const tid = requireTenantId(tenantId);
    const [row] = await db
      .update(erpShippingLabels)
      .set({ labelStatus: "void", updatedAt: new Date() })
      .where(and(eq(erpShippingLabels.id, id), eq(erpShippingLabels.tenantId, tid)))
      .returning();
    return row;
  },

  async listPickLists(tenantId?: string | null): Promise<ErpPickList[]> {
    const tid = requireTenantId(tenantId);
    return db
      .select()
      .from(erpPickLists)
      .where(eq(erpPickLists.tenantId, tid))
      .orderBy(desc(erpPickLists.createdAt));
  },

  /**
   * Picklisten inkl. Zeilen und Lagerhinweis (verfügbar im Picklisten-Lager).
   * Kein separates viewInventory nötig — für Versand/Mobile Picking.
   */
  async listPickListsWithStock(tenantId?: string | null): Promise<
    Array<
      ErpPickList & {
        lines: Array<
          ErpPickListLine & {
            stockQuantity: number;
            stockReserved: number;
            stockAvailable: number;
            stockStatus: "ok" | "short" | "out";
          }
        >;
      }
    >
  > {
    const tid = requireTenantId(tenantId);
    const pickLists = await this.listPickLists(tid);
    const stockByWarehouse = new Map<string, Awaited<ReturnType<typeof this.listStockLevels>>>();

    const result = [];
    for (const p of pickLists) {
      const lines = await this.getPickListLines(p.id);
      let stockRows: Awaited<ReturnType<typeof this.listStockLevels>> = [];
      if (p.warehouseId) {
        if (!stockByWarehouse.has(p.warehouseId)) {
          stockByWarehouse.set(
            p.warehouseId,
            await this.listStockLevels(tid, { warehouseId: p.warehouseId }),
          );
        }
        stockRows = stockByWarehouse.get(p.warehouseId) || [];
      }

      const byProduct = new Map<string, typeof stockRows>();
      for (const s of stockRows) {
        const key = s.productNumber;
        const arr = byProduct.get(key) || [];
        arr.push(s);
        byProduct.set(key, arr);
      }

      const enriched = lines.map((line) => {
        const agg = aggregateStockForProduct(byProduct.get(line.productNumber) || []);
        const stockStatus = pickStockStatus(agg.available, line.quantity);
        return {
          ...line,
          stockQuantity: agg.quantity,
          stockReserved: agg.reservedQuantity,
          stockAvailable: agg.available,
          stockStatus,
        };
      });
      result.push({ ...p, lines: enriched });
    }
    return result;
  },

  async createPickList(
    data: {
      warehouseId?: string;
      orderRefs: Array<{ orderId?: string; orderNumber?: string }>;
      lines: Array<{
        productNumber: string;
        quantity: number;
        locationCode?: string;
        orderNumber?: string;
      }>;
      createdBy?: string;
    },
    tenantId?: string | null,
  ): Promise<ErpPickList & { lines: ErpPickListLine[] }> {
    const tid = requireTenantId(tenantId);
    if (data.warehouseId) {
      const warehouse = await this.getWarehouse(data.warehouseId, tid);
      if (!warehouse) throw new Error("Warehouse not found");
    }
    const [list] = await db
      .insert(erpPickLists)
      .values({
        tenantId: tid,
        warehouseId: data.warehouseId || null,
        orderRefs: data.orderRefs,
        createdBy: data.createdBy || null,
        status: "open",
      })
      .returning();

    const lines: ErpPickListLine[] = [];
    for (const line of data.lines) {
      const [row] = await db
        .insert(erpPickListLines)
        .values({
          pickListId: list.id,
          productNumber: line.productNumber,
          quantity: line.quantity,
          locationCode: line.locationCode || null,
          orderNumber: line.orderNumber || null,
        })
        .returning();
      lines.push(row);
    }
    return { ...list, lines };
  },

  async getPickListLines(pickListId: string): Promise<ErpPickListLine[]> {
    return db.select().from(erpPickListLines).where(eq(erpPickListLines.pickListId, pickListId));
  },

  /**
   * Scan: pickedQuantity += delta (default +1), clamp 0…line.quantity.
   * Prefers a line that is not yet fully picked (for +1); for −1 prefers a line with picked > 0.
   */
  async scanPickListProduct(
    pickListId: string,
    productNumber: string,
    tenantId?: string | null,
    delta: 1 | -1 = 1,
  ): Promise<{ line: ErpPickListLine; completedLine: boolean }> {
    const tid = requireTenantId(tenantId);
    const pn = productNumber.trim();
    if (!pn) throw new Error("Product number required");
    if (delta !== 1 && delta !== -1) throw new Error("Invalid delta");

    const lists = await db
      .select()
      .from(erpPickLists)
      .where(and(eq(erpPickLists.id, pickListId), eq(erpPickLists.tenantId, tid)))
      .limit(1);
    const list = lists[0];
    if (!list) throw new Error("Pick list not found");
    if (list.status !== "open") throw new Error("Pick list is not open");

    const lines = await this.getPickListLines(pickListId);
    const matches = lines.filter((l) => l.productNumber === pn);
    if (matches.length === 0) throw new Error("Product not on this pick list");

    const line =
      delta === 1
        ? matches.find((l) => (l.pickedQuantity ?? 0) < l.quantity) || matches[matches.length - 1]
        : matches.find((l) => (l.pickedQuantity ?? 0) > 0) || matches[matches.length - 1];
    const current = line.pickedQuantity ?? 0;
    const { next, completedLine } = applyPickedQuantityDelta(current, line.quantity, delta);
    if (next === current) {
      return { line, completedLine };
    }
    const [row] = await db
      .update(erpPickListLines)
      .set({ pickedQuantity: next })
      .where(eq(erpPickListLines.id, line.id))
      .returning();
    return { line: row, completedLine };
  },

  async cancelPickList(
    id: string,
    tenantId?: string | null,
  ): Promise<ErpPickList | undefined> {
    const tid = requireTenantId(tenantId);
    const lists = await db
      .select()
      .from(erpPickLists)
      .where(and(eq(erpPickLists.id, id), eq(erpPickLists.tenantId, tid)))
      .limit(1);
    const list = lists[0];
    if (!list) return undefined;
    if (list.status === "completed") {
      throw new Error("Pick list already completed");
    }
    if (list.status === "cancelled") {
      return list;
    }
    if (list.status !== "open") {
      throw new Error("Only open pick lists can be cancelled");
    }
    const [row] = await db
      .update(erpPickLists)
      .set({ status: "cancelled" })
      .where(eq(erpPickLists.id, id))
      .returning();
    return row;
  },

  async completePickList(
    id: string,
    tenantId?: string | null,
    createdBy?: string,
  ): Promise<ErpPickList | undefined> {
    const tid = requireTenantId(tenantId);
    const lists = await db
      .select()
      .from(erpPickLists)
      .where(and(eq(erpPickLists.id, id), eq(erpPickLists.tenantId, tid)))
      .limit(1);
    const list = lists[0];
    if (!list) return undefined;
    if (list.status === "completed") {
      throw new Error("Pick list already completed");
    }
    if (list.status === "cancelled") {
      throw new Error("Pick list is cancelled");
    }

    const lines = await this.getPickListLines(id);
    if (list.warehouseId) {
      const orderRefs = Array.isArray(list.orderRefs) ? list.orderRefs : [];
      for (const line of lines) {
        const orderNumber = String(line.orderNumber || "").trim();
        // Doppelbuchung: Shopware-Verkaufs-Sync hat dieselbe Position schon abgebucht
        let alreadyFromShopware = false;
        if (orderNumber) {
          const existing = await this.findIssueForOrderProduct(tid, line.productNumber, orderNumber);
          if (existing?.referenceType === "shopware_order") {
            alreadyFromShopware = true;
          }
        }
        if (!alreadyFromShopware) {
          for (const ref of orderRefs as Array<{ orderId?: string; orderNumber?: string }>) {
            const oid = String(ref.orderId || "").trim();
            if (!oid) continue;
            const byId = await this.findStockMovementByReference(
              tid,
              "shopware_order",
              `${oid}:${line.productNumber}`,
            );
            if (byId) {
              alreadyFromShopware = true;
              break;
            }
          }
        }

        if (alreadyFromShopware) {
          await db
            .update(erpPickListLines)
            .set({ pickedQuantity: line.quantity })
            .where(eq(erpPickListLines.id, line.id));
          continue;
        }

        await this.recordStockMovement(
          {
            warehouseId: list.warehouseId,
            productNumber: line.productNumber,
            quantity: -Math.abs(line.quantity),
            movementType: "issue",
            referenceType: "pick_list",
            referenceId: id,
            note: `Kommissionierung ${orderNumber}`.trim(),
            createdBy,
          },
          tenantId,
        );
        await db
          .update(erpPickListLines)
          .set({ pickedQuantity: line.quantity })
          .where(eq(erpPickListLines.id, line.id));
      }
    }

    const [row] = await db
      .update(erpPickLists)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(erpPickLists.id, id))
      .returning();
    return row;
  },
};
