import type { Order, OrderItem, OrderProfitabilitySummary } from "@shared/schema";

/**
 * Ohne Recht „DB-Werte sehen“ (viewMarginDetails) bleibt von der DB-Analyse nur die Ampel:
 * Herstellkosten, DB1 und Margen-Prozente werden schon auf dem Server entfernt, damit sie auch
 * in der Netzwerkantwort nicht auftauchen.
 */

export function hideItemMarginDetails<T extends OrderItem>(item: T): T {
  if (item.crmVerdict === undefined && item.herstellpreisNet === undefined) return item;
  return {
    ...item,
    herstellpreisNet: null,
    herstellkostenTotal: null,
    db1Abs: null,
    marginPercent: null,
    marginOnRevenuePercent: null,
  };
}

export function hideSummaryMarginDetails<T extends OrderProfitabilitySummary>(summary: T): T {
  return {
    ...summary,
    herstellkostenTotal: null,
    db1Total: null,
    marginPercent: null,
    marginOnRevenuePercent: null,
  };
}

export function hideOrderMarginDetails<T extends Order>(order: T): T {
  return {
    ...order,
    items: order.items.map(hideItemMarginDetails),
    ...(order.profitability ? { profitability: hideSummaryMarginDetails(order.profitability) } : {}),
  };
}

/** Bestellungen je nach Recht: unverändert oder nur mit Ampel. */
export function applyOrderMarginVisibility<T extends Order>(orders: T[], canViewDetails: boolean): T[] {
  return canViewDetails ? orders : orders.map(hideOrderMarginDetails);
}

/** CRM-Kundenpreise: Marge in % nur mit Recht, die Ampel bleibt. */
export function applyCustomerPriceMarginVisibility<T extends { herstellMarginPercent: number | null }>(
  prices: T[],
  canViewDetails: boolean,
): T[] {
  return canViewDetails ? prices : prices.map((price) => ({ ...price, herstellMarginPercent: null }));
}
