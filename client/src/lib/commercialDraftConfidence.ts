/** Gesamt-Genauigkeit des Produkt-Matchings (0–100); darunter: expliziter Hinweis im UI. */
export const IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD = 90;

export function isLowOverallMatchingConfidence(
  matchingResults: { overallConfidence?: number } | null | undefined
): boolean {
  const c = matchingResults?.overallConfidence;
  return typeof c === "number" && c < IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD;
}
