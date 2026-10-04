import { useMemo, useState } from "react";
import { pageSlice } from "@/lib/pagination";

/**
 * Seiten fuer eine clientseitig gefilterte Liste, passend zu PaginationControls.
 * resetKey: aendert er sich (Filter, Suche), geht es auf Seite 1. Neu geladene Daten
 * (z. B. nach dem Umschalten "aktiv") behalten die Seite.
 */
export function usePagedRows<T>(rows: readonly T[], resetKey: string, initialPageSize = "50") {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setPage(1);
  }
  const slice = useMemo(() => pageSlice(rows, page, Number(pageSize)), [rows, page, pageSize]);
  return {
    ...slice,
    totalItems: rows.length,
    setPage,
    pageSize,
    setPageSize: (value: string) => {
      setPageSize(value);
      setPage(1);
    },
  };
}
