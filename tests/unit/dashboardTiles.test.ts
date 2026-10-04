/**
 * Dashboard-Kacheln aus dem Bestell-Spiegel (frueher die neuesten 10 bzw. 500 Bestellungen live):
 * neueste Bestellungen, Kennzahlen, verspaetete Bestellungen (Regel wie die Seite) und
 * versandbereite Bestellungen - echte Routen, Anmeldung, Kanaele, Spiegel und Shopware gemockt;
 * ein Live-Abruf laesst den Test scheitern.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Order } from "../../shared/schema";

const state = vi.hoisted(() => ({ channels: null as string[] | null, live: 0, orders: [] as any[] }));
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return { ...actual, getSalesChannelFilter: async () => state.channels };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const permissions = { viewOrders: true, viewDelayedOrders: true, viewShipping: true, viewTickets: false };
  const pass = (req: any, _res: any, next: () => void) => { req.user = { id: "u1", roleDetails: { name: "Mitarbeiter", permissions } }; req.tenantId = "tenant-a"; next(); };
  return { ...actual, requireAuth: pass, requireViewDelayedOrders: pass, requireViewShipping: pass };
});

import { storage } from "../../server/storage";
import { ShopwareClient } from "../../server/shopware/shopware";
import { registerAnalyticsRoutes } from "../../server/routes/analyticsRoutes";
import { registerOrderRoutes } from "../../server/routes/orderRoutes";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10) + "T00:00:00.000+00:00";
let seq = 0;
function order(overrides: Partial<Order> = {}): Order {
  seq += 1;
  const id = `o${String(seq).padStart(4, "0")}`;
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`, orderDate: daysAgo(1),
    totalAmount: 100, netTotalAmount: 84, status: "open", paymentStatus: "paid", salesChannelId: "sc1", items: [], ...overrides,
  } as Order;
}

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
  vi.spyOn(storage, "countShopwareOrderMirrors").mockImplementation(async () => state.orders.length);
  vi.spyOn(storage, "getShopwareOrderMirrors").mockImplementation(async () => ({ rows: state.orders.map((o) => ({ shopwareId: o.id, payload: structuredClone(o) })) as any, total: state.orders.length }));
  vi.spyOn(storage, "getAllTickets").mockResolvedValue([]);
  for (const m of ["fetchOrders", "fetchOrdersPaginated"]) {
    vi.spyOn(ShopwareClient.prototype as any, m).mockImplementation(async () => { state.live += 1; throw new Error("Live-Abruf nicht erwartet"); });
  }
  const app = express();
  app.use(express.json());
  registerAnalyticsRoutes(app as any);
  registerOrderRoutes(app as any);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  state.channels = null;
  state.live = 0;
  seq = 0;
  state.orders = [
    // 510 offene, frische Bestellungen (mehr als die frueheren 500), eine davon schon mit Sendungsnummer
    ...Array.from({ length: 510 }, (_, i) => order({ orderDate: daysAgo(1 + (i % 2)), shippingInfo: i === 0 ? { trackingNumber: "T1" } : undefined })),
    // verspaetet nach der Seiten-Regel: bezahlt, Lieferdatum > 3 Tage vorbei; kritisch > 14 Tage
    order({ status: "in_progress", orderDate: daysAgo(30), deliveryDateLatest: daysAgo(20) }),
    order({ status: "in_progress", orderDate: daysAgo(10), deliveryDateLatest: daysAgo(5) }),
    // nicht verspaetet: autorisiert (nicht bezahlt) bzw. Lieferdatum noch nicht vorbei bzw. abgeschlossen
    order({ status: "in_progress", paymentStatus: "authorized", orderDate: daysAgo(40) }),
    order({ status: "in_progress", orderDate: daysAgo(30), deliveryDateLatest: daysAgo(1) }),
    order({ status: "completed", orderDate: daysAgo(60) }),
    // anderer Kanal
    order({ salesChannelId: "sc2", orderDate: daysAgo(0) }),
  ];
});

const get = async (path: string) => (await fetch(`${base}${path}`)).json();

describe("Dashboard-Kacheln aus dem Spiegel", () => {
  it("neueste Bestellungen: die 10 neuesten der eigenen Kanaele; ohne Kanal keine (frueher: alle)", async () => {
    state.channels = ["sc2"];
    expect((await get("/api/dashboard/recent-orders")).map((o: Order) => o.salesChannelId)).toEqual(["sc2"]);
    state.channels = [];
    expect(await get("/api/dashboard/recent-orders")).toEqual([]);
    state.channels = null;
    const recent = await get("/api/dashboard/recent-orders");
    expect(recent).toHaveLength(10);
    expect(recent[0].salesChannelId).toBe("sc2"); // heute bestellt
    expect(state.live).toBe(0);
  });

  it("Kennzahlen: offene ueber alle Bestellungen, verspaetet nach der Seiten-Regel", async () => {
    const kpis = await get("/api/dashboard/kpis");
    // 510 frische + 4 in Bearbeitung + 1 im zweiten Kanal
    expect(kpis.orders).toMatchObject({ open: 515, delayed: 2 });
    expect(state.live).toBe(0);
  });

  it("verspaetete Bestellungen: gleiche Zahl wie die Seite, kritisch > 14 Tage, Tage wie auf der Seite", async () => {
    const summary = await get("/api/dashboard/delayed-orders-summary");
    const page = await get("/api/orders/delayed");
    expect(summary.total).toBe(page.length);
    expect(summary).toMatchObject({ total: 2, critical: 1 });
    expect(summary.recentOrders.map((o: any) => o.daysDelayed).sort((a: number, b: number) => a - b)).toEqual([5, 20]);
  });

  it("versandbereit: ueber alle Bestellungen der eigenen Kanaele, ohne bereits versendete", async () => {
    const ready = await get("/api/dashboard/shipping-ready");
    // 510 frische ohne die mit Sendungsnummer, 2 verspaetete, 1 autorisierte, 1 noch nicht faellige, 1 im zweiten Kanal
    expect(ready.total).toBe(509 + 2 + 1 + 1 + 1);
    expect(ready.orders).toHaveLength(10);
    state.channels = ["sc1"];
    expect((await get("/api/dashboard/shipping-ready")).total).toBe(513);
    expect(state.live).toBe(0);
  });
});
