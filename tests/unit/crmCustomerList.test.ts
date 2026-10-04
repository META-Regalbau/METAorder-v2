/**
 * CRM-Kundenliste (GET /api/crm/customers): Bestellanzahl, Umsatz und letzte Bestellung je Kunde aus
 * dem Bestell-Spiegel, mehrfach vergebene Bestellnummern zaehlen einmal - echte Route, Spiegel,
 * Shopware und Speicher gemockt.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// Abgleich des Spiegels startet nebenbei die ERP-Bestandsbuchung (ohne await); ihr Fehler gegen die
// absichtlich unerreichbare Test-DB kam teils erst nach dem Testende und liess den Lauf scheitern.
vi.mock("../../server/erp/erpShopwareSalesStock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/erp/erpShopwareSalesStock")>()),
  triggerShopwareSalesStockSync: () => {},
}));
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Order } from "../../shared/schema";

const state = vi.hoisted(() => ({ orders: [] as any[], tenant: "tenant-0", n: 0 }));
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return { ...actual, getSalesChannelFilter: async () => null, getOrdersWithCache: async () => ({ orders: state.orders, fromCache: true }) };
});
vi.mock("../../server/shopware/shopwareMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/shopware/shopwareMirror")>();
  return { ...actual, triggerShopwareMirrorSync: () => {} };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => { req.user = { id: "u1" }; req.tenantId = state.tenant; next(); };
  return { ...actual, requireAuth: pass, requireViewCrm: pass };
});

import { storage } from "../../server/storage";
import { ShopwareClient } from "../../server/shopware/shopware";
import { registerCrmRoutes } from "../../server/routes/crmRoutes";

function order(id: string, email: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${email}`, customerEmail: email, orderDate: "2026-06-17T00:00:00.000+00:00",
    createdAt: "2026-06-17T08:14:15.000+00:00", totalAmount: 100, netTotalAmount: 84, status: "in_progress", paymentStatus: "authorized",
    salesChannelId: "sc1", items: [], ...overrides,
  } as Order;
}

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
  vi.spyOn(storage, "getAllCustomers").mockResolvedValue([]);
  vi.spyOn(storage, "getAllTickets").mockResolvedValue([]);
  vi.spyOn(storage, "countShopwareCustomerMirrors").mockResolvedValue(0);
  vi.spyOn(storage, "getShopwareCustomerMirrors").mockResolvedValue([]);
  vi.spyOn(storage, "countShopwareCustomerPriceMirrors").mockResolvedValue(0);
  vi.spyOn(storage, "getCustomerInteractionSummaries").mockResolvedValue(new Map());
  vi.spyOn(storage, "getSetting").mockResolvedValue(undefined as any);
  vi.spyOn(storage, "saveSetting").mockResolvedValue(undefined as any);
  vi.spyOn(ShopwareClient.prototype as any, "fetchOrdersFingerprint").mockImplementation(async () => `fp-${state.n}`);
  vi.spyOn(ShopwareClient.prototype as any, "fetchIndividualPriceCustomerFingerprint").mockResolvedValue("ip");
  vi.spyOn(ShopwareClient.prototype as any, "fetchIndividualPriceCustomerIndex").mockResolvedValue({ emails: [] });
  const app = express();
  app.use(express.json());
  registerCrmRoutes(app as any);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  // eigener Mandant je Test: der Hash-Cache haelt die Liste im Speicher
  state.n += 1;
  state.tenant = `tenant-${state.n}`;
});

const customers = async () => {
  const r = await fetch(`${base}/api/crm/customers`);
  const json = await r.json();
  return Object.fromEntries(json.customers.map((c: any) => [c.email, c]));
};

describe("GET /api/crm/customers", () => {
  it("doppelt angelegte Bestellung zaehlt bei Anzahl und Umsatz einmal", async () => {
    state.orders = [
      order("a1", "a@example.com", { orderNumber: "278278", totalAmount: 9660.22, updatedAt: "2026-06-18T12:42:05Z" }),
      order("a2", "a@example.com", { orderNumber: "278278", totalAmount: 9660.22, updatedAt: "2026-06-18T12:42:18Z" }),
      order("a3", "a@example.com", { totalAmount: 500, orderDate: "2026-05-02T00:00:00.000+00:00" }),
      order("b", "b@example.com", { totalAmount: 119 }),
    ];
    const list = await customers();
    expect(list["a@example.com"]).toMatchObject({ totalOrders: 2, totalRevenue: 10160.22, lastOrderNumber: "278278" });
    expect(list["b@example.com"]).toMatchObject({ totalOrders: 1, totalRevenue: 119 });
  });

  it("letzte Bestellung: die gezaehlte Kopie (zuletzt geaendert), nicht eine juengere Dublette", async () => {
    state.orders = [
      order("d1", "d@example.com", { orderNumber: "286101", totalAmount: 26119.95, orderDate: "2026-07-07T00:00:00.000+00:00", updatedAt: "2026-07-07T13:40:01Z" }),
      order("d3", "d@example.com", { orderNumber: "286101", totalAmount: 35861.3, orderDate: "2026-07-14T00:00:00.000+00:00", updatedAt: "2026-07-14T08:00:01Z" }),
      order("d2", "d@example.com", { orderNumber: "286101", totalAmount: 26119.95, orderDate: "2026-07-07T00:00:00.000+00:00", updatedAt: "2026-07-07T13:50:04Z" }),
    ];
    expect((await customers())["d@example.com"]).toMatchObject({ totalOrders: 1, totalRevenue: 35861.3, lastOrderDate: "2026-07-14T00:00:00.000+00:00" });
  });
});
