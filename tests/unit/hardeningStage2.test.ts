/**
 * Härtung Stufe 2 (24.10.2026): Kanalprüfung bei Ticket-Unterrouten, Angeboten und Bestelldokumenten.
 * Echte Routen; Anmeldung, Kanäle, Speicher und Shopware gemockt.
 *
 *   Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({ channels: null as string[] | null }));
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return { ...actual, getSalesChannelFilter: async () => state.channels };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = { id: "u1", role: "employee", roleDetails: { name: "Mitarbeiter" } };
    req.tenantId = "tenant-a";
    next();
  };
  return { ...actual, requireAuth: pass, requireAuthOrIntegrationKey: pass, requireViewTickets: pass, requireViewOffers: pass };
});

import { storage } from "../../server/storage";
import { ShopwareClient } from "../../server/shopware/shopware";
import { B2BSellersClient } from "../../server/b2b/b2bSellersClient";
import { registerTicketRoutes } from "../../server/routes/ticketRoutes";
import { registerOfferRoutes } from "../../server/routes/offerRoutes";
import { registerOrderRoutes } from "../../server/routes/orderRoutes";

const ORDER_SC1 = "a".repeat(32);
const ORDER_SC2 = "b".repeat(32);
const DOC_OF_SC1 = "c".repeat(32);
const OFFER_SC2 = "d".repeat(32);

const ticket = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, ticketNumber: id, title: id, status: "open", orderId: null, createdByUserId: "andere", assignedToUserId: null, ...overrides,
});
const TICKETS: Record<string, any> = {
  "t-kanal1": ticket("t-kanal1", { orderId: ORDER_SC1 }),
  "t-kanal2": ticket("t-kanal2", { orderId: ORDER_SC2 }),
  "t-eigenes": ticket("t-eigenes", { createdByUserId: "u1" }),
  "t-fremdes": ticket("t-fremdes"),
};

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getTicket").mockImplementation(async (id: string) => TICKETS[id]);
  vi.spyOn(storage, "getTicketComments").mockResolvedValue([] as any);
  vi.spyOn(storage, "getAllUsers").mockResolvedValue([] as any);
  vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
  vi.spyOn(storage, "getShopwareOrderMirrorByShopwareId").mockImplementation(async (id: string) =>
    ({ [ORDER_SC1]: { salesChannelId: "sc1" }, [ORDER_SC2]: { salesChannelId: "sc2" } } as any)[id]);
  vi.spyOn(storage, "getSetting").mockResolvedValue(undefined as any);
  vi.spyOn(ShopwareClient.prototype as any, "fetchOrdersByIds").mockImplementation(async (ids: string[]) =>
    new Map([[ORDER_SC1, { id: ORDER_SC1, salesChannelId: "sc1" }], [ORDER_SC2, { id: ORDER_SC2, salesChannelId: "sc2" }]].filter(([id]) => ids.includes(id as string)) as any));
  vi.spyOn(ShopwareClient.prototype as any, "fetchOrderDocuments").mockImplementation(async (orderId: string) =>
    orderId === ORDER_SC1 ? [{ id: DOC_OF_SC1, deepLinkCode: "abc" }] : []);
  vi.spyOn(ShopwareClient.prototype as any, "downloadDocumentPdf").mockResolvedValue(new Blob(["%PDF"]));
  vi.spyOn(B2BSellersClient.prototype as any, "fetchOfferById").mockResolvedValue({ data: {}, included: [] });
  vi.spyOn(B2BSellersClient.prototype as any, "mapOffer").mockReturnValue({ id: OFFER_SC2, salesChannelId: "sc2" });
  const app = express();
  app.use(express.json());
  registerTicketRoutes(app as any, { useObjectStorage: false });
  registerOfferRoutes(app as any);
  registerOrderRoutes(app as any);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  state.channels = ["sc1"];
});

const status = async (path: string) => (await fetch(`${base}${path}`)).status;

describe("Ticket-Kommentare und -Verlauf: dieselbe Prüfung wie die Detailansicht", () => {
  it("eigener Kanal und eigenes Ticket ja, fremder Kanal und fremdes Ticket nein", async () => {
    expect(await status("/api/tickets/t-kanal1/comments")).toBe(200);
    expect(await status("/api/tickets/t-eigenes/comments")).toBe(200);
    expect(await status("/api/tickets/t-kanal2/comments")).toBe(403);
    expect(await status("/api/tickets/t-fremdes/comments")).toBe(403);
    expect(await status("/api/tickets/t-fremdes/activity")).toBe(403);
    expect(await status("/api/tickets/fehlt/comments")).toBe(404);
  });

  it("Administrator (kein Kanalfilter) sieht alles", async () => {
    state.channels = null;
    expect(await status("/api/tickets/t-kanal2/comments")).toBe(200);
    expect(await status("/api/tickets/t-fremdes/comments")).toBe(200);
  });
});

describe("Bestelldokumente: Kanal der Bestellung, Dokument muss dazugehören", () => {
  it("Dokument der eigenen Bestellung ja, über fremde Bestellung nein", async () => {
    expect(await status(`/api/orders/${ORDER_SC1}/document/${DOC_OF_SC1}/abc`)).toBe(200);
    expect(await status(`/api/orders/${ORDER_SC2}/document/${DOC_OF_SC1}/abc`)).toBe(403);
    expect(await status(`/api/orders/${ORDER_SC2}/documents`)).toBe(403);
  });

  it("fremdes Dokument mit eigener Bestell-ID: nicht gefunden", async () => {
    expect(await status(`/api/orders/${ORDER_SC1}/document/${"e".repeat(32)}/abc`)).toBe(404);
  });
});

describe("Angebote: Einzelrouten prüfen den Kanal wie die Liste", () => {
  it("Angebot eines fremden Kanals: 403", async () => {
    expect(await status(`/api/offers/${OFFER_SC2}`)).toBe(403);
    expect(await status(`/api/offers/${OFFER_SC2}/share-link`)).toBe(403);
  });
});
