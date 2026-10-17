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

let n = 0;
const product = (name: string) => ({ id: `id${String(++n).padStart(30, "0")}`, name });
const shelf = (role: string, dims: string, load = 150, levels = "5", surface = "verzinkt", system = "META CLIP", lr = false) =>
  product(`${system} | Fachbodenregal | ${role} | ${dims} mm | Fachlast ${load} kg | ${levels} Ebenen | ${lr ? "Längsriegel | " : ""}${surface}`);

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
  // nicht im Konfigurator
  product("META CLIP | Zusatz-Fachboden | 1000 x 500 mm | 150 kg | verzinkt"),
  product("META CLIP SPLIT | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt"),
];
const { catalog } = buildQuickConfigCatalog(products, "2026-10-17T00:00:00.000Z");
const items = qc.decodeCatalog(JSON.parse(JSON.stringify(catalog)));
const query = (q: Record<string, unknown> = {}) => ({ double: false, h: 2000, b: 1000, t: 500, load: 150, surface: "verzinkt", ...q });

describe("Regal-Schnellkonfigurator: Länge und Felder", () => {
  it("rechnet 40 mm je Ständerrahmen", () => {
    expect(qc.rowLength([1000])).toBe(1080);
    expect(qc.rowLength([1000, 1000, 1000])).toBe(3160);
    expect(qc.fieldCount(3160, 1000)).toBe(3);
    expect(qc.fieldCount(3159, 1000)).toBe(2);
    expect(qc.fieldCount(1000, 1000)).toBe(0);
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
    const mix = qc.bestMix(4800, 1000, [1000, 1300]);
    expect(mix.length).toBe(4800);
    expect([...mix.widths].sort()).toEqual([1000, 1000, 1300, 1300]);
    // 4.700 mm: 2 × 1000 + 2 × 1300 wären 4.800 – am längsten passt 3 × 1000 + 1300 = 4.500
    const tight = qc.bestMix(4700, 1000, [1000, 1300]);
    expect(tight.length).toBe(4500);
    expect([...tight.widths].sort()).toEqual([1000, 1000, 1000, 1300]);
    expect(tight.length).toBeLessThanOrEqual(4700);
    // Grundregal bleibt in der gewählten Breite
    expect(mix.widths[0]).toBe(1000);
  });
});

describe("Regal-Schnellkonfigurator: Ausführungen", () => {
  it("findet nur Ausführungen mit Grund- und Anbauregal, höhere Fachlast nur als Ersatz", () => {
    const lines = qc.findLines(items, query());
    expect(lines.map((l: any) => `${l.system} ${l.load} ${l.levels} ${l.lr ? "LR" : "D"}`)).toEqual([
      "META CLIP 150 5 D",
      "META CLIP S3 150 6 LR",
    ]);
    expect(qc.findLines(items, query({ h: 2500 }))).toEqual([]);
  });

  it("nimmt die nächsthöhere Fachlast, wenn es die gewünschte nicht gibt", () => {
    const lines = qc.findLines(items, query({ load: 200 }));
    expect(lines.map((l: any) => l.load)).toEqual([230]);
  });

  it("plant 1 Grundregal + Anbauregale und zeigt gemischte Breiten als Zusatz", () => {
    const [line] = qc.findLines(items, query());
    const plan = qc.planLine(items, line, query(), 4800);
    expect(plan.main.fields).toBe(4);
    expect(plan.main.length).toBe(4200);
    expect(plan.main.nextLength).toBe(5240);
    expect(plan.main.positions.map((p: any) => `${p.qty} ${p.item.role} ${p.item.b}`)).toEqual(["1 Grundregal 1000", "3 Anbauregal 1000"]);
    expect(plan.mix.length).toBe(4800);
    expect(plan.mix.positions.map((p: any) => `${p.qty} ${p.item.role} ${p.item.b}`)).toEqual(["1 Grundregal 1000", "2 Anbauregal 1300", "1 Anbauregal 1000"]);
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
    expect(q).toMatchObject({ double: false, h: 2500, b: 1000, t: 500, load: 230, surface: "verzinkt" });
  });
});

describe("Regal-Schnellkonfigurator: Adresse und Produktseite", () => {
  it("überträgt die Maße eines Artikels in die Adresse", () => {
    const shelfQ = qc.parseShelfName("META CLIP S3 | Fachbodenregal | Doppel-Anbauregal | 2500 x 1300 x 600 mm | Fachlast 230 kg | 5 Ebenen | Längsriegel | RAL 7035");
    expect(shelfQ).toEqual({ h: 2500, b: 1300, t: 600, load: 230, surface: "RAL 7035", double: true });
    const url = qc.toQuery({ ...shelfQ, length: 6000 });
    expect(url).toBe("?hoehe=2500&breite=1300&tiefe=600&fachlast=230&farbe=RAL%207035&bauform=doppel&laenge=6000");
    expect({ ...qc.readQuery(url) }).toEqual({ ...shelfQ, length: 6000 });
  });

  it("kein Link bei anderen Artikeln", () => {
    expect(qc.parseShelfName("META CLIP | Zusatz-Fachboden | 1000 x 500 mm | 150 kg | verzinkt")).toBeNull();
    expect(qc.parseShelfName("META MULTIPAL | Palettenregal | Grundregal | 3000 x 2700 x 1100 mm | Feldlast 2800 kg | 3 Ebenen | RAL 5010")).toBeNull();
  });
});
