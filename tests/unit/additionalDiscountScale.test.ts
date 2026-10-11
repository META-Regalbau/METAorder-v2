/**
 * Zusatzrabatt-Staffel des Händlers (WDU Partner Daten, wdu_partner_data_additional_discount_scale):
 * höchste erreichte Stufe, Stufen addieren sich nicht; wirkt zuletzt auf den Warenwert.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseAdditionalDiscountScale, pickAdditionalDiscount } from "../../shared/additionalDiscountScale";
import { DEFAULT_COMMERCIAL_AGENT } from "../../server/ai/aiConfig";
import { evaluateStrictAutoCreate } from "../../server/commercial/commercialStrictAutoCreate";
import { applyAdditionalDiscount, type PricedDraftLine } from "../../server/commercial/draftProfitability";

describe("Staffel lesen", () => {
  it("Schreibweisen aus dem Shop", () => {
    assert.deepEqual(parseAdditionalDiscountScale("ab 1.000 € 5%; ab 3.000 € 10%"), [
      { fromAmount: 1000, percent: 5 },
      { fromAmount: 3000, percent: 10 },
    ]);
    assert.deepEqual(parseAdditionalDiscountScale("ab 1.000 € 5%; ab 2.500 € 10%; ab 4.000 € 15%").map((t) => t.percent), [5, 10, 15]);
    assert.deepEqual(parseAdditionalDiscountScale("ab 2.500,50 EUR 7,5 %"), [{ fromAmount: 2500.5, percent: 7.5 }]);
    assert.deepEqual(parseAdditionalDiscountScale("1000€ = 3%\n5000 € - 6%"), [
      { fromAmount: 1000, percent: 3 },
      { fromAmount: 5000, percent: 6 },
    ]);
    assert.deepEqual(parseAdditionalDiscountScale(""), []);
    assert.deepEqual(parseAdditionalDiscountScale(null), []);
    assert.deepEqual(parseAdditionalDiscountScale("kein Rabatt"), []);
  });

  it("höchste erreichte Stufe, nicht addiert", () => {
    const tiers = parseAdditionalDiscountScale("ab 1.000 € 5%; ab 3.000 € 10%");
    assert.equal(pickAdditionalDiscount(tiers, 999.99), null);
    assert.equal(pickAdditionalDiscount(tiers, 1000)?.percent, 5);
    assert.equal(pickAdditionalDiscount(tiers, 2999)?.percent, 5);
    assert.equal(pickAdditionalDiscount(tiers, 3000)?.percent, 10);
  });
});

describe("Preisprüfung der Automatik", () => {
  const settings = { ...DEFAULT_COMMERCIAL_AGENT, enabled: true, autoCreateOrdersEnabled: true, strictAutoCreateOnly: true, strictMinIntentConfidence: 0.95, strictMinCustomerMatchConfidence: 95, autoCreateSalesChannelId: "c" };
  const run = (doc: number, extra: number | null) =>
    evaluateStrictAutoCreate({
      draftKind: "order",
      agentSettings: settings,
      extractedData: {
        customer: { email: "a@b.de", customerMatchConfidence: 100 },
        billingAddress: { company: "A", street: "S 1", zipCode: "12345", city: "B", country: "DE" },
        lineItems: [{ extractedProductName: "Ständerrahmen", quantity: 10, extractedPrice: doc }],
        lineItemPlausibility: [{ index: 0, skipCatalogMatching: false }],
      },
      matchingResults: { overallConfidence: 100, items: [{ extractedProductName: "x", quantity: 10, confidence: 100, status: "matched", matchedProduct: { id: "p", productNumber: "p", name: "p", price: 1, confidence: 100 } }] },
      shopwareCustomerId: "c1",
      intent: { intent: "purchase_order", confidence: 0.99 },
      siblingDrafts: [],
      linePriceChecks: [{ index: 0, documentUnitPriceNet: doc, expectedUnitPriceNet: 108, source: "customer_specific", additionalDiscountPercent: extra }],
    });

  it("Belegpreis mit eingerechnetem Zusatzrabatt gilt als passend", () => {
    const r = run(102.6, 5);
    assert.ok(r.allowed, r.reasons.join(","));
    assert.equal(r.priceChecks?.[0].withAdditionalDiscount, true);
  });

  it("Belegpreis ohne Zusatzrabatt passt weiterhin", () => {
    const r = run(108, 5);
    assert.ok(r.allowed, r.reasons.join(","));
    assert.equal(r.priceChecks?.[0].withAdditionalDiscount, undefined);
  });

  it("andere Abweichung bleibt Abweichung", () => {
    assert.ok(run(99.71, 5).reasons.includes("line_1_price_mismatch"));
    assert.ok(run(102.6, null).reasons.includes("line_1_price_mismatch"));
  });
});

describe("DB mit Zusatzrabatt", () => {
  const lines = (): PricedDraftLine[] => [
    { index: 0, quantity: 10, isBundle: false, priceSource: "customer_specific", parts: [{ ref: { productId: "a" } as never, quantityPerUnit: 1, unitPriceNet: 108 }] },
    { index: 1, quantity: 1, isBundle: false, priceSource: "manual", parts: [{ ref: { productId: "b" } as never, quantityPerUnit: 1, unitPriceNet: 50 }] },
  ];

  it("Stufe nach Warenwert, Shop-Preise gemindert, Handpreise nicht", () => {
    const l = lines();
    const hit = applyAdditionalDiscount(l, parseAdditionalDiscountScale("ab 1.000 € 5%; ab 3.000 € 10%"));
    assert.deepEqual(hit, { percent: 5, fromAmount: 1000, goodsNet: 1130 });
    assert.equal(l[0].parts[0].unitPriceNet, 102.6);
    assert.equal(l[1].parts[0].unitPriceNet, 50);
  });

  it("unter der ersten Stufe und ohne Staffel: nichts", () => {
    const l = lines();
    l[0].quantity = 1;
    assert.equal(applyAdditionalDiscount(l, parseAdditionalDiscountScale("ab 1.000 € 5%")), null);
    assert.equal(l[0].parts[0].unitPriceNet, 108);
    assert.equal(applyAdditionalDiscount(lines(), []), null);
  });
});
