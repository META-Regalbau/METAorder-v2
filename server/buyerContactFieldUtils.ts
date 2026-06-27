/**
 * Telefon-Plausibilität (GTIN/EAN ausschließen) und Mapping von
 * documentExtraction.buyer → legacy customer / billingAddress.
 *
 * Ziel: Firma, Ansprechpartner, Adresse und Telefon erscheinen im Review-UI,
 * auch wenn kein Shopware-Kunde gefunden wurde.
 */

import type { DocumentExtraction, DocumentExtractionBuyer } from "@shared/documentExtractionSchema";
import { getMetaorderGtinDigitRoot } from "./lineItemCatalogIdentifiers";
import { mergeCompanyCustomerAndBilling } from "./extractedAddressNormalize";
import { legacyFirstLastFromContactPerson } from "./personNameNormalize";

const PHONE_LABEL_OR_FORMAT_RE =
  /[+()\-\/.]|(?:\b(tel\.?|telefon|phone|mobil|mob\.?|fax|fon)\b)/i;

function isEmptyValue(v: unknown): boolean {
  if (typeof v !== "string") return v == null;
  const s = v.trim();
  if (!s) return true;
  if (/^[-–—.•·]+$/.test(s)) return true;
  if (/^(n\/?a|na|none|unbekannt|unknown)$/i.test(s)) return true;
  return false;
}

function fillEmpty(obj: Record<string, unknown>, key: string, value: string | undefined): void {
  if (!value || !isEmptyValue(obj[key])) return;
  obj[key] = value;
}

/**
 * True, wenn der String wie eine Telefonnummer wirkt — keine GTIN/EAN/Artikelnummer.
 */
export function isPlausiblePhoneNumber(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/\b(gtin|ean|art\.?\s*nr\.?|artikelnummer|sku|hersteller\s*nr)\b/i.test(s)) return false;

  const digits = s.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 16) return false;

  const hasPhoneFormatting = PHONE_LABEL_OR_FORMAT_RE.test(s);
  const startsWithPlus = /^\s*\+/.test(s);
  const startsWithTrunkZero = /^0\d/.test(digits);

  // Reine Ziffernfolgen in typischen Barcode-Längen ohne Telefon-Format → kein Telefon.
  if ([8, 12, 13, 14].includes(digits.length) && !hasPhoneFormatting && !startsWithPlus) {
    return false;
  }

  // 13 Ziffern ohne + / Trenner sind fast immer EAN/GTIN.
  if (digits.length === 13 && !hasPhoneFormatting && !startsWithPlus) {
    return false;
  }

  // Firmen-GTIN-Wurzel (z. B. 4026212…) als „Telefon" abweisen.
  const gtinRoot = getMetaorderGtinDigitRoot();
  if (gtinRoot.length >= 5 && digits.startsWith(gtinRoot.slice(0, Math.min(7, gtinRoot.length)))) {
    if (!hasPhoneFormatting && !startsWithPlus && digits.length >= 10) {
      return false;
    }
  }

  // Lange reine Ziffern ohne Ländervorwahl / Ortskennzahl → eher Artikel-ID.
  if (digits.length >= 11 && !hasPhoneFormatting && !startsWithPlus && !startsWithTrunkZero) {
    return false;
  }

  return true;
}

/** Gibt bereinigte Telefonnummer zurück oder undefined (GTIN/EAN/Müll). */
export function sanitizePhoneField(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s || !isPlausiblePhoneNumber(s)) return undefined;
  return s;
}

function buyerSnapshot(extractedData: Record<string, unknown>): DocumentExtractionBuyer | null {
  const doc = extractedData.documentExtraction as DocumentExtraction | undefined;
  return doc?.buyer ?? null;
}

function ensureRecord(
  extractedData: Record<string, unknown>,
  key: "customer" | "billingAddress" | "shippingAddress"
): Record<string, unknown> {
  if (!extractedData[key] || typeof extractedData[key] !== "object") {
    extractedData[key] = {};
  }
  return extractedData[key] as Record<string, unknown>;
}

function applyBuyerToLegacyAddress(
  buyer: DocumentExtractionBuyer,
  target: Record<string, unknown>
): void {
  fillEmpty(target, "company", buyer.company?.trim() || undefined);
  fillEmpty(target, "street", buyer.street?.trim() || undefined);
  fillEmpty(target, "zipCode", buyer.zip?.trim() || undefined);
  fillEmpty(target, "city", buyer.city?.trim() || undefined);
  fillEmpty(target, "country", buyer.country?.trim() || undefined);
  fillEmpty(target, "email", buyer.email?.trim() || undefined);
  const phone = sanitizePhoneField(buyer.phone);
  fillEmpty(target, "phone", phone);

  const { firstName, lastName, isRole } = legacyFirstLastFromContactPerson(buyer.contact_person);
  if (!isRole) {
    fillEmpty(target, "firstName", firstName);
    fillEmpty(target, "lastName", lastName);
  }
}

function sanitizePhoneOnRecord(obj: Record<string, unknown> | undefined): void {
  if (!obj) return;
  const current = obj.phone;
  if (typeof current !== "string" || !current.trim()) return;
  const clean = sanitizePhoneField(current);
  if (clean) {
    obj.phone = clean;
  } else {
    delete obj.phone;
  }
}

function crossSyncContactFields(
  customer: Record<string, unknown>,
  billing: Record<string, unknown>
): void {
  fillEmpty(customer, "company", typeof billing.company === "string" ? billing.company : undefined);
  fillEmpty(billing, "company", typeof customer.company === "string" ? customer.company : undefined);
  fillEmpty(customer, "email", typeof billing.email === "string" ? billing.email : undefined);
  fillEmpty(billing, "email", typeof customer.email === "string" ? customer.email : undefined);
  fillEmpty(customer, "street", typeof billing.street === "string" ? billing.street : undefined);
  fillEmpty(billing, "street", typeof customer.street === "string" ? customer.street : undefined);
  fillEmpty(customer, "zipCode", typeof billing.zipCode === "string" ? billing.zipCode : undefined);
  fillEmpty(billing, "zipCode", typeof customer.zipCode === "string" ? customer.zipCode : undefined);
  fillEmpty(customer, "city", typeof billing.city === "string" ? billing.city : undefined);
  fillEmpty(billing, "city", typeof customer.city === "string" ? customer.city : undefined);
  fillEmpty(customer, "country", typeof billing.country === "string" ? billing.country : undefined);
  fillEmpty(billing, "country", typeof customer.country === "string" ? customer.country : undefined);

  const custPhone = sanitizePhoneField(customer.phone);
  const billPhone = sanitizePhoneField(billing.phone);
  if (custPhone) fillEmpty(billing, "phone", custPhone);
  if (billPhone) fillEmpty(customer, "phone", billPhone);

  fillEmpty(customer, "firstName", typeof billing.firstName === "string" ? billing.firstName : undefined);
  fillEmpty(customer, "lastName", typeof billing.lastName === "string" ? billing.lastName : undefined);
  fillEmpty(billing, "firstName", typeof customer.firstName === "string" ? customer.firstName : undefined);
  fillEmpty(billing, "lastName", typeof customer.lastName === "string" ? customer.lastName : undefined);
}

function fillBuyerField(
  buyer: DocumentExtractionBuyer,
  key: keyof DocumentExtractionBuyer,
  value: string | null | undefined
): void {
  if (!value?.trim()) return;
  const cur = buyer[key];
  if (typeof cur === "string" && cur.trim()) return;
  buyer[key] = value.trim();
}

/** Heuristik/Legacy → kanonisches documentExtraction.buyer (fill-only). */
function syncLegacyToDocumentExtractionBuyer(extractedData: Record<string, unknown>): void {
  const doc = extractedData.documentExtraction as DocumentExtraction | undefined;
  if (!doc) return;
  if (!doc.buyer) {
    doc.buyer = {
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
  const buyer = doc.buyer;
  const customer = extractedData.customer as Record<string, unknown> | undefined;
  const billing = extractedData.billingAddress as Record<string, unknown> | undefined;

  fillBuyerField(
    buyer,
    "company",
    (typeof billing?.company === "string" ? billing.company : undefined) ??
      (typeof customer?.company === "string" ? customer.company : undefined)
  );
  fillBuyerField(
    buyer,
    "email",
    (typeof customer?.email === "string" ? customer.email : undefined) ??
      (typeof billing?.email === "string" ? billing.email : undefined)
  );
  fillBuyerField(buyer, "street", typeof billing?.street === "string" ? billing.street : undefined);
  fillBuyerField(buyer, "zip", typeof billing?.zipCode === "string" ? billing.zipCode : undefined);
  fillBuyerField(buyer, "city", typeof billing?.city === "string" ? billing.city : undefined);
  fillBuyerField(buyer, "country", typeof billing?.country === "string" ? billing.country : undefined);

  const phone =
    sanitizePhoneField(customer?.phone) ??
    sanitizePhoneField(billing?.phone) ??
    sanitizePhoneField(buyer.phone);
  if (phone) fillBuyerField(buyer, "phone", phone);

  if (!buyer.contact_person?.trim()) {
    const first = typeof customer?.firstName === "string" ? customer.firstName.trim() : "";
    const last = typeof customer?.lastName === "string" ? customer.lastName.trim() : "";
    const fromBillingFirst = typeof billing?.firstName === "string" ? billing.firstName.trim() : "";
    const fromBillingLast = typeof billing?.lastName === "string" ? billing.lastName.trim() : "";
    const contact = [first || fromBillingFirst, last || fromBillingLast].filter(Boolean).join(" ").trim();
    if (contact) buyer.contact_person = contact;
  }
}

/**
 * Synchronisiert buyer → customer/billing, bereinigt Telefon-Felder,
 * stellt sicher dass das Review-UI Felder anzeigen kann.
 */
export function ensureLegacyBuyerContactMapping(extractedData: Record<string, unknown>): void {
  const buyer = buyerSnapshot(extractedData);
  const customer = ensureRecord(extractedData, "customer");
  const billing = ensureRecord(extractedData, "billingAddress");

  if (buyer) {
    applyBuyerToLegacyAddress(buyer, customer);
    applyBuyerToLegacyAddress(buyer, billing);
    if (buyer.phone) {
      const clean = sanitizePhoneField(buyer.phone);
      if (!clean && extractedData.documentExtraction && typeof extractedData.documentExtraction === "object") {
        (extractedData.documentExtraction as DocumentExtraction).buyer.phone = null;
      }
    }
  }

  sanitizePhoneOnRecord(customer);
  sanitizePhoneOnRecord(billing);
  const shipping = extractedData.shippingAddress as Record<string, unknown> | undefined;
  sanitizePhoneOnRecord(shipping);

  crossSyncContactFields(customer, billing);

  mergeCompanyCustomerAndBilling(
    extractedData as {
      customer?: { company?: string; firstName?: string; lastName?: string };
      billingAddress?: {
        company?: string;
        firstName?: string;
        lastName?: string;
        street?: string;
        zipCode?: string;
        city?: string;
        country?: string;
      };
      shippingAddress?: { company?: string };
    }
  );

  syncLegacyToDocumentExtractionBuyer(extractedData);
}
