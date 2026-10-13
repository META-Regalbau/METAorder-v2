/**
 * Angebotsentwürfe zeigen und rechnen mit matchedProduct.catalogPrice / suggestedPrice
 * (generateSmartPricing). Positionen, die erst nach der Preisberechnung einen Treffer bekommen
 * (KI-Vorschlag, Konfigurator, CLIP-Maße, „Nochmal prüfen“), haben nur price → Katalogpreis
 * nachtragen, damit Prüffenster und DB einen Preis haben. Ein Vorschlagspreis wird nicht erfunden.
 */
type Item = { matchedProduct?: { price?: number; catalogPrice?: number } | null };

export function fillMissingOfferCatalogPrices(items: Item[] | undefined | null): number {
  let filled = 0;
  for (const item of items ?? []) {
    const product = item.matchedProduct;
    if (!product || typeof product.catalogPrice === "number" || typeof product.price !== "number") continue;
    product.catalogPrice = product.price;
    filled++;
  }
  return filled;
}
