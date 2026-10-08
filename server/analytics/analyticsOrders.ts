import type { Order } from "@shared/schema";
import { matchesOrderNumberFilter, parseOrderNumberFilter, type OrderNumberFilter } from "@shared/orderNumberFilter";
import type { Request } from "express";
import type { ShopwareClient } from "../shopware/shopware";
import { dedupeOrdersByNumber, filterOrdersBySalesChannels, getOrdersWithCache, getSalesChannelFilter, narrowSalesChannelFilter } from "../routes/routeHelpers";

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
 * - Mehrfach vergebene Bestellnummern zaehlen einmal - wie bei Versand, Export und verspaeteten
 *   Bestellungen die zuletzt geaenderte Bestellung (dedupeOrdersByNumber). Bis Oktober 2026 zaehlten
 *   alle Kopien (Live: 36 doppelt angelegte Bestellungen, rund 597.000 Euro brutto).
 * Bewusste Unterschiede: Positionsbetraege kommen aus dem normalen Bestell-Mapping (die Live-
 * Abfrage behandelte Netto-Positionspreise als brutto); eine leere Kanalliste (Nutzer ohne Kanal)
 * bedeutet wie auf allen anderen Seiten "keine Bestellungen" statt "alle".
 */
export type AnalyticsOrderFilter = {
  dateFrom?: string;
  dateTo?: string;
  /** null = alle Kanaele (Admin), [] = keiner - wie getSalesChannelFilter */
  salesChannelIds: string[] | null;
  /** Shop-Bestellungen (MO...) oder durchgeschleuste Bestellungen ohne MO; Standard alle */
  orderNumberFilter?: OrderNumberFilter;
  /** Stornierte Bestellungen (Status cancelled) weglassen; Standard: einbeziehen */
  excludeCancelled?: boolean;
};

const orderDay = (order: Order) => String(order.orderDate ?? "").slice(0, 10);

export function selectAnalyticsOrders(orders: Order[], filter: AnalyticsOrderFilter): Order[] {
  const from = filter.dateFrom?.slice(0, 10);
  const to = filter.dateTo?.slice(0, 10);
  const orderNumberFilter = filter.orderNumberFilter ?? "all";
  return filterOrdersBySalesChannels(dedupeOrdersByNumber(orders), filter.salesChannelIds)
    .filter((o) => (!from || orderDay(o) >= from) && (!to || orderDay(o) <= to))
    .filter((o) => matchesOrderNumberFilter(o.orderNumber, orderNumberFilter))
    .filter((o) => !filter.excludeCancelled || o.status !== "cancelled")
    .sort((a, b) => orderDay(b).localeCompare(orderDay(a)));
}

/**
 * Filter der Statistik-Seite aus der Anfrage. Kanaele: Auswahl des Nutzers innerhalb seiner
 * Berechtigung (bis Oktober 2026 wurde die Auswahl ignoriert, der Kanalfilter wirkte nicht).
 */
export async function analyticsFilterFromRequest(req: Request): Promise<AnalyticsOrderFilter> {
  const str = (key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : undefined);
  return {
    dateFrom: str("dateFrom"),
    dateTo: str("dateTo"),
    salesChannelIds: narrowSalesChannelFilter(await getSalesChannelFilter(req), req.query.salesChannelIds),
    orderNumberFilter: parseOrderNumberFilter(str("orderNumberFilter")),
    excludeCancelled: str("excludeCancelled") === "true",
  };
}

export async function loadAnalyticsOrders(
  client: ShopwareClient,
  tenantId: string | null | undefined,
  filter: AnalyticsOrderFilter,
): Promise<Order[]> {
  const { orders } = await getOrdersWithCache(client, tenantId ?? null);
  return selectAnalyticsOrders(orders, filter);
}
