/**
 * Kurz-Verifikation: Screening trennt Telefon-/PLZ-Zeilen von echten Produktzeilen.
 * Ausführen: npx tsx scripts/testLineItemProductScreening.ts
 */
import {
  extractSixDigitSuffixAfterGtinRoot,
  resolveEffectiveLineIdentifiers,
} from "../server/lineItemCatalogIdentifiers";
import {
  lineLooksLikeNumericProductReference,
  screenOfferLineItem,
  shouldSkipCatalogMatchingForLineItem,
} from "../server/lineItemProductScreening";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const noMatch = { confidence: 0, status: "not_found" as const };
const strongMatch = {
  confidence: 92,
  status: "matched" as const,
  matchedProduct: { id: "x" },
};

// 5–7 stellige Reinzahl ohne Produktbezug → kein „Artikelreferenz“-Signal (8–14 bleiben GTIN-typisch)
assert(lineLooksLikeNumericProductReference("123456") === false, "6-stellige Reinzahl (ohne 8–14-GTIN)");
assert(lineLooksLikeNumericProductReference("12345") === false, "5-stellige Reinzahl");
assert(lineLooksLikeNumericProductReference("4006381333931") === true, "13-stellige GTIN");
assert(lineLooksLikeNumericProductReference("402621") === true, "6-stellig: Anfang der firmeneigenen GTIN-Wurzel (Default 4026212…)");
assert(lineLooksLikeNumericProductReference("259964") === true, "6-stellig: Suffix für synthetische GTIN (4026212+259964)");

const loose = resolveEffectiveLineIdentifiers({
  extractedProductName: "2x  259964",
  extractedProductNumber: undefined,
});
assert(loose.digitsFromName === "259964", `Freitext-Ziffern: erwartet 259964, war ${loose.digitsFromName}`);
assert(shouldSkipCatalogMatchingForLineItem({ extractedProductName: "2x  259964", quantity: 2 }).skip === false, "2x 259964 soll Katalog-Matching erlauben");

const rothLine = "4 Stk. Stahlpaneel-Böden 2700x1100 - Nr. 4026212 073492";
assert(extractSixDigitSuffixAfterGtinRoot(rothLine) === "073492", "Roth-Stil: Präfix und Suffix mit Leerzeichen");
assert(
  lineLooksLikeNumericProductReference("073492", rothLine) === true,
  "6-stelliges Suffix unter 200000 mit „4026212 …“ im Kontext"
);

const tel = screenOfferLineItem(
  { extractedProductName: "Tel. 0123456789", quantity: 1 },
  noMatch
);
assert(tel.likelihood !== "likely_product", `Tel-Zeile sollte nicht likely sein, war ${tel.likelihood}`);

const plz = screenOfferLineItem(
  { extractedProductName: "PLZ 12345 Berlin", quantity: 1 },
  noMatch
);
assert(plz.likelihood !== "likely_product", `PLZ-Zeile sollte nicht likely sein, war ${plz.likelihood}`);

const regal = screenOfferLineItem(
  { extractedProductName: "Kragarmregal 2700mm", quantity: 1 },
  strongMatch
);
assert(regal.likelihood === "likely_product", `Regal mit starkem Match sollte likely sein, war ${regal.likelihood}`);

console.log("testLineItemProductScreening: OK");
