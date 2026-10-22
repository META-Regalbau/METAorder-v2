import { describe, expect, it } from "vitest";
import { HOME_HERO, HOME_HERO_MARKER, homeHeroHtml } from "../../server/products/homeHero";
import { CONTACT } from "../../server/products/industryPages";
import { COMPETITOR_NAMES } from "../../shared/competitorNames";

const html = homeHeroHtml("https://shop.example/media/slider.webp");
const text = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
const hrefs = (h: string) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("homeHero", () => {
  it("führt zu Konfigurator, Telefon-Beratung und allen Regalarten des Hauptmenüs", () => {
    const links = hrefs(html);
    expect(links[0]).toBe("/regal-schnellkonfigurator");
    expect(links).toContain(`tel:${CONTACT.tel}`);
    for (const path of ["/fachbodenregale/", "/palettenregale/", "/kragarmregale/", "/weitspannregale/", "/bueroregale", "/zubehoer"]) expect(links).toContain(path);
    // nur Adressen im eigenen Shop
    expect(links.filter((l) => !l.startsWith("tel:")).every((l) => l.startsWith("/"))).toBe(true);
  });

  it("enthält nur eine Überschrift zweiter Ordnung (die H1 der Startseite bleibt unverändert)", () => {
    expect(html).not.toMatch(/<h1/);
    expect(html.match(/<h2/g)).toHaveLength(1);
  });

  it("verspricht nichts Unbelegtes und nennt keine Wettbewerber", () => {
    const t = text(html);
    expect(t).not.toMatch(/kostenlos|gratis|Garantie|sofort lieferbar|günstigste|\d+\s*%/i);
    expect(t).not.toMatch(new RegExp(`\\b(${COMPETITOR_NAMES.join("|")})\\b`, "i"));
    expect(t).toContain(HOME_HERO.primary.label);
  });

  it("markiert die eigene Fassung, begrenzt das Stylesheet auf den Rahmen und kommt ohne Bild aus", () => {
    expect(html).toContain(HOME_HERO_MARKER);
    const css = html.match(/<style>([\s\S]*?)<\/style>/)![1];
    for (const rule of css.split("\n").filter((l) => l.includes("{") && !l.startsWith("@media") && !l.startsWith("/*"))) {
      expect(rule.startsWith(".mbp") || rule.startsWith(".cms-block-container-row"), rule).toBe(true);
    }
    const noImage = homeHeroHtml(null);
    expect(noImage).not.toContain("<img");
    expect(noImage).toContain(HOME_HERO.title);
  });
});
