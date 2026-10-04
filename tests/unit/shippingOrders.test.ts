/**
 * Versandliste aus dem Bestell-Spiegel (GET /api/shipping) und Spiegel-Abgleich nach dem
 * Sammel-Tracking (POST /api/orders/bulk-tracking) - echte Routen, Abhaengigkeiten gemockt.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Order } from "../../shared/schema";

const state = vi.hoisted(() => ({
  orders: [] as any[],
  cacheCalls: [] as Array<{ tenantId: unknown; forceRefresh: unknown }>,
  syncCalls: [] as Array<{ tenantId: unknown; entities: unknown }>,
  shippingUpdates: [] as string[],
  failShipping: new Set<string>(),
}));
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return {
    ...actual,
    getOrdersWithCache: async (_client: unknown, tenantId: unknown, options?: { forceRefresh?: boolean }) => {
      state.cacheCalls.push({ tenantId, forceRefresh: options?.forceRefresh });
      return { orders: state.orders, fromCache: true };
    },
  };
});
vi.mock("../../server/shopware/shopwareMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/shopware/shopwareMirror")>();
  return {
    ...actual,
    syncShopwareMirrorForTenant: async (_s: unknown, _c: unknown, tenantId: unknown, opts?: { entities?: unknown }) => {
      state.syncCalls.push({ tenantId, entities: opts?.entities });
    },
  };
});
vi.mock("../../server/erp/orderStockEnrichment", () => ({ enrichOrdersWithStockAvailability: async (orders: Order[]) => orders }));
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => { req.user = { id: "u1" }; req.tenantId = "tenant-a"; next(); };
  return { ...actual, requireAuth: pass, requireViewShipping: pass, requireEditOrders: pass };
});

import { storage } from "../../server/storage";
import { ShopwareClient } from "../../server/shopware/shopware";
import { registerOperationsRoutes } from "../../server/routes/operationsRoutes";
import { registerOrderRoutes } from "../../server/routes/orderRoutes";

function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`, orderDate: "2026-09-01T00:00:00.000+00:00",
    totalAmount: 119, netTotalAmount: 100, status: "in_progress", paymentStatus: "paid", salesChannelId: "sc1",
    items: [{ id: `${id}-1`, name: "Fachbodenregal", quantity: 1, price: 119, netPrice: 100, total: 119, netTotal: 100, taxRate: 19 }],
    ...overrides,
  } as Order;
}

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
  vi.spyOn(ShopwareClient.prototype as any, "updateOrderShipping").mockImplementation(async (orderId: string) => {
    if (state.failShipping.has(orderId)) throw new Error("Shopware-Fehler");
    state.shippingUpdates.push(orderId);
  });
  const app = express();
  app.use(express.json());
  registerOperationsRoutes(app as any);
  registerOrderRoutes(app as any);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  state.cacheCalls = [];
  state.syncCalls = [];
  state.shippingUpdates = [];
  state.failShipping = new Set();
  state.orders = [
    order("offen-bezahlt", { status: "open", paymentStatus: "paid" }),
    order("bearbeitung-autorisiert", { paymentStatus: "authorized" }),
    order("unbezahlt", { paymentStatus: "open" }),
    order("fertig", { status: "completed" }),
    order("stapler", { items: [{ id: "s-1", name: "Lieferung mit Mitnahmestapler", quantity: 1, price: 50, netPrice: 42, total: 50, netTotal: 42, taxRate: 19 }] as any }),
    order("buehne", { customFields: { lieferhinweis: "Hebebühne erforderlich" } } as any),
    order("dublette-alt", { orderNumber: "SW-dup", updatedAt: "2026-07-07T13:10:05Z" }),
    order("dublette-neu", { orderNumber: "SW-dup", updatedAt: "2026-07-07T14:00:28Z" }),
  ];
});

describe("GET /api/shipping", () => {
  it("versandbereit (bezahlt/autorisiert, offen/in Bearbeitung) aus dem Spiegel des Mandanten, eine je Bestellnummer", async () => {
    const r = await (await fetch(`${base}/api/shipping`)).json();
    expect(r.map((o: any) => o.id).sort()).toEqual(["bearbeitung-autorisiert", "buehne", "dublette-neu", "offen-bezahlt", "stapler"]);
    expect(state.cacheCalls).toEqual([{ tenantId: "tenant-a", forceRefresh: false }]);
  });

  it("Ausruestungs-Kennzeichen aus Positionen und Zusatzfeldern", async () => {
    const r = await (await fetch(`${base}/api/shipping`)).json();
    const byId = Object.fromEntries(r.map((o: any) => [o.id, o]));
    expect(byId["stapler"]).toMatchObject({ requiresMitnahmestapler: true, requiresHebebuehne: false });
    expect(byId["buehne"]).toMatchObject({ requiresMitnahmestapler: false, requiresHebebuehne: true });
  });

  it("refresh=1 stoesst vorher einen Abgleich an", async () => {
    await fetch(`${base}/api/shipping?refresh=1`);
    expect(state.cacheCalls).toEqual([{ tenantId: "tenant-a", forceRefresh: true }]);
  });
});

describe("POST /api/orders/bulk-tracking", () => {
  const post = (body: unknown) => fetch(`${base}/api/orders/bulk-tracking`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("nach erfolgreichen Updates wird der Bestell-Spiegel des Mandanten abgeglichen", async () => {
    const r = await (await post({ orderIds: ["a", "b"], trackingNumbers: ["T1", "T2"] })).json();
    expect(r).toEqual({ success: true, updated: 2 });
    expect(state.shippingUpdates).toEqual(["a", "b"]);
    expect(state.syncCalls).toEqual([{ tenantId: "tenant-a", entities: ["orders"] }]);
  });

  it("ohne erfolgreiches Update kein Abgleich", async () => {
    state.failShipping = new Set(["a"]);
    const r = await (await post({ orderIds: ["a"], trackingNumbers: ["T1"] })).json();
    expect(r).toEqual({ success: true, updated: 0 });
    expect(state.syncCalls).toEqual([]);
  });
});
