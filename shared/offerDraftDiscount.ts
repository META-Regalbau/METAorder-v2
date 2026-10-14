/**
 * Gesamtrabatt eines Angebotsentwurfs — eine Rechnung für Prüffenster (Rabatt-Ampel), Server-Prüfung
 * bei der Anlage und Entwurfs-PDF.
 * Angebotspreis je Position wie bei der Anlage: manueller (auch übernommener Rabatt-)Preis, sonst der
 * Preis, den der Kunde ohnehin zahlt. Bezugspreis: Kundenpreis beim Übernehmen (basePriceNet), sonst
 * Katalog. Ein Rabattvorschlag zählt erst, wenn er übernommen ist (seit 14.10.2026).
 */
export type OfferDraftDiscountItem = {
  quantity?: number | null;
  matchedProduct?: {
    catalogPrice?: number | null;
    suggestedPrice?: number | null;
    manualUnitPriceNet?: number | null;
    /** Kundenpreis, auf den ein übernommener Rabattvorschlag gerechnet wurde */
    basePriceNet?: number | null;
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
    const reference = item.matchedProduct?.basePriceNet ?? item.matchedProduct?.catalogPrice ?? 0;
    const price = item.matchedProduct?.manualUnitPriceNet ?? reference;
    totalCatalogValue += reference * qty;
    totalOfferValue += price * qty;
  }
  const discountPercent =
    totalCatalogValue > 0 ? Math.round((1 - totalOfferValue / totalCatalogValue) * 10000) / 100 : 0;
  return { totalCatalogValue, totalOfferValue, discountPercent };
}
