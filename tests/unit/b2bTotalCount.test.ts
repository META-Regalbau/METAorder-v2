/**
 * Gesamtzahlen der B2B-Listen (Firmen, Mitarbeiter, Freigaben, Merklisten, Kunden-Artikelnummern,
 * Sortimente, Explosionszeichnungen, Angebote) und Fingerprint des Firmen-Snapshots - gegen ein
 * simuliertes Shopware, das wie das echte die Gesamtzahl nur mit "total-count-mode" (kebab-case)
 * liefert und sonst die Anzahl der Treffer auf der Seite (Testing: totalCountMode -> 2 statt 12.581).
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { B2BSellersAdminClient } from "../../server/b2b/b2bSellersAdmin";
import { B2BSellersClient } from "../../server/b2b/b2bSellersClient";

const shop = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  latestUpdatedAt: "2026-10-01T10:00:00.000+00:00",
  bodies: [] as Array<{ entity: string; body: any }>,
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/oauth/token") return json({ access_token: "tok", expires_in: 600, token_type: "Bearer" });
    const m = path.match(/^\/api\/search\/(.+)$/);
    if (!m || !(m[1] in shop.counts)) return json({ errors: [{ status: "404", detail: "No route found" }] }, 404);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    shop.bodies.push({ entity: m[1], body });
    const n = shop.counts[m[1]];
    const limit = Number(body.limit ?? 25);
    const page = Number(body.page ?? 1);
    const size = Math.max(0, Math.min(limit, n - (page - 1) * limit));
    const data = Array.from({ length: size }, (_, i) => ({
      id: `${m[1]}-${(page - 1) * limit + i}`,
      company: "Firma", email: "x@example.com", customerId: "c1", createdAt: "2026-01-01T00:00:00.000+00:00", updatedAt: shop.latestUpdatedAt,
    }));
    // wie Shopware: ohne "total-count-mode" ist total nur die Anzahl auf der Seite
    return json({ data, total: body["total-count-mode"] ? n : data.length });
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  shop.bodies = [];
  shop.latestUpdatedAt = "2026-10-01T10:00:00.000+00:00";
  shop.counts = {
    "b2bsellers-offer-customer": 621,
    "b2bsellers-employee": 12581,
    "b2bsellers-order-extension": 1788,
    "b2b-product-list": 7,
    "b2bsellers-customer-product-number": 3,
    "b2bsellers-customer-price": 1234,
    "b2bsellers-product-exploded-view": 5,
    customer: 7520,
    "b2bsellers-offer": 461,
  };
});

const settings = { shopwareUrl: "https://b2b.invalid", apiKey: "k", apiSecret: "s" } as any;
const admin = () => new B2BSellersAdminClient(settings);

describe("B2B-Listen: Gesamtzahl statt Seitengroesse", () => {
  it.each([
    ["Mitarbeiter", () => admin().fetchEmployees({ limit: 50 }), 12581],
    ["Freigaben", () => admin().fetchPendingApprovals({ limit: 50 }), 1788],
    ["Merklisten", () => admin().fetchProductLists({ limit: 50 }), 7],
    ["Kunden-Artikelnummern", () => admin().fetchCustomerSkus({ limit: 2 }), 3],
    ["Sortimente", () => admin().fetchAssortments({ customerId: "c1", limit: 50 }), 1234],
    ["Explosionszeichnungen", () => admin().fetchExplodedViews({ limit: 2 }), 5],
    ["Firmen", () => admin().fetchCompanies({ limit: 50 }), 621],
  ] as const)("%s", async (_name, call, expected) => {
    const result: any = await call();
    expect(result.total).toBe(expected);
    expect(shop.bodies.every((b) => b.body["total-count-mode"] === 1 && !("totalCountMode" in b.body))).toBe(true);
  });

  it("Firmen ueber Geschaeftskunden (Firmen-Entitaet nicht erreichbar)", async () => {
    delete shop.counts["b2bsellers-offer-customer"];
    // eigene Shop-Adresse: der 404 der Firmen-Entitaet wird je URL zwischengespeichert
    const result = await new B2BSellersAdminClient({ ...settings, shopwareUrl: "https://b2b-ohne-firmen.invalid" }).fetchCompanies({ limit: 50 });
    expect(result.total).toBe(7520);
  });

  it("Angebote", async () => {
    const result = await new B2BSellersClient(settings).fetchOffers({ limit: 50 } as any);
    expect(result.total).toBe(461);
  });
});

describe("Fingerprint des B2B-Firmen-Snapshots", () => {
  it("aendert sich, wenn Firmen oder Geschaeftskunden wegfallen - auch ohne neuere Aenderung", async () => {
    const before = await admin().fetchCompaniesSnapshotFingerprint();
    shop.counts["b2bsellers-offer-customer"] -= 1;
    const afterCompanyDeleted = await admin().fetchCompaniesSnapshotFingerprint();
    shop.counts.customer -= 1;
    const afterCustomerDeleted = await admin().fetchCompaniesSnapshotFingerprint();
    expect(new Set([before, afterCompanyDeleted, afterCustomerDeleted]).size).toBe(3);
  });
});
