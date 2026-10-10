/**
 * Gesamtrabatt eines Angebotsentwurfs gegenüber dem Katalog — eine Rechnung für Prüffenster
 * (Rabatt-Ampel), Server-Prüfung bei der Anlage und Entwurfs-PDF.
 * Angebotspreis je Position wie bei der Anlage: manueller Preis, sonst Vorschlag, sonst Katalog.
 */
export type OfferDraftDiscountItem = {
  quantity?: number | null;
  matchedProduct?: {
    catalogPrice?: number | null;
    suggestedPrice?: number | null;
    manualUnitPriceNet?: number | null;
  } | null;
};

export type OfferDraftDiscountTotals = {
  totalCatalogValue: number;
  totalOfferValue: number;
  /** 0–100, auf zwei Stellen gerundet; 0 ohne Katalogwert */
  discountPercent: number;
};

export function computeOfferDraftDiscountTotals(items: OfferDraftDiscountItem[]): OfferDraftDiscountTotals {
  let totalCatalogValue = 0;
  let totalOfferValue = 0;
  for (const item of items) {
    const qty = item.quantity ?? 1;
    const catalog = item.matchedProduct?.catalogPrice ?? 0;
    const price = item.matchedProduct?.manualUnitPriceNet ?? item.matchedProduct?.suggestedPrice ?? catalog;
    totalCatalogValue += catalog * qty;
    totalOfferValue += price * qty;
  }
  const discountPercent =
    totalCatalogValue > 0 ? Math.round((1 - totalOfferValue / totalCatalogValue) * 10000) / 100 : 0;
  return { totalCatalogValue, totalOfferValue, discountPercent };
}
