/** Link auf die DB-Berechnung einer einzelnen Bestellung (Bestell-DB-Analyse). */
export function orderProfitabilityHref(orderNumber: string): string {
  return `/order-profitability-analysis?orderNumber=${encodeURIComponent(orderNumber)}`;
}

/** Link auf die DB-Berechnung eines einzelnen Angebots (Bestell-DB-Analyse). */
export function offerProfitabilityHref(offerNumber: string): string {
  return `/order-profitability-analysis?offerNumber=${encodeURIComponent(offerNumber)}`;
}
