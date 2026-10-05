/**
 * Produktseite "Mit KI auslegen": die KI zerlegt eine Anfrage wie "Regal 2 m hoch, 3 m breit" in
 * Produkttyp und Abmessungen (POST /api/products/semantic-search mit interpretOnly); daraus werden die
 * vorhandenen Filter - Suchwort und Breite/Hoehe/Tiefe in mm. Die Treffer liefert die normale
 * Produktsuche (jedes Wort muss vorkommen, deshalb nur Produkttyp und Serie, keine Fuellwoerter wie "hoch").
 */
export type ProductAiInterpretation = {
  productType?: string;
  keywords?: string[];
  dimensions?: {
    width?: { value?: number };
    height?: { value?: number };
    depth?: { value?: number };
  };
  properties?: { series?: string };
  interpretation?: string;
};

export type ProductAiFilters = { search: string; width: string; height: string; depth: string; summary: string };

const mm = (dimension?: { value?: number }) =>
  typeof dimension?.value === "number" && Number.isFinite(dimension.value) && dimension.value > 0 ? String(Math.round(dimension.value)) : "";

export function filtersFromInterpretation(interpretation: ProductAiInterpretation, query: string): ProductAiFilters {
  const terms = [interpretation.productType, interpretation.properties?.series]
    .map((term) => (typeof term === "string" ? term.trim() : ""))
    .filter(Boolean);
  // ohne Produkttyp: Schluesselwoerter ohne Zahlen/Masse (die stehen in den Abmessungsfiltern)
  const fallback = (interpretation.keywords ?? [])
    .map((keyword) => String(keyword).trim())
    .filter((keyword) => keyword.length > 2 && !/\d/.test(keyword));
  const search = Array.from(new Set(terms.length > 0 ? terms : fallback.slice(0, 1))).join(" ") || query.trim();
  return {
    search,
    width: mm(interpretation.dimensions?.width),
    height: mm(interpretation.dimensions?.height),
    depth: mm(interpretation.dimensions?.depth),
    summary: typeof interpretation.interpretation === "string" ? interpretation.interpretation : "",
  };
}
