import { describe, expect, it } from "vitest";
import {
  BUILD_STEP_KEYS,
  CATEGORY_LANDING_PAGES,
  catalogSpans,
  exampleTexts,
  fillExample,
  landingProductNumbers,
  rowFigures,
  type CategoryLandingPage,
} from "../../server/products/categoryLandingPages";
import { CategoryLandingHtml, categoryLandingCss, landingPlain, landingTextHtml, rowDrawingSvg } from "../../server/products/categoryLandingPageHtml";
import { CATALOG_SYSTEMS, GENERAL_CATALOG_FACTS, SAFETY_FACTS } from "../../server/products/catalogFacts";
import { GLOSSARY_COMPARISONS } from "../../server/products/glossary";
import { COMPETITOR_NAMES } from "../../shared/competitorNames";

const page = (key: string) => CATEGORY_LANDING_PAGES.find((p) => p.key === key)!;

/** Alle von Hand geschriebenen Texte einer Seite (ohne Rechenbeispiel, dessen Zahlen werden errechnet) */
function pageTexts(p: CategoryLandingPage): string[] {
  const own = (p.systems.extraComparisons ?? []).flatMap((c) => [c.title, c.intro, ...c.sides.flatMap((s) => [s.name, ...s.plus, ...s.minus, s.fit])]);
  return [
    p.eyebrow,
    p.h1,
    p.lead,
    ...p.proof,
    ...p.facts.flatMap((f) => [f.value, f.label]),
    p.systems.title,
    p.systems.intro,
    ...own,
    ...p.tiles.flatMap((t) => [t.label, t.text]),
    p.guide.title,
    p.guide.intro,
    ...p.guide.steps.flatMap((s) => [s.title, s.text]),
    ...p.guide.parts,
    ...p.guide.avoid,
    ...p.guide.operation,
    p.planNote,
    p.productsTitle,
    p.seo.title,
    ...p.seo.paragraphs,
    p.faqTitle,
    ...p.faq.flatMap((f) => [f.q, f.a]),
    p.advice.title,
    p.advice.text,
  ].map(landingPlain);
}

const products = (p: CategoryLandingPage) =>
  Object.fromEntries(landingProductNumbers(p).map((n, i) => [n, { id: `id${i}`, name: `META TEST | Regal | Grundregal | 2000 x 1000 x 400 mm`, priceNet: 100 + i, url: "/x", image: null }]));

describe("System-Landingpages", () => {
  it("hat fünf Seiten mit den sechs Aufbau-Schritten in fester Reihenfolge und Quellen", () => {
    expect(CATEGORY_LANDING_PAGES.map((p) => p.key)).toEqual(["fachboden", "buero", "paletten", "kragarm", "weitspann"]);
    for (const p of CATEGORY_LANDING_PAGES) {
      expect(p.guide.steps.map((s) => s.key), p.key).toEqual([...BUILD_STEP_KEYS]);
      for (const s of p.guide.steps) expect(s.src.trim(), `${p.key}/${s.key}`).not.toBe("");
      for (const k of Object.keys(p.notes)) expect(p.notes[k as keyof typeof p.notes]?.src?.trim(), `${p.key}/${k}`).toBeTruthy();
      expect(p.facts, p.key).toHaveLength(4);
      expect(new Set(p.productNumbers).size, p.key).toBe(p.productNumbers.length);
    }
  });

  // Fängt erfundene Zahlen; ob eine Zahl im richtigen Zusammenhang steht, bleibt Sache des Gegenlesens
  it("verwendet nur Zahlen aus Katalog und Sicherheitshinweisen", () => {
    const factTexts = [
      ...GENERAL_CATALOG_FACTS.map((f) => f.text),
      ...SAFETY_FACTS.map((f) => f.text),
      ...CATALOG_SYSTEMS.flatMap((s) => [...s.facts.map((f) => f.text), ...(s.spans?.rows.flat() ?? [])]),
    ].join(" ");
    const numbers = (s: string) => (s.match(/\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?/g) ?? []).filter((n) => !/^[0-9]$/.test(n));
    const known = new Set([...numbers(factTexts), "14"]); // § 14 BetrSichV
    const unknown: string[] = [];
    for (const p of CATEGORY_LANDING_PAGES) for (const t of pageTexts(p)) for (const n of numbers(t)) if (!known.has(n)) unknown.push(`${p.key}: ${n} in „${t.slice(0, 70)}“`);
    expect(unknown).toEqual([]);
  });

  it("nennt keine Wettbewerber, kein „Schwerlastregal“, keine Garantie und keine zurückgezogene DGUV-Regel", () => {
    const competitor = new RegExp(`\\b(${COMPETITOR_NAMES.join("|")})\\b`, "i");
    for (const p of CATEGORY_LANDING_PAGES)
      for (const t of pageTexts(p)) {
        expect(t, t).not.toMatch(competitor);
        expect(t, t).not.toMatch(/Schwerlast|SPLIT|108-007|Garantie|Stecksystem/i);
      }
    // Arnsberg nennt der Katalog nur für CLIP, FIX, MINI-RACK, SPEED-RACK und MULTIPAL (S. 11)
    for (const k of ["buero", "kragarm"]) expect(pageTexts(page(k)).join(" "), k).not.toMatch(/Arnsberg/);
  });

  it("rechnet die Beispiele nach den Katalog-Planmaßen", () => {
    const fig = (k: string) => rowFigures(page(k).guide.example.row);
    // CLIP S. 25/26
    expect([fig("fachboden").baseLen, fig("fachboden").addOnLen, fig("fachboden").length]).toEqual([1082, 1041, 3164]);
    expect(fig("fachboden").secondary?.total).toBe(3068);
    // COMPACT S. 100/101
    expect([fig("buero").length, fig("buero").units, fig("buero").anchor]).toEqual([3068, 216, true]);
    // MULTIPAL S. 128/131/134
    expect([fig("paletten").baseLen, fig("paletten").addOnLen, fig("paletten").length, fig("paletten").units, fig("paletten").anchors, fig("paletten").sumLoad]).toEqual([2870, 2785, 11225, 36, 20, 5940]);
    // MULTISTRONG LIGHT S. 162
    expect([fig("kragarm").baseLen, fig("kragarm").length, fig("kragarm").sumLoad, fig("kragarm").anchor]).toEqual([1094, 3154, 875, false]);
    // MINI-RACK S. 114
    expect([fig("weitspann").baseLen, fig("weitspann").length, fig("weitspann").anchor]).toEqual([1907, 7460, false]);
    for (const p of CATEGORY_LANDING_PAGES) {
      const f = rowFigures(p.guide.example.row);
      expect([f.fits, f.loadOk, f.itemOk], p.key).toEqual([true, true, true]);
      // Beispielzeile = 1 Grundregal + (Felder − 1) Anbauregale
      const regale = p.guide.example.lines.filter((l) => /Grundregal|Anbauregal/.test(l.label) && !/Wandbefestigung/.test(l.label));
      expect(regale.reduce((s, l) => s + l.qty, 0), p.key).toBe(p.guide.example.row.fields);
      expect(p.guide.example.configuratorHref, p.key).toContain(`laenge=${p.guide.example.row.space}`);
      expect(() => [fillExample(p.guide.example.title, p.guide.example), fillExample(p.guide.example.sub, p.guide.example), exampleTexts(p.guide.example)], p.key).not.toThrow();
    }
    expect(exampleTexts(page("fachboden").guide.example).zeile).toContain("1.082 + 2 × 1.041 = 3.164 mm bis zu den Fußplatten – passt");
    expect(exampleTexts(page("paletten").guide.example).zeile).toContain("36 Europalettenplätze");
  });

  it("verweist nur auf vorhandene Lexikon-Begriffe, Vergleiche und Maßtabellen", () => {
    for (const p of CATEGORY_LANDING_PAGES) {
      for (const t of [...p.guide.steps.map((s) => s.text), ...p.guide.avoid, ...p.guide.operation, ...p.seo.paragraphs]) expect(() => landingTextHtml(t), t).not.toThrow();
      for (const k of p.systems.comparisons) expect(GLOSSARY_COMPARISONS.some((c) => c.key === k) || p.systems.extraComparisons?.some((c) => c.key === k), k).toBe(true);
      expect(catalogSpans(p).length, p.key).toBe(p.catalogSystems.length);
    }
    expect(landingTextHtml("Die [[feldlast]] & [[fachlast|Last]]")).toBe('Die <a class="lex" href="/regal-lexikon#feldlast">Feldlast</a> &amp; <a class="lex" href="/regal-lexikon#fachlast">Last</a>');
    expect(() => landingTextHtml("[[gibtsnicht]]")).toThrow();
  });

  it("baut alle Abschnitte, Zeichnung und ein Warenkorb-Formular mit allen Beispielartikeln", () => {
    for (const p of CATEGORY_LANDING_PAGES) {
      const h = new CategoryLandingHtml(p, products(p), { notes: false, cartForm: true });
      const html = [h.hero(), h.jump(), h.systems(), h.tiles(), h.guide(), h.plan(), h.productsHead(), h.productCards(), h.seo(), h.faqHead(), h.advice()].join("\n");
      for (const id of ["ausfuehrung", "sortiment", "aufbau", "masse", "produkte"]) expect(html, `${p.key}/${id}`).toContain(`id="${id}"`);
      for (const l of p.guide.example.lines) expect(html).toContain(`[quantity]" value="${l.qty}"`);
      expect(html).not.toContain('class="note"');
      const f = rowFigures(p.guide.example.row);
      expect(rowDrawingSvg(p.guide.example.row, p.guide.parts), p.key).toContain(`${f.length.toLocaleString("de-DE")} mm ${p.guide.example.row.length.label}`);
    }
    expect(categoryLandingCss(".mbp")).toContain(".mbp .steps");
  });
});
