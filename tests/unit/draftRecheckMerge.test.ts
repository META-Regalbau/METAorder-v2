/**
 * „Nochmal prüfen“ (THW Mannheim, Live 14.10.2026): Pos. 2 war von Hand auf 4026212249866 gesetzt,
 * der neue Abgleich fand über die von Pos. 1 kopierte EAN wieder das Anbauregal 4026212358629 (100 %)
 * und überschrieb die Freigabe.
 *
 *   Ausführung: npm test
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";

vi.mock("../../server/ai/aiConfig", () => ({ getAISettings: vi.fn(), getCommercialAgentSettings: vi.fn() }));
vi.mock("../../server/products/productMatcher", () => ({ matchProductsAgainstCatalog: vi.fn() }));
vi.mock("../../server/shopware/shopware", () => ({ ShopwareClient: vi.fn() }));

const { dropCopiedLineNumbers, mergeLineMatches } = await import("../../server/commercial/commercialDraftRecheck");

const product = (productNumber: string) => ({ id: productNumber, productNumber, name: productNumber, price: 1 });
const item = (extra: Record<string, unknown>) => ({ extractedProductName: "x", quantity: 1, confidence: 0, status: "not_found", ...extra }) as never;

describe("Nochmal prüfen: Zeilen zusammenführen", () => {
  it("von Hand freigegebene Zeile bleibt, auch wenn der neue Abgleich sicher etwas anderes findet", () => {
    const confirmed = item({ status: "matched", confidence: 100, userConfirmedMatch: true, matchedProduct: product("4026212249866") });
    const fresh = item({ status: "matched", confidence: 100, matchStrategy: "ean", matchedProduct: product("4026212358629") });
    const [merged] = mergeLineMatches([confirmed], [fresh], 1, ["4026212358629"]) as Array<{ matchedProduct: { productNumber: string } }>;
    assert.equal(merged.matchedProduct.productNumber, "4026212249866");
  });

  it("alter EAN-Treffer, dessen Nummer aus der Zeile entfernt wurde, zählt nicht mehr", () => {
    const old = item({ status: "matched", confidence: 100, matchStrategy: "ean", matchedProduct: product("4026212358629") });
    const fresh = item({ status: "not_found" });
    const [merged] = mergeLineMatches([old], [fresh], 1, [undefined]) as Array<{ status: string }>;
    assert.equal(merged.status, "not_found");
  });

  it("sonst bleibt ein sicherer alter Treffer, wenn der neue Abgleich nichts findet", () => {
    const old = item({ status: "matched", confidence: 100, matchStrategy: "ean", matchedProduct: product("4026212358629") });
    const [merged] = mergeLineMatches([old], [item({})], 1, ["4026212358629"]) as Array<{ status: string }>;
    assert.equal(merged.status, "matched");
  });
});

describe("Kopierte Nummern in älteren Entwürfen", () => {
  const extracted = () => ({
    lineItems: [
      { extractedProductName: "Anbau-Palettenregal 4 Ebenen mit 2250kg Fachlast | 3300x1825x1100", extractedProductNumber: "4026212358629", extractedPositionNumber: "1", quantity: 1 },
      { extractedProductName: "Grund-Palettenregal 4 Ebenen mit ca. 2000kg Fachlast | 3300x2700x800", extractedProductNumber: "4026212358629", extractedPositionNumber: "2", quantity: 1 },
    ],
    documentExtraction: {
      line_items: [
        { position: 1, description: "Anbau-Palettenregal 4 Ebenen mit 2250kg Fachlast", supplier_sku: "4026212358629", confidence_warnings: ["missing_quantity"] },
        { position: 2, description: "Grund-Palettenregal 4 Ebenen mit ca. 2000kg Fachlast", supplier_sku: "4026212358629", confidence_warnings: ["missing_quantity", "missing_supplier_sku"] },
      ],
    },
  });

  it("THW: nur bei Pos. 2 (Warnung „fehlt“) entfernt", () => {
    const data = extracted();
    assert.equal(dropCopiedLineNumbers(data), 1);
    assert.deepEqual(data.lineItems.map((l) => l.extractedProductNumber), ["4026212358629", undefined]);
    assert.equal(data.documentExtraction.line_items[1].supplier_sku, null);
  });

  it("andere Nummer in der Zeile (von Hand geändert) bleibt", () => {
    const data = extracted();
    data.lineItems[1].extractedProductNumber = "4026212136043";
    assert.equal(dropCopiedLineNumbers(data), 0);
  });
});
