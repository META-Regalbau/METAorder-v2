/**
 * Bestellung „laut Angebot …“: Positionen aus dem META-Angebot übernehmen
 * (Steinke 202659143, Live 11.10.2026: „Einseitige Regalzeile … Laut Angebot 291037 KAHL“).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { applyOfferReference, detectOfferNumbers, distributeOfferPrices, offerToLines } from "../../server/commercial/draftOfferReference";
import type { MatchingResult } from "../../server/products/productMatcher";

const steinkeLine = {
  extractedProductName: "META MULTIPAL Palettenregal - Einseitige Regalzeile … Stückliste: 3x Ständer 120/20 4400x800 vzk kpl. multipal S; 20x Holm 4HS 140/15x2700 RAL 2001 kpl. Laut Angebot 291037 KAHL 31.08.2026.",
  extractedProductNumber: "ANGEBOT",
  quantity: 1,
  extractedPrice: 3889.21,
};

function steinkeDraft(withReference = true) {
  return {
    lineItems: [{ ...steinkeLine }],
    documentExtraction: {
      document: { total_net: 3889.21 },
      references: withReference ? { supplier_offer_number: "291037" } : {},
    },
  } as Record<string, any>;
}

function notFound(): MatchingResult {
  return { overallConfidence: 0, items: [{ extractedProductName: steinkeLine.extractedProductName, quantity: 1, confidence: 0, status: "not_found" }] };
}

const products = new Map(
  [
    { id: "p-staender", productNumber: "4026212100001", name: "Ständer 120/20 4400 x 800 vzk multipal S", price: 300 },
    { id: "p-holm", productNumber: "4026212100002", name: "Holm 4HS 140/15 x 2700 RAL 2001 multipal", price: 80 },
    { id: "p-rost", productNumber: "4026212100003", name: "Gitterrostboden 2700 x 800 multipal", price: 60 },
    { id: "p-clip", productNumber: "4026212011104", name: "META CLIP Grundregal 2500 x 1300 x 500", price: 250 },
  ].map((p) => [p.id, p]),
);
const catalog = {
  byId: (id: string) => products.get(id) as never,
  byIdentifier: (nr: string) => [...products.values()].find((p) => p.productNumber === nr) as never,
};

const configuredOffer = {
  id: "offer-291037",
  offerNumber: "291037",
  customerId: "cust-steinke",
  netPrice: 3889.21,
  taxStatus: "net",
  items: [
    { type: "headline", label: "Regalzeile" },
    {
      type: "product",
      quantity: 1,
      unitPrice: 3889.21,
      label: "Konfiguration Regalzeile",
      payload: {
        metaCalcConfigurationPayload: {
          partsList: [
            { productId: "p-staender", quantity: 3, description: "Ständer" },
            { productNumber: "4026212100002", quantity: 20, description: "Holm" },
          ],
          accessoryList: [{ productId: "p-rost", quantity: 10, description: "Gitterrost" }],
        },
      },
    },
    { type: "product", quantity: 1, optional: true, productId: "p-clip", unitPrice: 250, label: "Option" },
  ],
} as never;

describe("Angebotsnummer erkennen", () => {
  it("aus dem Verweis-Feld und aus dem Text", () => {
    assert.deepEqual(detectOfferNumbers(steinkeDraft()), ["291037"]);
    assert.deepEqual(detectOfferNumbers(steinkeDraft(false)), ["291037"]);
    assert.deepEqual(detectOfferNumbers({ lineItems: [{ extractedProductName: "Regal gemäß Angebots-Nr. 12345", quantity: 1 }] }), ["12345"]);
    assert.deepEqual(detectOfferNumbers({ lineItems: [{ extractedProductName: "Fachboden 1000x400", quantity: 2 }] }), []);
  });
});

describe("Angebotspositionen", () => {
  it("Konfiguration wird zur Stückliste, Optionen und Überschriften fallen weg", () => {
    const { lines, skippedOptional } = offerToLines(configuredOffer);
    assert.equal(skippedOptional, 1);
    assert.deepEqual(lines.map((l) => [l.productId ?? l.productNumber, l.quantity, l.fromConfiguration]), [
      ["p-staender", 3, true],
      ["4026212100002", 20, true],
      ["p-rost", 10, true],
    ]);
  });

  it("Brutto-Angebot: Stückpreis wird netto", () => {
    const { lines } = offerToLines({
      taxStatus: "gross",
      items: [{ type: "product", quantity: 2, productId: "p-clip", unitPrice: 297.5, price: { taxRules: [{ taxRate: 19 }] } }],
    } as never);
    assert.equal(lines[0].unitPriceNet, 250);
  });
});

describe("Angebot übernehmen", () => {
  it("Steinke: Stückliste aus dem Angebot wird zu Positionen, Original bleibt zur Kontrolle", async () => {
    const data = steinkeDraft();
    const matching = notFound();
    const ref = await applyOfferReference({ extractedData: data, matchingResults: matching, shopwareCustomerId: "cust-steinke", lookup: async () => configuredOffer, products: catalog });
    assert.equal(ref?.applied, true);
    assert.equal(ref?.totalsMatch, true);
    assert.equal(ref?.noteCode, "optional_skipped");
    assert.equal(data.lineItems.length, 3);
    assert.deepEqual(matching.items.map((i) => [i.matchedProduct?.id, i.quantity, i.status, i.confidence, i.matchStrategy]), [
      ["p-staender", 3, "matched", 100, "offer"],
      ["p-holm", 20, "matched", 100, "offer"],
      ["p-rost", 10, "matched", 100, "offer"],
    ]);
    assert.equal(data.offerReference.originalLineItems[0].extractedPrice, 3889.21);
    assert.equal(data.lineItemPlausibility.length, 3);
    // Angebotspreis der Konfiguration verteilt: Summe = Angebot, als Preis „von Angebot 291037“
    const sum = matching.items.reduce((s, i) => s + ((i.matchedProduct as any).manualUnitPriceNet ?? 0) * i.quantity, 0);
    assert.ok(Math.abs(sum - 3889.21) < 0.5, String(sum));
    assert.equal((matching.items[0].matchedProduct as any).manualPriceChangedBy, "Angebot 291037");
    assert.equal(data.lineItems[0].extractedPrice, (matching.items[0].matchedProduct as any).manualUnitPriceNet);
  });

  it("Preisverteilung: anteilig nach Katalogpreis, ohne Katalogpreis kein Preis", () => {
    const cfg = { configGroup: 0, configTotalNet: 1000, unitPriceNet: null };
    assert.deepEqual(
      distributeOfferPrices([
        { line: { ...cfg, quantity: 2 }, catalogNet: 100 },
        { line: { ...cfg, quantity: 1 }, catalogNet: 300 },
        { line: { unitPriceNet: 42, quantity: 3 }, catalogNet: 50 },
      ]),
      [200, 600, 42],
    );
    assert.deepEqual(
      distributeOfferPrices([
        { line: { ...cfg, quantity: 2 }, catalogNet: 100 },
        { line: { ...cfg, quantity: 1 }, catalogNet: null },
      ]),
      [null, null],
    );
  });

  it("Angebot eines anderen Kunden wird nicht übernommen", async () => {
    const data = steinkeDraft();
    const matching = notFound();
    const ref = await applyOfferReference({ extractedData: data, matchingResults: matching, shopwareCustomerId: "cust-andere", lookup: async () => configuredOffer, products: catalog });
    assert.equal(ref?.applied, false);
    assert.equal(ref?.noteCode, "other_customer");
    assert.equal(matching.items[0].status, "not_found");
    assert.equal(data.lineItems.length, 1);
  });

  it("nicht gefunden, schon zugeordnet, Teil fehlt im Katalog: nichts ersetzt", async () => {
    const missing = await applyOfferReference({ extractedData: steinkeDraft(), matchingResults: notFound(), shopwareCustomerId: null, lookup: async () => null, products: catalog });
    assert.equal(missing?.noteCode, "not_found");

    const sure: MatchingResult = { overallConfidence: 100, items: [{ extractedProductName: "x", quantity: 1, confidence: 100, status: "matched", matchedProduct: { id: "p-clip", productNumber: "x", name: "x", price: 1, confidence: 100 } }] };
    const already = await applyOfferReference({ extractedData: steinkeDraft(), matchingResults: sure, shopwareCustomerId: "cust-steinke", lookup: async () => configuredOffer, products: catalog });
    assert.equal(already?.noteCode, "already_matched");
    assert.equal(sure.items[0].matchedProduct?.id, "p-clip");

    const data = steinkeDraft();
    const partial = await applyOfferReference({
      extractedData: data,
      matchingResults: notFound(),
      shopwareCustomerId: "cust-steinke",
      lookup: async () => configuredOffer,
      products: { byId: (id) => (id === "p-rost" ? undefined : catalog.byId(id)), byIdentifier: catalog.byIdentifier },
    });
    assert.equal(partial?.applied, false);
    assert.equal(partial?.noteCode, "products_missing");
    assert.equal(partial?.noteCount, 1);
    assert.equal(data.lineItems.length, 1);
  });

  it("ohne Angebotsverweis passiert nichts", async () => {
    let called = false;
    const ref = await applyOfferReference({
      extractedData: { lineItems: [{ extractedProductName: "Fachboden 1000x400", quantity: 2 }] },
      matchingResults: notFound(),
      shopwareCustomerId: null,
      lookup: async () => {
        called = true;
        return null;
      },
      products: catalog,
    });
    assert.equal(ref, null);
    assert.equal(called, false);
  });
});
