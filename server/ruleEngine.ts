import type {
  Product,
  CrossSellingRule,
  RuleCondition,
  RuleTargetCriteria,
  RuleConditionOperator,
} from "@shared/schema";

export class RuleEngine {
  /**
   * Evaluate if a product matches all source conditions of a rule
   */
  evaluateSourceConditions(product: Product, conditions: RuleCondition[]): boolean {
    // All conditions must be true (AND logic)
    return conditions.every((condition) => this.evaluateCondition(product, condition));
  }

  /**
   * Evaluate a single condition against a product
   */
  private evaluateCondition(product: Product, condition: RuleCondition): boolean {
    const fieldValue = this.getFieldValue(product, condition.field);
    
    switch (condition.operator) {
      case "equals":
        return this.compareEquals(fieldValue, condition.value);
      
      case "notEquals":
        return !this.compareEquals(fieldValue, condition.value);
      
      case "contains":
        return this.compareContains(fieldValue, condition.value);
      
      case "notContains":
        return !this.compareContains(fieldValue, condition.value);
      
      case "greaterThan":
        return this.compareGreaterThan(fieldValue, condition.value);
      
      case "lessThan":
        return this.compareLessThan(fieldValue, condition.value);
      
      case "greaterThanOrEqual":
        return this.compareGreaterThanOrEqual(fieldValue, condition.value);
      
      case "lessThanOrEqual":
        return this.compareLessThanOrEqual(fieldValue, condition.value);
      
      case "matchesDimensions":
        // Special case for dimension matching
        return this.matchesDimensions(product, condition.value);
      
      default:
        console.warn(`Unknown operator: ${condition.operator}`);
        return false;
    }
  }

  /**
   * Find products that match the target criteria of a rule
   */
  findMatchingProducts(sourceProduct: Product, criteria: RuleTargetCriteria[], allProducts: Product[]): Product[] {
    console.log(`[RuleEngine] Searching ${allProducts.length} products for matches...`);
    
    // Debug: Check if specific product exists
    const testProduct = allProducts.find(p => p.productNumber === '4026212441406');
    if (testProduct) {
      console.log(`[RuleEngine] Test product 4026212441406 found: "${testProduct.name}"`);
    } else {
      console.log(`[RuleEngine] Test product 4026212441406 NOT found in loaded products`);
    }
    
    // Debug: Show products with "Holmebene" in name
    const holmebeneProducts = allProducts.filter(p => 
      p.name && p.name.toLowerCase().includes('holmebene')
    );
    console.log(`[RuleEngine] Products with "Holmebene" in name: ${holmebeneProducts.length}`);
    if (holmebeneProducts.length > 0) {
      console.log(`[RuleEngine] Sample "Holmebene" products:`, holmebeneProducts.slice(0, 3).map(p => 
        `${p.productNumber} - ${p.name}`
      ));
    }
    
    const matches = allProducts.filter((targetProduct) => {
      // Don't match the source product itself
      if (targetProduct.id === sourceProduct.id) {
        return false;
      }

      // All criteria must be satisfied (AND logic)
      return criteria.every((criterion) => 
        this.evaluateTargetCriterion(sourceProduct, targetProduct, criterion)
      );
    });
    
    console.log(`[RuleEngine] Found ${matches.length} matching products`);
    
    return matches;
  }

  /**
   * Evaluate if a target product matches a criterion based on the source product
   */
  private evaluateTargetCriterion(
    sourceProduct: Product,
    targetProduct: Product,
    criterion: RuleTargetCriteria
  ): boolean {
    switch (criterion.matchType) {
      case "exact":
        // Target must have exact value
        const targetValue = this.getFieldValue(targetProduct, criterion.field);
        return this.compareEquals(targetValue, criterion.value);
      
      case "contains":
        // Target must contain value
        const containsValue = this.getFieldValue(targetProduct, criterion.field);
        return this.compareContains(containsValue, criterion.value);
      
      case "sameDimensions":
        // Target must have compatible dimensions with source
        return this.hasCompatibleDimensions(sourceProduct, targetProduct);
      
      case "sameProperty":
        // Target must have same property value as source
        const sourceValue = this.getFieldValue(sourceProduct, criterion.field);
        const targetPropertyValue = this.getFieldValue(targetProduct, criterion.field);
        return this.compareEquals(sourceValue, targetPropertyValue);
      
      default:
        console.warn(`Unknown match type: ${criterion.matchType}`);
        return false;
    }
  }

  /**
   * Get a field value from a product using dot notation (e.g., "dimensions.height")
   */
  private getFieldValue(product: Product, field: string): any {
    const parts = field.split(".");
    let value: any = product;
    
    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }
    
    return value;
  }

  /**
   * Comparison operators
   */
  private compareEquals(fieldValue: any, targetValue: any): boolean {
    if (Array.isArray(fieldValue) && Array.isArray(targetValue)) {
      // Compare arrays (same elements)
      return fieldValue.length === targetValue.length && 
        fieldValue.every((v) => targetValue.includes(v));
    }
    
    if (Array.isArray(fieldValue)) {
      // Field is array, check if it includes target value
      return fieldValue.includes(targetValue);
    }
    
    if (Array.isArray(targetValue)) {
      // Target is array, check if field value is in array
      return targetValue.includes(fieldValue);
    }
    
    return fieldValue === targetValue;
  }

  private compareContains(fieldValue: any, targetValue: any): boolean {
    if (fieldValue === null || fieldValue === undefined) {
      return false;
    }
    
    if (Array.isArray(fieldValue)) {
      // Array contains value
      if (Array.isArray(targetValue)) {
        // Check if array contains any of the target values
        return targetValue.some((v) => fieldValue.includes(v));
      }
      return fieldValue.includes(targetValue);
    }
    
    if (typeof fieldValue === "string" && typeof targetValue === "string") {
      // String contains substring
      return fieldValue.toLowerCase().includes(targetValue.toLowerCase());
    }
    
    return false;
  }

  private compareGreaterThan(fieldValue: any, targetValue: any): boolean {
    const numFieldValue = Number(fieldValue);
    const numTargetValue = Number(targetValue);
    
    if (isNaN(numFieldValue) || isNaN(numTargetValue)) {
      return false;
    }
    
    return numFieldValue > numTargetValue;
  }

  private compareLessThan(fieldValue: any, targetValue: any): boolean {
    const numFieldValue = Number(fieldValue);
    const numTargetValue = Number(targetValue);
    
    if (isNaN(numFieldValue) || isNaN(numTargetValue)) {
      return false;
    }
    
    return numFieldValue < numTargetValue;
  }

  private compareGreaterThanOrEqual(fieldValue: any, targetValue: any): boolean {
    const numFieldValue = Number(fieldValue);
    const numTargetValue = Number(targetValue);
    
    if (isNaN(numFieldValue) || isNaN(numTargetValue)) {
      return false;
    }
    
    return numFieldValue >= numTargetValue;
  }

  private compareLessThanOrEqual(fieldValue: any, targetValue: any): boolean {
    const numFieldValue = Number(fieldValue);
    const numTargetValue = Number(targetValue);
    
    if (isNaN(numFieldValue) || isNaN(numTargetValue)) {
      return false;
    }
    
    return numFieldValue <= numTargetValue;
  }

  /**
   * Special dimension matching - checks if dimensions are within tolerance
   */
  private matchesDimensions(product: Product, targetDimensions: any): boolean {
    if (!product.dimensions || !targetDimensions) {
      return false;
    }
    
    const tolerance = 0.05; // 5% tolerance
    
    // Target dimensions can be a single dimension or object with width/height/length
    if (typeof targetDimensions === "object") {
      const { width, height, length } = targetDimensions;
      
      if (width !== undefined && product.dimensions.width !== undefined) {
        const diff = Math.abs(product.dimensions.width - width);
        const maxDiff = width * tolerance;
        if (diff > maxDiff) return false;
      }
      
      if (height !== undefined && product.dimensions.height !== undefined) {
        const diff = Math.abs(product.dimensions.height - height);
        const maxDiff = height * tolerance;
        if (diff > maxDiff) return false;
      }
      
      if (length !== undefined && product.dimensions.length !== undefined) {
        const diff = Math.abs(product.dimensions.length - length);
        const maxDiff = length * tolerance;
        if (diff > maxDiff) return false;
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Check if two products have compatible dimensions (within tolerance)
   */
  private hasCompatibleDimensions(product1: Product, product2: Product): boolean {
    if (!product1.dimensions || !product2.dimensions) {
      return false;
    }
    
    const tolerance = 0.1; // 10% tolerance for compatible dimensions
    
    // Check if width, height, or length are similar
    const dimensionKeys: Array<'width' | 'height' | 'length'> = ['width', 'height', 'length'];
    
    for (const key of dimensionKeys) {
      const dim1 = product1.dimensions[key];
      const dim2 = product2.dimensions[key];
      
      if (dim1 !== undefined && dim2 !== undefined) {
        const diff = Math.abs(dim1 - dim2);
        const maxDiff = Math.max(dim1, dim2) * tolerance;
        
        // At least one dimension should match within tolerance
        if (diff <= maxDiff) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Apply all active rules to find cross-selling suggestions for a product
   */
  async suggestCrossSelling(
    product: Product,
    rules: CrossSellingRule[],
    allProducts: Product[]
  ): Promise<Product[]> {
    const suggestions = new Set<Product>();
    
    // Filter to only active rules (active === 1)
    const activeRules = rules.filter((rule) => rule.active === 1);
    
    console.log(`[RuleEngine] Processing ${activeRules.length} active rules for product ${product.name}`);
    
    for (const rule of activeRules) {
      console.log(`[RuleEngine] Evaluating rule: ${rule.name}`);
      console.log(`[RuleEngine] Source conditions:`, rule.sourceConditions);
      
      // Check if this rule applies to the source product
      if (this.evaluateSourceConditions(product, rule.sourceConditions)) {
        console.log(`[RuleEngine] Source conditions matched! Finding target products...`);
        console.log(`[RuleEngine] Target criteria:`, rule.targetCriteria);
        
        // Find products that match the target criteria
        const matches = this.findMatchingProducts(product, rule.targetCriteria, allProducts);
        console.log(`[RuleEngine] Found ${matches.length} matching products`);
        
        // Add to suggestions
        matches.forEach((match) => suggestions.add(match));
      } else {
        console.log(`[RuleEngine] Source conditions did not match`);
      }
    }
    
    console.log(`[RuleEngine] Total suggestions: ${suggestions.size}`);
    return Array.from(suggestions);
  }
}
