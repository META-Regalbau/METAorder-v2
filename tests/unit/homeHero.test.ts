import { describe, expect, it } from "vitest";
import { HOME_HERO, HOME_HERO_MARKER, demoteH1, homeHeroHtml } from "../../server/products/homeHero";
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

  it("trägt die H1 der Startseite (Regale für Lager, Betrieb und Industrie)", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(">Regale für Lager, Betrieb und Industrie</h1>");
    expect(html).not.toMatch(/<h2/);
  });

  it("macht aus der bisherigen H1 eine H2 und lässt andere Überschriften stehen", () => {
    expect(demoteH1('<h1 class="x">META Regalsysteme</h1><p>Text</p><h2>Weiter</h2>')).toBe('<h2 class="x">META Regalsysteme</h2><p>Text</p><h2>Weiter</h2>');
    expect(demoteH1("<H1>A</H1><header>B</header>")).toBe("<h2>A</h2><header>B</header>");
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
      expect(rule.startsWith(".mbp") || rule.startsWith(".cms-block-container-row") || rule.startsWith(".cms-section-default.boxed .mbp"), rule).toBe(true);
    }
    const noImage = homeHeroHtml(null);
    expect(noImage).not.toContain("<img");
    expect(noImage).toContain(HOME_HERO.title);
  });
});
