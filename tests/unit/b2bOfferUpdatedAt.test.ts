/**
 * Angebote ohne Aenderungsdatum (Shopware liefert updatedAt null, nie geaendert): frueher bekam
 * jedes beim Abruf "jetzt" - es wirkte bei jedem Abruf frisch geaendert, und der Suchindex rechnete
 * diese Angebote bei jedem Lauf neu (Testing: 53 von 461). Jetzt: Erstelldatum.
 * Gegen ein simuliertes Shopware. Ausführung: npm test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { B2BSellersClient } from "../../server/b2b/b2bSellersClient";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/oauth/token") return json({ access_token: "tok", expires_in: 600, token_type: "Bearer" });
    if (path === "/api/search/b2bsellers-offer") {
      return json({
        total: 2,
        data: [
          { id: "nie-geaendert", offerNumber: "A-1", createdAt: "2026-03-01T08:00:00.000+00:00", updatedAt: null },
          { id: "geaendert", offerNumber: "A-2", createdAt: "2026-03-01T08:00:00.000+00:00", updatedAt: "2026-04-02T09:30:00.000+00:00" },
        ],
      });
    }
    return json({ data: [], total: 0 });
  });
});
afterAll(() => vi.unstubAllGlobals());

describe("Angebote: Aenderungsdatum", () => {
  it("nie geaendert -> Erstelldatum, stabil ueber mehrere Abrufe; geaendert -> unveraendert", async () => {
    const client = new B2BSellersClient({ shopwareUrl: "https://shop.invalid", apiKey: "k", apiSecret: "s" } as any);
    const first = await client.fetchOffers({ page: 1, limit: 100 });
    await new Promise((r) => setTimeout(r, 15));
    const second = await client.fetchOffers({ page: 1, limit: 100 });
    const byId = (offers: typeof first.offers) => Object.fromEntries(offers.map((o) => [o.id, o.updatedAt]));
    expect(byId(first.offers)).toEqual({ "nie-geaendert": "2026-03-01T08:00:00.000+00:00", geaendert: "2026-04-02T09:30:00.000+00:00" });
    expect(byId(second.offers)).toEqual(byId(first.offers));
  });
});
