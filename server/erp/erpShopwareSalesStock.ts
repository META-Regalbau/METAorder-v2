/**
 * Shopware-Verkäufe → ERP-Lagerabgang (idempotent).
 */
import type { Order } from "@shared/schema";
import { erpStorage } from "./erpStorage";
import { requireTenantId } from "./erpLogic";
import { getDefaultWarehouseOrThrow } from "./erpStockReconcile";
import { storage } from "../storage";
import { ShopwareClient } from "../shopware";

export const ERP_SHOPWARE_SALES_CURSOR_KEY = "erp_shopware_sales_stock_cursor";

export function shopwareOrderMovementRef(orderId: string, productNumber: string): string {
  return `${orderId}:${productNumber}`;
}

export function shopwareOrderCancelRef(orderId: string, productNumber: string): string {
  return `${orderId}:${productNumber}`;
}

export function saleNote(orderNumber: string): string {
  return `Shopware-Verkauf #${orderNumber}`;
}

export function cancelNote(orderNumber: string): string {
  return `Shopware-Storno #${orderNumber}`;
}

type CursorState = {
  /** ISO — Orders mit orderDate >= since werden betrachtet (plus Lookback) */
  since?: string;
  lastRunAt?: string;
  lastBookedAt?: string;
};

async function loadCursor(tenantId: string): Promise<CursorState> {
  const raw = (await storage.getSetting(ERP_SHOPWARE_SALES_CURSOR_KEY, tenantId)) as CursorState | undefined;
  return raw && typeof raw === "object" ? raw : {};
}

async function saveCursor(tenantId: string, state: CursorState): Promise<void> {
  await storage.saveSetting(ERP_SHOPWARE_SALES_CURSOR_KEY, state, tenantId);
}

function isCancelled(order: Order): boolean {
  return order.status === "cancelled" || order.paymentStatus === "cancelled";
}

async function alreadyBookedSale(
  tenantId: string,
  orderId: string,
  orderNumber: string,
  productNumber: string,
): Promise<boolean> {
  const byRef = await erpStorage.findStockMovementByReference(
    tenantId,
    "shopware_order",
    shopwareOrderMovementRef(orderId, productNumber),
  );
  if (byRef) return true;
  // Pickliste hat dieselbe Order schon abgebucht
  const byPick = await erpStorage.findIssueForOrderProduct(tenantId, productNumber, orderNumber);
  return Boolean(byPick);
}

async function alreadyBookedCancel(
  tenantId: string,
  orderId: string,
  productNumber: string,
): Promise<boolean> {
  const row = await erpStorage.findStockMovementByReference(
    tenantId,
    "shopware_order_cancel",
    shopwareOrderCancelRef(orderId, productNumber),
  );
  return Boolean(row);
}

export type SyncShopwareSalesResult = {
  warehouseId: string;
  processedOrders: number;
  bookedIssues: number;
  bookedCancels: number;
  skipped: number;
};

/**
 * Bucht Shopware-Aufträge als ERP-issue (Default-Lager). Idempotent.
 * Bei Storno: einmalige Korrektur als receipt, wenn zuvor gebucht.
 */
export async function syncShopwareSalesToErpStock(
  tenantId: string | null | undefined,
  opts?: {
    orders?: Order[];
    createdBy?: string;
    /** Wenn true: alle geladenen Orders (kein Datumsfilter aus Cursor) */
    fullScan?: boolean;
  },
): Promise<SyncShopwareSalesResult> {
  const tid = requireTenantId(tenantId);
  const warehouse = await getDefaultWarehouseOrThrow(tid);
  const cursor = await loadCursor(tid);

  let orders = opts?.orders;
  if (!orders) {
    const settings = await storage.getShopwareSettings(tid);
    if (!settings) throw new Error("Shopware settings not configured");
    const client = new ShopwareClient(settings);
    orders = await client.fetchOrders(undefined, { includeInvoiceInfo: false });
  }

  const sinceMs = opts?.fullScan
    ? 0
    : cursor.since
      ? Date.parse(cursor.since) - 2 * 24 * 60 * 60 * 1000 // 2 Tage Lookback
      : 0;

  let bookedIssues = 0;
  let bookedCancels = 0;
  let skipped = 0;
  let processedOrders = 0;
  let newestOrderDate: string | undefined = cursor.since;

  for (const order of orders) {
    const orderDateMs = Date.parse(order.orderDate || "") || 0;
    if (sinceMs > 0 && orderDateMs > 0 && orderDateMs < sinceMs) {
      continue;
    }
    processedOrders += 1;

    if (order.orderDate && (!newestOrderDate || order.orderDate > newestOrderDate)) {
      newestOrderDate = order.orderDate;
    }

    const items = (order.items || []).filter(
      (i) => i.productNumber && Number(i.quantity) > 0,
    );

    if (isCancelled(order)) {
      for (const item of items) {
        const pn = String(item.productNumber).trim();
        const saleExists = await erpStorage.findStockMovementByReference(
          tid,
          "shopware_order",
          shopwareOrderMovementRef(order.id, pn),
        );
        if (!saleExists) {
          skipped += 1;
          continue;
        }
        if (await alreadyBookedCancel(tid, order.id, pn)) {
          skipped += 1;
          continue;
        }
        await erpStorage.recordStockMovement(
          {
            warehouseId: warehouse.id,
            productNumber: pn,
            quantity: Math.abs(Number(item.quantity)),
            movementType: "receipt",
            referenceType: "shopware_order_cancel",
            referenceId: shopwareOrderCancelRef(order.id, pn),
            note: cancelNote(order.orderNumber),
            createdBy: opts?.createdBy,
          },
          tid,
        );
        bookedCancels += 1;
      }
      continue;
    }

    for (const item of items) {
      const pn = String(item.productNumber).trim();
      if (await alreadyBookedSale(tid, order.id, order.orderNumber, pn)) {
        skipped += 1;
        continue;
      }
      await erpStorage.recordStockMovement(
        {
          warehouseId: warehouse.id,
          productNumber: pn,
          quantity: -Math.abs(Number(item.quantity)),
          movementType: "issue",
          referenceType: "shopware_order",
          referenceId: shopwareOrderMovementRef(order.id, pn),
          note: saleNote(order.orderNumber),
          createdBy: opts?.createdBy,
        },
        tid,
      );
      bookedIssues += 1;
    }
  }

  await saveCursor(tid, {
    since: newestOrderDate || cursor.since || new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    lastBookedAt:
      bookedIssues + bookedCancels > 0 ? new Date().toISOString() : cursor.lastBookedAt,
  });

  return {
    warehouseId: warehouse.id,
    processedOrders,
    bookedIssues,
    bookedCancels,
    skipped,
  };
}

/** Fire-and-forget nach Order-Cache-Reload. */
export function triggerShopwareSalesStockSync(
  tenantId: string | null | undefined,
  orders?: Order[],
): void {
  if (!tenantId) return;
  void syncShopwareSalesToErpStock(tenantId, { orders }).catch((err) => {
    console.error(`[erp/shopware-sales-stock] sync failed (tenant=${tenantId}):`, err);
  });
}
