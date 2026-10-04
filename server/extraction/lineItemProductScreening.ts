/**
 * Heuristische Einordnung extrahierter Zeilen: echte Produktposition vs. Floskel/Metadaten.
 * Läuft nach dem Katalog-Matching (parallel pro Zeile) und steuert Anzeige sowie Preis-Summen.
 *
 * Zusätzlich: shouldSkipCatalogMatchingForLineItem — verhindert Katalogabgleich für reine Zahlen-/Belegzeilen,
 * bevor Teilstring-Treffer auf EAN/Artikelnummer oder Namens-Ähnlichkeit falsche Produkte liefern.
 */

import { normalizeExtractedProductNumber } from "./articleNumberNormalize";
import { lineItemTextLooksLikePostalAddress } from "./extractedAddressNormalize";
import {
  isSixDigitGtinPrefixTypedInput,
  isSixDigitGtinSuffixExpandable,
  resolveEffectiveLineIdentifiers,
} from "./lineItemCatalogIdentifiers";

export type ProductLineLikelihood = "likely_product" | "unclear" | "unlikely_product";

export interface ProductScreenMeta {
  likelihood: ProductLineLikelihood;
  reasons?: string[];
}

const GREETING_OR_CLOSING_RE =
  /sehr geehrte|geehrter frau|geehrter herr|geehrte damen|mit freundlichen grüßen|mit freundlichen gruessen|viele grüße|viele gruesse|\bmfg\b|best regards|kind regards|dear sir|dear madam|hello team|hi zusammen|hochachtungsvoll|freundliche grüße|freundliche gruesse/i;

const META_OR_LEGAL_RE =
  /ust[-\s]?id|steuernummer|iban|bic\b|sepa|zahlungsziel|zahlbar innerhalb|zahlbar bis|agb\b|impressum|datenschutz|geschäftsführer|geschaeftsfuehrer|registergericht|handelsregister|this e-?mail|please do not reply|bitte senden sie|anbei (die|sende|erhalten)|im anhang|unsubscribe/i;

const PRODUCT_HINT_RE =
  /regal|holm|holmebene|kragarm|paletten|fachboden|ständer|staender|traverse|ebene|\bmm\b|\bcm\b|\bkg\b|lfm|meter|stück|stueck|\bstk\b|paar|\bset\b|art\.?\s*nr|artikelnummer|\bart\.?\b|\bean\b|\bgtin\b|traglast|tragkraft|breite|höhe|hoehe|tiefe|regalfeld|regalsystem|querträger|quertraeger|anbauregal|grundregal/i;

const MULTIPAL_AND_TYP_RE =
  /\b(multipal|typ\s*[\d/]+|länge|laenge|profil|verzinkt|verzink|feuerverzinkt|pulver|RAL\s*\d)\b/i;

/** Eine Quelle der Wahrheit für „Produkt-Stichworte“ (Matcher + Screening). */
export function getProductHintRegex(): RegExp {
  return PRODUCT_HINT_RE;
}

/** Produkttyp-/Maß-Hinweise aus Zeilentext (Regal, Holm, mm, Stück, …). */
export function extractedLineHasProductKeywords(text: string): boolean {
  const t = (text || "").trim();
  return PRODUCT_HINT_RE.test(t) || MULTIPAL_AND_TYP_RE.test(t);
}

const EMAIL_IN_TEXT_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL_RE = /https?:\/\/|www\.\w/i;
const PHONE_ONLY_RE = /^[\s+]*\+?\d[\d\s().\/-]{6,}\d\s*$/;
const PLZ_CITY_ONLY_RE = /^\d{4,5}\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s\-]{2,50}$/;
const STREET_AND_PLZ_CITY_RE =
  /(?:straße|strasse|str\.|weg|allee|platz|ring|gasse)\s+\d{1,4}[a-z]?(?:[,\s]+|\s+)\d{4,5}\s+[A-Za-zÄÖÜäöüß]/i;

const INVOICE_OR_META_ROW_RE =
  /\b(summe|zwischensumme|gesamt|netto|brutto|mwst|mws|ust\.?|rabatt|skonto|bezahlt|fällig|faellig|rechnungsnr|rechnung\s*nr|auftragsnr|auftrag\s*nr|angebotsnr|lieferschein|pos\.?\s*\d+\s*$|seite\s+\d+|page\s+\d+)\b/i;

function letterCount(name: string): number {
  return (name.match(/[a-zA-ZÄÖÜäöüß]/g) || []).length;
}

function lineItemDigitContext(line: { extractedProductName: string; extractedProductNumber?: string }): string {
  return [line.extractedProductName, line.extractedProductNumber].filter(Boolean).join(" ");
}

function hasStrongSkuOrGtin(line: {
  extractedProductName: string;
  extractedProductNumber?: string;
}): boolean {
  const fromField = normalizeExtractedProductNumber(line.extractedProductNumber);
  if (fromField && /^\d{8,14}$/.test(fromField)) return true;
  if (line.extractedProductNumber && /[A-Za-z]{2,}/.test(line.extractedProductNumber.trim())) return true;
  const fromName = normalizeExtractedProductNumber(line.extractedProductName);
  if (fromName && /^\d{8,14}$/.test(fromName)) return true;
  const rid = resolveEffectiveLineIdentifiers(line).digitsFromName;
  const ctx = lineItemDigitContext(line);
  if (rid && /^\d{8,14}$/.test(rid)) return true;
  if (rid?.length === 6 && (isSixDigitGtinPrefixTypedInput(rid) || isSixDigitGtinSuffixExpandable(rid, null, ctx)))
    return true;
  return false;
}

/** Reine Ziffern wie GTIN/EAN oder kurze Artikelnummer (z. B. 6-stellige HAN) — nicht als Telefon werten. */
export function lineLooksLikeNumericProductReference(name: string, sourceContext?: string): boolean {
  const raw = (name || "").trim();
  const t = raw.replace(/[\s\u00A0\-–.]/g, "").trim();
  if (!/^\d+$/.test(t)) return false;
  const len = t.length;
  if (len >= 8 && len <= 14) return true;
  const ctx = (sourceContext ?? raw).trim();
  // 6-stellig: fester GTIN-Anfang (METAORDER_GTIN_ARTICLE_PREFIX, Default 4026212…)
  if (len === 6 && isSixDigitGtinPrefixTypedInput(t)) return true;
  // 6-stellig: Suffix (optional mit Kontextzeile „… 4026212 073492“)
  if (len === 6 && isSixDigitGtinSuffixExpandable(t, null, ctx)) return true;
  // 5–7 stellige Reinzahl nur mit Produktbezug (sonst oft Tel./Datum/Belegrest)
  if (len === 5 || len === 7) return extractedLineHasProductKeywords(raw);
  if (len === 6) return extractedLineHasProductKeywords(raw);
  return false;
}

/**
 * Kein Shopware-Abgleich: reduziert False Positives durch Teil-EAN oder Zufalls-Ähnlichkeit.
 */
export function shouldSkipCatalogMatchingForLineItem(line: {
  extractedProductName: string;
  extractedProductNumber?: string;
  quantity: number;
}): { skip: boolean; reason?: string } {
  const name = (line.extractedProductName || "").trim();
  if (!name) return { skip: true, reason: "leer" };

  if (PRODUCT_HINT_RE.test(name) || MULTIPAL_AND_TYP_RE.test(name)) {
    return { skip: false };
  }

  if (hasStrongSkuOrGtin(line)) {
    return { skip: false };
  }

  const ctx = lineItemDigitContext(line);
  const catalogDigits = resolveEffectiveLineIdentifiers(line).digitsFromName;
  if (catalogDigits && lineLooksLikeNumericProductReference(catalogDigits, ctx)) {
    return { skip: false };
  }

  if (lineLooksLikeNumericProductReference(name, ctx)) {
    return { skip: false };
  }

  if (lineItemTextLooksLikePostalAddress(name)) return { skip: true, reason: "postadresse" };
  if (STREET_AND_PLZ_CITY_RE.test(name) && !PRODUCT_HINT_RE.test(name)) {
    return { skip: true, reason: "strasse_plz_ort" };
  }

  if (GREETING_OR_CLOSING_RE.test(name)) return { skip: true, reason: "anrede_gruss" };
  if (META_OR_LEGAL_RE.test(name)) return { skip: true, reason: "metatext" };
  if (EMAIL_IN_TEXT_RE.test(name)) return { skip: true, reason: "email" };
  if (PHONE_ONLY_RE.test(name) && name.length < 90) return { skip: true, reason: "telefon" };
  if (PLZ_CITY_ONLY_RE.test(name) && name.length < 90) return { skip: true, reason: "plz_ort" };
  if (INVOICE_OR_META_ROW_RE.test(name)) return { skip: true, reason: "beleg_metazeile" };

  const letters = letterCount(name);
  if (letters < 3) {
    return { skip: true, reason: "zu_wenig_buchstaben" };
  }

  const nonSpace = name.replace(/\s/g, "");
  if (nonSpace.length > 3) {
    const digits = (nonSpace.match(/\d/g) || []).length;
    if (digits / nonSpace.length > 0.58 && letters < 8) {
      return { skip: true, reason: "zahlendominiert" };
    }
  }

  if (/^[\d\s.,;:+x\/\\\-–]+$/i.test(name)) {
    return { skip: true, reason: "nur_ziffern_zeichen" };
  }

  if (/^\d{1,2}[.\/]\d{1,2}[.\/](\d{2}|\d{4})\b/.test(name) && letters < 10) {
    return { skip: true, reason: "datum_ahnlich" };
  }

  return { skip: false };
}

export function screenOfferLineItem(
  line: { extractedProductName: string; extractedProductNumber?: string; quantity: number },
  matchItem: {
    confidence: number;
    status: string;
    matchedProduct?: unknown;
    bundle?: unknown;
    systemMatch?: unknown;
  }
): ProductScreenMeta {
  const name = (line.extractedProductName || "").trim();
  const reasons: string[] = [];

  const hasCatalogSignal =
    !!matchItem.matchedProduct ||
    !!matchItem.bundle ||
    !!matchItem.systemMatch ||
    matchItem.status === "matched" ||
    (matchItem.status === "uncertain" && matchItem.confidence >= 55);

  const hasSkuOrGtin = !!(line.extractedProductNumber && String(line.extractedProductNumber).trim());
  const hasProductWords = PRODUCT_HINT_RE.test(name);

  if (hasCatalogSignal) {
    const plausibleText = hasProductWords || hasSkuOrGtin || hasStrongSkuOrGtin(line);
    if (matchItem.confidence >= 88 && plausibleText) {
      return { likelihood: "likely_product", reasons: ["Starker Treffer mit Produktbezug"] };
    }
    if (matchItem.confidence >= 60 && plausibleText) {
      return { likelihood: "likely_product", reasons: ["Katalogtreffer oder Bundle/System-Zuordnung"] };
    }
    if (hasCatalogSignal && plausibleText) {
      return { likelihood: "unclear", reasons: ["Treffer vorhanden, geringere Konfidenz"] };
    }
    if (hasCatalogSignal && !plausibleText) {
      return {
        likelihood: "unlikely_product",
        reasons: ["Vermutlich kein Artikel: Treffer nur durch Zahl/Ähnlichkeit"],
      };
    }
  }

  if (hasSkuOrGtin && hasProductWords) {
    return { likelihood: "likely_product", reasons: ["Artikelnummer und Produktbegriffe"] };
  }

  if (lineItemTextLooksLikePostalAddress(name) || STREET_AND_PLZ_CITY_RE.test(name)) {
    reasons.push("Adresszeile erkannt");
    return { likelihood: "unlikely_product", reasons };
  }

  if (GREETING_OR_CLOSING_RE.test(name)) {
    reasons.push("Anrede oder Grußformel");
    return { likelihood: "unlikely_product", reasons };
  }

  if (META_OR_LEGAL_RE.test(name)) {
    reasons.push("Rechtliches, Zahlung oder E-Mail-Metatext");
    return { likelihood: "unlikely_product", reasons };
  }

  if (EMAIL_IN_TEXT_RE.test(name) && !hasProductWords) {
    reasons.push("E-Mail-Adresse im Text");
    return { likelihood: "unlikely_product", reasons };
  }

  if (URL_RE.test(name) && name.length < 180) {
    reasons.push("Link ohne Produktbeschreibung");
    return { likelihood: "unlikely_product", reasons };
  }

  if (PHONE_ONLY_RE.test(name) && name.length < 80) {
    reasons.push("Telefonnummer");
    return { likelihood: "unlikely_product", reasons };
  }

  if (PLZ_CITY_ONLY_RE.test(name) && name.length < 80) {
    reasons.push("Nur PLZ/Ort");
    return { likelihood: "unlikely_product", reasons };
  }

  if (name.length > 0 && name.length < 10 && !hasSkuOrGtin) {
    reasons.push("Sehr kurzer Text ohne Artikelnummer");
    return { likelihood: "unlikely_product", reasons };
  }

  if (hasProductWords || hasSkuOrGtin) {
    return {
      likelihood: "unclear",
      reasons: ["Produktähnlich, kein sicherer Katalogtreffer"],
    };
  }

  return { likelihood: "unclear", reasons: ["Kein eindeutiger Produktbezug"] };
}

/** Gesamt-Konfidenz nur aus Zeilen, die nicht als „kein Produkt“ gelten (kein Durchschnitt über Floskeln). */
export function recomputeOfferOverallConfidence(
  items: Array<{ confidence: number; productScreen?: ProductScreenMeta }>
): number {
  const eligible = items.filter((i) => i.productScreen?.likelihood !== "unlikely_product");
  const pool = eligible.length > 0 ? eligible : items;
  if (pool.length === 0) return 0;
  return Math.round(pool.reduce((s, i) => s + (i.confidence || 0), 0) / pool.length);
}

/**
 * Parallele Anreicherung der Matching-Items mit productScreen + neuem overallConfidence.
 */
export async function applyProductScreeningToOfferMatching<
  T extends {
    items: Array<{
      extractedProductName: string;
      extractedProductNumber?: string;
      quantity: number;
      confidence: number;
      status: string;
      matchedProduct?: unknown;
      bundle?: unknown;
      systemMatch?: unknown;
      productScreen?: ProductScreenMeta;
      catalogMatchSkipped?: boolean;
    }>;
    overallConfidence: number;
  },
>(
  matchingResults: T,
  lineItems: Array<{
    extractedProductName: string;
    extractedProductNumber?: string;
    quantity: number;
  }>
): Promise<void> {
  await Promise.all(
    matchingResults.items.map((item, i) =>
      Promise.resolve().then(() => {
        const line = lineItems[i];
        if (!line) return;
        if (item.catalogMatchSkipped) {
          item.productScreen = {
            likelihood: "unlikely_product",
            reasons: ["Kein Katalogabgleich: Text wirkt nicht wie Artikelposition"],
          };
          return;
        }
        item.productScreen = screenOfferLineItem(line, item);
      })
    )
  );
  matchingResults.overallConfidence = recomputeOfferOverallConfidence(matchingResults.items);
}
