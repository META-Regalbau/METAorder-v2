/**
 * Brücke zwischen dem neuen META-aware Schema (snake_case) und dem
 * historisch gewachsenen Legacy-Format, das in DB / Matching / UI genutzt wird.
 *
 * Pipeline-Vertrag:
 *   1. Extractor liefert DocumentExtraction (kanonisches Snake-Case-Schema).
 *   2. translator füllt das Legacy-Shape (Customer / billingAddress / shippingAddress / lineItems …).
 *   3. Legacy-Objekt erhält `documentExtraction` als zusätzliches Feld → UI / Klärung.
 *
 * Damit bleibt productMatcher, customerClarification, etc. unverändert lauffähig.
 */

import type {
  DocumentExtraction,
  DocumentExtractionBuyer,
  DocumentExtractionDeliveryAddress,
  DocumentExtractionLineItem,
} from "@shared/documentExtractionSchema";
import { sanitizePhoneField } from "./buyerContactFieldUtils";
import { legacyFirstLastFromContactPerson } from "./personNameNormalize";

/** Legacy-Form, wie sie der Pipeline-Code (matcher, normalizers, UI) erwartet. */
export interface LegacyExtractedDocument {
  customer?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    company?: string;
  };
  billingAddress?: {
    firstName?: string;
    lastName?: string;
    street?: string;
    zipCode?: string;
    city?: string;
    country?: string;
    company?: string;
    phone?: string;
  };
  shippingAddress?: {
    firstName?: string;
    lastName?: string;
    street?: string;
    zipCode?: string;
    city?: string;
    country?: string;
    company?: string;
    phone?: string;
  };
  lineItems?: Array<{
    extractedProductName: string;
    /** Neue Schema-Wert: line_items[].position */
    extractedPositionNumber?: string;
    /** Neue Schema-Wert: line_items[].supplier_sku (Vorrang) oder buyer_sku (Fallback). */
    extractedProductNumber?: string;
    quantity: number;
    extractedPrice?: number;
  }>;
  orderNotes?: string;
  offerNotes?: string;
  validUntil?: string;
  /** Snake-case Original — bleibt zur Anzeige + späteren Migration vorhanden. */
  documentExtraction?: DocumentExtraction;
}

/**
 * Tolerant gegen Anreden, Titel, Adelsprädikate und „z. Hd."-Präfixe.
 * Liefert {} (keine Person), wenn `contact_person` eine Rolle wie „Einkauf" ist.
 */
function nameParts(contact: string | null): { firstName?: string; lastName?: string } {
  return legacyFirstLastFromContactPerson(contact);
}

function buyerToBilling(buyer: DocumentExtractionBuyer): NonNullable<LegacyExtractedDocument["billingAddress"]> {
  const { firstName, lastName } = nameParts(buyer.contact_person);
  const addr: NonNullable<LegacyExtractedDocument["billingAddress"]> = {};
  if (buyer.company) addr.company = buyer.company;
  if (firstName) addr.firstName = firstName;
  if (lastName) addr.lastName = lastName;
  if (buyer.street) addr.street = buyer.street;
  if (buyer.zip) addr.zipCode = buyer.zip;
  if (buyer.city) addr.city = buyer.city;
  if (buyer.country) addr.country = buyer.country;
  const phone = sanitizePhoneField(buyer.phone);
  if (phone) addr.phone = phone;
  if (buyer.email) addr.email = buyer.email;
  return addr;
}

function deliveryToShipping(
  delivery: DocumentExtractionDeliveryAddress,
  buyerFallback: ReturnType<typeof buyerToBilling>
): NonNullable<LegacyExtractedDocument["shippingAddress"]> | undefined {
  if (delivery.same_as_buyer) return undefined;
  const addr: NonNullable<LegacyExtractedDocument["shippingAddress"]> = {};
  if (delivery.company) addr.company = delivery.company;
  if (delivery.street) addr.street = delivery.street;
  if (delivery.zip) addr.zipCode = delivery.zip;
  if (delivery.city) addr.city = delivery.city;
  if (delivery.country) addr.country = delivery.country;
  if (Object.keys(addr).length === 0) return buyerFallback;
  return addr;
}

function pickProductNumber(item: DocumentExtractionLineItem): string | undefined {
  const sup = item.supplier_sku?.trim();
  if (sup) return sup;
  const buyer = item.buyer_sku?.trim();
  if (buyer) return buyer;
  return undefined;
}

function deriveOrderNotesText(extraction: DocumentExtraction): string | undefined {
  const lines: string[] = [];
  const t = extraction.terms;
  if (t.payment) lines.push(`Zahlung: ${t.payment}`);
  if (t.incoterms) lines.push(`Incoterms: ${t.incoterms}`);
  if (typeof t.partial_delivery_allowed === "boolean") {
    lines.push(`Teillieferung erlaubt: ${t.partial_delivery_allowed ? "ja" : "nein"}`);
  }
  if (t.notes) lines.push(t.notes);
  if (extraction.delivery_address.delivery_window) {
    lines.push(`Lieferfenster: ${extraction.delivery_address.delivery_window}`);
  }
  return lines.length ? lines.join("\n") : undefined;
}

export function translateDocumentExtractionToLegacy(
  extraction: DocumentExtraction
): LegacyExtractedDocument {
  const { firstName, lastName } = nameParts(extraction.buyer.contact_person);

  const customer: NonNullable<LegacyExtractedDocument["customer"]> = {};
  if (firstName) customer.firstName = firstName;
  if (lastName) customer.lastName = lastName;
  if (extraction.buyer.email) customer.email = extraction.buyer.email;
  const phone = sanitizePhoneField(extraction.buyer.phone);
  if (phone) customer.phone = phone;
  if (extraction.buyer.company) customer.company = extraction.buyer.company;

  const billingAddress = buyerToBilling(extraction.buyer);
  const shippingAddress = deliveryToShipping(extraction.delivery_address, billingAddress);

  type LegacyLineItem = NonNullable<LegacyExtractedDocument["lineItems"]>[number];
  const lineItems: LegacyLineItem[] = (extraction.line_items ?? []).map((item) => {
    const legacy: LegacyLineItem = {
      extractedProductName: item.description ?? "",
      quantity: typeof item.quantity === "number" ? item.quantity : 0,
    };
    const num = pickProductNumber(item);
    if (num) legacy.extractedProductNumber = num;
    if (typeof item.position === "number" && Number.isFinite(item.position)) {
      legacy.extractedPositionNumber = String(item.position);
    }
    if (typeof item.unit_price_net === "number") {
      legacy.extractedPrice = item.unit_price_net;
    }
    return legacy;
  });

  const out: LegacyExtractedDocument = {
    customer: Object.keys(customer).length ? customer : undefined,
    billingAddress: Object.keys(billingAddress).length ? billingAddress : undefined,
    shippingAddress,
    lineItems,
    documentExtraction: extraction,
  };

  const notes = deriveOrderNotesText(extraction);
  if (notes) {
    out.orderNotes = notes;
    out.offerNotes = notes;
  }

  if (extraction.document.delivery_date) {
    /* delivery_date wandert für Angebots-Pfad als validUntil-ähnlicher Hinweis ins
       offerNotes — validUntil bleibt leer, weil Semantik anders ist. */
  }

  return out;
}

/** Defensive Validierung + Auto-Fill defaulter Felder, falls das Modell schludert. */
export function normalizeDocumentExtractionInPlace(extraction: DocumentExtraction): void {
  if (!extraction.document) {
    extraction.document = {
      type: "unknown",
      number: null,
      date: null,
      delivery_date: null,
      currency: "EUR",
      total_net: null,
      language: "de",
      recipient_is_meta: false,
    };
  }
  if (!extraction.buyer) {
    extraction.buyer = {
      company: null,
      street: null,
      zip: null,
      city: null,
      country: null,
      vat_id: null,
      customer_number: null,
      contact_person: null,
      email: null,
      phone: null,
    };
  }
  if (!extraction.delivery_address) {
    extraction.delivery_address = {
      same_as_buyer: true,
      company: null,
      street: null,
      zip: null,
      city: null,
      country: null,
      delivery_window: null,
    };
  }
  if (!extraction.terms) {
    extraction.terms = {
      incoterms: null,
      payment: null,
      partial_delivery_allowed: null,
      notes: null,
    };
  }
  if (!Array.isArray(extraction.line_items)) {
    extraction.line_items = [];
  }
  extraction.line_items = extraction.line_items.map((it, idx) => ({
    position: typeof it.position === "number" && Number.isFinite(it.position) ? it.position : idx + 1,
    quantity: typeof it.quantity === "number" && Number.isFinite(it.quantity) ? it.quantity : 0,
    unit: typeof it.unit === "string" && it.unit.trim() ? it.unit : "Stk",
    supplier_sku: it.supplier_sku ?? null,
    buyer_sku: it.buyer_sku ?? null,
    description: typeof it.description === "string" ? it.description : "",
    attributes: {
      color: it?.attributes?.color ?? null,
      surface: it?.attributes?.surface ?? null,
      dimensions_raw: it?.attributes?.dimensions_raw ?? null,
      system: it?.attributes?.system ?? null,
    },
    unit_price_net:
      typeof it.unit_price_net === "number" && Number.isFinite(it.unit_price_net)
        ? it.unit_price_net
        : null,
    line_total_net:
      typeof it.line_total_net === "number" && Number.isFinite(it.line_total_net)
        ? it.line_total_net
        : null,
    confidence_warnings: Array.isArray(it.confidence_warnings) ? it.confidence_warnings : [],
  }));
  if (!extraction.extraction_meta) {
    extraction.extraction_meta = {
      overall_confidence: "medium",
      warnings: [],
      calculated_total_net: null,
      total_matches_calculated: null,
    };
  } else {
    if (!Array.isArray(extraction.extraction_meta.warnings)) {
      extraction.extraction_meta.warnings = [];
    }
  }
}

/**
 * Berechnet calculated_total_net + Abgleich mit total_net und schreibt Warnungen.
 * Setzt overall_confidence runter, wenn etwas nicht passt.
 */
export function applyExtractionPostValidation(extraction: DocumentExtraction): void {
  let sum = 0;
  let priced = 0;
  for (const it of extraction.line_items) {
    if (typeof it.unit_price_net === "number" && typeof it.quantity === "number") {
      sum += it.unit_price_net * it.quantity;
      priced += 1;
    }
  }
  const calculated = priced > 0 ? Math.round(sum * 100) / 100 : null;
  extraction.extraction_meta.calculated_total_net = calculated;

  const totalNet = extraction.document.total_net;
  let totalMatches: boolean | null = null;
  if (typeof totalNet === "number" && totalNet > 0 && typeof calculated === "number") {
    const diff = Math.abs(totalNet - calculated) / totalNet;
    totalMatches = diff < 0.01;
    if (!totalMatches) {
      extraction.extraction_meta.warnings.push(
        `total_net (${totalNet.toFixed(2)}) weicht von calculated_total_net (${calculated.toFixed(2)}) ab`
      );
    }
  }
  extraction.extraction_meta.total_matches_calculated = totalMatches;

  let confidence: DocumentExtraction["extraction_meta"]["overall_confidence"] = "high";
  const buyerHasCompany = Boolean(extraction.buyer.company);
  const buyerHasCity = Boolean(extraction.buyer.city);
  const itemMissingCore = extraction.line_items.some(
    (it) => !it.description?.trim() || !(typeof it.quantity === "number" && it.quantity > 0)
  );
  if (!buyerHasCompany || !buyerHasCity || itemMissingCore) {
    confidence = "low";
  } else {
    const truncations = extraction.line_items.some((it) =>
      it.confidence_warnings?.includes("description_truncated")
    );
    if (truncations || totalMatches === false) confidence = "medium";
  }
  extraction.extraction_meta.overall_confidence = confidence;
}
