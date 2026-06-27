/**
 * Post-Extraktion für Commercial Drafts: deterministische „Sub-Agent“-Schritte
 * (Adresse, Positionszeilen, Struktur, Holm-Regel) plus Plausibilität vor dem Katalog-Matching.
 */

import { normalizeExtractedProductNumber } from "./articleNumberNormalize";
import {
  expandSixDigitGtinCandidates,
  isSixDigitGtinSuffixExpandable,
  mergeLineItemSixDigitGtinPrefixes,
} from "./lineItemCatalogIdentifiers";
import {
  lineItemTextLooksLikePostalAddress,
  mergeCompanyCustomerAndBilling,
  normalizeStructuredAddress,
  type LooseAddress,
} from "./extractedAddressNormalize";
import { ensureLegacyBuyerContactMapping } from "./buyerContactFieldUtils";
import { shouldSkipCatalogMatchingForLineItem } from "./lineItemProductScreening";
import type { WebDomainVerificationResult } from "./domainWebVerification";
import { isMetaOwnCompany } from "./metaCompanyBlocklist";

export const COMMERCIAL_EXTRACTION_ORCHESTRATOR_VERSION = "1";

export type CommercialDraftExtractionKind = "offer" | "order";

export type ExtractionAgentTraceEntry = {
  step: string;
  ms: number;
  version: string;
};

export type LineItemPlausibilityEntry = {
  index: number;
  skipCatalogMatching: boolean;
  skipReason?: string;
  quantityWasZero?: boolean;
};

function nowMs() {
  return Date.now();
}

function pushTrace(
  trace: ExtractionAgentTraceEntry[] | undefined,
  step: string,
  startedAt: number
) {
  if (!trace) return;
  trace.push({
    step,
    ms: Date.now() - startedAt,
    version: COMMERCIAL_EXTRACTION_ORCHESTRATOR_VERSION,
  });
}

function trimStrings(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.trim();
  }
  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, trimStrings(v)])
    );
  }
  if (Array.isArray(obj)) {
    return obj.map(trimStrings);
  }
  return obj;
}

function ensureLineItemsArray(data: Record<string, unknown>) {
  const li = data.lineItems;
  if (li && !Array.isArray(li)) {
    data.lineItems = Object.values(li as object);
  }
}

/**
 * Entfernt META-eigene Firmen aus Kunde / Rechnungsadresse (Offer + Order).
 * Lieferadresse bleibt absichtlich unangetastet — bei Direktbestellungen kann
 * eine META-Adresse legitimer Empfänger sein.
 */
function blockMetaOwnCompaniesFromBuyer(data: Record<string, unknown>) {
  const customer = data.customer as Record<string, string | undefined> | undefined;
  if (customer) {
    if (isMetaOwnCompany(customer.company)) {
      console.log(
        `[CommercialExtraction] Blocked META own company from customer.company: ${customer.company}`
      );
      delete customer.company;
    }
    if (isMetaOwnCompany(customer.firstName)) {
      console.log(
        `[CommercialExtraction] Blocked META own company from customer.firstName: ${customer.firstName}`
      );
      delete customer.firstName;
    }
    if (isMetaOwnCompany(customer.lastName)) {
      console.log(
        `[CommercialExtraction] Blocked META own company from customer.lastName: ${customer.lastName}`
      );
      delete customer.lastName;
    }
  }
  const billing = data.billingAddress as Record<string, string | undefined> | undefined;
  if (billing && isMetaOwnCompany(billing.company)) {
    console.log(
      `[CommercialExtraction] Blocked META own company from billingAddress.company: ${billing.company}`
    );
    delete billing.company;
  }
}

function expandSixDigitGtinOnLineItem<
  T extends { extractedProductName: string; extractedProductNumber?: string; quantity?: number },
>(item: T, prefixes: string[]): T {
  const normalizedNum = normalizeExtractedProductNumber(item.extractedProductNumber);
  const nameDigits = (item.extractedProductName || "").trim().replace(/[\s\u00A0\-–.]/g, "");
  const six =
    normalizedNum && /^\d{6}$/.test(normalizedNum)
      ? normalizedNum
      : /^\d{6}$/.test(nameDigits)
        ? nameDigits
        : undefined;
  if (!six || !isSixDigitGtinSuffixExpandable(six, prefixes, item.extractedProductName)) {
    return item;
  }
  const full = expandSixDigitGtinCandidates(six, prefixes)[0];
  if (!full) return item;
  return {
    ...item,
    extractedProductNumber: full,
    extractedProductName: full,
  };
}

function applyHolmQuantityRule(
  lineItems: Array<{
    extractedProductName: string;
    quantity?: number;
    extractedProductNumber?: string;
    [key: string]: unknown;
  }>,
  qtyZeroLineIndices: number[],
  sixDigitGtinPrefixes?: string[] | null
) {
  const prefixes = mergeLineItemSixDigitGtinPrefixes(sixDigitGtinPrefixes);
  return lineItems.map((item, index) => {
    if (item.quantity === 0) qtyZeroLineIndices.push(index);
    const productName = item.extractedProductName.toLowerCase();
    const isHolm =
      productName.includes("holm") ||
      productName.includes("beam") ||
      productName.includes("querträger") ||
      productName.includes("quertraeger");
    const isAlreadySet =
      productName.includes("set") ||
      productName.includes("paar") ||
      productName.includes("2er") ||
      productName.includes("2-er") ||
      productName.includes("pair");
    let quantity = item.quantity || 1;
    if (isHolm && !isAlreadySet && quantity > 1) {
      quantity = Math.ceil(quantity / 2);
      console.log(
        `[CommercialExtraction] Holm quantity adjusted for "${item.extractedProductName}": ${item.quantity} → ${quantity}`
      );
    }
    return expandSixDigitGtinOnLineItem(
      {
        ...item,
        quantity: Math.max(1, quantity),
        extractedProductNumber: normalizeExtractedProductNumber(item.extractedProductNumber),
      },
      prefixes
    );
  });
}

/**
 * Adresse, Firma, Positionsbereinigung, Struktur, Holm (nur Offer), Trim.
 * Läuft nach Roh-Extraktion, vor Intent/Web-Verify.
 */
export function runCommercialExtractionNormalizeSteps(
  extractedData: Record<string, unknown>,
  options: {
    kind: CommercialDraftExtractionKind;
    timings: Record<string, number>;
    trace?: ExtractionAgentTraceEntry[];
    lineItemSixDigitGtinPrefixes?: string[] | null;
  }
): { qtyZeroLineIndices: number[] } {
  const { kind, timings, trace, lineItemSixDigitGtinPrefixes } = options;
  const qtyZeroLineIndices: number[] = [];

  let t0 = nowMs();
  // META-eigene Firmen (Lagertechnik / Online / Regalbau / RegalPro) dürfen NIE
  // als Kunde durchgehen — gilt sowohl für Angebot als auch für Bestellung.
  blockMetaOwnCompaniesFromBuyer(extractedData);

  const billing = extractedData.billingAddress as LooseAddress | undefined;
  const normBill = normalizeStructuredAddress(billing);
  if (normBill) extractedData.billingAddress = normBill;

  if (kind === "order") {
    const shipping = extractedData.shippingAddress as LooseAddress | undefined;
    const normShip = normalizeStructuredAddress(shipping);
    if (normShip) extractedData.shippingAddress = normShip as typeof shipping;
    if (extractedData.billingAddress && !extractedData.shippingAddress) {
      extractedData.shippingAddress = {
        ...(extractedData.billingAddress as object),
      };
    }
  }

  mergeCompanyCustomerAndBilling(extractedData);
  ensureLegacyBuyerContactMapping(extractedData);
  timings.addressPostProcessMs = (timings.addressPostProcessMs ?? 0) + (Date.now() - t0);
  pushTrace(trace, "AddressAndCompany", t0);

  t0 = nowMs();
  ensureLineItemsArray(extractedData);
  const notesKey = kind === "offer" ? "offerNotes" : "orderNotes";
  const lineItems = extractedData.lineItems as
    | Array<{ extractedProductName: string; quantity?: number; extractedProductNumber?: string }>
    | undefined;

  if (lineItems && Array.isArray(lineItems)) {
    // Zusätzlicher Schutz: Tokens, die der Firmennamen-Heuristik im
    // Footer/Briefkopf als Straße / PLZ / Ort / Telefon / E-Mail aufgefallen
    // sind, dürfen NICHT als Line-Item durchgehen. Verhindert
    // Doppel-Erkennung „Adresse + Produkt".
    const signatureTokens = collectHeuristicAddressTokens(extractedData);
    const droppedAddressLines: string[] = [];
    const filtered = lineItems.filter((item) => {
      const name = item.extractedProductName;
      if (lineItemTextLooksLikePostalAddress(name)) {
        droppedAddressLines.push(name.slice(0, 200));
        return false;
      }
      if (lineItemMatchesSignatureTokens(name, signatureTokens)) {
        droppedAddressLines.push(name.slice(0, 200));
        return false;
      }
      return true;
    });
    extractedData.lineItems = filtered;
    if (droppedAddressLines.length > 0) {
      const note = `[Automatisch entfernt: Positionszeilen wirkten wie Adressen/Signatur]\n${droppedAddressLines.join("\n---\n")}`;
      const prev = (extractedData[notesKey] as string | undefined) || "";
      extractedData[notesKey] = prev ? `${prev}\n\n${note}` : note;
    }
  }
  timings.lineItemSanitizeMs = (timings.lineItemSanitizeMs ?? 0) + (Date.now() - t0);
  pushTrace(trace, "LineItemSanitization", t0);

  t0 = nowMs();
  const itemsAfter = extractedData.lineItems as
    | Array<{ extractedProductName: string; quantity?: number; extractedProductNumber?: string }>
    | undefined;
  if (itemsAfter && Array.isArray(itemsAfter)) {
    if (kind === "offer") {
      extractedData.lineItems = applyHolmQuantityRule(
        itemsAfter,
        qtyZeroLineIndices,
        lineItemSixDigitGtinPrefixes
      );
    } else {
      const prefixes = mergeLineItemSixDigitGtinPrefixes(lineItemSixDigitGtinPrefixes);
      extractedData.lineItems = itemsAfter.map((item, index) => {
        const rawQty = item.quantity;
        if (rawQty === 0) qtyZeroLineIndices.push(index);
        return expandSixDigitGtinOnLineItem(
          {
            ...item,
            quantity: Math.max(1, rawQty || 1),
            extractedProductNumber: normalizeExtractedProductNumber(item.extractedProductNumber),
          },
          prefixes
        );
      });
    }
  }
  timings.lineItemStructureMs = (timings.lineItemStructureMs ?? 0) + (Date.now() - t0);
  pushTrace(trace, kind === "offer" ? "LineItemStructureAndHolm" : "LineItemStructure", t0);

  t0 = nowMs();
  const trimmed = trimStrings(extractedData) as Record<string, unknown>;
  Object.assign(extractedData, trimmed);
  timings.extractionTrimMs = (timings.extractionTrimMs ?? 0) + (Date.now() - t0);
  pushTrace(trace, "TrimStrings", t0);

  if (trace && trace.length) {
    (extractedData as { extractionAgentTrace?: ExtractionAgentTraceEntry[] }).extractionAgentTrace = trace.slice();
  }

  return { qtyZeroLineIndices };
}

/**
 * Liest die Adress-/Kontakt-Tokens, die der Firmennamen-Heuristik im Footer
 * aufgefallen sind. Wird genutzt, um identische Strings nicht als Produkt
 * zu akzeptieren.
 */
function collectHeuristicAddressTokens(extractedData: Record<string, unknown>): string[] {
  const h = extractedData.companyNameHeuristic as
    | { collectedAddressTokens?: unknown }
    | undefined;
  const raw = h?.collectedAddressTokens;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 200);
}

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const STRONG_PRODUCT_LINE_TOKEN_RE =
  /\b(gtin|ean|art\.?\s*nr\.?|artikelnummer|stk\.?|stück|stueck|pcs|tragkraft|holm|kragarm|fachboden|querträger|quertraeger|paletten|lfm)\b|\d{8,14}/i;

/**
 * True, wenn der Line-Item-Text im Wesentlichen aus einem Footer-Adress-Token
 * besteht. Mehrstufige Erkennung, damit auch zusammengeklebte Adresszeilen
 * wie "Grohe GmbH, J.-G.-Mahlstraße 11, I-39031 Bruneck (BZ)" sicher als
 * Adress-Salat erkannt werden:
 *   1) Exakter Match (normalisiert).
 *   2) Hohe Längenüberdeckung (>= 60 %) zwischen Item und Token.
 *   3) Ein langer Token (>= 10 Zeichen) ist VOLLSTÄNDIG im Item enthalten
 *      und das Item enthält keine starken Produkt-Cues (EAN, Artikel-Nr, …).
 *   4) Mindestens ZWEI verschiedene Tokens sind im Item enthalten (jeder
 *      >= 3 Zeichen normalisiert) — sehr starker Beleg für Adresssalat.
 */
function lineItemMatchesSignatureTokens(name: string, tokens: string[]): boolean {
  if (!tokens.length || !name) return false;
  const itemNorm = normalizeForCompare(name);
  if (itemNorm.length < 4) return false;
  const hasStrongProductCue = STRONG_PRODUCT_LINE_TOKEN_RE.test(name);
  let containedCount = 0;
  for (const tok of tokens) {
    const tokNorm = normalizeForCompare(tok);
    if (tokNorm.length < 3) continue;
    if (itemNorm === tokNorm) return true;
    if (itemNorm.includes(tokNorm) && tokNorm.length / itemNorm.length >= 0.6) return true;
    if (tokNorm.includes(itemNorm) && itemNorm.length / tokNorm.length >= 0.6) return true;
    if (itemNorm.includes(tokNorm)) {
      if (tokNorm.length >= 10 && !hasStrongProductCue) return true;
      containedCount += 1;
    }
  }
  if (containedCount >= 2 && !hasStrongProductCue) return true;
  return false;
}

function normZipDigits(z: string | undefined): string {
  if (!z) return "";
  const m = z.replace(/\D/g, "").match(/(\d{4,5})/);
  return m ? m[1] : "";
}

function collectAddressReviewHints(
  extractedData: Record<string, unknown>,
  web?: WebDomainVerificationResult
): string[] {
  const hints: string[] = [];
  const billing = (extractedData.billingAddress || {}) as {
    street?: string;
    zipCode?: string;
    city?: string;
    country?: string;
  };
  const street = (billing.street || "").trim();
  const zip = (billing.zipCode || "").trim();
  const city = (billing.city || "").trim();
  const country = (billing.country || "").trim();

  if (!street && zip && city) {
    hints.push("billing_street_missing_zip_city_present");
  }
  if (!country && (street || zip || city)) {
    hints.push("billing_country_missing");
  }
  if (!zip && (street || city)) {
    hints.push("billing_zip_missing");
  }

  if (web && !web.skippedReason && web.domain && web.urlsTried.length > 0) {
    const zipDigits = normZipDigits(billing.zipCode);
    if (zipDigits.length >= 4 && !web.checks.zipMatch && !web.ok) {
      hints.push("web_domain_zip_not_found_on_site");
    }
  }

  return hints;
}

/**
 * Plausibilitätshinweise und Positions-Meta — nach Web-Domain-Verify, vor Produkt-Matching.
 */
export function runCommercialExtractionPlausibilitySteps(
  extractedData: Record<string, unknown>,
  options: {
    kind?: CommercialDraftExtractionKind;
    timings: Record<string, number>;
    trace?: ExtractionAgentTraceEntry[];
    qtyZeroLineIndices?: number[];
  }
): void {
  const { timings, trace, qtyZeroLineIndices = [] } = options;
  const t0 = nowMs();
  const web = extractedData.webDomainVerification as WebDomainVerificationResult | undefined;
  const hints = collectAddressReviewHints(extractedData, web);
  if (hints.length) {
    (extractedData as { addressReviewHints?: string[] }).addressReviewHints = hints;
  }

  const lineItems = extractedData.lineItems as
    | Array<{ extractedProductName: string; extractedProductNumber?: string; quantity: number }>
    | undefined;
  const qtyZeroSet = new Set(qtyZeroLineIndices);
  const lineItemPlausibility: LineItemPlausibilityEntry[] = [];

  if (lineItems && Array.isArray(lineItems)) {
    lineItems.forEach((item, index) => {
      const skip = shouldSkipCatalogMatchingForLineItem(item);
      lineItemPlausibility.push({
        index,
        skipCatalogMatching: skip.skip,
        skipReason: skip.reason,
        quantityWasZero: qtyZeroSet.has(index),
      });
    });
  }

  if (lineItemPlausibility.length) {
    (extractedData as { lineItemPlausibility?: LineItemPlausibilityEntry[] }).lineItemPlausibility =
      lineItemPlausibility;
  }

  timings.extractionPlausibilityMs = Date.now() - t0;
  pushTrace(trace, "AddressAndLineItemPlausibility", t0);

  if (trace?.length) {
    (extractedData as { extractionAgentTrace?: ExtractionAgentTraceEntry[] }).extractionAgentTrace =
      trace.slice();
  }
}

/** Nach optionalem Adress-Refinement: nur `addressReviewHints` neu setzen (Web-Checks unverändert). */
export function refreshCommercialAddressReviewHints(extractedData: Record<string, unknown>): void {
  const web = extractedData.webDomainVerification as WebDomainVerificationResult | undefined;
  const hints = collectAddressReviewHints(extractedData, web);
  if (hints.length) {
    (extractedData as { addressReviewHints?: string[] }).addressReviewHints = hints;
  } else {
    delete (extractedData as { addressReviewHints?: string[] }).addressReviewHints;
  }
}
