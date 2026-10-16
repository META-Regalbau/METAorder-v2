import { describe, expect, it } from "vitest";
import { INDUSTRY_PAGES, fillPrices, formatEuro, referencedNumbers } from "../../server/products/industryPages";
import { COMPETITOR_NAMES } from "../../server/products/productMetaTexts";

const allText = (p: (typeof INDUSTRY_PAGES)[number]) => JSON.stringify({ ...p, notes: undefined });

describe("industryPages", () => {
  it("hat eindeutige Schlüssel und URLs unter /branchen/", () => {
    expect(new Set(INDUSTRY_PAGES.map((p) => p.key)).size).toBe(INDUSTRY_PAGES.length);
    expect(new Set(INDUSTRY_PAGES.map((p) => p.url)).size).toBe(INDUSTRY_PAGES.length);
    for (const p of INDUSTRY_PAGES) expect(p.url).toMatch(/^\/branchen\/[a-z0-9-]+$/);
  });

  it("hält die Längen für Suchergebnisse ein", () => {
    for (const p of INDUSTRY_PAGES) {
      expect(p.metaTitle.length, p.key).toBeLessThanOrEqual(60);
      expect(p.metaDescription.length, p.key).toBeLessThanOrEqual(160);
    }
  });

  it("nennt keine Wettbewerber und keine zurückgezogene DGUV-Regel", () => {
    const competitor = new RegExp(`\\b(${COMPETITOR_NAMES.join("|")})\\b`, "i");
    for (const p of INDUSTRY_PAGES) {
      expect(allText(p), p.key).not.toMatch(competitor);
      expect(allText(p), p.key).not.toMatch(/108-007/);
    }
  });

  it("schreibt keine Preise als Text, nur als Artikelverweis", () => {
    for (const p of INDUSTRY_PAGES) expect(allText(p).replace(/\{p:[0-9A-Z-]+\}/g, ""), p.key).not.toMatch(/\d\s*€/);
  });

  it("hat je Seite 6 Lagerbereiche, 8 Produkte und eine Beispielrechnung", () => {
    for (const p of INDUSTRY_PAGES) {
      expect(p.areas, p.key).toHaveLength(6);
      expect(p.products, p.key).toHaveLength(8);
      expect(p.planning.example?.lines.length, p.key).toBeGreaterThan(0);
    }
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
});
