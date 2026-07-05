/** Shopware Custom Field: SAP/IFS-Verkaufsartikelnummer (Excel-Spalte „Verkaufsartikel“). */
export const WDU_IFS_PRODUCT_NUMBER_FIELD = "wdu_ifs_productnumber";

/** Liest wdu_ifs_productnumber aus Shopware customFields (case-insensitiver Key-Fallback). */
export function getWduIfsProductNumber(
  customFields: Record<string, unknown> | undefined,
): string | undefined {
  if (!customFields || typeof customFields !== "object") return undefined;

  const direct = customFields[WDU_IFS_PRODUCT_NUMBER_FIELD];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (typeof direct === "number" && Number.isFinite(direct)) return String(direct);

  for (const [key, value] of Object.entries(customFields)) {
    if (key.toLowerCase() !== WDU_IFS_PRODUCT_NUMBER_FIELD) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return undefined;
}

/** Schlüssel für Herstellpreis-Lookup (Excel Verkaufsartikel = wdu_ifs_productnumber). */
export function getHerstellpreisLookupKey(
  customFields: Record<string, unknown> | undefined,
  fallbackProductNumber?: string,
): string | undefined {
  return getWduIfsProductNumber(customFields) ?? fallbackProductNumber;
}
