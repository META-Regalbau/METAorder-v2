import { describe, expect, it } from "vitest";
import { INDUSTRY_PAGES, fillPrices, formatEuro, referencedNumbers } from "../../server/products/industryPages";
import { checkIndustryPage } from "../../shared/shopContentRules";
import { IndustryPageHtml, homeTeaserHtml, industryPageCss, scopeCss } from "../../server/products/industryPageHtml";

describe("industryPages", () => {
  it("hat eindeutige Schlüssel und URLs unter /branchen/", () => {
    expect(new Set(INDUSTRY_PAGES.map((p) => p.key)).size).toBe(INDUSTRY_PAGES.length);
    expect(new Set(INDUSTRY_PAGES.map((p) => p.url)).size).toBe(INDUSTRY_PAGES.length);
    for (const p of INDUSTRY_PAGES) expect(p.url).toMatch(/^\/branchen\/[a-z0-9-]+$/);
  });

  it("besteht alle Prüfregeln der Pflegeoberfläche (shared/shopContentRules.ts)", () => {
    // Längen, Wettbewerber, DGUV 108-007, Preise nur als {p:…}, Beispielrechnung, Kennzahlen des abgebildeten Systems,
    // 6 Lagerbereiche, 8 Produkte, erlaubtes HTML, Links
    for (const p of INDUSTRY_PAGES) expect(checkIndustryPage(p, { pages: INDUSTRY_PAGES }), p.key).toEqual([]);
  });

  it("setzt Preise ein und bricht bei fehlenden Artikeln ab", () => {
    expect(fillPrices("ab {p:1}", () => 1172)).toBe("ab 1.172 €");
    expect(() => fillPrices("{p:2}", () => undefined)).toThrow(/2/);
    expect(formatEuro(237, true)).toBe("237,00 €");
    expect(formatEuro(48.583)).toBe("48,58 €");
  });

  it("sammelt alle Artikelnummern einer Seite", () => {
    const kfz = INDUSTRY_PAGES.find((p) => p.key === "kfz")!;
    const nums = referencedNumbers(kfz);
    expect(nums).toContain("4026212303186"); // Beispielrechnung
    expect(nums).toContain("4026212275650"); // Preistabelle
    expect(nums).toContain(kfz.hero.number);
  });

  it("begrenzt das Stylesheet im Shop auf den Seitenrahmen", () => {
    expect(scopeCss(":root{--a:1} .btn,h2{color:red} @media (max-width:10px){.x{top:0}}", ".mbp")).toBe(
      ".mbp{--a:1}\n.mbp .btn,.mbp h2{color:red}\n@media (max-width:10px){.mbp .x{top:0}}",
    );
    const css = industryPageCss(".mbp");
    // jede Regel ausserhalb von @media beginnt mit dem Rahmen (oder ist die Theme-Korrektur der Bootstrap-Zeile)
    for (const rule of css.split("\n").filter((l) => l.includes("{") && !l.startsWith("@media") && !l.startsWith("/*"))) {
      expect(rule.startsWith(".mbp") || rule.startsWith(".cms-block-container-row") || rule.startsWith(".cms-section-default.boxed .mbp"), rule).toBe(true);
    }
  });

  it("baut im Shop ein Warenkorb-Formular mit allen Positionen der Beispielrechnung", () => {
    const kfz = INDUSTRY_PAGES.find((p) => p.key === "kfz")!;
    const products = Object.fromEntries(referencedNumbers(kfz).map((n) => [n, { id: `id${n}`, name: n, priceNet: 10 }]));
    const html = new IndustryPageHtml(kfz, products, { notes: false, cartForm: true, linkHref: (t) => t }).planning();
    expect(html).toContain('action="/checkout/line-item/add"');
    expect(html).toContain('name="lineItems[id4026212328516][quantity]" value="5"');
    expect(html).not.toContain('class="note"');
  });

  it("verlinkt auf der Startseite alle Branchenseiten mit belegter Kennzahl und Beratung", () => {
    const products = Object.fromEntries(INDUSTRY_PAGES.map((p) => [p.hero.number, { name: p.hero.number, priceNet: 1, image: `https://x/${p.key}.webp` }]));
    const html = homeTeaserHtml(INDUSTRY_PAGES, products, (p) => p.url);
    for (const p of INDUSTRY_PAGES) {
      expect(html).toContain(`href="${p.url}"`);
      expect(html).toContain(p.teaser.fact.replace(/&/g, "&amp;"));
    }
    expect(html.match(/class="ht-tile"/g)).toHaveLength(INDUSTRY_PAGES.length);
    expect(html).toContain('href="tel:+4929329570"');
  });
});
