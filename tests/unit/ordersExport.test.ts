/**
 * Bestell-Export aus dem Bestell-Spiegel (POST /api/orders/export) - echte Route, Spiegel und
 * Kanalfilter gemockt.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Order } from "../../shared/schema";

const state = vi.hoisted(() => ({ orders: [] as any[], channels: null as string[] | null, tenants: [] as unknown[] }));
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return {
    ...actual,
    getSalesChannelFilter: async () => state.channels,
    getOrdersWithCache: async (_client: unknown, tenantId: unknown) => {
      state.tenants.push(tenantId);
      return { orders: state.orders, fromCache: true };
    },
  };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => { req.user = { id: "u1" }; req.tenantId = "tenant-a"; next(); };
  return { ...actual, requireAuth: pass };
});

import { storage } from "../../server/storage";
import { registerOrderRoutes } from "../../server/routes/orderRoutes";

function order(num: string, day: string, overrides: Partial<Order> = {}): Order {
  return {
    id: `id-${num}`, orderNumber: num, customerName: `Kunde ${num}`, customerEmail: `${num}@example.com`,
    orderDate: `${day}T00:00:00.000+00:00`, totalAmount: 119, netTotalAmount: 100, status: "open", paymentStatus: "paid",
    salesChannelId: "sc1", items: [], invoiceNumber: `RE-${num}`, ...overrides,
  } as Order;
}

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
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
  state.tenants = [];
  state.orders = [
    order("100", "2026-03-30"),
    // bewusst 101 vor 102: ohne Sortierung nach Bestellnummer kaeme 101 zuerst
    order("101", "2026-03-31", { totalAmount: 1234.5, netTotalAmount: 1037.39 }),
    order("102", "2026-03-31"),
    order("200", "2026-04-01", { salesChannelId: "sc2" }),
    order("300", "2026-02-01", { updatedAt: "2026-02-02T00:00:00Z", customerName: "Alt" }),
    order("300", "2026-02-01", { id: "id-300-neu", updatedAt: "2026-02-05T00:00:00Z", customerName: "Neu" }),
  ];
});

const exportJson = async (body: Record<string, unknown>) => {
  const r = await fetch(`${base}/api/orders/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "json", ...body }) });
  return r.json() as Promise<any[]>;
};

describe("POST /api/orders/export", () => {
  it("Spalten wie bisher, neueste zuerst (gleicher Tag: Bestellnummer absteigend), eine Zeile je Bestellnummer", async () => {
    const rows = await exportJson({ columns: ["orderNumber", "customerName", "orderDate", "totalAmount", "netTotalAmount", "invoiceNumber", "carrier"] });
    expect(rows.map((r) => r["Order Number"])).toEqual(["200", "102", "101", "100", "300"]);
    expect(rows[2]).toEqual({
      "Order Number": "101", "Customer Name": "Kunde 101", "Order Date": "31.3.2026",
      "Total Amount (Gross)": "€1234.50", "Total Amount (Net)": "€1037.39", "Invoice Number": "RE-101", Carrier: "",
    });
    expect(rows.find((r) => r["Order Number"] === "300")["Customer Name"]).toBe("Neu");
    expect(state.tenants).toEqual(["tenant-a"]);
  });

  it("Zeitraum einschliesslich", async () => {
    const rows = await exportJson({ columns: ["orderNumber"], dateFrom: "2026-03-31", dateTo: "2026-03-31" });
    expect(rows.map((r) => r["Order Number"])).toEqual(["102", "101"]);
  });

  it("Kanaele: alle -> optional Auswahl; eigene -> nur diese (Auswahl erweitert nichts); keiner -> leer", async () => {
    expect((await exportJson({ columns: ["orderNumber"], salesChannelIds: ["sc2"] })).map((r) => r["Order Number"])).toEqual(["200"]);
    state.channels = ["sc1"];
    expect((await exportJson({ columns: ["orderNumber"], salesChannelIds: ["sc2"] })).map((r) => r["Order Number"])).toEqual(["102", "101", "100", "300"]);
    state.channels = [];
    expect(await exportJson({ columns: ["orderNumber"] })).toEqual([]);
  });

  it("CSV (mit BOM) und XLSX", async () => {
    const csv = await fetch(`${base}/api/orders/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "csv", columns: ["orderNumber"] }) });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const bytes = Buffer.from(await csv.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM fuer Excel
    expect(bytes.subarray(3).toString("utf8")).toBe("Order Number\n200\n102\n101\n100\n300");
    const xlsx = await fetch(`${base}/api/orders/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "xlsx", columns: ["orderNumber"] }) });
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml");
    expect((await xlsx.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
