/** Spiegelt server/lineItemProductScreening.recomputeOfferOverallConfidence (ohne Server-Import). */
export function recomputeOfferOverallConfidence(
  items: Array<{ confidence: number; productScreen?: { likelihood: string } }>
): number {
  const eligible = items.filter((i) => i.productScreen?.likelihood !== "unlikely_product");
  const pool = eligible.length > 0 ? eligible : items;
  if (pool.length === 0) return 0;
  return Math.round(pool.reduce((s, i) => s + (i.confidence || 0), 0) / pool.length);
}

/** Nach bewusster Alternativwahl im UI: menschlich bestätigt = 100 % / matched. */
export const USER_CONFIRMED_ALTERNATIVE_CONFIDENCE = 100;

export function normalizeProductId(id: string | undefined | null): string {
  return (id ?? "").replace(/-/g, "").toLowerCase();
}

/** Einzelposition aus offer draft matchingResults (locker typisiert für Client). */
export type OfferDraftMatchItem = {
  alternativeMatches?: Array<{
    id: string;
    productNumber: string;
    name: string;
    price?: number;
    confidence: number;
    reasoning?: string;
  }>;
  matchedProduct?: {
    id: string;
    productNumber?: string;
    name?: string;
    price?: number;
    confidence?: number;
    catalogPrice?: number;
    suggestedPrice?: number;
    suggestedDiscount?: number;
  } | null;
  confidence?: number;
  status?: string;
  quantity?: number;
  bundle?: unknown;
  productScreen?: { likelihood?: string };
  /** Persistiert nach manueller Bestätigung im Review */
  userConfirmedMatch?: boolean;
  [key: string]: unknown;
};

export type AlternativeSelectionInput = {
  selectedProducts: Record<number, string>;
  /** Zeilenindex → Nutzer hat Zuordnung/Alternative im UI bestätigt */
  confirmedLines?: Record<number, boolean>;
};

function buildUserConfirmedMatchItem(
  item: OfferDraftMatchItem,
  product: {
    id: string;
    productNumber: string;
    name: string;
    price?: number;
  }
): OfferDraftMatchItem {
  return {
    ...item,
    userConfirmedMatch: true,
    matchedProduct: {
      id: product.id,
      productNumber: product.productNumber,
      name: product.name,
      price: product.price,
      confidence: USER_CONFIRMED_ALTERNATIVE_CONFIDENCE,
      catalogPrice: product.price ?? item.matchedProduct?.catalogPrice,
      suggestedPrice: item.matchedProduct?.suggestedPrice,
      suggestedDiscount: item.matchedProduct?.suggestedDiscount,
    },
    confidence: USER_CONFIRMED_ALTERNATIVE_CONFIDENCE,
    status: "matched",
  };
}

/**
 * Wendet UI-Auswahl (Alternativen + explizite Bestätigung) auf Positionsliste an.
 * Erst nach confirmedLines[index] wird 100 % gesetzt — reines Vorbelegen reicht nicht.
 */
export function applyAlternativeSelectionsToOfferMatchingItems(
  items: OfferDraftMatchItem[] | undefined,
  input: AlternativeSelectionInput
): OfferDraftMatchItem[] {
  if (!items) return [];
  const { selectedProducts, confirmedLines = {} } = input;

  return items.map((item, index) => {
    const isConfirmed = Boolean(confirmedLines[index] || item.userConfirmedMatch);
    if (!isConfirmed) return item;

    const selectedProductId = selectedProducts[index] ?? item.matchedProduct?.id;
    if (!selectedProductId) return item;

    const selectedNorm = normalizeProductId(selectedProductId);

    if (item.alternativeMatches?.length) {
      const selectedAlt = item.alternativeMatches.find(
        (alt) => normalizeProductId(alt.id) === selectedNorm
      );
      if (selectedAlt) {
        return buildUserConfirmedMatchItem(item, {
          id: selectedAlt.id,
          productNumber: selectedAlt.productNumber,
          name: selectedAlt.name,
          price: selectedAlt.price,
        });
      }
    }

    if (item.matchedProduct && normalizeProductId(item.matchedProduct.id) === selectedNorm) {
      return buildUserConfirmedMatchItem(item, {
        id: item.matchedProduct.id,
        productNumber: item.matchedProduct.productNumber ?? "",
        name: item.matchedProduct.name ?? String(item.extractedProductName ?? ""),
        price: item.matchedProduct.price,
      });
    }

    return item;
  });
}

export function applyAlternativeSelectionsToMatchingResults(
  matchingResults: { items?: OfferDraftMatchItem[]; overallConfidence?: number; [key: string]: unknown } | null | undefined,
  input: AlternativeSelectionInput
): typeof matchingResults {
  if (!matchingResults?.items) return matchingResults;
  const items = applyAlternativeSelectionsToOfferMatchingItems(matchingResults.items, input);
  const overallConfidence = recomputeOfferOverallConfidence(
    items as Array<{ confidence: number; productScreen?: { likelihood: string } }>
  );
  return {
    ...matchingResults,
    items,
    overallConfidence,
  };
}

/** Ob eine Position für die Angebotserstellung ausreichend zugeordnet ist (inkl. bewusster Alternativwahl). */
export function isOfferLineReadyForCreate(
  item: OfferDraftMatchItem,
  lineIndex: number,
  input: AlternativeSelectionInput
): boolean {
  if (item.bundle) return true;
  if (!item.matchedProduct?.id && !input.selectedProducts[lineIndex]) return false;
  if (item.userConfirmedMatch || input.confirmedLines?.[lineIndex]) return true;
  const picked = input.selectedProducts[lineIndex];
  const userPickedAlt = Boolean(
    picked && item.alternativeMatches?.some((a) => normalizeProductId(a.id) === normalizeProductId(picked))
  );
  if (userPickedAlt && input.confirmedLines?.[lineIndex]) return true;
  return item.status === "matched" || item.status === "uncertain";
}

/** Nach Klick auf Alternative oder „Zuordnung bestätigen“. */
export function confirmAlternativeSelection(
  lineIndex: number,
  productId: string,
  current: AlternativeSelectionInput
): AlternativeSelectionInput {
  return {
    selectedProducts: { ...current.selectedProducts, [lineIndex]: productId },
    confirmedLines: { ...(current.confirmedLines ?? {}), [lineIndex]: true },
  };
}

/** Initialzustand aus gespeichertem Draft (Persistenz userConfirmedMatch). */
export function buildAlternativeSelectionFromDraftItems(
  items: OfferDraftMatchItem[] | undefined
): AlternativeSelectionInput {
  const selectedProducts: Record<number, string> = {};
  const confirmedLines: Record<number, boolean> = {};
  items?.forEach((item, index) => {
    if (item.matchedProduct?.id) {
      selectedProducts[index] = item.matchedProduct.id;
    }
    if (item.userConfirmedMatch) {
      confirmedLines[index] = true;
    }
  });
  return { selectedProducts, confirmedLines };
}
