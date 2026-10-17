import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";
import { GLOSSARY_TERMS } from "../../server/products/glossary";
import { firstSentences, glossaryHints, injectGlossaryHints } from "../../server/products/glossaryHints";

// Das Storefront-Skript ist reines Browser-JS ohne Module; ohne window liefert es nur die reinen Helfer.
const source = readFileSync(path.resolve(import.meta.dirname, "../../shopware/storefront-snippets/glossary-hints.js"), "utf8");
type Hit = { key: string; index: number; end: number } | null;
type Api = {
  data: { url: string; terms: Array<{ key: string; term: string; text: string }> };
  config: { sources: Array<{ keys?: string[] }> };
  compile: (terms: unknown) => unknown;
  findTerm: (text: string, compiled: unknown, keys?: string[] | null, used?: Record<string, boolean>) => Hit;
};
function load(js: string): Api {
  const context: Record<string, any> = {};
  vm.runInNewContext(js, context);
  return context.MetaGlossaryHints;
}

const hints = glossaryHints();
const snippet = load(injectGlossaryHints(source, hints));
const compiled = snippet.compile(snippet.data.terms);
const nameKeys = snippet.config.sources[0].keys!;
const find = (text: string, keys?: string[], used?: Record<string, boolean>) => snippet.findTerm(text, compiled, keys ?? null, used)?.key ?? null;

describe("Lexikon-Hinweise: Daten", () => {
  it("nimmt die 15 Begriffe mit hint: true", () => {
    expect(hints.map((h) => h.key)).toEqual([
      "fachlast", "feldlast", "armlast", "staenderlast", "grundregal", "anbauregal", "komplettregal",
      "diagonalverstrebung", "laengsriegel", "kippsicherung", "sendzimirverzinkt", "geclincht", "s3-rahmen", "planmass", "achsmass",
    ]);
  });

  it("zeigt den ersten Satz ohne Verweis-Markierung, kurze Sätze mit dem zweiten", () => {
    for (const h of hints) {
      expect(h.text, h.key).not.toMatch(/\[\[|\]\]/);
      expect(h.text, h.key).toMatch(/[.!?]$/);
      expect(h.text.length, h.key).toBeGreaterThanOrEqual(40);
      expect(h.text.length, h.key).toBeLessThanOrEqual(260);
    }
    const byKey = Object.fromEntries(hints.map((h) => [h.key, h.text]));
    expect(byKey.fachlast).toBe("So viel darf auf einem einzelnen Fachboden oder einer Fachebene liegen – gleichmäßig über die ganze Fläche verteilt.");
    expect(byKey.feldlast).toBe("Die Gesamttragkraft eines Regalfeldes, also des Bereichs zwischen zwei Rahmen.");
    expect(byKey.sendzimirverzinkt).toMatch(/^Grundausführung der META-Regale\. Das Stahlband/);
    expect(byKey.planmass).toBe("Der tatsächliche Platzbedarf eines Regals. Damit planen Sie, ob die Regalzeile an die Wand passt.");
  });

  it("trennt nicht an Abkürzungen und Zahlen", () => {
    expect(firstSentences("Bei CLIP z. B. bis 1.650 kg je Feld und mehr als genug Platz. Zweiter Satz.")).toBe(
      "Bei CLIP z. B. bis 1.650 kg je Feld und mehr als genug Platz.",
    );
  });

  it("schreibt Begriffe und Lexikon-Adresse in den Baustein, auch ein zweites Mal", () => {
    expect(load(source).data.terms).toEqual([]);
    expect(snippet.data.url).toBe("/regal-lexikon");
    expect(snippet.data.terms).toHaveLength(15);
    const twice = load(injectGlossaryHints(injectGlossaryHints(source, hints), hints.slice(0, 2)));
    expect(twice.data.terms.map((t) => t.key)).toEqual(["fachlast", "feldlast"]);
    expect(() => injectGlossaryHints("var x = 1;", hints)).toThrow(/Platzhalter/);
  });

  it("verlinkt nur auf Begriffe, die im Lexikon stehen", () => {
    const keys = new Set(GLOSSARY_TERMS.map((t) => t.key));
    for (const h of hints) expect(keys.has(h.key), h.key).toBe(true);
  });
});

describe("Lexikon-Hinweise: Begriffserkennung", () => {
  it("findet Begriffe in den Eigenschaftsnamen des Shops", () => {
    expect(find("max. Fachlast:")).toBe("fachlast");
    expect(find("Fachlast*")).toBe("fachlast");
    expect(find("max. Feldlast:")).toBe("feldlast");
    expect(find("Fach- und Feldlasten")).toBe("feldlast");
    expect(find("max. Armlast")).toBe("armlast");
    expect(find("Ständerlast einseitig")).toBe("staenderlast");
    expect(find("Kippsicherung vorgeschrieben?")).toBe("kippsicherung");
    expect(find("Utensilien für Kippsicherung enthalten?")).toBe("kippsicherung");
  });

  it("findet Begriffe in Eigenschaftswerten", () => {
    expect(find("Grundregal (GR)")).toBe("grundregal");
    expect(find("Komplettregal")).toBe("komplettregal");
    expect(find("Diagonalverstrebung/Reifen-Längsriegel")).toBe("diagonalverstrebung");
    expect(find("Längsriegel")).toBe("laengsriegel");
    expect(find("geclincht (vormontiert)")).toBe("geclincht");
    expect(find("CLIP S3")).toBe("s3-rahmen");
    expect(find("Verzinkt")).toBe("sendzimirverzinkt");
  });

  it("lässt andere Wörter und zusammengesetzte Begriffe aus", () => {
    for (const text of [
      "Oberfläche Profile", "Rahmen vormontiert?", "Höhe", "mögliche Kippsicherungs-Arten", "Reifen-Längsriegel",
      "feuerverzinkt", "Fachlastschild", "Anzahl Böden", "Belastung je Holmpaar",
    ]) {
      expect(find(text), text).toBeNull();
    }
  });

  it("nimmt im Artikelnamen nur Grundregal, Anbauregal, Komplettregal und S3, in Reihenfolge", () => {
    const name = "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | Längsriegel | verzinkt";
    const first = snippet.findTerm(name, compiled, nameKeys, {});
    expect(first?.key).toBe("s3-rahmen");
    expect(name.slice(first!.index, first!.end)).toBe("CLIP S3");
    const second = snippet.findTerm(name, compiled, nameKeys, { "s3-rahmen": true });
    expect(name.slice(second!.index, second!.end)).toBe("Grundregal");
    expect(find(name, nameKeys, { "s3-rahmen": true, grundregal: true })).toBeNull();
    expect(find("META CLIP | Fachbodenregal | Anbauregal | 2000 x 1300 x 400 mm", nameKeys)).toBe("anbauregal");
    // „Doppel-Grundregal" ist ein eigener Begriff
    expect(find("META CLIP S3 | Fachbodenregal | Doppel-Grundregal | 2000 x 1300 x 500 mm", nameKeys, { "s3-rahmen": true })).toBeNull();
  });

  it("vergibt jeden Begriff nur einmal je Seite", () => {
    expect(find("max. Fachlast", undefined, { fachlast: true })).toBeNull();
    expect(find("Fachlast und Feldlast", undefined, { fachlast: true })).toBe("feldlast");
  });

  it("nimmt bei Plural das ganze Wort", () => {
    const hit = snippet.findTerm("Fach- und Feldlasten", compiled, null, {});
    expect("Fach- und Feldlasten".slice(hit!.index, hit!.end)).toBe("Feldlasten");
  });
});
