/**
 * B2B im Testshop (Kopie von Live): Kunden-Artikelnummern und Bestelllisten lieferten 500.
 * - Kunden-Artikelnummern: das Feld heisst in dieser B2Bsellers-Version `productNumber`, nicht
 *   `customerProductNumber` (FRAMEWORK__UNMAPPED_FIELD); die Suche filterte zudem auf ein Feld "number",
 *   das es nicht gibt. Jetzt: Feld erkannt (beide Varianten), gemerkt je Shop; Suche auf product.productNumber.
 * - Bestelllisten: die Entitaet gibt es in dieser Version nicht (404 "No route found") -> 404 mit Code,
 *   die Seite zeigt einen Hinweis statt stumm leerer Listen.
 * Gegen ein simuliertes Shopware. Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  B2BEntityUnavailableError,
  B2BSellersAdminClient,
  resetCustomerSkuFieldCacheForTests,
} from "../../server/b2b/b2bSellersAdmin";

const shop = vi.hoisted(() => ({
  skuField: "productNumber" as string,
  requests: [] as Array<{ method: string; path: string; body: any }>,
}));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const unmapped = (field: string) =>
  json({ errors: [{ status: "400", code: "FRAMEWORK__UNMAPPED_FIELD", detail: `Field "${field}" in entity "b2bsellers_customer_product_number" was not found.` }] }, 400);

/** Felder einer Suchanfrage (Sortierung und Filter, auch verschachtelt) */
const fieldsOf = (body: any): string[] => {
  const out: string[] = [];
  const walk = (f: any) => {
    if (!f) return;
    if (f.field) out.push(f.field);
    (f.queries ?? []).forEach(walk);
  };
  (body.sort ?? []).forEach(walk);
  (body.filter ?? []).forEach(walk);
  return out;
};

const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    // Anfragen an die Test-App (Route-Test) nicht abfangen
    if (String(url).startsWith("http://127.0.0.1")) return realFetch(url, init);
    const path = new URL(String(url)).pathname;
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (path === "/api/oauth/token") return json({ access_token: "tok", expires_in: 600, token_type: "Bearer" });
    shop.requests.push({ method, path, body });
    if (path === "/api/search/b2bsellers-customer-product-number") {
      const other = shop.skuField === "productNumber" ? "customerProductNumber" : "productNumber";
      const bad = fieldsOf(body).find((f) => f === other || f === "number");
      if (bad) return unmapped(bad);
      return json({ data: [{ id: "s1", customerId: "c1", productId: "p1", [shop.skuField]: "KD-4711", product: { productNumber: "4026212289640" } }], total: 1 });
    }
    if (method === "POST" && path === "/api/b2bsellers-customer-product-number") {
      const other = shop.skuField === "productNumber" ? "customerProductNumber" : "productNumber";
      if (other in (body ?? {})) return unmapped(other);
      return new Response(null, { status: 204, headers: { Location: "https://shop.invalid/api/b2bsellers-customer-product-number/neu-1" } });
    }
    return json({ errors: [{ code: "0", status: "404", title: "Not Found", detail: `No route found for "${method} ${path}"` }] }, 404);
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  shop.requests = [];
  resetCustomerSkuFieldCacheForTests();
});

const client = () => new B2BSellersAdminClient({ shopwareUrl: "https://shop.invalid", apiKey: "k", apiSecret: "s" } as any);
const searches = () => shop.requests.filter((r) => r.path === "/api/search/b2bsellers-customer-product-number");

describe("Kunden-Artikelnummern", () => {
  it("Feld productNumber (Testshop/Live): Kunden-Artikelnummer und unsere Artikelnummer gelesen", async () => {
    const result = await client().fetchCustomerSkus({ search: "4711" });
    expect(result.skus).toEqual([{ id: "s1", customerId: "c1", productId: "p1", customerProductNumber: "KD-4711", productNumber: "4026212289640" }]);
    expect(fieldsOf(searches()[0].body)).toEqual(["productNumber", "productNumber", "product.productNumber"]);
  });

  it("andere Version (customerProductNumber): nach FRAMEWORK__UNMAPPED_FIELD das andere Feld, danach gemerkt", async () => {
    shop.skuField = "customerProductNumber";
    try {
      const c = client();
      expect((await c.fetchCustomerSkus({})).skus[0].customerProductNumber).toBe("KD-4711");
      expect(searches()).toHaveLength(2);
      shop.requests = [];
      await c.fetchCustomerSkus({});
      expect(searches()).toHaveLength(1);
    } finally {
      shop.skuField = "productNumber";
    }
  });

  it("Anlegen mit dem Feld dieser Version", async () => {
    await client().createCustomerSku({ customerId: "c1", productId: "p1", customerProductNumber: "KD-1" });
    const post = shop.requests.find((r) => r.method === "POST" && r.path === "/api/b2bsellers-customer-product-number");
    expect(post?.body).toEqual({ customerId: "c1", productId: "p1", productNumber: "KD-1" });
  });

  it("andere Fehler werden nicht verschluckt", async () => {
    const c = client();
    vi.spyOn(c as any, "searchEntity").mockRejectedValueOnce(new Error("Shopware weg"));
    await expect(c.fetchCustomerSkus({})).rejects.toThrow("Shopware weg");
  });
});

describe("Entitaet fehlt im Shop", () => {
  it("Bestelllisten: 404 'No route found' -> B2BEntityUnavailableError", async () => {
    await expect(client().fetchProductLists({})).rejects.toBeInstanceOf(B2BEntityUnavailableError);
    await expect(client().fetchProductLists({})).rejects.toMatchObject({ code: "b2b_entity_unavailable", entityName: "b2b-product-list" });
  });

  it("Route: 404 mit Code statt 500 mit Shopware-Rohtext; andere Fehler weiter 500", async () => {
    const admin = await import("../../server/b2b/b2bSellersAdmin");
    const auth = await import("../../server/auth/auth");
    const { storage } = await import("../../server/storage");
    vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "k", apiSecret: "s" } as any);
    vi.spyOn(storage, "getSetting").mockResolvedValue(undefined);
    const pass = (req: any, _res: any, next: () => void) => { req.user = { id: "u1", permissions: { viewB2B: true } }; next(); };
    for (const name of ["requireAuth", "requireViewB2B"] as const) if (name in auth) vi.spyOn(auth as any, name).mockImplementation(pass as any);
    const { registerB2BAdminRoutes } = await import("../../server/b2b/b2bAdminRoutes");
    const app = express();
    app.use(express.json());
    registerB2BAdminRoutes(app as any, { getSalesChannelFilter: async () => null });
    const server: Server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const lists = await fetch(`${base}/api/b2b/shopping-lists`);
      expect(lists.status).toBe(404);
      expect(await lists.json()).toEqual({ error: "This B2B function is not available in this shop", code: "b2b_entity_unavailable", entity: "b2b-product-list" });
      const skus = await fetch(`${base}/api/b2b/customer-skus`);
      expect(skus.status).toBe(200);
      vi.spyOn(admin.B2BSellersAdminClient.prototype, "fetchAssortments").mockRejectedValueOnce(new Error("Shopware weg"));
      const broken = await fetch(`${base}/api/b2b/assortments`);
      expect(broken.status).toBe(500);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
