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
 * Rabatt relativ zum Einkaufspreis: (Listenpreis − Kundenpreis) / Einkaufspreis.
 * Fallback ohne Listenpreis: Aufschlag (Kundenpreis − EK) / EK.
 */
export function computeDiscountPercentFromPurchaseBase(
  customerPriceNet: number | null | undefined,
  catalogPriceNet: number | null | undefined,
  purchasePriceNet: number | null | undefined,
): number | null {
  if (customerPriceNet == null || purchasePriceNet == null || purchasePriceNet <= 0) return null;

  if (catalogPriceNet != null && catalogPriceNet > customerPriceNet) {
    return Math.round(((catalogPriceNet - customerPriceNet) / purchasePriceNet) * 1000) / 10;
  }

  return Math.round(((customerPriceNet - purchasePriceNet) / purchasePriceNet) * 1000) / 10;
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
