import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/storage", () => ({
  storage: {
    getAllTenants: vi.fn(async () => [{ id: "t-live" }, { id: "t-test" }, { id: "t-none" }]),
    getShopwareSettings: vi.fn(async (id: string) =>
      id === "t-live" ? { shopwareUrl: "https://shop.meta-online.com/" } : id === "t-test" ? { shopwareUrl: "https://test.meta.wirduzen.dev" } : undefined,
    ),
  },
}));

import { parseConfigCode } from "../../client/src/lib/metaClipCpq";
import { EMBEDDABLE_PATH_RE, embedFrameAncestors, normalizeOrigin, resetEmbedCache, resolveGuestTenantForShop } from "../../server/cpq/cpqEmbed";

// Das Storefront-Skript ist reines Browser-JS ohne Module; ohne window liefert es nur die reinen Helfer.
const source = readFileSync(path.resolve(import.meta.dirname, "../../shopware/storefront-snippets/regalplaner.js"), "utf8");
const context: Record<string, any> = { URL };
vm.runInNewContext(source, context);
const rp = context.MetaRegalplaner;
const ID = "0123456789abcdef0123456789abcdef";

describe("Regalplaner-Baustein im Shop", () => {
  it("bettet METAorder nur über https ein (http nur localhost)", () => {
    expect(rp.appOrigin("https://metaorder.example.com/pfad")).toBe("https://metaorder.example.com");
    expect(rp.appOrigin("http://localhost:5001")).toBe("http://localhost:5001");
    expect(rp.appOrigin("http://metaorder.example.com")).toBeNull();
    expect(rp.appOrigin("javascript:alert(1)")).toBeNull();
  });

  it("meldet den verdeckten Teil des Rahmens oben (Scrollen und mitlaufende Kopfzeile)", () => {
    expect(rp.hiddenTop(300, 0)).toBe(0);
    expect(rp.hiddenTop(-450, 0)).toBe(450);
    expect(rp.hiddenTop(-450, 120)).toBe(570);
    expect(rp.hiddenTop(50, 120)).toBe(70);
  });

  it("nimmt nur gültige Positionen in den Warenkorb und fasst gleiche Artikel zusammen", () => {
    expect(rp.cartPositions({ items: [{ id: ID, quantity: 3 }, { id: ID, quantity: 2 }] })).toEqual([{ id: ID, qty: 5 }]);
    expect(rp.cartPositions({ items: [{ id: "x", quantity: 1 }] })).toBeNull();
    expect(rp.cartPositions({ items: [{ id: ID, quantity: 1.5 }] })).toBeNull();
    expect(rp.cartPositions({ items: [{ id: ID, quantity: 0 }] })).toBeNull();
    expect(rp.cartPositions({ items: [{ id: ID, quantity: 1000 }] })).toBeNull();
    expect(rp.cartPositions({ items: [] })).toBeNull();
  });

  it("liest die Maße einer CLIP-Produktseite als Konfigurations-Code (Grundregal 1 Feld, Anbauregal 2)", () => {
    const anbau = rp.productConfigCode("META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1500 x 600 mm | Fachlast 200 kg | 4 Ebenen | verzinkt");
    expect(anbau).toBe("CLIP-S3-2000-1500-600-2F4-200-V-NR");
    expect(parseConfigCode(anbau)).toEqual({ rahmen: "s3", hoehe: 2000, breite: 1500, tiefe: 600, felder: 2, boeden: 4, last: 200, surface: "verzinkt", rear: false });
    expect(rp.productConfigCode("META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 300 mm | Fachlast 230 kg | 5 Ebenen | RAL 7035"))
      .toBe("CLIP-2000-1000-300-1F5-230-L-NR");
    expect(rp.productConfigCode("META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1000 x 600 mm | Fachlast 230 kg | 5 Ebenen | Längsriegel | verzinkt"))
      .toBe("CLIP-S3-2000-1000-600-2F5-230-V-NR");
  });

  it("zeigt den Knopf nicht bei Artikeln, die der Planer nicht abbildet", () => {
    expect(rp.productConfigCode("META CLIP | Fachbodenregal | Anbauregal | 2500 x 1000 x 400 mm | Fachlast 150 kg | 6 Ebenen | RAL 9005")).toBeNull();
    expect(rp.productConfigCode("META CLIP SET | Fachbodenregal | Anbauregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 4 Ebenen | verzinkt")).toBeNull();
    expect(rp.productConfigCode("META CLIP | Fachbodenregal | Doppel-Grundregal | 2000 x 1000 x 600 mm | Fachlast 230 kg | 5 Ebenen | verzinkt")).toBeNull();
    expect(rp.productConfigCode("META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 600 mm | Fachlast 230 kg | 5 Ebenen | doppelseitig | verzinkt")).toBeNull();
    expect(rp.productConfigCode("META MULTIPAL | Palettenregal | Grundregal | 3000 x 2700 x 1100 mm | verzinkt")).toBeNull();
    expect(rp.productConfigCode("")).toBeNull();
  });
});

describe("Regalplaner in METAorder: Einbetten und Gast-Mandant", () => {
  beforeEach(() => {
    resetEmbedCache();
    delete process.env.CPQ_EMBED_ORIGINS;
  });

  it("erlaubt das Einbetten nur für die Gast-Seite", () => {
    expect(EMBEDDABLE_PATH_RE.test("/regalplaner")).toBe(true);
    expect(EMBEDDABLE_PATH_RE.test("/regalplaner/")).toBe(true);
    expect(EMBEDDABLE_PATH_RE.test("/konfigurator/abc")).toBe(false);
    expect(EMBEDDABLE_PATH_RE.test("/regalplaner/admin")).toBe(false);
  });

  it("leitet frame-ancestors und Mandant aus den Shop-Adressen ab", async () => {
    expect(await embedFrameAncestors()).toEqual(["https://shop.meta-online.com", "https://test.meta.wirduzen.dev"]);
    expect(await resolveGuestTenantForShop("https://shop.meta-online.com")).toBe("t-live");
    expect(await resolveGuestTenantForShop("https://test.meta.wirduzen.dev/regalplaner")).toBe("t-test");
    expect(await resolveGuestTenantForShop("https://evil.example.com")).toBeNull();
    expect(await resolveGuestTenantForShop("kein-url")).toBeNull();
  });

  it("nimmt zusätzliche Shop-Domains aus CPQ_EMBED_ORIGINS", async () => {
    process.env.CPQ_EMBED_ORIGINS = "https://www.meta-regalbau.de=t-live, https://nur-einbetten.example.com";
    expect(await resolveGuestTenantForShop("https://www.meta-regalbau.de")).toBe("t-live");
    expect(await resolveGuestTenantForShop("https://nur-einbetten.example.com")).toBeNull();
    expect(await embedFrameAncestors()).toContain("https://nur-einbetten.example.com");
    expect(normalizeOrigin("ftp://x")).toBeNull();
  });
});
