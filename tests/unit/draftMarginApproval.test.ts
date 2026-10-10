/**
 * Freigabe roter Entwürfe: Zustände (fehlt, angefordert, freigegeben, abgelehnt, veraltet),
 * Ablauf anfordern → ablehnen → Preis ändern → neu anfordern → freigeben, Sperre der Anlage,
 * Benachrichtigungen und Grund in der Strikt-Regel.
 * Ausführung: npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommercialDraftMarginApproval } from "../../shared/schema";
import type { DraftProfitability } from "../../shared/draftProfitability";

// Herstellkosten: Artikel A kostet 100 (ohne Shopware)
vi.mock("../../server/shopware/shopware", () => ({ ShopwareClient: class {} }));
vi.mock("../../server/analytics/orderProfitabilityAnalysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/analytics/orderProfitabilityAnalysis")>();
  return { ...actual, createHerstellpreisResolver: async () => () => 100 };
});

const {
  checkMarginGateForCreate,
  decideMarginApproval,
  evaluateMarginApproval,
  profitabilityFingerprint,
  requestMarginApproval,
} = await import("../../server/commercial/draftMarginApproval");
const { evaluateStrictAutoCreate } = await import("../../server/commercial/commercialStrictAutoCreate");
const { DEFAULT_COMMERCIAL_AGENT } = await import("../../server/ai/aiConfig");

function snapshot(verdict: "green" | "red", price = 105): DraftProfitability {
  return {
    computedAt: "2026-10-10T10:00:00.000Z",
    frozen: false,
    thresholds: { minMarginPercent: 20, warnMarginPercent: 7 },
    summary: {
      herstellkostenTotal: 100,
      db1Total: price - 100,
      marginPercent: price - 100,
      marginOnRevenuePercent: null,
      crmVerdict: verdict,
      productLineCount: 1,
      linesWithHerstellpreis: 1,
      coveragePercent: 100,
    },
    lines: [
      {
        index: 0,
        quantity: 1,
        unitPriceNet: price,
        priceSource: "manual",
        herstellpreisNet: 100,
        herstellkostenTotal: 100,
        db1Abs: price - 100,
        marginPercent: price - 100,
        marginOnRevenuePercent: null,
        crmVerdict: verdict,
        isBundle: false,
      },
    ],
    unpricedLineCount: 0,
  };
}

function approvalRow(status: string, fingerprint: string, extra: Partial<CommercialDraftMarginApproval> = {}) {
  return {
    id: `a-${status}`,
    tenantId: "t",
    draftKind: "order",
    draftId: "d1",
    status,
    reason: "Rahmenvertrag mit Sonderpreis",
    fingerprint,
    verdict: "red",
    marginPercent: 5,
    db1Total: 5,
    requestedByUserId: "u-sb",
    requestedByName: "sb",
    requestedAt: new Date("2026-10-10T10:00:00Z"),
    decidedByUserId: null,
    decidedByName: null,
    decidedAt: null,
    decisionComment: null,
    ...extra,
  } as CommercialDraftMarginApproval;
}

describe("Zustand der Freigabe", () => {
  const red = snapshot("red");
  const fp = profitabilityFingerprint(red);

  it("nicht rot: keine Freigabe nötig", () => {
    expect(evaluateMarginApproval(snapshot("green", 130), [], true)).toMatchObject({
      required: false,
      state: "not_required",
      canCreate: true,
    });
  });

  it("rot ohne Anforderung: gesperrt", () => {
    expect(evaluateMarginApproval(red, [], true)).toMatchObject({ required: true, state: "missing", canCreate: false });
  });

  it.each([
    ["requested", false],
    ["rejected", false],
    ["approved", true],
  ] as const)("%s für denselben Stand → Anlage %s", (status, canCreate) => {
    expect(evaluateMarginApproval(red, [approvalRow(status, fp)], true)).toMatchObject({ state: status, canCreate });
  });

  it("Freigabe für einen anderen Stand gilt nicht", () => {
    expect(evaluateMarginApproval(red, [approvalRow("approved", "0:1:90")], true)).toMatchObject({
      state: "stale",
      canCreate: false,
    });
  });

  it("ohne Recht keine Beträge im Verlauf", () => {
    const view = evaluateMarginApproval(red, [approvalRow("requested", fp)], false);
    expect(view.latest).toMatchObject({ marginPercent: null, db1Total: null, reason: "Rahmenvertrag mit Sonderpreis" });
  });
});

describe("Strikt-Regel", () => {
  it("rote DB ist ein Grund gegen die automatische Anlage", () => {
    const result = evaluateStrictAutoCreate({
      draftKind: "order",
      agentSettings: { ...DEFAULT_COMMERCIAL_AGENT, enabled: true, autoCreateOrdersEnabled: true },
      extractedData: {},
      intent: { intent: "purchase_order", confidence: 1 },
      marginVerdict: "red",
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("margin_below_minimum");
  });
});

describe("Ablauf anfordern, ablehnen, neu anfordern, freigeben", () => {
  let approvals: CommercialDraftMarginApproval[];
  let notifications: Array<{ userId: string; title: string; link?: string | null }>;
  const storage: any = {
    getSetting: async () => null,
    getShopwareSettings: async () => ({}),
    getProductHerstellpreiseByProductNumbers: async () => new Map(),
    saveDraftProfitability: async () => undefined,
    getDraftMarginApprovals: async () => [...approvals].reverse(),
    createDraftMarginApproval: async (row: any) => {
      const created = approvalRow(row.status, row.fingerprint, {
        ...row,
        id: `a${approvals.length + 1}`,
        requestedAt: new Date(Date.UTC(2026, 9, 10, 10, approvals.length)),
      });
      approvals.push(created);
      return created;
    },
    updateDraftMarginApproval: async (id: string, updates: any) => {
      const row = approvals.find((a) => a.id === id)!;
      Object.assign(row, updates);
      return row;
    },
    getUsersWithPermissionInTenant: async () => [
      { id: "u-admin", username: "admin", email: null },
      { id: "u-sb", username: "sb", email: null },
    ],
    createNotification: async (n: any) => {
      notifications.push(n);
      return { ...n, id: "n", createdAt: new Date() };
    },
  };
  const draftWithPrice = (price: number) => ({
    originalFileName: "Bestellung.pdf",
    matchingResults: { items: [{ quantity: 1, matchedProduct: { id: "pA", productNumber: "A", manualUnitPriceNet: price } }] },
  });
  const base = { storage, tenantId: "t", kind: "order" as const, draftId: "d1" };
  const sb = { id: "u-sb", username: "sb" };
  const admin = { id: "u-admin", username: "admin" };

  beforeEach(() => {
    approvals = [];
    notifications = [];
  });

  it("vollständiger Ablauf mit Sperre und Benachrichtigungen", async () => {
    const draft = draftWithPrice(105); // 5 % Aufschlag → rot
    expect(await checkMarginGateForCreate({ ...base, draft })).toMatchObject({
      ok: false,
      statusCode: 409,
      code: "margin_approval_required",
    });

    expect(await requestMarginApproval({ ...base, draft, user: sb, reason: "kurz" })).toMatchObject({
      ok: false,
      statusCode: 400,
    });
    const requested = await requestMarginApproval({ ...base, draft, user: sb, reason: "Rahmenvertrag mit Sonderpreis" });
    expect(requested.ok).toBe(true);
    // Freigebende benachrichtigt, nicht der Anfordernde selbst
    expect(notifications.map((n) => [n.userId, n.title, n.link])).toEqual([
      ["u-admin", "DB-Freigabe angefordert", "/order-drafts?draftId=d1"],
    ]);
    expect(await requestMarginApproval({ ...base, draft, user: sb, reason: "noch einmal bitte" })).toMatchObject({
      ok: false,
      statusCode: 409,
    });

    const rejected = await decideMarginApproval({ ...base, draft, user: admin, decision: "reject", comment: "zu niedrig" });
    expect(rejected.ok && rejected.approval.status).toBe("rejected");
    expect(notifications.at(-1)).toMatchObject({ userId: "u-sb", title: "DB-Freigabe abgelehnt" });
    expect((await checkMarginGateForCreate({ ...base, draft })).ok).toBe(false);

    // Preis leicht angehoben, immer noch rot → neu anfordern und freigeben
    const draft2 = draftWithPrice(106);
    expect((await requestMarginApproval({ ...base, draft: draft2, user: sb, reason: "Folgeauftrag erwartet" })).ok).toBe(true);
    const approved = await decideMarginApproval({ ...base, draft: draft2, user: admin, decision: "approve", comment: null });
    expect(approved.ok && approved.approval).toMatchObject({ status: "approved", decidedByName: "admin" });
    expect(await checkMarginGateForCreate({ ...base, draft: draft2 })).toEqual({ ok: true });

    // danach geändert → Freigabe gilt nicht mehr
    expect((await checkMarginGateForCreate({ ...base, draft: draftWithPrice(104) })).ok).toBe(false);
  });

  it("Freigebende können ohne Anforderung direkt freigeben, aber nur mit Begründung", async () => {
    const draft = draftWithPrice(103);
    expect(await decideMarginApproval({ ...base, draft, user: admin, decision: "approve", comment: "" })).toMatchObject({
      ok: false,
      statusCode: 400,
    });
    expect(await decideMarginApproval({ ...base, draft, user: admin, decision: "reject", comment: "nein" })).toMatchObject({
      ok: false,
      statusCode: 409,
    });
    const direct = await decideMarginApproval({
      ...base,
      draft,
      user: admin,
      decision: "approve",
      comment: "Strategischer Neukunde",
    });
    expect(direct.ok && direct.approval).toMatchObject({ status: "approved", requestedByName: "admin", decidedByName: "admin" });
    expect(await checkMarginGateForCreate({ ...base, draft })).toEqual({ ok: true });
  });

  it("nicht rot: weder Sperre noch Anforderung", async () => {
    const draft = draftWithPrice(130);
    expect(await checkMarginGateForCreate({ ...base, draft })).toEqual({ ok: true });
    expect(await requestMarginApproval({ ...base, draft, user: sb, reason: "ohne Grund nötig?" })).toMatchObject({
      ok: false,
      statusCode: 409,
    });
  });
});
