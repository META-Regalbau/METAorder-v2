/**
 * Strukturierte Logs des Shopware-Spiegels und des Rechnungs-Watchers: Felder (component,
 * tenantId, entity, Zaehlwerte, Dauer, Fehler mit Stacktrace) bei unveraenderten Texten.
 * Ausführung: npm test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../shared/schema";
import { createLogger, setLoggerForTests } from "../../server/lib/logger";
import { runWithTenantContext } from "../../server/lib/tenantContext";
import { syncShopwareMirrorForTenant, triggerShopwareMirrorSync } from "../../server/shopware/shopwareMirror";
import { detectInvoiceNumberChanges } from "../../server/invoicing/invoiceNumberWatcher";

let lines: Record<string, any>[] = [];
let raw: string[] = [];
beforeEach(() => {
  lines = [];
  raw = [];
  setLoggerForTests(
    createLogger({ level: "trace", format: "json", destination: { write: (c: string) => { raw.push(c); lines.push(JSON.parse(c)); } } }),
  );
  vi.stubEnv("INVOICE_NUMBER_WATCHER_ENABLED", "false");
});
afterEach(() => {
  setLoggerForTests(null);
  vi.unstubAllEnvs();
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`,
    orderDate: hoursAgo(5), createdAt: hoursAgo(5), status: "open", paymentStatus: "open", salesChannelId: "sc1", items: [],
    ...overrides,
  } as Order;
}

function fakeShop() {
  const shop: { orders: Order[] } = { orders: [] };
  const mirror = new Map<string, Order>();
  const syncState: Record<string, unknown> = {};
  let failUpsert = false;
  const storage = {
    upsertShopwareSyncState: async (_e: string, patch: Record<string, unknown>) => { Object.assign(syncState, patch); },
    getShopwareSyncState: async () => ({ ...syncState }),
    countShopwareOrderMirrors: async () => mirror.size,
    getShopwareOrderMirrorStates: async (ids: string[]) =>
      new Map(ids.filter((id) => mirror.has(id)).map((id) => [id, { status: mirror.get(id)!.status, paymentStatus: mirror.get(id)!.paymentStatus }])),
    upsertShopwareOrderMirrors: async (rows: Array<{ shopwareId: string; payload: unknown }>) => {
      if (failUpsert) throw new Error("DB weg");
      for (const r of rows) mirror.set(r.shopwareId, structuredClone(r.payload) as Order);
    },
    deleteShopwareOrderMirrorsNotIn: async () => 0,
    listShopwareOrderMirrorIds: async () => [...mirror.keys()],
  };
  let fp = 0;
  const client = {
    fetchOrdersFingerprintDetails: async () => ({ fingerprint: `fp${++fp}`, total: shop.orders.length }),
    fetchOrders: async () => shop.orders.map((o) => structuredClone(o)),
    fetchAllOrderIds: async () => ({ ids: shop.orders.map((o) => o.id), total: shop.orders.length }),
  };
  const sync = () => syncShopwareMirrorForTenant(storage as any, client as any, "tenant-a", { entities: ["orders"] });
  return { shop, storage, client, sync, failNextUpsert: () => { failUpsert = true; } };
}

describe("Shopware-Spiegel: strukturierte Logs", () => {
  it("Abschlusszeile: Text wie bisher, dazu component/tenantId/entity, Zaehlwerte und Dauer", async () => {
    const { shop, sync } = fakeShop();
    shop.orders = [order("A"), order("B")];
    await sync();
    const done = lines.find((l) => l.msg.startsWith("[ShopwareMirror] orders: upserted="));
    expect(done).toMatchObject({
      level: "info",
      msg: "[ShopwareMirror] orders: upserted=2 (delta=2, missing=0) skipped=false tenant=tenant-a",
      component: "shopware-mirror",
      tenantId: "tenant-a",
      entity: "orders",
      upserted: 2,
      delta: 2,
      missing: 0,
    });
    expect(typeof done!.durationMs).toBe("number");
  });

  it("gemeldete Bestell-Aenderungen mit Anzahl je Art", async () => {
    const { shop, sync } = fakeShop();
    shop.orders = [order("A")];
    await sync();
    shop.orders = [{ ...shop.orders[0], status: "in_progress", paymentStatus: "paid", updatedAt: hoursAgo(0.1) }, order("B", { createdAt: hoursAgo(1) })];
    await sync();
    expect(lines.find((l) => l.msg.includes("Aenderung(en) gemeldet"))).toMatchObject({
      msg: "[ShopwareMirror] orders: 3 Aenderung(en) gemeldet (tenant=tenant-a)",
      changes: 3, created: 1, statusChanged: 1, paymentStatusChanged: 1, entity: "orders",
    });
  });

  it("im Mandanten-Kontext (Anstoss aus einer Anfrage) steht tenantId nur einmal im JSON", async () => {
    const { shop, sync } = fakeShop();
    shop.orders = [order("A")];
    await runWithTenantContext("tenant-a", () => sync());
    const i = lines.findIndex((l) => l.msg.startsWith("[ShopwareMirror] orders: upserted="));
    expect(raw[i].match(/"tenantId"/g)).toHaveLength(1);
  });

  it("Fehler im Hintergrund-Anstoss: Fehler als Feld mit Stacktrace, Meldung im Text wie bisher", async () => {
    const { shop, storage, client, sync, failNextUpsert } = fakeShop();
    shop.orders = [order("A")];
    await sync();
    failNextUpsert();
    shop.orders = [{ ...shop.orders[0], updatedAt: hoursAgo(0.1), status: "completed" }];
    triggerShopwareMirrorSync(storage as any, client as any, "tenant-a", ["orders" as any]);
    await vi.waitFor(() => expect(lines.some((l) => l.level === "error")).toBe(true));
    const err = lines.find((l) => l.level === "error")!;
    expect(err).toMatchObject({
      msg: "[ShopwareMirror] Background trigger failed (tenant=tenant-a): DB weg",
      component: "shopware-mirror",
      tenantId: "tenant-a",
      err: { message: "DB weg" },
    });
    expect(err.err.stack).toContain("DB weg");
  });
});

describe("Rechnungs-Watcher: strukturierte Logs", () => {
  it("ohne vorherigen Spiegel-Stand: info mit Bestellung und Rechnungsnummer; unveraendert: nur debug", async () => {
    const mirror = new Map<string, unknown>([["o2", { payload: { invoiceNumber: "RE-2" } }]]);
    const storage = { getShopwareOrderMirrorByShopwareId: async (id: string) => mirror.get(id) ?? null };
    const changes = await detectInvoiceNumberChanges(
      storage as any,
      [order("o1", { invoiceNumber: "RE-1" } as any), order("o2", { invoiceNumber: "RE-2" } as any)],
      "tenant-a",
    );
    expect(changes).toEqual([]);
    expect(lines.find((l) => l.orderId === "o1")).toMatchObject({
      level: "info",
      msg: "[InvoiceWatcher] SW-o1: Rechnungsnummer RE-1 ohne vorherigen Spiegel-Stand – uebersprungen",
      component: "invoice-watcher", tenantId: "tenant-a", orderNumber: "SW-o1", invoiceNumber: "RE-1",
    });
    expect(lines.find((l) => l.orderId === "o2")).toMatchObject({ level: "debug", invoiceNumber: "RE-2" });
  });
});
