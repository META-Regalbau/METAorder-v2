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
