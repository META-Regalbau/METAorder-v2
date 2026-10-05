/**
 * Produktsuche: Suchwoerter und Relevanz. Vorher galt die ganze Eingabe als ein Teilstring
 * ("Fachboden 1000 x 400" fand nichts) und die Treffer kamen in Artikelnummer-Reihenfolge - bei
 * "Fachboden" zuerst Fachbodentraeger und Fachbodenregale, die eigentlichen Faecher weit hinten.
 * Regeln (gleich fuer Produktseite (SQL), KI-Produktsuche und semantische Suche):
 * - jedes Suchwort muss vorkommen, Reihenfolge egal; einzelne Zeichen wie "x" in "1000 x 400" fallen weg
 * - ganzes Wort im Namen (auch "Zusatz-Fachboden") zaehlt mehr als Teil eines zusammengesetzten
 *   Worts ("Fachbodenregal" ist ein Regal, kein Fachboden)
 * - exakte Artikelnummer/EAN zuerst
 */

/** Suchwoerter: Kleinbuchstaben, an Leerraum und Trennzeichen geteilt; Einzelzeichen ausser Ziffern weg */
export function searchTokens(query: string | null | undefined): string[] {
  const parts = String(query ?? "")
    .toLowerCase()
    .split(/[\s|,;/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const tokens = parts.filter((part) => part.length > 1 || /^\d$/.test(part));
  return Array.from(new Set(tokens));
}

/** Woerter eines Namens (Buchstaben/Ziffern, Bindestrich trennt: "Zusatz-Fachboden" -> zusatz, fachboden) */
export function nameWords(name: string | null | undefined): string[] {
  return String(name ?? "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

export const SCORE_WHOLE_WORD = 10;
export const SCORE_PART_OF_WORD = 2;
export const SCORE_EXACT_NUMBER = 1000;

/**
 * Relevanz eines Produkts fuer die Suchwoerter (0 = kein Wort kommt vor).
 * `exactNumbers`: Artikelnummer, EAN usw. - stimmt die ganze Eingabe genau, steht das Produkt vorn.
 */
export function productRelevance(
  name: string | null | undefined,
  tokens: string[],
  options: { query?: string; exactNumbers?: Array<string | null | undefined>; extraText?: string | null } = {},
): number {
  const words = nameWords(name);
  const lowerName = String(name ?? "").toLowerCase();
  const extra = String(options.extraText ?? "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (words.includes(token)) score += SCORE_WHOLE_WORD;
    else if (lowerName.includes(token)) score += SCORE_PART_OF_WORD;
    else if (extra.includes(token)) score += 1;
  }
  const query = String(options.query ?? "").trim().toLowerCase();
  if (query && (options.exactNumbers ?? []).some((n) => n && String(n).toLowerCase() === query)) score += SCORE_EXACT_NUMBER;
  return score;
}

/** Nach Relevanz absteigend; gleiche Relevanz behaelt die bisherige Reihenfolge */
export function sortByRelevance<T>(items: T[], relevance: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: relevance(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

/** Fuer SQL: Suchwort als POSIX-Regex-Literal (Sonderzeichen maskiert), fuer Wortgrenzen \m...\M */
export function escapeRegexLiteral(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
