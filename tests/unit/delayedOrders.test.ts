/**
 * Verspaetete Bestellungen aus dem Bestell-Spiegel: Dubletten je Bestellnummer und die echte Route
 * GET /api/orders/delayed (Spiegel und Kanalfilter gemockt).
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Order } from "../../shared/schema";

const state = vi.hoisted(() => ({ orders: [] as any[], channels: null as string[] | null, calls: [] as Array<{ tenantId: unknown; forceRefresh: unknown }> }));
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return {
    ...actual,
    getSalesChannelFilter: async () => state.channels,
    getOrdersWithCache: async (_client: unknown, tenantId: unknown, options?: { forceRefresh?: boolean }) => {
      state.calls.push({ tenantId, forceRefresh: options?.forceRefresh });
      return { orders: state.orders, fromCache: true };
    },
  };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => { req.user = { id: "u1" }; req.tenantId = "tenant-a"; next(); };
  return { ...actual, requireAuth: pass, requireViewDelayedOrders: pass };
});

import { dedupeOrdersByNumber } from "../../server/routes/routeHelpers";
import { storage } from "../../server/storage";
import { registerOrderRoutes } from "../../server/routes/orderRoutes";

const DAY = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`, orderDate: daysAgo(20),
    deliveryDateLatest: daysAgo(10), totalAmount: 119, netTotalAmount: 100, status: "in_progress", paymentStatus: "paid",
    salesChannelId: "sc1", items: [], ...overrides,
  } as Order;
}

describe("dedupeOrdersByNumber", () => {
  it("eine Bestellung je Nummer: die zuletzt geaenderte, Reihenfolge bleibt", () => {
    const a1 = order("a1", { orderNumber: "100", updatedAt: "2026-06-18T12:42:05Z" });
    const a2 = order("a2", { orderNumber: "100", updatedAt: "2026-06-22T15:10:02Z" });
    const b = order("b", { orderNumber: "200" });
    const ohne = order("x", { orderNumber: "" as any });
    expect(dedupeOrdersByNumber([a1, b, a2, ohne]).map((o) => o.id)).toEqual(["b", "a2", "x"]);
  });

  it("ohne updatedAt zaehlt createdAt, sonst das Bestelldatum", () => {
    const alt = order("alt", { orderNumber: "300", createdAt: "2026-01-01T00:00:00Z" });
    const neu = order("neu", { orderNumber: "300", createdAt: "2026-02-01T00:00:00Z" });
    expect(dedupeOrdersByNumber([neu, alt]).map((o) => o.id)).toEqual(["neu"]);
  });
});

describe("GET /api/orders/delayed (echte Route)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
    const app = express();
    registerOrderRoutes(app as any);
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    state.channels = null;
    state.calls = [];
    state.orders = [
      order("ueber", { deliveryDateLatest: daysAgo(10) }),
      order("knapp", { deliveryDateLatest: daysAgo(2) }),
      order("ohneLieferdatum", { deliveryDateLatest: undefined, orderDate: daysAgo(5) }),
      order("offen", { paymentStatus: "open" }),
      order("fertig", { status: "completed" }),
      order("storniert", { status: "cancelled" }),
      order("kanal2", { salesChannelId: "sc2", deliveryDateLatest: daysAgo(30) }),
      order("dublette-alt", { orderNumber: "SW-dup", updatedAt: "2026-06-18T00:00:00Z" }),
      order("dublette-neu", { orderNumber: "SW-dup", updatedAt: "2026-06-22T00:00:00Z" }),
    ];
  });
  const get = async (qs = "") => (await fetch(`${base}/api/orders/delayed${qs}`)).json() as Promise<any[]>;

  it("bezahlt, nicht abgeschlossen/storniert, Lieferdatum (sonst Bestelldatum) ueber der Schwelle; aelteste zuerst", async () => {
    const r = await get("?days=3");
    expect(r.map((o) => o.id)).toEqual(["kanal2", "ueber", "dublette-neu", "ohneLieferdatum"]);
    expect(r.find((o) => o.id === "ueber").daysSinceOrder).toBe(10);
    expect(state.calls).toEqual([{ tenantId: "tenant-a", forceRefresh: false }]);
  });

  it("Schwelle aus ?days, Standard 3", async () => {
    expect((await get("?days=7")).map((o) => o.id)).toEqual(["kanal2", "ueber", "dublette-neu"]);
    expect((await get()).map((o) => o.id)).toEqual(["kanal2", "ueber", "dublette-neu", "ohneLieferdatum"]);
  });

  it("refresh=1 stoesst vorher einen Abgleich an", async () => {
    await get("?days=3&refresh=1");
    expect(state.calls).toEqual([{ tenantId: "tenant-a", forceRefresh: true }]);
  });

  it("Kanal-Einschraenkung: nur eigene Kanaele, ohne Kanal nichts", async () => {
    state.channels = ["sc2"];
    expect((await get()).map((o) => o.id)).toEqual(["kanal2"]);
    state.channels = [];
    expect(await get()).toEqual([]);
  });
});
