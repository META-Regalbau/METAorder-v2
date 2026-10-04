/**
 * CPQ-Core-Routen (echte Express-App, Speicher und Warenkorb-Transfer gemockt):
 * Submit-Entscheidung (A/B akzeptiert, C zur Pruefung) und Adapter-Transfer
 * (vorbereitet / blockiert mit Hinweis / ohne Warenkorb uebersprungen).
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../server/cpq/cpqStorage", () => ({
  cpqStorage: { getSystem: vi.fn(), createConfiguration: vi.fn() },
}));
vi.mock("../../server/cpq/cpqCartTransfer", () => ({ prepareCpqCartTransfer: vi.fn() }));

import { cpqStorage } from "../../server/cpq/cpqStorage";
import { prepareCpqCartTransfer } from "../../server/cpq/cpqCartTransfer";
import { registerCpqCoreRoutes } from "../../server/cpq-core/cpqCoreRoutes";
import type { CpqConstraintRule } from "../../server/cpq-core";

const getSystem = vi.mocked(cpqStorage.getSystem);
const createConfiguration = vi.mocked(cpqStorage.createConfiguration);
const prepareTransfer = vi.mocked(prepareCpqCartTransfer);

const rules: CpqConstraintRule[] = [
  { ruleId: "GEO-01", category: "geometry", severity: "hard", messageDe: "Boden tiefer als Rahmen", isActive: true, sortOrder: 10 },
  { ruleId: "GEO-02", category: "geometry", severity: "hard", messageDe: "Bodenbreite muss Rahmenbreite entsprechen", isActive: true, sortOrder: 20 },
  { ruleId: "GEO-06", category: "geometry", severity: "hard", messageDe: "Verankerung ist erforderlich", isActive: true, sortOrder: 30 },
  { ruleId: "OBF-03", category: "oberflaeche", severity: "trigger", messageDe: "Sonderfarbe aktiv", isActive: true, sortOrder: 40 },
  { ruleId: "BODEN-03", category: "boden", severity: "default", messageDe: "Default fuer Werkstatt: Stahl verzinkt", isActive: true, sortOrder: 50 },
];
const configuration = {
  frame: { heightMm: 2500, depthMm: 800, widthMm: 1000, anchoringIncluded: true },
  shelves: [{ material: "stahl_verzinkt", maxFachlastKg: 180, depthMm: 800, widthMm: 1000, count: 4 }],
  accessories: [],
  application: "werkstatt",
  leadTimeDays: 3,
};
const body = (overrides: { configuration?: Record<string, unknown>; cartTransfer?: unknown } = {}) => ({
  context: { customerGroup: "b2c" },
  systemId: "sys-1",
  rules,
  configuration: { ...configuration, ...overrides.configuration },
  ...(overrides.cartTransfer ? { cartTransfer: overrides.cartTransfer } : {}),
});
const classB = { leadTimeDays: 10 };
const classC = { ralColor: "3001" };
const cart = { cart_items: [{ product_id: "pdp-product", product_number: "SKU-1", quantity: 2 }], customer_id: "customer-1", sales_channel_id: "channel-1", create_offer: true };
const transferResult = { success: true as const, message: "ok", cartItems: 1, lineItems: [{ productId: "pdp-product", quantity: 2 }], adminOfferUrl: "https://shop/admin/offer/1" };

let server: Server;
let baseUrl = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const tenant = req.header("x-test-tenant");
    if (tenant) (req as any).tenantId = tenant;
    next();
  });
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  registerCpqCoreRoutes(app, { requireAuth: pass, requireViewCPQ: pass, requireManageCPQ: pass } as any);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  vi.clearAllMocks();
  getSystem.mockResolvedValue({ id: "sys-1" } as any);
  createConfiguration.mockImplementation(async (data: any) => ({ id: "cfg-1", ...data }));
  prepareTransfer.mockResolvedValue(transferResult);
});

async function post(path: string, payload: unknown, tenant: string | null = "tenant-a") {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(tenant ? { "x-test-tenant": tenant } : {}) },
    body: JSON.stringify(payload),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("POST /api/cpq-core/submit", () => {
  it("Klasse A: akzeptiert, ohne Pruefung gespeichert", async () => {
    const r = await post("/api/cpq-core/submit", body());
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ configurationId: "cfg-1", classification: "A", status: "accepted", requiresReview: false, reviewStatus: "not_required" });
    expect(createConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ validationStatus: "valid", reviewRequired: false, reviewStatus: "not_required", reviewRequestedAt: null }),
      "tenant-a",
    );
  });

  it("Klasse B: akzeptiert", async () => {
    const r = await post("/api/cpq-core/submit", body({ configuration: classB }));
    expect(r.json).toMatchObject({ classification: "B", status: "accepted", requiresReview: false, reviewStatus: "not_required" });
  });

  it("Klasse C: zur Pruefung (pending), mit Zeitpunkt der Anforderung gespeichert", async () => {
    const r = await post("/api/cpq-core/submit", body({ configuration: classC }));
    expect(r.json).toMatchObject({ classification: "C", status: "review_required", requiresReview: true, reviewStatus: "pending" });
    expect(r.json.disclaimers.length).toBeGreaterThanOrEqual(1);
    const saved = createConfiguration.mock.calls[0][0] as any;
    expect(saved).toMatchObject({ validationStatus: "warnings", reviewRequired: true, reviewStatus: "pending" });
    expect(saved.reviewRequestedAt).toBeInstanceOf(Date);
  });

  it("ungueltige Konfiguration: 400 mit Validierung, nichts gespeichert", async () => {
    const r = await post("/api/cpq-core/submit", body({ configuration: { shelves: [{ ...configuration.shelves[0], depthMm: 900 }] } }));
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "Configuration invalid", validation: { valid: false } });
    expect(createConfiguration).not.toHaveBeenCalled();
  });

  it("unbekanntes System: 404; ohne Mandant: 400", async () => {
    getSystem.mockResolvedValueOnce(undefined as any);
    expect(await post("/api/cpq-core/submit", body())).toMatchObject({ status: 404, json: { error: "System not found for tenant" } });
    expect(await post("/api/cpq-core/submit", body(), null)).toMatchObject({ status: 400, json: { error: "Tenant not selected" } });
    expect(createConfiguration).not.toHaveBeenCalled();
  });
});

describe("POST /api/cpq-core/adapter/submit-transfer", () => {
  it("Klasse A mit Warenkorb: Transfer vorbereitet (Menge, Kunde, Verkaufskanal weitergereicht)", async () => {
    const r = await post("/api/cpq-core/adapter/submit-transfer", body({ cartTransfer: cart }));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ classification: "A", status: "accepted", requiresReview: false, transfer: { status: "prepared", ...transferResult } });
    expect(prepareTransfer).toHaveBeenCalledWith({
      cartItems: [{ product_id: "pdp-product", product_number: "SKU-1", quantity: 2 }],
      tenantId: "tenant-a",
      customerId: "customer-1",
      salesChannelId: "channel-1",
      createOffer: true,
    });
  });

  it("Klasse B mit Warenkorb: Transfer vorbereitet", async () => {
    const r = await post("/api/cpq-core/adapter/submit-transfer", body({ configuration: classB, cartTransfer: cart }));
    expect(r.json).toMatchObject({ classification: "B", transfer: { status: "prepared" } });
  });

  it("Klasse C mit Warenkorb: Transfer blockiert mit Pruef-Hinweis, nichts an Shopware", async () => {
    const r = await post("/api/cpq-core/adapter/submit-transfer", body({ configuration: classC, cartTransfer: cart }));
    expect(r.json).toMatchObject({
      classification: "C",
      status: "review_required",
      requiresReview: true,
      reviewStatus: "pending",
      transfer: { status: "blocked", reason: "review_required", nextAction: "review_queue" },
    });
    expect(r.json.transfer.reviewHint).toContain("Checkout bleibt gesperrt");
    expect(prepareTransfer).not.toHaveBeenCalled();
  });

  it("ohne Warenkorb: uebersprungen (auch bei Klasse C), nichts an Shopware", async () => {
    for (const cfg of [{}, classC]) {
      const r = await post("/api/cpq-core/adapter/submit-transfer", body({ configuration: cfg }));
      expect(r.json.transfer).toEqual({ status: "skipped", reason: "no_cart_items" });
    }
    expect(prepareTransfer).not.toHaveBeenCalled();
  });

  it("leerer Warenkorb ist ungueltig (400), Artikel ohne product_id ebenso", async () => {
    expect((await post("/api/cpq-core/adapter/submit-transfer", body({ cartTransfer: { cart_items: [] } }))).status).toBe(400);
    expect((await post("/api/cpq-core/adapter/submit-transfer", body({ cartTransfer: { cart_items: [{ product_id: "", quantity: 1 }] } }))).status).toBe(400);
    expect(createConfiguration).not.toHaveBeenCalled();
  });
});
