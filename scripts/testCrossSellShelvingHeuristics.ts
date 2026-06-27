/**
 * Cross-Sell Regal-Heuristiken (ohne Shopware).
 * Run: npx tsx scripts/testCrossSellShelvingHeuristics.ts
 */

import type { Product } from "../shared/schema";
import { CROSS_SELL_CATEGORIES } from "../shared/schema";
import {
  DEFAULT_CROSS_SELL_SHELVING_PATTERN_CONFIG,
  findShelvingSupplements,
  mergeStagingCandidatesWithQuotas,
  normalizeFootprint,
  sameWidthAndDepth,
} from "../server/crossSellShelvingHeuristics";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

const base = (overrides: Partial<Product> = {}): Product =>
  ({
    id: "x",
    productNumber: "X",
    name: "X",
    price: 1,
    netPrice: 1,
    currency: "EUR",
    taxRate: 19,
    stock: 1,
    available: true,
    ...overrides,
  }) as Product;

void (async () => {
  console.log("=== crossSellShelvingHeuristics ===\n");

  const src = base({
    id: "s1",
    productNumber: "REG-1",
    name: "Steckrahmen 2000 x 600",
    categoryNames: ["Regalsysteme", "Fachbodenregale"],
    dimensions: { width: 1200, length: 600, height: 2000 },
  });
  const fp = normalizeFootprint(src);
  assert(fp.width === 1200 && fp.depth === 600, "normalizeFootprint prefers dimensions over name");

  const boden = base({
    id: "b1",
    productNumber: "FB-1",
    name: "Fachboden 1200 x 600 vzk",
    categoryNames: ["Fachböden"],
    dimensions: { width: 1200, length: 600 },
    stock: 5,
  });
  const diag = base({
    id: "d1",
    productNumber: "DV-1",
    name: "Diagonalverstrebung 1200",
    categoryNames: ["Verstrebungen"],
    dimensions: { width: 1200, length: 400 },
    stock: 2,
  });
  const fussEinfach = base({
    id: "f1",
    productNumber: "F-1",
    name: "Fuß einfach",
    categoryNames: ["Zubehör Regal"],
    dimensions: { width: 80, length: 600 },
    stock: 9,
  });
  const fussDoppel = base({
    id: "f2",
    productNumber: "F-2",
    name: "Fuß doppel",
    categoryNames: ["Zubehör Regal"],
    dimensions: { width: 80, length: 600 },
    stock: 8,
  });
  const zub = base({
    id: "z1",
    productNumber: "Z-1",
    name: "Verbinder-Set",
    categoryNames: ["Zubehör"],
    dimensions: { width: 1200, length: 600 },
    stock: 3,
  });

  const catalog = [src, boden, diag, fussEinfach, fussDoppel, zub];
  const hits = findShelvingSupplements(src, catalog, DEFAULT_CROSS_SELL_SHELVING_PATTERN_CONFIG);
  const cats = new Set(hits.map((h) => h.category));
  assert(cats.has(CROSS_SELL_CATEGORIES.BOARDS), "finds Boden");
  assert(cats.has(CROSS_SELL_CATEGORIES.DIAGONAL), "finds Diagonal");
  assert(cats.has(CROSS_SELL_CATEGORIES.SMALL_PARTS), "finds Kleinteil");
  assert(cats.has(CROSS_SELL_CATEGORIES.ACCESSORIES), "finds Zubehör");

  const merged = mergeStagingCandidatesWithQuotas(
    [{ product: base({ id: "r1", productNumber: "R1", name: "Regalteil", dimensions: { width: 100, length: 50 } }), category: "komponenten" }],
    hits,
    DEFAULT_CROSS_SELL_SHELVING_PATTERN_CONFIG,
  );
  assert(merged.length <= 10, "quota total cap");
  const pn = new Set(merged.map((m) => m.product.productNumber));
  assert(pn.size === merged.length, "dedupe merge");

  const a = { width: 1000, depth: 600 };
  const b = { width: 1002, depth: 601 };
  assert(sameWidthAndDepth(a, b, 5, 0.01), "tolerance");

  console.log("All shelving heuristic checks passed.\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
