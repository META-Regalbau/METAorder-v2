/**
 * Strikt-Auto-Create — Unit-Tests.
 * Ausführung: npm test
 */
import { describe, it } from "vitest";
import { DEFAULT_COMMERCIAL_AGENT } from "../../server/ai/aiConfig";
import { evaluateStrictAutoCreate } from "../../server/commercial/commercialStrictAutoCreate";
import type { MatchingResult } from "../../server/products/productMatcher";

// Aus scripts/testCommercialStrictAutoCreate.ts uebernommen: Pruefungen unveraendert, je Pruefung ein Vitest-Fall.
describe("CommercialStrictAutoCreate", () => {
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

  // ---------------------------------------------------------------------------
  // Bestellungen — gleiche Basis wie Angebote plus Preisabgleich / Dubletten
  // ---------------------------------------------------------------------------

  function fullOrderExtracted(): Record<string, unknown> {
    const data = fullExtracted();
    (data.lineItems as Array<Record<string, unknown>>)[0].extractedPrice = 1;
    return data;
  }

  const okPriceChecks = [{ index: 0, documentUnitPriceNet: 1, expectedUnitPriceNet: 1, source: "list" as const }];

  it("all rules pass → allowed", () => {
    const r = evaluateStrictAutoCreate({
      draftKind: "offer",
      agentSettings: baseSettings,
      extractedData: fullExtracted(),
      matchingResults: fullMatching(),
      shopwareCustomerId: "cust-1",
      intent: { intent: "quote_request", confidence: 0.97 },
    });
    assert(r.allowed, `all rules pass: ${r.reasons.join(", ")}`);
  });

  it("missing street → blocked", () => {
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
  });

  it("auto-created customer → blocked", () => {
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
  });

  it("line confidence < 100 → blocked", () => {
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
  });

  it("address review hints → blocked", () => {
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
  });

  it("unclear intent → blocked", () => {
    const r = evaluateStrictAutoCreate({
      draftKind: "offer",
      agentSettings: baseSettings,
      extractedData: fullExtracted(),
      matchingResults: fullMatching(),
      shopwareCustomerId: "cust-1",
      intent: { intent: "unclear", confidence: 0.99 },
    });
    assert(!r.allowed && r.reasons.includes("intent_unclear"), "unclear intent");
  });

  it("order: all rules pass → allowed", () => {
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
  });

  it("order: kill switch → blocked", () => {
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
  });

  it("order+offer: sales channel required (customer-bound channel counts)", () => {
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
  });

  it("duplicate buyer document number → blocked (order + offer)", () => {
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
  });

  it("order: price check unavailable → blocked", () => {
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
  });

  it("order: price missing in document → blocked", () => {
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
  });

  it("order: price mismatch → blocked; tolerance + manual override → allowed", () => {
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
  });

  it("offer: no price check applied", () => {
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
  });
});
