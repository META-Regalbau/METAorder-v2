/**
 * Mehrfach vergebene Bestellnummern (Live: 31 Nummern mit 36 weiteren Bestellungen): der
 * Bestell-Spiegel haelt jede Shopware-Bestellung aktuell; Aenderungen werden je Lauf nur einmal je
 * Bestellnummer gemeldet (Automatisierung: je Art, Rechnungs-Watcher: je Rechnungsnummer) -
 * fetchOrders gegen ein simuliertes Shopware, echter syncOrdersDelta mit Test-Shop und Test-Speicher.
 * Ausführung: npm test
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../shared/schema";

const watched = vi.hoisted(() => ({ processed: [] as string[][] }));
vi.mock("../../server/invoicing/invoiceNumberWatcher", () => ({
  // vereinfacht: jede Bestellung mit Rechnungsnummer gilt als geaendert
  detectInvoiceNumberChanges: async (_storage: unknown, orders: Order[]) =>
    orders.filter((o) => o.invoiceNumber).map((order) => ({ order, previousInvoiceNumber: null })),
  processInvoiceNumberChanges: async (_s: unknown, _c: unknown, _t: unknown, changes: Array<{ order: Order }>) => {
    watched.processed.push(changes.map((c) => c.order.id));
    return { created: 0, sent: 0, skipped: 0, failed: 0 };
  },
}));

import { createLogger, setLoggerForTests } from "../../server/lib/logger";
import { onDomainEvent } from "../../server/lib/domainEvents";
import { ShopwareClient } from "../../server/shopware/shopware";
import { syncShopwareMirrorForTenant } from "../../server/shopware/shopwareMirror";

// --- fetchOrders gegen ein simuliertes Shopware ---------------------------------------------
const swOrders = vi.hoisted(() => ({ list: [] as any[] }));
function swOrder(id: string, orderNumber: string) {
  return {
    id, orderNumber, orderDate: "2026-06-17T00:00:00.000+00:00", createdAt: "2026-06-17T08:14:15.000+00:00", updatedAt: null,
    amountTotal: 119, amountNet: 100, salesChannelId: "sc1", customFields: {},
    orderCustomer: { firstName: "Max", lastName: "Muster", email: "m@example.com" },
    stateMachineState: { technicalName: "in_progress" }, transactions: [], lineItems: [], deliveries: [],
  };
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("fetchOrders: mehrfach vergebene Bestellnummern", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/oauth/token") return json({ access_token: "tok", expires_in: 600, token_type: "Bearer" });
      if (path === "/api/search/order") return json({ data: swOrders.list, total: swOrders.list.length });
      return json({ data: [], total: 0 });
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    return () => log.mockRestore();
  });
  afterAll(() => vi.unstubAllGlobals());
  const client = () => new ShopwareClient({ shopwareUrl: "https://shop.invalid", apiKey: "k", apiSecret: "s" } as any);

  it("ohne Option je Nummer nur die zuerst gelieferte, mit keepDuplicateOrderNumbers alle (doppelte id weiterhin einmal)", async () => {
    swOrders.list = [swOrder("a1", "278278"), swOrder("a2", "278278"), swOrder("b", "279531"), swOrder("a1", "278278")];
    expect((await client().fetchOrders(null)).map((o) => o.id)).toEqual(["a1", "b"]);
    expect((await client().fetchOrders(null, { keepDuplicateOrderNumbers: true })).map((o) => o.id)).toEqual(["a1", "a2", "b"]);
  });
});

// --- Spiegel-Abgleich ------------------------------------------------------------------------
const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3600000).toISOString();
function order(id: string, orderNumber: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`, orderDate: hoursAgo(30),
    createdAt: hoursAgo(30), updatedAt: hoursAgo(20), status: "in_progress", paymentStatus: "authorized", salesChannelId: "sc1", items: [],
    ...overrides,
  } as Order;
}

function setup() {
  const shop = { orders: [] as Order[] };
  const mirror = new Map<string, Order>();
  const syncState: Record<string, unknown> = {};
  const fetchOptions: Array<Record<string, unknown>> = [];
  let fp = 0;
  const storage = {
    upsertShopwareSyncState: async (_e: string, patch: Record<string, unknown>) => { Object.assign(syncState, patch); },
    getShopwareSyncState: async () => ({ ...syncState }),
    countShopwareOrderMirrors: async () => mirror.size,
    getShopwareOrderMirrorStates: async (ids: string[]) =>
      new Map(ids.filter((id) => mirror.has(id)).map((id) => [id, { status: mirror.get(id)!.status, paymentStatus: mirror.get(id)!.paymentStatus }])),
    upsertShopwareOrderMirrors: async (rows: Array<{ shopwareId: string; payload: unknown }>) => {
      for (const r of rows) mirror.set(r.shopwareId, structuredClone(r.payload) as Order);
    },
    deleteShopwareOrderMirrorsNotIn: async () => 0,
    listShopwareOrderMirrorIds: async () => [...mirror.keys()],
  };
  // wie Shopware/fetchOrders: Delta ab updatedSince; ohne keepDuplicateOrderNumbers je Nummer nur die erste
  const pick = (orders: Order[], opts?: Record<string, unknown>) => {
    const ids = opts?.ids as string[] | undefined;
    const since = opts?.updatedSince ? new Date(opts.updatedSince as string | Date).getTime() : null;
    const changedAt = (o: Order) => Math.max(new Date(o.updatedAt ?? 0).getTime(), new Date(o.createdAt ?? 0).getTime());
    const list = orders
      .filter((o) => (!ids || ids.includes(o.id)) && (since === null || changedAt(o) >= since))
      .map((o) => structuredClone(o));
    if (opts?.keepDuplicateOrderNumbers) return list;
    const seen = new Set<string>();
    return list.filter((o) => !seen.has(o.orderNumber) && !!seen.add(o.orderNumber));
  };
  const client = {
    fetchOrdersFingerprintDetails: async () => ({ fingerprint: `fp${++fp}`, total: shop.orders.length }),
    fetchOrders: async (_sc: unknown, opts?: Record<string, unknown>) => {
      fetchOptions.push(opts ?? {});
      return pick(shop.orders, opts);
    },
    fetchAllOrderIds: async () => ({ ids: shop.orders.map((o) => o.id), total: shop.orders.length }),
  };
  const sync = async () => {
    await syncShopwareMirrorForTenant(storage as any, client as any, "tenant-a", { entities: ["orders"] });
    await new Promise((resolve) => setImmediate(resolve)); // Ereignis-Handler laufen per setImmediate
  };
  return { shop, mirror, syncState, fetchOptions, sync };
}

const offs: Array<() => void> = [];
let events: string[] = [];
beforeEach(() => {
  setLoggerForTests(createLogger({ level: "silent", format: "json", destination: { write: () => {} } }));
  vi.stubEnv("INVOICE_NUMBER_WATCHER_ENABLED", "true");
  watched.processed = [];
  events = [];
  for (const name of ["order.created", "order.statusChanged", "order.paymentStatusChanged"] as const) {
    offs.push(onDomainEvent(name, (p: any) => { events.push(`${name}:${p.order.id}`); }));
  }
});
afterEach(() => {
  while (offs.length) offs.pop()!();
  setLoggerForTests(null);
  vi.unstubAllEnvs();
});

describe("Bestell-Spiegel: mehrfach vergebene Bestellnummern", () => {
  it("Erstimport und Abgleich fehlender Bestellungen: alle Kopien landen im Spiegel", async () => {
    const { shop, mirror, syncState, fetchOptions, sync } = setup();
    shop.orders = [order("a1", "278278"), order("a2", "278278"), order("b", "279531")];
    await sync();
    expect([...mirror.keys()].sort()).toEqual(["a1", "a2", "b"]);
    expect(fetchOptions[0]).toMatchObject({ keepDuplicateOrderNumbers: true });
    // fehlt eine Kopie im Spiegel, holt der Abgleich sie - ebenfalls ohne Zusammenfassen
    mirror.clear();
    mirror.set("b", shop.orders[2]);
    syncState.cursorUpdatedAt = new Date(); // Delta liefert nichts mehr
    syncState.lastReconcileAt = null; // Abgleich jetzt faellig
    await sync();
    expect(fetchOptions.some((o) => Array.isArray(o.ids) && o.keepDuplicateOrderNumbers === true)).toBe(true);
    expect([...mirror.keys()].sort()).toEqual(["a1", "a2", "b"]);
  });

  it("beide Kopien im selben Lauf geaendert: Spiegel fuer beide aktuell, je Art nur ein Ereignis (erste Kopie)", async () => {
    const { shop, mirror, sync } = setup();
    shop.orders = [order("a1", "278278"), order("a2", "278278"), order("b", "279531")];
    await sync();
    shop.orders = [
      order("a1", "278278", { status: "completed", paymentStatus: "paid", updatedAt: hoursAgo(1) }),
      order("a2", "278278", { status: "completed", paymentStatus: "paid", updatedAt: hoursAgo(1) }),
      order("b", "279531", { status: "completed", updatedAt: hoursAgo(1) }),
    ];
    await sync();
    expect(mirror.get("a1")).toMatchObject({ status: "completed", paymentStatus: "paid" });
    expect(mirror.get("a2")).toMatchObject({ status: "completed", paymentStatus: "paid" });
    expect(events.sort()).toEqual(["order.paymentStatusChanged:a1", "order.statusChanged:a1", "order.statusChanged:b"]);
  });

  it("Bestellungen ohne Bestellnummer werden nicht zusammengefasst", async () => {
    const { shop, sync } = setup();
    shop.orders = [order("x1", ""), order("x2", "")];
    await sync();
    shop.orders = [order("x1", "", { status: "completed", updatedAt: hoursAgo(1) }), order("x2", "", { status: "completed", updatedAt: hoursAgo(1) })];
    await sync();
    expect(events.sort()).toEqual(["order.statusChanged:x1", "order.statusChanged:x2"]);
  });

  it("Rechnungs-Watcher: gleiche Rechnungsnummer an mehreren Kopien nur einmal, verschiedene Nummern je einmal", async () => {
    const { shop, sync } = setup();
    shop.orders = [order("a1", "278278"), order("a2", "278278"), order("c1", "285854"), order("c2", "285854")];
    await sync();
    watched.processed = [];
    const t = hoursAgo(1);
    shop.orders = [
      order("a1", "278278", { invoiceNumber: "RE-1", updatedAt: t }),
      order("a2", "278278", { invoiceNumber: "RE-1", updatedAt: t }),
      order("c1", "285854", { invoiceNumber: "RE-2", updatedAt: t }),
      order("c2", "285854", { invoiceNumber: "RE-3", updatedAt: t }),
    ];
    await sync();
    expect(watched.processed).toEqual([["a1", "c1", "c2"]]);
  });

  it("aendert sich spaeter nur die zweite Kopie, meldet sie sich wie bisher - mit aktuellem Vorher-Stand", async () => {
    const { shop, sync } = setup();
    shop.orders = [order("a1", "278278"), order("a2", "278278")];
    await sync();
    shop.orders = [order("a1", "278278"), order("a2", "278278", { status: "cancelled", updatedAt: hoursAgo(1) })];
    await sync();
    expect(events).toEqual(["order.statusChanged:a2"]);
  });
});
