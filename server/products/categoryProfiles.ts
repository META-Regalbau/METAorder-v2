import type { Product } from "@shared/schema";

/**
 * Category-specific matching profile that defines:
 * - How to extract attributes from product names/properties
 * - Default values when attributes are missing
 * - Load capacity ladders for upgrades
 * - Dimensional preferences
 * - Scoring weights for alternative ranking
 */
export interface CategoryMatchingProfile {
  /**
   * Category identifiers (case-insensitive matching)
   */
  categoryNames: string[];
  
  /**
   * Keywords that indicate this product type
   */
  productTypeKeywords: string[];
  
  /**
   * Default dimensions when not specified (in mm)
   */
  defaults: {
    width?: number;
    height?: number;
    depth?: number;
  };
  
  /**
   * Load capacity ladder (in kg) - for suggesting upgrades when requested capacity unavailable
   */
  loadCapacityLadder: number[];
  
  /**
   * Scoring weights for alternative ranking
   */
  scoringWeights: {
    loadCapacityMatch: number;  // Weight for matching load capacity
    dimensionMatch: number;     // Weight for matching dimensions
    seriesMatch: number;        // Weight for matching series/brand
    availabilityBonus: number;  // Bonus for in-stock products
  };
  
  /**
   * Extract load capacity from product name or properties (in kg)
   */
  extractLoadCapacity(product: Product | { name: string; properties?: Product['properties'] }): number | null;
  
  /**
   * Find best load capacity upgrade from ladder when requested load unavailable
   * Returns the next available capacity >= requestedLoad
   */
  findLoadUpgrade(requestedLoad: number, availableLoads: number[]): number | null;
}

/**
 * Profile for CLIP Fachbodenregale (Shelf Rack Systems)
 */
export const ClipFachbodenProfile: CategoryMatchingProfile = {
  categoryNames: ['Fachbodenregale', 'Clip'],
  productTypeKeywords: ['fachboden', 'zusatzboden', 'ebene', 'boden'],
  
  defaults: {
    width: 1000,  // Default to 1000mm width when not specified
    depth: 400,   // Default depth
  },
  
  // CLIP load capacity ladder: 100kg → 150kg → 230kg
  loadCapacityLadder: [100, 150, 230],
  
  scoringWeights: {
    loadCapacityMatch: 40,    // Very important
    dimensionMatch: 30,       // Important for fit
    seriesMatch: 20,          // Important for compatibility
    availabilityBonus: 10,    // Nice to have
  },
  
  extractLoadCapacity(product): number | null {
    // Check properties for "Fachlast" or "Tragkraft"
    if ('properties' in product && product.properties) {
      for (const prop of product.properties) {
        const groupLower = prop.groupName.toLowerCase();
        if (groupLower.includes('fachlast') || groupLower.includes('tragkraft') || groupLower.includes('belastbar')) {
          const match = prop.optionName.match(/(\d+)\s*kg/i);
          if (match) {
            return parseInt(match[1]);
          }
        }
      }
    }
    
    // Fallback: Extract from product name
    // Look for patterns like "100 kg", "150kg", "Fachlast 230"
    const loadPatterns = [
      /fachlast[:\s]*(\d+)\s*kg/i,
      /tragkraft[:\s]*(\d+)\s*kg/i,
      /(\d+)\s*kg\s*(?:fachlast|tragkraft|belastbar)/i,
      /(?:^|\s)(\d+)\s*kg(?:\s|$)/i,  // Standalone "100 kg"
    ];
    
    for (const pattern of loadPatterns) {
      const match = product.name.match(pattern);
      if (match) {
        return parseInt(match[1]);
      }
    }
    
    return null;
  },
  
  findLoadUpgrade(requestedLoad, availableLoads) {
    // Find the smallest available load >= requestedLoad
    const upgrades = availableLoads
      .filter(load => load >= requestedLoad)
      .sort((a, b) => a - b);
    
    return upgrades.length > 0 ? upgrades[0] : null;
  },
};

/**
 * Profile for Palettenregale (Pallet Rack Systems)
 */
export const PalettenregalProfile: CategoryMatchingProfile = {
  categoryNames: ['Palettenregale', 'Palettenregal'],
  productTypeKeywords: ['palettenregal', 'holm', 'holmebene', 'traverse', 'ständer', 'rahmen'],
  
  defaults: {
    width: 2700,  // Common pallet rack width
    depth: 1100,  // Common pallet rack depth
    height: 3000, // Common height
  },
  
  // Pallet rack load capacities (per beam pair)
  loadCapacityLadder: [1500, 2000, 2700, 3000, 3300, 3600, 4000, 4500],
  
  scoringWeights: {
    loadCapacityMatch: 35,
    dimensionMatch: 35,
    seriesMatch: 20,
    availabilityBonus: 10,
  },
  
  extractLoadCapacity(product): number | null {
    // Similar logic to CLIP but with higher load ranges
    if ('properties' in product && product.properties) {
      for (const prop of product.properties) {
        const groupLower = prop.groupName.toLowerCase();
        if (groupLower.includes('fachlast') || groupLower.includes('tragkraft') || groupLower.includes('belastbar')) {
          const match = prop.optionName.match(/(\d+)\s*kg/i);
          if (match) {
            return parseInt(match[1]);
          }
        }
      }
    }
    
    const loadPatterns = [
      /fachlast[:\s]*(\d+)\s*kg/i,
      /tragkraft[:\s]*(\d+)\s*kg/i,
      /(\d+)\s*kg\s*(?:fachlast|tragkraft|belastbar)/i,
      /(?:^|\s)(\d+)\s*kg(?:\s|$)/i,
    ];
    
    for (const pattern of loadPatterns) {
      const match = product.name.match(pattern);
      if (match) {
        return parseInt(match[1]);
      }
    }
    
    return null;
  },
  
  findLoadUpgrade(requestedLoad, availableLoads) {
    const upgrades = availableLoads
      .filter(load => load >= requestedLoad)
      .sort((a, b) => a - b);
    
    return upgrades.length > 0 ? upgrades[0] : null;
  },
};

/**
 * Profile for Kragarmregale (Cantilever Rack Systems)
 */
export const KragarmregalProfile: CategoryMatchingProfile = {
  categoryNames: ['Kragarmregale', 'Kragarmregal', 'Kragarme'],
  productTypeKeywords: ['kragarm', 'kragarme', 'ausleger', 'konsole'],
  
  defaults: {
    width: 1000,  // Arm length
    height: 3000, // Common height
  },
  
  // Kragarm load capacities (per arm)
  loadCapacityLadder: [250, 350, 500, 650, 750, 1000, 1500],
  
  scoringWeights: {
    loadCapacityMatch: 40,
    dimensionMatch: 30,
    seriesMatch: 20,
    availabilityBonus: 10,
  },
  
  extractLoadCapacity(product): number | null {
    if ('properties' in product && product.properties) {
      for (const prop of product.properties) {
        const groupLower = prop.groupName.toLowerCase();
        if (groupLower.includes('fachlast') || groupLower.includes('tragkraft') || groupLower.includes('belastbar')) {
          const match = prop.optionName.match(/(\d+)\s*kg/i);
          if (match) {
            return parseInt(match[1]);
          }
        }
      }
    }
    
    const loadPatterns = [
      /fachlast[:\s]*(\d+)\s*kg/i,
      /tragkraft[:\s]*(\d+)\s*kg/i,
      /(\d+)\s*kg\s*(?:fachlast|tragkraft|belastbar)/i,
      /(?:^|\s)(\d+)\s*kg(?:\s|$)/i,
    ];
    
    for (const pattern of loadPatterns) {
      const match = product.name.match(pattern);
      if (match) {
        return parseInt(match[1]);
      }
    }
    
    return null;
  },
  
  findLoadUpgrade(requestedLoad, availableLoads) {
    const upgrades = availableLoads
      .filter(load => load >= requestedLoad)
      .sort((a, b) => a - b);
    
    return upgrades.length > 0 ? upgrades[0] : null;
  },
};

/**
 * Registry of all category profiles
 */
export const CategoryProfiles: CategoryMatchingProfile[] = [
  ClipFachbodenProfile,
  PalettenregalProfile,
  KragarmregalProfile,
];

/**
 * Find the matching category profile for a product/request
 * Returns null if no specific profile matches (will use generic matching)
 */
export function findCategoryProfile(
  productNameOrCategory: string,
  categories?: string[]
): CategoryMatchingProfile | null {
  const searchText = productNameOrCategory.toLowerCase();
  const categoriesLower = categories?.map(c => c.toLowerCase()) || [];
  
  for (const profile of CategoryProfiles) {
    // Check if any category name matches
    const categoryMatch = profile.categoryNames.some(cat => 
      searchText.includes(cat.toLowerCase()) ||
      categoriesLower.some(c => c.includes(cat.toLowerCase()))
    );
    
    // Check if any product type keyword matches
    const keywordMatch = profile.productTypeKeywords.some(keyword =>
      searchText.includes(keyword.toLowerCase())
    );
    
    if (categoryMatch || keywordMatch) {
      return profile;
    }
  }
  
  return null;
}
