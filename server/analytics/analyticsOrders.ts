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
 * - Versanddaten (shippingInfo) liefert das Bestell-Mapping: Zusatzfelder meta_shipped_* (schreibt
 *   METAorder beim Versand), sonst Tracking-Codes und Versanddatum der Shopware-Lieferungen. Die
 *   Live-Abfrage kannte nur die Zusatzfelder - die sind in keinem Mandanten befuellt, die
 *   Versandzeiten blieben leer.
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

export function selectAnalyticsOrders(orders: Order[], filter: AnalyticsOrderFilter): Order[] {
  const from = filter.dateFrom?.slice(0, 10);
  const to = filter.dateTo?.slice(0, 10);
  return filterOrdersBySalesChannels(orders, filter.salesChannelIds)
    .filter((o) => (!from || orderDay(o) >= from) && (!to || orderDay(o) <= to))
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
