import OpenAI from "openai";
import type { Product } from "@shared/schema";
import { extractProductMetadata, extractProductSeries } from "./productPropertyExtractor";
import { getOpenAIClient } from "./openaiClient";

interface SemanticSearchInput {
  query: string;
  language?: "de" | "en" | "es";
}

interface SemanticSearchInterpretation {
  productType?: string;
  dimensions?: {
    width?: { value: number; tolerance?: number };
    height?: { value: number; tolerance?: number };
    depth?: { value: number; tolerance?: number };
  };
  properties?: {
    loadCapacity?: { min?: number; max?: number; unit: string };
    shelfType?: string;
    buildType?: string;
    series?: string;
    material?: string;
    color?: string;
  };
  keywords?: string[];
  interpretation: string;
}

interface SemanticSearchResult {
  interpretation: SemanticSearchInterpretation;
  products: Product[];
  totalResults: number;
}

export async function executeSemanticProductSearch(
  input: SemanticSearchInput,
  allProducts: Product[],
  options?: { promptAddon?: string }
): Promise<SemanticSearchResult> {
  const { query, language = "de" } = input;

  console.log(`[Semantic Search] Processing query: "${query}" (language: ${language})`);

  const systemPrompt = getSystemPrompt(language, options?.promptAddon);
  const userPrompt = getUserPrompt(query, language);

  let interpretation: SemanticSearchInterpretation;

  try {
    const openaiConfig = getOpenAIClient();
    console.log(`[Semantic Search] Using OpenAI in ${openaiConfig.mode} mode`);
    
    const completion = await openaiConfig.client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0]?.message?.content || "{}";
    interpretation = JSON.parse(responseText) as SemanticSearchInterpretation;
    
    console.log("[Semantic Search] AI Interpretation:", JSON.stringify(interpretation, null, 2));
  } catch (error) {
    console.error("[Semantic Search] GPT-4o error:", error);
    interpretation = createFallbackInterpretation(query, language);
  }

  // If any keyword exactly matches the productType, it's likely a specific product name (not a generic category)
  // In this case, remove productType to prioritize keyword matching
  let adjustedInterpretation = { ...interpretation };
  if (interpretation.productType && interpretation.keywords) {
    const productTypeLower = interpretation.productType.toLowerCase();
    const keywordsMatch = interpretation.keywords.some(kw => kw.toLowerCase() === productTypeLower);
    if (keywordsMatch) {
      console.log(`[Semantic Search] productType "${interpretation.productType}" matches a keyword - treating as specific product name, ignoring productType filter`);
      adjustedInterpretation.productType = undefined;
    }
  }

  let filteredProducts = filterProductsByInterpretation(allProducts, adjustedInterpretation);
  
  // Fallback: If productType filter resulted in 0 matches but we have keywords,
  // retry without productType to allow keyword-based matching
  if (filteredProducts.length === 0 && interpretation.productType && interpretation.keywords && interpretation.keywords.length > 0) {
    console.log(`[Semantic Search] No results with productType "${interpretation.productType}", retrying without productType filter`);
    const fallbackInterpretation = { ...interpretation, productType: undefined };
    filteredProducts = filterProductsByInterpretation(allProducts, fallbackInterpretation);
    console.log(`[Semantic Search] Fallback found ${filteredProducts.length} matching products`);
  }
  
  console.log(`[Semantic Search] Found ${filteredProducts.length} matching products`);

  return {
    interpretation,
    products: filteredProducts.slice(0, 50),
    totalResults: filteredProducts.length
  };
}

function getSystemPrompt(language: string, addon?: string): string {
  const extra = addon ? `\n\nZusätzliche Anweisungen:\n${addon}` : "";
  const prompts = {
    de: `Du bist ein intelligenter Produktsuchassistent für ein industrielles Lagersystem. Analysiere natürlichsprachliche Suchanfragen und extrahiere strukturierte Informationen.

Extrahiere folgende Informationen (wenn vorhanden):
- productType: Art des Produkts NUR wenn es ein allgemeiner Typ ist (z.B. "Regal", "Fachboden", "Stütze"). WICHTIG: Spezifische Produktnamen wie "Holmebene", "Holm", "Träger" NICHT als productType, sondern als keywords!
- dimensions: Abmessungen mit optionaler Toleranz
  - width, height, depth: { value: number, tolerance?: number (in %) }
- properties:
  - loadCapacity: { min?: number, max?: number, unit: "kg" | "t" }
  - shelfType: "Grundregal" | "Anbauregal" | null
  - buildType: "einseitig" | "doppelseitig" | null
  - series: Produktserie (z.B. "ATLAS ST", "MULTISTRONG", "MINI-RACK", "SPEED-RACK")
  - material: Material (z.B. "Stahl", "verzinkt")
  - color: Farbe
- keywords: IMMER ALLE konkreten Begriffe aus der Anfrage als keywords übernehmen! Auch spezifische Produktbezeichnungen wie "Holmebene", "Holm", etc.
- interpretation: Natürlichsprachliche Zusammenfassung auf Deutsch

WICHTIG:
- IMMER alle konkreten Suchbegriffe in keywords aufnehmen, damit spezifische Produktnamen gefunden werden
- productType nur für allgemeine Kategorien verwenden, NICHT für spezifische Produktnamen
- Verwende NUR exakte Dimensionen ohne Toleranz, es sei denn, der Benutzer fragt explizit nach "ca.", "ungefähr", "etwa"
- Keine Fuzzy-Matching-Toleranz ohne ausdrückliche Anfrage
- Serien wie "ATLAS ST", "MULTISTRONG L/M/H", "MINI-RACK", "SPEED-RACK" sind NICHT kompatibel
- Antworte im JSON-Format${extra}`,

    en: `You are an intelligent product search assistant for an industrial storage system. Analyze natural language search queries and extract structured information.

Extract the following information (if present):
- productType: Type of product (e.g., "shelf", "shelf board", "support")
- dimensions: Measurements with optional tolerance
  - width, height, depth: { value: number, tolerance?: number (in %) }
- properties:
  - loadCapacity: { min?: number, max?: number, unit: "kg" | "t" }
  - shelfType: "Grundregal" (base) | "Anbauregal" (extension) | null
  - buildType: "einseitig" (single-sided) | "doppelseitig" (double-sided) | null
  - series: Product series (e.g., "ATLAS ST", "MULTISTRONG", "MINI-RACK", "SPEED-RACK")
  - material: Material (e.g., "steel", "galvanized")
  - color: Color
- keywords: Important keywords from the query
- interpretation: Natural language summary in English

IMPORTANT:
- Use ONLY exact dimensions without tolerance unless user explicitly asks for "approx.", "about", "around"
- No fuzzy matching tolerance without explicit request
- Series like "ATLAS ST", "MULTISTRONG L/M/H", "MINI-RACK", "SPEED-RACK" are NOT compatible
- Respond in JSON format${extra}`,

    es: `Eres un asistente inteligente de búsqueda de productos para un sistema de almacenamiento industrial. Analiza consultas en lenguaje natural y extrae información estructurada.

Extrae la siguiente información (si está presente):
- productType: Tipo de producto (ej., "estante", "tablero", "soporte")
- dimensions: Medidas con tolerancia opcional
  - width, height, depth: { value: number, tolerance?: number (en %) }
- properties:
  - loadCapacity: { min?: number, max?: number, unit: "kg" | "t" }
  - shelfType: "Grundregal" (base) | "Anbauregal" (extensión) | null
  - buildType: "einseitig" (un lado) | "doppelseitig" (dos lados) | null
  - series: Serie de producto (ej., "ATLAS ST", "MULTISTRONG", "MINI-RACK", "SPEED-RACK")
  - material: Material (ej., "acero", "galvanizado")
  - color: Color
- keywords: Palabras clave importantes de la consulta
- interpretation: Resumen en lenguaje natural en español

IMPORTANTE:
- Usa SOLO dimensiones exactas sin tolerancia a menos que el usuario pregunte explícitamente por "aprox.", "alrededor de"
- Sin tolerancia de coincidencia difusa sin solicitud explícita
- Series como "ATLAS ST", "MULTISTRONG L/M/H", "MINI-RACK", "SPEED-RACK" NO son compatibles
- Responde en formato JSON${extra}`
  };

  return prompts[language as keyof typeof prompts] || prompts.de;
}

function getUserPrompt(query: string, language: string): string {
  const examples = {
    de: `Beispiele:
Anfrage: "Regal 2000mm hoch"
→ { "productType": "Regal", "dimensions": { "height": { "value": 2000 } }, "keywords": ["Regal", "2000mm", "hoch"], "interpretation": "Suche nach Regalen mit einer Höhe von 2000mm" }

Anfrage: "Schwerlasregal ca. 3 Meter breit"
→ { "productType": "Schwerlasregal", "dimensions": { "width": { "value": 3000, "tolerance": 5 } }, "keywords": ["Schwerlasregal", "3 Meter", "breit"], "interpretation": "Suche nach Schwerlastregalen mit einer Breite von ca. 3000mm (±5%)" }`,

    en: `Examples:
Query: "shelf 2000mm high"
→ { "productType": "shelf", "dimensions": { "height": { "value": 2000 } }, "keywords": ["shelf", "2000mm", "high"], "interpretation": "Search for shelves with a height of 2000mm" }

Query: "heavy-duty shelf approx. 3 meters wide"
→ { "productType": "heavy-duty shelf", "dimensions": { "width": { "value": 3000, "tolerance": 5 } }, "keywords": ["heavy-duty", "shelf", "3 meters", "wide"], "interpretation": "Search for heavy-duty shelves with a width of approx. 3000mm (±5%)" }`,

    es: `Ejemplos:
Consulta: "estante 2000mm alto"
→ { "productType": "estante", "dimensions": { "height": { "value": 2000 } }, "keywords": ["estante", "2000mm", "alto"], "interpretation": "Búsqueda de estantes con una altura de 2000mm" }

Consulta: "estante de carga pesada aprox. 3 metros de ancho"
→ { "productType": "estante de carga pesada", "dimensions": { "width": { "value": 3000, "tolerance": 5 } }, "keywords": ["carga pesada", "estante", "3 metros", "ancho"], "interpretation": "Búsqueda de estantes de carga pesada con un ancho de aprox. 3000mm (±5%)" }`
  };

  return `${examples[language as keyof typeof examples] || examples.de}

Analysiere jetzt diese Anfrage:
"${query}"`;
}

function createFallbackInterpretation(query: string, language: string): SemanticSearchInterpretation {
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
  
  const interpretations = {
    de: `Keyword-Suche nach: ${query}`,
    en: `Keyword search for: ${query}`,
    es: `Búsqueda de palabras clave: ${query}`
  };

  return {
    keywords,
    interpretation: interpretations[language as keyof typeof interpretations] || interpretations.de
  };
}

function filterProductsByInterpretation(
  products: Product[],
  interpretation: SemanticSearchInterpretation
): Product[] {
  let filtered = [...products];

  if (interpretation.productType) {
    const productType = interpretation.productType.toLowerCase();
    const beforeFilter = filtered.length;
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(productType) ||
      p.description?.toLowerCase().includes(productType)
    );
    console.log(`[Semantic Search Filter] productType="${productType}": ${beforeFilter} → ${filtered.length} products`);
  }

  if (interpretation.dimensions?.width) {
    const { value, tolerance = 0 } = interpretation.dimensions.width;
    const min = value * (1 - tolerance / 100);
    const max = value * (1 + tolerance / 100);
    filtered = filtered.filter(p => {
      const metadata = extractProductMetadata(p);
      const width = metadata.dimensions.width;
      return width !== null && width !== undefined && width >= min && width <= max;
    });
  }

  if (interpretation.dimensions?.height) {
    const { value, tolerance = 0 } = interpretation.dimensions.height;
    const min = value * (1 - tolerance / 100);
    const max = value * (1 + tolerance / 100);
    filtered = filtered.filter(p => {
      const metadata = extractProductMetadata(p);
      const height = metadata.dimensions.height;
      return height !== null && height !== undefined && height >= min && height <= max;
    });
  }

  if (interpretation.dimensions?.depth) {
    const { value, tolerance = 0 } = interpretation.dimensions.depth;
    const min = value * (1 - tolerance / 100);
    const max = value * (1 + tolerance / 100);
    filtered = filtered.filter(p => {
      const metadata = extractProductMetadata(p);
      const depth = metadata.dimensions.depth || metadata.dimensions.length;
      return depth !== null && depth !== undefined && depth >= min && depth <= max;
    });
  }

  if (interpretation.properties?.loadCapacity) {
    const { min: minCapacity, max: maxCapacity } = interpretation.properties.loadCapacity;
    filtered = filtered.filter(p => {
      const loadCapacityStr = p.customFields?.find((cf: any) => 
        cf.name?.toLowerCase().includes('traglast') || 
        cf.name?.toLowerCase().includes('load') ||
        cf.name?.toLowerCase().includes('capacity')
      )?.value;
      
      if (!loadCapacityStr) return false;
      
      const loadCapacity = parseFloat(String(loadCapacityStr));
      if (isNaN(loadCapacity)) return false;
      
      if (minCapacity !== undefined && loadCapacity < minCapacity) return false;
      if (maxCapacity !== undefined && loadCapacity > maxCapacity) return false;
      return true;
    });
  }

  if (interpretation.properties?.series) {
    const targetSeries = interpretation.properties.series.toUpperCase();
    filtered = filtered.filter(p => {
      const productSeries = extractProductSeries(p);
      if (!productSeries) return false;
      
      return productSeries.toUpperCase().includes(targetSeries) || 
             targetSeries.includes(productSeries.toUpperCase());
    });
  }

  if (interpretation.keywords && interpretation.keywords.length > 0) {
    const beforeFilter = filtered.length;
    filtered = filtered.filter(p => {
      const searchText = `${p.name} ${p.description || ""} ${p.productNumber || ""}`.toLowerCase();
      return interpretation.keywords!.some(keyword => 
        searchText.includes(keyword.toLowerCase())
      );
    });
    console.log(`[Semantic Search Filter] keywords=${JSON.stringify(interpretation.keywords)}: ${beforeFilter} → ${filtered.length} products`);
  }

  return filtered;
}
