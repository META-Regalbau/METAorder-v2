/** Link auf die DB-Berechnung einer einzelnen Bestellung (Bestell-DB-Analyse). */
export function orderProfitabilityHref(orderNumber: string): string {
  return `/order-profitability-analysis?orderNumber=${encodeURIComponent(orderNumber)}`;
}
