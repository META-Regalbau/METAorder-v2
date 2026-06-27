/**
 * Strikt-Auto-Create — Unit-Tests.
 * Ausführung: npx tsx scripts/testCommercialStrictAutoCreate.ts
 */

import { DEFAULT_COMMERCIAL_AGENT } from "../server/aiConfig";
import { evaluateStrictAutoCreate } from "../server/commercialStrictAutoCreate";
import type { MatchingResult } from "../server/productMatcher";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

const baseSettings = {
  ...DEFAULT_COMMERCIAL_AGENT,
  enabled: true,
  autoCreateOffersEnabled: true,
  autoCreateOrdersEnabled: true,
  strictAutoCreateOnly: true,
  strictMinIntentConfidence: 0.95,
  strictMinCustomerMatchConfidence: 95,
  autoCreateSalesChannelId: "test-channel",
};

function fullExtracted(): Record<string, unknown> {
  return {
    customer: {
      email: "buyer@example.com",
      customerMatchConfidence: 98,
      shopwareCustomerAutoCreated: false,
    },
    billingAddress: {
      company: "ACME GmbH",
      street: "Hauptstraße 1",
      zipCode: "12345",
      city: "Berlin",
      country: "DE",
    },
    lineItems: [{ extractedProductName: "Schraube M8", quantity: 10 }],
    lineItemPlausibility: [{ index: 0, skipCatalogMatching: false }],
  };
}

function fullMatching(): MatchingResult {
  return {
    overallConfidence: 100,
    items: [
      {
        extractedProductName: "Schraube M8",
        quantity: 10,
        confidence: 100,
        status: "matched",
        matchedProduct: {
          id: "p1",
          productNumber: "4711",
          name: "Schraube",
          price: 1,
          confidence: 100,
        },
      },
    ],
  };
}

console.log("=== commercialStrictAutoCreate Unit Tests ===\n");

{
  const r = evaluateStrictAutoCreate({
    draftKind: "offer",
    agentSettings: baseSettings,
    extractedData: fullExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "quote_request", confidence: 0.97 },
  });
  assert(r.allowed, `all rules pass: ${r.reasons.join(", ")}`);
  console.log("  all rules pass → allowed: OK");
}

{
  const data = fullExtracted();
  delete (data.billingAddress as Record<string, unknown>).street;
  const r = evaluateStrictAutoCreate({
    draftKind: "offer",
    agentSettings: baseSettings,
    extractedData: data,
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "quote_request", confidence: 0.97 },
  });
  assert(!r.allowed && r.reasons.some((x) => x.includes("street")), "missing street");
  console.log("  missing street → blocked: OK");
}

{
  const data = fullExtracted();
  (data.customer as Record<string, unknown>).shopwareCustomerAutoCreated = true;
  const r = evaluateStrictAutoCreate({
    draftKind: "offer",
    agentSettings: baseSettings,
    extractedData: data,
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-new",
    intent: { intent: "quote_request", confidence: 0.97 },
  });
  assert(!r.allowed && r.reasons.includes("customer_was_auto_created_not_matched"), "auto-created customer");
  console.log("  auto-created customer → blocked: OK");
}

{
  const match = fullMatching();
  match.items[0].confidence = 95;
  const r = evaluateStrictAutoCreate({
    draftKind: "offer",
    agentSettings: baseSettings,
    extractedData: fullExtracted(),
    matchingResults: match,
    shopwareCustomerId: "cust-1",
    intent: { intent: "quote_request", confidence: 0.97 },
  });
  assert(!r.allowed && r.reasons.some((x) => x.includes("confidence_below_100")), "line confidence");
  console.log("  line confidence < 100 → blocked: OK");
}

{
  const data = fullExtracted();
  data.addressReviewHints = ["billing_country_missing"];
  const r = evaluateStrictAutoCreate({
    draftKind: "offer",
    agentSettings: baseSettings,
    extractedData: data,
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "quote_request", confidence: 0.97 },
  });
  assert(!r.allowed && r.reasons.includes("address_review_hints_present"), "review hints");
  console.log("  address review hints → blocked: OK");
}

{
  const r = evaluateStrictAutoCreate({
    draftKind: "offer",
    agentSettings: baseSettings,
    extractedData: fullExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "unclear", confidence: 0.99 },
  });
  assert(!r.allowed && r.reasons.includes("intent_unclear"), "unclear intent");
  console.log("  unclear intent → blocked: OK");
}

console.log("\nAll tests passed.\n");
