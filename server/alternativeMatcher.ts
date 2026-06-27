import type { Product } from "@shared/schema";
import { findCategoryProfile, type CategoryMatchingProfile } from "./categoryProfiles";
import {
  extractProductMetadata,
  extractLoadCapacity,
  extractDimensions,
  extractProductSeries,
  extractProductType,
  areSeriesCompatible,
  dimensionsMatchExactly,
  type ProductMetadata
} from "./productPropertyExtractor";

export interface AlternativeMatch {
  product: Product;
  score: number;  // 0-100
  reasoning: string;  // Why this alternative was suggested
  loadCapacity?: number;
  dimensions?: {
    width?: number;
    height?: number;
    depth?: number;
  };
}

export interface AlternativeMatchingRequest {
  extractedProductName: string;
  extractedProductNumber?: string;
  categories?: string[];
  matchedProduct?: Product;  // If exact match found
  allProducts: Product[];
}

/**
 * Find intelligent alternatives using category-specific profiles
 * 
 * Strategy:
 * 1. Identify category profile (or use generic)
 * 2. Extract attributes from request (load capacity, dimensions, series)
 * 3. Apply defaults from profile when attributes missing
 * 4. Staged matching:
 *    - Stage 1: Exact match (if not already matched)
 *    - Stage 2: Compatible upgrades (same category, load>=requested, closest dimensions)
 *    - Stage 3: Cross-category fallbacks
 * 5. Score and rank alternatives
 */
export function findIntelligentAlternatives(
  request: AlternativeMatchingRequest,
  maxAlternatives: number = 5
): AlternativeMatch[] {
  const { extractedProductName, categories, matchedProduct, allProducts } = request;
  
  console.log(`[Alternative Matcher] Finding alternatives for: "${extractedProductName}"`);
  
  // Step 1: Find category profile
  const profile = findCategoryProfile(extractedProductName, categories);
  console.log(`[Alternative Matcher] Category profile: ${profile ? profile.categoryNames.join(', ') : 'GENERIC'}`);
  
  // Step 2: Extract request attributes
  const mockRequest: Product = {
    id: '',
    productNumber: '',
    name: extractedProductName,
    price: 0,
    netPrice: 0,
    currency: 'EUR',
    taxRate: 19,
    stock: 0,
    available: true,
    categoryNames: categories,
  };
  
  const requestMetadata = extractProductMetadata(mockRequest);
  const requestLoad = profile?.extractLoadCapacity(mockRequest) ?? extractLoadCapacity(mockRequest);
  const requestDimensions = extractDimensions(mockRequest);
  
  console.log(`[Alternative Matcher] Request metadata:`, {
    series: requestMetadata.series,
    type: requestMetadata.type,
    loadCapacity: requestLoad,
    dimensions: requestDimensions,
  });
  
  // Step 3: Apply profile defaults for missing dimensions
  const targetDimensions = { ...requestDimensions };
  if (profile?.defaults) {
    if (!targetDimensions.width && profile.defaults.width) {
      targetDimensions.width = profile.defaults.width;
      console.log(`[Alternative Matcher] Applied default width: ${profile.defaults.width}mm`);
    }
    if (!targetDimensions.depth && profile.defaults.depth) {
      targetDimensions.depth = profile.defaults.depth;
      console.log(`[Alternative Matcher] Applied default depth: ${profile.defaults.depth}mm`);
    }
    if (!targetDimensions.height && profile.defaults.height) {
      targetDimensions.height = profile.defaults.height;
      console.log(`[Alternative Matcher] Applied default height: ${profile.defaults.height}mm`);
    }
  }
  
  // Step 4: Find load capacity upgrade if requested load unavailable
  let targetLoad = requestLoad;
  if (requestLoad && profile) {
    const availableLoads = allProducts
      .map(p => profile.extractLoadCapacity(p) ?? extractLoadCapacity(p))
      .filter((load): load is number => load !== null);
    
    const exactLoadAvailable = availableLoads.some(load => load === requestLoad);
    
    if (!exactLoadAvailable) {
      const upgrade = profile.findLoadUpgrade(requestLoad, availableLoads);
      if (upgrade) {
        targetLoad = upgrade;
        console.log(`[Alternative Matcher] Load ${requestLoad}kg unavailable, upgrading to ${upgrade}kg`);
      }
    }
  }
  
  // Step 5: Staged alternative matching
  const candidates: AlternativeMatch[] = [];
  
  for (const product of allProducts) {
    // Skip if this is the matched product
    if (matchedProduct && product.id === matchedProduct.id) continue;
    
    // Skip inactive products (prefer active ones)
    if (!product.available) continue;
    
    const productMetadata = extractProductMetadata(product);
    const productLoad = profile?.extractLoadCapacity(product) ?? extractLoadCapacity(product);
    const productDimensions = extractDimensions(product);
    
    // Filter Stage 1: Category compatibility
    if (profile && categories && categories.length > 0) {
      const productCategories = product.categoryNames || [];
      const hasMatchingCategory = profile.categoryNames.some(cat =>
        productCategories.some(pc => pc.toLowerCase().includes(cat.toLowerCase()))
      );
      
      if (!hasMatchingCategory) {
        // Also check product name for category keywords
        const nameMatch = profile.categoryNames.some(cat =>
          product.name.toLowerCase().includes(cat.toLowerCase())
        );
        if (!nameMatch) continue;
      }
    }
    
    // Filter Stage 2: Product type compatibility
    if (requestMetadata.type && productMetadata.type) {
      if (requestMetadata.type !== productMetadata.type) {
        continue;  // Type must match (Fachboden != Holm)
      }
    }
    
    // Filter Stage 3: Series compatibility
    if (requestMetadata.series && productMetadata.series) {
      if (!areSeriesCompatible(requestMetadata.series, productMetadata.series)) {
        continue;  // Series not compatible
      }
    }
    
    // Calculate match score
    let score = 0;
    const reasons: string[] = [];
    
    // Load capacity scoring
    if (targetLoad !== null && productLoad !== null) {
      if (productLoad === targetLoad) {
        score += profile?.scoringWeights.loadCapacityMatch ?? 40;
        reasons.push(`Fachlast ${productLoad}kg`);
      } else if (productLoad > targetLoad && productLoad <= targetLoad * 1.5) {
        // Accept up to 50% higher load as acceptable upgrade
        score += (profile?.scoringWeights.loadCapacityMatch ?? 40) * 0.8;
        reasons.push(`Fachlast ${productLoad}kg (upgrade von ${targetLoad}kg)`);
      } else if (productLoad < targetLoad) {
        // Lower load capacity is not good
        score -= 20;
        continue;  // Skip products with lower load capacity
      } else {
        // Much higher load (>50% more) - acceptable but not ideal
        score += (profile?.scoringWeights.loadCapacityMatch ?? 40) * 0.5;
        reasons.push(`Fachlast ${productLoad}kg (deutlich höher als ${targetLoad}kg)`);
      }
    }
    
    // Dimension scoring
    const dimensionScore = scoreDimensionMatch(targetDimensions, productDimensions, profile);
    score += dimensionScore.score;
    if (dimensionScore.reason) {
      reasons.push(dimensionScore.reason);
    }
    
    // Series match bonus
    if (requestMetadata.series && productMetadata.series === requestMetadata.series) {
      score += profile?.scoringWeights.seriesMatch ?? 20;
      reasons.push(`Serie: ${productMetadata.series}`);
    }
    
    // Availability bonus
    if (product.stock > 0) {
      score += profile?.scoringWeights.availabilityBonus ?? 10;
      reasons.push('Auf Lager');
    }
    
    // BUSINESS RULE: Add Holmebenen indicator (2er Set)
    const isHolmebene = product.name.toLowerCase().includes('holmebene');
    if (isHolmebene && !reasons.some(r => r.includes('2er Set'))) {
      reasons.push('2er Set');
    }
    
    // Only include if score is reasonable (>= 30%)
    if (score >= 30) {
      candidates.push({
        product,
        score: Math.min(100, score),
        reasoning: reasons.join(', '),
        loadCapacity: productLoad ?? undefined,
        dimensions: productDimensions,
      });
    }
  }
  
  // Sort by score (descending) and return top N
  candidates.sort((a, b) => b.score - a.score);
  
  const topAlternatives = candidates.slice(0, maxAlternatives);
  console.log(`[Alternative Matcher] Found ${candidates.length} candidates, returning top ${topAlternatives.length}`);
  
  return topAlternatives;
}

/**
 * Score how well dimensions match
 */
function scoreDimensionMatch(
  target: { width?: number; height?: number; depth?: number },
  actual: { width?: number; height?: number; depth?: number; length?: number },
  profile: CategoryMatchingProfile | null
): { score: number; reason?: string } {
  let score = 0;
  const reasons: string[] = [];
  
  const maxDimensionScore = profile?.scoringWeights.dimensionMatch ?? 30;
  let matchedDimensions = 0;
  let totalDimensions = 0;
  
  // Width matching (most important)
  if (target.width) {
    totalDimensions++;
    if (actual.width === target.width) {
      matchedDimensions++;
      reasons.push(`${actual.width}mm breit`);
    } else if (actual.width && Math.abs(actual.width - target.width) <= 50) {
      // Within 50mm is acceptable
      matchedDimensions += 0.8;
      reasons.push(`${actual.width}mm breit (±50mm)`);
    } else if (actual.width) {
      reasons.push(`${actual.width}mm breit (abweichend von ${target.width}mm)`);
    }
  }
  
  // Depth matching
  if (target.depth) {
    totalDimensions++;
    if (actual.depth === target.depth) {
      matchedDimensions++;
      reasons.push(`${actual.depth}mm tief`);
    } else if (actual.depth && Math.abs(actual.depth - target.depth) <= 50) {
      matchedDimensions += 0.8;
      reasons.push(`${actual.depth}mm tief (±50mm)`);
    } else if (actual.depth) {
      reasons.push(`${actual.depth}mm tief (abweichend von ${target.depth}mm)`);
    }
  }
  
  // Height matching (less critical for shelves)
  if (target.height) {
    totalDimensions++;
    if (actual.height === target.height) {
      matchedDimensions++;
      reasons.push(`${actual.height}mm hoch`);
    } else if (actual.height && Math.abs(actual.height - target.height) <= 100) {
      matchedDimensions += 0.7;
    }
  }
  
  // Calculate final score
  if (totalDimensions > 0) {
    score = (matchedDimensions / totalDimensions) * maxDimensionScore;
  }
  
  return {
    score,
    reason: reasons.length > 0 ? reasons.join(', ') : undefined,
  };
}
