/**
 * Rabattvorschläge (Wunsch 14.10.2026, Angebot 1942 Gerd Heinssen): Angebote starten beim Preis des
 * Kunden; der Mengenrabatt ist nur ein Vorschlag mit „Übernehmen“.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { acceptSuggestedDiscounts, applyManualLinePrice } from "../../server/commercial/draftLinePrice";
import { buildDiscountProposals, summarizeOpenProposals } from "../../client/src/lib/offerDraftDiscountProposals";

const heinssen = () => [
  { quantity: 3, matchedProduct: { id: "g", productNumber: "4026212325843", catalogPrice: 458, suggestedDiscount: 2 } },
  { quantity: 5, matchedProduct: { id: "a", productNumber: "4026212325881", catalogPrice: 407, suggestedDiscount: 5 } },
  { quantity: 1, matchedProduct: { id: "x", productNumber: "X", catalogPrice: 10 } },
];
// Preis des Kunden (Onlineshop = Shop-Preis)
const base = new Map([[0, 458], [1, 407], [2, 10]]);

describe("Rabatt übernehmen", () => {
  it("auf den Preis des Kunden, gemerkt als Handpreis mit Bezug", () => {
    const now = new Date("2026-10-14T08:00:00Z");
    const { items, accepted } = acceptSuggestedDiscounts(heinssen(), base, "osteiling", undefined, now);
    assert.deepEqual(accepted.map((a) => [a.index, a.unitPriceNet]), [[0, 448.84], [1, 386.65]]);
    assert.deepEqual(items[0].matchedProduct, {
      id: "g",
      productNumber: "4026212325843",
      catalogPrice: 458,
      suggestedDiscount: 2,
      manualUnitPriceNet: 448.84,
      manualPriceChangedBy: "osteiling (Rabattvorschlag 2 %)",
      manualPriceChangedAt: now.toISOString(),
      basePriceNet: 458,
      acceptedDiscountPercent: 2,
    });
    assert.equal((items[2].matchedProduct as { manualUnitPriceNet?: number }).manualUnitPriceNet, undefined);
  });

  it("nur gewählte Positionen; Handpreis und unbekannter Kundenpreis bleiben", () => {
    const list = heinssen();
    (list[1].matchedProduct as { manualUnitPriceNet?: number }).manualUnitPriceNet = 390;
    const { accepted } = acceptSuggestedDiscounts(list, new Map([[1, 407]]), "u", [0, 1]);
    assert.deepEqual(accepted, []);
  });

  it("Preis von Hand ändern hebt „übernommen“ auf, Zurücksetzen entfernt auch den Bezug", () => {
    const { items } = acceptSuggestedDiscounts(heinssen(), base, "u");
    const edited = applyManualLinePrice(items, 0, 440, "u");
    assert.ok(edited.ok);
    const mp = edited.items[0].matchedProduct as Record<string, unknown>;
    assert.equal(mp.acceptedDiscountPercent, undefined);
    assert.equal(mp.basePriceNet, 458);
    const reset = applyManualLinePrice(items, 0, null, "u");
    assert.ok(reset.ok);
    assert.equal((reset.items[0].matchedProduct as Record<string, unknown>).basePriceNet, undefined);
  });
});

describe("Vorschläge im Prüffenster", () => {
  const lines = new Map([
    [0, { unitPriceNet: 458, priceSource: "list" }],
    [1, { unitPriceNet: 407, priceSource: "list" }],
    [2, { unitPriceNet: 10, priceSource: "list" }],
  ]);

  it("offene Vorschläge mit Summe", () => {
    const proposals = buildDiscountProposals(heinssen(), lines);
    assert.deepEqual([...proposals.keys()], [0, 1]);
    assert.equal(proposals.get(1)!.proposedPriceNet, 386.65);
    assert.deepEqual(summarizeOpenProposals(proposals), { count: 2, baseTotal: 3409, proposedTotal: 3279.77, discountPercent: 3.8 });
  });

  it("übernommene zählen nicht mehr als offen, Handpreis ohne Vorschlag", () => {
    const { items } = acceptSuggestedDiscounts(heinssen(), base, "u", [0]);
    (items[1].matchedProduct as { manualUnitPriceNet?: number }).manualUnitPriceNet = 400;
    const proposals = buildDiscountProposals(items, lines);
    assert.equal(proposals.get(0)!.accepted, true);
    assert.equal(proposals.has(1), false);
    assert.equal(summarizeOpenProposals(proposals).count, 0);
  });
});
