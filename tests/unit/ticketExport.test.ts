/**
 * Ticket-Export (POST /api/tickets/export): dieselben Tickets wie die Ticketliste (GET /api/tickets) -
 * Verkaufskanaele von Nutzer und Rolle, Tickets ohne Bestellbezug nur fuer Ersteller bzw.
 * Zugewiesene, Admin alle - ohne alle Bestellungen live zu laden. Echte Routen, Anmeldung, Kanaele,
 * Speicher und Shopware gemockt.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({ channels: null as string[] | null, liveAll: 0, byIds: [] as string[][] }));
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return { ...actual, getSalesChannelFilter: async () => state.channels };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => { req.user = { id: "u1", role: "employee", roleDetails: { name: "Mitarbeiter" } }; req.tenantId = "tenant-a"; next(); };
  return { ...actual, requireAuth: pass, requireViewTickets: pass };
});

import { storage } from "../../server/storage";
import { ShopwareClient } from "../../server/shopware/shopware";
import { registerTicketRoutes } from "../../server/routes/ticketRoutes";

const ticket = (n: string, overrides: Record<string, unknown> = {}) => ({
  id: `t-${n}`, ticketNumber: `T-${n}`, title: `Ticket ${n}`, description: "x", status: "open", priority: "normal", category: "general",
  orderId: null, orderNumber: null, createdByUserId: "andere", assignedToUserId: null, tags: [], createdAt: new Date("2026-09-01"), updatedAt: null,
  ...overrides,
});
const TICKETS = [
  ticket("kanal1", { orderId: "o-sc1", orderNumber: "SW-1" }),
  ticket("kanal2", { orderId: "o-sc2", orderNumber: "SW-2" }),
  ticket("eigenes", { createdByUserId: "u1" }),
  ticket("zugewiesen", { assignedToUserId: "u1" }),
  ticket("fremdes"),
];

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getAllTickets").mockImplementation(async () => structuredClone(TICKETS) as any);
  vi.spyOn(storage, "getAllUsers").mockResolvedValue([{ id: "u1", username: "anna" }] as any);
  vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
  vi.spyOn(ShopwareClient.prototype as any, "fetchOrders").mockImplementation(async () => {
    state.liveAll += 1;
    return [];
  });
  vi.spyOn(ShopwareClient.prototype as any, "fetchOrdersByIds").mockImplementation(async (ids: string[]) => {
    state.byIds.push([...ids].sort());
    return new Map([["o-sc1", { id: "o-sc1", salesChannelId: "sc1" }], ["o-sc2", { id: "o-sc2", salesChannelId: "sc2" }]].filter(([id]) => ids.includes(id as string)) as any);
  });
  const app = express();
  app.use(express.json());
  registerTicketRoutes(app as any, { useObjectStorage: false });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  state.channels = null;
  state.liveAll = 0;
  state.byIds = [];
});

const exported = async (filters?: Record<string, unknown>) => {
  const r = await fetch(`${base}/api/tickets/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "csv", filters }) });
  const lines = (await r.text()).split("\n").slice(1).filter(Boolean);
  return lines.map((l) => l.split(",")[0].replace(/"/g, "")).sort();
};
const listed = async () => ((await (await fetch(`${base}/api/tickets`)).json()) as any[]).map((t) => t.ticketNumber).sort();

describe("POST /api/tickets/export", () => {
  it.each([
    ["eigene Kanaele", ["sc1"], ["T-eigenes", "T-kanal1", "T-zugewiesen"]],
    ["keine Kanaele", [], ["T-eigenes", "T-zugewiesen"]],
    ["alle Kanaele (Admin bzw. Rolle ohne Kanalliste)", null, ["T-eigenes", "T-fremdes", "T-kanal1", "T-kanal2", "T-zugewiesen"]],
  ] as const)("%s: dieselben Tickets wie die Ticketliste", async (_name, channels, expected) => {
    state.channels = channels as any;
    expect(await exported()).toEqual(expected);
    expect(await listed()).toEqual(expected);
  });

  it("laedt nicht alle Bestellungen live, nur die Kanaele der referenzierten", async () => {
    state.channels = ["sc1"];
    await exported();
    expect(state.liveAll).toBe(0);
    expect(state.byIds).toEqual([["o-sc1", "o-sc2"]]);
  });

  it("Filter wirken weiter auf die sichtbaren Tickets", async () => {
    state.channels = ["sc1"];
    expect(await exported({ search: "zugewiesen" })).toEqual(["T-zugewiesen"]);
  });
});
