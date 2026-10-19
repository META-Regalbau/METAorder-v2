/**
 * Shop-Puls Stufe 3 (S3-1), Suchwörter: zu einem Suchbegriff ohne Treffer passende Artikel finden (rein,
 * ohne Datenbank; Tests in tests/unit/shopPulseSearchKeywords.test.ts).
 *
 * Eindeutig (und damit automatisch eingetragen) ist ein Begriff nur, wenn genau ein kaufbarer Artikel passt:
 * 1. Nummer: Begriff ohne Leer- und Trennzeichen = Artikel-, EAN- oder Herstellernummer genau eines Artikels
 *    (z. B. alte META-Nummer 313422, die die Shop-Suche nicht kennt).
 * 2. Name: genau ein Artikel, dessen Name jedes Wort des Begriffs enthält, mindestens eins davon nur ähnlich
 *    geschrieben (ein bzw. zwei Buchstaben) oder als Wortteil („bodenregal“ in „Fachbodenregal“).
 *    Enthält der Name alle Wörter genau so, hätte die Shop-Suche (UND-Verknüpfung) ihn finden müssen: das ist
 *    kein Fall für ein Suchwort, sondern für den Suchindex (Vorschlag „exact“).
 * Mehrere Artikel → Vorschlag (ambiguous), keiner → none. Gilt die Live-Suchkonfiguration (Deutsch,
 * customSearchKeywords mit 3.501 gewichtet, ohne Zerlegen, UND-Logik), findet die Suche den Artikel danach
 * über das eingetragene Wort.
 */
import type { ShopPulseKeywordCandidate, ShopPulseKeywordMatchKind, ShopPulseKeywordReason } from "@shared/shopPulseHandoff";

export type KeywordProduct = {
  id: string;
  productNumber: string;
  name: string;
  ean: string | null;
  manufacturerNumber: string | null;
};

export type KeywordMatch = { kind: ShopPulseKeywordMatchKind; candidates: ShopPulseKeywordCandidate[] };

/** So viele Vorschläge hält ein Begriff höchstens */
export const MAX_CANDIDATES = 10;

const STOPWORDS = new Set(["und", "mit", "fur", "fuer", "der", "die", "das", "den", "dem", "ein", "eine", "einen", "von", "zu", "im", "in", "am", "an", "auf", "fur", "x", "mm", "cm", "kg", "m", "st", "stk", "stuck"]);

/** Kleinbuchstaben, Umlaute ausgeschrieben, Akzente weg, alles außer Buchstaben und Ziffern als Leerzeichen */
export function normalizeText(s: string): string {
  return s
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const compactText = (s: string) => normalizeText(s).replace(/ /g, "");

/** Wörter des Begriffs ohne Füllwörter; Einzelbuchstaben nur, wenn es Ziffern sind */
export function termTokens(term: string): string[] {
  return Array.from(new Set(normalizeText(term).split(" ").filter((t) => t && !STOPWORDS.has(t) && (t.length >= 2 || /\d/.test(t)))));
}

/** Damerau-Levenshtein (benachbarte Vertauschung zählt einfach), bricht über max ab */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Erlaubte Tippfehler je Wortlänge: Zahlen und kurze Wörter genau, ab 5 Buchstaben einer, ab 9 zwei */
const allowedEdits = (t: string) => (/\d/.test(t) ? 0 : t.length >= 9 ? 2 : t.length >= 5 ? 1 : 0);

type PreparedProduct = { p: KeywordProduct; tokens: Set<string>; compact: string };

/** Wie ein Wort im Namen vorkommt: genau, ähnlich bzw. als Wortteil, oder gar nicht */
function tokenMatch(t: string, prod: PreparedProduct): "exact" | "fuzzy" | null {
  if (prod.tokens.has(t)) return "exact";
  if (t.length >= 4 && !/^\d+$/.test(t) && prod.compact.includes(t)) return "fuzzy";
  const max = allowedEdits(t);
  if (max > 0) {
    for (const n of Array.from(prod.tokens)) if (editDistance(t, n, max) <= max) return "fuzzy";
  }
  return null;
}

export function prepareProducts(products: KeywordProduct[]): PreparedProduct[] {
  return products.map((p) => {
    const norm = normalizeText(p.name);
    return { p, tokens: new Set(norm.split(" ").filter(Boolean)), compact: norm.replace(/ /g, "") };
  });
}

const candidate = (p: KeywordProduct, reason: ShopPulseKeywordReason, revenue: Map<string, number>): ShopPulseKeywordCandidate => ({
  productId: p.id,
  productNumber: p.productNumber,
  name: p.name,
  revenue: Math.round(revenue.get(p.productNumber) ?? 0),
  reason,
});

const byRevenue = (a: ShopPulseKeywordCandidate, b: ShopPulseKeywordCandidate) => b.revenue - a.revenue || a.productNumber.localeCompare(b.productNumber);

/**
 * Passende kaufbare Artikel zu einem Begriff (products: nur kaufbare, nicht technische Artikel des
 * DE-Kanals). Ergebnis siehe Dateikopf.
 */
export function matchSearchTerm(term: string, products: PreparedProduct[], revenue: Map<string, number>): KeywordMatch {
  const c = compactText(term);
  if (c.length >= 4) {
    const hits: ShopPulseKeywordCandidate[] = [];
    for (const { p } of products) {
      const reason: ShopPulseKeywordReason | null =
        compactText(p.productNumber) === c ? "productNumber" : p.ean && compactText(p.ean) === c ? "ean" : p.manufacturerNumber && compactText(p.manufacturerNumber) === c ? "manufacturerNumber" : null;
      if (reason) hits.push(candidate(p, reason, revenue));
    }
    if (hits.length === 1) return { kind: "number", candidates: hits };
    if (hits.length > 1) return { kind: "ambiguous", candidates: hits.sort(byRevenue).slice(0, MAX_CANDIDATES) };
  }

  const tokens = termTokens(term);
  // Nur Ziffern oder zu kurz: keine Namenssuche (Maße wie „2000“ passen auf Hunderte Artikel)
  if (!tokens.length || tokens.every((t) => /^\d+$/.test(t))) return { kind: "none", candidates: [] };
  const found: Array<{ c: ShopPulseKeywordCandidate; exact: boolean }> = [];
  for (const prod of products) {
    let exact = true;
    let ok = true;
    for (const t of tokens) {
      const m = tokenMatch(t, prod);
      if (!m) {
        ok = false;
        break;
      }
      if (m === "fuzzy") exact = false;
    }
    if (ok) found.push({ c: candidate(prod.p, "name", revenue), exact });
  }
  if (!found.length) return { kind: "none", candidates: [] };
  if (found.length === 1) return { kind: found[0].exact ? "exact" : "name", candidates: [found[0].c] };
  return { kind: "ambiguous", candidates: found.map((f) => f.c).sort(byRevenue).slice(0, MAX_CANDIDATES) };
}

/** Begriff, wie er eingetragen wird: getrimmt, Leerzeichen zusammengefasst, höchstens 60 Zeichen */
export const cleanTerm = (term: string) => term.trim().replace(/\s+/g, " ").slice(0, 60);
/** Schlüssel eines Begriffs (gleicher Begriff in anderer Schreibweise = derselbe Eintrag) */
export const termKey = (term: string) => normalizeText(term).slice(0, 120);

/** Vorhandene Suchwörter plus Begriff; doppelt (ohne Groß/klein) wird nicht ergänzt. null = schon enthalten */
export function mergeKeywords(existing: string[] | null | undefined, term: string): string[] | null {
  const list = (existing ?? []).filter((k) => typeof k === "string" && k.trim());
  const key = termKey(term);
  if (list.some((k) => termKey(k) === key)) return null;
  return [...list, cleanTerm(term)];
}

/** Begriff wieder heraus; alle übrigen (auch später eingetragene) bleiben */
export function removeKeyword(existing: string[] | null | undefined, term: string): string[] {
  const key = termKey(term);
  return (existing ?? []).filter((k) => typeof k === "string" && termKey(k) !== key);
}
