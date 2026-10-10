/**
 * Cross-Selling-Monatspruefung: Faelligkeit (Europe/Berlin), Wirkungsmessung, Pruefregeln,
 * Lauf mit Benachrichtigung, Entfernen bestaetigen bzw. behalten.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  isMonthlyReviewDue,
  berlinMonthKey,
  classifyLivePair,
  runCrossSellMonthlyReview,
  buildMonthlyReviewMessage,
} from "../../server/cross-selling/crossSellMonthlyReview";
import { computeCrossSellEffect, prepareEffectOrders } from "../../server/cross-selling/crossSellEffect";
import { approveCrossSellRemovals, keepCrossSellPairs } from "../../server/cross-selling/crossSellReview";
import { buildCrossSellCatalog, clearCrossSellCatalogCache } from "../../server/cross-selling/crossSellCatalog";
import type { Order } from "../../shared/schema";

const on = { monthlyReviewEnabled: true, reviewDayOfMonth: 1, reviewHourLocal: 6 };

describe("Faelligkeit", () => {
  it("ab Tag und Stunde in deutscher Zeit (Winterzeit)", () => {
    expect(isMonthlyReviewDue(new Date("2026-03-01T04:59:00Z"), on)).toBe(false); // 05:59 MEZ
    expect(isMonthlyReviewDue(new Date("2026-03-01T05:00:00Z"), on)).toBe(true); // 06:00 MEZ
  });

  it("Sommerzeit: 04:00 UTC ist 06:00 MESZ", () => {
    expect(isMonthlyReviewDue(new Date("2026-10-01T03:59:00Z"), on)).toBe(false);
    expect(isMonthlyReviewDue(new Date("2026-10-01T04:00:00Z"), on)).toBe(true);
  });

  it("verpasster Termin wird nachgeholt; ausgeschaltet nie", () => {
    expect(isMonthlyReviewDue(new Date("2026-10-03T01:00:00Z"), on)).toBe(true);
    expect(isMonthlyReviewDue(new Date("2026-10-03T01:00:00Z"), { ...on, monthlyReviewEnabled: false })).toBe(false);
  });

  it("Monatsschluessel nach deutscher Zeit (Monatswechsel)", () => {
    expect(berlinMonthKey(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(berlinMonthKey(new Date("2026-10-31T22:30:00Z"))).toBe("2026-10");
  });
});

const day = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-01-01T00:00:00Z");
function mo(i: number, at: Date, items: string[], nr = `MO${i}`): Order {
  return { orderNumber: nr, orderDate: at.toISOString(), status: "completed", paymentStatus: "paid", items: items.map((productNumber) => ({ productNumber })) } as unknown as Order;
}

describe("Wirkungsmessung", () => {
  const id = (pn: string) => pn;

  it("nur Shop-Bestellungen (MO), ohne Stornos", () => {
    const prepared = prepareEffectOrders(
      [mo(1, T0, ["S", "T"]), mo(2, T0, ["S", "T"], "199153"), { ...mo(3, T0, ["S"]), status: "cancelled" } as Order],
      id,
    );
    expect(prepared).toHaveLength(1);
  });

  it("zu kurz oder zu wenige Bestellungen: kein Urteil", () => {
    const orders = prepareEffectOrders(Array.from({ length: 40 }, (_, i) => mo(i, new Date(T0.getTime() + (10 + i) * day), ["S"])), id);
    expect(computeCrossSellEffect(orders, "S", "T", T0, new Date(T0.getTime() + 60 * day)).verdict).toBe("insufficient_data");
    expect(computeCrossSellEffect(orders.slice(0, 10), "S", "T", T0, new Date(T0.getTime() + 200 * day)).verdict).toBe("insufficient_data");
  });

  it("50 Bestellungen danach ohne einen Treffer: ohne Wirkung", () => {
    const orders = prepareEffectOrders(Array.from({ length: 55 }, (_, i) => mo(i, new Date(T0.getTime() + (10 + i * 2) * day), ["S"])), id);
    const r = computeCrossSellEffect(orders, "S", "T", T0, new Date(T0.getTime() + 200 * day));
    expect(r.verdict).toBe("ineffective");
    expect(r.post).toMatchObject({ sourceOrders: 55, pairOrders: 0 });
  });

  it("deutlich haeufiger zusammen gekauft: wirkt", () => {
    const before = Array.from({ length: 40 }, (_, i) => mo(i, new Date(T0.getTime() - (5 + i * 5) * day), i < 2 ? ["S", "T"] : ["S"]));
    const after = Array.from({ length: 40 }, (_, i) => mo(100 + i, new Date(T0.getTime() + (10 + i * 3) * day), i < 15 ? ["S", "T"] : ["S"]));
    const r = computeCrossSellEffect(prepareEffectOrders([...before, ...after], id), "S", "T", T0, new Date(T0.getTime() + 200 * day));
    expect(r.verdict).toBe("positive");
    expect(r.pBetter).toBeGreaterThan(0.9);
  });

  it("Handpflege braucht mehr Bestellungen", () => {
    const orders = prepareEffectOrders(Array.from({ length: 35 }, (_, i) => mo(i, new Date(T0.getTime() + (10 + i * 3) * day), ["S"])), id);
    const now = new Date(T0.getTime() + 200 * day);
    expect(computeCrossSellEffect(orders, "S", "T", T0, now).verdict).not.toBe("insufficient_data");
    expect(computeCrossSellEffect(orders, "S", "T", T0, now, { minSourceOrders: 45 }).verdict).toBe("insufficient_data");
  });
});

describe("Pruefregeln", () => {
  const info = (active: boolean, channels = ["de"]) => ({ active, name: "", categories: [], properties: [], visibleChannels: new Set(channels) });
  it("Ziel fehlt, inaktiv, unsichtbar, KI, Wirkung, veraltet", () => {
    expect(classifyLivePair({ targetKnown: false, llm: null, effect: null, stale: false })).toEqual(["target_missing"]);
    expect(classifyLivePair({ targetKnown: true, target: info(false), source: info(true), llm: null, effect: null, stale: false })).toEqual(["target_inactive"]);
    expect(classifyLivePair({ targetKnown: true, target: info(true, ["at"]), source: info(true, ["de"]), llm: null, effect: null, stale: false })).toEqual(["target_hidden"]);
    expect(classifyLivePair({ targetKnown: true, target: info(true), source: info(true), llm: { verdict: "no_fit", confidence: 0.8 }, effect: null, stale: true })).toEqual(["llm_no_fit", "stale"]);
    expect(classifyLivePair({ targetKnown: true, target: info(true), source: info(true), llm: { verdict: "no_fit", confidence: 0.5 }, effect: null, stale: false })).toEqual([]);
  });
});

// ---- Lauf mit simulierten Abhaengigkeiten ----

const products = ["R", "B", "X", "OLD"].map((pn) => ({ id: `id-${pn}`, productNumber: pn, parentId: null, name: `Artikel ${pn}`, active: true }));
const ref = (target: string, group = "g1", name = "Das passt dazu") => [
  { groupId: group, groupName: name, groupActive: true, ownerProductId: "id-R", assignmentId: `as-${target}`, productId: `id-${target}`, position: 1 },
];

function world(opts: { settings?: Record<string, unknown>; protectedOld?: boolean } = {}) {
  const pairs: any[] = [
    { id: "p-b", sourceProductNumber: "R", targetProductNumber: "B", status: "applied", origin: "legacy_metaorder", shopRefs: ref("B"), appliedAt: new Date("2026-01-01") },
    { id: "p-old", sourceProductNumber: "R", targetProductNumber: "OLD", status: "applied", origin: "shopware_manual", protected: opts.protectedOld ?? false, shopRefs: ref("OLD", "g2", "Passende Erweiterungen"), appliedAt: new Date("2026-01-01") },
  ];
  const runs: any[] = [];
  const notifications: any[] = [];
  const mails: any[] = [];
  const storage: any = {
    getSetting: async (key: string) => (key === "cross_sell_automation_settings" ? { monthlyReviewEnabled: true, reportEmail: "team@example.com", ...opts.settings } : null),
    getShopwareProductIdentities: async () => products,
    getCrossSellPairStates: async (f: any) => pairs.filter((p) => !f?.statuses || f.statuses.includes(p.status)),
    upsertCrossSellPairStates: async (rows: any[], cols: string[]) => {
      for (const r of rows) {
        const p = pairs.find((x) => x.sourceProductNumber === r.sourceProductNumber && x.targetProductNumber === r.targetProductNumber);
        if (p) for (const c of cols) p[c] = r[c];
      }
      return [];
    },
    acquireCrossSellRun: async (a: any) => {
      if (runs.some((r) => r.kind === a.kind && r.periodKey === a.periodKey)) return null;
      const r = { id: `run${runs.length + 1}`, startedAt: new Date(), ...a };
      runs.push(r);
      return r;
    },
    heartbeatCrossSellRun: async () => undefined,
    finishCrossSellRun: async (id: string, res: any) => Object.assign(runs.find((r) => r.id === id), res),
    getCrossSellRuns: async () => runs,
    getShopwareProductMirrorsByNumbers: async (nums: string[]) =>
      nums.map((pn) => ({ shopwareId: `id-${pn}`, productNumber: pn, name: `Artikel ${pn}`, active: pn !== "OLD", payload: { salesChannelVisibilities: [{ salesChannelId: "de", visibility: 30 }] } })),
    getUsersWithPermissionInTenant: async () => [{ id: "u1", username: "anna", email: null }, { id: "u2", username: "ben", email: null }],
    createNotification: async (n: any) => {
      notifications.push(n);
      return { id: `n${notifications.length}`, ...n };
    },
  };
  const client = {
    searchCrossSellingGroups: async () => ({
      groups: [
        { id: "g1", name: "Das passt dazu", type: "productList" as const, active: true, position: 2, productId: "id-R", assignedProducts: [{ id: "as-B", productId: "id-B", position: 1 }] },
        { id: "g2", name: "Passende Erweiterungen", type: "productList" as const, active: true, position: 1, productId: "id-R", assignedProducts: [{ id: "as-OLD", productId: "id-OLD", position: 1 }] },
      ],
      hasMore: false,
    }),
  };
  const deps = {
    storage,
    client,
    loadOrders: async () => [] as Order[],
    getSetting: storage.getSetting,
    sendEmail: async (m: any) => void mails.push(m),
    onNotificationCreated: () => undefined,
    appUrl: "https://app.example.com",
    now: () => new Date("2026-10-01T05:00:00Z"),
    checkFit: async () => ({ ok: false as const, reason: "not_configured" as const }),
  };
  return { deps, pairs, runs, notifications, mails };
}

describe("Monatslauf", () => {
  beforeEach(() => clearCrossSellCatalogCache());

  it("schlaegt inaktives Ziel zum Entfernen vor (auch Handpflege), benachrichtigt und mailt", async () => {
    const w = world();
    const r = await runCrossSellMonthlyReview(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    expect(r.report?.proposals).toBe(1);
    expect(w.pairs.find((p) => p.id === "p-old")).toMatchObject({ status: "removal_proposed", pendingAction: "remove", proposalReason: "target_inactive" });
    expect(w.pairs.find((p) => p.id === "p-b").status).toBe("applied");
    expect(w.notifications.map((n) => [n.userId, n.type])).toEqual([["u1", "cross_selling_review"], ["u2", "cross_selling_review"]]);
    expect(w.mails[0]).toMatchObject({ to: "team@example.com" });
    expect(w.mails[0].text).toContain("https://app.example.com/cross-selling-rules?tab=review");
    expect(w.runs[0]).toMatchObject({ periodKey: "2026-10", status: "completed" });
    expect(w.runs[0].notifiedAt).toBeTruthy();
  });

  it("geschuetzte Paare werden nicht vorgeschlagen", async () => {
    const w = world({ protectedOld: true });
    const r = await runCrossSellMonthlyReview(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    expect(r.report?.proposals).toBe(0);
    expect(r.report?.counts.target_inactive).toBe(1);
  });

  it("nur einmal je Monat; nicht faellig oder ausgeschaltet: nichts", async () => {
    const w = world();
    await runCrossSellMonthlyReview(w.deps as any, { tenantId: "t", trigger: "scheduled" });
    expect((await runCrossSellMonthlyReview(w.deps as any, { tenantId: "t", trigger: "scheduled" })).skipped).toBe("already_ran");
    const early = world();
    early.deps.now = () => new Date("2026-10-01T03:00:00Z");
    expect((await runCrossSellMonthlyReview(early.deps as any, { tenantId: "t", trigger: "scheduled" })).skipped).toBe("not_due");
    const off = world({ settings: { monthlyReviewEnabled: false } });
    expect((await runCrossSellMonthlyReview(off.deps as any, { tenantId: "t", trigger: "scheduled" })).skipped).toBe("not_due");
    expect(off.notifications).toEqual([]);
  });

  it("ohne E-Mail-Adresse nur In-App", async () => {
    const w = world({ settings: { reportEmail: "" } });
    const r = await runCrossSellMonthlyReview(w.deps as any, { tenantId: "t", trigger: "manual" });
    expect(w.mails).toEqual([]);
    expect(r.report?.notified).toEqual({ users: 2, email: "none" });
  });

  it("Text der Benachrichtigung", () => {
    const msg = buildMonthlyReviewMessage(
      {
        month: "2026-10",
        pairsChecked: 2,
        proposals: 1,
        counts: { target_inactive: 1 },
        findings: { target_inactive: [{ pairId: "p", source: "R", sourceName: "Regal", target: "OLD", targetName: "Alt", groups: ["X"], origin: "ai" }] },
        shop: { productListGroups: 2, productStreamGroups: 0, pairsLive: 2, pairsRemovedExternally: 0 },
        llm: { calls: 0, checked: 0, errors: 0, skippedBudget: 0, notConfigured: true },
        notified: { users: 0, email: "none" },
      },
      null,
    );
    expect(msg.title).toBe("Cross-Selling-Monatsprüfung 2026-10");
    expect(msg.message).toContain("1 Zuordnungen zum Entfernen vorgeschlagen");
    expect(msg.text).toContain("R Regal → OLD Alt");
    expect(msg.html).not.toContain("<script");
  });
});

describe("Entfernen bestaetigen / behalten", () => {
  const catalog = buildCrossSellCatalog(products);

  it("entfernt das Ziel aus allen Listen der Quelle, Gruppen bleiben, Sperrfrist", async () => {
    const writes: string[] = [];
    const updates: any[] = [];
    const logs: any[] = [];
    const storage: any = {
      updateCrossSellPairState: async (id: string, patch: any) => updates.push({ id, ...patch }),
      appendCrossSellChangeLog: async (rows: any[]) => (logs.push(...rows), rows.map((_, i) => i + 1)),
      upsertCrossSellPairStates: async () => [],
    };
    const client = {
      fetchCrossSellingAssignments: async (g: string) => (g === "g2" ? [{ id: "as-OLD", productId: "id-OLD", position: 1 }, { id: "as-X", productId: "id-X", position: 2 }] : []),
      syncCrossSellingAssignments: async (g: string, ops: any) => void writes.push(`${g}:-${ops.deleteIds.join(",")}`),
    };
    const pair = { id: "p-old", sourceProductNumber: "R", targetProductNumber: "OLD", pendingAction: "remove", shopRefs: ref("OLD", "g2", "Passende Erweiterungen") } as any;
    const out = await approveCrossSellRemovals({ storage, client: client as any, catalog }, [pair], { tenantId: "t", userId: "u" });
    expect(out.removed).toEqual(["p-old"]);
    expect(writes).toEqual(["g2:-as-OLD"]);
    expect(logs.map((l) => [l.action, l.mode, l.groupName])).toEqual([["remove", "approved", "Passende Erweiterungen"]]);
    expect(updates[0]).toMatchObject({ status: "removed", pendingAction: null, shopRefs: [] });
    expect(updates[0].cooldownUntil).toBeInstanceOf(Date);
  });

  it("Behalten schuetzt das Paar vor erneuten Vorschlaegen", async () => {
    const updates: any[] = [];
    const n = await keepCrossSellPairs(
      { updateCrossSellPairState: async (id: string, patch: any) => (updates.push({ id, ...patch }), undefined) },
      [{ id: "p", pendingAction: "remove" } as any, { id: "q", pendingAction: "add" } as any],
      { tenantId: "t", userId: "u" },
    );
    expect(n).toBe(1);
    expect(updates[0]).toMatchObject({ id: "p", status: "applied", protected: true, pendingAction: null, decisionReasonCode: "keep" });
  });
});
