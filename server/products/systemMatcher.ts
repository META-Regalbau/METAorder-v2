import type { Product } from "@shared/schema";

/**
 * Intelligenter Matcher für Regalsysteme
 * 
 * Erkennt System-Anfragen (z.B. "Kragarmregal 7000mm breit, doppelseitig") und
 * berechnet automatisch die benötigte Kombination aus Grund- und Anbauregalen.
 */

export interface SystemMatch {
  isSystemRequest: boolean;
  baseProduct?: Product;  // Grundregal
  extensionProduct?: Product;  // Anbauregal
  baseQuantity?: number;  // Immer 1
  extensionQuantity?: number;  // Anzahl Anbauregale
  totalWidth?: number;  // Berechnete Gesamtbreite
  confidence: number;  // 0-100
  reasoning?: string;  // Begründung für die KI-Auswahl
  alternatives?: Array<{
    baseProduct: Product;
    extensionProduct: Product;
    baseQuantity: number;
    extensionQuantity: number;
    totalWidth: number;
    confidence: number;
    reasoning: string;
  }>;
}

export interface SystemRequirements {
  category?: string;  // z.B. "Kragarmregal"
  totalWidth?: number;  // mm
  height?: number;  // mm
  depth?: number;  // mm
  loadCapacity?: number;  // kg
  buildType?: 'einseitig' | 'doppelseitig';
}

/**
 * Extrahiert System-Anforderungen aus dem Produktnamen
 */
export function parseSystemRequirements(productName: string): SystemRequirements {
  const req: SystemRequirements = {};

  // Kategorie erkennen
  const categoryMatch = productName.match(/(Kragarmregal|Palettenregal|Fachbodenregal|Weitspannregal)/i);
  if (categoryMatch) {
    req.category = categoryMatch[1];
  }

  // Breite erkennen (z.B. "7000mm", "7000 mm", "7,0m", "7 Meter")
  const widthMatch = productName.match(/(\d+(?:[.,]\d+)?)\s*(?:mm|m|meter|breit)/i);
  if (widthMatch) {
    let width = parseFloat(widthMatch[1].replace(',', '.'));
    // Konvertiere zu mm falls in Metern angegeben
    if (productName.match(/\d+(?:[.,]\d+)?\s*(?:m|meter)/i) && !productName.match(/mm/i)) {
      width = width * 1000;
    }
    req.totalWidth = Math.round(width);
  }

  // Höhe erkennen
  const heightMatch = productName.match(/(\d+(?:[.,]\d+)?)\s*(?:mm|m)\s*(?:hoch|höhe)/i);
  if (heightMatch) {
    let height = parseFloat(heightMatch[1].replace(',', '.'));
    if (productName.match(/\d+(?:[.,]\d+)?\s*m\s*(?:hoch|höhe)/i) && !heightMatch[0].includes('mm')) {
      height = height * 1000;
    }
    req.height = Math.round(height);
  }

  // Tragkraft erkennen
  const loadMatch = productName.match(/(\d+)\s*kg/i);
  if (loadMatch) {
    req.loadCapacity = parseInt(loadMatch[1]);
  }

  // Bauart erkennen
  if (productName.match(/doppelseitig/i)) {
    req.buildType = 'doppelseitig';
  } else if (productName.match(/einseitig/i)) {
    req.buildType = 'einseitig';
  }

  return req;
}

/**
 * Prüft, ob ein Produkt die Anforderungen erfüllt
 */
function matchesRequirements(product: Product, req: SystemRequirements): boolean {
  // Kategorie prüfen (über categoryNames)
  if (req.category && product.categoryNames) {
    const hasCategory = product.categoryNames.some(cat => 
      cat.toLowerCase().includes(req.category!.toLowerCase())
    );
    if (!hasCategory) return false;
  }

  // Höhe prüfen (über dimensions oder properties)
  if (req.height) {
    const productHeight = product.dimensions?.height;
    if (productHeight && Math.abs(productHeight - req.height) > 100) {
      // Toleranz von ±100mm
      return false;
    }
  }

  // Tragkraft prüfen (über customFields oder properties)
  if (req.loadCapacity) {
    const loadCapacity = product.customFields?.loadCapacity || product.customFields?.tragkraft;
    if (loadCapacity && loadCapacity < req.loadCapacity) {
      return false;
    }
  }

  // Bauart prüfen (über properties)
  if (req.buildType && product.properties) {
    const bauartProp = product.properties.find(p => 
      p.groupName.toLowerCase().includes('bauart') || 
      p.groupName.toLowerCase().includes('typ')
    );
    if (bauartProp) {
      const matches = bauartProp.optionName.toLowerCase().includes(req.buildType);
      if (!matches) return false;
    }
  }

  return true;
}

/**
 * Findet Grund- und Anbauregale für eine System-Anfrage
 */
export function findSystemComponents(
  requirements: SystemRequirements,
  allProducts: Product[]
): SystemMatch {
  // Keine System-Anfrage wenn keine Gesamtbreite angegeben
  if (!requirements.totalWidth) {
    return { isSystemRequest: false, confidence: 0 };
  }

  // Filtere Produkte nach Kategorie
  let categoryProducts = allProducts;
  if (requirements.category) {
    categoryProducts = allProducts.filter(p => 
      p.categoryNames?.some(cat => 
        cat.toLowerCase().includes(requirements.category!.toLowerCase())
      )
    );
  }

  // Finde Grundregal
  const baseProducts = categoryProducts.filter(p => {
    const regalTypProp = p.properties?.find(prop => 
      prop.groupName.toLowerCase().includes('regal-typ') ||
      prop.groupName.toLowerCase().includes('typ')
    );
    return regalTypProp?.optionName.toLowerCase().includes('grundregal');
  }).filter(p => matchesRequirements(p, requirements));

  // Finde Anbauregale
  const extensionProducts = categoryProducts.filter(p => {
    const regalTypProp = p.properties?.find(prop => 
      prop.groupName.toLowerCase().includes('regal-typ') ||
      prop.groupName.toLowerCase().includes('typ')
    );
    return regalTypProp?.optionName.toLowerCase().includes('anbauregal') ||
           regalTypProp?.optionName.toLowerCase().includes('anbau');
  }).filter(p => matchesRequirements(p, requirements));

  if (baseProducts.length === 0) {
    return { 
      isSystemRequest: true, 
      confidence: 0,
      reasoning: `Keine passenden ${requirements.category || 'Grund-Regale'} gefunden. Bitte überprüfen Sie die Spezifikationen.`
    };
  }

  // Berechne beste Kombination
  const combinations: Array<{
    base: Product;
    extension: Product;
    extensionCount: number;
    totalWidth: number;
    widthDiff: number;
    confidence: number;
  }> = [];

  // Prüfe zuerst Base-only Lösungen (ohne Anbauregale)
  for (const base of baseProducts) {
    const baseWidth = base.dimensions?.width || 0;
    if (baseWidth === 0) continue;

    const widthDiff = Math.abs(baseWidth - requirements.totalWidth);
    const maxAcceptableDiff = requirements.totalWidth * 0.05; // 5% Toleranz

    // Wenn das Grundregal allein die Anforderung erfüllt
    if (widthDiff <= maxAcceptableDiff) {
      const confidence = Math.max(0, 100 - (widthDiff / maxAcceptableDiff * 100));
      combinations.push({
        base,
        extension: extensionProducts[0] || base, // Dummy extension für Struktur
        extensionCount: 0,
        totalWidth: baseWidth,
        widthDiff,
        confidence: Math.min(100, Math.round(confidence))
      });
    }
  }

  // Dann prüfe Base + Extensions Kombinationen
  for (const base of baseProducts) {
    for (const ext of extensionProducts) {
      const baseWidth = base.dimensions?.width || 0;
      const extWidth = ext.dimensions?.width || 0;

      if (baseWidth === 0 || extWidth === 0) continue;

      // Berechne wie viele Anbauregale benötigt werden
      const remainingWidth = requirements.totalWidth - baseWidth;
      if (remainingWidth <= 0) continue; // Schon in Base-only behandelt

      const extensionCount = Math.round(remainingWidth / extWidth);
      if (extensionCount <= 0) continue;

      const totalWidth = baseWidth + (extensionCount * extWidth);
      const widthDiff = Math.abs(totalWidth - requirements.totalWidth);

      // Berechne Konfidenz (je näher an Zielbreite, desto höher)
      const maxAcceptableDiff = requirements.totalWidth * 0.05; // 5% Toleranz
      const confidence = Math.max(0, 100 - (widthDiff / maxAcceptableDiff * 100));

      combinations.push({
        base,
        extension: ext,
        extensionCount,
        totalWidth,
        widthDiff,
        confidence: Math.min(100, Math.round(confidence))
      });
    }
  }

  if (combinations.length === 0) {
    return {
      isSystemRequest: true,
      confidence: 0,
      reasoning: `Keine passende Kombination gefunden für ${requirements.totalWidth}mm Gesamtbreite.`
    };
  }

  // Sortiere nach Konfidenz (beste zuerst)
  combinations.sort((a, b) => b.confidence - a.confidence);

  const best = combinations[0];
  const alternatives = combinations.slice(1, 4).map(combo => ({
    baseProduct: combo.base,
    extensionProduct: combo.extension,
    baseQuantity: 1,
    extensionQuantity: combo.extensionCount,
    totalWidth: combo.totalWidth,
    confidence: combo.confidence,
    reasoning: `${combo.base.name} (${combo.base.dimensions?.width}mm) + ${combo.extensionCount}x ${combo.extension.name} (${combo.extension.dimensions?.width}mm) = ${combo.totalWidth}mm (Abweichung: ${combo.widthDiff}mm)`
  }));

  // Base-only oder Base+Extensions?
  if (best.extensionCount === 0) {
    return {
      isSystemRequest: true,
      baseProduct: best.base,
      baseQuantity: 1,
      extensionQuantity: 0,
      totalWidth: best.totalWidth,
      confidence: best.confidence,
      reasoning: `Passende Lösung: ${best.base.name} (${best.base.dimensions?.width}mm)${best.widthDiff > 0 ? ` (Abweichung: ${best.widthDiff}mm)` : ''}`,
      alternatives: alternatives.length > 0 ? alternatives : undefined
    };
  }

  return {
    isSystemRequest: true,
    baseProduct: best.base,
    extensionProduct: best.extension,
    baseQuantity: 1,
    extensionQuantity: best.extensionCount,
    totalWidth: best.totalWidth,
    confidence: best.confidence,
    reasoning: `Beste Kombination: ${best.base.name} (${best.base.dimensions?.width}mm) + ${best.extensionCount}x ${best.extension.name} (${best.extension.dimensions?.width}mm) = ${best.totalWidth}mm${best.widthDiff > 0 ? ` (Abweichung: ${best.widthDiff}mm)` : ''}`,
    alternatives: alternatives.length > 0 ? alternatives : undefined
  };
}
