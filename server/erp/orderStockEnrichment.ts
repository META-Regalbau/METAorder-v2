/**
 * Bestellpositionen mit ERP-Lagerbestand (Default-/Hauptlager) anreichern.
 */
import type { Order, OrderItem } from "@shared/schema";
import { erpStorage } from "./erpStorage";
import {
  aggregateStockForProduct,
  pickStockStatus,
  type PickStockStatus,
} from "./erpLogic";

export type OrderStockSummary = {
  status: PickStockStatus;
  issueCount: number;
  lineCount: number;
  warehouseCode?: string;
};

function summarizeItems(
  items: Array<OrderItem & { stockStatus?: PickStockStatus }>,
): OrderStockSummary["status"] {
  let hasShort = false;
  let hasOut = false;
  for (const item of items) {
    if (!item.productNumber?.trim()) continue;
    if (item.stockStatus === "out") hasOut = true;
    else if (item.stockStatus === "short") hasShort = true;
  }
  if (hasOut) return "out";
  if (hasShort) return "short";
  return "ok";
}

export async function enrichOrdersWithStockAvailability(
  orders: Order[],
  tenantId: string | null | undefined,
): Promise<Order[]> {
  if (!tenantId || !orders.length) return orders;

  try {
    const warehouses = await erpStorage.listWarehouses(tenantId);
    if (!warehouses.length) return orders;

    const warehouse =
      warehouses.find((w) => w.isDefault) ||
      warehouses.find(
        (w) =>
          /haupt/i.test(String(w.code || "")) || /haupt/i.test(String(w.name || "")),
      ) ||
      warehouses[0];

    const stockRows = await erpStorage.listStockLevels(tenantId, {
      warehouseId: warehouse.id,
    });

    const byProduct = new Map<string, typeof stockRows>();
    for (const row of stockRows) {
      const key = row.productNumber;
      const arr = byProduct.get(key) || [];
      arr.push(row);
      byProduct.set(key, arr);
    }

    const warehouseCode = warehouse.code || warehouse.name || warehouse.id;

    return orders.map((order) => {
      const items = (order.items || []).map((item) => {
        const pn = String(item.productNumber || "").trim();
        if (!pn) {
          return { ...item };
        }
        const agg = aggregateStockForProduct(byProduct.get(pn) || []);
        const stockStatus = pickStockStatus(agg.available, item.quantity);
        return {
          ...item,
          stockQuantity: agg.quantity,
          stockReserved: agg.reservedQuantity,
          stockAvailable: agg.available,
          stockStatus,
        };
      });

      const productLines = items.filter((i) => String(i.productNumber || "").trim());
      const issueCount = productLines.filter((i) => i.stockStatus && i.stockStatus !== "ok").length;
      const stockSummary: OrderStockSummary = {
        status: summarizeItems(items),
        issueCount,
        lineCount: productLines.length,
        warehouseCode,
      };

      return {
        ...order,
        items,
        stockSummary,
      };
    });
  } catch (e) {
    console.warn("[enrichOrdersWithStockAvailability] skipped:", (e as Error)?.message || e);
    return orders;
  }
}
