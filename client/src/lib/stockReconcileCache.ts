import type { QueryClient } from "@tanstack/react-query";

/** Bestaende-Reiter laedt alle Artikel, Abgleich-Reiter nur Abweichungen - zwei Cache-Eintraege. */
export type StockReconcileMode = "all" | "diffs";
export const stockReconcileQueryKey = (mode: StockReconcileMode) => ["/api/erp/stock/reconcile", mode] as const;

/**
 * Antwort von "Spiegel aktualisieren" (nur Abweichungen) in den Abgleich-Reiter uebernehmen;
 * der Bestaende-Reiter laedt beim naechsten Anzeigen neu. Vorher landete die Antwort unter
 * einem Schluessel ohne Modus, den keine Abfrage liest - die Tabelle blieb alt (staleTime: Infinity).
 */
export function storeRefreshedReconcile<T>(queryClient: QueryClient, diffsResult: T) {
  queryClient.setQueryData(stockReconcileQueryKey("diffs"), diffsResult);
  void queryClient.invalidateQueries({ queryKey: stockReconcileQueryKey("all"), exact: true });
}
