import { describe, expect, it } from "vitest";
import { buildNameRulePairs, isNameRulePair, parseCatalogName } from "../../server/cross-selling/crossSellNameRules";
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
    expect(pairs.find((p) => p.source === "anbau" && p.target === "grund")?.tab).toBe("extend");
    expect(pairs.find((p) => p.source === "anbau" && p.target === "board")?.tab).toBe("accessories");
  });
  it("andere Oberfläche, andere Fachlast und anderes System passen nicht", () => {
    // nur als andere Ausführung im Tab "Auch erhältlich in"
    expect(targets("grundRal")).toEqual(["other_surface:grund"]);
    expect(targets("grund")).not.toContain("board:boardHeavy");
    expect(targets("grund")).not.toContain("board:boardS3");
  });
  it("Doppelregale: Partner und Boden, aber keine Rückwand", () => {
    expect(targets("doppelGrund")).toEqual(["partner_shelf:doppelAnbau", "board:board", "side_wall:side"]);
  });
  it("L+M-Zubehör passt zu MULTISTRONG L", () => {
    expect(targets("msL")).toContain("board:msLM");
  });
  it("Grenze je Quelle und Tab", () => {
    const limited = buildNameRulePairs(products, { maxPerTab: { accessories: 1 } }).filter((p) => p.source === "anbau");
    expect(limited.map((p) => `${p.tab}:${p.target}`)).toEqual(["extend:grund", "accessories:board"]);
  });
});

describe("isNameRulePair", () => {
  it("erkennt Regel-Paare an den Namen (Richtung zählt)", () => {
    expect(isNameRulePair(N.anbau, N.grund)).toBe(true);
    expect(isNameRulePair(N.anbau, N.board)).toBe(true);
    expect(isNameRulePair(N.board, N.anbau)).toBe(false);
    expect(isNameRulePair(N.grundRal, N.board)).toBe(false);
    expect(isNameRulePair(null, N.grund)).toBe(false);
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
      createProductCrossSelling: async (pid: string, name: string, _type?: string, position = 1) => {
        const id = `g-${pid}-${name}`;
        groups.set(pid, [...(groups.get(pid) ?? []), { id, name, type: "productList", active: true, position, products: [] }]);
        return id;
      },
      syncCrossSellingAssignments: async (gid: string, ops: any) => {
        writes.push(gid);
        const kept = (assignments.get(gid) ?? []).filter((a) => !ops.deleteIds.includes(a.id));
        assignments.set(gid, [...kept, ...ops.upsert.map((u: any) => ({ id: `as-${u.productId}`, productId: u.productId, position: u.position }))]);
      },
    };
    const byId = new Map(products.map((p) => [`id-${p.productNumber}`, p.productNumber]));
    const catalog = { byId: new Map(), byNumber: new Map(), canonicalNumber: (n: string) => n, canonicalNumberForId: (id: string) => byId.get(id) ?? null, numberForId: (id: string) => byId.get(id) ?? null } as any;
    const deps = { storage: storage as any, client: client as any, loadCatalog: async () => catalog, settings: DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS };
    return { deps, runs, log, pairStates, writes, groups, assignments };
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

describe("Anreicherung: andere Breiten, Einzelteile, Zubehör mit Maß", () => {
  const E = {
    grund: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 150 kg | 5 Ebenen | verzinkt",
    anbau1000: "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1000 x 400 mm | Fachlast 150 kg | 5 Ebenen | verzinkt",
    anbau1300: "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt",
    anbau750: "META CLIP | Fachbodenregal | Anbauregal | 2000 x 750 x 400 mm | Fachlast 150 kg | 5 Ebenen | verzinkt",
    anbauTief: "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1300 x 600 mm | Fachlast 230 kg | 5 Ebenen | verzinkt",
    anbauRal: "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 5 Ebenen | RAL 7035",
    rahmen: "META CLIP | Ständerrahmen T1N | 2000 x 400 mm | verzinkt",
    rahmenRal: "META CLIP | Ständerrahmen Vollwand | 2000 x 400 mm | RAL 7035",
    rahmenHoch: "META CLIP | Ständerrahmen T1N | 2500 x 400 mm | verzinkt",
    ms150: "META CLIP | Fachboden MS150 | 1000 x 400 mm | verzinkt",
    ms230: "META CLIP | Fachboden MS230 | 1000 x 400 mm | verzinkt",
    diag: "META CLIP | Diagonalstab | für Regalbreite 1000 mm | verzinkt",
    teiler: "META CLIP | Fachteiler durchgehend | 300 x 400 mm | verzinkt | 10 Stück",
    pal: "META MULTIPAL | Palettenregal | Grundregal | 4400 x 2700 x 1100 mm | Fachlast 470 kg | 3 Ebenen | 9 Paletten | verzinkt",
    holm: "META MULTIPAL | Holmebene 2700 mm | HN100/20 | RAL 2001",
    holmKurz: "META MULTIPAL | Holmebene 1825 mm | HN100/20 | RAL 2001",
    gitter: "META MULTIPAL | Gitterrostboden eingelegt | 2700 x 1100 mm | 1000 kg/m² | feuerverzinkt",
    durchschub: "META MULTIPAL | Durchschubsicherung light | 2700 mm | LA 100 mm | verzinkt",
    tiefe: "META MULTIPAL | Tiefenauflage leicht | 1100 mm | verzinkt",
    palRahmen: "META MULTIPAL | Ständerrahmen | 4400 x 1100 mm | 100/20 | verzinkt",
    kabel: "META MULTIPAL | Kabeltrommelregal | Grundregal | 4400 x 2700 x 1100 mm | Feldlast 4000 kg | 2 Ebenen | Typ 1 | verzinkt",
    krag: "META MULTISTRONG M | Kragarmregal | Grundregal | 2500 x 1000 x 800 mm | Armlast 250 kg | doppelseitig | 4+1 Ebenen",
    staender: "META MULTISTRONG M | Ständer | doppelseitig | 2500 x 800 mm | RAL 5010",
    staenderEin: "META MULTISTRONG M | Ständer | einseitig | 2500 x 800 mm | RAL 5010",
    arm: "META MULTISTRONG M | Kragarm | 70/30 | 800 mm | RAL 5010",
    armL: "META MULTISTRONG L | Kragarm | 40/30 | 800 mm | RAL 5010",
    sockel: "META MULTISTRONG L+M | Sockelboden | 1000 x 800 mm | verzinkt",
    spann: "META CLIP | Spannschloss | für CLIP Diagonalstab | verzinkt",
    klammer: "META CLIP | Profilklammer für Doppelregal | verzinkt",
  };
  const prods = Object.entries(E).map(([k, name]) => ({ productNumber: k, name }));
  const pairs = buildNameRulePairs(prods, {
    maxPerTab: { extend: 12, accessories: 20, parts: 30 },
    systemAccessories: { "META CLIP": ["spann", "klammer"] },
  });
  const tab = (src: string, t: string) => pairs.filter((p) => p.source === src && p.tab === t).map((p) => p.target);

  it("Regal erweitern: Partner, dann Anbauregale anderer Breite (gleiche Fachlast zuerst); Tiefe und Oberfläche müssen passen", () => {
    expect(tab("grund", "extend")).toEqual(["anbau1000", "anbau750", "anbau1300"]);
  });
  it("Einzelteile: Ständerrahmen in Höhe x Tiefe (gleiche Oberfläche zuerst) und alle Fachböden der Größe", () => {
    expect(tab("grund", "parts")).toEqual(["rahmen", "rahmenRal", "ms150", "ms230"]);
  });
  it("Das passt dazu: Standardzubehör und Zubehör mit Maß; Doppelregal-Teile nicht am Einfachregal", () => {
    expect(tab("grund", "accessories")).toEqual(["spann", "diag", "teiler"]);
  });
  it("Palettenregal: Holmebene der Feldbreite, Gitterrost, Ständerrahmen, Durchschubsicherung, Tiefenauflage", () => {
    expect(tab("pal", "parts")).toEqual(["palRahmen", "holm", "gitter"]);
    expect(tab("pal", "accessories")).toEqual(["durchschub", "tiefe"]);
  });
  it("Kabeltrommelregal bekommt kein Palettenregal-Zubehör", () => {
    expect(tab("kabel", "accessories")).toEqual([]);
  });
  it("Kragarmregal: Ständer gleicher Seitigkeit, Kragarm gleicher Länge im System, Sockelboden", () => {
    expect(tab("krag", "parts")).toEqual(["staender", "arm"]);
    expect(tab("krag", "accessories")).toEqual(["sockel"]);
  });
});

describe("Mehrere Tabs im Lauf", () => {
  it("verschiebt das Partnerregal aus 'Das passt dazu' nach 'Regal erweitern'", async () => {
    const runs: any[] = [];
    const groups = new Map<string, any[]>([["id-anbau", [{ id: "g-old", name: "Das passt dazu", type: "productList", active: true, position: 1, products: [] }]]]);
    const assignments = new Map<string, any[]>([["g-old", [{ id: "as-grund", productId: "id-grund", position: 1 }]]]);
    const deleted: string[] = [];
    const created: string[] = [];
    const client = {
      fetchProductMetaSources: async () =>
        products.map((p) => ({ id: `id-${p.productNumber}`, productNumber: p.productNumber, name: p.name, active: true, visible: true, description: "", properties: [], metaTitle: null, metaDescription: null, customFields: null })),
      fetchProductCrossSelling: async (pid: string) => groups.get(pid) ?? [],
      fetchCrossSellingAssignments: async (gid: string) => assignments.get(gid) ?? [],
      createProductCrossSelling: async (pid: string, name: string, _t?: string, position = 1) => {
        const id = `g-${pid}-${name}`;
        created.push(`${pid}:${name}:${position}`);
        groups.set(pid, [...(groups.get(pid) ?? []), { id, name, type: "productList", active: true, position, products: [] }]);
        return id;
      },
      syncCrossSellingAssignments: async (gid: string, ops: any) => {
        deleted.push(...ops.deleteIds.map((d: string) => `${gid}:${d}`));
        const kept = (assignments.get(gid) ?? []).filter((a) => !ops.deleteIds.includes(a.id));
        assignments.set(gid, [...kept, ...ops.upsert.map((u: any) => ({ id: `as-${u.productId}`, productId: u.productId, position: u.position }))]);
      },
    };
    const byId = new Map(products.map((p) => [`id-${p.productNumber}`, p.productNumber]));
    const catalog = { byId: new Map(), byNumber: new Map(), canonicalNumber: (n: string) => n, canonicalNumberForId: (id: string) => byId.get(id) ?? null, numberForId: (id: string) => byId.get(id) ?? null } as any;
    const storage = {
      acquireCrossSellRun: async (a: any) => (runs.push({ id: "r", ...a }), runs[0]),
      finishCrossSellRun: async () => undefined,
      getCrossSellPairStates: async () => [],
      appendCrossSellChangeLog: async () => [],
      upsertCrossSellPairStates: async () => [],
    };
    const out = await runNameRuleCrossSelling(
      { storage: storage as any, client: client as any, loadCatalog: async () => catalog, settings: DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS },
      { tenantId: "t", trigger: "manual", dryRun: false },
    );
    expect(deleted).toContain("g-old:as-grund");
    expect(assignments.get("g-id-anbau-Regal erweitern")?.map((a) => a.productId)).toEqual(["id-grund"]);
    expect(assignments.get("g-old")?.map((a) => a.productId)).toEqual(["id-board", "id-back", "id-side"]);
    expect(created).toContain("id-anbau:Regal erweitern:2");
    expect(out.stats?.moved).toBeGreaterThanOrEqual(1);
  });
});

describe("Auch erhältlich in: dasselbe Regal in anderer Höhe, Tiefe oder Farbe", () => {
  const V = {
    grund: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt",
    hoch: "META CLIP | Fachbodenregal | Grundregal | 2500 x 1000 x 400 mm | Fachlast 230 kg | 6 Ebenen | verzinkt",
    hochSchwer: "META CLIP | Fachbodenregal | Grundregal | 2500 x 1000 x 400 mm | Fachlast 330 kg | 6 Ebenen | verzinkt",
    tief: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 600 mm | Fachlast 330 kg | 5 Ebenen | verzinkt",
    ral: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 230 kg | 5 Ebenen | RAL 7035",
    ralSchwer: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 330 kg | 5 Ebenen | RAL 7035",
    // zwei Merkmale anders, andere Breite, andere Rolle, anderes System: keine Ausführung
    hochRal: "META CLIP | Fachbodenregal | Grundregal | 2500 x 1000 x 400 mm | Fachlast 230 kg | 6 Ebenen | RAL 7035",
    breit: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt",
    anbau: "META CLIP | Fachbodenregal | Anbauregal | 2500 x 1000 x 400 mm | Fachlast 230 kg | 6 Ebenen | verzinkt",
    s3: "META CLIP S3 | Fachbodenregal | Grundregal | 2500 x 1000 x 400 mm | Fachlast 230 kg | 6 Ebenen | verzinkt",
    krag: "META MULTISTRONG L | Kragarmregal | Grundregal | 3000 x 1000 x 400 mm | Armlast 220 kg | einseitig | 5+1 Ebenen",
    kragTief: "META MULTISTRONG L | Kragarmregal | Grundregal | 3000 x 1000 x 600 mm | Armlast 140 kg | einseitig | 5+1 Ebenen",
    kragDoppel: "META MULTISTRONG L | Kragarmregal | Grundregal | 3000 x 1000 x 600 mm | Armlast 140 kg | doppelseitig | 5+1 Ebenen",
  };
  const prods = Object.entries(V).map(([k, name]) => ({ productNumber: k, name }));
  const pairs = buildNameRulePairs(prods, { maxPerTab: { variants: 24 } });
  const variants = (src: string) => pairs.filter((p) => p.source === src && p.tab === "variants").map((p) => `${p.kind}:${p.target}`);

  it("je Höhe, Tiefe und Farbe ein Artikel, gleiche Fachlast zuerst; Ebenen dürfen abweichen", () => {
    expect(variants("grund")).toEqual(["other_height:hoch", "other_depth:tief", "other_surface:ral"]);
  });
  it("ohne gleiche Fachlast die nächstliegende", () => {
    expect(variants("tief")).toContain("other_depth:grund");
    expect(variants("ralSchwer")).toEqual(["other_height:hochRal", "other_surface:grund"]);
  });
  it("Seitigkeit gehört zur Ausführung, Armlast darf abweichen", () => {
    expect(variants("krag")).toEqual(["other_depth:kragTief"]);
  });
  it("Paare liegen nur im Tab variants", () => {
    expect(pairs.filter((p) => p.kind.startsWith("other_") && p.kind !== "other_width").every((p) => p.tab === "variants")).toBe(true);
  });
});

import { proposeSystemAccessories } from "../../server/cross-selling/crossSellSystemAccessories";

describe("Standardzubehör-Vorschlag aus Bestellungen", () => {
  const shelf = (pn: string) => ({ productNumber: pn, name: `META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 150 kg | ${pn} Ebenen | verzinkt`, active: true, regalSystem: "CLIP", isService: false });
  const products = [
    shelf("r1"),
    shelf("r2"),
    { productNumber: "spann", name: "META CLIP | Spannschloss | für CLIP Diagonalstab | verzinkt", active: true, regalSystem: "CLIP", isService: false },
    { productNumber: "rahmen", name: "META CLIP | Ständerrahmen T1N | 2000 x 400 mm | verzinkt", active: true, regalSystem: "CLIP", isService: false },
    { productNumber: "montage", name: "Montage", active: true, regalSystem: null, isService: true },
    { productNumber: "fremd", name: "META MULTIPAL | Rammschutzecke | RAL 1003", active: true, regalSystem: "MULTIPAL", isService: false },
  ];
  const orders = Array.from({ length: 10 }, (_, i) => ({
    customerKey: `k${i % 5}`,
    productNumbers: [i % 2 ? "r1" : "r2", ...(i < 6 ? ["spann", "rahmen", "montage", "fremd"] : [])],
  }));
  const res = proposeSystemAccessories(products, orders);

  it("schlägt häufiges Zubehör vor, nicht Teile mit Maß-Regel, Services oder anderes System", () => {
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ system: "META CLIP", shelfOrders: 10 });
    expect(res[0].items.map((i) => i.productNumber)).toEqual(["spann"]);
    expect(res[0].items[0]).toMatchObject({ orders: 6, customers: 5, recommended: true });
  });
});

describe("CLIP-Teile auch für CLIP S3", () => {
  const P = {
    s3: "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 150 kg | 5 Ebenen | Längsriegel | verzinkt",
    s3Rahmen: "META CLIP S3 | Ständerrahmen T1N | 2000 x 400 mm | vzk",
    clipRahmen: "META CLIP | Ständerrahmen T1N | 2000 x 400 mm | verzinkt",
    clipBoden: "META CLIP | Zusatz-Fachboden | 1000 x 400 mm | 150 kg | verzinkt",
    clipMs150: "META CLIP | Fachboden MS150 | 1000 x 400 mm | verzinkt",
    clipDiag: "META CLIP | Diagonalstab | für Regalbreite 1000 mm | verzinkt",
    clipRueck: "META CLIP | Euroloch-Rückwand | 2000 x 1000 mm | verzinkt",
    clipSpann: "META CLIP | Spannschloss | für CLIP Diagonalstab | verzinkt",
    compact: "META CLIP COMPACT | Büro-Steckregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 150 kg | 5 Ebenen | verzinkt",
  };
  const prods = Object.entries(P).map(([k, name]) => ({ productNumber: k, name }));
  const pairs = buildNameRulePairs(prods, { maxPerTab: { extend: 12, accessories: 20, parts: 30 }, systemAccessories: { "META CLIP": ["clipSpann"] } });
  const tab = (src: string, t: string) => pairs.filter((p) => p.source === src && p.tab === t).map((p) => p.target);

  it("S3 bekommt CLIP-Böden, -Wände, -Zubehör und CLIP-Standardzubehör, aber nur die eigenen Rahmen", () => {
    expect(tab("s3", "accessories")).toEqual(["clipBoden", "clipSpann", "clipDiag", "clipRueck"]);
    expect(tab("s3", "parts")).toEqual(["s3Rahmen", "clipMs150"]);
  });
  it("andere CLIP-Untersysteme bleiben unverändert", () => {
    expect(tab("compact", "accessories")).toEqual([]);
  });
});
