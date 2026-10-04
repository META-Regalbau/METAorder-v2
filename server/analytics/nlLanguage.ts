import { ANALYTICS_LANGUAGES, type AnalyticsLanguage } from "@shared/schema";

/**
 * Sprache der Natural-Language-Analytics: die Oberflaeche schickt ihre Sprache mit, KI-Texte und
 * feste Beschriftungen der Antwort folgen ihr. Unbekannte oder fehlende Werte ergeben Deutsch.
 */
export function parseAnalyticsLanguage(value: unknown): AnalyticsLanguage {
  const short = typeof value === "string" ? value.trim().toLowerCase().split("-")[0] : "";
  return (ANALYTICS_LANGUAGES as readonly string[]).includes(short) ? (short as AnalyticsLanguage) : "de";
}

/** Name der Zielsprache fuer die (deutsch formulierten) Prompts */
export const PROMPT_LANGUAGE_NAME: Record<AnalyticsLanguage, string> = {
  de: "Deutsch",
  en: "Englisch",
  es: "Spanisch",
};

type NlTexts = {
  orderCount: string;
  totalRevenue: string;
  averageOrderValue: string;
  unknownSalesChannel: string;
  uncategorized: string;
  /** Positionen je Bestellung, z. B. "2-3 Artikel" */
  lineItems: (range: string, single: boolean) => string;
  /** Stueckzahl je Bestellung, z. B. "3-5 Stück" */
  pieces: (range: string) => string;
  // Regelbasierte Hinweise, wenn keine KI erreichbar ist
  totalValue: (value: string) => string;
  averageValue: (value: string) => string;
  dataPoints: (count: number) => string;
  topProduct: (name: string) => string;
  delayedOrders: (count: number) => string;
  trendUp: (pct: string) => string;
  trendDown: (pct: string) => string;
  top3Share: (pct: string) => string;
};

export const NL_TEXTS: Record<AnalyticsLanguage, NlTexts> = {
  de: {
    orderCount: "Anzahl Bestellungen",
    totalRevenue: "Gesamtumsatz",
    averageOrderValue: "Durchschn. Bestellwert",
    unknownSalesChannel: "Unbekannt",
    uncategorized: "Ohne Kategorie",
    lineItems: (range) => `${range} Artikel`,
    pieces: (range) => `${range} Stück`,
    totalValue: (value) => `Gesamtwert: ${value}€`,
    averageValue: (value) => `Durchschnittswert: ${value}€`,
    dataPoints: (count) => `Anzahl Datenpunkte: ${count}`,
    topProduct: (name) => `Das meistverkaufte Produkt ist "${name}"`,
    delayedOrders: (count) => `Es gibt ${count} verspätete Bestellungen, die Aufmerksamkeit erfordern`,
    trendUp: (pct) => `Positiver Trend: ${pct}% Wachstum im Vergleich zur ersten Hälfte des Zeitraums`,
    trendDown: (pct) => `Negativer Trend: ${pct}% Rückgang im Vergleich zur ersten Hälfte des Zeitraums`,
    top3Share: (pct) => `Die Top 3 Kunden generieren ${pct}% des Gesamtumsatzes`,
  },
  en: {
    orderCount: "Number of orders",
    totalRevenue: "Total revenue",
    averageOrderValue: "Average order value",
    unknownSalesChannel: "Unknown",
    uncategorized: "Uncategorized",
    lineItems: (range, single) => `${range} ${single ? "item" : "items"}`,
    pieces: (range) => `${range} pcs`,
    totalValue: (value) => `Total value: €${value}`,
    averageValue: (value) => `Average value: €${value}`,
    dataPoints: (count) => `Number of data points: ${count}`,
    topProduct: (name) => `The best-selling product is "${name}"`,
    delayedOrders: (count) => `There are ${count} delayed orders that need attention`,
    trendUp: (pct) => `Positive trend: ${pct}% growth compared with the first half of the period`,
    trendDown: (pct) => `Negative trend: ${pct}% decline compared with the first half of the period`,
    top3Share: (pct) => `The top 3 customers generate ${pct}% of total revenue`,
  },
  es: {
    orderCount: "Número de pedidos",
    totalRevenue: "Facturación total",
    averageOrderValue: "Valor medio del pedido",
    unknownSalesChannel: "Desconocido",
    uncategorized: "Sin categoría",
    lineItems: (range, single) => `${range} ${single ? "artículo" : "artículos"}`,
    pieces: (range) => `${range} uds.`,
    totalValue: (value) => `Valor total: ${value} €`,
    averageValue: (value) => `Valor medio: ${value} €`,
    dataPoints: (count) => `Número de puntos de datos: ${count}`,
    topProduct: (name) => `El producto más vendido es "${name}"`,
    delayedOrders: (count) => `Hay ${count} pedidos retrasados que requieren atención`,
    trendUp: (pct) => `Tendencia positiva: crecimiento del ${pct} % respecto a la primera mitad del periodo`,
    trendDown: (pct) => `Tendencia negativa: descenso del ${pct} % respecto a la primera mitad del periodo`,
    top3Share: (pct) => `Los 3 principales clientes generan el ${pct} % de la facturación total`,
  },
};
