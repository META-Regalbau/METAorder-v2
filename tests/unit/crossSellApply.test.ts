/**
 * Cross-Selling nach Shopware: Abgleich statt "alles loeschen", Nur-Hinzufuegen als Standard,
 * fremde Gruppen unberuehrt, Shopware-Feldnamen der Zuordnungen.
 */
import { describe, it, expect, vi } from "vitest";
import { diffAssignments, applyCrossSellPlan } from "../../server/cross-selling/crossSellApply";
import {
  removeProductsFromCrossSelling,
  syncCrossSellingAssignments,
  assignProductsToCrossSelling,
  type CrossSellingAssignment,
} from "../../server/shopware/client/crossSelling";
import type { CrossSellingGroup } from "../../shared/schema";

const a = (productId: string, position: number, id = `as-${productId}`): CrossSellingAssignment => ({ id, productId, position });

describe("diffAssignments", () => {
  it("Nur-Hinzufuegen: bestehende bleiben, neue hinten angehaengt", () => {
    const d = diffAssignments([a("p1", 1), a("p2", 2)], ["p3", "p1", "p4"], { removeMissing: false, maxTargets: 10 });
    expect(d.toAdd).toEqual([
      { productId: "p3", position: 3 },
      { productId: "p4", position: 4 },
    ]);
    expect(d.toRemove).toEqual([]);
    expect(d.reposition).toEqual([]);
    expect(d.unchanged).toBe(2);
  });

  it("Nur-Hinzufuegen: volle Gruppe nimmt nichts mehr auf", () => {
    const d = diffAssignments([a("p1", 1), a("p2", 2)], ["p3", "p4"], { removeMissing: false, maxTargets: 3 });
    expect(d.toAdd.map((x) => x.productId)).toEqual(["p3"]);
    expect(d.skippedForCap).toEqual(["p4"]);
  });

  it("Ersetzen: Gruppe genau auf die ersten maxTargets, Positionen in Listen-Reihenfolge", () => {
    const d = diffAssignments([a("p1", 1), a("p2", 2), a("p9", 3)], ["p2", "p1", "p3", "p4"], {
      removeMissing: true,
      maxTargets: 3,
    });
    expect(d.toAdd).toEqual([{ productId: "p3", position: 3 }]);
    expect(d.toRemove).toEqual([{ id: "as-p9", productId: "p9" }]);
    expect(d.reposition).toEqual([
      { id: "as-p2", productId: "p2", position: 1 },
      { id: "as-p1", productId: "p1", position: 2 },
    ]);
    expect(d.skippedForCap).toEqual(["p4"]);
  });

  it("doppelte Wunschziele zaehlen einmal", () => {
    const d = diffAssignments([], ["p1", "p1", "p2"], { removeMissing: false, maxTargets: 10 });
    expect(d.toAdd.map((x) => x.productId)).toEqual(["p1", "p2"]);
  });
});

type FakeState = {
  groups: Record<string, CrossSellingGroup[]>;
  assignments: Record<string, CrossSellingAssignment[]>;
};

function fakeClient(state: FakeState) {
  const calls = {
    create: [] as Array<{ productId: string; name: string; position: number }>,
    sync: [] as Array<{ crossSellingId: string; upsert: any[]; deleteIds: string[] }>,
  };
  const client = {
    fetchProductCrossSelling: vi.fn(async (productId: string) => state.groups[productId] ?? []),
    fetchCrossSellingAssignments: vi.fn(async (id: string) => state.assignments[id] ?? []),
    createProductCrossSelling: vi.fn(async (productId: string, name: string, _type?: string, position = 1) => {
      calls.create.push({ productId, name, position });
      return `new-${productId}`;
    }),
    syncCrossSellingAssignments: vi.fn(async (crossSellingId: string, ops: { upsert: any[]; deleteIds: string[] }) => {
      calls.sync.push({ crossSellingId, ...ops });
    }),
  };
  return { client, calls };
}

const group = (id: string, name: string, type: "productList" | "productStream" = "productList", position = 1): CrossSellingGroup => ({
  id,
  name,
  type,
  active: true,
  position,
  products: [],
});

describe("applyCrossSellPlan", () => {
  const GROUP = "Passende Produkte";

  it("Standard (Nur-Hinzufuegen) loescht nie und laesst Handgruppen unberuehrt", async () => {
    const { client, calls } = fakeClient({
      groups: { src: [group("g-own", GROUP), group("g-hand", "Zubehör", "productList", 2)] },
      assignments: { "g-own": [a("old", 1)], "g-hand": [a("hand", 1)] },
    });
    const r = await applyCrossSellPlan(client, [{ sourceProductId: "src", targetProductIds: ["t1", "hand", "t2"] }], {
      mode: "staging",
      groupName: GROUP,
    });
    expect(calls.sync).toHaveLength(1);
    expect(calls.sync[0].crossSellingId).toBe("g-own");
    expect(calls.sync[0].deleteIds).toEqual([]);
    expect(calls.sync[0].upsert.map((u) => [u.productId, u.position])).toEqual([
      ["t1", 2],
      ["t2", 3],
    ]);
    expect(r.sources[0].skippedInOtherGroups).toEqual(["hand"]);
    expect(r.productsRemoved).toBe(0);
    expect(r.crossSellingsUpdated).toBe(1);
  });

  it("Ersetzen entfernt nur in der eigenen Gruppe, in einem Sync-Aufruf", async () => {
    const { client, calls } = fakeClient({
      groups: { src: [group("g-own", GROUP), group("g-hand", "Zubehör")] },
      assignments: { "g-own": [a("old", 1), a("keep", 2)], "g-hand": [a("hand", 1)] },
    });
    await applyCrossSellPlan(client, [{ sourceProductId: "src", targetProductIds: ["keep", "t1"] }], {
      mode: "staging",
      groupName: GROUP,
      replace: true,
    });
    expect(calls.sync).toHaveLength(1);
    expect(calls.sync[0].crossSellingId).toBe("g-own");
    expect(calls.sync[0].deleteIds).toEqual(["as-old"]);
    expect(calls.sync[0].upsert.map((u) => u.productId).sort()).toEqual(["keep", "t1"]);
  });

  it("legt die eigene Gruppe hinter bestehenden Tabs an; productStream-Gruppen zaehlen nur fuer die Position", async () => {
    const { client, calls } = fakeClient({
      groups: { src: [group("g-hand", "Zubehör", "productList", 2), group("g-stream", "Ähnlich", "productStream", 5)] },
      assignments: { "g-hand": [] },
    });
    const r = await applyCrossSellPlan(client, [{ sourceProductId: "src", targetProductIds: ["t1"] }], {
      mode: "bulk",
      groupName: GROUP,
    });
    expect(calls.create).toEqual([{ productId: "src", name: GROUP, position: 6 }]);
    expect(calls.sync[0].crossSellingId).toBe("new-src");
    expect(r.crossSellingsCreated).toBe(1);
    expect(client.fetchCrossSellingAssignments).not.toHaveBeenCalledWith("g-stream");
  });

  it("Testlauf schreibt nichts", async () => {
    const { client, calls } = fakeClient({ groups: { src: [] }, assignments: {} });
    const r = await applyCrossSellPlan(client, [{ sourceProductId: "src", targetProductIds: ["t1"] }], {
      mode: "auto",
      groupName: GROUP,
      dryRun: true,
    });
    expect(calls.create).toEqual([]);
    expect(calls.sync).toEqual([]);
    expect(r.productsAdded).toBe(1);
    expect(r.sources[0].createdGroup).toBe(true);
  });

  it("nichts zu tun: kein Schreibzugriff, keine Gruppe", async () => {
    const { client, calls } = fakeClient({ groups: { src: [group("g-own", GROUP)] }, assignments: { "g-own": [a("t1", 1)] } });
    const r = await applyCrossSellPlan(client, [{ sourceProductId: "src", targetProductIds: ["t1", "src"] }], {
      mode: "staging",
      groupName: GROUP,
    });
    expect(calls.sync).toEqual([]);
    expect(r.sourcesUnchanged).toBe(1);
  });

  it("Fehler einer Quelle stoppt die anderen nicht; onChange nur bei Schreibvorgaengen", async () => {
    const { client } = fakeClient({ groups: { ok: [] }, assignments: {} });
    client.fetchProductCrossSelling.mockImplementation(async (id: string) => {
      if (id === "bad") throw new Error("boom");
      return [];
    });
    const changes: string[] = [];
    const r = await applyCrossSellPlan(
      client,
      [
        { sourceProductId: "bad", sourceProductNumber: "B-1", targetProductIds: ["t1"] },
        { sourceProductId: "ok", targetProductIds: ["t1"] },
      ],
      { mode: "staging", groupName: GROUP, onChange: (c) => void changes.push(c.sourceProductId) },
    );
    expect(r.errors).toEqual([{ sourceProductId: "bad", sourceProductNumber: "B-1", error: "boom" }]);
    expect(r.crossSellingsCreated).toBe(1);
    expect(changes).toEqual(["ok"]);
  });
});

describe("Shopware-Client Zuordnungen", () => {
  function recorder(responses: Array<unknown> = []) {
    const requests: Array<{ url: string; body: any }> = [];
    const fake = {
      baseUrl: "https://shop.invalid",
      makeAuthenticatedRequest: async (url: string, init: any) => {
        requests.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify(responses.shift() ?? {}));
      },
    };
    return { fake, requests };
  }

  it("Entfernen filtert auf crossSellingId (nicht productCrossSellingId)", async () => {
    const { fake, requests } = recorder([{ data: [{ id: "as1" }] }, {}]);
    await removeProductsFromCrossSelling.call(fake as any, "g1", ["p1"]);
    expect(requests[0].body.filter[0]).toEqual({ type: "equals", field: "crossSellingId", value: "g1" });
    expect(requests[1].body["delete-assignments"].payload).toEqual([{ id: "as1" }]);
  });

  it("Sync: erst Upsert, dann Delete; feste IDs je Gruppe und Produkt", async () => {
    const { fake, requests } = recorder();
    await syncCrossSellingAssignments.call(fake as any, "g1", {
      upsert: [{ productId: "p1", position: 3 }],
      deleteIds: ["as-old"],
    });
    const body = requests[0].body;
    expect(Object.keys(body)).toEqual(["upsert-assigned-products", "delete-assigned-products"]);
    const row = body["upsert-assigned-products"].payload[0];
    expect(row).toMatchObject({ crossSellingId: "g1", productId: "p1", position: 3 });
    expect(row.id).toMatch(/^[0-9a-f]{32}$/);

    await syncCrossSellingAssignments.call(fake as any, "g1", { upsert: [{ productId: "p1", position: 9 }], deleteIds: [] });
    expect(requests[1].body["upsert-assigned-products"].payload[0].id).toBe(row.id);
  });

  it("Anhaengen beginnt bei der uebergebenen Position", async () => {
    const { fake, requests } = recorder();
    await assignProductsToCrossSelling.call(fake as any, "g1", ["p1", "p2"], 4);
    expect(requests[0].body["upsert-assigned-products"].payload.map((p: any) => p.position)).toEqual([4, 5]);
  });
});
