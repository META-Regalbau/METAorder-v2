import { describe, expect, it } from "vitest";
import { buildNameRulePairs, parseCatalogName } from "../../server/cross-selling/crossSellNameRules";
import { runNameRuleCrossSelling } from "../../server/cross-selling/crossSellNameRulesRun";
import { DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS } from "../../server/cross-selling/crossSellAutomationSettings";

const N = {
  anbau: "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt",
  grund: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt",
  grundRal: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 5 Ebenen | RAL 7035",
  board: "META CLIP | Zusatz-Fachboden | 1300 x 400 mm | 230 kg | verzinkt",
  boardHeavy: "META CLIP | Zusatz-Fachboden | 1300 x 400 mm | 330 kg | verzinkt",
  boardS3: "META CLIP S3 | Zusatz-Fachboden | 1300 x 400 mm | 230 kg | verzinkt",
  back: "META CLIP | Euroloch-Rückwand | 2000 x 1300 mm | verzinkt",
  side: "META CLIP | Draht-Seitenwand | 2000 x 400 mm | verzinkt",
  doppelGrund: "META CLIP | Fachbodenregal | Doppel-Grundregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt",
  doppelAnbau: "META CLIP | Fachbodenregal | Doppel-Anbauregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt",
  msL: "META MULTISTRONG L | Fachbodenregal | Grundregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 4 Ebenen | verzinkt",
  msLM: "META MULTISTRONG L+M | Zusatz-Fachboden | 1300 x 400 mm | 230 kg | verzinkt",
};
const products = Object.entries(N).map(([k, name]) => ({ productNumber: k, name }));

describe("parseCatalogName", () => {
  it("liest Rolle, Maße, Fachlast und Oberfläche", () => {
    expect(parseCatalogName(N.anbau)).toMatchObject({ system: "META CLIP", role: "Anbauregal", dims: [2000, 1300, 400], loadKg: 230, surface: "verzinkt" });
    expect(parseCatalogName(N.board)).toMatchObject({ type: "Zusatz-Fachboden", dims: [1300, 400], loadKg: 230 });
    expect(parseCatalogName("KR H Fuß 220 DR 400 R5010")).toBeNull();
  });
});

describe("buildNameRulePairs", () => {
  const pairs = buildNameRulePairs(products);
  const targets = (src: string) => pairs.filter((p) => p.source === src).map((p) => `${p.kind}:${p.target}`);

  it("Anbauregal bekommt Grundregal zuerst, dann passendes Zubehör desselben Systems", () => {
    expect(targets("anbau")).toEqual(["partner_shelf:grund", "board:board", "back_wall:back", "side_wall:side"]);
  });
  it("andere Oberfläche, andere Fachlast und anderes System passen nicht", () => {
    expect(targets("grundRal")).toEqual([]);
    expect(targets("grund")).not.toContain("board:boardHeavy");
    expect(targets("grund")).not.toContain("board:boardS3");
  });
  it("Doppelregale: Partner und Boden, aber keine Rückwand", () => {
    expect(targets("doppelGrund")).toEqual(["partner_shelf:doppelAnbau", "board:board", "side_wall:side"]);
  });
  it("L+M-Zubehör passt zu MULTISTRONG L", () => {
    expect(targets("msL")).toContain("board:msLM");
  });
  it("Grenze je Quelle", () => {
    expect(buildNameRulePairs(products, { maxPerSource: 2 }).filter((p) => p.source === "anbau")).toHaveLength(2);
  });
});

describe("runNameRuleCrossSelling", () => {
  function world(opts: { blocked?: Array<[string, string]> } = {}) {
    const runs: any[] = [];
    const log: any[] = [];
    const pairStates: any[] = [];
    const writes: string[] = [];
    const groups = new Map<string, any[]>();
    const assignments = new Map<string, any[]>();
    const storage = {
      acquireCrossSellRun: async (args: any) => {
        const run = { id: `run${runs.length + 1}`, ...args };
        runs.push(run);
        return run as any;
      },
      finishCrossSellRun: async (id: string, result: any) => void Object.assign(runs.find((r) => r.id === id), result),
      getCrossSellPairStates: async () =>
        (opts.blocked ?? []).map(([s, t]) => ({ sourceProductNumber: s, targetProductNumber: t, status: "rejected" })) as any,
      appendCrossSellChangeLog: async (rows: any[]) => {
        log.push(...rows);
        return [];
      },
      upsertCrossSellPairStates: async (rows: any[]) => {
        pairStates.push(...rows);
        return [];
      },
    };
    const client = {
      fetchProductMetaSources: async () =>
        products.map((p) => ({ id: `id-${p.productNumber}`, productNumber: p.productNumber, name: p.name, active: true, visible: true, description: "", properties: [], metaTitle: null, metaDescription: null, customFields: null })),
      fetchProductCrossSelling: async (pid: string) => groups.get(pid) ?? [],
      fetchCrossSellingAssignments: async (gid: string) => assignments.get(gid) ?? [],
      createProductCrossSelling: async (pid: string, name: string) => {
        const id = `g-${pid}`;
        groups.set(pid, [{ id, name, type: "productList", active: true, position: 1, products: [] }]);
        return id;
      },
      syncCrossSellingAssignments: async (gid: string, ops: any) => {
        writes.push(gid);
        assignments.set(gid, ops.upsert.map((u: any) => ({ id: `as-${u.productId}`, productId: u.productId, position: u.position })));
      },
    };
    const byId = new Map(products.map((p) => [`id-${p.productNumber}`, p.productNumber]));
    const catalog = { byId: new Map(), byNumber: new Map(), canonicalNumber: (n: string) => n, canonicalNumberForId: (id: string) => byId.get(id) ?? null, numberForId: (id: string) => byId.get(id) ?? null } as any;
    const deps = { storage: storage as any, client: client as any, loadCatalog: async () => catalog, settings: DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS };
    return { deps, runs, log, pairStates, writes };
  }

  it("Testlauf schreibt nichts, protokolliert aber", async () => {
    const w = world();
    const out = await runNameRuleCrossSelling(w.deps, { tenantId: "t", trigger: "manual", dryRun: true });
    expect(w.writes).toEqual([]);
    expect(out.stats?.dryRunFlagged).toBeGreaterThan(0);
    expect(out.stats?.autoApplied).toBe(0);
    expect(w.log.every((e) => e.mode === "dry_run")).toBe(true);
    expect(w.runs[0]).toMatchObject({ kind: "name_rules", status: "completed" });
  });

  it("schreibt mit Herkunft heuristic und lässt abgelehnte Paare aus", async () => {
    const w = world({ blocked: [["anbau", "grund"]] });
    const out = await runNameRuleCrossSelling(w.deps, { tenantId: "t", trigger: "manual", dryRun: false });
    expect(out.stats?.skippedRejected).toBe(1);
    expect(w.writes.length).toBeGreaterThan(0);
    expect(w.pairStates.some((p) => p.sourceProductNumber === "anbau" && p.targetProductNumber === "grund")).toBe(false);
    expect(w.pairStates.find((p) => p.sourceProductNumber === "anbau" && p.targetProductNumber === "board")).toMatchObject({ origin: "heuristic", status: "applied" });
    expect(w.log.filter((e) => e.action === "add").every((e) => e.mode === "auto")).toBe(true);
  });
});
