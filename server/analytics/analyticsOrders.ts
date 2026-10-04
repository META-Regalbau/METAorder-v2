import type { Order } from "@shared/schema";
import type { ShopwareClient } from "../shopware/shopware";
import { filterOrdersBySalesChannels, getOrdersWithCache } from "../routes/routeHelpers";

/**
 * Bestellungen fuer die Statistik-Seite aus dem lokalen Bestell-Spiegel statt bei jedem Aufruf
 * alle Bestellungen samt Positionen live aus Shopware zu laden (Testing: 22 s -> 0,1 s).
 *
 * Bildet die fruehere Live-Abfrage (fetchOrdersForAnalytics) nach:
 * - Zeitraum: orderDate ist in Shopware ein Datum (im Spiegel Mitternacht UTC) - verglichen wird
 *   der Tag, dateFrom und dateTo jeweils einschliesslich.
 * - Versanddaten aus den Zusatzfeldern meta_shipped_* (schreibt METAorder beim Versand).
 * - Reihenfolge: neueste Bestellung zuerst.
 * Bewusste Unterschiede: Positionsbetraege kommen aus dem normalen Bestell-Mapping (die Live-
 * Abfrage behandelte Netto-Positionspreise als brutto); eine leere Kanalliste (Nutzer ohne Kanal)
 * bedeutet wie auf allen anderen Seiten "keine Bestellungen" statt "alle".
 */
export type AnalyticsOrderFilter = {
  dateFrom?: string;
  dateTo?: string;
  /** null = alle Kanaele (Admin), [] = keiner - wie getSalesChannelFilter */
  salesChannelIds: string[] | null;
};

const orderDay = (order: Order) => String(order.orderDate ?? "").slice(0, 10);

/** Versanddaten aus den Shopware-Zusatzfeldern (wie bisher die Live-Abfrage). */
export function withShippingInfo(order: Order): Order {
  const cf = (order.customFields ?? {}) as Record<string, any>;
  if (!cf.meta_shipped_date && !cf.meta_shipped_carrier && !cf.meta_shipped_tracking) {
    return { ...order, shippingInfo: undefined };
  }
  const shippingInfo: { carrier?: string; trackingNumber?: string; shippedDate?: string } = {};
  if (cf.meta_shipped_date) shippingInfo.shippedDate = cf.meta_shipped_date;
  if (cf.meta_shipped_carrier) shippingInfo.carrier = cf.meta_shipped_carrier;
  if (cf.meta_shipped_tracking) shippingInfo.trackingNumber = cf.meta_shipped_tracking;
  return { ...order, shippingInfo };
}

export function selectAnalyticsOrders(orders: Order[], filter: AnalyticsOrderFilter): Order[] {
  const from = filter.dateFrom?.slice(0, 10);
  const to = filter.dateTo?.slice(0, 10);
  return filterOrdersBySalesChannels(orders, filter.salesChannelIds)
    .filter((o) => (!from || orderDay(o) >= from) && (!to || orderDay(o) <= to))
    .map(withShippingInfo)
    .sort((a, b) => orderDay(b).localeCompare(orderDay(a)));
}

export async function loadAnalyticsOrders(
  client: ShopwareClient,
  tenantId: string | null | undefined,
  filter: AnalyticsOrderFilter,
): Promise<Order[]> {
  const { orders } = await getOrdersWithCache(client, tenantId ?? null);
  return selectAnalyticsOrders(orders, filter);
}
