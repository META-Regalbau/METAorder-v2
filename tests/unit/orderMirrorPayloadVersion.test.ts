/**
 * Bestell-Spiegel: einmaliges Neuladen bei neuer Payload-Version (v2: Versandangaben), Rechnungs-
 * Watcher dabei nur fuer den normalen Delta-Ausschnitt, Delta-Cursor inkl. Lieferungs-Aenderungen -
 * echter syncOrdersDelta mit Test-Shop und Test-Speicher.
 * Ausführung: npm test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../shared/schema";

const watched = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("../../server/invoicing/invoiceNumberWatcher", () => ({
  detectInvoiceNumberChanges: async (_storage: unknown, orders: Order[]) => {
    watched.calls.push(orders.map((o) => o.id));
    return [];
  },
  processInvoiceNumberChanges: async () => ({ created: 0, sent: 0, skipped: 0, failed: 0 }),
}));

import { createLogger, setLoggerForTests } from "../../server/lib/logger";
import { syncShopwareMirrorForTenant } from "../../server/shopware/shopwareMirror";

const CURSOR = new Date("2026-09-20T00:00:00.000Z");
function order(id: string, changedAt: string): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`, orderDate: "2026-09-01T00:00:00.000+00:00",
    createdAt: "2026-09-01T08:00:00.000+00:00", updatedAt: changedAt, status: "open", paymentStatus: "open", salesChannelId: "sc1", items: [],
  } as Order;
}

function setup(initialState: Record<string, unknown>) {
  const shop = { orders: [order("alt", "2026-09-10T00:00:00.000Z"), order("neu", "2026-09-21T00:00:00.000Z")], fingerprint: "fp-a", latestDeliveryUpdatedAt: null as string | null };
  const mirror = new Map<string, Order>(shop.orders.map((o) => [o.id, o]));
  const syncState: Record<string, unknown> = { ...initialState };
  const fetchCalls: Array<{ updatedSince: unknown }> = [];
  const storage = {
    upsertShopwareSyncState: async (_e: string, patch: Record<string, unknown>) => { Object.assign(syncState, patch); },
    getShopwareSyncState: async () => ({ ...syncState }),
    countShopwareOrderMirrors: async () => mirror.size,
    getShopwareOrderMirrorStates: async () => new Map(),
    upsertShopwareOrderMirrors: async (rows: Array<{ shopwareId: string; payload: unknown }>) => {
      for (const r of rows) mirror.set(r.shopwareId, r.payload as Order);
    },
    deleteShopwareOrderMirrorsNotIn: async () => 0,
    listShopwareOrderMirrorIds: async () => [...mirror.keys()],
  };
  const client = {
    fetchOrdersFingerprintDetails: async () => ({ fingerprint: shop.fingerprint, total: shop.orders.length, latestDeliveryUpdatedAt: shop.latestDeliveryUpdatedAt }),
    fetchOrders: async (_sc: unknown, opts?: { updatedSince?: unknown }) => {
      fetchCalls.push({ updatedSince: opts?.updatedSince ?? null });
      return shop.orders.map((o) => structuredClone(o));
    },
    fetchAllOrderIds: async () => ({ ids: shop.orders.map((o) => o.id), total: shop.orders.length }),
  };
  const sync = (opts: { force?: boolean } = {}) =>
    syncShopwareMirrorForTenant(storage as any, client as any, "tenant-a", { entities: ["orders"], ...opts });
  return { shop, syncState, fetchCalls, sync };
}

beforeEach(() => {
  setLoggerForTests(createLogger({ level: "silent", format: "json", destination: { write: () => {} } }));
  watched.calls = [];
  vi.stubEnv("INVOICE_NUMBER_WATCHER_ENABLED", "true");
  vi.stubEnv("SHOPWARE_SYNC_RECONCILE_MINUTES", "100000");
});
afterEach(() => {
  setLoggerForTests(null);
  vi.unstubAllEnvs();
});

const v1State = { lastFingerprint: "fp-a", cursorUpdatedAt: CURSOR, lastReconcileAt: new Date() };

describe("Bestell-Spiegel: Payload-Version", () => {
  it("Spiegel aus aelterer Version: einmal alle Bestellungen neu laden, trotz unveraendertem Fingerprint", async () => {
    const { syncState, fetchCalls, sync } = setup(v1State);
    await sync();
    expect(fetchCalls).toEqual([{ updatedSince: null }]);
    expect(syncState.lastFingerprint).toBe("v2:fp-a");
    await sync();
    expect(fetchCalls).toHaveLength(1); // danach greift der Fingerprint wieder
  });

  it("Rechnungs-Watcher beim Neuladen nur fuer Bestellungen seit dem bisherigen Cursor", async () => {
    const { sync } = setup(v1State);
    await sync();
    expect(watched.calls).toEqual([["neu"]]);
  });

  it("normaler Delta-Lauf und erzwungener Abgleich: Watcher wie bisher fuer alle abgerufenen Bestellungen", async () => {
    const { shop, fetchCalls, sync } = setup({ ...v1State, lastFingerprint: "v2:fp-a" });
    shop.fingerprint = "fp-b";
    await sync();
    expect(fetchCalls).toEqual([{ updatedSince: CURSOR }]);
    expect(watched.calls).toEqual([["alt", "neu"]]);
    await sync({ force: true });
    expect(fetchCalls[1]).toEqual({ updatedSince: null });
    expect(watched.calls[1]).toEqual(["alt", "neu"]);
  });

  it("Cursor: juengste Lieferungs-Aenderung zaehlt mit, wenn sie nach der juengsten Bestell-Aenderung liegt", async () => {
    const { shop, syncState, sync } = setup({ ...v1State, lastFingerprint: "v2:fp-a" });
    shop.fingerprint = "fp-b";
    shop.latestDeliveryUpdatedAt = "2026-09-25T12:00:00.000+00:00";
    await sync();
    expect(syncState.cursorUpdatedAt).toEqual(new Date("2026-09-25T12:00:00.000Z"));
    shop.fingerprint = "fp-c";
    shop.latestDeliveryUpdatedAt = "2026-09-15T00:00:00.000+00:00";
    await sync();
    expect(syncState.cursorUpdatedAt).toEqual(new Date("2026-09-25T12:00:00.000Z")); // nie rueckwaerts
  });
});
