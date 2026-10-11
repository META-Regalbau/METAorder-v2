/**
 * Beschriftete Maße in Händlerbestellungen (Roloff, 11.10.2026): „H3300xB1825xT1100mm“.
 * Vorher blieb nur „1100mm“ als Länge, die Vorschläge hatten falsche Maße (3300 x 2700 x 800).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { extractDimensions, parseLabeledShelfDimensions } from "../../server/products/productPropertyExtractor";
import { findIntelligentAlternatives } from "../../server/products/alternativeMatcher";

const product = (productNumber: string, name: string, stock = 10) =>
  ({ id: productNumber, productNumber, name, price: 100, netPrice: 100, currency: "EUR", taxRate: 19, stock, available: true, categoryNames: ["Palettenregale"] }) as never;

describe("Beschriftete Regalmaße", () => {
  it("H/B/T in beliebiger Schreibweise", () => {
    assert.deepEqual(parseLabeledShelfDimensions("Paletten-Grundregal 8xP 1000kg H3300xB1825xT1100mm 4E zn/2001"), { height: 3300, width: 1825, depth: 1100 });
    assert.deepEqual(parseLabeledShelfDimensions("Regal B 1825 x H 3300 x T 1100 mm"), { height: 3300, width: 1825, depth: 1100 });
    assert.deepEqual(parseLabeledShelfDimensions("Höhe: 2000 Breite: 1000 Tiefe: 500"), { height: 2000, width: 1000, depth: 500 });
    assert.equal(parseLabeledShelfDimensions("Fachboden 1000x400"), null);
  });

  it("gleiche Reihenfolge wie die META-Produktnamen (H x B x T)", () => {
    const fromOrder = extractDimensions(product("", "Paletten-Grundregal 8xP 1000kg H3300xB1825xT1100mm 4E zn/2001"));
    const fromCatalog = extractDimensions(product("x", "META MULTIPAL | Palettenregal | Grundregal | 3300 x 1825 x 1100 mm | Fachlast 1120 kg"));
    assert.deepEqual(
      { w: fromOrder.width, h: fromOrder.height, d: fromOrder.depth },
      { w: fromCatalog.width, h: fromCatalog.height, d: fromCatalog.depth },
    );
  });

  it("Vorschläge: das Regal mit den richtigen Maßen steht vorn", () => {
    const alternatives = findIntelligentAlternatives({
      extractedProductName: "Paletten-Grundregal 8xP 1000kg H3300xB1825xT1100mm 4E zn/2001",
      allProducts: [
        product("4026212136043", "META multipal GR 3300 x 2700 x 800 bis 1000 kg vzk / RAL 2001 kpl. S"),
        product("4026212136067", "META multipal GR 4400 x 2700 x 800 bis 1000 kg vzk / RAL 2001 kpl. S"),
        product("4026212348316", "META MULTIPAL | Palettenregal | Grundregal | 3300 x 1825 x 1100 mm | Fachlast 1120 kg | 4 Ebenen | 8 Paletten | verzinkt"),
      ],
    });
    assert.equal(alternatives[0]?.product.productNumber, "4026212348316");
  });
});
