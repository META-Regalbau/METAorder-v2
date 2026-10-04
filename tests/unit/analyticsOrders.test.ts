/**
 * Statistik aus dem Bestell-Spiegel: Auswahl (Zeitraum, Kanaele, Versanddaten, Reihenfolge,
 * mehrfach vergebene Bestellnummern) und
 * die echte Route /api/analytics/summary mit gemockten Abhaengigkeiten.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Order } from "../../shared/schema";

const state = vi.hoisted(() => ({ orders: [] as any[], channels: null as string[] | null, tenantSeen: [] as unknown[] }));
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return {
    ...actual,
    getSalesChannelFilter: async () => state.channels,
    getOrdersWithCache: async (_client: unknown, tenantId: unknown) => {
      state.tenantSeen.push(tenantId);
      return { orders: state.orders, fromCache: true };
    },
  };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => { req.user = { id: "u1" }; req.tenantId = "tenant-a"; next(); };
  return { ...actual, requireAuth: pass, requireViewAnalytics: pass };
});

import { selectAnalyticsOrders } from "../../server/analytics/analyticsOrders";
import { storage } from "../../server/storage";
import { registerAnalyticsRoutes } from "../../server/routes/analyticsRoutes";

function order(id: string, day: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`,
    orderDate: `${day}T00:00:00.000+00:00`, totalAmount: 119, netTotalAmount: 100, status: "open", paymentStatus: "paid",
    salesChannelId: "sc1", items: [], ...overrides,
  } as Order;
}

describe("selectAnalyticsOrders", () => {
  const orders = [
    order("a", "2026-03-30"), order("b", "2026-03-31"), order("c", "2026-04-01"),
    order("d", "2026-01-01", { salesChannelId: "sc2" }), order("e", "2025-12-31"),
  ];

  it("Zeitraum: dateFrom und dateTo jeweils einschliesslich, verglichen wird der Tag", () => {
    const ids = selectAnalyticsOrders(orders, { dateFrom: "2026-01-01", dateTo: "2026-03-31", salesChannelIds: null }).map((o) => o.id);
    expect(ids.sort()).toEqual(["a", "b", "d"]);
    expect(selectAnalyticsOrders(orders, { dateFrom: "2026-03-31", dateTo: "2026-03-31", salesChannelIds: null }).map((o) => o.id)).toEqual(["b"]);
  });

  it("ohne Zeitraum alle Bestellungen, neueste zuerst", () => {
    expect(selectAnalyticsOrders(orders, { salesChannelIds: null }).map((o) => o.id)).toEqual(["c", "b", "a", "d", "e"]);
  });

  it("Kanaele: null = alle, Liste = nur diese, leere Liste = keine (Nutzer ohne Kanal)", () => {
    expect(selectAnalyticsOrders(orders, { salesChannelIds: null })).toHaveLength(5);
    expect(selectAnalyticsOrders(orders, { salesChannelIds: ["sc2"] }).map((o) => o.id)).toEqual(["d"]);
    expect(selectAnalyticsOrders(orders, { salesChannelIds: [] })).toEqual([]);
  });

  it("die Auswahl uebernimmt die Versanddaten des Bestell-Mappings unveraendert", () => {
    const list = [order("s", "2026-05-01", { shippingInfo: { shippedDate: "2026-05-03T09:15:00.000+00:00", trackingNumber: "T1" } }), order("n", "2026-05-02")];
    const selected = selectAnalyticsOrders(list, { salesChannelIds: null });
    expect(selected.find((o) => o.id === "s")?.shippingInfo).toEqual({ shippedDate: "2026-05-03T09:15:00.000+00:00", trackingNumber: "T1" });
    expect(selected.find((o) => o.id === "n")?.shippingInfo).toBeUndefined();
  });

  it("mehrfach vergebene Bestellnummer zaehlt einmal - die zuletzt geaenderte Bestellung", () => {
    const list = [
      order("d1", "2026-07-07", { orderNumber: "286101", totalAmount: 26119.95, updatedAt: "2026-07-07T13:40:01Z" }),
      order("d3", "2026-07-14", { orderNumber: "286101", totalAmount: 35861.3, updatedAt: "2026-07-14T08:00:01Z" }),
      order("d2", "2026-07-07", { orderNumber: "286101", totalAmount: 26119.95, updatedAt: "2026-07-07T13:50:04Z" }),
      order("e", "2026-07-08"),
    ];
    expect(selectAnalyticsOrders(list, { salesChannelIds: null }).map((o) => o.id)).toEqual(["d3", "e"]);
    // der Zeitraum gilt fuer die verbleibende Bestellung
    expect(selectAnalyticsOrders(list, { dateFrom: "2026-07-07", dateTo: "2026-07-07", salesChannelIds: null })).toEqual([]);
  });
});

describe("GET /api/analytics/summary (echte Route)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
    const app = express();
    registerAnalyticsRoutes(app as any);
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    state.orders = [
      order("a", "2026-03-30", { totalAmount: 119, netTotalAmount: 100 }),
      order("b", "2026-03-31", { totalAmount: 238, netTotalAmount: 200, customerEmail: "x@example.com" }),
      order("c", "2026-04-01", { totalAmount: 1000, netTotalAmount: 840, salesChannelId: "sc2" }),
    ];
    state.channels = null;
    state.tenantSeen = [];
  });

  it("rechnet aus dem Spiegel des Mandanten der Anfrage, Zeitraum einschliesslich", async () => {
    const r = await (await fetch(`${base}/api/analytics/summary?dateFrom=2026-03-30&dateTo=2026-03-31`)).json();
    expect(r).toMatchObject({ totalOrders: 2, totalRevenue: 357, totalNetRevenue: 300, uniqueCustomers: 2 });
    expect(state.tenantSeen).toEqual(["tenant-a"]);
  });

  it("Nutzer ohne Verkaufskanal sieht keine Umsaetze (frueher: alle)", async () => {
    state.channels = [];
    const r = await (await fetch(`${base}/api/analytics/summary`)).json();
    expect(r).toMatchObject({ totalOrders: 0, totalRevenue: 0 });
  });

  it("Versandzeiten aus den Versanddaten der Spiegel-Bestellungen", async () => {
    state.orders = [
      order("a", "2026-03-30", { shippingInfo: { shippedDate: "2026-03-31T12:00:00.000Z" } }),
      order("b", "2026-03-31"),
    ];
    const r = await (await fetch(`${base}/api/analytics/shipping-times`)).json();
    expect(r).toMatchObject({ ordersWithShippingCount: 1, averageDays: 1.5 });
  });

  it("doppelt angelegte Bestellung zaehlt bei Anzahl und Umsatz einmal", async () => {
    state.orders.push(order("a-kopie", "2026-03-30", { orderNumber: "SW-a", totalAmount: 119, netTotalAmount: 100, updatedAt: "2026-03-30T08:00:00Z" }));
    const r = await (await fetch(`${base}/api/analytics/summary`)).json();
    expect(r).toMatchObject({ totalOrders: 3, totalRevenue: 1357, totalNetRevenue: 1140 });
  });

  it("Kanal-Einschraenkung wird angewendet", async () => {
    state.channels = ["sc2"];
    const r = await (await fetch(`${base}/api/analytics/summary`)).json();
    expect(r).toMatchObject({ totalOrders: 1, totalRevenue: 1000 });
  });
});
