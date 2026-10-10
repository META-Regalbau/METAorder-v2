/**
 * Entwurfs-Routen (echte Express-Routen, Speicher und Anmeldung ersetzt):
 * Anfangsstatus der Pipeline, PATCH-Regeln (kein "created" ohne Shopware-ID, manuelle Preise
 * bleiben), Preis je Position, DB-Freigabe nur mit Recht, Lösen hängender Anlagen nur für
 * Administratoren und erst nach 10 Minuten, DB-Ampel in Listen je Recht.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
}));

vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = state.user;
    req.tenantId = "t1";
    next();
  };
  return {
    ...actual,
    requireAuth: pass,
    requireAuthOrIntegrationKey: pass,
    requireCsrf: (_req: any, _res: any, next: () => void) => next(),
    requireManageOrderDrafts: (_req: any, _res: any, next: () => void) => next(),
    requireManageOffers: (_req: any, _res: any, next: () => void) => next(),
    requireViewOffers: (_req: any, _res: any, next: () => void) => next(),
  };
});

const snapshot = {
  computedAt: "2026-10-10T10:00:00.000Z",
  frozen: false,
  thresholds: { minMarginPercent: 20, warnMarginPercent: 7 },
  summary: {
    herstellkostenTotal: 100,
    db1Total: 30,
    marginPercent: 30,
    marginOnRevenuePercent: 23.1,
    crmVerdict: "green",
    productLineCount: 1,
    linesWithHerstellpreis: 1,
    coveragePercent: 100,
  },
  lines: [],
  unpricedLineCount: 0,
};

vi.mock("../../server/commercial/draftProfitability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/commercial/draftProfitability")>();
  return {
    ...actual,
    refreshDraftProfitability: async () => snapshot,
    // modulintern ruft loadDraftProfitabilityForView die echte Berechnung — deshalb hier ersetzt
    loadDraftProfitabilityForView: async ({ canViewDetails }: { canViewDetails: boolean }) =>
      canViewDetails ? snapshot : actual.hideDraftProfitabilityDetails(snapshot as any),
    scheduleDraftProfitabilityBackfill: () => 0,
  };
});

import { storage } from "../../server/storage";
import { registerDraftRoutes } from "../../server/routes/draftRoutes";
import { determineInitialDraftStatus } from "../../server/commercial/commercialDraftPipeline";

const admin = { id: "u-admin", username: "admin", role: "admin", roleDetails: { name: "Administrator", permissions: {} } };
const clerk = {
  id: "u-sb",
  username: "sb",
  role: "employee",
  roleDetails: { name: "Sachbearbeitung", permissions: { manageOrderDrafts: true } },
};

let server: Server;
let base: string;
let drafts: Record<string, any>;

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerDraftRoutes(app);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  vi.restoreAllMocks();
});

beforeEach(() => {
  state.user = clerk;
  drafts = {
    d1: {
      id: "d1",
      status: "review_required",
      shopwareOrderId: null,
      shopwareCustomerId: "c1",
      originalFileName: "Bestellung.pdf",
      updatedAt: new Date(Date.now() - 20 * 60_000),
      extractedData: {},
      matchingResults: {
        items: [
          { quantity: 1, matchedProduct: { id: "pA", productNumber: "A", manualUnitPriceNet: 120, manualPriceChangedBy: "sb" } },
          { quantity: 1, bundle: { components: [{ productNumber: "S", quantity: 1 }] } },
        ],
        overallConfidence: 100,
      },
    },
  };
  const update = async (id: string, data: Record<string, unknown>) => {
    if (!drafts[id]) return undefined;
    drafts[id] = { ...drafts[id], ...data };
    return drafts[id];
  };
  vi.spyOn(storage, "getOrderDraft").mockImplementation(async (id: string) => drafts[id]);
  vi.spyOn(storage, "updateOrderDraft").mockImplementation(update as any);
  vi.spyOn(storage, "getAllOrderDrafts").mockImplementation(async () => Object.values(drafts));
  vi.spyOn(storage, "getDraftProfitability").mockImplementation(async () => ({ snapshot, frozen: false, verdict: "green" }) as any);
  vi.spyOn(storage, "getDraftProfitabilityByDraftIds").mockImplementation(
    async (_kind, ids: string[]) => new Map(ids.map((id) => [id, { draftId: id, snapshot, frozen: false, verdict: "green" }])) as any,
  );
  vi.spyOn(storage, "getDraftMarginApprovals").mockImplementation(async () => []);
  vi.spyOn(storage, "getLatestDraftMarginApprovals").mockImplementation(async () => new Map());
  vi.spyOn(storage, "createCommercialProductMatchFeedback").mockImplementation(async () => [] as any);
});

describe("Anfangsstatus der Pipeline", () => {
  const base = { intentVsUploadMismatch: false, minIntentReview: 0.6 };
  it.each([
    ["ohne Abgleich", { overallConfidence: undefined }, "pending"],
    ["90 % und sicher", { overallConfidence: 90, intent: { intent: "purchase_order", confidence: 0.9 } }, "approved"],
    ["89 %", { overallConfidence: 89 }, "review_required"],
    ["unsichere Art", { overallConfidence: 100, intent: { intent: "purchase_order", confidence: 0.5 } }, "review_required"],
    ["unklare Art", { overallConfidence: 100, intent: { intent: "unclear", confidence: 0.99 } }, "review_required"],
    [
      "wegen Rechten umgeleitet",
      { overallConfidence: 100, intent: { intent: "quote_request", confidence: 0.99, intentRoutedAsOfferDueToPermission: true } },
      "review_required",
    ],
    ["Widerspruch zum Upload", { overallConfidence: 100, intentVsUploadMismatch: true, intent: { intent: "purchase_order", confidence: 0.99 } }, "review_required"],
  ] as const)("%s → %s", (_label, params, expected) => {
    expect(determineInitialDraftStatus({ ...base, ...(params as any) })).toBe(expected);
  });
});

describe("PATCH /api/order-drafts/:id", () => {
  it("Status 'created' nur über create-order (ohne Shopware-ID 400)", async () => {
    const res = await call("PATCH", "/api/order-drafts/d1", { status: "created" });
    expect(res.status).toBe(400);
    expect(drafts.d1.status).toBe("review_required");
  });

  it("veraltetes Prüffenster ohne Preis: manueller Preis bleibt, Menge wird übernommen", async () => {
    const res = await call("PATCH", "/api/order-drafts/d1", {
      matchingResults: {
        items: [{ quantity: 4, matchedProduct: { id: "pA", productNumber: "A" } }, drafts.d1.matchingResults.items[1]],
        overallConfidence: 100,
      },
    });
    expect(res.status).toBe(200);
    expect(drafts.d1.matchingResults.items[0]).toEqual({
      quantity: 4,
      matchedProduct: { id: "pA", productNumber: "A", manualUnitPriceNet: 120, manualPriceChangedBy: "sb" },
    });
  });
});

describe("PATCH /api/order-drafts/:id/line-price", () => {
  it("setzt Preis mit Protokoll und liefert DB samt Freigabe-Zustand", async () => {
    const res = await call("PATCH", "/api/order-drafts/d1/line-price", { index: 0, unitPriceNet: 130 });
    expect(res.status).toBe(200);
    expect(drafts.d1.matchingResults.items[0].matchedProduct).toMatchObject({ manualUnitPriceNet: 130, manualPriceChangedBy: "sb" });
    // Sachbearbeiter: keine Beträge
    expect(res.body.profitability).toMatchObject({ detailsHidden: true, summary: { db1Total: null, crmVerdict: "green" } });
    expect(res.body.marginApproval).toMatchObject({ required: false, canCreate: true });
  });

  it("Set: 400, angelegter Entwurf: 409, ungültig: 400", async () => {
    expect((await call("PATCH", "/api/order-drafts/d1/line-price", { index: 1, unitPriceNet: 5 })).status).toBe(400);
    expect((await call("PATCH", "/api/order-drafts/d1/line-price", { index: 0, unitPriceNet: "x" })).status).toBe(400);
    drafts.d1.status = "created";
    expect((await call("PATCH", "/api/order-drafts/d1/line-price", { index: 0, unitPriceNet: 5 })).status).toBe(409);
  });
});

describe("DB-Freigabe und Liste je Recht", () => {
  it("Entscheiden nur mit Recht 'DB-Werte sehen'", async () => {
    const res = await call("POST", "/api/order-drafts/d1/margin-approval/decide", { decision: "approve", comment: "Rahmenvertrag ok" });
    expect(res.status).toBe(403);
  });

  it("nicht rot: Anfordern abgelehnt (409)", async () => {
    const res = await call("POST", "/api/order-drafts/d1/margin-approval/request", { reason: "Rahmenvertrag mit Kunde" });
    expect(res.status).toBe(409);
  });

  it("Liste: Admin sieht Aufschlag und DB1, Sachbearbeiter nur die Ampel", async () => {
    const asClerk = await call("GET", "/api/order-drafts");
    expect(asClerk.body[0].profitability).toMatchObject({ crmVerdict: "green", marginPercent: null, db1Total: null });
    state.user = admin;
    const asAdmin = await call("GET", "/api/order-drafts");
    expect(asAdmin.body[0].profitability).toMatchObject({ crmVerdict: "green", marginPercent: 30, db1Total: 30 });
  });
});

describe("POST /api/order-drafts/:id/release-creation", () => {
  beforeEach(() => {
    drafts.d1.status = "creating";
  });

  it("nur Administratoren", async () => {
    expect((await call("POST", "/api/order-drafts/d1/release-creation", {})).status).toBe(403);
  });

  it("frische Sperre (unter 10 Minuten) bleibt", async () => {
    state.user = admin;
    drafts.d1.updatedAt = new Date();
    expect((await call("POST", "/api/order-drafts/d1/release-creation", {})).status).toBe(409);
    expect(drafts.d1.status).toBe("creating");
  });

  it("ohne Shopware-ID zurück in die Prüfung, mit ID als angelegt verknüpft", async () => {
    state.user = admin;
    expect((await call("POST", "/api/order-drafts/d1/release-creation", {})).status).toBe(200);
    expect(drafts.d1.status).toBe("review_required");

    drafts.d1.status = "creating";
    const id = "0123456789abcdef0123456789abcdef";
    expect((await call("POST", "/api/order-drafts/d1/release-creation", { shopwareEntityId: id })).status).toBe(200);
    expect(drafts.d1).toMatchObject({ status: "created", shopwareOrderId: id });
  });

  it("nicht hängend: 409; ungültige ID: 400", async () => {
    state.user = admin;
    expect((await call("POST", "/api/order-drafts/d1/release-creation", { shopwareEntityId: "nope" })).status).toBe(400);
    drafts.d1.status = "review_required";
    expect((await call("POST", "/api/order-drafts/d1/release-creation", {})).status).toBe(409);
  });
});
