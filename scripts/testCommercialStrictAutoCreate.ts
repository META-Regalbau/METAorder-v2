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

// ---------------------------------------------------------------------------
// Bestellungen — gleiche Basis wie Angebote plus Preisabgleich / Dubletten
// ---------------------------------------------------------------------------

function fullOrderExtracted(): Record<string, unknown> {
  const data = fullExtracted();
  (data.lineItems as Array<Record<string, unknown>>)[0].extractedPrice = 1;
  return data;
}

const okPriceChecks = [{ index: 0, documentUnitPriceNet: 1, expectedUnitPriceNet: 1, source: "list" as const }];

{
  const r = evaluateStrictAutoCreate({
    draftKind: "order",
    agentSettings: baseSettings,
    extractedData: fullOrderExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "purchase_order", confidence: 0.97 },
    siblingDrafts: [],
    linePriceChecks: okPriceChecks,
  });
  assert(r.allowed, `order: all rules pass: ${r.reasons.join(", ")}`);
  assert(r.priceChecks?.length === 1 && r.priceChecks[0].ok, "order: price check reported ok");
  console.log("  order: all rules pass → allowed: OK");
}

{
  const r = evaluateStrictAutoCreate({
    draftKind: "order",
    agentSettings: { ...baseSettings, autoCreateOrdersEnabled: false },
    extractedData: fullOrderExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "purchase_order", confidence: 0.97 },
    siblingDrafts: [],
    linePriceChecks: okPriceChecks,
  });
  assert(!r.allowed && r.reasons.includes("auto_create_orders_disabled"), "order kill switch");
  console.log("  order: kill switch → blocked: OK");
}

{
  const prevEnv = process.env.B2B_SELLERS_DEFAULT_SALES_CHANNEL;
  const prevEnv2 = process.env.COMMERCIAL_AGENT_SALES_CHANNEL_ID;
  delete process.env.B2B_SELLERS_DEFAULT_SALES_CHANNEL;
  delete process.env.COMMERCIAL_AGENT_SALES_CHANNEL_ID;
  const noChannel = { ...baseSettings, autoCreateSalesChannelId: "" };
  const blocked = evaluateStrictAutoCreate({
    draftKind: "order",
    agentSettings: noChannel,
    extractedData: fullOrderExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "purchase_order", confidence: 0.97 },
    siblingDrafts: [],
    linePriceChecks: okPriceChecks,
  });
  assert(!blocked.allowed && blocked.reasons.includes("missing_sales_channel_id"), "order: missing channel");
  const viaCustomer = evaluateStrictAutoCreate({
    draftKind: "order",
    agentSettings: noChannel,
    extractedData: fullOrderExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "purchase_order", confidence: 0.97 },
    customerSalesChannelId: "channel-of-customer",
    siblingDrafts: [],
    linePriceChecks: okPriceChecks,
  });
  assert(viaCustomer.allowed, `order: customer-bound channel satisfies rule: ${viaCustomer.reasons.join(", ")}`);
  const offerBlocked = evaluateStrictAutoCreate({
    draftKind: "offer",
    agentSettings: noChannel,
    extractedData: fullExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "quote_request", confidence: 0.97 },
  });
  assert(!offerBlocked.allowed && offerBlocked.reasons.includes("missing_sales_channel_id"), "offer: missing channel");
  if (prevEnv !== undefined) process.env.B2B_SELLERS_DEFAULT_SALES_CHANNEL = prevEnv;
  if (prevEnv2 !== undefined) process.env.COMMERCIAL_AGENT_SALES_CHANNEL_ID = prevEnv2;
  console.log("  order+offer: sales channel required (customer-bound channel counts) → OK");
}

{
  const r = evaluateStrictAutoCreate({
    draftKind: "order",
    agentSettings: baseSettings,
    extractedData: fullOrderExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "purchase_order", confidence: 0.97 },
    siblingDrafts: [{ id: "other-draft", status: "created", shopwareEntityId: "sw-order-1" }],
    linePriceChecks: okPriceChecks,
  });
  assert(!r.allowed && r.reasons.includes("duplicate_buyer_document_number"), "order: duplicate PO number");
  const offerDup = evaluateStrictAutoCreate({
    draftKind: "offer",
    agentSettings: baseSettings,
    extractedData: fullExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "quote_request", confidence: 0.97 },
    siblingDrafts: [{ id: "other-draft", status: "review_required", shopwareEntityId: null }],
  });
  assert(!offerDup.allowed && offerDup.reasons.includes("duplicate_buyer_document_number"), "offer: duplicate doc number");
  console.log("  duplicate buyer document number → blocked (order + offer): OK");
}

{
  const r = evaluateStrictAutoCreate({
    draftKind: "order",
    agentSettings: baseSettings,
    extractedData: fullOrderExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "purchase_order", confidence: 0.97 },
    siblingDrafts: [],
  });
  assert(!r.allowed && r.reasons.includes("price_check_unavailable"), "order: price check unavailable");
  console.log("  order: price check unavailable → blocked: OK");
}

{
  const r = evaluateStrictAutoCreate({
    draftKind: "order",
    agentSettings: baseSettings,
    extractedData: fullExtracted(), // kein extractedPrice
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "purchase_order", confidence: 0.97 },
    siblingDrafts: [],
    linePriceChecks: [{ index: 0, documentUnitPriceNet: null, expectedUnitPriceNet: 1, source: "list" }],
  });
  assert(!r.allowed && r.reasons.includes("line_1_price_missing_in_document"), "order: price missing in document");
  console.log("  order: price missing in document → blocked: OK");
}

{
  const mismatch = evaluateStrictAutoCreate({
    draftKind: "order",
    agentSettings: baseSettings,
    extractedData: fullOrderExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "purchase_order", confidence: 0.97 },
    siblingDrafts: [],
    linePriceChecks: [{ index: 0, documentUnitPriceNet: 100, expectedUnitPriceNet: 90, source: "customer_specific" }],
  });
  assert(!mismatch.allowed && mismatch.reasons.includes("line_1_price_mismatch"), "order: price mismatch");
  assert(mismatch.priceChecks?.[0].deviationPercent === 11.11, `deviation reported: ${mismatch.priceChecks?.[0].deviationPercent}`);
  const withinTolerance = evaluateStrictAutoCreate({
    draftKind: "order",
    agentSettings: { ...baseSettings, strictPriceTolerancePercent: 2 },
    extractedData: fullOrderExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "purchase_order", confidence: 0.97 },
    siblingDrafts: [],
    linePriceChecks: [{ index: 0, documentUnitPriceNet: 91.5, expectedUnitPriceNet: 90, source: "customer_discount" }],
  });
  assert(withinTolerance.allowed, `order: within tolerance: ${withinTolerance.reasons.join(", ")}`);
  const manualOverride = evaluateStrictAutoCreate({
    draftKind: "order",
    agentSettings: baseSettings,
    extractedData: fullOrderExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "purchase_order", confidence: 0.97 },
    siblingDrafts: [],
    linePriceChecks: [
      { index: 0, documentUnitPriceNet: 100, expectedUnitPriceNet: 90, source: "list", manualUnitPriceNet: 100 },
    ],
  });
  assert(manualOverride.allowed, `order: manual price overrides mismatch: ${manualOverride.reasons.join(", ")}`);
  console.log("  order: price mismatch → blocked; tolerance + manual override → allowed: OK");
}

{
  // Angebot: Preis im Dokument ist nur informativ — kein Preisabgleich, kein Block.
  const r = evaluateStrictAutoCreate({
    draftKind: "offer",
    agentSettings: baseSettings,
    extractedData: fullExtracted(),
    matchingResults: fullMatching(),
    shopwareCustomerId: "cust-1",
    intent: { intent: "quote_request", confidence: 0.97 },
  });
  assert(r.allowed && !r.priceChecks, "offer: no price check");
  console.log("  offer: no price check applied → OK");
}

console.log("\nAll tests passed.\n");
