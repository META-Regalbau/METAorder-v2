import { describe, expect, it } from "vitest";
import { CATALOG_SYSTEMS, catalogFactsFor } from "../../server/products/catalogFacts";
import { buildCategoryFacts, factsText, validateCategoryText, type GeneratedCategoryText } from "../../server/products/categoryTexts";
import { keyFiguresFromProducts } from "../../server/products/landingPageTexts";

const systems = (name: string) => [...new Set(catalogFactsFor(name).map((f) => f.system))];

describe("Katalog-Fakten", () => {
  it("jede Aussage hat Text und Katalogseite", () => {
    for (const s of CATALOG_SYSTEMS) for (const f of s.facts) {
      expect(f.text.length).toBeGreaterThan(10);
      expect(f.page).toBeGreaterThan(0);
    }
  });

  it("Zuordnung nach Namen: COMPACT ist nicht CLIP, Kragarm hat beide Systeme", () => {
    expect(systems("META CLIP Fachbodenregale")).toEqual(["META CLIP Fachbodenregale", "alle META-Regale"]);
    expect(systems("META COMPACT Büroregale")).toEqual(["META COMPACT Büroregale", "alle META-Regale"]);
    expect(systems("COMPACT Grundregale")).not.toContain("META CLIP Fachbodenregale");
    expect(systems("META Kragarmregale MULTISTRONG und ATLAS ST")).toEqual(["META MULTISTRONG Kragarmregale", "META ATLAS ST Kragarmregale", "alle META-Regale"]);
    expect(systems("ATLAS ST Komplettregale")).toEqual(["META ATLAS ST Kragarmregale", "alle META-Regale"]);
    expect(systems("MINI-RACK Grundregale")).toEqual(["META MINI-RACK Weitspannregale", "alle META-Regale"]);
    expect(catalogFactsFor("Zubehör")).toEqual([]);
  });

  it("Katalogangaben stehen in den Fakten und belegen Zahlen und Herstellerangaben", () => {
    const facts = buildCategoryFacts({ id: "c", name: "CLIP Grundregale", url: "", breadcrumb: "" }, [
      { name: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", properties: [] },
    ]);
    expect(factsText(facts)).toContain("geclinchter Rahmen");
    const g: GeneratedCategoryText = {
      h1: "CLIP Grundregale – Fachbodenregale von META",
      intro: "Hier finden Sie META CLIP Grundregale für die Kleinteilelagerung. Sie werden ohne Werkzeug gesteckt; geclinchte Rahmen tragen bis zu über 70 % mehr als zerlegte Rahmen. Im System sind Feldlasten bis 2.400 kg möglich.",
      sections: [
        { heading: "Wofür?", paragraphs: ["Für Kleinteile in Lager und Werkstatt."] },
        { heading: "Welche Maße?", paragraphs: ["Höhe 2000 mm, Tiefe 400 mm."] },
        { heading: "Sicherheit", paragraphs: ["Regale mit einem Höhen-/Tiefenverhältnis über 4 : 1 gegen Kippen sichern; nur für Handbedienung."] },
      ],
      faq: [
        { q: "Wie hoch ist die Fachlast?", a: "230 kg." },
        { q: "Ist das Regal RAL-gütegesichert?", a: "Ja, nach RAL-RG 614/1." },
        { q: "Brauche ich Werkzeug?", a: "Nein." },
        { q: "Wie hoch ist das Regal?", a: "2000 mm." },
      ],
    };
    expect(validateCategoryText(facts, g)).toBeNull();
  });

  it("feste Kennzahl aus dem Katalog ersetzt den Wert aus den Namen", () => {
    const p = [{ name: "META MULTIPAL | Palettenregal | Grundregal | 4400 x 2700 x 1100 mm | Fachlast 470 kg | 3 Ebenen | verzinkt", properties: [] }];
    expect(keyFiguresFromProducts(p, { mainType: /^Palettenregal$/, loadLabel: "Fachlast", figureOverrides: { 3: "bis 5.500 kg Fachlast" } })[3]).toBe("bis 5.500 kg Fachlast");
  });
});
