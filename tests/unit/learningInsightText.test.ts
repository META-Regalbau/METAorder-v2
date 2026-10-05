/**
 * Lern-Insights in der Oberflaechensprache: der Server speichert Titel und Beschreibung auf Deutsch,
 * die Oberflaeche uebersetzt ueber den insightType. Geprueft mit i18next und den echten Sprachdateien.
 * Ausführung: npm test
 */
import { beforeAll, describe, expect, it } from "vitest";
import i18next, { type TFunction } from "i18next";
import de from "../../client/src/i18n/locales/de.json";
import en from "../../client/src/i18n/locales/en.json";
import es from "../../client/src/i18n/locales/es.json";
import {
  learningInsightDescription,
  learningInsightPairStats,
  learningInsightTitle,
  offerStatusLabel,
} from "../../client/src/lib/learningInsightText";

let t: Record<"de" | "en" | "es", TFunction>;

beforeAll(async () => {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: "de",
    fallbackLng: "de",
    resources: { de: { translation: de }, en: { translation: en }, es: { translation: es } },
  });
  t = { de: i18n.getFixedT("de"), en: i18n.getFixedT("en"), es: i18n.getFixedT("es") };
});

// So speichert der Lernlauf die Insights (server/offers/offerLearning.ts, server/cross-selling/crossSellLearning.ts)
const stored = {
  insightType: "top_customers",
  title: "Top Angebot-Kunden",
  description: "Kunden mit den meisten Angebotsanfragen",
};

describe("Lern-Insights: Titel und Beschreibung", () => {
  it("Englisch und Spanisch statt des gespeicherten deutschen Texts", () => {
    expect(learningInsightTitle(t.en, stored)).toBe("Top offer customers");
    expect(learningInsightDescription(t.en, stored)).toBe("Customers with the most offer requests");
    expect(learningInsightTitle(t.es, stored)).toBe("Clientes con más ofertas");
    expect(learningInsightDescription(t.es, { ...stored, insightType: "upsell_opportunities" })).toBe(
      "Recomendaciones con alto lift para la cesta",
    );
  });

  it("Deutsch aus der Sprachdatei (mit Umlauten statt des gespeicherten Texts)", () => {
    const funnel = { insightType: "top_quality_pairs", title: "Top-Qualitaets-Paare (Funnel)", description: null };
    expect(learningInsightTitle(t.de, funnel)).toBe("Top-Qualitäts-Paare (Funnel)");
    expect(learningInsightDescription(t.de, funnel)).toContain("letzte 90 Tage");
  });

  it("unbekannter Typ zeigt den gespeicherten Text", () => {
    const unknown = { insightType: "neuer_typ", title: "Neuer Hinweis", description: "vom Server" };
    expect(learningInsightTitle(t.es, unknown)).toBe("Neuer Hinweis");
    expect(learningInsightDescription(t.en, unknown)).toBe("vom Server");
    expect(learningInsightDescription(t.en, { ...unknown, description: undefined })).toBe("");
  });
});

describe("Lern-Insights: Angebotsstatus und Paare", () => {
  it("Angebotsstatus uebersetzt, unbekannte Werte roh", () => {
    expect(offerStatusLabel(t.de, "expired")).toBe(de.offers.status.expired);
    expect(offerStatusLabel(t.es, "draft")).toBe(es.offers.status.draft);
    expect(offerStatusLabel(t.en, "unknown")).toBe(en.common.unknown);
    expect(offerStatusLabel(t.en, "custom_state")).toBe("custom_state");
  });

  it("Warenkorb-Paar mit Support und Lift, Zahlen in der Sprache (frueher immer \"1.4%\", auch auf Deutsch)", () => {
    const pair = { source: "4026212266610", target: "4026212328479", support: 0.014010507880910683, lift: 41.52727272727273 };
    expect(learningInsightPairStats(t.de, pair, "de")).toBe("1,4\u00a0% · 41,53");
    expect(learningInsightPairStats(t.en, pair, "en")).toBe("1.4% · 41.53");
  });

  it("Funnel-Paar ohne Support/Lift (frueher Absturz bei pair.lift.toFixed)", () => {
    const pair = { source: "A", target: "B", impressions: 40, clicks: 6, adds: 5, addRatePct: 12.5 };
    expect(learningInsightPairStats(t.de, pair, "de")).toBe("12,5\u00a0% / 40 Imp.");
    expect(learningInsightPairStats(t.es, pair, "es")).toBe("12,5\u00a0% / 40 impr.");
    expect(learningInsightPairStats(t.en, { ...pair, impressions: 12000 }, "en")).toBe("12.5% / 12,000 imp.");
    expect(learningInsightPairStats(t.en, { source: "A", target: "B" })).toBe("");
  });
});
