/**
 * Cross-Selling-Gedaechtnis: Filter fuer abgelehnte Paare, Protokoll der Schreibvorgaenge,
 * Ablehnen, Import der Shop-Zuordnungen, Einstellungen, Lernen.
 */
import { describe, it, expect } from "vitest";
import { buildCrossSellCatalog } from "../../server/cross-selling/crossSellCatalog";
import {
  buildCrossSellPairFilter,
  createCrossSellChangeRecorder,
  rejectCrossSellPair,
  CROSS_SELL_REMOVAL_COOLDOWN_DAYS,
} from "../../server/cross-selling/crossSellMemory";
import { classifyCrossSellGroupOrigin, planCrossSellImport } from "../../server/cross-selling/crossSellImport";
import {
  mergeCrossSellAutomationSettings,
  DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS,
  crossSellAutomationGloballyEnabled,
} from "../../server/cross-selling/crossSellAutomationSettings";
import { buildCooccurrence, buildLearningOutputs } from "../../server/cross-selling/crossSellLearning";
import type { CrossSellingGroupWithAssignments } from "../../server/shopware/client/crossSelling";

// Familie REGAL (Hauptprodukt R) mit Varianten R-1000/R-2000; BODEN (B) mit Variante B-1000; Einzelartikel X
const catalog = buildCrossSellCatalog([
  { id: "r", productNumber: "R", parentId: null, name: "Regal", active: true },
  { id: "r1", productNumber: "R-1000", parentId: "r", name: "Regal 1000", active: true },
  { id: "r2", productNumber: "R-2000", parentId: "r", name: "Regal 2000", active: true },
  { id: "b", productNumber: "B", parentId: null, name: "Boden", active: true },
  { id: "b1", productNumber: "B-1000", parentId: "b", name: "Boden 1000", active: true },
  { id: "x", productNumber: "X", parentId: null, name: "Haken", active: true },
]);

const NOW = new Date("2026-10-09T12:00:00Z");

describe("Katalog", () => {
  it("Varianten zeigen auf die Familie", () => {
    expect(catalog.canonicalNumber("R-2000")).toBe("R");
    expect(catalog.canonicalNumber("X")).toBe("X");
    expect(catalog.canonicalNumber("UNBEKANNT")).toBe("UNBEKANNT");
    expect(catalog.canonicalNumberForId("b1")).toBe("B");
    expect(catalog.canonicalNumberForId("fehlt")).toBeNull();
  });
});

describe("Paar-Filter", () => {
  const f = buildCrossSellPairFilter(
    [
      { sourceProductNumber: "R", targetProductNumber: "B", status: "rejected", cooldownUntil: null, decisionSource: "user" },
      { sourceProductNumber: "R", targetProductNumber: "X", status: "removed", cooldownUntil: new Date("2027-01-01"), decisionSource: "user" },
      { sourceProductNumber: "B", targetProductNumber: "X", status: "removed", cooldownUntil: new Date("2026-01-01"), decisionSource: "user" },
      { sourceProductNumber: "X", targetProductNumber: "B", status: "applied", cooldownUntil: null, decisionSource: "user" },
      { sourceProductNumber: "X", targetProductNumber: "R", status: "applied", cooldownUntil: null, decisionSource: "batch" },
    ],
    catalog,
    NOW,
  );

  it("abgelehnt gilt fuer alle Groessen der Familie, nur in dieser Richtung", () => {
    expect(f.isBlocked("R-1000", "B-1000")).toBe(true);
    expect(f.isBlocked("R", "B")).toBe(true);
    expect(f.isBlocked("B", "R")).toBe(false);
  });

  it("Sperrfrist nach Entfernen gilt bis zum Ablauf", () => {
    expect(f.isBlocked("R-2000", "X")).toBe(true);
    expect(f.isBlocked("B", "X")).toBe(false);
  });

  it("verstaerkt nur einzeln von Menschen freigegebene Paare", () => {
    expect(f.approvedPairs).toEqual([{ source: "X", target: "B" }]);
  });

  it("leere Nummern sind nie gesperrt", () => {
    expect(f.isBlocked(null, "B")).toBe(false);
  });
});

function recorderStorage() {
  const logs: any[] = [];
  const upserts: Array<{ rows: any[]; cols: string[] }> = [];
  return {
    logs,
    upserts,
    appendCrossSellChangeLog: async (rows: any[]) => {
      logs.push(...rows);
    },
    upsertCrossSellPairStates: async (rows: any[], cols: any[]) => {
      upserts.push({ rows, cols });
      return [];
    },
  };
}

const change = (over: Partial<Parameters<ReturnType<typeof createCrossSellChangeRecorder>>[0]> = {}) => ({
  mode: "product_ui" as const,
  dryRun: false,
  sourceProductId: "r1",
  sourceProductNumber: "R-1000",
  crossSellingId: "g1",
  groupName: "Das passt dazu",
  createdGroup: false,
  before: [{ id: "as-x", productId: "x", position: 1 }],
  diff: {
    toAdd: [{ productId: "b1", position: 2 }],
    toRemove: [{ id: "as-x", productId: "x" }],
    reposition: [],
    skippedForCap: [],
    unchanged: 0,
  },
  ...over,
});

describe("Protokoll der Schreibvorgaenge", () => {
  it("Produkt-Dialog: Protokoll + Paar-Zustand als Einzelentscheidung, Entfernen mit Sperrfrist", async () => {
    const st = recorderStorage();
    await createCrossSellChangeRecorder(st, catalog, { tenantId: "t", userId: "u1", origin: "user", now: () => NOW })(change());
    expect(st.logs.map((l) => [l.action, l.targetProductNumber, l.mode])).toEqual([
      ["add", "B-1000", "product_ui"],
      ["remove", "X", "product_ui"],
    ]);
    const [added, removed] = st.upserts;
    expect(added.rows[0]).toMatchObject({ sourceProductNumber: "R", targetProductNumber: "B", status: "applied", decisionSource: "user", decidedByUserId: "u1" });
    expect(removed.rows[0]).toMatchObject({ sourceProductNumber: "R", targetProductNumber: "X", status: "removed" });
    expect(new Date(removed.rows[0].cooldownUntil).getTime() - NOW.getTime()).toBe(CROSS_SELL_REMOVAL_COOLDOWN_DAYS * 86400000);
    expect(added.cols).toContain("appliedAt");
    expect(added.cols).not.toContain("origin");
  });

  it("Staging-Uebernahme zaehlt als Sammelvorgang, nicht als Einzel-Freigabe", async () => {
    const st = recorderStorage();
    await createCrossSellChangeRecorder(st, catalog, { tenantId: "t", userId: "u1", origin: "ai" })(change({ mode: "staging" }));
    expect(st.upserts[0].rows[0].decisionSource).toBe("batch");
  });

  it("Testlauf: nur Protokoll (dry_run), kein Paar-Zustand", async () => {
    const st = recorderStorage();
    await createCrossSellChangeRecorder(st, catalog, { tenantId: "t", userId: null, origin: "ai" })(change({ mode: "auto", dryRun: true, createdGroup: true }));
    expect(st.logs.map((l) => [l.action, l.mode])).toEqual([
      ["create_group", "dry_run"],
      ["add", "dry_run"],
      ["remove", "dry_run"],
    ]);
    expect(st.upserts).toEqual([]);
  });

  it("Speicherfehler bricht nicht ab", async () => {
    const rec = createCrossSellChangeRecorder(
      {
        appendCrossSellChangeLog: async () => {
          throw new Error("db");
        },
        upsertCrossSellPairStates: async () => [],
      },
      catalog,
      { tenantId: null, userId: null, origin: "ai" },
    );
    await expect(rec(change())).resolves.toBeUndefined();
  });
});

describe("Ablehnen", () => {
  it("Familien-Nummern, optional beide Richtungen, Grund und Notiz", async () => {
    let saved: any[] = [];
    await rejectCrossSellPair(
      { upsertCrossSellPairStates: async (rows: any[]) => ((saved = rows), []) },
      catalog,
      { tenantId: "t", userId: "u", sourceProductNumber: "R-1000", targetProductNumber: "B-1000", reasonCode: "alternative", note: " passt nicht ", bothDirections: true, now: NOW },
    );
    expect(saved.map((r) => [r.sourceProductNumber, r.targetProductNumber, r.status, r.decisionReasonCode, r.decisionNote])).toEqual([
      ["R", "B", "rejected", "alternative", "passt nicht"],
      ["B", "R", "rejected", "alternative", "passt nicht"],
    ]);
  });

  it("gleiche Familie wird nicht gespeichert", async () => {
    let called = false;
    await rejectCrossSellPair(
      { upsertCrossSellPairStates: async () => ((called = true), []) },
      catalog,
      { tenantId: null, userId: null, sourceProductNumber: "R-1000", targetProductNumber: "R-2000", reasonCode: "other" },
    );
    expect(called).toBe(false);
  });
});

describe("Import der Shop-Zuordnungen", () => {
  it("Herkunft: eigene und fruehere METAorder-Gruppen vs. Handpflege", () => {
    expect(classifyCrossSellGroupOrigin("Das passt dazu", "Das passt dazu")).toBe("legacy_metaorder");
    expect(classifyCrossSellGroupOrigin("Passende Produkte", "Das passt dazu")).toBe("legacy_metaorder");
    expect(classifyCrossSellGroupOrigin("Auto Cross-Selling (10/27/2025)", "Das passt dazu")).toBe("legacy_metaorder");
    expect(classifyCrossSellGroupOrigin("Staging Cross-Selling (1/26/2026)", "Das passt dazu")).toBe("legacy_metaorder");
    expect(classifyCrossSellGroupOrigin("Passende Erweiterungen", "Das passt dazu")).toBe("shopware_manual");
  });

  const g = (over: Partial<CrossSellingGroupWithAssignments>): CrossSellingGroupWithAssignments => ({
    id: "g",
    name: "Passende Erweiterungen",
    type: "productList",
    active: true,
    position: 1,
    productId: "r1",
    assignedProducts: [],
    ...over,
  });

  it("zaehlt dynamische Gruppen nur, fasst Varianten zusammen, Handpflege hat Vorrang", () => {
    const plan = planCrossSellImport(
      [
        g({ id: "g1", name: "Auto Cross-Selling (10/27/2025)", productId: "r1", assignedProducts: [{ id: "a1", productId: "b1", position: 1, createdAt: "2025-10-27T00:00:00Z" }] }),
        g({ id: "g2", name: "Passende Erweiterungen", productId: "r2", assignedProducts: [{ id: "a2", productId: "b", position: 1, createdAt: "2026-02-01T00:00:00Z" }, { id: "a3", productId: "fehlt", position: 2 }] }),
        g({ id: "g3", name: "Passende Produkte", type: "productStream", productId: "r1" }),
      ],
      [],
      catalog,
      "Das passt dazu",
      NOW,
    );
    expect(plan.stats).toMatchObject({ productListGroups: 2, productStreamGroups: 1, assignments: 3, unknownProducts: 1, pairsLive: 1, pairsNew: 1 });
    expect(plan.live).toHaveLength(1);
    expect(plan.live[0]).toMatchObject({ sourceProductNumber: "R", targetProductNumber: "B", origin: "shopware_manual", status: "applied" });
    expect((plan.live[0].shopRefs as any[]).map((r) => r.assignmentId)).toEqual(["a1", "a2"]);
    expect(new Date(plan.live[0].appliedAt as Date).toISOString()).toBe("2025-10-27T00:00:00.000Z");
  });

  it("abgelehnte Paare im Shop behalten ihren Status; fehlende frueher gesehene gelten als von Hand entfernt", () => {
    const plan = planCrossSellImport(
      [g({ productId: "x", assignedProducts: [{ id: "a1", productId: "r", position: 1 }] })],
      [
        { sourceProductNumber: "X", targetProductNumber: "R", status: "rejected", appliedAt: null, lastSeenInShopAt: null },
        { sourceProductNumber: "X", targetProductNumber: "B", status: "applied", appliedAt: NOW, lastSeenInShopAt: new Date("2026-09-01") },
        { sourceProductNumber: "R", targetProductNumber: "B", status: "applied", appliedAt: NOW, lastSeenInShopAt: null },
      ],
      catalog,
      "Das passt dazu",
      NOW,
    );
    expect(plan.live).toEqual([]);
    expect(plan.keepStatus.map((r) => r.targetProductNumber)).toEqual(["R"]);
    expect(plan.removed.map((r) => [r.sourceProductNumber, r.targetProductNumber, r.status, r.decisionSource])).toEqual([
      ["X", "B", "removed", "external"],
    ]);
    expect(plan.stats.pairsRemovedExternally).toBe(1);
  });
});

describe("Automatik-Einstellungen", () => {
  it("Standard: aus, eigener Gruppenname", () => {
    expect(DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS.mode).toBe("off");
    expect(DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS.monthlyReviewEnabled).toBe(false);
    expect(DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS.managedGroupName).toBe("Das passt dazu");
  });

  it("ungueltige gespeicherte Werte fallen auf den Standard zurueck", () => {
    const s = mergeCrossSellAutomationSettings({ mode: "kaputt", managedGroupName: "Zubehör", maxAutoApplyPerRun: -3, unbekannt: 1 });
    expect(s.mode).toBe("off");
    expect(s.managedGroupName).toBe("Zubehör");
    expect(s.maxAutoApplyPerRun).toBe(15);
    expect((s as any).unbekannt).toBeUndefined();
  });

  it("Notschalter per Umgebungsvariable", () => {
    expect(crossSellAutomationGloballyEnabled(undefined)).toBe(true);
    expect(crossSellAutomationGloballyEnabled("false")).toBe(false);
  });
});

describe("Lernen mit Gedaechtnis", () => {
  const order = (items: string[]) => ({ status: "completed", paymentStatus: "paid", items: items.map((productNumber) => ({ productNumber })) }) as any;

  it("freigegebene Paare zaehlen wie 5 zusaetzliche gemeinsame Bestellungen", () => {
    const { pairCounts } = buildCooccurrence([order(["A", "B"])], [], [{ source: "A", target: "C" }]);
    expect(pairCounts.get("A||B")).toBe(1);
    expect(pairCounts.get("A||C")).toBe(5);
  });

  it("abgelehnte Paare werden keine Regel und keine Empfehlung", () => {
    const rows = [
      { productNumberA: "A", productNumberB: "B", pairCount: 5, ordersWithA: 5, ordersWithB: 5, totalOrders: 20, support: 0.25, confidence: 1, lift: 4 },
    ];
    const settings = { minSupport: 0, minConfidence: 0, minLift: 0, minPairCount: 1, maxRulesPerProduct: 5, maxRecommendationsPerProduct: 5 };
    const open = buildLearningOutputs(rows, settings);
    const filtered = buildLearningOutputs(rows, settings, new Map(), new Map(), { isBlocked: (s, t) => s === "A" && t === "B" });
    expect(open.rules.map((r: any) => `${r.sourceProductNumber}>${r.targetProductNumber}`).sort()).toEqual(["A>B", "B>A"]);
    expect(filtered.rules.map((r: any) => `${r.sourceProductNumber}>${r.targetProductNumber}`)).toEqual(["B>A"]);
    expect(filtered.recommendations.map((r: any) => r.productNumber)).toEqual(["B"]);
  });
});
