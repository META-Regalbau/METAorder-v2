/**
 * Shop-Puls Stufe 3 (S3-6): Google Merchant Center, nur lesend – Einrichtung (Schalter, Händler-ID,
 * Dienstkonto), Anmeldung per JWT und seitenweises Lesen mit **simulierter API**, Artikel auslesen (v1-Felder,
 * ältere Namen), Zuordnung über Artikelnummer bzw. EAN, abgelehnte Artikel (kritisch bei Topsellern), Preis und
 * Verfügbarkeit gegen den Shop, fehlende Topseller. Gegen ein echtes Merchant Center nicht getestet.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "crypto";

vi.mock("../../server/db", () => ({ db: {} }));

import { checkMerchantSetup, merchantAccount, toMerchantItem, type FetchFn, type MerchantItem } from "../../server/shopPulse/merchantClient";
import { matchItems, merchantDetections, merchantDetector } from "../../server/shopPulse/detectors/merchant";
import type { BuyabilityProduct } from "../../server/shopPulse/buyabilityData";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SA = JSON.stringify({ client_email: "shop-puls@test.iam.gserviceaccount.com", private_key: privateKey, token_uri: "https://oauth2.googleapis.com/token" });
const DE = "018ec134507f703b82a76467791e7e61";

describe("Einrichtung", () => {
  it("aus, ohne/ungültige Händler-ID, ohne/ungültiges Dienstkonto, bereit", () => {
    expect(checkMerchantSetup({ enabled: false, merchantId: "123456", serviceAccountJson: SA })).toEqual({ ok: false, reason: "disabled" });
    expect(checkMerchantSetup({ enabled: true, merchantId: "", serviceAccountJson: SA })).toEqual({ ok: false, reason: "noMerchant" });
    expect(checkMerchantSetup({ enabled: true, merchantId: "abc", serviceAccountJson: SA })).toEqual({ ok: false, reason: "invalidMerchant" });
    expect(checkMerchantSetup({ enabled: true, merchantId: "123456", serviceAccountJson: "" })).toEqual({ ok: false, reason: "noServiceAccount" });
    expect(checkMerchantSetup({ enabled: true, merchantId: "123456", serviceAccountJson: "{" })).toEqual({ ok: false, reason: "invalidServiceAccount" });
    expect(checkMerchantSetup({ enabled: true, merchantId: "123456", serviceAccountJson: SA })).toMatchObject({ ok: true, merchantId: "123456" });
  });
});

const apiProduct = (offerId: string, over: Record<string, unknown> = {}) => ({
  name: `accounts/123456/products/de~DE~${offerId}`,
  offerId,
  contentLanguage: "de",
  feedLabel: "DE",
  productAttributes: { title: `Artikel ${offerId}`, price: { amountMicros: "119000000", currencyCode: "EUR" }, availability: "IN_STOCK", gtins: [`EAN${offerId}`] },
  productStatus: { destinationStatuses: [{ reportingContext: "SHOPPING_ADS", approvedCountries: ["DE"] }], itemLevelIssues: [] },
  ...over,
});

describe("Anbindung (simulierte API)", () => {
  it("holt ein Token per JWT und liest alle Seiten", async () => {
    const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body, auth: init.headers.authorization });
      const json = url.includes("oauth2")
        ? { access_token: "tok", expires_in: 3600 }
        : url.includes("pageToken=p2")
          ? { products: [apiProduct("B")] }
          : { products: [apiProduct("A")], nextPageToken: "p2" };
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
    };
    const setup = checkMerchantSetup({ enabled: true, merchantId: "123456", serviceAccountJson: SA });
    if (!setup.ok) throw new Error("setup");
    const items = await merchantAccount(setup, fetchFn).products();
    expect(items.map((i) => i.offerId)).toEqual(["A", "B"]);
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    expect(calls[0].body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(calls[1]).toMatchObject({ method: "GET", auth: "Bearer tok", url: "https://merchantapi.googleapis.com/products/v1/accounts/123456/products?pageSize=1000" });
  });

  it("verständliche Fehler (Rechte)", async () => {
    const fetchFn: FetchFn = async (url) => (url.includes("oauth2") ? { ok: true, status: 200, json: async () => ({ access_token: "t" }), text: async () => "" } : { ok: false, status: 403, json: async () => ({}), text: async () => "denied" });
    const setup = checkMerchantSetup({ enabled: true, merchantId: "123456", serviceAccountJson: SA });
    if (!setup.ok) throw new Error("setup");
    await expect(merchantAccount(setup, fetchFn).products()).rejects.toThrow("keinen Zugriff");
  });

  it("Artikel auslesen: Preis aus Mikros, Verfügbarkeit klein, Ablehnung für Deutschland, ältere Feldnamen", () => {
    expect(toMerchantItem(apiProduct("A"))).toEqual({ offerId: "A", gtin: "EANA", title: "Artikel A", price: 119, currency: "EUR", availability: "in_stock", disapproved: false, issues: [] });
    const rejected = toMerchantItem(
      apiProduct("C", {
        productStatus: {
          destinationStatuses: [{ reportingContext: "SHOPPING_ADS", disapprovedCountries: ["DE"] }],
          itemLevelIssues: [
            { code: "image_link_broken", severity: "DISAPPROVED", description: "Ungültiges Bild", attribute: "image_link", applicableCountries: ["DE"] },
            { code: "x", severity: "NOT_IMPACTED", description: "egal" },
            { code: "y", severity: "DISAPPROVED", description: "nur AT", applicableCountries: ["AT"] },
          ],
        },
      }),
    );
    expect(rejected.disapproved).toBe(true);
    expect(rejected.issues).toEqual([{ code: "image_link_broken", severity: "DISAPPROVED", description: "Ungültiges Bild", attribute: "image_link" }]);
    expect(toMerchantItem({ offerId: "D", attributes: { title: "alt", price: { amountMicros: "5000000", currencyCode: "EUR" }, availability: "out of stock", gtin: "1" } })).toMatchObject({ price: 5, availability: "out_of_stock", gtin: "1" });
  });
});

const product = (productNumber: string, over: Partial<BuyabilityProduct> = {}): BuyabilityProduct => ({
  id: productNumber,
  productNumber,
  name: `Regal ${productNumber}`,
  active: true,
  salesChannelIds: [DE],
  priceGross: 119,
  stock: 10,
  deliveryTimeId: "d",
  restockTime: null,
  categoryCount: 1,
  isVariant: false,
  ...over,
});
const item = (offerId: string, over: Partial<MerchantItem> = {}): MerchantItem => ({ offerId, gtin: null, title: `Artikel ${offerId}`, price: 119, currency: "EUR", availability: "in_stock", disapproved: false, issues: [], ...over });

describe("Prüfungen", () => {
  const products = [product("T1"), product("T2"), product("S1"), product("S2", { active: false }), product("S3", { isCloseout: true, stock: 0, minPurchase: 1 })];
  const revenue = new Map([["T1", 5000], ["T2", 3000], ["S1", 100], ["S2", 50], ["S3", 40]]);

  it("Zuordnung über Artikelnummer, sonst EAN", () => {
    const m = matchItems([item("t1"), item("X", { gtin: "4026" })], products, new Map([["4026", "S1"]]));
    expect(m.map((x) => x.product?.productNumber)).toEqual(["T1", "S1"]);
  });

  it("abgelehnt: kritisch mit Topseller, Gründe gezählt; Preis/Verfügbarkeit; fehlende Topseller", () => {
    const issues = [{ code: "c", severity: "DISAPPROVED", description: "Preis stimmt nicht", attribute: "price" }];
    const found = merchantDetections(
      [
        item("T1", { disapproved: true, issues }),
        item("S1", { price: 129 }),
        item("S2"),
        item("S3", { availability: "in_stock" }),
        item("UNBEKANNT"),
      ],
      products,
      revenue,
      new Map(),
    );
    const byCode = Object.fromEntries(found.map((d) => [d.code, d]));
    expect(byCode.merchantDisapproved).toMatchObject({ severity: "critical", params: { count: 1, top: 1, revenue: 5000, reasons: "Preis stimmt nicht (1)" } });
    expect(byCode.merchantMismatch.params).toMatchObject({ count: 3, price: 1, availability: 2 });
    expect(byCode.merchantMismatch.params.examples).toContain("S1: Feed 129.00 € / Shop 119.00 €");
    expect(byCode.merchantTopsellersMissing).toMatchObject({ severity: "warning", params: { count: 1, revenue: 3000 } });
    expect((byCode.merchantTopsellersMissing.evidence as any).products).toEqual(["T2"]);
  });

  it("kleine Preisunterschiede (Rundung) und passende Daten ergeben nichts", () => {
    expect(merchantDetections([item("T1", { price: 119.04 }), item("T2")], products.slice(0, 2), new Map([["T1", 1], ["T2", 1]]), new Map())).toEqual([]);
  });

  it("Prüfung im Lauf: liest Konto, Artikel, Umsatz und EANs", async () => {
    const ctx: any = {
      merchant: { account: async () => ({ merchantId: "1", products: async () => [item("T1")] }), eans: async () => new Map() },
      buyability: { products: async () => [product("T1")], revenue: async () => new Map([["T1", 1]]) },
    };
    expect(await merchantDetector.run(ctx)).toEqual([]);
  });
});
