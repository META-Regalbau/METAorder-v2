/**
 * Angebotssuche (Angebotsliste, DB-Berechnung je Angebotsnummer) gegen ein simuliertes Shopware:
 * B2Bsellers kennt nur "matchCode" (camelCase) - "matchcode" lehnte Shopware mit 400 ab, dann probierte
 * der Client alle weiteren Entitaetsnamen und meldete am Ende ein irrefuehrendes 404
 * ("No route found ... prems-individual-offer"); jede Suche mit Begriff schlug so fehl.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { B2BSellersClient } from "../../server/b2b/b2bSellersClient";

const shop = vi.hoisted(() => ({ requests: [] as Array<{ entity: string; body: any }> }));
const KNOWN_FIELDS = new Set(["number", "offerCustomer.company", "mailTo", "matchCode", "createdAt", "salesChannelId", "statusId"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fieldsOf(filters: any[]): string[] {
  return (filters ?? []).flatMap((f) => (f.type === "multi" ? fieldsOf(f.queries) : [f.field]));
}

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/oauth/token") return json({ access_token: "tok", expires_in: 600, token_type: "Bearer" });
    const m = path.match(/^\/api\/search\/(.+)$/);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    shop.requests.push({ entity: m?.[1] ?? path, body });
    if (m?.[1] !== "b2bsellers-offer") return json({ errors: [{ status: "404", detail: "No route found" }] }, 404);
    const unknown = fieldsOf(body.filter).find((f) => !KNOWN_FIELDS.has(f));
    if (unknown) return json({ errors: [{ status: "400", code: "FRAMEWORK__UNMAPPED_FIELD", detail: `Field "${unknown}" was not found.` }] }, 400);
    return json({ data: [{ id: "o1", number: "1619", salesChannelId: "shop", createdAt: "2026-10-01T00:00:00Z" }], total: 1 });
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  shop.requests = [];
});

const settings = { shopwareUrl: "https://offer-search.invalid", apiKey: "k", apiSecret: "s" } as any;

describe("Angebotssuche", () => {
  it("sucht mit matchCode und findet das Angebot", async () => {
    const { offers } = await new B2BSellersClient(settings).fetchOffers({ search: "1619", customer: "Firma" });
    expect(offers.map((o) => o.offerNumber)).toEqual(["1619"]);
    const fields = shop.requests.flatMap((r) => fieldsOf(r.body.filter));
    expect(fields).toContain("matchCode");
    expect(fields).not.toContain("matchcode");
  });

  it("meldet einen echten Fehler der Angebots-Entitaet statt weitere Entitaeten zu probieren", async () => {
    KNOWN_FIELDS.delete("mailTo");
    try {
      await expect(
        new B2BSellersClient({ ...settings, shopwareUrl: "https://offer-search-3.invalid" }).fetchOffers({ search: "1619" }),
      ).rejects.toThrow(/mailTo/);
      expect(shop.requests.map((r) => r.entity)).toEqual(["b2bsellers-offer"]);
    } finally {
      KNOWN_FIELDS.add("mailTo");
    }
  });
});
