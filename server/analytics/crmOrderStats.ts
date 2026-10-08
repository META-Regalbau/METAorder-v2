import type { Order } from "@shared/schema";
import { matchesOrderNumberFilter, type OrderNumberFilter } from "@shared/orderNumberFilter";

/**
 * Bestellkennzahlen je Kunde in der CRM-Liste, getrennt nach Art der Bestellnummer. Die Liste ist
 * je Mandant zwischengespeichert; deshalb werden alle Varianten beim Aufbau gerechnet und erst bei
 * der Antwort ausgewaehlt. Ohne Trennung trugen die beiden Muster-Kunden der durchgeschleusten
 * Bestellungen (musterkunde-de@ / musterkunde-de2@) rund 54 Mio. Euro Umsatz (Live 2026).
 */
export type CrmOrderStats = {
  totalOrders: number;
  totalRevenue: number;
  lastOrderNumber: string | null;
  lastOrderDate: string | null;
};

export type CrmOrderStatsByFilter = Partial<Record<OrderNumberFilter, CrmOrderStats>>;

const FILTERS: OrderNumberFilter[] = ["all", "mo", "non-mo"];

export function addOrderToCrmStats(statsByFilter: CrmOrderStatsByFilter, order: Order): void {
  for (const filter of FILTERS) {
    if (!matchesOrderNumberFilter(order.orderNumber, filter)) continue;
    const stats = (statsByFilter[filter] ??= { totalOrders: 0, totalRevenue: 0, lastOrderNumber: null, lastOrderDate: null });
    stats.totalOrders += 1;
    stats.totalRevenue += Number(order.totalAmount || 0);
    if (!stats.lastOrderDate || new Date(order.orderDate) > new Date(stats.lastOrderDate)) {
      stats.lastOrderDate = order.orderDate;
      stats.lastOrderNumber = order.orderNumber;
    }
  }
}

/**
 * Kennzahlen eines Listeneintrags fuer den gewaehlten Filter. Eintraege ohne Bestellungen (nur
 * Ticket, Kundenstamm, Sonderpreise) behalten ihre Angaben - etwa die Bestellnummer aus dem Ticket.
 */
export function pickCrmOrderStats<T extends CrmOrderStats & { orderStatsByFilter?: CrmOrderStatsByFilter }>(
  item: T,
  filter: OrderNumberFilter,
): Omit<T, "orderStatsByFilter"> {
  const { orderStatsByFilter, ...rest } = item;
  if (filter === "all" || !orderStatsByFilter?.all) return rest;
  const stats = orderStatsByFilter[filter];
  return {
    ...rest,
    totalOrders: stats?.totalOrders ?? 0,
    totalRevenue: stats?.totalRevenue ?? 0,
    lastOrderNumber: stats?.lastOrderNumber ?? null,
    lastOrderDate: stats?.lastOrderDate ?? null,
  };
}
