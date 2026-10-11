/**
 * Passt der über die Nummer gefundene Artikel zur Bezeichnung? (Werkzeug-Eylert 80468065, Live 11.10.2026)
 *
 * Beim Auslesen war die EAN-Spalte um eine Zeile verrutscht: „Holm HN 120/20 2700 mm“ bekam die EAN
 * des Holms 140/15 × 3600 aus der Zeile darunter, die Holm-Zeile die EAN einer Diagonale usw. – vier
 * Positionen „sicher erkannt“ (100 %), alle falsch. Diese Prüfung vergleicht Bezeichnung und Artikel:
 *  - Typ (Holm, Diagonale, Horizontale, Ständer, Boden …) und Hauptmaße (ab 500 mm).
 *  - Widerspruch → Treffer wird Vorschlag (nicht automatisch anlegbar) mit Hinweis.
 *  - Passen mindestens zwei Artikel jeweils zur Bezeichnung der Nachbarzeile, ist die Nummernspalte
 *    verrutscht: Nummern und Artikel werden um eine Zeile zurechtgerückt (als Vorschlag).
 */
import type { LineItemMatch, MatchingResult } from "../products/productMatcher";
import { tokenize } from "./draftLineAiMatch";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/draftNumberMatchCheck" });

const NUMBER_STRATEGIES = new Set(["ean", "productNumber", "manufacturerNumber", "sapProductNumber", "synthetic_gtin"]);
export const NUMBER_CONFLICT_CONFIDENCE = 60;
export const NUMBER_REALIGNED_CONFIDENCE = 85;

/** Teile-Familien; Abkürzungen aus META-Artikelnamen („MP HS140/15“, „Dia1100“, „Hor1100“) */
const TYPE_FAMILIES: Record<string, string[]> = {
  holm: ["holm", "holme", "holmebene", "traverse", "traversen", "hs", "hn", "stufenholm", "kastenholm"],
  diagonale: ["diagonale", "diagonalen", "diagonalstab", "dia", "diagonalverstrebung", "diagonalkreuz"],
  horizontale: ["horizontale", "horizontalen", "hor", "horizontalstab"],
  staender: ["staender", "staenderrahmen", "rahmen", "stirnrahmen", "sr"],
  pfosten: ["pfosten", "profil", "stuetze"],
  boden: ["fachboden", "boden", "zusatzboden", "stahlpaneelboden", "spanplattenboden", "gitterrostboden", "gitterrost", "abdeckboden"],
  rueckwand: ["rueckwand", "rueckwandgitter", "rueckwaende"],
  rammschutz: ["rammschutz", "rammschutzecke", "anfahrschutz", "rammschutzwand"],
  durchschub: ["durchschubsicherung"],
  unterlegplatte: ["unterlegplatte", "unterlegblech", "ausgleichsblech", "unterlegscheibe"],
};
const TOKEN_FAMILY = new Map<string, string>();
for (const [family, words] of Object.entries(TYPE_FAMILIES)) for (const w of words) TOKEN_FAMILY.set(w, family);

type Profile = { families: Set<string>; dims: number[]; tokens: Set<string> };

function profile(text: string): Profile {
  const cleaned = (text || "")
    // RAL-Farben und Lasten sind keine Maße
    .replace(/\bR(?:AL)?\s?\d{4}\b/gi, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(?:kg|kn)\b/gi, " ")
    .replace(/fachlast\s*\d+/gi, " ");
  const tokens = tokenize(cleaned);
  const families = new Set<string>();
  for (const t of tokens) {
    const f = TOKEN_FAMILY.get(t);
    if (f) families.add(f);
  }
  const dims = tokens.filter((t) => /^\d{3,5}$/.test(t)).map(Number).filter((n) => n >= 500 && n <= 20000);
  return { families, dims, tokens: new Set(tokens.filter((t) => !/^\d+$/.test(t))) };
}

const sameDim = (a: number, b: number) => Math.abs(a - b) <= Math.max(10, Math.round(Math.max(a, b) * 0.01));

export type Fit = { conflict: string | null; evidence: number };

/** Widerspruch (Typ oder Hauptmaß) und positive Übereinstimmungen zwischen Bezeichnung und Artikel. */
export function compareDescriptionToProduct(description: string, productName: string): Fit {
  const d = profile(description);
  const p = profile(productName);
  let evidence = 0;
  let conflict: string | null = null;
  if (d.families.size && p.families.size) {
    const shared = [...d.families].some((f) => p.families.has(f));
    if (shared) evidence += 2;
    else conflict = `Typ: Bezeichnung ${[...d.families].join("/")}, Artikel ${[...p.families].join("/")}`;
  }
  if (d.dims.length && p.dims.length) {
    const sharedDims = p.dims.filter((pd) => d.dims.some((dd) => sameDim(dd, pd))).length;
    if (sharedDims > 0) evidence += sharedDims;
    else if (!conflict) conflict = `Maße: Bezeichnung ${d.dims.join("/")}, Artikel ${p.dims.join("/")}`;
  }
  return { conflict, evidence };
}

type Line = { extractedProductName?: string; extractedProductNumber?: string };

function isNumberMatch(item: LineItemMatch | undefined): boolean {
  return Boolean(item?.matchedProduct && item.status === "matched" && item.matchStrategy && NUMBER_STRATEGIES.has(item.matchStrategy));
}

/** Bezeichnung sinnvoll prüfbar? (nicht leer, nicht nur die Nummer) */
function hasDescription(line: Line | undefined): boolean {
  const name = (line?.extractedProductName ?? "").trim();
  if (name.length < 4) return false;
  const number = (line?.extractedProductNumber ?? "").trim();
  return !(number && name.replace(/\s/g, "") === number.replace(/\s/g, ""));
}

export type NumberCheckResult = { conflicts: number; realigned: number; shift: { from: number; to: number; direction: "down" | "up" } | null };

/**
 * Prüft Nummern-Treffer gegen die Bezeichnung (in place auf lineItems/matchingResults).
 * Erst Spalten-Verschiebung erkennen und zurechtrücken, dann übrige Widersprüche herabstufen.
 */
export function checkNumberMatches(params: { lineItems: Line[]; matchingResults: MatchingResult | null }): NumberCheckResult {
  const { lineItems } = params;
  const items = params.matchingResults?.items;
  const result: NumberCheckResult = { conflicts: 0, realigned: 0, shift: null };
  if (!items?.length || items.length !== lineItems.length) return result;

  const fitAt = (productIndex: number, lineIndex: number): Fit | null => {
    const item = items[productIndex];
    const line = lineItems[lineIndex];
    if (!isNumberMatch(item) || !hasDescription(line)) return null;
    return compareDescriptionToProduct(line.extractedProductName ?? "", item.matchedProduct!.name);
  };

  // 1. Verschiebung: Artikel i widerspricht Zeile i, passt aber zu Zeile i+1 (down) bzw. i−1 (up)
  for (const direction of ["down", "up"] as const) {
    const step = direction === "down" ? 1 : -1;
    const fitsNeighbor = items.map((_, i) => {
      const own = fitAt(i, i);
      const neighbor = i + step >= 0 && i + step < items.length ? fitAt(i, i + step) : null;
      return Boolean(own?.conflict && neighbor && !neighbor.conflict && neighbor.evidence > 0);
    });
    // längster zusammenhängender Block mit mindestens zwei Zeilen
    let best: { from: number; to: number } | null = null;
    for (let i = 0; i < fitsNeighbor.length; i++) {
      if (!fitsNeighbor[i]) continue;
      let j = i;
      while (j + 1 < fitsNeighbor.length && fitsNeighbor[j + 1]) j++;
      if (j - i + 1 >= 2 && (!best || j - i > best.to - best.from)) best = { from: i, to: j };
      i = j;
    }
    if (!best) continue;

    const moved = items.slice(best.from, best.to + 1).map((item, k) => ({ item: { ...item }, number: lineItems[best!.from + k].extractedProductNumber }));
    // Zeilen des Blocks verlieren ihre (fremde) Nummer; die Zielzeilen bekommen sie
    const vacated = direction === "down" ? best.from : best.to;
    for (let k = 0; k < moved.length; k++) {
      const src = best.from + k;
      const dst = src + step;
      const target = items[dst];
      items[dst] = {
        ...target,
        matchedProduct: { ...moved[k].item.matchedProduct!, confidence: NUMBER_REALIGNED_CONFIDENCE },
        matchStrategy: moved[k].item.matchStrategy,
        status: "uncertain",
        confidence: NUMBER_REALIGNED_CONFIDENCE,
        alternativeMatches: target.matchedProduct && target.matchedProduct.id !== moved[k].item.matchedProduct!.id
          ? [target.matchedProduct, ...(target.alternativeMatches ?? [])].slice(0, 8)
          : target.alternativeMatches,
        aiMatch: undefined,
        numberCheck: { kind: "realigned", note: `Nummer ${moved[k].number ?? "?"} stand im Beleg eine Zeile ${direction === "down" ? "höher" : "tiefer"} (Spalte verrutscht)` },
      } as LineItemMatch;
      lineItems[dst] = { ...lineItems[dst], extractedProductNumber: moved[k].number };
      result.realigned += 1;
    }
    const lost = items[vacated];
    items[vacated] = {
      ...lost,
      matchedProduct: undefined,
      matchStrategy: undefined,
      status: "not_found",
      confidence: 0,
      alternativeMatches: lost.matchedProduct ? [lost.matchedProduct, ...(lost.alternativeMatches ?? [])].slice(0, 8) : lost.alternativeMatches,
      numberCheck: { kind: "realigned", note: "Nummer gehörte zur Nachbarzeile (Spalte verrutscht); Artikel bitte prüfen" },
    } as LineItemMatch;
    lineItems[vacated] = { ...lineItems[vacated], extractedProductNumber: undefined };
    result.shift = { ...best, direction };
    break;
  }

  // 2. Übrige Widersprüche: nicht mehr „sicher“
  items.forEach((item, i) => {
    const fit = fitAt(i, i);
    if (!fit?.conflict) return;
    item.status = "uncertain";
    item.confidence = NUMBER_CONFLICT_CONFIDENCE;
    item.matchedProduct = { ...item.matchedProduct!, confidence: NUMBER_CONFLICT_CONFIDENCE };
    (item as LineItemMatch & { numberCheck?: unknown }).numberCheck = { kind: "conflict", note: `Nummer passt nicht zur Bezeichnung (${fit.conflict})` };
    result.conflicts += 1;
  });

  if (result.conflicts || result.realigned) {
    log.info(
      { event: "draft_number_match_check", conflicts: result.conflicts, realigned: result.realigned, shift: result.shift },
      `[NumberMatchCheck] ${result.conflicts} Widersprüche, ${result.realigned} Positionen zurechtgerückt`,
    );
  }
  return result;
}
