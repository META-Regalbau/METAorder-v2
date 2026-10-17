import { describe, expect, it } from "vitest";
import { buildQuickConfigCatalog } from "../../server/shopContent/quickConfiguratorCatalog";

describe("Artikeltabelle Schnellkonfigurator", () => {
  it("nimmt CLIP- und CLIP-S3-Fachbodenregale mit allen Merkmalen auf", () => {
    const { catalog, skipped } = buildQuickConfigCatalog(
      [
        { id: "a", name: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 600 mm | Fachlast 230 kg | 5 Ebenen | RAL 7035" },
        { id: "b", name: "META CLIP S3 | Fachbodenregal | Doppel-Anbauregal | 2500 x 1300 x 400 mm | Fachlast 150 kg | 4+1 Ebenen | Längsriegel | verzinkt" },
      ],
      "2026-10-17T00:00:00.000Z",
    );
    expect(skipped).toEqual([]);
    expect(catalog.items).toHaveLength(2);
    const a = catalog.items.find((r) => r[0] === "a");
    const b = catalog.items.find((r) => r[0] === "b");
    expect(a).toEqual(["a", 0, 0, 2000, 1000, 600, 230, catalog.levels.indexOf("5"), 0, catalog.surfaces.indexOf("RAL 7035")]);
    expect(b).toEqual(["b", 1, 3, 2500, 1300, 400, 150, catalog.levels.indexOf("4+1"), 1, catalog.surfaces.indexOf("verzinkt")]);
  });

  it("lässt andere Systeme, Bauteile und Sonderausführungen weg", () => {
    const { catalog, skipped } = buildQuickConfigCatalog([
      { id: "1", name: "META CLIP SPLIT | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt" },
      { id: "2", name: "META CLIP S3 | Drahtgitterfachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt" },
      { id: "3", name: "META CLIP | Zusatz-Fachboden | 1000 x 500 mm | 150 kg | verzinkt" },
      { id: "4", name: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | mit Türen | verzinkt" },
      { id: "5", name: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | 5 Ebenen | verzinkt" },
    ]);
    expect(catalog.items).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["Fachlast fehlt", "unbekannte Angabe: mit Türen"]);
  });

  it("meldet doppelte Ausführungen", () => {
    const name = "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt";
    const { catalog, skipped } = buildQuickConfigCatalog([{ id: "x", name }, { id: "y", name }]);
    expect(catalog.items).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/^doppelt/);
  });
});
