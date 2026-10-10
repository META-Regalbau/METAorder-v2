/**
 * Erstbefuellung: Muster aus aehnlichen Produkten, Freigabe-Regel fuer Muster, Ablauf in Schritten.
 */
import { describe, it, expect } from "vitest";
import {
  productTypeFromName,
  productSignature,
  buildCrossSellPatterns,
  applyCrossSellPatterns,
} from "../../server/cross-selling/crossSellPatterns";
import { buildOrderBasketStats, evaluateAutoGates, pairStatsFor } from "../../server/cross-selling/crossSellScoring";
import { DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS } from "../../server/cross-selling/crossSellAutomationSettings";
import { runBackfillStep, startBackfill, getBackfillState, stopBackfill } from "../../server/cross-selling/crossSellBackfill";
import type { Order } from "../../shared/schema";

const row = (productNumber: string, name: string, system: string, w?: number, d?: number, active = true) => ({
  productNumber,
  name,
  active,
  payload: {
    properties: [
      { groupName: "Regal-System", optionName: system },
      ...(w ? [{ groupName: "Breite", optionName: `${w} mm` }] : []),
      ...(d ? [{ groupName: "Tiefe", optionName: `${d} mm` }] : []),
    ],
  },
});

describe("Produktart aus dem Namen", () => {
  it("neues Schema mit Unterart, altes Schema bis zu den Massen", () => {
    expect(productTypeFromName("META CLIP | Fachbodenregal | Grundregal | 2000 x 1300 x 600 mm | verzinkt")).toBe("fachbodenregal grundregal");
    expect(productTypeFromName("META CLIP | Zusatz-Fachboden | 1300 x 600 mm | 230 kg | verzinkt")).toBe("zusatz-fachboden");
    expect(productTypeFromName("CL T3S Rahmen 2200 300 vzk")).toBe("cl t3s rahmen");
    expect(productTypeFromName("KR H Kragarm 140/240 800 Abw R5010")).toBe("kr h kragarm");
  });
});

// Katalog: 4 Grundregale verschiedener Masse, passende Zusatzboeden (zwei Fachlasten), ein Sicherungsstift
const catalogRows = [
  row("R1", "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 150 kg | verzinkt", "CLIP", 1000, 400),
  row("R2", "META CLIP | Fachbodenregal | Grundregal | 2000 x 1300 x 600 mm | Fachlast 230 kg | verzinkt", "CLIP", 1300, 600),
  row("R3", "META CLIP | Fachbodenregal | Grundregal | 2500 x 1000 x 500 mm | Fachlast 150 kg | verzinkt", "CLIP", 1000, 500),
  row("R4", "META CLIP | Fachbodenregal | Grundregal | 3000 x 1300 x 400 mm | Fachlast 230 kg | verzinkt", "CLIP", 1300, 400),
  row("RNEU", "META CLIP | Fachbodenregal | Grundregal | 2000 x 1300 x 600 mm | Fachlast 230 kg | RAL 7035", "CLIP", 1300, 600),
  row("B1", "META CLIP | Zusatz-Fachboden | 1000 x 400 mm | 150 kg | verzinkt", "CLIP", 1000, 400),
  row("B2", "META CLIP | Zusatz-Fachboden | 1300 x 600 mm | 230 kg | verzinkt", "CLIP", 1300, 600),
  row("B2G", "META CLIP | Zusatz-Fachboden | 1300 x 600 mm | 230 kg | RAL 7035", "CLIP", 1300, 600),
  row("B3", "META CLIP | Zusatz-Fachboden | 1000 x 500 mm | 150 kg | verzinkt", "CLIP", 1000, 500),
  row("B4", "META CLIP | Zusatz-Fachboden | 1300 x 400 mm | 230 kg | verzinkt", "CLIP", 1300, 400),
  row("S1", "CL Sicherungsstift vzk", "CLIP"),
  row("ALT", "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | verzinkt", "CLIP", 1000, 400, false),
];
const signatures = new Map(catalogRows.map((r) => [r.productNumber, productSignature(r)]));

function order(nr: number, items: string[]): Order {
  return { orderNumber: `MO${nr}`, customerNumber: `k${nr}`, orderDate: "2026-06-01T00:00:00Z", status: "completed", paymentStatus: "paid", items: items.map((productNumber) => ({ productNumber })) } as unknown as Order;
}

// Belegt: R1+B1, R2+B2, R3+B3 je zweimal; R1/R2/R3 auch mit S1
const orders: Order[] = [];
let n = 0;
for (const [r, b] of [["R1", "B1"], ["R2", "B2"], ["R3", "B3"]]) {
  orders.push(order(++n, [r, b, "S1"]), order(++n, [r, b, "S1"]));
}
const basket = buildOrderBasketStats(orders, (pn) => pn, new Date("2025-01-01"));

describe("Muster", () => {
  const patterns = buildCrossSellPatterns(basket, signatures);

  it("Regal -> Boden gleicher Breite und Tiefe aus 3 verschiedenen Regalen belegt", () => {
    const p = patterns.get("CLIP|fachbodenregal grundregal>CLIP|zusatz-fachboden|w1d1");
    expect(p?.sources.size).toBe(3);
  });

  it("uebertraegt auf Regale ohne Bestellungen: passende Masse und passende Oberflaeche", () => {
    const cands = applyCrossSellPatterns(patterns, signatures, { minSources: 3 });
    const forR4 = cands.filter((c) => c.source === "R4").map((c) => c.target).sort();
    expect(forR4).toEqual(["B4", "S1"]);
    const forNew = cands.filter((c) => c.source === "RNEU").map((c) => c.target).sort();
    expect(forNew).toEqual(["B2G", "S1"]);
    expect(cands.some((c) => c.source === "ALT")).toBe(false);
  });

  it("zu schwach belegte Muster werden nicht uebertragen", () => {
    expect(applyCrossSellPatterns(patterns, signatures, { minSources: 4 })).toEqual([]);
  });
});

describe("Freigabe-Regel fuer Muster", () => {
  const S = DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS;
  const base = {
    stats: pairStatsFor(basket, "R4", "B4"),
    signal: null,
    targetEligible: true,
    blocked: false,
    alreadyInShop: false,
    sameFamily: false,
  };
  it("ohne eigene Bestellungen: Muster mit 3 Belegen und KI >= 0,9 reicht", () => {
    expect(evaluateAutoGates({ ...base, pattern: { sources: 3 }, llm: { verdict: "fit", relation: "component", confidence: 0.92, current: true } }, S)).toEqual([]);
  });
  it("KI 0,85 reicht bei Mustern nicht, 2 Belege auch nicht", () => {
    expect(evaluateAutoGates({ ...base, pattern: { sources: 3 }, llm: { verdict: "fit", relation: "component", confidence: 0.85, current: true } }, S)).toContain("llm_confidence");
    expect(evaluateAutoGates({ ...base, pattern: { sources: 2 }, llm: { verdict: "fit", relation: "component", confidence: 0.95, current: true } }, S)).toContain("pattern_sources");
  });
});

describe("Ablauf der Erstbefuellung", () => {
  function store(settings: Record<string, unknown> = {}) {
    const data = new Map<string, any>();
    data.set("cross_sell_automation_settings", { mode: "auto_dry_run", backfillLlmBudget: 100, ...settings });
    return {
      data,
      getSetting: async (k: string) => data.get(k) ?? null,
      saveSetting: async (k: string, v: any) => (data.set(k, v), v),
    };
  }

  it("laeuft nur nach Start; endet, wenn alles geprueft ist", async () => {
    const st = store();
    const deps: any = { storage: st };
    expect((await runBackfillStep(deps, { tenantId: "t", trigger: "scheduled" })).skipped).toBe("not_running");
    await startBackfill(st, "t", "u");
    const calls: any[] = [];
    const runner: any = async (_d: any, a: any) => {
      calls.push(a);
      return { runId: "r", stats: { llmCalls: 40, autoApplied: 0, dryRunFlagged: 5, queued: 3, remainingUnchecked: 0, llmNotConfigured: false } };
    };
    const r = await runBackfillStep(deps, { tenantId: "t", trigger: "scheduled" }, runner);
    expect(calls[0]).toMatchObject({ kind: "backfill", backfillLlmUsed: 0 });
    expect(r.state).toMatchObject({ status: "done", llmUsed: 40, dryRunFlagged: 5, runs: 1 });
  });

  it("laeuft weiter, solange ungepruefte Kandidaten und Budget da sind", async () => {
    const st = store();
    await startBackfill(st, "t", "u");
    const runner: any = async () => ({ runId: "r", stats: { llmCalls: 60, autoApplied: 7, dryRunFlagged: 0, queued: 1, remainingUnchecked: 500, llmNotConfigured: false } });
    const first = await runBackfillStep({ storage: st } as any, { tenantId: "t", trigger: "scheduled" }, runner);
    expect(first.state).toMatchObject({ status: "running", llmUsed: 60, autoApplied: 7 });
    const second = await runBackfillStep({ storage: st } as any, { tenantId: "t", trigger: "scheduled" }, runner);
    expect(second.state).toMatchObject({ status: "done", llmUsed: 120 }); // Budget 100 aufgebraucht
  });

  it("Anhalten setzt den Zustand", async () => {
    const st = store();
    await startBackfill(st, "t", "u");
    expect((await stopBackfill(st, "t")).status).toBe("stopped");
    expect((await getBackfillState(st, "t")).status).toBe("stopped");
  });
});

import { parseFitResponse } from "../../server/cross-selling/crossSellLlmFit";

describe("KI-Antwort tolerant einlesen", () => {
  it("normalisiert Ausreisser statt die Antwort zu verwerfen", () => {
    const items = parseFitResponse({
      results: [
        { productNumber: "A", verdict: "fit", relation: "accessory", confidence: 0.9, reason: "ok" },
        { productNumber: 12345, verdict: "No-Fit", relation: "spare_part", confidence: "85", reason: "x".repeat(500) },
        { productNumber: "C", verdict: "vielleicht", relation: "Zubehör", confidence: 2 },
        { foo: "kaputt" },
      ],
    });
    expect(items).toEqual([
      { productNumber: "A", verdict: "fit", relation: "accessory", confidence: 0.9, reason: "ok" },
      { productNumber: "12345", verdict: "no_fit", relation: "component", confidence: 0.85, reason: "x".repeat(200) },
      { productNumber: "C", verdict: "unsure", relation: "accessory", confidence: 0.02, reason: "" },
    ]);
  });

  it("auch eine nackte Liste; ohne Liste null", () => {
    expect(parseFitResponse([{ productNumber: "A", verdict: "fit", relation: "component", confidence: 0.7 }])).toHaveLength(1);
    expect(parseFitResponse({ foo: 1 })).toBeNull();
  });
});

import { extractFitJson } from "../../server/cross-selling/crossSellLlmFit";

describe("JSON aus der KI-Antwort holen", () => {
  const ok = '{"productNumber":"A","verdict":"fit","relation":"component","confidence":0.9,"reason":"x"}';
  it("Text vor und nach dem JSON", () => {
    expect((extractFitJson(`Hier das Ergebnis:\n{"results":[${ok}]}\nHinweis: ...`) as any).results).toHaveLength(1);
  });
  it("abgeschnittene Antwort: vollstaendige Eintraege retten", () => {
    expect((extractFitJson(`{"results":[${ok},${ok.replace('"A"', '"B"')},{"productNumber":"C","verdict":"fi`) as any).results).toHaveLength(2);
  });
});

import { nameTokens } from "../../server/cross-selling/crossSellPatterns";

describe("Oberflaechen vereinheitlichen", () => {
  it("vzk = verzinkt, R7035 = RAL 7035", () => {
    expect(nameTokens("CL Abdeckkappe ER R7035").has("7035")).toBe(true);
    expect(nameTokens("META CLIP | Zusatz-Fachboden | RAL 7035").has("7035")).toBe(true);
    expect(nameTokens("CL Fußplatte ER vzk").has("verzinkt")).toBe(true);
  });
});
