import { normalizeExtractedProductNumber } from "./articleNumberNormalize";

const SEP = /[\s\u00A0\-–.]/g;

/** Feste führende Ziffern der firmeneigenen GTIN/EAN (z. B. 4026212). Über METAORDER_GTIN_ARTICLE_PREFIX überschreibbar (nur Ziffern). */
export function getMetaorderGtinDigitRoot(): string {
  const raw = (process.env.METAORDER_GTIN_ARTICLE_PREFIX ?? "4026212").replace(/\D/g, "");
  return raw || "4026212";
}

/**
 * Genau 6 Ziffern, die den Anfang der konfigurierten GTIN-Wurzel abbilden (z. B. 402621 bei Root 4026212…).
 * Dann kein „Präfix + 6 Ziffern“-Suffix-Modell, sondern Katalogsignal / ggf. Präfix-Treffer.
 */
export function isSixDigitGtinPrefixTypedInput(six: string): boolean {
  if (!/^\d{6}$/.test(six)) return false;
  const root = getMetaorderGtinDigitRoot();
  return root.length > 0 && root.startsWith(six);
}

/** Default-Präfixliste für synthetische GTIN (Suffix nach Root). */
export function getDefaultLineItemSixDigitGtinPrefixes(): string[] {
  const root = getMetaorderGtinDigitRoot();
  return root ? [root] : [];
}

/** Mandanten-Präfixe aus Settings mit Default 4026212… mergen (ohne Duplikate). */
export function mergeLineItemSixDigitGtinPrefixes(tenantPrefixes?: string[] | null): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const d = s.replace(/\D/g, "");
    if (d && !out.includes(d)) out.push(d);
  };
  for (const p of tenantPrefixes ?? []) add(p);
  for (const p of getDefaultLineItemSixDigitGtinPrefixes()) add(p);
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Typische Schreibweise in Anfragen: „4026212 309010“ / „Nr. 4026212 073492“
 * (Leerzeichen zwischen Firmen-GTIN-Präfix und 6-stelligem Suffix).
 */
export function extractSixDigitSuffixAfterGtinRoot(
  text: string,
  mergedPrefixes?: string[] | null
): string | undefined {
  const raw = (text || "").trim();
  if (!raw) return undefined;
  const list = mergedPrefixes?.length ? mergedPrefixes : mergeLineItemSixDigitGtinPrefixes(null);
  for (const root of list) {
    if (root.length < 5) continue;
    const re = new RegExp(`\\b${escapeRegExp(root)}\\s+(\\d{6})\\b`, "i");
    const m = raw.match(re);
    if (m) return m[1];
  }
  return undefined;
}

function digitBlobFromRaw(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const d = raw.trim().replace(SEP, "");
  if (/^\d+$/.test(d) && d.length >= 5 && d.length <= 14) return d;
  return undefined;
}

export type ResolvedLineIdentifiers = {
  /** Normalisierte Kennung aus Feld oder reiner 8–14-stelliger Name (GTIN/EAN) */
  primaryNormalized?: string;
  /** Nur Ziffern bei rein numerischer Positionsbezeichnung (Artikelfeld bevorzugt, sonst Name) 5–14 */
  digitsFromName?: string;
  /** Genau 6 Ziffern → synthetische GTIN mit konfiguriertem Präfix (oder Präfix-Eingabe) */
  sixDigitSuffix?: string;
  /** 5–7 Ziffern für Herstellerartikelnummer / Kurzabgleich */
  shortNumeric?: string;
};

export function resolveEffectiveLineIdentifiers(line: {
  extractedProductName: string;
  extractedProductNumber?: string;
}): ResolvedLineIdentifiers {
  const name = (line.extractedProductName || "").trim();
  const fieldDigits = digitBlobFromRaw(line.extractedProductNumber);
  const nameDigits = digitBlobFromRaw(name);
  const looseDigits = extractCatalogDigitBlobFromLooseText(name);
  /** Artikelnummer-Feld vor rein numerischem Produkttitel, sonst Ziffern aus Freitext (z. B. „2x 259964“). */
  const digitsFromLine = fieldDigits ?? nameDigits ?? looseDigits;

  let primaryNormalized = normalizeExtractedProductNumber(line.extractedProductNumber);
  if (!primaryNormalized && digitsFromLine && digitsFromLine.length >= 8 && digitsFromLine.length <= 14) {
    primaryNormalized = digitsFromLine;
  }

  const shortNumeric =
    digitsFromLine && digitsFromLine.length >= 5 && digitsFromLine.length <= 7 ? digitsFromLine : undefined;
  const sixDigitSuffix = digitsFromLine?.length === 6 ? digitsFromLine : undefined;

  return {
    primaryNormalized,
    digitsFromName: digitsFromLine,
    sixDigitSuffix,
    shortNumeric,
  };
}

/** Synthetische GTIN-Kandidaten: Präfix + 6 Ziffern (keine Prüfziffer-Pflicht). */
export function expandSixDigitGtinCandidates(six: string, prefixes: string[]): string[] {
  if (!/^\d{6}$/.test(six)) return [];
  const out: string[] = [];
  for (const raw of prefixes) {
    const p = raw.trim();
    if (!p) continue;
    const combined = `${p}${six}`;
    if (combined.length >= 8 && combined.length <= 14) out.push(combined);
  }
  return out;
}

/**
 * Sechs Ziffern, die mit konfiguriertem Präfix zu einer gültigen GTIN-Länge (8–14) ergänzt werden
 * (z. B. 259964 + 4026212 → 4026212259964). Kein Präfix-Fragment (402621…), das separat behandelt wird.
 * @param mergedOrTenantPrefixes optional bereits gemergte Liste oder nur Mandanten-Präfixe (wird mit Default gemerged)
 */
export function isSixDigitGtinSuffixExpandable(
  six: string,
  mergedOrTenantPrefixes?: string[] | null,
  sourceLine?: string | null
): boolean {
  if (!/^\d{6}$/.test(six)) return false;
  if (isSixDigitGtinPrefixTypedInput(six)) return false;
  const list = mergeLineItemSixDigitGtinPrefixes(mergedOrTenantPrefixes ?? null);
  if (sourceLine?.trim()) {
    const fromSplit = extractSixDigitSuffixAfterGtinRoot(sourceLine, list);
    if (fromSplit === six) return true;
  }
  // Ohne „4026212 NNNNNN“ im Text: strenge Schwelle gegen zufällige 6er (z. B. 123456).
  if (six < "200000") return false;
  return expandSixDigitGtinCandidates(six, list).length > 0;
}

/**
 * Aus Freitext (z. B. „2x 259964“, „1x 4026212259957“) die für den Katalog relevante Ziffernfolge wählen.
 * Bevorzugt 8–14 Ziffern (volle GTIN), sonst 6 Ziffern wenn META-GTIN-Präfix/Suffix-Regeln passen.
 */
function extractCatalogDigitBlobFromLooseText(text: string): string | undefined {
  const raw = (text || "").trim();
  if (!raw) return undefined;
  const runs = raw.match(/\d{5,14}/g);
  const normalized = runs?.map((r) => r.replace(SEP, "")).filter((r) => /^\d+$/.test(r)) ?? [];
  if (normalized.length) {
    const longHit = normalized.filter((r) => r.length >= 8 && r.length <= 14);
    if (longHit.length) return longHit.sort((a, b) => b.length - a.length)[0];
  }
  const splitSuf = extractSixDigitSuffixAfterGtinRoot(raw);
  if (splitSuf) return splitSuf;
  if (!normalized.length) return undefined;
  for (const r of normalized) {
    if (r.length === 6 && (isSixDigitGtinPrefixTypedInput(r) || isSixDigitGtinSuffixExpandable(r, null, raw)))
      return r;
  }
  return undefined;
}

/** Alle Suchstrings für Inaktiv-Lookup (ohne Duplikate, begrenzt). */
export function collectIdentifierSearchStrings(
  ids: ResolvedLineIdentifiers,
  syntheticGtins: string[],
  maxTotal: number = 12
): string[] {
  const set = new Set<string>();
  const add = (s?: string) => {
    if (s && s.trim()) set.add(s.trim());
  };
  add(ids.primaryNormalized);
  add(ids.digitsFromName);
  add(ids.shortNumeric);
  for (const g of syntheticGtins) add(g);
  return Array.from(set).slice(0, maxTotal);
}
