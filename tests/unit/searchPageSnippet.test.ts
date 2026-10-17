import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";

// Das Storefront-Skript ist reines Browser-JS ohne Module; ohne window liefert es nur die reinen Helfer.
const source = readFileSync(path.resolve(import.meta.dirname, "../../shopware/storefront-snippets/search-page.js"), "utf8");
const context: Record<string, any> = {};
vm.runInNewContext(source, context);
type Topic = { keys: string[]; title: string; href: string; links: Array<{ label: string; href: string }> };
const { matchTopic, planFilters, normalize, config } = context.MetaSearchPage as {
  matchTopic: (query: string) => Topic | null;
  planFilters: (filters: Array<{ label: string; active: boolean }>) => boolean[];
  normalize: (text: string) => string;
  config: { salesChannelIds: string[]; topics: Topic[]; primaryFilters: string[]; systems: Array<{ href: string }> };
};
const filters = (...labels: string[]) => labels.map((label) => ({ label, active: false }));
const many = (n: number) => Array.from({ length: n }, (_, i) => `Eigenschaft ${i + 1}`);

describe("Suchergebnisseite (Storefront-Skript)", () => {
  it("normalisiert Umlaute, Großschreibung und Satzzeichen", () => {
    expect(normalize("  Büro-Regal  MINI-RACK ")).toBe(" buero regal mini rack ");
  });

  it("ordnet Suchbegriffe dem passenden Thema zu", () => {
    expect(matchTopic("Fachbodenregal")?.href).toBe("/fachbodenregale/");
    expect(matchTopic("fachbodenregall")?.href).toBe("/fachbodenregale/");
    expect(matchTopic("Europalette Regal")?.href).toBe("/palettenregale/");
    expect(matchTopic("Büroregal")?.href).toBe("/bueroregale");
    expect(matchTopic("Mini-Rack 2000")?.href).toBe("/weitspannregale/");
    expect(matchTopic("Reifenregal")?.href).toBe("/branchen/kfz-werkstatt-reifenhandel");
    expect(matchTopic("Kabeltrommelregal")?.href).toBe("/branchen/handwerk-werkstatt");
  });

  it("nimmt bei mehreren Begriffen den vorderen", () => {
    expect(matchTopic("clip palettenregal")?.href).toBe("/fachbodenregale/");
    expect(matchTopic("palettenregal clip")?.href).toBe("/palettenregale/");
  });

  it("zeigt keinen Hinweis ohne passendes Thema", () => {
    expect(matchTopic("rückwand")).toBeNull();
    expect(matchTopic("")).toBeNull();
  });

  it("lässt bis zu zehn Filter unverändert", () => {
    expect(planFilters(filters(...many(10))).every(Boolean)).toBe(true);
  });

  it("zeigt bei vielen Filtern nur Hauptfilter und Filter mit Auswahl", () => {
    const list = filters("Hersteller", "Regal-Typ", "Regal-System", ...many(20), "Breite", "Höhe", "Tiefe", "Fachlast", "Preis");
    list[5].active = true;
    const visible = planFilters(list);
    const shown = list.filter((_, i) => visible[i]).map((f) => f.label);
    expect(shown).toEqual(["Regal-Typ", "Regal-System", "Eigenschaft 3", "Breite", "Höhe", "Tiefe", "Fachlast", "Preis"]);
  });

  it("füllt auf, wenn kaum Hauptfilter vorkommen", () => {
    const visible = planFilters(filters("Preis", ...many(15)));
    expect(visible.filter(Boolean)).toHaveLength(8);
    expect(visible.slice(0, 8).every(Boolean)).toBe(true);
  });

  it("verlinkt nur Shop-Pfade und läuft nur im Onlineshop META Regalbau DE", () => {
    expect(config.salesChannelIds).toEqual(["018ec134507f703b82a76467791e7e61"]);
    const hrefs = [...config.topics.flatMap((t) => [t.href, ...t.links.map((l) => l.href)]), ...config.systems.map((s) => s.href)];
    for (const href of hrefs) expect(href).toMatch(/^\/[a-z0-9/-]*$/);
  });
});
