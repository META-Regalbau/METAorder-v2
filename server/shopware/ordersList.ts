import type { Order, OrderStatus } from "@shared/schema";
import { matchesOrderNumberFilter, type OrderNumberFilter } from "@shared/orderNumberFilter";

export type OrdersListInvoiceFilter = "all" | "with" | "without" | "unsent";
export type OrdersListOrderNumberFilter = OrderNumberFilter;
export type OrdersListSortKey =
  | "orderNumber"
  | "customerName"
  | "orderDate"
  | "status"
  | "totalAmount"
  | "trackingNumber";

export type OrdersListQuery = {
  search?: string;
  status?: OrderStatus | "all";
  invoiceFilter?: OrdersListInvoiceFilter;
  orderNumberFilter?: OrdersListOrderNumberFilter;
  dateFrom?: string;
  dateTo?: string;
  sortKey?: OrdersListSortKey;
  sortDirection?: "asc" | "desc";
};

export function filterOrdersList(orders: Order[], query: OrdersListQuery): Order[] {
  const normalizedSearch = (query.search ?? "").trim().toLowerCase();

  return orders.filter((order) => {
    const matchesSearch =
      normalizedSearch === "" ||
      order.orderNumber.toLowerCase().includes(normalizedSearch) ||
      order.customerName.toLowerCase().includes(normalizedSearch) ||
      order.customerEmail.toLowerCase().includes(normalizedSearch) ||
      order.invoiceNumber?.toLowerCase().includes(normalizedSearch) ||
      order.erpNumber?.toLowerCase().includes(normalizedSearch);

    const matchesStatus = !query.status || query.status === "all" || order.status === query.status;

    const invoiceFilter = query.invoiceFilter ?? "all";
    const matchesInvoice =
      invoiceFilter === "all" ||
      (invoiceFilter === "with" && !!order.hasInvoiceDocument) ||
      (invoiceFilter === "without" && !order.hasInvoiceDocument) ||
      (invoiceFilter === "unsent" && !!order.hasInvoiceDocument && !order.invoiceSent);

    const matchesDateFrom =
      !query.dateFrom || new Date(order.orderDate) >= new Date(query.dateFrom);
    const matchesDateTo =
      !query.dateTo || new Date(order.orderDate) <= new Date(query.dateTo);

    const matchesOrderNumber = matchesOrderNumberFilter(order.orderNumber, query.orderNumberFilter ?? "all");

    return (
      matchesSearch &&
      matchesStatus &&
      matchesInvoice &&
      matchesDateFrom &&
      matchesDateTo &&
      matchesOrderNumber
    );
  });
}

export function sortOrdersList(orders: Order[], query: OrdersListQuery): Order[] {
  const sortKey = query.sortKey ?? "orderDate";
  const direction = query.sortDirection === "asc" ? 1 : -1;

  return [...orders].sort((a, b) => {
    switch (sortKey) {
      case "orderNumber":
        return a.orderNumber.localeCompare(b.orderNumber) * direction;
      case "customerName":
        return a.customerName.localeCompare(b.customerName) * direction;
      case "orderDate":
        return (new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime()) * direction;
      case "status":
        return a.status.localeCompare(b.status) * direction;
      case "totalAmount":
        return ((a.totalAmount || 0) - (b.totalAmount || 0)) * direction;
      case "trackingNumber": {
        const aTracking = a.shippingInfo?.trackingNumber || "";
        const bTracking = b.shippingInfo?.trackingNumber || "";
        return aTracking.localeCompare(bTracking) * direction;
      }
      default:
        return 0;
    }
  });
}

/** Doppelte Bestellungen (gleiche Nummer+E-Mail innerhalb 7 Tage). */
export function computeDuplicateOrderIds(orders: Order[]): Set<string> {
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const groups = new Map<string, Order[]>();

  for (const order of orders) {
    const key = `${order.orderNumber}|${order.customerEmail}`.toLowerCase();
    const list = groups.get(key) ?? [];
    list.push(order);
    groups.set(key, list);
  }

  const duplicates = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime(),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const diff = Math.abs(
          new Date(sorted[j].orderDate).getTime() - new Date(sorted[i].orderDate).getTime(),
        );
        if (diff <= windowMs) {
          duplicates.add(sorted[i].id);
          duplicates.add(sorted[j].id);
        } else {
          break;
        }
      }
    }
  }

  return duplicates;
}

/**
 * Bestellungen zu genau einer Bestellnummer (Gross-/Kleinschreibung und Leerzeichen egal), neueste
 * zuerst. Shopware-Nummern sind nicht eindeutig - deshalb kann es mehrere Treffer geben.
 */
export function findOrdersByOrderNumber<T extends Order>(orders: T[], orderNumber: string): T[] {
  const wanted = orderNumber.trim().toLowerCase();
  if (!wanted) return [];
  return orders
    .filter((order) => (order.orderNumber ?? "").trim().toLowerCase() === wanted)
    .toSorted((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
}

export function paginateOrdersList<T>(items: T[], limit: number, offset: number): T[] {
  return items.slice(offset, offset + limit);
}

/**
 * Verspaetete Bestellungen - Seite "Verspaetete Bestellungen" und Dashboard-Kacheln:
 * nicht abgeschlossen/storniert, bezahlt, spaetestes Lieferdatum (ohne Lieferdatum: Bestelldatum)
 * mehr als daysThreshold Tage vorbei. daysSinceOrder = Tage seit diesem Datum; am laengsten
 * ueberfaellige zuerst.
 */
export function selectDelayedOrders<T extends Order>(
  orders: T[],
  opts: { daysThreshold?: number; now?: Date } = {},
): Array<T & { daysSinceOrder: number }> {
  const now = opts.now ?? new Date();
  const thresholdDate = new Date(now.getTime() - (opts.daysThreshold ?? 3) * 24 * 60 * 60 * 1000);
  const referenceDate = (order: Order) => new Date(order.deliveryDateLatest || order.orderDate);
  return orders
    .filter((order) => {
      const isNotFinished = order.status !== "completed" && order.status !== "cancelled";
      const hasValidPayment = order.paymentStatus === "paid";
      return isNotFinished && hasValidPayment && referenceDate(order) < thresholdDate;
    })
    .map((order) => ({
      ...order,
      daysSinceOrder: Math.floor((now.getTime() - referenceDate(order).getTime()) / (1000 * 60 * 60 * 24)),
    }))
    .sort((a, b) => referenceDate(a).getTime() - referenceDate(b).getTime());
}

