/**
 * Erkennung von Zusatzleistungs-Artikeln (Montage, Gabelstapler, Fixtermin, ...) über das
 * Shopware-Customfield "wdu_service_type" — geteilt zwischen montageLineItem.ts (Angebots-
 * Editor: Auswahlliste der Zusatzleistungen) und offerDetailBuilder.ts/offerConfigPdfBuilder.ts
 * (beide sortieren Zusatzleistungen immer als letzte Positionen).
 *
 * Eigene Datei statt in montageLineItem.ts, damit offerConfigPdfBuilder.ts (von dem
 * montageLineItem.ts computeMontageNet importiert) sie ohne zirkulären Import nutzen kann.
 */
export const SERVICE_TYPE_CUSTOM_FIELD = "wdu_service_type";

export function isServiceProductId(
  cache: { getProductById: (id: string) => { customFields?: Record<string, unknown> } | undefined },
  productId: string | null | undefined,
): boolean {
  if (!productId) return false;
  const product = cache.getProductById(String(productId));
  const serviceType = product?.customFields?.[SERVICE_TYPE_CUSTOM_FIELD];
  return typeof serviceType === "string" && serviceType.length > 0;
}
