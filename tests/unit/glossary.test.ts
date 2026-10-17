import { describe, expect, it } from "vitest";
import {
  GLOSSARY_COMPARISONS,
  GLOSSARY_EXTRA_FACTS,
  GLOSSARY_GUIDE,
  GLOSSARY_PAGE,
  GLOSSARY_PRICE_CLAIMS,
  GLOSSARY_TERMS,
  GLOSSARY_TOPICS,
  checkGlossaryPriceClaims,
  glossaryLetter,
  glossaryPlain,
  glossaryRefs,
  sortedGlossaryTerms,
} from "../../server/products/glossary";
import { glossaryJsonLd, glossaryShopHtml, glossaryTextHtml } from "../../server/products/glossaryPageHtml";
import { CATALOG_SYSTEMS, GENERAL_CATALOG_FACTS } from "../../server/products/catalogFacts";
import { COMPETITOR_NAMES } from "../../shared/competitorNames";

/** Alle sichtbaren Texte des Lexikons */
function allTexts(): string[] {
  return [
    GLOSSARY_PAGE.h1,
    GLOSSARY_PAGE.lead,
    GLOSSARY_PAGE.metaDescription,
    ...GLOSSARY_TERMS.flatMap((t) => [t.term, t.text, t.example ?? "", t.link?.label ?? "", ...(t.aliases ?? [])]),
    ...GLOSSARY_COMPARISONS.flatMap((c) => [c.title, c.question, c.intro, ...c.sides.flatMap((s) => [s.name, ...s.plus, ...s.minus, s.fit])]),
    ...GLOSSARY_GUIDE.flatMap((g) => [g.title, g.system, g.text]),
  ].map(glossaryPlain);
}

const internalLinks = () => [
  ...GLOSSARY_TERMS.flatMap((t) => (t.link ? [t.link.href] : [])),
  ...GLOSSARY_COMPARISONS.flatMap((c) => c.sides.flatMap((s) => (s.link ? [s.link.href] : []))),
  ...GLOSSARY_GUIDE.flatMap((g) => g.links.map((l) => l.href)),
];

describe("glossary", () => {
  it("hat eindeutige Schlüssel, Themen und Quellen", () => {
    const keys = GLOSSARY_TERMS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(GLOSSARY_COMPARISONS.map((c) => c.key)).size).toBe(GLOSSARY_COMPARISONS.length);
    const topics = new Set(GLOSSARY_TOPICS.map((t) => t.key));
    for (const t of GLOSSARY_TERMS) {
      expect(t.key, t.term).toMatch(/^[a-z0-9-]+$/);
      expect(topics.has(t.topic), t.key).toBe(true);
      expect(t.src.trim(), t.key).not.toBe("");
    }
    for (const c of GLOSSARY_COMPARISONS) {
      expect(c.src.trim(), c.key).not.toBe("");
      for (const s of c.sides) {
        expect(s.plus.length, `${c.key}/${s.name}`).toBeGreaterThan(0);
        expect(s.fit, `${c.key}/${s.name}`).toMatch(/\.$/);
      }
    }
    expect(GLOSSARY_TERMS.length).toBeGreaterThan(70); // Meta-Beschreibung: „über 70 Fachbegriffe“
  });

  it("verweist nur auf vorhandene Begriffe und Anker", () => {
    const keys = new Set(GLOSSARY_TERMS.map((t) => t.key));
    const anchors = new Set([...keys, ...GLOSSARY_COMPARISONS.map((c) => `vergleich-${c.key}`), "wegweiser", "vergleiche", "begriffe", "beratung"]);
    for (const t of GLOSSARY_TERMS) for (const r of glossaryRefs(`${t.text} ${t.example ?? ""}`)) expect(keys.has(r), `${t.key} → ${r}`).toBe(true);
    for (const href of internalLinks()) {
      expect(href, href).toMatch(/^(\/[a-z0-9/._?=&-]*|#[a-z0-9-]+)$/);
      if (href.startsWith("#")) expect(anchors.has(href.slice(1)), href).toBe(true);
    }
  });

  it("nennt keine Wettbewerber und kein „Schwerlastregal“", () => {
    const competitor = new RegExp(`\\b(${COMPETITOR_NAMES.join("|")})\\b`, "i");
    for (const text of allTexts()) {
      expect(text, text).not.toMatch(competitor);
      // Offen bei META: Definition Schwerlastregal, CLIP SPLIT, Lebensmittel-Eignung, DGUV 108-007 (zurückgezogen)
      expect(text, text).not.toMatch(/Schwerlast|SPLIT|Lebensmittel|108-007/i);
    }
  });

  // Fängt erfundene Zahlen; ob eine Zahl im richtigen Zusammenhang steht, bleibt Sache des Gegenlesens
  it("verwendet nur Zahlen aus den Katalogfakten", () => {
    const factTexts = [
      ...GENERAL_CATALOG_FACTS.map((f) => f.text),
      ...CATALOG_SYSTEMS.flatMap((s) => [...s.facts.map((f) => f.text), ...(s.spans?.rows.flat() ?? [])]),
      ...GLOSSARY_EXTRA_FACTS.map((f) => f.text),
    ].join(" ");
    const numbers = (s: string) => (s.match(/\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?/g) ?? []).filter((n) => !/^[0-9]$/.test(n));
    const known = new Set(numbers(factTexts));
    const unknown = new Set<string>();
    for (const text of allTexts()) for (const n of numbers(text)) if (!known.has(n)) unknown.add(`${n} in „${text.slice(0, 80)}“`);
    expect([...unknown]).toEqual([]);
  });

  it("prüft Preisaussagen über gleiche Namen", () => {
    const s3 = GLOSSARY_PRICE_CLAIMS.find((c) => c.comparison === "s3-geclincht")!;
    const a = "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 150 kg | 5 Ebenen | verzinkt";
    const b = "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 150 kg | 5 Ebenen | verzinkt";
    expect(s3.cheaper.test(a) && s3.dearer.test(b)).toBe(true);
    expect(s3.cheaper.test(a.replace("| verzinkt", "| Längsriegel | verzinkt"))).toBe(false);
    expect(s3.key(a)).toBe(s3.key(b));
    const ms = GLOSSARY_PRICE_CLAIMS.find((c) => c.comparison === "light-medium")!;
    expect(ms.key("META MULTISTRONG L | Kragarmregal | Grundregal | 2000 x 1000 x 400 mm | Armlast 220 kg | einseitig | 4+1 Ebenen")).toBe(
      ms.key("META MULTISTRONG M | Kragarmregal | Grundregal | 2000 x 1000 x 400 mm | Armlast 535 kg | einseitig | 4+1 Ebenen"),
    );
    for (const c of GLOSSARY_PRICE_CLAIMS) expect(GLOSSARY_COMPARISONS.some((x) => x.key === c.comparison), c.comparison).toBe(true);
  });

  it("sortiert deutsch und ordnet Umlaute dem Grundbuchstaben zu", () => {
    const sorted = sortedGlossaryTerms().map((t) => t.term);
    expect(sorted.indexOf("Abdeckboden")).toBeLessThan(sorted.indexOf("Achsmaß"));
    expect(glossaryLetter("Übersicht")).toBe("U");
  });

  it("baut Ankerlinks und escaped Text", () => {
    expect(glossaryTextHtml("Siehe [[feldlast]] & [[fachlast|Fach]]")).toBe('Siehe <a class="ref" href="#feldlast">Feldlast</a> &amp; <a class="ref" href="#fachlast">Fach</a>');
  });

  it("erzeugt Shop-HTML mit allen Ankern und gültigen strukturierten Daten", () => {
    const o = { pageUrl: "https://shop.meta-online.com/regal-lexikon" };
    const html = glossaryShopHtml(o);
    for (const t of GLOSSARY_TERMS) expect(html).toContain(`id="${t.key}"`);
    for (const c of GLOSSARY_COMPARISONS) expect(html).toContain(`id="vergleich-${c.key}"`);
    expect(html).toContain("<style>.mlx");
    const ld = [...glossaryJsonLd(o).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    expect(ld.map((x) => x["@type"])).toEqual(["DefinedTermSet", "FAQPage"]);
    expect(ld[0].hasDefinedTerm).toHaveLength(GLOSSARY_TERMS.length);
    expect(ld[1].mainEntity).toHaveLength(GLOSSARY_COMPARISONS.length);
    expect(html.length).toBeLessThan(250_000);
  });
});

describe("checkGlossaryPriceClaims", () => {
  it("zählt Paare und meldet Ausreißer", () => {
    const base = "Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 150 kg | 5 Ebenen";
    const r = checkGlossaryPriceClaims([
      { name: `META CLIP S3 | ${base} | verzinkt`, priceNet: 235 },
      { name: `META CLIP | ${base} | verzinkt`, priceNet: 274 },
      { name: `META CLIP S3 | ${base} | RAL 7035`, priceNet: 320 },
      { name: `META CLIP | ${base} | RAL 7035`, priceNet: 311 },
    ]);
    const s3 = r.find((x) => x.claim.comparison === "s3-geclincht")!;
    expect([s3.pairs, s3.holds, s3.violations.length]).toEqual([2, 1, 1]);
    const zink = r.find((x) => x.claim.comparison === "verzinkt-lichtgrau")!;
    expect([zink.pairs, zink.holds]).toEqual([2, 2]);
  });
});
