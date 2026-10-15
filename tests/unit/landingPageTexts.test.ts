import { describe, expect, it } from "vitest";
import { buildCategoryFacts } from "../../server/products/categoryTexts";
import { keyFigureText, keyFiguresFromProducts, mainTypeProducts, replaceKeyFigure } from "../../server/products/landingPageTexts";

const p = (name: string) => ({ name, properties: [] });

describe("Landingpages: Kennzahlen", () => {
  const products = [
    p("META MULTIPAL | Palettenregal | Grundregal | 4400 x 2700 x 1100 mm | Fachlast 960 kg | 3 Ebenen | 9 Paletten | verzinkt"),
    p("META MULTIPAL | Palettenregal | Anbauregal | 2200 x 1825 x 800 mm | Feldlast 5500 kg | 2 Ebenen | verzinkt"),
    // Sonderregal: zaehlt nicht fuer das rote Band
    p("META MULTIPAL | Kabeltrommelregal | Grundregal | 2700 x 900 x 1100 mm | Feldlast 4000 kg | 2 Ebenen | Typ 1 | verzinkt"),
    p("Altname ohne Schema 3000 x 9999 x 100"),
  ];

  it("nur Hauptregaltyp, Spannen und hoechste Last", () => {
    expect(keyFiguresFromProducts(products, { mainType: /^Palettenregal$/, loadLabel: "Feldlast" })).toEqual([
      "2.200 mm bis 4.400 mm Höhe",
      "1.825 mm bis 2.700 mm Breite",
      "800 mm bis 1.100 mm Tiefe",
      "bis 5.500 kg Feldlast",
    ]);
  });

  it("Texte nur aus dem Hauptregaltyp, Zeilenlaenge zaehlt nicht als Breite", () => {
    expect(mainTypeProducts(products, { mainType: /^Palettenregal$/ }).map((x) => x.name.split(" | ")[1])).toEqual(["Palettenregal", "Palettenregal"]);
    const atlas = [p("META ATLAS ST | Kragarmregal | 3 Felder | 2000 x 4050 x 500 mm | Armlast 200 kg | einseitig | 5+1 Ebenen"), p("META MULTISTRONG M | Kragarmregal | Grundregal | 2500 x 1300 x 800 mm | Armlast 535 kg | einseitig | 4+1 Ebenen")];
    expect(keyFiguresFromProducts(atlas, { mainType: /^Kragarmregal$/, loadLabel: "Armlast" })[1]).toBe("1.300 mm Breite");
  });

  it("keepFigures uebernimmt den bisherigen Wert, fehlende Last bleibt leer", () => {
    const f = keyFiguresFromProducts(products, { mainType: /^Palettenregal$/, loadLabel: "Armlast", keepFigures: [1] }, ["a", "1.030 mm bis 1.330 mm Achsmaß"]);
    expect(f[1]).toBe("1.030 mm bis 1.330 mm Achsmaß");
    expect(f[3]).toBe("");
  });

  it("Kennzahl lesen und ersetzen, Icon und Farbe bleiben", () => {
    const html =
      '<h2 style="text-align: center;"><font color="#ffffff"><i class="fas fa-weight-hanging icon-3x"></i><br></font></h2><h2 style="text-align: center;"><font color="#ffffff">bis 5.500 kg Fachlast&nbsp;</font></h2>';
    expect(keyFigureText(html)).toBe("bis 5.500 kg Fachlast");
    const next = replaceKeyFigure(html, "bis 5.500 kg Feldlast");
    expect(keyFigureText(next)).toBe("bis 5.500 kg Feldlast");
    expect(next).toContain("fa-weight-hanging");
    expect(next).toContain('<font color="#ffffff">bis 5.500 kg Feldlast</font>');
  });

  it("Ziffer am Anfang, Einheit im eigenen span, zweiter Lauf aendert nichts", () => {
    const icon = '<h2 style="text-align: center;"><font color="#ffffff"><i class="fas fa-weight-hanging icon-3x"></i><br></font></h2>';
    const html = `${icon}<h2 style="text-align: center;"><font color="#ffffff">bis 3.500 kg&nbsp;</font><span style="color: rgb(255, 255, 255);">Ständerlast</span></h2>`;
    const once = replaceKeyFigure(html, "bis 535 kg Armlast");
    expect(keyFigureText(once)).toBe("bis 535 kg Armlast");
    expect(once).not.toContain("Ständerlast");
    expect(replaceKeyFigure(once, "bis 535 kg Armlast")).toBe(once);
    const digits = replaceKeyFigure(`${icon}<h2 style="text-align: center;"><font color="#ffffff">400 mm bis 600 mm Tiefe</font></h2>`, "400 mm bis 800 mm Tiefe");
    expect(digits).toContain('<font color="#ffffff">400 mm bis 800 mm Tiefe</font>');
    expect(replaceKeyFigure(digits, "400 mm bis 800 mm Tiefe")).toBe(digits);
  });

  it("Fakten: kaputte Ebenen-Angaben fallen raus, 0 mm heisst nicht verstellbar", () => {
    const facts = buildCategoryFacts({ id: "x", name: "Test", url: "/", breadcrumb: "Test" }, [
      { name: "META MULTIPAL | Palettenregal | Grundregal | 4400 x 2700 x 1100 mm | Fachlast 2800 kg| 3 Ebenen | verzinkt", properties: [] },
      { name: "META MULTIPAL | Palettenregal | Grundregal | 4400 x 2700 x 1100 mm | 4 Ebenen | verzinkt", properties: [{ group: "Verstellraster (Höhe)", option: "0 mm" }] },
      { name: "META MULTIPAL | Palettenregal | Grundregal | 4400 x 2700 x 1100 mm | 5 Ebenen | verzinkt", properties: [{ group: "Verstellraster (Höhe)", option: "100 mm" }] },
    ]);
    expect(facts.levels).toEqual(["4", "5"]);
    expect(facts.features.find((f) => f.label === "Verstellraster (Höhe)")?.values).toEqual(["nicht verstellbar", "100 mm"]);
  });
});
