/**
 * Bestandsabgleich ERP ↔ Shopware-Mirror (Diff + Apply auf Hauptlager/Default-Lager).
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { shopwareProducts } from "@shared/schema";
import { buildErpProductLabel, type ErpProductLabel } from "@shared/productVariantLabel";
import { erpStorage } from "./erpStorage";
import { requireTenantId } from "./erpLogic";
import { syncShopwareMirrorForTenant } from "../shopwareMirror";
import { storage } from "../storage";
import { ShopwareClient } from "../shopware";

export type StockReconcileRow = {
  productNumber: string;
  shopwareQty: number;
  erpQty: number;
  /** shopwareQty - erpQty (positiv = Shopware hat mehr) */
  delta: number;
  label: ErpProductLabel;
  shopwareId?: string | null;
  /** true = Parent mit Varianten — wird nicht gebucht, nur angezeigt falls Diff */
  isParent?: boolean;
  /** Netto-VK aus Shopware-Spiegel (für Bestandsbewertung) */
  priceNet?: number | null;
  /** Brutto-VK aus Shopware-Spiegel */
  priceGross?: number | null;
  /** Einkaufspreis netto aus Shopware-Spiegel (falls gepflegt) */
  purchasePriceNet?: number | null;
  /** Reservierte ERP-Menge (ohne Lagerort) */
  reservedQuantity?: number;
};

export type StockReconcileResult = {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  rows: StockReconcileRow[];
  totals: {
    compared: number;
    diffs: number;
    onlyShopware: number;
    onlyErp: number;
    skippedParents: number;
  };
};

function stockFromPayload(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const p = payload as { stock?: number | null };
  const n = Number(p.stock ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function numFromPayload(payload: unknown, key: string): number | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as Record<string, unknown>)[key];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function pricesFromPayload(payload: unknown): {
  priceNet: number | null;
  priceGross: number | null;
  purchasePriceNet: number | null;
} {
  return {
    priceNet: numFromPayload(payload, "priceNet"),
    priceGross: numFromPayload(payload, "priceGross"),
    purchasePriceNet: numFromPayload(payload, "purchasePriceNet"),
  };
}

function parentIdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return String((payload as { parentId?: string | null }).parentId || "").trim();
}

function isMissingPrice(value: number | null | undefined): boolean {
  return value == null || !Number.isFinite(value) || value === 0;
}

/**
 * Varianten speichern im Spiegel oft priceNet/priceGross = 0 und erben den
 * Listenpreis vom Parent (wie die Produkt-Übersicht). Für Bestandsbewertung
 * denselben Fall auflösen.
 */
function resolvePricesWithParent(
  own: { priceNet: number | null; priceGross: number | null; purchasePriceNet: number | null },
  parentId: string,
  pricesByShopwareId: Map<
    string,
    { priceNet: number | null; priceGross: number | null; purchasePriceNet: number | null }
  >,
): { priceNet: number | null; priceGross: number | null; purchasePriceNet: number | null } {
  const parent = parentId ? pricesByShopwareId.get(parentId) : undefined;
  return {
    priceNet: !isMissingPrice(own.priceNet)
      ? own.priceNet
      : !isMissingPrice(parent?.priceNet)
        ? parent!.priceNet
        : own.priceNet ?? parent?.priceNet ?? null,
    priceGross: !isMissingPrice(own.priceGross)
      ? own.priceGross
      : !isMissingPrice(parent?.priceGross)
        ? parent!.priceGross
        : own.priceGross ?? parent?.priceGross ?? null,
    purchasePriceNet: !isMissingPrice(own.purchasePriceNet)
      ? own.purchasePriceNet
      : !isMissingPrice(parent?.purchasePriceNet)
        ? parent!.purchasePriceNet
        : own.purchasePriceNet ?? parent?.purchasePriceNet ?? null,
  };
}

function optionsFromPayload(payload: unknown): Array<{ group: string; option: string }> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as { options?: Array<{ group?: string; option?: string }> };
  if (!Array.isArray(p.options) || !p.options.length) return undefined;
  const mapped = p.options
    .map((o) => ({ group: String(o.group || "").trim(), option: String(o.option || "").trim() }))
    .filter((o) => o.option);
  return mapped.length ? mapped : undefined;
}

function propertiesFromPayload(
  payload: unknown,
): Array<{ groupName: string; optionName: string }> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as { properties?: Array<{ groupName?: string; optionName?: string }> };
  if (!Array.isArray(p.properties) || !p.properties.length) return undefined;
  const mapped = p.properties
    .map((o) => ({
      groupName: String(o.groupName || "").trim(),
      optionName: String(o.optionName || "").trim(),
    }))
    .filter((o) => o.optionName);
  return mapped.length ? mapped : undefined;
}

function isParentWithVariants(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as { childCount?: number | null };
  return Number(p.childCount ?? 0) > 0;
}

/**
 * Hauptlager = isDefault, sonst Code/Name „Hauptlager“, sonst erstes aktives Lager.
 * Fehlt jedes Lager, wird automatisch „Hauptlager“ angelegt.
 */
export async function getDefaultWarehouseOrThrow(tenantId: string) {
  let warehouses = await erpStorage.listWarehouses(tenantId);

  if (!warehouses.length) {
    const created = await erpStorage.createWarehouse(
      { code: "HL", name: "Hauptlager", isDefault: true, active: true },
      tenantId,
    );
    return created;
  }

  let def =
    warehouses.find((w) => w.isDefault && w.active) ||
    warehouses.find((w) => w.isDefault) ||
    warehouses.find(
      (w) =>
        /^hauptlager$/i.test(String(w.code || "").trim()) ||
        /^hauptlager$/i.test(String(w.name || "").trim()) ||
        /^hl$/i.test(String(w.code || "").trim()),
    ) ||
    warehouses.find((w) => w.active) ||
    warehouses[0];

  if (!def) {
    throw new Error("No warehouse configured — create a default warehouse first");
  }

  if (!def.isDefault) {
    try {
      const updated = await erpStorage.updateWarehouse(def.id, { isDefault: true }, tenantId);
      if (updated) def = updated;
    } catch (err) {
      console.warn("[erp/stock-reconcile] could not mark warehouse as default:", err);
    }
  }

  return def;
}

/** Mirror aktualisieren + alle Differenzen ins Hauptlager übernehmen. */
export async function importShopwareStockToHauptlager(
  tenantId: string | null | undefined,
  opts?: { createdBy?: string; skipMirrorRefresh?: boolean },
): Promise<{
  warehouseId: string;
  warehouseCode: string;
  applied: number;
  skipped: number;
  mirrorRefreshed: boolean;
  totals: StockReconcileResult["totals"];
}> {
  const tid = requireTenantId(tenantId);
  await getDefaultWarehouseOrThrow(tid);

  let mirrorRefreshed = false;
  if (!opts?.skipMirrorRefresh) {
    await refreshShopwareMirrorForStock(tid);
    mirrorRefreshed = true;
  }

  const appliedResult = await applyStockReconcileFromShopware(tid, {
    allDiffs: true,
    createdBy: opts?.createdBy,
  });
  const diff = await buildStockReconcileDiff(tid, { onlyDiffs: true });

  return {
    warehouseId: appliedResult.warehouseId,
    warehouseCode: appliedResult.warehouseCode,
    applied: appliedResult.applied,
    skipped: appliedResult.skipped,
    mirrorRefreshed,
    totals: diff.totals,
  };
}

export async function buildStockReconcileDiff(
  tenantId: string | null | undefined,
  opts?: { onlyDiffs?: boolean; includeParents?: boolean },
): Promise<StockReconcileResult> {
  const tid = requireTenantId(tenantId);
  const warehouse = await getDefaultWarehouseOrThrow(tid);

  const mirrorRows = await db
    .select({
      shopwareId: shopwareProducts.shopwareId,
      productNumber: shopwareProducts.productNumber,
      name: shopwareProducts.name,
      active: shopwareProducts.active,
      payload: shopwareProducts.payload,
    })
    .from(shopwareProducts)
    .where(eq(shopwareProducts.tenantId, tid));

  const parentNameById = new Map<string, string>();
  /** Preise aller Mirror-Zeilen inkl. Parents (für Varianten-Vererbung). */
  const pricesByShopwareId = new Map<
    string,
    { priceNet: number | null; priceGross: number | null; purchasePriceNet: number | null }
  >();
  for (const row of mirrorRows) {
    pricesByShopwareId.set(row.shopwareId, pricesFromPayload(row.payload));
    if (isParentWithVariants(row.payload) && row.name) {
      parentNameById.set(row.shopwareId, row.name);
    }
  }

  const shopwareByPn = new Map<
    string,
    {
      qty: number;
      name: string | null;
      parentName?: string | null;
      options?: Array<{ group: string; option: string }>;
      properties?: Array<{ groupName: string; optionName: string }>;
      isParent: boolean;
      shopwareId: string;
      active: boolean | null;
      priceNet: number | null;
      priceGross: number | null;
      purchasePriceNet: number | null;
    }
  >();
  let skippedParents = 0;

  for (const row of mirrorRows) {
    const pn = String(row.productNumber || "").trim();
    if (!pn) continue;
    const parent = isParentWithVariants(row.payload);
    if (parent && opts?.includeParents !== true) {
      skippedParents += 1;
      // Eltern mit Varianten nicht ins ERP buchen — Bestand liegt auf den Varianten-SKUs
      continue;
    }
    const parentId = parentIdFromPayload(row.payload);
    const prices = resolvePricesWithParent(
      pricesFromPayload(row.payload),
      parentId,
      pricesByShopwareId,
    );
    shopwareByPn.set(pn, {
      qty: stockFromPayload(row.payload),
      name: row.name,
      parentName: parentId ? parentNameById.get(parentId) : null,
      options: optionsFromPayload(row.payload),
      properties: propertiesFromPayload(row.payload),
      isParent: parent,
      shopwareId: row.shopwareId,
      active: row.active,
      priceNet: prices.priceNet,
      priceGross: prices.priceGross,
      purchasePriceNet: prices.purchasePriceNet,
    });
  }

  const erpStock = await erpStorage.listStockLevels(tid, { warehouseId: warehouse.id });
  const erpByPn = new Map<string, { qty: number; reserved: number }>();
  for (const s of erpStock) {
    const pn = String(s.productNumber || "").trim();
    if (!pn) continue;
    // Nur Bestände ohne Lagerort (Hauptlager-Ebene)
    if (s.locationId) continue;
    const prev = erpByPn.get(pn) || { qty: 0, reserved: 0 };
    prev.qty += Number(s.quantity || 0);
    prev.reserved += Number(s.reservedQuantity || 0);
    erpByPn.set(pn, prev);
  }

  const allPns = new Set([...shopwareByPn.keys(), ...erpByPn.keys()]);
  const rows: StockReconcileRow[] = [];
  let diffs = 0;
  let onlyShopware = 0;
  let onlyErp = 0;

  for (const pn of Array.from(allPns).sort()) {
    const sw = shopwareByPn.get(pn);
    const erp = erpByPn.get(pn);
    const shopwareQty = sw?.qty ?? 0;
    const erpQty = erp?.qty ?? 0;
    const delta = shopwareQty - erpQty;
    if (!sw && erpByPn.has(pn)) onlyErp += 1;
    if (sw && !erpByPn.has(pn)) onlyShopware += 1;
    if (delta !== 0) diffs += 1;
    if (opts?.onlyDiffs !== false && delta === 0) continue;

    rows.push({
      productNumber: pn,
      shopwareQty,
      erpQty,
      delta,
      shopwareId: sw?.shopwareId ?? null,
      isParent: sw?.isParent,
      priceNet: sw?.priceNet ?? null,
      priceGross: sw?.priceGross ?? null,
      purchasePriceNet: sw?.purchasePriceNet ?? null,
      reservedQuantity: erp?.reserved ?? 0,
      label: buildErpProductLabel({
        productNumber: pn,
        name: sw?.name,
        parentName: sw?.parentName,
        options: sw?.options,
        properties: sw?.properties,
        shopwareId: sw?.shopwareId,
        active: sw?.active,
        isParent: sw?.isParent,
      }),
    });
  }

  return {
    warehouseId: warehouse.id,
    warehouseCode: warehouse.code,
    warehouseName: warehouse.name,
    rows,
    totals: {
      compared: allPns.size,
      diffs,
      onlyShopware,
      onlyErp,
      skippedParents,
    },
  };
}

export async function applyStockReconcileFromShopware(
  tenantId: string | null | undefined,
  opts: {
    productNumbers?: string[];
    allDiffs?: boolean;
    createdBy?: string;
  },
): Promise<{ applied: number; skipped: number; warehouseId: string; warehouseCode: string }> {
  const tid = requireTenantId(tenantId);
  const diff = await buildStockReconcileDiff(tid, { onlyDiffs: true });
  const wanted = opts.allDiffs
    ? null
    : new Set((opts.productNumbers || []).map((n) => n.trim()).filter(Boolean));

  let applied = 0;
  let skipped = 0;

  for (const row of diff.rows) {
    if (wanted && !wanted.has(row.productNumber)) {
      skipped += 1;
      continue;
    }
    if (row.delta === 0 || row.isParent) {
      skipped += 1;
      continue;
    }

    await erpStorage.recordStockMovement(
      {
        warehouseId: diff.warehouseId,
        productNumber: row.productNumber,
        quantity: row.delta,
        movementType: "adjustment",
        locationId: null,
        referenceType: "shopware_reconcile",
        referenceId: row.productNumber,
        note: `Shopware-Abgleich → ${diff.warehouseCode}: ERP ${row.erpQty} → Shopware ${row.shopwareQty}`,
        createdBy: opts.createdBy,
      },
      tid,
    );
    applied += 1;
  }

  return {
    applied,
    skipped,
    warehouseId: diff.warehouseId,
    warehouseCode: diff.warehouseCode,
  };
}

export async function refreshShopwareMirrorForStock(tenantId: string | null | undefined): Promise<void> {
  const tid = requireTenantId(tenantId);
  const settings = await storage.getShopwareSettings(tid);
  if (!settings) throw new Error("Shopware settings not configured");
  const client = new ShopwareClient(settings);
  // force: Options/Properties neu laden (Fingerprint allein reicht nicht)
  await syncShopwareMirrorForTenant(storage, client, tid, {
    settings,
    entities: ["products"],
    force: true,
  });
}

async function updateMirrorStock(
  tenantId: string,
  shopwareId: string,
  stock: number,
): Promise<void> {
  const [row] = await db
    .select()
    .from(shopwareProducts)
    .where(
      and(eq(shopwareProducts.tenantId, tenantId), eq(shopwareProducts.shopwareId, shopwareId)),
    )
    .limit(1);
  if (!row) return;
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? { ...(row.payload as Record<string, unknown>), stock }
      : { stock };
  await db
    .update(shopwareProducts)
    .set({ payload, syncedAt: new Date() })
    .where(eq(shopwareProducts.id, row.id));
}

/**
 * Schreibt ERP-Bestand (Default-Lager) als absolute Shopware-Menge.
 * Nach Inventur / wenn META Order die Lagerwahrheit ist.
 */
export async function pushErpStockToShopware(
  tenantId: string | null | undefined,
  opts: {
    productNumbers?: string[];
    allDiffs?: boolean;
  },
): Promise<{
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
  warehouseCode: string;
}> {
  const tid = requireTenantId(tenantId);
  const settings = await storage.getShopwareSettings(tid);
  if (!settings) throw new Error("Shopware settings not configured");
  const client = new ShopwareClient(settings);

  const wanted = opts.allDiffs
    ? null
    : new Set((opts.productNumbers || []).map((n) => n.trim()).filter(Boolean));

  const full = await buildStockReconcileDiff(tid, { onlyDiffs: false });
  const rows = wanted
    ? full.rows.filter((r) => wanted.has(r.productNumber))
    : full.rows.filter((r) => r.delta !== 0);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (row.isParent) {
      skipped += 1;
      continue;
    }
    const shopwareId = row.shopwareId || row.label?.shopwareId || null;
    if (!shopwareId) {
      skipped += 1;
      continue;
    }
    if (row.shopwareQty === row.erpQty) {
      skipped += 1;
      continue;
    }

    try {
      await client.setProductStock(shopwareId, row.erpQty);
      await updateMirrorStock(tid, shopwareId, row.erpQty);
      updated += 1;
    } catch (e) {
      failed += 1;
      errors.push(
        `${row.productNumber}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return {
    updated,
    skipped,
    failed,
    errors: errors.slice(0, 20),
    warehouseCode: full.warehouseCode,
  };
}

/**
 * Nach Inventur: ERP-Bestand der Inventurpositionen nach Shopware schreiben.
 */
export async function pushInventoryCountStockToShopware(
  tenantId: string | null | undefined,
  inventoryCountId: string,
): Promise<{
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
  warehouseCode: string;
}> {
  const tid = requireTenantId(tenantId);
  const count = await erpStorage.getInventoryCount(inventoryCountId, tid);
  if (!count) throw new Error("Inventur nicht gefunden");
  if (count.status !== "completed") {
    throw new Error("Inventur muss zuerst abgeschlossen sein (ERP-Bestand buchen)");
  }
  const lines = await erpStorage.getInventoryCountLines(inventoryCountId);
  const productNumbers = [...new Set(lines.map((l) => l.productNumber).filter(Boolean))];
  return pushErpStockToShopware(tid, { productNumbers, allDiffs: false });
}
