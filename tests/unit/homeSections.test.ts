import { describe, expect, it } from "vitest";
import { HOME_SECTION_MARKERS, MONDU, RABATT, monduSectionHtml, rabattSectionHtml } from "../../server/products/homeSections";

const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

describe("homeSections", () => {
  it("enthält keine unbelegten Versprechen der alten Fassungen", () => {
    for (const html of [rabattSectionHtml(), monduSectionHtml()]) {
      const t = text(html);
      expect(t).not.toMatch(/keine Bedingungen|100\s*%|versteckt|Liquidität|\bNeu\b|Alle registrierten/i);
    }
  });

  it("nennt die Rabattstaffel mit Warenwert-Grenzen und Bedingung Deutschland", () => {
    expect(RABATT.tiers.map((t) => t.pct)).toEqual(["5 %", "8 %", "10 %"]);
    expect(text(rabattSectionHtml())).toContain("Rechnungsadresse in Deutschland");
  });

  it("nennt nur die im DE-Shop aktiven Mondu-Zahlarten", () => {
    expect(MONDU.methods.map((m) => m.name)).toEqual(["Rechnungskauf", "SEPA-Lastschrift", "Ratenkauf", "Echtzeitüberweisung"]);
  });

  it("markiert die eigene Fassung und begrenzt das Stylesheet auf den Rahmen", () => {
    expect(rabattSectionHtml()).toContain(HOME_SECTION_MARKERS.rabatt.own);
    expect(monduSectionHtml()).toContain(HOME_SECTION_MARKERS.mondu.own);
    const css = monduSectionHtml().match(/<style>([\s\S]*?)<\/style>/)![1];
    for (const rule of css.split("\n").filter((l) => l.includes("{") && !l.startsWith("@media") && !l.startsWith("/*"))) {
      expect(rule.startsWith(".mbp") || rule.startsWith(".cms-block-container-row"), rule).toBe(true);
    }
  });
});
