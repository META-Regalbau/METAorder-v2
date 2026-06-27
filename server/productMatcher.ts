import { ShopwareClient } from "./shopware";
import { productCache } from "./productCache";
import type { Product } from "@shared/schema";
import { parseSystemRequirements, findSystemComponents, type SystemMatch } from "./systemMatcher";
import {
  extractProductMetadata,
  extractProductSeries,
  extractProductType,
  extractDimensions,
  extractLoadCapacity,
  areSeriesCompatible,
  dimensionsMatchExactly,
  type ProductMetadata
} from "./productPropertyExtractor";
import { findIntelligentAlternatives } from "./alternativeMatcher";
import { normalizeExtractedProductNumber } from "./articleNumberNormalize";
import {
  shouldSkipCatalogMatchingForLineItem,
  extractedLineHasProductKeywords,
} from "./lineItemProductScreening";
import {
  collectIdentifierSearchStrings,
  expandSixDigitGtinCandidates,
  isSixDigitGtinPrefixTypedInput,
  isSixDigitGtinSuffixExpandable,
  mergeLineItemSixDigitGtinPrefixes,
  resolveEffectiveLineIdentifiers,
  type ResolvedLineIdentifiers,
} from "./lineItemCatalogIdentifiers";
import { normalizeLearningLineKey } from "./commercialProductLearning";

export type CatalogMatchStrategy =
  | "ean"
  | "productNumber"
  | "manufacturerNumber"
  | "sapProductNumber"
  | "synthetic_gtin";

export interface ProductMatch {
  id: string;
  productNumber: string;
  name: string;
  price: number;
  confidence: number; // 0-100
  reasoning?: string; // Why this alternative was suggested (e.g., "Fachlast 150kg, 1000mm breit")
}

export interface LineItemMatch {
  extractedProductName: string;
  /** Positions-/Zeilennummer aus dem Quelldokument (nicht Menge). */
  extractedPositionNumber?: string;
  extractedProductNumber?: string;
  quantity: number;
  matchedProduct?: ProductMatch;
  alternativeMatches?: ProductMatch[];
  confidence: number; // 0-100
  status: "matched" | "uncertain" | "not_found";
  systemMatch?: SystemMatch;  // Für Regalsysteme
  /** Zeile ohne plausiblen Produktbezug — kein Katalog-Scan, keine Alternativen */
  catalogMatchSkipped?: boolean;
  // Holmebenen conversion tracking (Holme are sold as 2-piece sets)
  originalQuantity?: number; // Original quantity from request (e.g., 12 Holme)
  convertedQuantity?: number; // Converted quantity (e.g., 6 Holmebenen sets)
  conversionNote?: string; // Conversion explanation (e.g., "1 Holmebene = 2 Holme")
  /** Wie der Treffer zustande kam (Katalogabgleich) */
  matchStrategy?: CatalogMatchStrategy;
  /** Produkt existiert, ist im Shop aber deaktiviert (nur aktiver Cache hatte keinen Treffer) */
  catalogProductInactive?: boolean;
  inactiveMatchedProduct?: {
    id: string;
    productNumber: string;
    name: string;
    ean?: string;
  };
  /** Transparenz: zeigt an, wenn tenant-spezifisches Lernen den Match beeinflusst hat. */
  learningHint?: {
    type: "blocked_line" | "preferred_identifier";
    identifier?: string;
  };
}

function buildCatalogSkippedLineMatch(item: {
  extractedProductName: string;
  extractedPositionNumber?: string;
  extractedProductNumber?: string;
  quantity: number;
  learningBlocked?: boolean;
}): LineItemMatch {
  return {
    extractedProductName: item.extractedProductName,
    extractedPositionNumber: item.extractedPositionNumber?.trim() || undefined,
    extractedProductNumber: normalizeExtractedProductNumber(item.extractedProductNumber),
    quantity: item.quantity,
    confidence: 0,
    status: "not_found",
    catalogMatchSkipped: true,
    learningHint: item.learningBlocked ? { type: "blocked_line" } : undefined,
  };
}

export interface MatchingResult {
  items: LineItemMatch[];
  overallConfidence: number; // Average confidence across all items
}

export type MatchProductsAgainstCatalogOptions = {
  lineItemSixDigitGtinPrefixes?: string[];
  learnedBlockedLineKeys?: string[];
  learnedPreferredIdentifierByLineKey?: Record<string, string>;
};

const IDENTIFIER_SEPARATORS_RE = /[\s\u00A0\-–._/]/g;

function normalizeIdentifierValue(value: string | undefined | null): string | undefined {
  if (value == null || typeof value !== "string") return undefined;
  const compact = value.trim().replace(IDENTIFIER_SEPARATORS_RE, "");
  return compact ? compact.toLowerCase() : undefined;
}

function getSapProductIdentifierCandidates(product: Product): string[] {
  const out = new Set<string>();
  if (typeof product.sapProductNumber === "string" && product.sapProductNumber.trim()) {
    out.add(product.sapProductNumber.trim());
  }
  const cf = product.customFields;
  if (cf && typeof cf === "object") {
    for (const [key, value] of Object.entries(cf)) {
      if (typeof value !== "string" || !value.trim()) continue;
      if (/(^|[_\-.])(sap|matnr|material)([_\-.]|$)/i.test(key)) {
        out.add(value.trim());
      }
    }
  }
  return Array.from(out);
}

function getProductNormalizedIdentifiers(product: Product): {
  ean?: string;
  productNumber?: string;
  manufacturerNumber?: string;
  sapProductNumbers: string[];
} {
  return {
    ean: normalizeIdentifierValue(product.ean),
    productNumber: normalizeIdentifierValue(product.productNumber),
    manufacturerNumber: normalizeIdentifierValue(product.manufacturerNumber),
    sapProductNumbers: getSapProductIdentifierCandidates(product)
      .map((v) => normalizeIdentifierValue(v))
      .filter((v): v is string => Boolean(v)),
  };
}

function resolveLearnedPreferredIdentifier(
  lineItem: { extractedProductName: string },
  options?: MatchProductsAgainstCatalogOptions
): string | undefined {
  const key = normalizeLearningLineKey(lineItem.extractedProductName);
  if (!key) return undefined;
  const preferred = options?.learnedPreferredIdentifierByLineKey?.[key];
  return normalizeIdentifierValue(preferred);
}

function isLineBlockedByLearning(
  lineItem: { extractedProductName: string },
  options?: MatchProductsAgainstCatalogOptions
): boolean {
  const key = normalizeLearningLineKey(lineItem.extractedProductName);
  if (!key) return false;
  const blocked = options?.learnedBlockedLineKeys ?? [];
  return blocked.includes(key);
}

function pickBestInactiveCatalogProduct(
  products: Product[],
  ids: ResolvedLineIdentifiers,
  syntheticGtins: string[]
): { product: Product; strategy: CatalogMatchStrategy } | null {
  const primary = ids.primaryNormalized?.toLowerCase();
  if (primary) {
    for (const p of products) {
      if (normalizeIdentifierValue(p.ean) === primary) return { product: p, strategy: "ean" };
    }
    for (const p of products) {
      if (normalizeIdentifierValue(p.productNumber) === primary) return { product: p, strategy: "productNumber" };
    }
    for (const p of products) {
      const ids = getProductNormalizedIdentifiers(p);
      if (ids.sapProductNumbers.includes(primary)) {
        return { product: p, strategy: "sapProductNumber" };
      }
    }
  }
  for (const g of syntheticGtins) {
    const gl = normalizeIdentifierValue(g);
    if (!gl) continue;
    for (const p of products) {
      const ids = getProductNormalizedIdentifiers(p);
      if (ids.ean === gl || ids.productNumber === gl || ids.sapProductNumbers.includes(gl)) {
        return { product: p, strategy: "synthetic_gtin" };
      }
    }
  }
  const sn = normalizeIdentifierValue(ids.shortNumeric);
  if (sn) {
    for (const p of products) {
      if (normalizeIdentifierValue(p.manufacturerNumber) === sn) return { product: p, strategy: "manufacturerNumber" };
    }
  }
  return null;
}

async function applyInactiveCatalogHintIfNeeded(
  client: ShopwareClient,
  lineItem: { extractedProductName: string; extractedProductNumber?: string; quantity: number },
  match: LineItemMatch,
  sixDigitPrefixes: string[]
): Promise<void> {
  if (match.catalogProductInactive) return;
  const ids = resolveEffectiveLineIdentifiers(lineItem);
  const sixInact = ids.sixDigitSuffix;
  const lineCtxInact = [lineItem.extractedProductName, lineItem.extractedProductNumber].filter(Boolean).join(" ");
  const synthetic =
    sixInact &&
    sixDigitPrefixes.length > 0 &&
    !isSixDigitGtinPrefixTypedInput(sixInact) &&
    isSixDigitGtinSuffixExpandable(sixInact, sixDigitPrefixes, lineCtxInact)
      ? expandSixDigitGtinCandidates(sixInact, sixDigitPrefixes)
      : [];
  const strings = collectIdentifierSearchStrings(ids, synthetic);
  if (strings.length === 0) return;

  const found = await client.searchProductsByIdentifiersIncludeInactive(strings);
  const inactiveOnly = found.filter((p) => p.active === false);
  if (inactiveOnly.length === 0) return;

  const picked = pickBestInactiveCatalogProduct(inactiveOnly, ids, synthetic);
  if (!picked) return;

  match.matchedProduct = {
    id: picked.product.id,
    productNumber: picked.product.productNumber,
    name: picked.product.name,
    price: picked.product.price,
    confidence: 88,
  };
  match.inactiveMatchedProduct = {
    id: picked.product.id,
    productNumber: picked.product.productNumber,
    name: picked.product.name,
    ean: picked.product.ean,
  };
  match.catalogProductInactive = true;
  match.matchStrategy = picked.strategy;
  match.confidence = 88;
  match.status = "uncertain";
}

/**
 * BUSINESS RULE: Holme are only sold as "Holmebenen" (2-piece sets)
 * This function detects "Holm" (without "ebene") and converts to "Holmebene" search term.
 * 
 * Example: "META Holm MULTIPAL 120/20, 2700mm" → "META Holmebene MULTIPAL 120/20, 2700mm"
 */
function convertHolmToHolmebene(productName: string): {
  searchTerm: string;
  isHolmConversion: boolean;
} {
  // Case-insensitive check for "Holm" but NOT "Holmebene"
  const lowerName = productName.toLowerCase();
  
  // Check if it contains "holm" but not "holmebene" or "holmebenen"
  const hasHolm = lowerName.includes('holm');
  const hasHolmebene = lowerName.includes('holmebene');
  
  if (hasHolm && !hasHolmebene) {
    // Replace "Holm" with "Holmebene" (preserving case)
    const searchTerm = productName.replace(/\bHolm\b/gi, 'Holmebene');
    console.log(`[Holm Conversion] Detected standalone Holm: "${productName}" → "${searchTerm}"`);
    return {
      searchTerm,
      isHolmConversion: true,
    };
  }
  
  return {
    searchTerm: productName,
    isHolmConversion: false,
  };
}

/**
 * Match extracted line items against Shopware product catalog
 */
export async function matchProductsAgainstCatalog(
  lineItems: Array<{
    extractedProductName: string;
    extractedPositionNumber?: string;
    extractedProductNumber?: string;
    quantity: number;
  }>,
  shopwareUrl: string,
  apiKey: string,
  apiSecret: string,
  options?: MatchProductsAgainstCatalogOptions
): Promise<MatchingResult> {
  const client = new ShopwareClient({ shopwareUrl, apiKey, apiSecret });
  const sixDigitPrefixes = mergeLineItemSixDigitGtinPrefixes(options?.lineItemSixDigitGtinPrefixes ?? null);
  const matchOpts: MatchProductsAgainstCatalogOptions = {
    lineItemSixDigitGtinPrefixes: sixDigitPrefixes,
    learnedBlockedLineKeys: options?.learnedBlockedLineKeys,
    learnedPreferredIdentifierByLineKey: options?.learnedPreferredIdentifierByLineKey,
  };
  const useCache = process.env.MATCHING_USE_CACHE !== "false";
  let cachedProducts: Product[] = [];

  if (useCache) {
    const status = productCache.getStatus();
    if (!status.isPopulated && !status.isLoading) {
      try {
        await productCache.refresh(client);
      } catch (error) {
        console.warn("[Product Matcher] Cache refresh failed, falling back to streaming:", error);
      }
    }
    cachedProducts = productCache.getProducts();
  }
  
  // Initialize best matches for each line item
  const bestMatches: Map<number, LineItemMatch> = new Map();
  // Store top matches for alternatives
  const topMatches: Map<number, ProductMatch[]> = new Map();
  
  lineItems.forEach((item, index) => {
    bestMatches.set(index, {
      extractedProductName: item.extractedProductName,
      extractedPositionNumber: item.extractedPositionNumber?.trim() || undefined,
      extractedProductNumber: normalizeExtractedProductNumber(item.extractedProductNumber),
      quantity: item.quantity,
      confidence: 0,
      status: "not_found" as const,
    });
    topMatches.set(index, []);
  });

  let allProducts: Product[] = [];
  console.log(`[Product Matcher] Starting product matching for ${lineItems.length} line items`);

  if (cachedProducts.length > 0) {
    console.log(`[Product Matcher] Using cached catalog (${cachedProducts.length} products)`);
    allProducts = cachedProducts;
    lineItems.forEach((item, index) => {
      if (isLineBlockedByLearning(item, options)) {
        bestMatches.set(index, buildCatalogSkippedLineMatch({ ...item, learningBlocked: true }));
        topMatches.set(index, []);
        return;
      }
      if (shouldSkipCatalogMatchingForLineItem(item).skip) {
        bestMatches.set(index, buildCatalogSkippedLineMatch(item));
        topMatches.set(index, []);
        return;
      }
      const currentBest = bestMatches.get(index)!;
      const currentTopMatches = topMatches.get(index)!;
      const batchMatches = matchLineItemAgainstBatchWithAlternatives(item, cachedProducts, matchOpts);
      if (batchMatches.bestMatch.confidence >= currentBest.confidence) {
        bestMatches.set(index, batchMatches.bestMatch);
      }
      const allTopMatches = [...currentTopMatches, ...batchMatches.alternatives];
      const sortedUnique = allTopMatches
        .filter((match, idx, arr) => arr.findIndex(m => m.id === match.id) === idx)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10);
      topMatches.set(index, sortedUnique);
    });
  } else {
    let page = 1;
    const BATCH_SIZE = 500;
    let hasMore = true;

    console.log(`[Product Matcher] Will fetch products in batches of ${BATCH_SIZE}`);

    // Fetch and match products in batches until we run out of pages
    while (hasMore) {
      const { products, total } = await client.fetchProducts(BATCH_SIZE, page);

      console.log(`[Product Matcher] Fetched page ${page} with ${products.length} products (total in catalog: ${total})`);

      allProducts.push(...products);

      if (products.length < BATCH_SIZE) {
        hasMore = false;
      }

      if (products.length === 0) {
        break;
      }

      lineItems.forEach((item, index) => {
        if (isLineBlockedByLearning(item, options)) {
          if (!bestMatches.get(index)?.catalogMatchSkipped) {
            bestMatches.set(index, buildCatalogSkippedLineMatch({ ...item, learningBlocked: true }));
            topMatches.set(index, []);
          }
          return;
        }
        if (shouldSkipCatalogMatchingForLineItem(item).skip) {
          if (!bestMatches.get(index)?.catalogMatchSkipped) {
            bestMatches.set(index, buildCatalogSkippedLineMatch(item));
            topMatches.set(index, []);
          }
          return;
        }
        const currentBest = bestMatches.get(index)!;
        const currentTopMatches = topMatches.get(index)!;
        const batchMatches = matchLineItemAgainstBatchWithAlternatives(item, products, matchOpts);

        if (batchMatches.bestMatch.confidence >= currentBest.confidence) {
          bestMatches.set(index, batchMatches.bestMatch);
        }

        const allTopMatches = [...currentTopMatches, ...batchMatches.alternatives];
        const sortedUnique = allTopMatches
          .filter((match, idx, arr) => arr.findIndex(m => m.id === match.id) === idx)
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 10);
        topMatches.set(index, sortedUnique);
      });

      page++;

      if (page > 100) {
        console.warn("Product fetch exceeded 100 pages. Stopping pagination.");
        break;
      }
    }

    console.log(`[Product Matcher] Finished matching. Processed ${page - 1} pages.`);
  }

  for (let idx = 0; idx < lineItems.length; idx++) {
    const m = bestMatches.get(idx);
    if (!m || m.catalogMatchSkipped) continue;
    if (m.status === "matched" && m.confidence >= 90) continue;
    if (m.confidence >= 60 && m.matchedProduct) continue;
    await applyInactiveCatalogHintIfNeeded(client, lineItems[idx]!, m, sixDigitPrefixes);
  }

  // IMPROVED: Use intelligent category-based alternative matching
  bestMatches.forEach((match, index) => {
    if (match.catalogMatchSkipped) {
      return;
    }
    const lineItem = lineItems[index];
    const allowIntelligentAlternatives =
      extractedLineHasProductKeywords(match.extractedProductName) ||
      !!(lineItem?.extractedProductNumber && String(lineItem.extractedProductNumber).trim());

    // Use intelligent alternative matcher with category profiles
    const intelligentAlternatives = allowIntelligentAlternatives
      ? findIntelligentAlternatives(
          {
            extractedProductName: match.extractedProductName,
            extractedProductNumber: match.extractedProductNumber,
            categories: undefined, // Will be extracted from product name
            matchedProduct: match.matchedProduct
              ? allProducts.find((p) => p.id === match.matchedProduct!.id)
              : undefined,
            allProducts,
          },
          5
        )
      : [];

    if (intelligentAlternatives.length > 0) {
      // Convert AlternativeMatch to ProductMatch format (with reasoning)
      match.alternativeMatches = intelligentAlternatives.map(alt => ({
        id: alt.product.id,
        productNumber: alt.product.productNumber,
        name: alt.product.name,
        price: alt.product.price,
        confidence: alt.score,
        reasoning: alt.reasoning, // Include intelligent reasoning
      }));
      
      console.log(`[Product Matcher] Found ${intelligentAlternatives.length} intelligent alternatives for "${match.extractedProductName}"`);
      intelligentAlternatives.forEach(alt => {
        console.log(`  - ${alt.product.name} (score: ${alt.score.toFixed(0)}%, ${alt.reasoning})`);
      });
    } else {
      console.log(`[Product Matcher] No intelligent alternatives found for "${match.extractedProductName}"`);
    }
    
    // Add dimension-based alternatives for "not_found" products
    // This finds products with matching dimensions (e.g., "2700", "120/20") in their names
    const allowDimensionAlternatives = extractedLineHasProductKeywords(match.extractedProductName);
    if (allowDimensionAlternatives && (match.status === "not_found" || match.confidence < 60)) {
      const dimensionAlternatives = findDimensionBasedAlternatives(
        match.extractedProductName,
        allProducts,
        match.matchedProduct?.id
      );
      
      if (dimensionAlternatives.length > 0) {
        const currentAlts = match.alternativeMatches || [];
        const dimAlts = dimensionAlternatives.map(alt => ({
          id: alt.id,
          productNumber: alt.productNumber,
          name: alt.name,
          price: alt.price,
          confidence: 70 // Medium-high confidence for dimension matches
        }));
        
        // Merge, deduplicate, re-sort, and THEN trim to 5
        const mergedAlts = [...currentAlts, ...dimAlts];
        const uniqueMergedAlts = mergedAlts
          .filter((alt, idx, arr) => arr.findIndex(a => a.id === alt.id) === idx)
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 5);
        
        // Check if content actually changed
        const contentChanged = uniqueMergedAlts.length !== currentAlts.length ||
          uniqueMergedAlts.some((alt, idx) => alt.id !== currentAlts[idx]?.id);
        
        if (contentChanged) {
          match.alternativeMatches = uniqueMergedAlts;
          console.log(`[Product Matcher] Added ${dimAlts.length} dimension-based alternatives for "${match.extractedProductName}" (total: ${uniqueMergedAlts.length})`);
        }
      }
    }
    
    // Add Grundregal/Anbauregal alternatives for matched products
    const allowShelfAlternatives =
      extractedLineHasProductKeywords(match.extractedProductName) || !!match.matchStrategy;
    if (match.matchedProduct && match.confidence >= 60 && allowShelfAlternatives) {
      const matchedProductFull = allProducts.find(p => p.id === match.matchedProduct!.id);
      if (matchedProductFull) {
        const shelfAlternatives = findShelfTypeAlternatives(matchedProductFull, allProducts);
        if (shelfAlternatives.length > 0) {
          // Add shelf alternatives to the existing alternatives
          const currentAlts = match.alternativeMatches || [];
          const shelfAlts = shelfAlternatives.map(alt => ({
            id: alt.id,
            productNumber: alt.productNumber,
            name: alt.name,
            price: alt.price,
            confidence: 85 // High confidence for variant alternatives
          }));
          
          // Merge, deduplicate, re-sort, and THEN trim to 5
          const mergedAlts = [...currentAlts, ...shelfAlts];
          const uniqueMergedAlts = mergedAlts
            .filter((alt, idx, arr) => arr.findIndex(a => a.id === alt.id) === idx)
            .sort((a, b) => b.confidence - a.confidence) // Re-sort by confidence
            .slice(0, 5); // Now trim to 5 after re-sorting
          
          // Check if content actually changed (not just length)
          const contentChanged = uniqueMergedAlts.length !== currentAlts.length ||
            uniqueMergedAlts.some((alt, idx) => alt.id !== currentAlts[idx]?.id);
          
          if (contentChanged) {
            match.alternativeMatches = uniqueMergedAlts;
            console.log(`[Product Matcher] Merged ${shelfAlts.length} Grundregal/Anbauregal alternatives for "${match.extractedProductName}" (total: ${uniqueMergedAlts.length})`);
          }
        }
      }
    }
  });
  
  // Check for system requests (e.g., shelf systems)
  lineItems.forEach((item, index) => {
    if (isLineBlockedByLearning(item, options)) {
      return;
    }
    if (shouldSkipCatalogMatchingForLineItem(item).skip) {
      return;
    }
    const requirements = parseSystemRequirements(item.extractedProductName);
    
    // Only try system matching if we have a total width (indicates system request)
    if (requirements.totalWidth) {
      console.log(`[Product Matcher] Detected system request for: "${item.extractedProductName}"`);
      const systemMatch = findSystemComponents(requirements, allProducts);
      
      if (systemMatch.isSystemRequest && systemMatch.confidence > 0) {
        const currentMatch = bestMatches.get(index)!;
        
        // Use system match if it has higher confidence
        if (systemMatch.confidence > currentMatch.confidence && systemMatch.baseProduct) {
          console.log(`[Product Matcher] Using system match with ${systemMatch.confidence}% confidence`);
          currentMatch.systemMatch = systemMatch;
          currentMatch.confidence = systemMatch.confidence;
          currentMatch.status = systemMatch.confidence >= 60 ? "matched" : "uncertain";
          
          // Fill matchedProduct with base product for compatibility
          currentMatch.matchedProduct = {
            id: systemMatch.baseProduct.id,
            productNumber: systemMatch.baseProduct.productNumber,
            name: systemMatch.baseProduct.name,
            price: systemMatch.baseProduct.price,
            confidence: systemMatch.confidence
          };
          
          // Add extension product as alternative if available
          if (systemMatch.extensionProduct) {
            currentMatch.alternativeMatches = [{
              id: systemMatch.extensionProduct.id,
              productNumber: systemMatch.extensionProduct.productNumber,
              name: `${systemMatch.extensionProduct.name} (${systemMatch.extensionQuantity}x)`,
              price: systemMatch.extensionProduct.price,
              confidence: systemMatch.confidence
            }];
          }
        }
      }
    }
  });

  // Convert map to array
  const matchedItems = Array.from(bestMatches.values());

  const scoredForOverall = matchedItems.filter((item) => !item.catalogMatchSkipped);
  const overallConfidence =
    scoredForOverall.length > 0
      ? Math.round(
          scoredForOverall.reduce((sum, item) => sum + item.confidence, 0) /
            scoredForOverall.length
        )
      : 0;

  return {
    items: matchedItems,
    overallConfidence,
  };
}

/**
 * Find dimension-based alternatives by extracting numbers AND product type keywords from product name
 * For example: "META Holm MULTIPAL, Typ 120/20, Länge 2.700 mm" → finds all HOLME with "2700" in name
 * Product type keywords: Holm, Holmebene, Ständer, Rahmen, etc.
 */
function findDimensionBasedAlternatives(
  extractedProductName: string,
  allProducts: Product[],
  excludeProductId?: string
): Product[] {
  // Extract significant numbers from the product name (at least 3 digits or patterns like "120/20")
  const dimensionPattern = /\b(\d{3,}|\d+\/\d+)\b/g;
  const dimensions = extractedProductName.match(dimensionPattern) || [];
  
  if (dimensions.length === 0) {
    console.log(`[Dimension Alternatives] No dimensions found in "${extractedProductName}"`);
    return [];
  }
  
  // Normalize dimensions (remove dots/commas from numbers like "2.700" → "2700")
  const normalizedDimensions = dimensions.map(d => d.replace(/[.,]/g, ''));
  
  // Extract product type keywords (important: these define what the product IS)
  // If "Holm" is in the name, we ONLY want Holme/Holmebenen!
  const productTypeKeywords = [
    'holm', 'holmebene', 'holmebenen',
    'ständer', 'staender',
    'rahmen',
    'traverse', 'traversen',
    'fachboden', 'fachböden', 'fachboeden',
    'grundregal', 'anbauregal',
    'regalfeld', 'regalfelder'
  ];
  
  const normalizedExtractedName = extractedProductName.toLowerCase();
  const matchedKeywords = productTypeKeywords.filter(keyword => 
    normalizedExtractedName.includes(keyword)
  );
  
  console.log(`[Dimension Alternatives] Extracted from "${extractedProductName}":`);
  console.log(`  - Dimensions: [${normalizedDimensions.join(', ')}]`);
  console.log(`  - Product types: [${matchedKeywords.join(', ') || 'none'}]`);
  
  // Find products that:
  // 1. Contain at least one dimension in their name
  // 2. If we have product type keywords, they MUST also contain at least one of them
  const alternatives = allProducts.filter(p => {
    if (p.id === excludeProductId) return false;
    
    // Normalize product name for comparison
    const normalizedProductName = p.name.replace(/[.,]/g, '').toLowerCase();
    
    // Check if any dimension appears in the product name
    const hasMatchingDimension = normalizedDimensions.some(dim => 
      normalizedProductName.includes(dim.toLowerCase())
    );
    
    if (!hasMatchingDimension) return false;
    
    // If we have product type keywords, the product MUST match at least one
    if (matchedKeywords.length > 0) {
      const hasMatchingType = matchedKeywords.some(keyword => 
        normalizedProductName.includes(keyword)
      );
      
      if (!hasMatchingType) return false;
    }
    
    return true;
  });
  
  console.log(`[Dimension Alternatives] Found ${alternatives.length} products matching dimensions [${normalizedDimensions.join(', ')}] and types [${matchedKeywords.join(', ') || 'any'}]`);
  
  // Sort by how many dimensions match (most matches first)
  alternatives.sort((a, b) => {
    const aNormalizedName = a.name.replace(/[.,]/g, '').toLowerCase();
    const bNormalizedName = b.name.replace(/[.,]/g, '').toLowerCase();
    
    const aMatches = normalizedDimensions.filter(dim => aNormalizedName.includes(dim.toLowerCase())).length;
    const bMatches = normalizedDimensions.filter(dim => bNormalizedName.includes(dim.toLowerCase())).length;
    return bMatches - aMatches;
  });
  
  // Return top 10 dimension-based alternatives
  return alternatives.slice(0, 10);
}

/**
 * Find Grundregal/Anbauregal alternatives for a product
 * If the matched product is a Grundregal, find corresponding Anbauregal (and vice versa)
 */
function findShelfTypeAlternatives(
  matchedProduct: Product,
  allProducts: Product[]
): Product[] {
  // Check if this product has a Regal-Typ property
  const regalTypProp = matchedProduct.properties?.find(p => 
    p.groupName.toLowerCase().includes('regal-typ') ||
    p.groupName.toLowerCase().includes('typ')
  );
  
  if (!regalTypProp) {
    return []; // Not a shelf product
  }
  
  const isGrundregal = regalTypProp.optionName.toLowerCase().includes('grundregal');
  const isAnbauregal = regalTypProp.optionName.toLowerCase().includes('anbauregal') ||
                       regalTypProp.optionName.toLowerCase().includes('anbau');
  
  if (!isGrundregal && !isAnbauregal) {
    return []; // Neither Grundregal nor Anbauregal
  }
  
  // Find the opposite type
  const targetType = isGrundregal ? 'anbauregal' : 'grundregal';
  
  // Filter products that:
  // 1. Are in the same category
  // 2. Have the opposite Regal-Typ
  // 3. Have similar dimensions (±5% tolerance)
  const alternatives = allProducts.filter(p => {
    if (p.id === matchedProduct.id) return false;
    
    // Check if in same category
    const hasSameCategory = matchedProduct.categoryNames?.some(cat => 
      p.categoryNames?.includes(cat)
    );
    if (!hasSameCategory) return false;
    
    // Check Regal-Typ property
    const pRegalTypProp = p.properties?.find(prop => 
      prop.groupName.toLowerCase().includes('regal-typ') ||
      prop.groupName.toLowerCase().includes('typ')
    );
    if (!pRegalTypProp) return false;
    
    const hasTargetType = pRegalTypProp.optionName.toLowerCase().includes(targetType);
    if (!hasTargetType) return false;
    
    // Check similar dimensions (height, length, width within 5%)
    if (matchedProduct.dimensions && p.dimensions) {
      const heightMatch = matchedProduct.dimensions.height && p.dimensions.height &&
        Math.abs(matchedProduct.dimensions.height - p.dimensions.height) <= matchedProduct.dimensions.height * 0.05;
      const lengthMatch = matchedProduct.dimensions.length && p.dimensions.length &&
        Math.abs(matchedProduct.dimensions.length - p.dimensions.length) <= matchedProduct.dimensions.length * 0.05;
      
      // Height and length should match, but width can differ
      if (heightMatch && lengthMatch) {
        return true;
      }
    }
    
    return false;
  });
  
  console.log(`[Shelf Type Alternatives] Found ${alternatives.length} ${targetType} alternatives for ${matchedProduct.name}`);
  
  return alternatives;
}

type ScoredProductRow = ProductMatch & {
  matchStrategy?: CatalogMatchStrategy;
  /** Nur Namens-Ähnlichkeit, kein Identifier-Treffer */
  nameSimilarityOnly?: boolean;
};

const NAME_SIMILARITY_MIN = 0.85;

function alternativeMeetsConfidenceThreshold(alt: ScoredProductRow): boolean {
  if (alt.nameSimilarityOnly) return alt.confidence >= 70;
  if (alt.matchStrategy) return alt.confidence >= 50;
  return alt.confidence >= 70;
}

function findProductBySyntheticGtins(
  products: Product[],
  syntheticGtins: string[]
): { row: ScoredProductRow; product: Product } | null {
  for (const g of syntheticGtins) {
    const gl = g.toLowerCase();
    for (const p of products) {
      if (p.ean?.toLowerCase() === gl) {
        return {
          row: {
            id: p.id,
            productNumber: p.productNumber,
            name: p.name,
            price: p.price,
            confidence: 100,
            matchStrategy: "synthetic_gtin",
          },
          product: p,
        };
      }
    }
  }
  for (const g of syntheticGtins) {
    const gl = g.toLowerCase();
    for (const p of products) {
      if (p.productNumber?.toLowerCase() === gl) {
        return {
          row: {
            id: p.id,
            productNumber: p.productNumber,
            name: p.name,
            price: p.price,
            confidence: 100,
            matchStrategy: "synthetic_gtin",
          },
          product: p,
        };
      }
    }
  }
  return null;
}

/** Wenn genau ein Katalog-Artikel die EAN mit diesem Präfix beginnt (z. B. 6 Ziffern META-GTIN-Anfang). */
function findProductByUniqueEanPrefix(
  products: Product[],
  prefix: string
): { row: ScoredProductRow; product: Product } | null {
  const pref = normalizeIdentifierValue(prefix);
  if (!pref || pref.length < 6) return null;
  const hits: Product[] = [];
  for (const p of products) {
    const e = normalizeIdentifierValue(p.ean);
    if (e && e.startsWith(pref)) hits.push(p);
  }
  if (hits.length !== 1) return null;
  const p = hits[0];
  return {
    row: {
      id: p.id,
      productNumber: p.productNumber,
      name: p.name,
      price: p.price,
      confidence: 94,
      matchStrategy: "ean",
    },
    product: p,
  };
}

function findProductByExactManufacturerNumber(
  products: Product[],
  mfg: string
): { row: ScoredProductRow; product: Product } | null {
  const m = normalizeIdentifierValue(mfg);
  if (!m) return null;
  for (const p of products) {
    if (normalizeIdentifierValue(p.manufacturerNumber) === m) {
      return {
        row: {
          id: p.id,
          productNumber: p.productNumber,
          name: p.name,
          price: p.price,
          confidence: 100,
          matchStrategy: "manufacturerNumber",
        },
        product: p,
      };
    }
  }
  return null;
}

function findProductByExactSapProductNumber(
  products: Product[],
  sapLike: string
): { row: ScoredProductRow; product: Product } | null {
  const needle = normalizeIdentifierValue(sapLike);
  if (!needle) return null;
  for (const p of products) {
    const ids = getProductNormalizedIdentifiers(p);
    if (!ids.sapProductNumbers.includes(needle)) continue;
    return {
      row: {
        id: p.id,
        productNumber: p.productNumber,
        name: p.name,
        price: p.price,
        confidence: 100,
        matchStrategy: "sapProductNumber",
      },
      product: p,
    };
  }
  return null;
}

/**
 * Match a single line item against a batch of products
 */
function matchLineItemAgainstBatch(
  lineItem: {
    extractedProductName: string;
    extractedPositionNumber?: string;
    extractedProductNumber?: string;
    quantity: number;
  },
  products: Product[],
  matchOptions?: MatchProductsAgainstCatalogOptions
): LineItemMatch {
  const ids = resolveEffectiveLineIdentifiers(lineItem);
  const prefixes = matchOptions?.lineItemSixDigitGtinPrefixes ?? [];
  const six = ids.sixDigitSuffix;
  const lineCtxMatch = [lineItem.extractedProductName, lineItem.extractedProductNumber].filter(Boolean).join(" ");
  const syntheticGtins =
    six && prefixes.length > 0 && !isSixDigitGtinPrefixTypedInput(six) && isSixDigitGtinSuffixExpandable(six, prefixes, lineCtxMatch)
      ? expandSixDigitGtinCandidates(six, prefixes)
      : [];

  const learnedPreferredIdentifier = resolveLearnedPreferredIdentifier(lineItem, matchOptions);
  const extractedProductNumber =
    learnedPreferredIdentifier ??
    ids.primaryNormalized ??
    normalizeExtractedProductNumber(lineItem.extractedProductNumber) ??
    ids.shortNumeric;

  const { extractedProductName, quantity } = lineItem;

  // BUSINESS RULE: Apply Holm→Holmebene conversion and quantity adjustment
  const holmConversion = convertHolmToHolmebene(extractedProductName);
  const searchTerm = holmConversion.searchTerm;

  let originalQuantity: number | undefined;
  let convertedQuantity: number | undefined;
  let conversionNote: string | undefined;

  if (holmConversion.isHolmConversion) {
    originalQuantity = quantity;
    convertedQuantity = Math.ceil(quantity / 2);
    conversionNote = "1 Holmebene = 2 Holme";
    console.log(`[Holm Conversion] Quantity: ${originalQuantity} Holme → ${convertedQuantity} Holmebenen-Sets`);
  }

  const numPrimary = normalizeIdentifierValue(ids.primaryNormalized) ?? "";
  const numPrefilter = numPrimary || normalizeIdentifierValue(ids.shortNumeric) || undefined;

  console.log(
    `[Product Matcher] Matching item: "${searchTerm}" (primary: ${numPrimary || "none"}, display#: ${extractedProductNumber || "none"}) against ${products.length} products`
  );

  const candidates = prefilterProducts(searchTerm, numPrefilter, products);
  const scoredProducts: ScoredProductRow[] = candidates.map((product) => {
    let confidence = 0;
    let matchReason = "";
    let matchStrategy: CatalogMatchStrategy | undefined;
    let nameSimilarityOnly = false;
    const extractedNum = numPrimary;
    const productIds = getProductNormalizedIdentifiers(product);
    const extractedIsNumericOnly = /^\d+$/.test(extractedNum);
    const extractedHasLetters = /[a-z]/i.test(extractedNum);

    if (extractedNum) {
      if (productIds.ean === extractedNum) {
        confidence = 100;
        matchStrategy = "ean";
        matchReason = `exact EAN match: ${product.ean}`;
      } else if (productIds.productNumber === extractedNum) {
        confidence = 100;
        matchStrategy = "productNumber";
        matchReason = `exact productNumber match: ${product.productNumber}`;
      } else if (productIds.manufacturerNumber === extractedNum) {
        confidence = 100;
        matchStrategy = "manufacturerNumber";
        matchReason = `exact manufacturerNumber match: ${product.manufacturerNumber}`;
      } else if (productIds.sapProductNumbers.includes(extractedNum)) {
        confidence = 100;
        matchStrategy = "sapProductNumber";
        matchReason = `exact SAP product number match: ${extractedNum}`;
      } else if (
        !extractedIsNumericOnly &&
        extractedHasLetters &&
        extractedNum.length >= 6 &&
        productIds.productNumber &&
        (productIds.productNumber.startsWith(extractedNum) || extractedNum.startsWith(productIds.productNumber))
      ) {
        confidence = 74;
        matchStrategy = "productNumber";
        matchReason = `prefix productNumber match: ${product.productNumber}`;
      } else if (
        !extractedIsNumericOnly &&
        extractedHasLetters &&
        extractedNum.length >= 6 &&
        productIds.manufacturerNumber &&
        (productIds.manufacturerNumber.startsWith(extractedNum) ||
          extractedNum.startsWith(productIds.manufacturerNumber))
      ) {
        confidence = 72;
        matchStrategy = "manufacturerNumber";
        matchReason = `prefix manufacturerNumber match: ${product.manufacturerNumber}`;
      } else if (
        !extractedIsNumericOnly &&
        extractedHasLetters &&
        extractedNum.length >= 6 &&
        productIds.sapProductNumbers.some(
          (sap) => sap.startsWith(extractedNum) || extractedNum.startsWith(sap)
        )
      ) {
        confidence = 72;
        matchStrategy = "sapProductNumber";
        matchReason = `prefix SAP product number match`;
      }
    }

    if (confidence === 0) {
      const lettersInSearch = (searchTerm.match(/[a-zA-ZÄÖÜäöüß]/g) || []).length;
      if (lettersInSearch >= 2 && extractedLineHasProductKeywords(searchTerm)) {
        const nameSimilarity = calculateStringSimilarity(
          normalizeString(searchTerm),
          normalizeString(product.name)
        );
        if (nameSimilarity >= NAME_SIMILARITY_MIN) {
          nameSimilarityOnly = true;
          confidence = Math.round(nameSimilarity * 100);
          matchReason = `name similarity ${confidence}%: "${product.name}"`;
        }
      }
    }

    if (confidence >= 80) {
      console.log(`  [Match Found] ${confidence}% - ${product.name} (${product.productNumber}) - ${matchReason}`);
    }

    return {
      id: product.id,
      productNumber: product.productNumber,
      name: product.name,
      price: product.price,
      confidence,
      matchStrategy,
      nameSimilarityOnly: nameSimilarityOnly || undefined,
    };
  });

  scoredProducts.sort((a, b) => b.confidence - a.confidence);

  let bestMatch: ScoredProductRow =
    scoredProducts[0] || {
      id: "",
      productNumber: "",
      name: "",
      price: 0,
      confidence: 0,
    };

  if (bestMatch.confidence < 90 && syntheticGtins.length > 0) {
    const syn = findProductBySyntheticGtins(products, syntheticGtins);
    if (syn && syn.row.confidence > bestMatch.confidence) {
      bestMatch = syn.row;
      console.log(`[Product Matcher] Synthetic GTIN hit: ${syntheticGtins.join(", ")} → ${syn.product.productNumber}`);
    }
  }

  if (bestMatch.confidence < 90 && six && isSixDigitGtinPrefixTypedInput(six)) {
    const prefHit = findProductByUniqueEanPrefix(products, six);
    if (prefHit && prefHit.row.confidence > bestMatch.confidence) {
      bestMatch = prefHit.row;
      console.log(`[Product Matcher] Unique EAN prefix hit: ${six} → ${prefHit.product.productNumber}`);
    }
  }

  if (bestMatch.confidence < 90 && ids.shortNumeric) {
    const mfgHit = findProductByExactManufacturerNumber(products, ids.shortNumeric);
    if (mfgHit && mfgHit.row.confidence > bestMatch.confidence) {
      bestMatch = mfgHit.row;
      console.log(`[Product Matcher] Manufacturer number hit: ${ids.shortNumeric} → ${mfgHit.product.productNumber}`);
    }
  }

  if (bestMatch.confidence < 90 && extractedProductNumber) {
    const sapHit = findProductByExactSapProductNumber(products, extractedProductNumber);
    if (sapHit && sapHit.row.confidence > bestMatch.confidence) {
      bestMatch = sapHit.row;
      console.log(`[Product Matcher] SAP product number hit: ${extractedProductNumber} → ${sapHit.product.productNumber}`);
    }
  }

  let status: "matched" | "uncertain" | "not_found";
  if (bestMatch && bestMatch.confidence >= 90) {
    status = "matched";
  } else if (bestMatch && bestMatch.confidence >= 60) {
    status = "uncertain";
  } else {
    status = "not_found";
  }

  let alternatives: ScoredProductRow[];
  if (bestMatch.confidence >= 60) {
    alternatives = scoredProducts
      .filter((p) => p.id !== bestMatch.id)
      .filter(alternativeMeetsConfidenceThreshold)
      .slice(0, 10);
  } else {
    alternatives = scoredProducts.filter(alternativeMeetsConfidenceThreshold).slice(0, 10);
  }

  console.log(
    `[Product Matcher] Best match for "${searchTerm}": ${bestMatch?.confidence || 0}% - ${bestMatch?.name || "none"} (status: ${status}, alternatives: ${alternatives.length})`
  );

  let filteredAlternatives = alternatives;
  const productTypeKeywords = [
    "holm",
    "holmebene",
    "holmebenen",
    "ständer",
    "staender",
    "rahmen",
    "traverse",
    "traversen",
    "fachboden",
    "fachböden",
    "fachboeden",
    "grundregal",
    "anbauregal",
    "regalfeld",
    "regalfelder",
  ];

  const normalizedExtractedName = searchTerm.toLowerCase();
  const matchedKeywords = productTypeKeywords.filter((keyword) => normalizedExtractedName.includes(keyword));

  if (matchedKeywords.length > 0) {
    filteredAlternatives = alternatives.filter((alt) => {
      const normalizedAltName = alt.name.toLowerCase();
      return matchedKeywords.some((keyword) => normalizedAltName.includes(keyword));
    });

    if (filteredAlternatives.length < alternatives.length) {
      console.log(
        `[Product Type Filter] Filtered alternatives for "${searchTerm}" from ${alternatives.length} to ${filteredAlternatives.length} by product types: [${matchedKeywords.join(", ")}]`
      );
    }
  }

  const { matchStrategy: bestStrategy, nameSimilarityOnly: _nsi, ...bestAsProductMatch } = bestMatch;

  return {
    extractedProductName,
    extractedPositionNumber: lineItem.extractedPositionNumber?.trim() || undefined,
    extractedProductNumber,
    quantity: convertedQuantity ?? quantity,
    matchedProduct:
      bestMatch.confidence >= 60 && bestMatch.id
        ? {
            id: bestAsProductMatch.id,
            productNumber: bestAsProductMatch.productNumber,
            name: bestAsProductMatch.name,
            price: bestAsProductMatch.price,
            confidence: bestAsProductMatch.confidence,
          }
        : undefined,
    alternativeMatches:
      filteredAlternatives.length > 0
        ? filteredAlternatives.map(({ matchStrategy: _m, nameSimilarityOnly: _n, ...rest }) => rest)
        : undefined,
    confidence: bestMatch?.confidence || 0,
    status,
    originalQuantity,
    convertedQuantity,
    conversionNote,
    matchStrategy: bestMatch.confidence >= 60 && bestMatch.id ? bestStrategy : undefined,
    learningHint: learnedPreferredIdentifier
      ? { type: "preferred_identifier", identifier: learnedPreferredIdentifier }
      : undefined,
  };
}

/**
 * Match line item and return best match + alternatives in separate structure
 */
function matchLineItemAgainstBatchWithAlternatives(
  lineItem: {
    extractedProductName: string;
    extractedPositionNumber?: string;
    extractedProductNumber?: string;
    quantity: number;
  },
  products: Product[],
  matchOptions?: MatchProductsAgainstCatalogOptions
): { bestMatch: LineItemMatch; alternatives: ProductMatch[] } {
  const result = matchLineItemAgainstBatch(lineItem, products, matchOptions);
  return {
    bestMatch: result,
    alternatives: result.alternativeMatches || [],
  };
}

/**
 * Calculate string similarity using Levenshtein distance
 * Returns a value between 0 and 1 (1 = identical)
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;

  // Create a matrix for dynamic programming
  const matrix: number[][] = [];

  // Initialize the matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const levenshteinDistance = matrix[len1][len2];
  const maxLength = Math.max(len1, len2);

  // Convert distance to similarity (0 to 1)
  return 1 - levenshteinDistance / maxLength;
}

function prefilterProducts(
  searchTerm: string,
  extractedProductNumber: string | undefined,
  products: Product[]
): Product[] {
  if (products.length === 0) return products;
  const extractedNum = normalizeIdentifierValue(extractedProductNumber);
  if (extractedNum) {
    const extractedIsNumericOnly = /^\d+$/.test(extractedNum);
    const byNumber = products.filter((product) => {
      const ids = getProductNormalizedIdentifiers(product);
      const exactMatch =
        ids.productNumber === extractedNum ||
        ids.ean === extractedNum ||
        ids.manufacturerNumber === extractedNum ||
        ids.sapProductNumbers.includes(extractedNum);
      if (exactMatch) return true;

      if (extractedIsNumericOnly) return false;
      if (extractedNum.length < 6 || !/[a-z]/i.test(extractedNum)) return false;

      const startsWithMatch =
        (ids.productNumber && (ids.productNumber.startsWith(extractedNum) || extractedNum.startsWith(ids.productNumber))) ||
        (ids.manufacturerNumber &&
          (ids.manufacturerNumber.startsWith(extractedNum) ||
            extractedNum.startsWith(ids.manufacturerNumber))) ||
        ids.sapProductNumbers.some(
          (sap) => sap.startsWith(extractedNum) || extractedNum.startsWith(sap)
        );
      return Boolean(startsWithMatch);
    });
    if (byNumber.length > 0) {
      return byNumber;
    }
    if (extractedIsNumericOnly) {
      return [];
    }
  }

  const tokens = normalizeString(searchTerm).split(" ").filter((token) => token.length >= 3);
  if (tokens.length === 0) return products;
  const byToken = products.filter((product) =>
    tokens.some((token) => normalizeString(product.name).includes(token))
  );

  return byToken.length >= 10 ? byToken : products;
}

/**
 * Normalize a string for comparison
 * - Lowercase
 * - Remove special characters
 * - Remove extra whitespace
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // Replace special chars with space
    .replace(/\s+/g, " ") // Replace multiple spaces with single space
    .trim();
}
