/**
 * Preiseingabe in deutscher oder englischer Schreibweise lesen:
 * "1.088,85", "1088,85", "1,088.85", "1088.85", "1.088" (Tausenderpunkt) → Zahl; sonst null.
 * Leere Eingabe ergibt null.
 */
export function parseLocalePrice(raw: string): number | null {
  const text = raw.replace(/[\s €]/g, "");
  if (!text || !/^-?[\d.,]+$/.test(text)) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // der hintere Trenner ist das Dezimalzeichen
    normalized =
      lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = /^-?\d{1,3}(,\d{3})+$/.test(text) && text.split(",").length > 2
      ? text.replace(/,/g, "")
      : text.replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) {
    normalized = text.replace(/\./g, "");
  } else {
    normalized = text;
  }
  if ((normalized.match(/\./g) ?? []).length > 1) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
