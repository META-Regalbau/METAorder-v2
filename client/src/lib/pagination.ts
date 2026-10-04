/**
 * Seitenweise Anzeige einer vollstaendig geladenen Liste (Filter, Summen und "alle markieren"
 * arbeiten weiter auf der ganzen Liste). Die Seite wird auf den gueltigen Bereich begrenzt,
 * z. B. wenn ein Neuladen Zeilen entfernt oder ein Filter weniger Treffer liefert.
 */
export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, totalPages };
}
