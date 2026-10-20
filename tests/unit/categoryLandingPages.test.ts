import { describe, expect, it } from "vitest";
import {
  BUILD_STEP_KEYS,
  CATEGORY_LANDING_PAGES,
  catalogSpans,
  exampleTexts,
  landingProductNumbers,
  rowFigures,
  type CategoryLandingPage,
} from "../../server/products/categoryLandingPages";
import { CategoryLandingHtml, categoryLandingCss, landingPlain, landingTextHtml, rowDrawingSvg } from "../../server/products/categoryLandingPageHtml";
import { CATALOG_SYSTEMS, GENERAL_CATALOG_FACTS, SAFETY_FACTS } from "../../server/products/catalogFacts";
import { GLOSSARY_COMPARISONS } from "../../server/products/glossary";
import { COMPETITOR_NAMES } from "../../shared/competitorNames";

/** Alle von Hand geschriebenen Texte einer Seite (ohne Rechenbeispiel, das wird errechnet) */
function pageTexts(p: CategoryLandingPage): string[] {
  return [
    p.eyebrow,
    p.h1,
    p.lead,
    ...p.proof,
    ...p.facts.flatMap((f) => [f.value, f.label]),
    p.systems.title,
    p.systems.intro,
    ...p.tiles.flatMap((t) => [t.label, t.text]),
    p.guide.title,
    p.guide.intro,
    ...p.guide.steps.flatMap((s) => [s.title, s.text]),
    ...p.guide.drawing.parts,
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
  Object.fromEntries(landingProductNumbers(p).map((n, i) => [n, { id: `id${i}`, name: `META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 150 kg`, priceNet: 100 + i, url: "/x", image: null }]));

describe("System-Landingpages", () => {
  it("hat auf jeder Seite die sechs Aufbau-Schritte in fester Reihenfolge mit Quelle", () => {
    for (const p of CATEGORY_LANDING_PAGES) {
      expect(p.guide.steps.map((s) => s.key), p.key).toEqual([...BUILD_STEP_KEYS]);
      for (const s of p.guide.steps) expect(s.src.trim(), `${p.key}/${s.key}`).not.toBe("");
      for (const k of Object.keys(p.notes)) expect(p.notes[k as keyof typeof p.notes]?.src?.trim(), `${p.key}/${k}`).toBeTruthy();
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

  it("nennt keine Wettbewerber, kein „Schwerlastregal“ und keine zurückgezogene DGUV-Regel", () => {
    const competitor = new RegExp(`\\b(${COMPETITOR_NAMES.join("|")})\\b`, "i");
    for (const p of CATEGORY_LANDING_PAGES)
      for (const t of pageTexts(p)) {
        expect(t, t).not.toMatch(competitor);
        expect(t, t).not.toMatch(/Schwerlast|SPLIT|108-007|Garantie/i);
      }
  });

  it("rechnet das Beispiel nach den Katalog-Planmaßen (CLIP S. 25/26)", () => {
    const fach = CATEGORY_LANDING_PAGES.find((p) => p.key === "fachboden")!;
    const f = rowFigures(fach.guide.example.row);
    expect([f.footBase, f.footAddOn, f.footLength]).toEqual([1082, 1041, 3164]);
    expect([f.planBase, f.planAddOn, f.planLength]).toEqual([1056, 1006, 3068]);
    expect([f.frames, f.sumLoad, f.fits, f.loadOk, f.anchor]).toEqual([4, 750, true, true, true]);
    const ex = exampleTexts(fach.guide.example.row);
    expect(ex.zeile).toContain("1.082 + 2 × 1.041 = 3.164 mm");
    expect(ex.kippen).toContain("mehr als 4 : 1");
    // Beispielzeile = 1 Grundregal + (Felder − 1) Anbauregale
    const regale = fach.guide.example.lines.filter((l) => /Grundregal|Anbauregal/.test(l.label) && !/Wandbefestigung/.test(l.label));
    expect(regale.reduce((s, l) => s + l.qty, 0)).toBe(fach.guide.example.row.fields);
    // Systemwerte im Kopf passen zur Maßtabelle
    expect(catalogSpans(fach).rows.map((r) => r[1]).join(" ")).toContain("330 kg");
    expect(fach.guide.example.configuratorHref).toContain(`laenge=${fach.guide.example.row.space}`);
  });

  it("verweist nur auf vorhandene Lexikon-Begriffe und Vergleiche", () => {
    for (const p of CATEGORY_LANDING_PAGES) {
      for (const t of [...p.guide.steps.map((s) => s.text), ...p.guide.avoid, ...p.guide.operation, ...p.seo.paragraphs]) expect(() => landingTextHtml(t)).not.toThrow();
      for (const k of p.systems.comparisons) expect(GLOSSARY_COMPARISONS.some((c) => c.key === k), k).toBe(true);
    }
    expect(landingTextHtml("Die [[feldlast]] & [[fachlast|Last]]")).toBe('Die <a class="lex" href="/regal-lexikon#feldlast">Feldlast</a> &amp; <a class="lex" href="/regal-lexikon#fachlast">Last</a>');
    expect(() => landingTextHtml("[[gibtsnicht]]")).toThrow();
  });

  it("baut alle Abschnitte und ein Warenkorb-Formular mit allen Beispielartikeln", () => {
    for (const p of CATEGORY_LANDING_PAGES) {
      const h = new CategoryLandingHtml(p, products(p), { notes: false, cartForm: true });
      const html = [h.hero(), h.jump(), h.systems(), h.tiles(), h.guide(), h.plan(), h.productsHead(), h.seo(), h.faqHead(), h.advice()].join("\n");
      for (const id of ["ausfuehrung", "sortiment", "aufbau", "masse", "produkte"]) expect(html, id).toContain(`id="${id}"`);
      for (const l of p.guide.example.lines) expect(html).toContain(`[quantity]" value="${l.qty}"`);
      expect(html).not.toContain('class="note"');
      expect(rowDrawingSvg(p.guide.example.row, p.guide.drawing.parts, p.guide.drawing.bracing)).toContain(`${rowFigures(p.guide.example.row).footLength.toLocaleString("de-DE")} mm bis zu den Fußplatten`);
    }
    expect(categoryLandingCss(".mbp")).toContain(".mbp .steps");
  });
});
