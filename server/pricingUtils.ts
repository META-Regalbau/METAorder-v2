/** Erster Preiseintrag aus Shopware-Preisfeld (Array oder currencyId-Map). */
export function firstShopwarePriceEntry(collection: unknown): Record<string, unknown> | null {
  if (Array.isArray(collection) && collection.length > 0) {
    const first = collection[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  if (collection && typeof collection === "object") {
    for (const value of Object.values(collection as Record<string, unknown>)) {
      if (value && typeof value === "object") return value as Record<string, unknown>;
    }
  }
  return null;
}

/** Netto-Preis aus Shopware price/purchasePrices (Array oder Map). */
export function parseShopwarePriceCollectionNet(collection: unknown, taxRate = 19): number | null {
  const entry = firstShopwarePriceEntry(collection);
  if (!entry) return null;
  const net = typeof entry.net === "number" ? entry.net : null;
  const gross = typeof entry.gross === "number" ? entry.gross : null;
  if (net != null) return net;
  if (gross != null) return gross / (1 + taxRate / 100);
  return null;
}

/** Lookup-Keys für Produkt-UUIDs (mit/ohne Bindestriche). */
export function productIdLookupKeys(id: string): string[] {
  const raw = String(id).trim();
  const hex = raw.replace(/-/g, "").toLowerCase();
  const hyphenated =
    hex.length === 32
      ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      : raw;
  return [...new Set([raw, hex, hyphenated])];
}

/** Berechnet Rabatt in Prozent aus Listen- und Kundenpreis (netto). */
export function computeDiscountPercent(
  priceNet: number | null | undefined,
  listPriceNet: number | null | undefined,
): number | null {
  if (priceNet == null || listPriceNet == null || listPriceNet <= 0 || priceNet >= listPriceNet) {
    return null;
  }
  return Math.round((1 - priceNet / listPriceNet) * 1000) / 10;
}

/**
 * Rabatt relativ zum Shopware-Einkaufspreis (Listenpreis netto = purchasePrices):
 * (Verkaufspreis − Kundenpreis) / Einkaufspreis.
 */
export function computeDiscountPercentFromPurchaseBase(
  customerPriceNet: number | null | undefined,
  catalogPriceNet: number | null | undefined,
  listPriceNet: number | null | undefined,
): number | null {
  if (customerPriceNet == null || listPriceNet == null || listPriceNet <= 0) return null;

  if (catalogPriceNet != null && catalogPriceNet > customerPriceNet) {
    return Math.round(((catalogPriceNet - customerPriceNet) / listPriceNet) * 1000) / 10;
  }

  return Math.round(((customerPriceNet - listPriceNet) / listPriceNet) * 1000) / 10;
}

/**
 * Prozentuale Differenz eines Kundenpreises relativ zu einer Basis (netto).
 * Positiv = Kundenpreis liegt unter der Basis (Nachlass), negativ = darüber.
 * Wird für den Vergleich Kundenpreis ↔ erweiterter Preis (Staffelpreis) genutzt.
 */
export function computePriceDifferencePercent(
  customerPriceNet: number | null | undefined,
  basePriceNet: number | null | undefined,
): number | null {
  if (customerPriceNet == null || basePriceNet == null || basePriceNet <= 0) return null;
  return Math.round(((basePriceNet - customerPriceNet) / basePriceNet) * 1000) / 10;
}

const DISCOUNT_CUSTOM_FIELD_KEYS = [
  "b2b_discount_rate",
  "b2b_discountRate",
  "b2b_customer_discount_rate",
  "b2b_customer_discountRate",
  "discountRate",
  "discount_rate",
  "discountPercent",
  "discount_percent",
  "b2b_max_discount_rate",
  "b2b_max_discountRate",
] as const;

/** Liest einen Rabatt-Prozentsatz aus Shopware-/B2B-Customfields. */
export function extractDiscountPercentFromCustomFields(
  customFields: Record<string, unknown> | null | undefined,
): number | null {
  if (!customFields || typeof customFields !== "object") return null;
  for (const key of DISCOUNT_CUSTOM_FIELD_KEYS) {
    const parsed = parseDiscountPercentValue(customFields[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

export function parseDiscountPercentValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", ".").replace(/%/g, "").trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 10) / 10;
}
