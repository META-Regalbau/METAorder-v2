/**
 * Manueller Netto-Stückpreis je Entwurfsposition (Prüffenster). Wird bei der Anlage an Shopware
 * übergeben (manualUnitPriceNet hat dort Vorrang) und fließt sofort in die DB-Berechnung.
 */

export const MAX_MANUAL_UNIT_PRICE_NET = 10_000_000;

export type ManualLinePriceResult<T> =
  | { ok: true; items: T[] }
  | { ok: false; error: string; statusCode: number };

type DraftItemWithProduct = {
  matchedProduct?: Record<string, unknown> & {
    manualUnitPriceNet?: number;
    manualPriceChangedBy?: string;
    manualPriceChangedAt?: string;
    /** Übernommener Rabattvorschlag: Kundenpreis als Bezug und Rabatt in % */
    basePriceNet?: number;
    acceptedDiscountPercent?: number;
  } | null;
  bundle?: unknown;
};

/**
 * Setzt (Zahl) oder entfernt (null) den manuellen Preis einer Position und gibt die neue
 * Positionsliste zurück; die Eingabe bleibt unverändert.
 */
export function applyManualLinePrice<T extends DraftItemWithProduct>(
  items: T[],
  index: number,
  unitPriceNet: number | null,
  changedBy: string,
  now = new Date(),
): ManualLinePriceResult<T> {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    return { ok: false, error: "Position nicht gefunden", statusCode: 404 };
  }
  const item = items[index]!;
  if (item.bundle) {
    return { ok: false, error: "Für Sets lässt sich kein eigener Preis setzen", statusCode: 400 };
  }
  if (!item.matchedProduct) {
    return { ok: false, error: "Position ist keinem Artikel zugeordnet", statusCode: 400 };
  }
  if (
    unitPriceNet !== null &&
    (!Number.isFinite(unitPriceNet) || unitPriceNet < 0 || unitPriceNet > MAX_MANUAL_UNIT_PRICE_NET)
  ) {
    return { ok: false, error: "Ungültiger Preis", statusCode: 400 };
  }

  // Von Hand gesetzt: kein übernommener Rabattvorschlag mehr; zurückgesetzt: auch kein Bezugspreis
  const { manualUnitPriceNet: _old, manualPriceChangedBy: _by, manualPriceChangedAt: _at, acceptedDiscountPercent: _acc, basePriceNet, ...rest } =
    item.matchedProduct;
  const matchedProduct =
    unitPriceNet === null
      ? rest
      : {
          ...rest,
          ...(typeof basePriceNet === "number" ? { basePriceNet } : {}),
          manualUnitPriceNet: Math.round(unitPriceNet * 100) / 100,
          manualPriceChangedBy: changedBy,
          manualPriceChangedAt: now.toISOString(),
        };
  const next = items.slice();
  next[index] = { ...item, matchedProduct };
  return { ok: true, items: next };
}

const MANUAL_PRICE_FIELDS = [
  "manualUnitPriceNet",
  "manualPriceChangedBy",
  "manualPriceChangedAt",
  "basePriceNet",
  "acceptedDiscountPercent",
] as const;

/**
 * Rabattvorschläge übernehmen (Angebotsentwurf): Preis = Kundenpreis × (1 − Vorschlag %).
 * Nur Positionen mit Vorschlag, ohne manuellen Preis und mit bekanntem Kundenpreis.
 */
export function acceptSuggestedDiscounts<T extends DraftItemWithProduct>(
  items: T[],
  basePriceByIndex: Map<number, number>,
  changedBy: string,
  indices?: number[],
  now = new Date(),
): { items: T[]; accepted: Array<{ index: number; discountPercent: number; basePriceNet: number; unitPriceNet: number }> } {
  const wanted = indices ? new Set(indices) : null;
  const accepted: Array<{ index: number; discountPercent: number; basePriceNet: number; unitPriceNet: number }> = [];
  const next = items.map((item, index) => {
    const product = item.matchedProduct;
    if ((wanted && !wanted.has(index)) || item.bundle || !product) return item;
    const discount = Number((product as { suggestedDiscount?: unknown }).suggestedDiscount);
    const base = basePriceByIndex.get(index);
    if (!(discount > 0 && discount < 100) || typeof product.manualUnitPriceNet === "number" || !base || base <= 0) return item;
    const unitPriceNet = Math.round(base * (1 - discount / 100) * 100) / 100;
    accepted.push({ index, discountPercent: discount, basePriceNet: base, unitPriceNet });
    return {
      ...item,
      matchedProduct: {
        ...product,
        manualUnitPriceNet: unitPriceNet,
        manualPriceChangedBy: `${changedBy} (Rabattvorschlag ${discount} %)`,
        manualPriceChangedAt: now.toISOString(),
        basePriceNet: base,
        acceptedDiscountPercent: discount,
      },
    };
  });
  return { items: next, accepted };
}

/**
 * Allgemeines Speichern des Entwurfs (Menge, Alternativen, …) schickt die ganze Positionsliste aus
 * dem Stand des Prüffensters, der älter sein kann als ein gerade gesetzter Preis. Den manuellen
 * Preis ändert deshalb nur line-price: Steht an derselben Stelle noch derselbe Artikel, gilt der
 * gespeicherte Stand; bei einem anderen Artikel entfällt er.
 */
export function preserveManualLinePrices<T extends DraftItemWithProduct>(existing: T[] | undefined, incoming: T[]): T[] {
  return incoming.map((item, index) => {
    const after = item.matchedProduct;
    if (!after) return item;
    const before = existing?.[index]?.matchedProduct;
    const stripped: Record<string, unknown> = { ...after };
    for (const field of MANUAL_PRICE_FIELDS) delete stripped[field];
    if (before && before.id === after.id) {
      for (const field of MANUAL_PRICE_FIELDS) {
        if (before[field] !== undefined) stripped[field] = before[field];
      }
    }
    return { ...item, matchedProduct: stripped as typeof after };
  });
}
