/**
 * Reiter "Natürliche Sprache": Darstellung der Antworten (client/src/lib/nlAnalytics.ts) - Betraege
 * vs. Anzahlen, Status-Codes uebersetzt, Prognose geteilt in Ist und Prognose, Fehlercodes.
 * Ausführung: npm test
 */
import { beforeAll, describe, expect, it } from "vitest";
import i18next, { type TFunction } from "i18next";
import de from "../../client/src/i18n/locales/de.json";
import es from "../../client/src/i18n/locales/es.json";
import {
  formatNlAxisValue,
  formatNlValue,
  nlAlgorithmKey,
  nlChartPoints,
  nlDataKind,
  nlErrorCode,
  nlLabel,
  nlQueryTypeKey,
  nlSummaryKind,
  nlView,
} from "../../client/src/lib/nlAnalytics";

let t: TFunction;
beforeAll(async () => {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: "es", fallbackLng: "de", resources: { de: { translation: de }, es: { translation: es } } });
  t = i18n.t.bind(i18n) as TFunction;
});

describe("Werte und Beschriftungen", () => {
  it("allgemeine Statistiken: erste Zeile Anzahl, dann Betraege", () => {
    expect([0, 1, 2].map((i) => nlDataKind("general_statistics", i))).toEqual(["count", "currency", "currency"]);
    expect(nlDataKind("top_products", 0)).toBe("count");
    expect(nlDataKind("customer_rankings", 0)).toBe("currency");
  });

  it("Summen: Zahlungsanalyse und Verspaetete in Euro, Gewicht in kg, Status-Verteilung als Anzahl", () => {
    expect(nlSummaryKind("payment_analysis")).toBe("currency");
    expect(nlSummaryKind("delayed_orders")).toBe("currency");
    expect(nlSummaryKind("weight_analysis")).toBe("weight");
    expect(nlSummaryKind("order_status_distribution")).toBe("count");
  });

  it("Status-Codes uebersetzt, andere Beschriftungen unveraendert", () => {
    expect(nlLabel(t, "order_status_distribution", "in_progress")).toBe(es.status.in_progress);
    expect(nlLabel(t, "payment_analysis", "paid")).toBe(es.paymentStatus.paid);
    expect(nlLabel(t, "top_products", "in_progress")).toBe("in_progress");
  });

  it("Ansicht je Typ", () => {
    expect(nlView("delayed_orders")).toBe("table_delayed");
    expect(nlView("customer_analysis")).toBe("table_customers");
    expect(nlView("revenue_forecast")).toBe("line");
    expect(nlView("payment_analysis")).toBe("bar");
  });

  it("Formatierung in der Sprache, Typ-Schluessel camelCase", () => {
    expect(formatNlValue(1234.5, "currency", "de").replace(/\u00a0/g, " ")).toBe("1.234,50 €"); // Intl: geschuetztes Leerzeichen
    expect(formatNlValue(1234.5, "currency", "en")).toBe("€1,234.50");
    expect(formatNlValue(12.345, "weight", "de")).toBe("12,35 kg");
    expect(formatNlValue(undefined, "count", "de")).toBe("—");
    expect(nlQueryTypeKey("order_status_distribution")).toBe("analytics.nlQuery.types.orderStatusDistribution");
    expect(nlAlgorithmKey("Exponential Smoothing")).toBe("analytics.nlQuery.forecast.exponentialSmoothing");
  });
});

describe("Prognose im Diagramm", () => {
  it("Ist-Werte bis historicalPeriods, danach Prognose mit Grenzen; Uebergang verbunden", () => {
    const points = nlChartPoints(t, "revenue_forecast", {
      labels: ["2026-07", "2026-08", "2026-09", "2026-10"],
      data: [100, 120, 130, 140],
      metadata: { historicalPeriods: 2 },
      forecast: { lowerBound: [110, 115], upperBound: [150, 165] },
    });
    expect(points).toEqual([
      { label: "2026-07", historical: 100, predicted: undefined },
      { label: "2026-08", historical: 120, predicted: 120 },
      { label: "2026-09", predicted: 130, lower: 110, upper: 150 },
      { label: "2026-10", predicted: 140, lower: 115, upper: 165 },
    ]);
  });

  it("Prognose-Monate im Format der Ist-Werte (\"2026-10-01\" -> \"2026-10\"), Tage bleiben", () => {
    const monthly = nlChartPoints(t, "revenue_forecast", {
      labels: ["2026-08", "2026-09", "2026-10-01"], data: [1, 2, 3], metadata: { historicalPeriods: 2 }, forecast: {},
    });
    expect(monthly.map((p) => p.label)).toEqual(["2026-08", "2026-09", "2026-10"]);
    const daily = nlChartPoints(t, "revenue_forecast", {
      labels: ["2026-09-30", "2026-10-01"], data: [1, 2], metadata: { historicalPeriods: 1 }, forecast: {},
    });
    expect(daily.map((p) => p.label)).toEqual(["2026-09-30", "2026-10-01"]);
  });

  it("Achsen kurz (Millionen statt voller Betraege)", () => {
    expect(formatNlAxisValue(12265482.81, "currency", "en")).toBe("€12.3M");
    expect(formatNlAxisValue(12265482.81, "currency", "de").replace(/\u00a0/g, " ")).toBe("12,3 Mio. €");
    expect(formatNlAxisValue(undefined, "count", "de")).toBe("");
  });

  it("ohne Prognose: Werte mit uebersetzter Beschriftung", () => {
    expect(nlChartPoints(t, "order_status_distribution", { labels: ["open"], data: [3] })).toEqual([{ label: es.status.open, value: 3 }]);
  });
});

describe("Fehlercodes", () => {
  it("aus der Antwort von apiRequest, sonst unexpected", () => {
    expect(nlErrorCode(new Error('503: {"error":"No AI chat provider","code":"llm_unavailable"}'))).toBe("llm_unavailable");
    expect(nlErrorCode(new Error('400: {"error":"x","code":"irgendwas"}'))).toBe("unexpected");
    expect(nlErrorCode(new Error("Failed to fetch"))).toBe("unexpected");
  });
});
