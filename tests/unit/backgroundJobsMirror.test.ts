/**
 * Hintergrund-Jobs aus dem Bestell-Spiegel statt alle Bestellungen live: Helfer-Optionen
 * (Mandant aus dem Kontext, Dubletten wie der Live-Abruf, Abgleich vorab), Mahnkandidaten
 * (Kanaele, Dubletten-Auswahl, Abgleich im Job) und Smart Pricing (Mandant).
 * Spiegel, Abgleich und Shopware gemockt; ein Live-Abruf aller Bestellungen laesst den Test scheitern.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../shared/schema";

const state = vi.hoisted(() => ({ mirrorTenants: [] as unknown[], syncs: [] as unknown[], live: 0 }));
vi.mock("../../server/shopware/shopwareMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/shopware/shopwareMirror")>();
  return { ...actual, syncShopwareMirrorForTenant: async (_s: unknown, _c: unknown, tenantId: unknown) => { state.syncs.push(tenantId); } };
});

import { storage } from "../../server/storage";
import { ShopwareClient } from "../../server/shopware/shopware";
import { getMirrorOrdersLikeLive } from "../../server/routes/routeHelpers";
import { runWithTenantContext } from "../../server/lib/tenantContext";
import { getDunningCandidates, runDunningJob } from "../../server/invoicing/dunningJob";
import { generateSmartPricing } from "../../server/products/smartPricingEngine";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: "kunde@example.com", orderDate: "2026-09-01T00:00:00.000+00:00",
    invoiceDate: daysAgo(30), invoiceNumber: `RE-${id}`, totalAmount: 100, netTotalAmount: 84, status: "in_progress", paymentStatus: "open",
    salesChannelId: "sc1", items: [], ...overrides,
  } as Order;
}
// doppelt vergebene Nummer SW-d: d-1 kaeme bei fetchOrders zuerst (gleiches Datum, kleinere id), d-2 ist juenger geaendert
const MIRROR: Order[] = [
  order("d-2", { orderNumber: "SW-d", updatedAt: "2026-09-02T10:00:00Z" }),
  order("a", { salesChannelId: "sc2" }),
  order("d-1", { orderNumber: "SW-d", updatedAt: "2026-09-02T09:00:00Z" }),
];

beforeAll(() => {
  vi.spyOn(storage, "countShopwareOrderMirrors").mockResolvedValue(MIRROR.length);
  vi.spyOn(storage, "getShopwareOrderMirrors").mockImplementation(async (tenantId?: string | null) => {
    state.mirrorTenants.push(tenantId);
    return { rows: MIRROR.map((o) => ({ shopwareId: o.id, payload: structuredClone(o) })) as any, total: MIRROR.length };
  });
  vi.spyOn(storage, "getOrderDunningStatuses").mockResolvedValue([]);
  vi.spyOn(ShopwareClient.prototype as any, "fetchOrders").mockImplementation(async () => {
    state.live += 1;
    throw new Error("Live-Abruf nicht erwartet");
  });
  vi.spyOn(ShopwareClient.prototype as any, "findCustomerByEmail").mockResolvedValue({ id: "c1" });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  state.mirrorTenants = [];
  state.syncs = [];
  state.live = 0;
});

const client = () => new ShopwareClient({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
const dunning = { enabled: true, manualOnly: false, dueDateFieldKey: "invoiceDate", stageDays: [7, 14, 21] } as any;

describe("getMirrorOrdersLikeLive: Optionen", () => {
  it("ohne Mandanten-Angabe der Mandant aus dem Kontext (null bleibt der globale Bereich)", async () => {
    await runWithTenantContext("tenant-kontext", () => getMirrorOrdersLikeLive(client(), undefined));
    await runWithTenantContext("tenant-kontext", () => getMirrorOrdersLikeLive(client(), null));
    expect(state.mirrorTenants).toEqual(["tenant-kontext", null]);
  });

  it("Dubletten: Standard die zuletzt geaenderte, firstLikeLive die erste wie fetchOrders", async () => {
    expect((await getMirrorOrdersLikeLive(client(), "t")).map((o) => o.id)).toEqual(["a", "d-2"]);
    expect((await getMirrorOrdersLikeLive(client(), "t", { duplicates: "firstLikeLive" })).map((o) => o.id)).toEqual(["a", "d-1"]);
  });

  it("refresh: vorher Abgleich des Mandanten, sonst keiner", async () => {
    await getMirrorOrdersLikeLive(client(), "t");
    expect(state.syncs).toEqual([]);
    await getMirrorOrdersLikeLive(client(), "t", { refresh: true });
    expect(state.syncs).toEqual(["t"]);
  });
});

describe("Mahnkandidaten (getDunningCandidates)", () => {
  it("aus dem Spiegel, Dublette wie bisher (d-1), kein Live-Abruf", async () => {
    const candidates = await getDunningCandidates(storage, client(), dunning, null, "tenant-a");
    expect(candidates.map((c) => c.order.id).sort()).toEqual(["a", "d-1"]);
    expect(state.mirrorTenants).toEqual(["tenant-a"]);
    expect(state.live).toBe(0);
  });

  it("Kanaele: Liste filtert, leere Liste heisst keine Bestellungen (frueher: alle)", async () => {
    expect((await getDunningCandidates(storage, client(), dunning, ["sc2"], "tenant-a")).map((c) => c.order.id)).toEqual(["a"]);
    expect(await getDunningCandidates(storage, client(), dunning, [], "tenant-a")).toEqual([]);
  });

  it("der Mahn-Job gleicht den Spiegel vorher ab, die Vorschau nicht", async () => {
    await getDunningCandidates(storage, client(), dunning, null, "tenant-a");
    expect(state.syncs).toEqual([]);
    await getDunningCandidates(storage, client(), dunning, null, "tenant-a", { refreshMirror: true });
    expect(state.syncs).toEqual(["tenant-a"]);
  });

  it("runDunningJob: je Mandant mit automatischem Mahnwesen vorher Abgleich (hier ohne Versand: Stufe 3 erreicht)", async () => {
    const spies = [
      vi.spyOn(storage, "getAllTenants").mockResolvedValue([{ id: "tenant-a" }, { id: "tenant-b" }] as any),
      vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any),
      vi.spyOn(storage, "getDunningSettings").mockImplementation(async (t?: string | null) => (t === "tenant-a" ? { enabled: true, manualOnly: false } : { enabled: false }) as any),
      vi.spyOn(storage, "getOrderDunningStatuses").mockImplementation(async (ids: string[]) => ids.map((orderId) => ({ orderId, stage: 3 })) as any),
    ];
    await runDunningJob(storage);
    spies.forEach((s) => s.mockRestore());
    vi.spyOn(storage, "getOrderDunningStatuses").mockResolvedValue([]);
    expect(state.syncs).toEqual(["tenant-a"]);
    expect(state.live).toBe(0);
  });
});

describe("Smart Pricing", () => {
  it("Kundenkennzahlen aus dem Spiegel des Mandanten, kein Live-Abruf", async () => {
    await generateSmartPricing([], "kunde@example.com", undefined, client(), "tenant-a");
    expect(state.mirrorTenants).toEqual(["tenant-a"]);
    expect(state.live).toBe(0);
  });
});
