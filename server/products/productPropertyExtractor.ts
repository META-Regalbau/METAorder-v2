import type { Product } from "@shared/schema";

/**
 * Extracts product series from properties or product name
 * Examples: MULTIPAL, CLIP, ATLAS ST, MULTISTRONG L/M/H, MINI-RACK, SPEED-RACK
 */
export function extractProductSeries(product: Product): string | null {
  // Known series patterns
  const seriesPatterns = [
    { pattern: /multipal/i, series: "MULTIPAL" },
    { pattern: /clip(?!\s*regal)/i, series: "CLIP" }, // CLIP but not "CLIP Regal"
    { pattern: /atlas\s+st/i, series: "ATLAS ST" },
    { pattern: /multistrong\s+l/i, series: "MULTISTRONG L" },
    { pattern: /multistrong\s+m/i, series: "MULTISTRONG M" },
    { pattern: /multistrong\s+h/i, series: "MULTISTRONG H" },
    { pattern: /mini-rack|minirack/i, series: "MINI-RACK" },
    { pattern: /speed-rack|speedrack/i, series: "SPEED-RACK" },
  ];

  // First check properties for Serie/Produktserie
  if (product.properties) {
    for (const prop of product.properties) {
      if (
        prop.groupName.toLowerCase().includes('serie') ||
        prop.groupName.toLowerCase().includes('produktserie') ||
        prop.groupName.toLowerCase().includes('system')
      ) {
        // Direct property value
        for (const { pattern, series } of seriesPatterns) {
          if (pattern.test(prop.optionName)) {
            return series;
          }
        }
      }
    }
  }

  // Fallback: Check product name
  for (const { pattern, series } of seriesPatterns) {
    if (pattern.test(product.name)) {
      return series;
    }
  }

  return null;
}

/**
 * Extracts product type from properties or name
 * Examples: Holm, Ständer, Regal, Fachboden, Traverse, etc.
 */
export function extractProductType(product: Product): string | null {
  const typeKeywords = [
    { pattern: /\bholm(?:e|ebene|ebenen)?\b/i, type: "Holm" },
    { pattern: /\bständer\b/i, type: "Ständer" },
    { pattern: /\btraverse(?:n)?\b/i, type: "Traverse" },
    { pattern: /\bfachboden|fachböden\b/i, type: "Fachboden" },
    { pattern: /\brahmen\b/i, type: "Rahmen" },
    { pattern: /\bgrundregal\b/i, type: "Grundregal" },
    { pattern: /\banbauregal|\banbau\b/i, type: "Anbauregal" },
    { pattern: /\bregalfeld(?:er)?\b/i, type: "Regalfeld" },
    { pattern: /\bregal\b(?!.*\b(grund|anbau)\b)/i, type: "Regal" }, // Regal but not Grundregal/Anbauregal
  ];

  // Check properties first
  if (product.properties) {
    for (const prop of product.properties) {
      if (
        prop.groupName.toLowerCase().includes('typ') ||
        prop.groupName.toLowerCase().includes('produkttyp') ||
        prop.groupName.toLowerCase().includes('art')
      ) {
        for (const { pattern, type } of typeKeywords) {
          if (pattern.test(prop.optionName)) {
            return type;
          }
        }
      }
    }
  }

  // Fallback: Check name (prioritize more specific types first)
  for (const { pattern, type } of typeKeywords) {
    if (pattern.test(product.name)) {
      return type;
    }
  }

  return null;
}

/**
 * Extracts exact dimensions from properties or name
 * Returns dimensions in mm (no tolerance!)
 */
export function extractDimensions(product: Product): {
  width?: number;
  height?: number;
  depth?: number;
  length?: number;
} {
  const dimensions: {
    width?: number;
    height?: number;
    depth?: number;
    length?: number;
  } = {};

  // First try product.dimensions field
  if (product.dimensions) {
    if (product.dimensions.width) dimensions.width = product.dimensions.width;
    if (product.dimensions.height) dimensions.height = product.dimensions.height;
    if (product.dimensions.length) dimensions.length = product.dimensions.length;
  }

  // Check properties for explicit dimensions
  if (product.properties) {
    for (const prop of product.properties) {
      const groupLower = prop.groupName.toLowerCase();
      const optionLower = prop.optionName.toLowerCase();

      // Extract numeric value
      const numMatch = prop.optionName.match(/(\d+(?:[.,]\d+)?)/);
      if (!numMatch) continue;
      
      let value = parseFloat(numMatch[1].replace(',', '.'));
      
      // Convert to mm if in meters
      if (optionLower.includes('m') && !optionLower.includes('mm')) {
        value *= 1000;
      }
      
      value = Math.round(value);

      // Map to dimension type
      if (groupLower.includes('breite') || groupLower.includes('width')) {
        dimensions.width = value;
      } else if (groupLower.includes('höhe') || groupLower.includes('height') || groupLower.includes('hoehe')) {
        dimensions.height = value;
      } else if (groupLower.includes('tiefe') || groupLower.includes('depth')) {
        dimensions.depth = value;
      } else if (groupLower.includes('länge') || groupLower.includes('length') || groupLower.includes('laenge')) {
        dimensions.length = value;
      }
    }
  }

  // Fallback: Extract from product name
  if (!dimensions.width && !dimensions.height && !dimensions.length) {
    // Pattern: "2.700 mm" or "2700mm" or "2,700mm"
    const dimPattern = /(\d+(?:[.,]\d+)?)\s*(?:mm|m(?!\w))/gi;
    const matches = Array.from(product.name.matchAll(dimPattern));
    
    if (matches.length > 0) {
      matches.forEach((match) => {
        let value = parseFloat(match[1].replace(',', '.'));
        // Convert to mm if in meters (single digit before decimal = meters)
        if (match[0].includes('m') && !match[0].includes('mm') && value < 100) {
          value *= 1000;
        }
        value = Math.round(value);
        
        // Assign to first available dimension (usually length for Holme)
        if (!dimensions.length) {
          dimensions.length = value;
        } else if (!dimensions.width) {
          dimensions.width = value;
        } else if (!dimensions.height) {
          dimensions.height = value;
        }
      });
    }

    // Pattern: "3300 x 2700 x 1100" (WxHxD for shelves)
    const xPattern = /(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/i;
    const xMatch = product.name.match(xPattern);
    if (xMatch) {
      dimensions.width = parseInt(xMatch[1]);
      dimensions.height = parseInt(xMatch[2]);
      dimensions.depth = parseInt(xMatch[3]);
    }
  }

  return dimensions;
}

/**
 * Extracts Regal-Typ (Grundregal vs Anbauregal) from properties
 */
export function extractRegalTyp(product: Product): "Grundregal" | "Anbauregal" | null {
  if (!product.properties) return null;

  for (const prop of product.properties) {
    if (
      prop.groupName.toLowerCase().includes('regal-typ') ||
      prop.groupName.toLowerCase().includes('typ')
    ) {
      const optionLower = prop.optionName.toLowerCase();
      if (optionLower.includes('grundregal') || optionLower.includes('grund')) {
        return "Grundregal";
      }
      if (optionLower.includes('anbauregal') || optionLower.includes('anbau')) {
        return "Anbauregal";
      }
    }
  }

  // Fallback to name
  if (product.name.toLowerCase().includes('grundregal') || product.name.match(/\bgr\b/i)) {
    return "Grundregal";
  }
  if (product.name.toLowerCase().includes('anbauregal') || product.name.match(/\bar\b/i)) {
    return "Anbauregal";
  }

  return null;
}

/**
 * Extracts Bauart (einseitig vs doppelseitig) from properties
 */
export function extractBauart(product: Product): "einseitig" | "doppelseitig" | null {
  if (!product.properties) return null;

  for (const prop of product.properties) {
    if (
      prop.groupName.toLowerCase().includes('bauart') ||
      prop.groupName.toLowerCase().includes('ausführung')
    ) {
      const optionLower = prop.optionName.toLowerCase();
      if (optionLower.includes('einseitig')) {
        return "einseitig";
      }
      if (optionLower.includes('doppelseitig')) {
        return "doppelseitig";
      }
    }
  }

  // Fallback to name
  if (product.name.toLowerCase().includes('einseitig')) {
    return "einseitig";
  }
  if (product.name.toLowerCase().includes('doppelseitig')) {
    return "doppelseitig";
  }

  return null;
}

/**
 * Checks if two products are series-compatible
 * Returns true if they can be mixed, false otherwise
 */
export function areSeriesCompatible(series1: string | null, series2: string | null): boolean {
  if (!series1 || !series2) return true; // Unknown series are compatible
  
  // Exact match
  if (series1 === series2) return true;

  // Incompatible series (explicit restrictions)
  const incompatibleGroups = [
    ["ATLAS ST", "MULTISTRONG L", "MULTISTRONG M", "MULTISTRONG H"], // Kragarmregale not mixable
    ["MINI-RACK", "SPEED-RACK"], // Weitspannregale not mixable
  ];

  for (const group of incompatibleGroups) {
    if (group.includes(series1) && group.includes(series2)) {
      return false; // Both in same incompatible group
    }
  }

  return false; // Different series are generally not compatible
}

/**
 * Checks if product dimensions match exactly (no tolerance!)
 */
export function dimensionsMatchExactly(
  dims1: { width?: number; height?: number; depth?: number; length?: number },
  dims2: { width?: number; height?: number; depth?: number; length?: number }
): boolean {
  // Check each dimension - must match exactly if both are defined
  if (dims1.width && dims2.width && dims1.width !== dims2.width) return false;
  if (dims1.height && dims2.height && dims1.height !== dims2.height) return false;
  if (dims1.depth && dims2.depth && dims1.depth !== dims2.depth) return false;
  if (dims1.length && dims2.length && dims1.length !== dims2.length) return false;

  return true;
}

/**
 * Extract load capacity (Fachlast/Tragkraft) from product (in kg)
 */
export function extractLoadCapacity(product: Product): number | null {
  // Check properties for "Fachlast" or "Tragkraft"
  if (product.properties) {
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
  
  // Check customFields for loadCapacity or tragkraft
  if (product.customFields) {
    if (product.customFields.loadCapacity) {
      return product.customFields.loadCapacity;
    }
    if (product.customFields.tragkraft) {
      return product.customFields.tragkraft;
    }
  }
  
  // Fallback: Extract from product name
  const loadPatterns = [
    /fachlast[:\s]*(\d+)\s*kg/i,
    /tragkraft[:\s]*(\d+)\s*kg/i,
    /(\d+)\s*kg\s*(?:fachlast|tragkraft|belastbar)/i,
    /(?:^|\s)(\d+)\s*kg(?:\s|$)/i,  // Standalone "100 kg"
  ];
  
  for (const pattern of loadPatterns) {
    const match = product.name.match(pattern);
    if (match) {
      const load = parseInt(match[1]);
      // Sanity check: typical load capacities are 50-5000 kg
      if (load >= 50 && load <= 5000) {
        return load;
      }
    }
  }
  
  return null;
}

/**
 * Comprehensive product metadata extraction
 */
export interface ProductMetadata {
  series: string | null;
  type: string | null;
  dimensions: {
    width?: number;
    height?: number;
    depth?: number;
    length?: number;
  };
  regalTyp: "Grundregal" | "Anbauregal" | null;
  bauart: "einseitig" | "doppelseitig" | null;
  loadCapacity: number | null; // in kg
}

export function extractProductMetadata(product: Product): ProductMetadata {
  return {
    series: extractProductSeries(product),
    type: extractProductType(product),
    dimensions: extractDimensions(product),
    regalTyp: extractRegalTyp(product),
    bauart: extractBauart(product),
    loadCapacity: extractLoadCapacity(product),
  };
}
