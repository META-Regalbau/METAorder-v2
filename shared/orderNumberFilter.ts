/**
 * Filter nach Art der Bestellnummer (Bestellliste und Statistik).
 * Shop-Bestellungen tragen "MO" am Anfang; ohne MO laufen vor allem die durchgeschleusten
 * Bestellungen im Haendlerportal (reine Ziffern, Live 2026: rund 1.600 Bestellungen, 54 Mio. Euro
 * brutto), dazu IDS- und AT-Nummernkreise.
 */
export type OrderNumberFilter = "all" | "mo" | "non-mo";

export function parseOrderNumberFilter(raw: unknown): OrderNumberFilter {
  return raw === "mo" || raw === "non-mo" ? raw : "all";
}

export function isMoOrderNumber(orderNumber: string | null | undefined): boolean {
  return String(orderNumber ?? "").trim().toUpperCase().startsWith("MO");
}

export function matchesOrderNumberFilter(orderNumber: string | null | undefined, filter: OrderNumberFilter): boolean {
  if (filter === "mo") return isMoOrderNumber(orderNumber);
  if (filter === "non-mo") return !isMoOrderNumber(orderNumber);
  return true;
}
