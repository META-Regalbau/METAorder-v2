/**
 * Positionen von Hand freigeben („Passt so“), auch wenn sie unklar oder nur Vorschlag sind
 * (Wunsch 13.10.2026: bisher nur in der Klärung und nur ohne Alternativen möglich).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  applyAlternativeSelectionsToOfferMatchingItems,
  confirmAlternativeSelection,
  isOfferLineReadyForCreate,
  lineCanBeConfirmed,
  partitionDraftLines,
  type OfferDraftMatchItem,
} from "../../client/src/lib/offerDraftLineItems";

const product = { id: "p1", productNumber: "4026212439038", name: "META CLIP S3 | Anbauregal", price: 323, catalogPrice: 323, manualUnitPriceNet: 300 };
const suggestion = (extra: Partial<OfferDraftMatchItem> = {}): OfferDraftMatchItem => ({
  extractedProductName: "S3 CLIP 230 AR",
  quantity: 4,
  status: "uncertain",
  confidence: 89,
  matchedProduct: { ...product },
  alternativeMatches: [{ id: "p2", productNumber: "4026212305005", name: "Andere Ausführung", price: 282, confidence: 69 }],
  productScreen: { likelihood: "unclear" },
  ...extra,
});

describe("„Passt so“ anbieten", () => {
  it("bei Vorschlag, unklarer Zeile und Treffer unter 100 %, auch mit Alternativen", () => {
    assert.equal(lineCanBeConfirmed(suggestion(), "p1"), true);
    assert.equal(lineCanBeConfirmed(suggestion({ status: "matched", confidence: 92 }), "p1"), true);
  });

  it("nicht ohne Artikel, bei Bundles, bei sicheren und schon freigegebenen Zeilen", () => {
    assert.equal(lineCanBeConfirmed(suggestion({ matchedProduct: null }), undefined), false);
    assert.equal(lineCanBeConfirmed(suggestion({ bundle: { name: "Set" } }), "p1"), false);
    assert.equal(lineCanBeConfirmed(suggestion({ status: "matched", confidence: 100 }), "p1"), false);
    assert.equal(lineCanBeConfirmed(suggestion({ userConfirmedMatch: true }), "p1"), false);
  });
});

describe("Freigabe übernehmen", () => {
  it("gleicher Artikel: 100 %, matched, manueller Preis und Katalogpreis bleiben", () => {
    const input = confirmAlternativeSelection(0, "p1", { selectedProducts: {}, confirmedLines: {} });
    const [line] = applyAlternativeSelectionsToOfferMatchingItems([suggestion()], input);
    assert.equal(line.status, "matched");
    assert.equal(line.confidence, 100);
    assert.equal(line.userConfirmedMatch, true);
    assert.equal((line.matchedProduct as { manualUnitPriceNet?: number }).manualUnitPriceNet, 300);
    assert.equal(line.matchedProduct?.catalogPrice, 323);
    assert.equal(isOfferLineReadyForCreate(line, 0, input), true);
  });

  it("Alternative gewählt: neuer Artikel ohne alten manuellen Preis", () => {
    const input = confirmAlternativeSelection(0, "p2", { selectedProducts: {}, confirmedLines: {} });
    const [line] = applyAlternativeSelectionsToOfferMatchingItems([suggestion()], input);
    assert.equal(line.matchedProduct?.id, "p2");
    assert.equal((line.matchedProduct as { manualUnitPriceNet?: number }).manualUnitPriceNet, undefined);
  });
});

describe("Haupttabelle vs. Klärung", () => {
  it("unklare Zeilen gehen in die Klärung, freigegebene zurück in die Haupttabelle", () => {
    const items = [
      suggestion(),
      suggestion({ userConfirmedMatch: true }),
      suggestion({ productScreen: { likelihood: "likely_product" } }),
      suggestion({ matchedProduct: null, productScreen: { likelihood: "unlikely_product" } }),
    ];
    assert.deepEqual(partitionDraftLines(items, false), { mainIndices: [1, 2], clarificationIndices: [0, 3] });
    assert.deepEqual(partitionDraftLines(items, true), { mainIndices: [0, 1, 2], clarificationIndices: [3] });
  });
});
