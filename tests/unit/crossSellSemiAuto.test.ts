/**
 * Cross-Selling-Teilautomatik: Bewertung, Freigabe-Bedingungen, Kandidatenlauf je Modus,
 * Pruefliste (freigeben) und Rueckgaengig.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  wilsonLowerBound,
  buildOrderBasketStats,
  pairStatsFor,
  evaluateAutoGates,
  scorePair,
  selectWithinCaps,
  orderCustomerKey,
} from "../../server/cross-selling/crossSellScoring";
import { DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS } from "../../server/cross-selling/crossSellAutomationSettings";
import { runCrossSellCandidates, berlinDateKey, isTargetEligible } from "../../server/cross-selling/crossSellCandidates";
import { approveCrossSellPairs, undoCrossSellChanges } from "../../server/cross-selling/crossSellReview";
import { buildCrossSellCatalog, clearCrossSellCatalogCache } from "../../server/cross-selling/crossSellCatalog";
import type { CrossSellPairState, Order } from "../../shared/schema";

const S = DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS;
const NOW = new Date("2026-10-09T10:00:00Z");

describe("Statistik", () => {
  it("Wilson-Untergrenze: 5 von 20 reicht, 5 von 50 nicht (Grenze 0,10)", () => {
    expect(wilsonLowerBound(5, 20)).toBeGreaterThan(0.1);
    expect(wilsonLowerBound(5, 50)).toBeLessThan(0.1);
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("Kunde: Kundennummer, sonst E-Mail; Sammelkunde zaehlt einmal", () => {
    expect(orderCustomerKey({ customerNumber: "99910000001", customerEmail: "a@b", orderNumber: "1" })).toBe("c:99910000001");
    expect(orderCustomerKey({ customerNumber: "", customerEmail: " A@B ", orderNumber: "1" })).toBe("m:a@b");
  });

  it("Varianten zaehlen zur Familie, Stornos und alte Bestellungen nicht", () => {
    const orders = [
      order("1", "k1", ["R-1", "B"]),
      order("2", "k2", ["R-2", "B"]),
      { ...order("3", "k3", ["R-1", "B"]), status: "cancelled" },
      { ...order("4", "k4", ["R-1", "B"]), orderDate: "2020-01-01T00:00:00Z" },
    ] as Order[];
    const basket = buildOrderBasketStats(orders, (pn) => (pn.startsWith("R-") ? "R" : pn), new Date("2025-01-01"));
    const st = pairStatsFor(basket, "R", "B");
    expect(st).toMatchObject({ pairOrders: 2, distinctCustomers: 2, sourceOrders: 2, totalOrders: 2 });
  });
});

function order(nr: string, customer: string, items: string[], date = "2026-06-01T00:00:00Z"): Order {
  return {
    orderNumber: nr,
    customerNumber: customer,
    customerEmail: `${customer}@x`,
    orderDate: date,
    status: "completed",
    paymentStatus: "paid",
    items: items.map((productNumber) => ({ productNumber })),
  } as unknown as Order;
}

/**
 * 100 Bestellungen: R in 20; B in 7 (6 mit R, 4 Kunden) -> sicher;
 * X (Allerweltsartikel) in 60, davon 10 mit R -> Lift zu klein;
 * H 5-mal mit R, alles ein Haendler -> zu wenige Kunden.
 */
function scenarioOrders(): Order[] {
  const orders: Order[] = [];
  let n = 0;
  const add = (customer: string, items: string[]) => orders.push(order(String(++n), customer, items));
  for (let i = 0; i < 6; i++) add(`k${i % 4}`, ["R", "B"]);
  add("k9", ["B"]);
  for (let i = 0; i < 5; i++) add("haendler", ["R", "H", ...(i < 4 ? ["X"] : [])]);
  for (let i = 0; i < 9; i++) add(`r${i}`, ["R", ...(i < 6 ? ["X"] : [])]);
  while (orders.length < 100) add(`z${orders.length}`, orders.length % 2 === 0 ? ["X"] : ["Z"]);
  return orders;
}

describe("Freigabe-Bedingungen", () => {
  const basket = buildOrderBasketStats(scenarioOrders(), (pn) => pn, new Date("2025-01-01"));
  const fit = { verdict: "fit" as const, relation: "accessory", confidence: 0.9, current: true };
  const base = { llm: fit, signal: null, targetEligible: true, blocked: false, alreadyInShop: false, sameFamily: false };

  it("sicheres Paar besteht alle Bedingungen", () => {
    expect(evaluateAutoGates({ ...base, stats: pairStatsFor(basket, "R", "B") }, S)).toEqual([]);
  });

  it("Allerweltsartikel scheitert am Lift", () => {
    expect(evaluateAutoGates({ ...base, stats: pairStatsFor(basket, "R", "X") }, S)).toContain("lift");
  });

  it("ein einzelner Haendler reicht nicht", () => {
    expect(evaluateAutoGates({ ...base, stats: pairStatsFor(basket, "R", "H") }, S)).toContain("min_customers");
  });

  it("ohne aktuelles KI-Urteil oder als Alternative nie automatisch", () => {
    const stats = pairStatsFor(basket, "R", "B");
    expect(evaluateAutoGates({ ...base, stats, llm: null }, S)).toContain("llm_missing");
    expect(evaluateAutoGates({ ...base, stats, llm: { ...fit, current: false } }, S)).toContain("llm_missing");
    expect(evaluateAutoGates({ ...base, stats, llm: { ...fit, relation: "alternative" } }, S)).toContain("llm_relation");
    expect(evaluateAutoGates({ ...base, stats, llm: { ...fit, confidence: 0.6 } }, S)).toContain("llm_confidence");
  });

  it("schlechte Reaktionen und nicht sichtbare Ziele verhindern das Setzen", () => {
    const stats = pairStatsFor(basket, "R", "B");
    expect(evaluateAutoGates({ ...base, stats, signal: { impressions: 200, clicks: 0, adds: 0 } }, S)).toContain("negative_signal");
    expect(evaluateAutoGates({ ...base, stats, targetEligible: false }, S)).toContain("target_not_eligible");
  });

  it("Gesamtwert: ohne KI-Urteil wird hochgerechnet, 'passt nicht' senkt", () => {
    const stats = pairStatsFor(basket, "R", "B");
    const without = scorePair({ stats, llm: null, signal: null, feedback: null });
    const noFit = scorePair({ stats, llm: { verdict: "no_fit", relation: "unrelated", confidence: 0.9 }, signal: null, feedback: null });
    expect(without.components.llm).toBeNull();
    expect(noFit.score).toBeLessThan(without.score);
  });

  it("Obergrenzen je Lauf und je Quelle", () => {
    const items = [
      { source: "A", score: 0.9 },
      { source: "A", score: 0.8 },
      { source: "A", score: 0.7 },
      { source: "B", score: 0.6 },
    ];
    expect(selectWithinCaps(items, { perRun: 3, perSource: 2 }).map((i) => i.score)).toEqual([0.9, 0.8, 0.6]);
  });
});

describe("Sichtbarkeit", () => {
  const info = (active: boolean, channels: string[]) => ({ id: "", productNumber: "", name: "", active, categories: [], properties: [], visibleChannels: new Set(channels) });
  it("Ziel muss aktiv und in einem Kanal der Quelle sichtbar sein", () => {
    expect(isTargetEligible(info(true, ["a"]), info(true, ["a", "b"]))).toBe(true);
    expect(isTargetEligible(info(true, ["a"]), info(true, ["b"]))).toBe(false);
    expect(isTargetEligible(info(true, ["a"]), info(false, ["a"]))).toBe(false);
  });
});

// ---- Kandidatenlauf mit simuliertem Speicher, Shop und KI ----

const products = ["R", "B", "X", "H", "Z"].map((pn) => ({ id: `id-${pn}`, productNumber: pn, parentId: null, name: `Artikel ${pn}`, active: true }));

function fakeWorld(mode: string, opts: { existing?: Partial<CrossSellPairState>[]; llmBudget?: number } = {}) {
  const pairStates = new Map<string, any>();
  for (const e of opts.existing ?? []) pairStates.set(`${e.sourceProductNumber}|${e.targetProductNumber}`, { id: `p-${e.sourceProductNumber}-${e.targetProductNumber}`, ...e });
  const runs: any[] = [];
  const changeLog: any[] = [];
  const shop = { groups: new Map<string, any[]>(), assignments: new Map<string, any[]>() };
  const writes: string[] = [];
  let fitCalls = 0;
  const storage: any = {
    getSetting: async (key: string) =>
      key === "cross_sell_automation_settings" ? { mode, ...(opts.llmBudget !== undefined ? { llmMaxCallsPerRun: opts.llmBudget } : {}) } : null,
    saveSetting: async () => undefined,
    getShopwareProductIdentities: async () => products,
    getCrossSellPairStates: async () => Array.from(pairStates.values()),
    getCrossSellPairState: async (id: string) => Array.from(pairStates.values()).find((p) => p.id === id),
    updateCrossSellPairState: async (id: string, patch: any) => {
      const p = Array.from(pairStates.values()).find((x) => x.id === id);
      Object.assign(p, patch);
      return p;
    },
    upsertCrossSellPairStates: async (rows: any[], cols: string[]) => {
      for (const r of rows) {
        const key = `${r.sourceProductNumber}|${r.targetProductNumber}`;
        const prev = pairStates.get(key);
        if (!prev) pairStates.set(key, { id: `p-${r.sourceProductNumber}-${r.targetProductNumber}`, ...r });
        else for (const c of cols) prev[c] = r[c];
      }
      return [];
    },
    acquireCrossSellRun: async (args: any) => {
      if (runs.some((r) => r.periodKey === args.periodKey && r.kind === args.kind)) return null;
      const run = { id: `run${runs.length + 1}`, startedAt: NOW, ...args };
      runs.push(run);
      return run;
    },
    finishCrossSellRun: async (id: string, result: any) => Object.assign(runs.find((r) => r.id === id), result),
    getCrossSellRuns: async () => runs,
    getAllCrossSellingRules: async () => [],
    heartbeatCrossSellRun: async () => undefined,
    getShopwareProductMirrors: async () => ({
      rows: products.map((p) => ({ shopwareId: p.id, productNumber: p.productNumber, name: p.name, active: true, payload: { salesChannelVisibilities: [{ salesChannelId: "de", visibility: 30 }] } })),
      total: products.length,
    }),
    getShopwareProductMirrorsByNumbers: async (nums: string[]) =>
      nums.map((pn) => ({ shopwareId: `id-${pn}`, productNumber: pn, name: `Artikel ${pn}`, active: true, payload: { salesChannelVisibilities: [{ salesChannelId: "de", visibility: 30 }] } })),
    getCrossSellEventStats: async () => [],
    markCrossSellChangeUndone: async () => undefined,
    appendCrossSellChangeLog: async (rows: any[]) => {
      changeLog.push(...rows);
      return rows.map((_, i) => changeLog.length - rows.length + i + 1);
    },
  };
  const client = {
    fetchProductCrossSelling: async (pid: string) => shop.groups.get(pid) ?? [],
    fetchCrossSellingAssignments: async (gid: string) => shop.assignments.get(gid) ?? [],
    createProductCrossSelling: async (pid: string, name: string) => {
      writes.push(`create:${pid}`);
      const id = `g-${pid}`;
      shop.groups.set(pid, [{ id, name, type: "productList", active: true, position: 1, products: [] }]);
      return id;
    },
    syncCrossSellingAssignments: async (gid: string, ops: any) => {
      writes.push(`sync:${gid}:+${ops.upsert.map((u: any) => u.productId).join(",")}:-${ops.deleteIds.join(",")}`);
      const list = (shop.assignments.get(gid) ?? []).filter((a) => !ops.deleteIds.includes(a.id));
      for (const u of ops.upsert) list.push({ id: `as-${u.productId}`, productId: u.productId, position: u.position });
      shop.assignments.set(gid, list);
    },
  };
  const checkFit = async (p: any) => {
    fitCalls += 1;
    return {
      ok: true as const,
      model: "test-model",
      results: new Map(p.targets.map((t: any) => [t.productNumber, { verdict: "fit" as const, relation: "accessory" as const, confidence: 0.9, reason: "passt" }])),
    };
  };
  const deps = { storage, client, loadOrders: async () => scenarioOrders(), getSetting: storage.getSetting, now: () => NOW, checkFit };
  return { deps, pairStates, runs, changeLog, writes, fitCalls: () => fitCalls, shop };
}

describe("Kandidatenlauf", () => {
  beforeEach(() => clearCrossSellCatalogCache());

  it("Modus aus: geplanter Lauf tut nichts (kein Schreiben, keine KI)", async () => {
    const w = fakeWorld("off");
    const r = await runCrossSellCandidates(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    expect(r.skipped).toBe("mode_off");
    expect(w.writes).toEqual([]);
    expect(w.fitCalls()).toBe(0);
    expect(w.runs).toEqual([]);
  });

  it("Pruefliste: sichere und unsichere Paare stehen zur Freigabe, nichts im Shop", async () => {
    const w = fakeWorld("review");
    const r = await runCrossSellCandidates(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    expect(w.writes).toEqual([]);
    const rb = w.pairStates.get("R|B");
    expect(rb).toMatchObject({ status: "suggested", pendingAction: "add", llmVerdict: "fit", autoEligible: false });
    expect(rb.stats.gateFailures).toEqual([]);
    expect(w.pairStates.get("R|H").stats.gateFailures).toContain("min_customers");
    expect(r.stats?.autoEligible).toBeGreaterThan(0);
    expect(r.stats?.autoApplied).toBe(0);
    expect(w.runs[0].periodKey).toBe(berlinDateKey(NOW));
  });

  it("zweiter geplanter Lauf am selben Tag wird uebersprungen", async () => {
    const w = fakeWorld("review");
    await runCrossSellCandidates(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    const again = await runCrossSellCandidates(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    expect(again.skipped).toBe("already_ran");
  });

  it("Testlauf: markiert, protokolliert dry_run, schreibt nichts", async () => {
    const w = fakeWorld("auto_dry_run");
    const r = await runCrossSellCandidates(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    expect(w.writes).toEqual([]);
    expect(r.stats?.dryRunFlagged).toBeGreaterThan(0);
    expect(w.changeLog.every((l) => l.mode === "dry_run")).toBe(true);
    expect(w.pairStates.get("R|B")).toMatchObject({ pendingAction: "add", autoEligible: true });
  });

  it("Automatik: setzt nur sichere Ergaenzungen, entfernt nie, merkt Ausgangswert", async () => {
    const w = fakeWorld("auto");
    const r = await runCrossSellCandidates(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    expect(r.stats?.autoApplied).toBeGreaterThan(0);
    expect(w.writes.some((x) => x.includes("id-B"))).toBe(true);
    expect(w.writes.every((x) => !x.startsWith("sync:") || x.endsWith(":-"))).toBe(true);
    expect(w.writes.some((x) => x.includes("id-H"))).toBe(false);
    expect(w.pairStates.get("R|B")).toMatchObject({ status: "applied", decisionSource: "auto" });
    expect(w.pairStates.get("R|B").baseline).toBeTruthy();
  });

  it("abgelehnte und schon gesetzte Paare werden nicht wieder vorgeschlagen", async () => {
    const w = fakeWorld("auto", {
      existing: [
        { sourceProductNumber: "R", targetProductNumber: "B", status: "rejected", decisionSource: "user" },
        { sourceProductNumber: "B", targetProductNumber: "R", status: "applied", decisionSource: "import" },
      ],
    });
    await runCrossSellCandidates(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    expect(w.pairStates.get("R|B").status).toBe("rejected");
    expect(w.pairStates.get("B|R").status).toBe("applied");
    expect(w.writes.some((x) => x.includes("id-B"))).toBe(false);
  });

  it("KI-Budget 0: keine KI-Aufrufe, daher nichts automatisch", async () => {
    const w = fakeWorld("auto", { llmBudget: 0 });
    const r = await runCrossSellCandidates(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    expect(w.fitCalls()).toBe(0);
    expect(r.stats?.llmSkippedBudget).toBeGreaterThan(0);
    expect(r.stats?.autoApplied).toBe(0);
    expect(w.writes).toEqual([]);
  });
});

describe("Pruefliste und Rueckgaengig", () => {
  const catalog = buildCrossSellCatalog(products);
  const settings = { ...S, mode: "review" as const };

  it("Freigabe schreibt in die verwaltete Liste und raeumt die Pruefliste", async () => {
    const w = fakeWorld("review");
    const pair = { id: "p1", sourceProductNumber: "R", targetProductNumber: "B", pendingAction: "add", status: "suggested", stats: { pairOrders: 6 } } as any;
    w.pairStates.set("R|B", pair);
    const out = await approveCrossSellPairs({ storage: w.deps.storage, client: w.deps.client as any, catalog, settings }, [pair], { tenantId: "t", userId: "u" });
    expect(out.approved).toEqual(["p1"]);
    expect(w.writes).toEqual(["create:id-R", "sync:g-id-R:+id-B:-"]);
    expect(pair.pendingAction).toBeNull();
    expect(pair.baseline).toBeTruthy();
  });

  it("Rueckgaengig nimmt das Produkt heraus und merkt die Ablehnung", async () => {
    const w = fakeWorld("review");
    w.shop.assignments.set("g1", [{ id: "as-B", productId: "id-B", position: 1 }]);
    const entry = { id: 7, action: "add", mode: "auto", success: true, crossSellingId: "g1", targetProductId: "id-B", sourceProductId: "id-R", runId: "run1" } as any;
    const out = await undoCrossSellChanges({ storage: w.deps.storage, client: w.deps.client as any, catalog }, [entry], { tenantId: "t", userId: "u" });
    expect(out.undone).toEqual([7]);
    expect(w.writes).toEqual(["sync:g1:+:-as-B"]);
    expect(w.pairStates.get("R|B")).toMatchObject({ status: "rejected", decisionReasonCode: "undo" });
    expect(w.changeLog[0]).toMatchObject({ action: "remove", mode: "undo", undoOfId: 7 });
  });

  it("Testlauf-Eintraege und Doppel-Rueckgaengig werden uebersprungen", async () => {
    const w = fakeWorld("review");
    const out = await undoCrossSellChanges(
      { storage: w.deps.storage, client: w.deps.client as any, catalog },
      [
        { id: 1, action: "add", mode: "dry_run", success: true, crossSellingId: "g", targetProductId: "id-B" } as any,
        { id: 2, action: "add", mode: "auto", success: true, crossSellingId: "g", targetProductId: "id-B", undoneById: 9 } as any,
      ],
      { tenantId: "t", userId: "u" },
    );
    expect(out.skipped.map((s) => s.reason)).toEqual(["not_undoable", "already_undone"]);
    expect(w.writes).toEqual([]);
  });
});
