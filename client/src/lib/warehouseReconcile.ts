import type { QueryClient } from "@tanstack/react-query";

/**
 * Bestaende- und Abgleich-Reiter teilen eine Abfrage: alle Artikel, der Abgleich filtert die
 * Abweichungen selbst (isStockReconcileDiff). Frueher lud jeder Reiter seine eigene Liste -
 * in Testing zweimal ~7,7 MB.
 */
export const stockReconcileQueryKey = ["/api/erp/stock/reconcile", "all"] as const;
export const stockReconcileUrl = "/api/erp/stock/reconcile?onlyDiffs=false";

/** Antwort von "Spiegel aktualisieren" (alle Zeilen) direkt anzeigen - die Abfrage veraltet nie von selbst. */
export function storeRefreshedReconcile<T>(queryClient: QueryClient, allRowsResult: T) {
  queryClient.setQueryData(stockReconcileQueryKey, allRowsResult);
}

/** Bezeichnungen, die die Abgleich-Liste schon mitbringt (Artikel im Shopware-Spiegel haben einen Namen). */
export function reconcileLabelMap<L extends { name: string | null }>(
  rows: ReadonlyArray<{ productNumber: string; label?: L | null }>,
): Map<string, L> {
  const map = new Map<string, L>();
  for (const r of rows) if (r.label?.name) map.set(r.productNumber, r.label);
  return map;
}

/**
 * Artikelnummern, deren Bezeichnung einzeln nachgeladen werden muss (/api/erp/product-labels).
 * Solange die Abgleich-Liste noch laedt: keine - sonst wuerden alle ~8.200 doppelt geholt.
 */
export function productNumbersNeedingLabels(
  numbers: readonly string[],
  known: ReadonlyMap<string, unknown>,
  waitingForReconcile: boolean,
): string[] {
  if (waitingForReconcile) return [];
  return numbers.filter((pn) => !known.has(pn));
}
