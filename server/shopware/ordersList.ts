import type { Order, OrderStatus } from "@shared/schema";

export type OrdersListInvoiceFilter = "all" | "with" | "without" | "unsent";
export type OrdersListOrderNumberFilter = "all" | "mo";
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

    const orderNumberFilter = query.orderNumberFilter ?? "all";
    const matchesOrderNumber =
      orderNumberFilter === "all" || order.orderNumber.toUpperCase().startsWith("MO");

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

export function paginateOrdersList<T>(items: T[], limit: number, offset: number): T[] {
  return items.slice(offset, offset + limit);
}
