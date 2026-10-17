import { describe, expect, it } from "vitest";
import { buildQuickConfigCatalog, postWidthFromProperty, quickConfigSummary } from "../../server/shopContent/quickConfiguratorCatalog";

describe("Artikeltabelle Schnellkonfigurator", () => {
  it("nimmt die Regalarten mit allen Merkmalen auf", () => {
    const { catalog, skipped, counts } = buildQuickConfigCatalog(
      [
        { id: "a", name: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 600 mm | Fachlast 230 kg | 5 Ebenen | RAL 7035" },
        { id: "b", name: "META CLIP S3 | Fachbodenregal | Doppel-Anbauregal | 2500 x 1300 x 400 mm | Fachlast 150 kg | 4+1 Ebenen | Längsriegel | verzinkt" },
        { id: "c", name: "META MULTIPAL | Palettenregal | Grundregal | 3300 x 2700 x 1100 mm | Fachlast 2930 kg | 3 Ebenen | 9 Paletten | verzinkt", post: 85 },
        { id: "d", name: "META MINI-RACK | Weitspannregal | Anbauregal | 2500 x 2600 x 800 mm | Fachlast 490 kg | Stahlpaneelböden | 4 Ebenen" },
        { id: "e", name: "META MULTISTRONG M | Kragarmregal | Grundregal | 3000 x 1000 x 500 mm | Armlast 430 kg | doppelseitig | 5+1 Ebenen" },
        { id: "f", name: "META CLIP COMPACT S3 | Büro-Steckregal | Anbauregal | 2200 x 1000 x 300 mm | Fachlast 80 kg | 6+0 Ebenen | Endanschlag | verzinkt" },
      ],
      "2026-10-17T00:00:00.000Z",
    );
    expect(skipped).toEqual([]);
    expect(counts).toEqual({ fachboden: 2, palette: 1, weitspann: 1, kragarm: 1, buero: 1 });
    const row = (id: string) => {
      const r = catalog.items.find((x) => x[0] === id)!;
      return {
        kind: catalog.kinds[r[1]],
        system: catalog.systems[r[2]],
        role: catalog.roles[r[3]],
        dims: r.slice(4, 7),
        load: r[7],
        levels: catalog.levels[r[8]],
        pallets: r[9],
        surface: r[10] >= 0 ? catalog.surfaces[r[10]] : null,
        double: r[11],
        board: r[12] >= 0 ? catalog.boards[r[12]] : null,
        feature: r[13] >= 0 ? catalog.features[r[13]] : null,
        post: r[14],
      };
    };
    expect(row("a")).toEqual({ kind: "fachboden", system: "META CLIP", role: "Grundregal", dims: [2000, 1000, 600], load: 230, levels: "5", pallets: 0, surface: "RAL 7035", double: 0, board: null, feature: null, post: 0 });
    expect(row("b")).toMatchObject({ role: "Doppel-Anbauregal", double: 1, feature: "Längsriegel", levels: "4+1" });
    expect(row("c")).toMatchObject({ kind: "palette", pallets: 9, levels: "3", post: 85 });
    expect(row("d")).toMatchObject({ kind: "weitspann", board: "Stahlpaneel", surface: null });
    expect(row("e")).toMatchObject({ kind: "kragarm", system: "META MULTISTRONG M", double: 1, load: 430 });
    expect(row("f")).toMatchObject({ kind: "buero", feature: "Endanschlag" });

    expect(quickConfigSummary(catalog).fachboden).toEqual({ h: [2000, 2500], b: [1000, 1300], t: [400, 600], load: [150, 230] });
  });

  it("lässt andere Systeme, Bauteile und Sonderausführungen weg", () => {
    const { catalog, skipped } = buildQuickConfigCatalog([
      { id: "1", name: "META CLIP SPLIT | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt" },
      { id: "2", name: "META CLIP S3 | Drahtgitterfachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt" },
      { id: "3", name: "META CLIP | Zusatz-Fachboden | 1000 x 500 mm | 150 kg | verzinkt" },
      { id: "4", name: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | mit Türen | verzinkt" },
      { id: "5", name: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | 5 Ebenen | verzinkt" },
      { id: "6", name: "META MULTIPAL | Kabeltrommelregal | Anbauregal | 2200 x 900 x 1100 mm | Feldlast 4000 kg | 2 Ebenen | Typ 2 | verzinkt" },
    ]);
    expect(catalog.items).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["Fachlast fehlt", "unbekannte Angabe: mit Türen"]);
  });

  it("MULTIPAL ohne Stützentyp fällt heraus statt zu raten", () => {
    const { catalog, skipped } = buildQuickConfigCatalog([
      { id: "x", name: "META MULTIPAL | Palettenregal | Anbauregal | 3300 x 2700 x 1100 mm | Fachlast 2930 kg | 3 Ebenen | 9 Paletten | verzinkt", post: null },
    ]);
    expect(catalog.items).toEqual([]);
    expect(skipped[0].reason).toBe("Stützentyp fehlt");
  });

  it("liest die Stützenbreite aus Stützentyp oder Profiltyp", () => {
    expect(postWidthFromProperty("85/20")).toBe(85);
    expect(postWidthFromProperty("Profil 100/25")).toBe(100);
    expect(postWidthFromProperty("IPE 140")).toBeNull();
    expect(postWidthFromProperty(undefined)).toBeNull();
  });

  it("meldet doppelte Ausführungen", () => {
    const name = "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt";
    const { catalog, skipped } = buildQuickConfigCatalog([{ id: "x", name }, { id: "y", name }]);
    expect(catalog.items).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/^doppelt/);
  });
});
