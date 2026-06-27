/**
 * Heuristik: Modell splittet Tabellenpositionen (Zeile 1: Pos./GTIN/Name, Zeile 2: Menge + Preise)
 * in zwei lineItems. Nachbearbeitung verschmilzt typische Fälle, ohne echte zweizeilige Artikel
 * aggressiv zu vermischen (nächste Zeile muss wie „Preiszeile“ aussehen).
 */

export type CommercialLooseLineItem = {
  quantity?: number;
  extractedProductName?: string;
  extractedProductNumber?: string;
  extractedPositionNumber?: string;
  extractedPrice?: number;
};

function digitRunLengths(s: string): number[] {
  return (s.match(/\d+/g) ?? []).map((x) => x.length);
}

/** Echte GTIN/EAN-Länge im String (nur Ziffern zählen). */
function hasArticleDigitId(name: string, num?: string): boolean {
  const fromNum = (num ?? "").replace(/\D/g, "");
  if (fromNum.length >= 8 && fromNum.length <= 14) return true;
  const runs = digitRunLengths(name);
  return runs.some((l) => l >= 8 && l <= 14);
}

/** Produktname besteht überwiegend aus Preis-/Zahlenmustern (z. B. „160,06 3.041,14“). */
function looksLikePriceOnlyProductName(name: string | undefined): boolean {
  if (!name?.trim()) return true;
  const t = name.trim();
  const nonPrice = t.replace(/[\d\s.,]/g, "");
  if (nonPrice.length <= 2 && t.length >= 4) return true;
  // Zwei DE- oder EN-ähnliche Geldbeträge hintereinander
  if (/^\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?\s+\d{1,3}(?:\.\d{3})*(?:,\d{2})?\s*$/.test(t)) return true;
  return false;
}

/** extractedProductNumber offensichtlich aus Preisfragmenten (keine 8–14-stellige Artikelnummer). */
function looksLikeGarbageProductNumber(num: string | undefined, name: string | undefined): boolean {
  if (!num?.trim()) return false;
  const digits = num.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 14) return false;
  if (/[,.\s]/.test(num) && digits.length <= 6) return true;
  if (looksLikePriceOnlyProductName(name)) return true;
  return false;
}

function shouldMergeSplitPair(cur: CommercialLooseLineItem, next: CommercialLooseLineItem): boolean {
  const cq = typeof cur.quantity === "number" ? cur.quantity : NaN;
  const nq = typeof next.quantity === "number" ? next.quantity : NaN;
  if (!Number.isFinite(cq) || !Number.isFinite(nq)) return false;
  if (nq <= cq) return false;
  if (cq > 5) return false;
  if (!hasArticleDigitId(cur.extractedProductName ?? "", cur.extractedProductNumber)) return false;
  if (looksLikePriceOnlyProductName(cur.extractedProductName)) return false;
  const nextNamePricey = looksLikePriceOnlyProductName(next.extractedProductName);
  const nextNumGarbage = looksLikeGarbageProductNumber(next.extractedProductNumber, next.extractedProductName);
  if (!nextNamePricey && !nextNumGarbage) return false;
  if (typeof next.extractedPrice === "number" && next.extractedPrice > 0) return true;
  if (nextNamePricey && nq >= 2) return true;
  return false;
}

function mergePair(cur: CommercialLooseLineItem, next: CommercialLooseLineItem): CommercialLooseLineItem {
  return {
    ...cur,
    quantity: next.quantity,
    extractedPrice: next.extractedPrice ?? cur.extractedPrice,
    extractedProductName: cur.extractedProductName,
    extractedProductNumber: cur.extractedProductNumber,
  };
}

export function mergeSuspectedSplitTableLineItems(
  lineItems: CommercialLooseLineItem[]
): CommercialLooseLineItem[] {
  if (!Array.isArray(lineItems) || lineItems.length < 2) return lineItems;

  let curList = lineItems;
  for (let pass = 0; pass < 4; pass++) {
    const out: CommercialLooseLineItem[] = [];
    let i = 0;
    while (i < curList.length) {
      const cur = curList[i]!;
      const next = curList[i + 1];
      if (next && shouldMergeSplitPair(cur, next)) {
        out.push(mergePair(cur, next));
        i += 2;
      } else {
        out.push({ ...cur });
        i += 1;
      }
    }
    if (out.length === curList.length) return out;
    curList = out;
  }
  return curList;
}

export function mergeSuspectedSplitTableLineItemsInto<T extends { lineItems?: CommercialLooseLineItem[] }>(
  extracted: T
): void {
  if (!extracted.lineItems?.length) return;
  extracted.lineItems = mergeSuspectedSplitTableLineItems(extracted.lineItems);
}
