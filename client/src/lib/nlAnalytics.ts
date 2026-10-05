/**
 * Darstellung der Antworten von POST /api/analytics/nl-query (Reiter "Natürliche Sprache" der
 * Statistik): welche Werte Betraege sind, welche Beschriftungen Codes, welche Diagrammart passt.
 * Die Antwortform je Abfragetyp steht in server/analytics/analyticsQueryExecutor.ts.
 */
import type { AnalyticsQueryType, NlQueryErrorCode } from "@shared/schema";
import { NL_QUERY_ERROR_CODES } from "@shared/schema";
import { apiErrorInfo } from "./apiError";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type NlValueKind = "currency" | "count" | "weight";

/** Abfragetypen, deren Datenpunkte Betraege (EUR) sind */
const CURRENCY_DATA_TYPES = new Set<AnalyticsQueryType>([
  "revenue_trends",
  "customer_rankings",
  "product_performance",
  "category_performance",
  "sales_channel_analysis",
  "revenue_forecast",
  "seasonal_analysis",
]);

/** Abfragetypen, deren Summe/Durchschnitt/Min/Max Betraege sind (auch wenn die Datenpunkte Anzahlen sind) */
const CURRENCY_SUMMARY_TYPES = new Set<AnalyticsQueryType>([
  ...CURRENCY_DATA_TYPES,
  "delayed_orders",
  "customer_analysis",
  "payment_analysis",
  "general_statistics",
]);

const TIME_SERIES_TYPES = new Set<AnalyticsQueryType>([
  "order_trends",
  "revenue_trends",
  "seasonal_analysis",
  "revenue_forecast",
  "product_demand_forecast",
  "trend_forecast",
]);

/** Art eines Datenpunkts; bei den allgemeinen Statistiken je Zeile (Anzahl, Umsatz, Durchschnitt) */
export function nlDataKind(type: AnalyticsQueryType, index: number): NlValueKind {
  if (type === "general_statistics") return index === 0 ? "count" : "currency";
  return CURRENCY_DATA_TYPES.has(type) ? "currency" : "count";
}

/** Art von Summe, Durchschnitt, Minimum und Maximum; die Anzahl ist immer eine Anzahl */
export function nlSummaryKind(type: AnalyticsQueryType): NlValueKind {
  if (type === "weight_analysis") return "weight";
  return CURRENCY_SUMMARY_TYPES.has(type) ? "currency" : "count";
}

export type NlView = "table_delayed" | "table_customers" | "line" | "bar";

export function nlView(type: AnalyticsQueryType): NlView {
  if (type === "delayed_orders") return "table_delayed";
  if (type === "customer_analysis") return "table_customers";
  return TIME_SERIES_TYPES.has(type) ? "line" : "bar";
}

/** Beschriftungen, die Codes sind (Bestell- und Zahlungsstatus), in der Oberflaechensprache */
export function nlLabel(t: Translate, type: AnalyticsQueryType, label: string): string {
  if (type === "order_status_distribution") return t(`status.${label}`, { defaultValue: label });
  if (type === "payment_analysis") return t(`paymentStatus.${label}`, { defaultValue: label });
  return label;
}

/** Schluessel unter analytics.nlQuery.types (camelCase des Abfragetyps) */
export function nlQueryTypeKey(type: string): string {
  return `analytics.nlQuery.types.${type.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`;
}

/** Schluessel der Verbesserungs-Kategorie unter analytics.nlQuery.improvements */
export function nlImprovementCategoryKey(category: string): string {
  return `analytics.nlQuery.improvements.${category === "customer_service" ? "customerService" : category}`;
}

export function formatNlValue(value: unknown, kind: NlValueKind, locale: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return value == null ? "—" : String(value);
  if (kind === "currency") return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(value);
  if (kind === "weight") return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)} kg`;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

/** Kurzform fuer Diagrammachsen ("12 Mio. €", "€12M"), damit lange Betraege nicht abgeschnitten werden */
export function formatNlAxisValue(value: unknown, kind: NlValueKind, locale: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const compact: Intl.NumberFormatOptions = { notation: "compact", maximumFractionDigits: 1 };
  if (kind === "currency") return new Intl.NumberFormat(locale, { ...compact, style: "currency", currency: "EUR" }).format(value);
  if (kind === "weight") return `${new Intl.NumberFormat(locale, compact).format(value)} kg`;
  return new Intl.NumberFormat(locale, compact).format(value);
}

/** Fehlercode aus der Antwort (ApiError bzw. altes Format "Status: Antworttext") */
export function nlErrorCode(error: unknown): NlQueryErrorCode {
  const code = apiErrorInfo(error)?.code;
  if (code && (NL_QUERY_ERROR_CODES as readonly string[]).includes(code)) {
    return code as NlQueryErrorCode;
  }
  return "unexpected";
}

/** Prognose-Algorithmus des Servers ("Linear Regression" usw.) als Uebersetzungsschluessel */
export function nlAlgorithmKey(algorithm: string | undefined): string | null {
  const a = (algorithm ?? "").toLowerCase();
  if (a.includes("linear")) return "analytics.nlQuery.forecast.linearRegression";
  if (a.includes("exponential")) return "analytics.nlQuery.forecast.exponentialSmoothing";
  if (a.includes("seasonal")) return "analytics.nlQuery.forecast.seasonalDecomposition";
  return null;
}

/** Verlaesslichkeit der Prognose nach Genauigkeit (0-100) */
export function nlReliabilityKey(accuracy: number): string {
  if (accuracy >= 80) return "analytics.nlQuery.forecast.veryReliable";
  if (accuracy >= 60) return "analytics.nlQuery.forecast.reliable";
  return "analytics.nlQuery.forecast.conditionallyReliable";
}

/** Trend aus den Metadaten (increasing/decreasing/stable) */
export function nlTrendKey(trend: unknown): string | null {
  if (trend === "increasing") return "analytics.nlQuery.forecast.trendIncreasing";
  if (trend === "decreasing") return "analytics.nlQuery.forecast.trendDecreasing";
  if (trend === "stable") return "analytics.nlQuery.forecast.trendStable";
  return null;
}

export type NlChartPoint = { label: string; value?: number; historical?: number; predicted?: number; lower?: number; upper?: number };

/**
 * Datenpunkte fuers Diagramm. Prognosen: die ersten historicalPeriods Werte sind Ist-Werte, danach
 * Prognose mit Unter-/Obergrenze; der letzte Ist-Wert beginnt auch die Prognoselinie.
 */
export function nlChartPoints(
  t: Translate,
  type: AnalyticsQueryType,
  result: { labels: string[]; data: unknown[]; metadata?: Record<string, any>; forecast?: { lowerBound?: number[]; upperBound?: number[] } },
): NlChartPoint[] {
  const values = result.data.map((v) => (typeof v === "number" ? v : undefined));
  const historical = typeof result.metadata?.historicalPeriods === "number" ? result.metadata.historicalPeriods : undefined;
  if (result.forecast && historical !== undefined) {
    // Die Prognose beschriftet Monate als Tag ("2026-10-01"), die Ist-Werte als Monat ("2026-09")
    const monthly = result.labels.slice(0, historical).every((l) => /^\d{4}-\d{2}$/.test(l));
    const labelOf = (l: string) => (monthly && /^\d{4}-\d{2}-01$/.test(l) ? l.slice(0, 7) : l);
    return result.labels.map((raw, i) => {
      const label = labelOf(raw);
      if (i < historical) {
        return { label, historical: values[i], predicted: i === historical - 1 ? values[i] : undefined };
      }
      const f = i - historical;
      return { label, predicted: values[i], lower: result.forecast?.lowerBound?.[f], upper: result.forecast?.upperBound?.[f] };
    });
  }
  return result.labels.map((label, i) => ({ label: nlLabel(t, type, label), value: values[i] }));
}
