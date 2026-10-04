/**
 * Cross-Selling RuleEngine smoke tests (no Shopware).
 * Ausführung: npm test
 */
import { describe, it } from "vitest";
import type { CrossSellingRule, Product, RuleTargetCriteria } from "../../shared/schema";
import { RuleEngine } from "../../server/cross-selling/ruleEngine";
import type { ShopwareClient } from "../../server/shopware/shopware";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

const baseProduct = (overrides: Partial<Product> = {}): Product =>
  ({
    id: "src-1",
    productNumber: "SRC-001",
    name: "Source",
    price: 10,
    netPrice: 8.4,
    currency: "EUR",
    taxRate: 19,
    stock: 5,
    available: true,
    ...overrides,
  }) as Product;

// Aus scripts/testCrossSellRuleEngine.ts uebernommen: Pruefungen unveraendert, je Pruefung ein Vitest-Fall.
describe("CrossSellRuleEngine", () => {
  const engine = new RuleEngine();
  const p = baseProduct();

  const mockClient = {
    async fetchProducts(
      _limit?: number,
      _page?: number,
      search?: string
    ): Promise<{ products: Product[]; total: number }> {
      if (search === "TGT-002") {
        return {
          products: [
            baseProduct({
              id: "t2",
              productNumber: "TGT-002",
              name: "Target B",
              stock: 3,
            }),
          ],
          total: 1,
        };
      }
      return { products: [], total: 0 };
    },
  } as unknown as ShopwareClient;

  const tgtCrit: RuleTargetCriteria = {
    field: "productNumber",
    matchType: "exact",
    value: "TGT-002",
  };

  it("Quellbedingung 'equals' auf der Artikelnummer", () => {
    assert(
      engine.evaluateSourceConditions(p, [
        { field: "productNumber", operator: "equals", value: "SRC-001" },
      ]) === true,
      "equals on productNumber"
    );
    assert(
      engine.evaluateSourceConditions(p, [
        { field: "productNumber", operator: "equals", value: "OTHER" },
      ]) === false,
      "equals mismatch"
    );
  });

  it("exaktes Zielkriterium findet den Artikel", async () => {
    const matches = await engine.findMatchingProducts(p, [tgtCrit], mockClient);
    assert(matches.length === 1 && matches[0].productNumber === "TGT-002", "exact criterion resolves");
  });

  it("suggestCrossSelling übernimmt die Kategorie der Regel", async () => {
    const rule: CrossSellingRule = {
      id: "r1",
      name: "Rule 1",
      active: 1,
      category: "zubehoer",
      sourceConditions: [{ field: "productNumber", operator: "equals", value: "SRC-001" }],
      targetCriteria: [tgtCrit],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const suggestions = await engine.suggestCrossSelling(p, [rule], mockClient);
    assert(suggestions.length === 1, "suggestCrossSelling returns ranked list");
    assert(
      (suggestions[0] as { suggestCategory?: string }).suggestCategory === "zubehoer",
      "suggestCategory from rule.category",
    );
  });

  it("sameWidthAndDepth filtert auf gleiche Breite und Tiefe", async () => {
    const srcDim = baseProduct({
      id: "src-d",
      productNumber: "SRC-D",
      name: "Regal",
      dimensions: { width: 1000, length: 600, height: 2000 },
    });
    const mockDimClient = {
      async fetchProducts(
        _limit?: number,
        _page?: number,
        _search?: string,
        _categoryId?: string,
        _showInactive?: boolean,
        width?: number,
        _height?: number,
        depth?: number,
      ): Promise<{ products: Product[]; total: number }> {
        if (width === 1000 && depth === 600) {
          return {
            products: [
              baseProduct({
                id: "b1",
                productNumber: "BOD-1",
                name: "Boden",
                dimensions: { width: 1000, length: 600 },
              }),
              baseProduct({
                id: "b2",
                productNumber: "BOD-2",
                name: "Wrong depth",
                dimensions: { width: 1000, length: 500 },
              }),
            ],
            total: 2,
          };
        }
        return { products: [], total: 0 };
      },
    } as unknown as ShopwareClient;

    const dimRule: CrossSellingRule = {
      id: "r-dim",
      name: "Width depth",
      active: 1,
      category: "boeden",
      sourceConditions: [{ field: "productNumber", operator: "equals", value: "SRC-D" }],
      targetCriteria: [{ field: "dimensions", matchType: "sameWidthAndDepth", value: "" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const dimMatches = await engine.findMatchingProducts(srcDim, dimRule.targetCriteria, mockDimClient);
    assert(dimMatches.length === 1 && dimMatches[0].productNumber === "BOD-1", "sameWidthAndDepth filters pair");
  });
});
