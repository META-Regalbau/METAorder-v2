/**
 * Statistik-Karte "Upsell-Potenzial": war leer. Der Lernlauf legte die Paare unter
 * data.recommendations ab (eine Kopie von "Top kombinierte Artikel"), die Statistik zeigt nur
 * data.pairs. Ausserdem stand jedes Paar doppelt drin (A->B und B->A) und nur mit Artikelnummern.
 * Jetzt: Top-Paare nach Lift je Paar einmal, Upsell nach Kaufwahrscheinlichkeit x Lift ohne die
 * Top-Paare, beide mit Produktnamen; die Statistik liest auch das alte Format.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import { buildLearningOutputs, buildProductNameMap } from "../../server/cross-selling/crossSellLearning";

const settings = {
  minSupport: 0,
  minConfidence: 0,
  minLift: 0,
  minPairCount: 1,
  maxRulesPerProduct: 10,
  maxRecommendationsPerProduct: 10,
} as any;

/** Paar mit Kennzahlen wie aus buildCooccurrenceRows */
function pair(a: string, b: string, pairCount: number, withA: number, withB: number, total = 100) {
  const support = pairCount / total;
  return {
    productNumberA: a,
    productNumberB: b,
    pairCount,
    ordersWithA: withA,
    ordersWithB: withB,
    totalOrders: total,
    support,
    confidence: pairCount / withA,
    lift: (pairCount / withA) / (withB / total),
  };
}

// Seltene Paare mit sehr hohem Lift (Top) und haeufige, verlaessliche Paare (Upsell)
const cooccurrences = [
  pair("TRAEGER", "BODEN", 2, 2, 2), // Lift 50, Kaufwahrscheinlichkeit 100 % in beide Richtungen
  pair("RAHMEN", "BODEN", 30, 40, 2), // Lift hoch fuer RAHMEN->BODEN (37,5) bei 75 %
  pair("REGAL", "FACHBODEN", 40, 50, 60), // 80 % Kaufwahrscheinlichkeit, Lift 1,33
  pair("REGAL", "RUECKWAND", 10, 50, 20),
  pair("SCHRAUBEN", "DUEBEL", 3, 30, 3),
  pair("KISTE", "DECKEL", 5, 6, 30),
  pair("HAKEN", "STANGE", 4, 20, 20),
  pair("LEITER", "SCHIENE", 6, 10, 10),
];

const names = buildProductNameMap([
  { items: [{ productNumber: "REGAL", name: "META CLIP Grundregal" }, { productNumber: "FACHBODEN", name: "Zusatz-Fachboden 1000 x 400" }] },
  { items: [{ productNumber: "REGAL", name: "anderer Name" }, { productNumber: " BODEN ", name: " Boden " }] },
] as any);

const { insights } = buildLearningOutputs(cooccurrences, settings, new Map(), names);
const byType = Object.fromEntries(insights.map((insight: any) => [insight.insightType, insight.data.pairs]));
const key = (p: any) => [p.source, p.target].sort().join("||");

describe("Insights der Warenkorb-Analyse", () => {
  it("Upsell-Potenzial unter data.pairs (wie die Statistik es liest), nicht leer", () => {
    expect(byType.upsell_opportunities?.length).toBeGreaterThan(0);
    expect(insights.find((i: any) => i.insightType === "upsell_opportunities")?.data).not.toHaveProperty("recommendations");
  });

  it("jedes Artikelpaar nur einmal (vorher A->B und B->A mit gleichem Lift)", () => {
    for (const list of [byType.top_pairs, byType.upsell_opportunities]) {
      const keys = list.map(key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("Upsell: andere Paare als die Top-Paare, nach Kaufwahrscheinlichkeit x Lift", () => {
    const top = new Set(byType.top_pairs.map(key));
    expect(byType.upsell_opportunities.some((p: any) => top.has(key(p)))).toBe(false);
    const scores = byType.upsell_opportunities.map((p: any) => p.confidence * p.lift);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(byType.top_pairs.map((p: any) => p.lift)).toEqual([...byType.top_pairs.map((p: any) => p.lift)].sort((a, b) => b - a));
  });

  it("wenige Regeln: Upsell zeigt lieber dieselben Paare als eine leere Karte", () => {
    const few = buildLearningOutputs([pair("A", "B", 3, 5, 5)], settings);
    const upsell = few.insights.find((i: any) => i.insightType === "upsell_opportunities")?.data.pairs;
    expect(upsell).toHaveLength(1);
  });

  it("Produktnamen aus den Bestellpositionen (erster Name je Artikelnummer, getrimmt)", () => {
    expect(names.get("REGAL")).toBe("META CLIP Grundregal");
    expect(names.get("BODEN")).toBe("Boden");
    const regal = [...byType.top_pairs, ...byType.upsell_opportunities].find((p: any) => key(p) === "FACHBODEN||REGAL");
    expect(regal).toMatchObject({ sourceName: expect.any(String), targetName: expect.any(String) });
  });
});
