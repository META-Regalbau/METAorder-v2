import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";
import { buildQuickConfigCatalog } from "../../server/shopContent/quickConfiguratorCatalog";

// Das Storefront-Skript ist reines Browser-JS ohne Module; ohne window liefert es nur die reinen Helfer.
const source = readFileSync(path.resolve(import.meta.dirname, "../../shopware/storefront-snippets/quick-configurator.js"), "utf8");
const context: Record<string, any> = {};
vm.runInNewContext(source, context);
const qc = context.MetaQuickConfigurator;
const CLIP = qc.rules["META CLIP"];

let n = 0;
const product = (name: string, post: number | null = null) => ({ id: `id${String(++n).padStart(30, "0")}`, name, post });
const shelf = (role: string, dims: string, load = 150, levels = "5", surface = "verzinkt", system = "META CLIP", lr = false) =>
  product(`${system} | Fachbodenregal | ${role} | ${dims} mm | Fachlast ${load} kg | ${levels} Ebenen | ${lr ? "Längsriegel | " : ""}${surface}`);
const pallet = (role: string, dims: string, load: number, levels: number, pallets: number) =>
  product(`META MULTIPAL | Palettenregal | ${role} | ${dims} mm | Fachlast ${load} kg | ${levels} Ebenen | ${pallets} Paletten | verzinkt`, 85);
const span = (role: string, dims: string, board: string) =>
  product(`META MINI-RACK | Weitspannregal | ${role} | ${dims} mm | Fachlast 600 kg | ${board} | 3 Ebenen`);
const arm = (role: string, dims: string, side: string, system = "META MULTISTRONG L") =>
  product(`${system} | Kragarmregal | ${role} | ${dims} mm | Armlast 220 kg | ${side} | 4+1 Ebenen`);

const products = [
  shelf("Grundregal", "2000 x 1000 x 500"),
  shelf("Anbauregal", "2000 x 1000 x 500"),
  shelf("Grundregal", "2000 x 1300 x 500"),
  shelf("Anbauregal", "2000 x 1300 x 500"),
  shelf("Grundregal", "2000 x 1000 x 500", 230),
  shelf("Anbauregal", "2000 x 1000 x 500", 230),
  shelf("Grundregal", "2000 x 1000 x 500", 150, "6", "verzinkt", "META CLIP S3", true),
  shelf("Anbauregal", "2000 x 1000 x 500", 150, "6", "verzinkt", "META CLIP S3", true),
  shelf("Grundregal", "2000 x 1000 x 300", 150, "5", "RAL 7035"),
  shelf("Anbauregal", "2000 x 1000 x 300", 150, "5", "RAL 7035"),
  shelf("Doppel-Grundregal", "2000 x 1000 x 500"),
  shelf("Doppel-Anbauregal", "2000 x 1000 x 500"),
  // nur Grundregal: ergibt keine Zeile
  shelf("Grundregal", "2500 x 1000 x 500"),
  pallet("Grundregal", "3300 x 2700 x 1100", 790, 4, 12),
  pallet("Anbauregal", "3300 x 2700 x 1100", 790, 4, 12),
  pallet("Grundregal", "3300 x 2700 x 1100", 980, 3, 9),
  pallet("Anbauregal", "3300 x 2700 x 1100", 980, 3, 9),
  pallet("Grundregal", "3300 x 2700 x 1100", 490, 4, 12),
  pallet("Anbauregal", "3300 x 2700 x 1100", 490, 4, 12),
  span("Grundregal", "2200 x 1800 x 800", "Spanplattenböden"),
  span("Anbauregal", "2200 x 1800 x 800", "Spanplattenböden"),
  span("Grundregal", "2200 x 1800 x 800", "Stahlpaneelböden"),
  span("Anbauregal", "2200 x 1800 x 800", "Stahlpaneelböden"),
  arm("Grundregal", "2500 x 1000 x 500", "einseitig"),
  arm("Anbauregal", "2500 x 1000 x 500", "einseitig"),
  arm("Grundregal", "2500 x 1000 x 500", "doppelseitig"),
  arm("Anbauregal", "2500 x 1000 x 500", "doppelseitig"),
  // nicht im Konfigurator
  product("META CLIP | Zusatz-Fachboden | 1000 x 500 mm | 150 kg | verzinkt"),
  product("META CLIP SPLIT | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt"),
];
const { catalog } = buildQuickConfigCatalog(products, "2026-10-17T00:00:00.000Z");
const items = qc.decodeCatalog(JSON.parse(JSON.stringify(catalog)));
const query = (q: Record<string, unknown> = {}) => ({ kind: "fachboden", double: false, h: 2000, b: 1000, t: 500, load: 150, surface: "verzinkt", board: null, ...q });
const view = (positions: Array<{ qty: number; item: { role: string; b: number } }>) => positions.map((p) => `${p.qty} ${p.item.role} ${p.item.b}`);

describe("Regal-Schnellkonfigurator: Länge und Felder", () => {
  it("rechnet bei CLIP 40 mm je Ständerrahmen", () => {
    expect(qc.rowLength([1000], CLIP)).toBe(1080);
    expect(qc.rowLength([1000, 1000, 1000], CLIP)).toBe(3160);
    expect(qc.fieldCount(3160, 1000, CLIP)).toBe(3);
    expect(qc.fieldCount(3159, 1000, CLIP)).toBe(2);
    expect(qc.fieldCount(1000, 1000, CLIP)).toBe(0);
  });

  it("MINI-RACK nach Planmaß: Grundregal + 107 mm, Anbauregal + 51 mm", () => {
    const rule = qc.rules["META MINI-RACK"];
    expect(qc.rowLength([1800], rule)).toBe(1907);
    expect(qc.rowLength([1800, 1800], rule)).toBe(1907 + 1851);
  });

  it("MULTISTRONG: Achsmaß Feldbreite + 30 mm plus Ständerbreite", () => {
    expect(qc.rowLength([1000, 1000], qc.rules["META MULTISTRONG L"])).toBe(2 * 1030 + 64);
    expect(qc.rowLength([1300], qc.rules["META MULTISTRONG M"])).toBe(1330 + 73);
  });

  it("MULTIPAL mit der Stützenbreite des Artikels", () => {
    const p = items.find((i: any) => i.kind === "palette");
    expect({ ...qc.ruleFor(p) }).toEqual({ start: 85, per: 85 });
    expect(qc.rowLength([2700, 2700], qc.ruleFor(p))).toBe(2 * 2700 + 3 * 85);
  });

  it("liest Längen in mm und m", () => {
    expect(qc.parseLength("4200")).toBe(4200);
    expect(qc.parseLength("4.200 mm")).toBe(4200);
    expect(qc.parseLength("4,2 m")).toBe(4200);
    expect(qc.parseLength("4,2")).toBe(4200);
    expect(qc.parseLength("")).toBeNull();
    expect(qc.parseLength("abc")).toBeNull();
  });

  it("mischt Breiten nur, wenn die Zeile länger wird, und nie über die Länge", () => {
    // 4 × 1000 = 4.200 mm; 2 × 1000 + 2 × 1300 = 4.800 mm füllt genau
    const mix = qc.bestMix(4800, 1000, [1000, 1300], CLIP);
    expect(mix.length).toBe(4800);
    expect([...mix.widths].sort()).toEqual([1000, 1000, 1300, 1300]);
    // 4.700 mm: 2 × 1000 + 2 × 1300 wären 4.800 – am längsten passt 3 × 1000 + 1300 = 4.500
    const tight = qc.bestMix(4700, 1000, [1000, 1300], CLIP);
    expect(tight.length).toBe(4500);
    expect([...tight.widths].sort()).toEqual([1000, 1000, 1000, 1300]);
    // Grundregal bleibt in der gewählten Breite
    expect(mix.widths[0]).toBe(1000);
  });
});

describe("Regal-Schnellkonfigurator: Fachbodenregale", () => {
  it("findet nur Ausführungen mit Grund- und Anbauregal, höhere Fachlast nur als Ersatz", () => {
    const lines = qc.findLines(items, query());
    expect(lines.map((l: any) => `${l.system} ${l.load} ${l.levels} ${l.lr ? "LR" : "D"}`)).toEqual(["META CLIP 150 5 D", "META CLIP S3 150 6 LR"]);
    expect(qc.findLines(items, query({ h: 2500 }))).toEqual([]);
  });

  it("nimmt die nächsthöhere Fachlast, wenn es die gewünschte nicht gibt", () => {
    expect(qc.findLines(items, query({ load: 200 })).map((l: any) => l.load)).toEqual([230]);
  });

  it("plant 1 Grundregal + Anbauregale und zeigt gemischte Breiten als Zusatz", () => {
    const [line] = qc.findLines(items, query());
    const plan = qc.planLine(items, line, query(), 4800);
    expect(plan.main.fields).toBe(4);
    expect(plan.main.length).toBe(4200);
    expect(plan.main.nextLength).toBe(5240);
    expect(view(plan.main.positions)).toEqual(["1 Grundregal 1000", "3 Anbauregal 1000"]);
    expect(plan.mix.length).toBe(4800);
    expect(view(plan.mix.positions)).toEqual(["1 Grundregal 1000", "2 Anbauregal 1300", "1 Anbauregal 1000"]);
  });

  it("keine gemischte Zeile, wenn sie kaum länger wird", () => {
    const [line] = qc.findLines(items, query());
    const plan = qc.planLine(items, line, query(), 4250);
    expect(plan.main.length).toBe(4200);
    expect(plan.mix).toBeNull();
  });

  it("kein Plan, wenn nicht einmal ein Grundregal passt", () => {
    const [line] = qc.findLines(items, query());
    expect(qc.planLine(items, line, query(), 1000)).toBeNull();
  });

  it("schlägt Werte vor, mit denen es die Kombination gibt", () => {
    const alts = qc.alternatives(items, query({ t: 300 }));
    expect(alts).toContainEqual({ key: "t", value: 500 });
    expect(alts).toContainEqual({ key: "surface", value: "RAL 7035" });
  });

  it("Doppelregale getrennt von Einzelregalen", () => {
    const lines = qc.findLines(items, query({ double: true }));
    expect(lines).toHaveLength(1);
    expect(lines[0].base.role).toBe("Doppel-Grundregal");
    expect(lines[0].add.role).toBe("Doppel-Anbauregal");
  });

  it("setzt fehlende oder unbekannte Werte auf vorhandene", () => {
    const q = qc.normalizeQuery(items, { h: 2400, b: 1100, load: 180, surface: "blau" });
    expect({ ...q }).toMatchObject({ kind: "fachboden", double: false, h: 2500, b: 1000, t: 500, load: 230, surface: "verzinkt" });
  });
});

describe("Regal-Schnellkonfigurator: andere Regalarten", () => {
  it("Palettenregal: Last im Namen gilt je Palette", () => {
    const q = { kind: "palette", double: false, h: 3300, b: 2700, t: 1100, weight: 700, surface: "verzinkt", board: null };
    // je Ausführung die kleinste passende Last (4 Ebenen: 790 statt 490 zu wenig)
    expect(qc.findLines(items, q).map((l: any) => `${l.levels}/${l.pallets}/${l.load}`)).toEqual(["4/12/790", "3/9/980"]);
    // 800 kg: nur noch die Ausführung mit 980 kg
    expect(qc.findLines(items, { ...q, weight: 800 }).map((l: any) => l.load)).toEqual([980]);
    // 1.200 kg gibt es nicht: Vorschlag mit dem höchsten Gewicht
    expect(qc.alternatives(items, { ...q, weight: 1200 })[0]).toEqual({ key: "weight", value: 980 });
    const [line] = qc.findLines(items, q);
    const plan = qc.planLine(items, line, q, 9000);
    // (9000 − 85) / (2700 + 85) = 3 Felder
    expect(plan.main.fields).toBe(3);
    expect(plan.main.length).toBe(3 * 2700 + 4 * 85);
  });

  it("Weitspannregal: Böden als eigene Auswahl", () => {
    const q = qc.normalizeQuery(items, { kind: "weitspann" });
    expect([...qc.choices(items, "weitspann", false).board]).toEqual(["Spanplatte", "Stahlpaneel"]);
    const lines = qc.findLines(items, { ...q, board: "Stahlpaneel" });
    expect(lines).toHaveLength(1);
    expect(lines[0].board).toBe("Stahlpaneel");
    const plan = qc.planLine(items, lines[0], { ...q, board: "Stahlpaneel" }, 6000);
    // 56 + n × (1800 + 51) ≤ 6000 → 3 Felder = 5.609 mm
    expect(plan.main.length).toBe(5609);
  });

  it("Kragarmregal: einseitig/doppelseitig als Bauform", () => {
    expect([...qc.choices(items, "kragarm").double]).toEqual([false, true]);
    const q = qc.normalizeQuery(items, { kind: "kragarm", double: true });
    const [line] = qc.findLines(items, q);
    expect(line.base.double).toBe(true);
    expect({ ...line.rule }).toEqual({ ...qc.rules["META MULTISTRONG L"] });
  });
});

describe("Regal-Schnellkonfigurator: Adresse und Produktseite", () => {
  it("überträgt die Maße eines Fachbodenregals in die Adresse", () => {
    const shelfQ = qc.parseShelfName("META CLIP S3 | Fachbodenregal | Doppel-Anbauregal | 2500 x 1300 x 600 mm | Fachlast 230 kg | 5 Ebenen | Längsriegel | RAL 7035");
    expect({ ...shelfQ }).toEqual({ kind: "fachboden", h: 2500, b: 1300, t: 600, load: 230, surface: "RAL 7035", double: true });
    const url = qc.toQuery({ ...shelfQ, length: 6000 });
    expect(url).toBe("?regalart=fachboden&hoehe=2500&breite=1300&tiefe=600&last=230&farbe=RAL%207035&bauform=doppel&laenge=6000");
    expect({ ...qc.readQuery(url) }).toEqual({ ...shelfQ, length: 6000 });
  });

  it("erkennt die anderen Regalarten", () => {
    expect({ ...qc.parseShelfName("META MULTIPAL | Palettenregal | Grundregal | 3300 x 2700 x 1100 mm | Fachlast 2400 kg | 4 Ebenen | 12 Paletten | verzinkt") })
      .toEqual({ kind: "palette", h: 3300, b: 2700, t: 1100, surface: "verzinkt", double: false });
    expect({ ...qc.parseShelfName("META MINI-RACK | Weitspannregal | Anbauregal | 2500 x 2600 x 800 mm | Fachlast 490 kg | Stahlpaneelböden | 4 Ebenen") })
      .toEqual({ kind: "weitspann", h: 2500, b: 2600, t: 800, load: 490, surface: null, double: false, board: "Stahlpaneel" });
    expect(qc.parseShelfName("META MULTISTRONG M | Kragarmregal | Grundregal | 3000 x 1000 x 500 mm | Armlast 430 kg | doppelseitig | 5+1 Ebenen").double).toBe(true);
  });

  it("Adressen der ersten Fassung gelten weiter", () => {
    expect({ ...qc.readQuery("?hoehe=2000&fachlast=230&bauform=einzel") }).toEqual({ h: 2000, load: 230, double: false });
  });

  it("kein Link bei anderen Artikeln", () => {
    expect(qc.parseShelfName("META CLIP | Zusatz-Fachboden | 1000 x 500 mm | 150 kg | verzinkt")).toBeNull();
    expect(qc.parseShelfName("META ATLAS ST | Kragarmregal | 4 Felder | 2000 x 5400 x 500 mm | Armlast 200 kg | einseitig | 5+1 Ebenen")).toBeNull();
  });
});
