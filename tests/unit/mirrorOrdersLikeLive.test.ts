/**
 * Bestellungen aus dem Bestell-Spiegel statt live per fetchOrders(): Reihenfolge wie Shopware
 * (Bestelldatum absteigend, dann id), eine je Bestellnummer, Mandant - fuer den Helfer, die
 * Abfrage-API GET /api/orders/query (Paginierung) und die KI-Abfrage (executeAnalyticsQuery).
 * Spiegel und Shopware gemockt; ein Live-Abruf laesst den Test scheitern.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Order } from "../../shared/schema";

const state = vi.hoisted(() => ({ channels: null as string[] | null, mirrorTenants: [] as unknown[] }));
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return { ...actual, getSalesChannelFilter: async () => state.channels };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => { req.user = { id: "u1" }; req.tenantId = "tenant-a"; next(); };
  return { ...actual, requireAuth: pass };
});

import { storage } from "../../server/storage";
import { ShopwareClient } from "../../server/shopware/shopware";
import { getMirrorOrdersLikeLive } from "../../server/routes/routeHelpers";
import { registerOrderRoutes } from "../../server/routes/orderRoutes";
import { executeAnalyticsQuery } from "../../server/analytics/analyticsQueryExecutor";

function order(id: string, day: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`,
    orderDate: `${day}T00:00:00.000+00:00`, totalAmount: 100, netTotalAmount: 84, status: "open", paymentStatus: "paid",
    salesChannelId: "sc1", items: [], ...overrides,
  } as Order;
}

// bewusst ungeordnet, mit einer doppelt vergebenen Bestellnummer (b-alt/b-neu)
const MIRROR: Order[] = [
  order("c", "2026-03-01"),
  order("b-alt", "2026-03-02", { orderNumber: "SW-b", updatedAt: "2026-03-02T08:00:00Z", totalAmount: 50 }),
  order("a2", "2026-03-03"),
  order("x", "2026-03-02", { salesChannelId: "sc2" }),
  order("a1", "2026-03-03"),
  order("b-neu", "2026-03-02", { orderNumber: "SW-b", updatedAt: "2026-03-02T09:00:00Z", totalAmount: 50 }),
];

let server: Server;
let base = "";
let live = 0;
beforeAll(async () => {
  vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
  vi.spyOn(storage, "countShopwareOrderMirrors").mockResolvedValue(MIRROR.length);
  vi.spyOn(storage, "getShopwareOrderMirrors").mockImplementation(async (tenantId?: string | null) => {
    state.mirrorTenants.push(tenantId);
    return { rows: MIRROR.map((o) => ({ shopwareId: o.id, payload: structuredClone(o) })) as any, total: MIRROR.length };
  });
  vi.spyOn(ShopwareClient.prototype as any, "fetchOrders").mockImplementation(async () => {
    live += 1;
    throw new Error("Live-Abruf nicht erwartet");
  });
  const app = express();
  app.use(express.json());
  registerOrderRoutes(app as any);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  state.channels = null;
  state.mirrorTenants = [];
  live = 0;
});

const client = () => new ShopwareClient({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);

describe("getMirrorOrdersLikeLive", () => {
  it("Reihenfolge wie fetchOrders (Datum absteigend, dann id), eine je Bestellnummer (zuletzt geaendert), Mandant", async () => {
    const orders = await getMirrorOrdersLikeLive(client(), "tenant-a");
    expect(orders.map((o) => o.id)).toEqual(["a1", "a2", "b-neu", "x", "c"]);
    expect(state.mirrorTenants).toEqual(["tenant-a"]);
    expect(live).toBe(0);
  });
});

describe("GET /api/orders/query", () => {
  const query = async (q: string) => (await fetch(`${base}/api/orders/query?${q}`)).json();

  it("blaettert stabil durch die Spiegel-Bestellungen des Mandanten, ohne Live-Abruf", async () => {
    const page1 = await query("limit=2&offset=0");
    const page2 = await query("limit=2&offset=2");
    expect(page1.orders.map((o: Order) => o.id)).toEqual(["a1", "a2"]);
    expect(page2.orders.map((o: Order) => o.id)).toEqual(["b-neu", "x"]);
    expect(page1.total).toBe(5);
    expect(state.mirrorTenants.every((t) => t === "tenant-a")).toBe(true);
    expect(live).toBe(0);
  });

  it("Verkaufskanaele des Nutzers; ohne Kanal keine Bestellungen", async () => {
    state.channels = ["sc2"];
    expect((await query("limit=10")).orders.map((o: Order) => o.id)).toEqual(["x"]);
    state.channels = [];
    expect((await query("limit=10")).total).toBe(0);
  });
});

describe("KI-Abfrage (executeAnalyticsQuery)", () => {
  it("rechnet mit den Spiegel-Bestellungen des Mandanten, eine je Bestellnummer, nur eigene Kanaele", async () => {
    const result = await executeAnalyticsQuery({ type: "general_statistics", parameters: {} } as any, storage, client(), ["sc1"], "tenant-a");
    expect(result.summary).toMatchObject({ count: 4, total: 350 });
    expect(state.mirrorTenants).toEqual(["tenant-a"]);
    expect(live).toBe(0);
  });

  it("Bestellnummern-Filter: nur MO bzw. nur ohne MO", async () => {
    const stats = async (filter: "mo" | "non-mo") =>
      (await executeAnalyticsQuery({ type: "general_statistics", parameters: {} } as any, storage, client(), ["sc1"], "tenant-a", "de", filter)).summary;
    // die Testbestellungen tragen SW-Nummern, also keine MO-Bestellungen
    expect(await stats("mo")).toMatchObject({ count: 0 });
    expect(await stats("non-mo")).toMatchObject({ count: 4, total: 350 });
  });
});
