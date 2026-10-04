/**
 * Versandliste aus dem Bestell-Spiegel (GET /api/shipping, nur eigene Verkaufskanaele),
 * Spiegel-Abgleich nach Sammel-Tracking und einzelner Versandmeldung (POST /api/orders/bulk-tracking,
 * PATCH /api/orders/:orderId/shipping) und Kanal-Pruefung der Automatisierungs-Historie einer
 * Bestellung - echte Routen, Abhaengigkeiten gemockt.
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
  channels: null as string[] | null,
  user: { id: "u1", roleDetails: { permissions: { viewOrders: true } } } as any,
}));
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return {
    ...actual,
    getSalesChannelFilter: async () => state.channels,
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
  const pass = (req: any, _res: any, next: () => void) => { req.user = state.user; req.tenantId = "tenant-a"; next(); };
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
  state.channels = null;
  state.user = { id: "u1", roleDetails: { permissions: { viewOrders: true } } };
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

  it("nur die eigenen Verkaufskanaele; ohne Kanal keine Bestellungen", async () => {
    state.orders.push(order("kanal2", { salesChannelId: "sc2" }));
    state.channels = ["sc2"];
    expect((await (await fetch(`${base}/api/shipping`)).json()).map((o: any) => o.id)).toEqual(["kanal2"]);
    state.channels = [];
    expect(await (await fetch(`${base}/api/shipping`)).json()).toEqual([]);
    state.channels = null;
    expect((await (await fetch(`${base}/api/shipping`)).json())).toHaveLength(6);
  });
});

describe("GET /api/erp-automation/history/:orderId", () => {
  const mirrorRows = new Map<string, any>([
    ["o-sc1", { shopwareId: "o-sc1", salesChannelId: "sc1", payload: { id: "o-sc1", salesChannelId: "sc1" } }],
    ["o-sc2", { shopwareId: "o-sc2", salesChannelId: "sc2", payload: { id: "o-sc2", salesChannelId: "sc2" } }],
  ]);
  let liveRequests: unknown[] = [];
  let liveOrders: Order[] = [];
  beforeAll(() => {
    vi.spyOn(storage, "getShopwareOrderMirrorByShopwareId").mockImplementation(async (id: string) => mirrorRows.get(id));
    vi.spyOn(storage, "getErpAutomationRunsByOrderId").mockImplementation(async (id: string) => [{ id: `run-${id}` }] as any);
    vi.spyOn(ShopwareClient.prototype as any, "fetchOrders").mockImplementation(async (_x: unknown, opts?: unknown) => {
      liveRequests.push(opts);
      return liveOrders;
    });
  });
  beforeEach(() => {
    liveRequests = [];
    liveOrders = [];
  });
  const get = async (id: string) => {
    const r = await fetch(`${base}/api/erp-automation/history/${id}`);
    return { status: r.status, json: await r.json() };
  };

  it("alle Kanaele (Admin bzw. Rolle ohne Kanalliste): Historie ohne Abruf", async () => {
    expect(await get("o-sc2")).toEqual({ status: 200, json: [{ id: "run-o-sc2" }] });
    expect(liveRequests).toEqual([]);
  });

  it("eigener Kanal laut Spiegel: Historie, kein Shopware-Abruf; fremder Kanal: 403; kein Kanal: 403", async () => {
    state.channels = ["sc1"];
    expect((await get("o-sc1")).status).toBe(200);
    expect((await get("o-sc2")).status).toBe(403);
    state.channels = [];
    expect((await get("o-sc1")).status).toBe(403);
    expect(liveRequests).toEqual([]);
  });

  it("fehlt die Bestellung im Spiegel, wird nur diese eine live geholt; unbekannt: 404", async () => {
    state.channels = ["sc1"];
    liveOrders = [{ id: "neu", salesChannelId: "sc1" } as Order];
    expect((await get("neu")).status).toBe(200);
    expect(liveRequests).toEqual([{ ids: ["neu"] }]);
    liveOrders = [];
    expect((await get("gibt-es-nicht")).status).toBe(404);
  });

  it("ohne Berechtigung fuer Bestellungen: 403", async () => {
    state.user = { id: "u2", roleDetails: { permissions: {} } };
    expect((await get("o-sc1")).status).toBe(403);
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

describe("PATCH /api/orders/:orderId/shipping", () => {
  const patch = (id: string, body: unknown) =>
    fetch(`${base}/api/orders/${id}/shipping`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("nach der Versandmeldung wird der Bestell-Spiegel des Mandanten abgeglichen", async () => {
    const r = await patch("a", { carrier: "DHL", trackingNumber: "T1", shippedDate: "2026-10-01" });
    expect(r.status).toBe(200);
    expect(state.shippingUpdates).toEqual(["a"]);
    expect(state.syncCalls).toEqual([{ tenantId: "tenant-a", entities: ["orders"] }]);
  });

  it("schlaegt die Versandmeldung fehl, kein Abgleich", async () => {
    state.failShipping = new Set(["a"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await patch("a", { trackingNumber: "T1" });
    error.mockRestore();
    expect(r.status).toBe(500);
    expect(state.syncCalls).toEqual([]);
  });
});
