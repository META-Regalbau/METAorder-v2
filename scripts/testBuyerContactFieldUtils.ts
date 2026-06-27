/**
 * Tests für Telefon-Plausibilität und Legacy-Buyer-Mapping.
 * Ausführung: npx tsx scripts/testBuyerContactFieldUtils.ts
 */

import {
  ensureLegacyBuyerContactMapping,
  isPlausiblePhoneNumber,
  sanitizePhoneField,
} from "../server/buyerContactFieldUtils";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected '${expected}' actual '${actual}'`);
}

console.log("=== buyerContactFieldUtils ===\n");

{
  assert(!isPlausiblePhoneNumber("4026212123456"), "13-digit GTIN rejected");
  assert(!isPlausiblePhoneNumber("4026212 309010"), "GTIN with space rejected");
  assert(isPlausiblePhoneNumber("+49 471 123456"), "+49 phone ok");
  assert(isPlausiblePhoneNumber("Tel: +39 0474 555123"), "labeled IT phone ok");
  assertEq(sanitizePhoneField("4026212123456"), undefined, "sanitize GTIN");
  console.log("  phone plausibility: OK");
}

{
  const extracted: Record<string, unknown> = {
    customer: { phone: "4026212123456", email: "buyer@test.de" },
    billingAddress: { street: "Hauptstraße 1" },
    documentExtraction: {
      buyer: {
        company: "ACME GmbH",
        street: "Hauptstraße 1",
        zip: "12345",
        city: "Berlin",
        country: "DE",
        vat_id: null,
        customer_number: null,
        contact_person: "Max Mustermann",
        email: "buyer@test.de",
        phone: "4026212123456",
      },
      delivery_address: { same_as_buyer: true, company: null, street: null, zip: null, city: null, country: null, delivery_window: null },
      document: { type: "quote_request", number: null, date: null, delivery_date: null, currency: "EUR", total_net: null, language: "de", recipient_is_meta: false },
      terms: { incoterms: null, payment: null, partial_delivery_allowed: null, notes: null },
      line_items: [],
      extraction_meta: { overall_confidence: "high", warnings: [], calculated_total_net: null, total_matches_calculated: null },
    },
  };
  ensureLegacyBuyerContactMapping(extracted);
  const cust = extracted.customer as Record<string, string>;
  const bill = extracted.billingAddress as Record<string, string>;
  assertEq(cust.company, "ACME GmbH", "company synced to customer");
  assertEq(bill.company, "ACME GmbH", "company synced to billing");
  assertEq(cust.firstName, "Max", "contact firstName");
  assertEq(cust.lastName, "Mustermann", "contact lastName");
  assert(cust.phone === undefined || !cust.phone.includes("4026212"), "GTIN removed from phone");
  assertEq(bill.zipCode, "12345", "zip mapped");
  console.log("  legacy buyer mapping + GTIN strip: OK");
}

{
  const extracted: Record<string, unknown> = {
    documentExtraction: {
      buyer: {
        company: "Grohe GmbH",
        street: "Musterweg 2",
        zip: "39031",
        city: "Bruneck",
        country: "IT",
        vat_id: null,
        customer_number: null,
        contact_person: "Thomas Bacher",
        email: "t.bacher@example.com",
        phone: "+39 0474 555123",
      },
      delivery_address: { same_as_buyer: true, company: null, street: null, zip: null, city: null, country: null, delivery_window: null },
      document: { type: "quote_request", number: null, date: null, delivery_date: null, currency: "EUR", total_net: null, language: "de", recipient_is_meta: false },
      terms: { incoterms: null, payment: null, partial_delivery_allowed: null, notes: null },
      line_items: [],
      extraction_meta: { overall_confidence: "high", warnings: [], calculated_total_net: null, total_matches_calculated: null },
    },
  };
  ensureLegacyBuyerContactMapping(extracted);
  assert(extracted.customer != null, "customer object created");
  assert(extracted.billingAddress != null, "billingAddress object created");
  const cust = extracted.customer as Record<string, string>;
  assertEq(cust.company, "Grohe GmbH", "company from docExtraction only");
  assertEq(cust.phone, "+39 0474 555123", "valid phone kept");
  console.log("  mapping without pre-existing legacy fields: OK");
}

{
  const extracted: Record<string, unknown> = {
    customer: { email: "only@test.de" },
    billingAddress: {
      company: "Footer GmbH",
      street: "Industriestr. 5",
      zipCode: "39031",
      city: "Bruneck",
      country: "IT",
    },
    documentExtraction: {
      buyer: {
        company: null,
        street: null,
        zip: null,
        city: null,
        country: null,
        vat_id: null,
        customer_number: null,
        contact_person: null,
        email: "only@test.de",
        phone: null,
      },
      delivery_address: { same_as_buyer: true, company: null, street: null, zip: null, city: null, country: null, delivery_window: null },
      document: { type: "purchase_order", number: null, date: null, delivery_date: null, currency: "EUR", total_net: null, language: "de", recipient_is_meta: false },
      terms: { incoterms: null, payment: null, partial_delivery_allowed: null, notes: null },
      line_items: [],
      extraction_meta: { overall_confidence: "low", warnings: [], calculated_total_net: null, total_matches_calculated: null },
    },
  };
  ensureLegacyBuyerContactMapping(extracted);
  const buyer = (extracted.documentExtraction as { buyer: Record<string, string | null> }).buyer;
  assertEq(buyer.company, "Footer GmbH", "legacy company synced back to buyer");
  assertEq(buyer.street, "Industriestr. 5", "legacy street synced back to buyer");
  assertEq(buyer.zip, "39031", "legacy zip synced back to buyer");
  console.log("  legacy → documentExtraction.buyer sync: OK");
}

console.log("\nAll tests passed.\n");
