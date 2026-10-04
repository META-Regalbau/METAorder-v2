/**
 * Rechte und Verkaufskanaele der schreibenden Versand-/Rechnungs-Routen einer Bestellung:
 * PATCH /api/orders/:orderId/shipping, POST /api/orders/:orderId/mark-shipped,
 * POST /api/orders/:orderId/submit-to-mondu, POST /api/orders/bulk-tracking - echte Routen und
 * echte Rechte-Middleware, Anmeldung, Kanaele, Spiegel und Shopware gemockt.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  permissions: {} as Record<string, boolean>,
  channels: null as string[] | null,
  calls: [] as string[],
}));
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  // nur die Anmeldung simuliert - die Rechte-Pruefung (requireEditOrders usw.) ist echt
  const requireAuth = (req: any, _res: any, next: () => void) => {
    req.user = { id: "u1", role: "employee", roleDetails: { name: "Mitarbeiter", permissions: state.permissions } };
    req.tenantId = "tenant-a";
    next();
  };
  return { ...actual, requireAuth };
});
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return { ...actual, getSalesChannelFilter: async () => state.channels };
});
vi.mock("../../server/shopware/shopwareMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/shopware/shopwareMirror")>();
  return { ...actual, syncShopwareMirrorForTenant: async () => {} };
});
vi.mock("../../server/invoicing/mondu", () => ({
  MonduClient: class {
    async submitInvoice() {
      state.calls.push("mondu");
      return { invoice: { uuid: "mi-1", state: "created" } };
    }
  },
}));

import { storage } from "../../server/storage";
import { ShopwareClient } from "../../server/shopware/shopware";
import { webhookService } from "../../server/lib/webhookService";
import { registerOrderRoutes } from "../../server/routes/orderRoutes";

// Spiegel: o-sc1 in Kanal sc1, o-sc2 in Kanal sc2; o-neu nur live in Shopware (Kanal sc1)
const mirror = new Map<string, any>([
  ["o-sc1", { shopwareId: "o-sc1", salesChannelId: "sc1", payload: { id: "o-sc1", salesChannelId: "sc1" } }],
  ["o-sc2", { shopwareId: "o-sc2", salesChannelId: "sc2", payload: { id: "o-sc2", salesChannelId: "sc2" } }],
]);

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
  vi.spyOn(storage, "getMonduSettings").mockResolvedValue({ apiKey: "m" } as any);
  vi.spyOn(storage, "getShopwareOrderMirrorByShopwareId").mockImplementation(async (id: string) => mirror.get(id));
  vi.spyOn(webhookService, "trigger").mockResolvedValue(undefined as any);
  const proto = ShopwareClient.prototype as any;
  vi.spyOn(proto, "fetchOrders").mockImplementation(async (_sc: unknown, opts?: { ids?: string[] }) =>
    opts?.ids?.[0] === "o-neu" ? [{ id: "o-neu", salesChannelId: "sc1" }] : [],
  );
  vi.spyOn(proto, "updateOrderShipping").mockImplementation(async (id: string) => { state.calls.push(`shipping:${id}`); });
  vi.spyOn(proto, "fetchOrderDocuments").mockResolvedValue([{ id: "doc-1", type: "invoice", number: "RE-1", deepLinkCode: "dl" }]);
  vi.spyOn(proto, "setOrderShipped").mockImplementation(async (id: string) => { state.calls.push(`shipped:${id}`); });
  vi.spyOn(proto, "sendInvoiceEmail").mockImplementation(async (id: string) => { state.calls.push(`mail:${id}`); });
  vi.spyOn(proto, "downloadDocumentPdf").mockResolvedValue(new Blob(["%PDF"]));
  const app = express();
  app.use(express.json());
  registerOrderRoutes(app as any);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  state.permissions = {};
  state.channels = ["sc1"];
  state.calls = [];
});

const send = (method: string, path: string, body: unknown = {}) =>
  fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const shipping = (id: string) => send("PATCH", `/api/orders/${id}/shipping`, { trackingNumber: "T1" });
const markShipped = (id: string) => send("POST", `/api/orders/${id}/mark-shipped`);
const mondu = (id: string) => send("POST", `/api/orders/${id}/submit-to-mondu`, { monduOrderUuid: "mo-1", invoiceNumber: "RE-1", grossAmountCents: 11900 });

describe("PATCH /api/orders/:orderId/shipping", () => {
  it("ohne Recht 'Bestellungen bearbeiten': 403, nichts geaendert", async () => {
    expect((await shipping("o-sc1")).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("mit Recht: eigener Kanal ja, fremder Kanal und keine Kanaele nein", async () => {
    state.permissions = { editOrders: true };
    expect((await shipping("o-sc1")).status).toBe(200);
    expect((await shipping("o-sc2")).status).toBe(403);
    state.channels = [];
    expect((await shipping("o-sc1")).status).toBe(403);
    expect(state.calls).toEqual(["shipping:o-sc1"]);
  });

  it("alle Kanaele (Admin bzw. Rolle ohne Kanalliste): auch fremde Kanaele", async () => {
    state.permissions = { editOrders: true };
    state.channels = null;
    expect((await shipping("o-sc2")).status).toBe(200);
  });

  it("Bestellung noch nicht im Spiegel: Kanal live geprueft; unbekannt: 404", async () => {
    state.permissions = { editOrders: true };
    expect((await shipping("o-neu")).status).toBe(200);
    expect((await shipping("gibt-es-nicht")).status).toBe(404);
    expect(state.calls).toEqual(["shipping:o-neu"]);
  });
});

describe("POST /api/orders/:orderId/mark-shipped (verschickt die Rechnung)", () => {
  it("braucht 'Bestellungen bearbeiten' UND 'Dokumente verwalten'", async () => {
    state.permissions = { editOrders: true };
    expect((await markShipped("o-sc1")).status).toBe(403);
    state.permissions = { manageDocuments: true };
    expect((await markShipped("o-sc1")).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("eigener Kanal: versendet und Rechnung verschickt; fremder Kanal: 403, keine Mail", async () => {
    state.permissions = { editOrders: true, manageDocuments: true };
    expect((await markShipped("o-sc1")).status).toBe(200);
    expect((await markShipped("o-sc2")).status).toBe(403);
    expect(state.calls).toEqual(["shipped:o-sc1", "mail:o-sc1"]);
  });
});

describe("POST /api/orders/:orderId/submit-to-mondu", () => {
  it("braucht 'Buchhaltung verwalten'", async () => {
    state.permissions = { editOrders: true, manageDocuments: true };
    expect((await mondu("o-sc1")).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("eigener Kanal: eingereicht; fremder Kanal: 403, nichts eingereicht", async () => {
    state.permissions = { manageAccounting: true };
    expect((await mondu("o-sc1")).status).toBe(200);
    expect((await mondu("o-sc2")).status).toBe(403);
    expect(state.calls).toEqual(["mondu"]);
  });
});

describe("POST /api/orders/bulk-tracking", () => {
  const bulk = (orderIds: string[]) => send("POST", "/api/orders/bulk-tracking", { orderIds, trackingNumbers: orderIds.map((_, i) => `T${i}`) });

  it("eine Bestellung aus fremdem Kanal: 403, keine einzige geaendert", async () => {
    state.permissions = { editOrders: true };
    const r = await bulk(["o-sc1", "o-sc2"]);
    expect(r.status).toBe(403);
    expect((await r.json()).orders).toEqual([{ orderId: "o-sc2", status: 403, error: "You don't have access to this order's sales channel" }]);
    expect(state.calls).toEqual([]);
  });

  it("alle aus eigenen Kanaelen: alle geaendert", async () => {
    state.permissions = { editOrders: true };
    const r = await bulk(["o-sc1", "o-neu"]);
    expect(await r.json()).toEqual({ success: true, updated: 2 });
    expect(state.calls).toEqual(["shipping:o-sc1", "shipping:o-neu"]);
  });
});
