/** Typical EAN-8 … GTIN-14 digit lengths after removing display separators. */
const GTIN_DIGIT_LEN_MIN = 8;
const GTIN_DIGIT_LEN_MAX = 14;

const SEPARATOR_RE = /[\s\u00A0\-–.]/g;

/**
 * If the value is a pure barcode-style number (digits + optional spaces/hyphens), return compact digits.
 * Alphanumeric article numbers are returned trimmed, unchanged internally.
 */
export function normalizeExtractedProductNumber(
  raw: string | undefined | null
): string | undefined {
  if (raw == null || typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const withoutSeparators = trimmed.replace(SEPARATOR_RE, "");
  if (/^\d+$/.test(withoutSeparators)) {
    const len = withoutSeparators.length;
    if (len >= GTIN_DIGIT_LEN_MIN && len <= GTIN_DIGIT_LEN_MAX) {
      return withoutSeparators;
    }
  }

  return trimmed;
}

/**
 * Best-effort product number from a single line of local extraction (quantity prefix already stripped).
 */
export function extractProductNumberFromLineRest(rest: string): string | undefined {
  const skuMatch = rest.match(/([A-Z]{2,}\-?\d{2,})/);
  if (skuMatch) {
    return normalizeExtractedProductNumber(skuMatch[1]);
  }
  const gtinMatch = rest.match(/\b(\d[\d\s\u00A0\-–.]{6,}\d)\b/);
  if (gtinMatch) {
    return normalizeExtractedProductNumber(gtinMatch[1]);
  }
  return undefined;
}
