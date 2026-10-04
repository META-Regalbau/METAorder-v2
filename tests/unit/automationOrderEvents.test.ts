/**
 * Bestell-Ausloeser: Aenderungserkennung im Shopware-Spiegel (erstellt / Status / Zahlungsstatus)
 * und Ausfuehrung der passenden Regeln.
 * Ausführung: npm test
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationRule, Order } from "../../shared/schema";
import { ORDER_EVENT_MAX_AGE_HOURS, validateAutomationRule } from "../../shared/automation";
import { detectOrderChanges, emitOrderChanges } from "../../server/shopware/orderChangeEvents";
import { syncShopwareMirrorForTenant } from "../../server/shopware/shopwareMirror";
import { runAutomationEvent } from "../../server/automation/engine";
import { registerAutomationTriggers } from "../../server/automation";
import type { AutomationDeps } from "../../server/automation/actions";
import { onDomainEvent } from "../../server/lib/domainEvents";
import { getTenantIdFromContext } from "../../server/lib/tenantContext";

const NOW = new Date("2026-10-04T12:00:00Z");
const hoursAgo = (h: number, from: Date = NOW) => new Date(from.getTime() - h * 3600000).toISOString();

function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`,
    orderDate: hoursAgo(5), createdAt: hoursAgo(5), updatedAt: undefined, deliveryDateLatest: hoursAgo(-48),
    totalAmount: 100, netTotalAmount: 84, status: "open", paymentStatus: "open", salesChannelId: "sc1", items: [],
    ...overrides,
  } as Order;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const offs: Array<() => void> = [];
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Aenderungserkennung
// ---------------------------------------------------------------------------

describe("Aenderungserkennung", () => {
  const known = (status: string | null, paymentStatus: string | null) => ({ status, paymentStatus });

  it("Erstimport (leerer Spiegel) meldet nichts", () => {
    expect(detectOrderChanges([order("1"), order("2")], new Map(), { initialImport: true, now: NOW })).toEqual([]);
  });

  it("neue, junge Bestellung -> erstellt; alte, bisher fehlende Bestellung ist nicht neu", () => {
    const fresh = order("neu", { createdAt: hoursAgo(1), orderDate: hoursAgo(1) });
    const old = order("alt", { createdAt: hoursAgo(24 * 30), orderDate: hoursAgo(24 * 30), updatedAt: hoursAgo(1) });
    expect(detectOrderChanges([fresh, old], new Map(), { initialImport: false, now: NOW })).toEqual([{ kind: "created", order: fresh }]);
  });

  it("Status- und Zahlungsaenderung mit vorherigem Wert", () => {
    const o = order("1", { status: "in_progress", paymentStatus: "paid", updatedAt: hoursAgo(2) });
    const changes = detectOrderChanges([o], new Map([["1", known("open", "open")]]), { initialImport: false, now: NOW });
    expect(changes).toEqual([
      { kind: "statusChanged", order: o, previousStatus: "open" },
      { kind: "paymentStatusChanged", order: o, previousPaymentStatus: "open" },
    ]);
  });

  it(`unveraendert, ohne bekannten Vorher-Wert oder aelter als ${ORDER_EVENT_MAX_AGE_HOURS} Stunden -> nichts`, () => {
    const previous = new Map([["same", known("open", "open")], ["unknown", known(null, null)], ["stale", known("open", "open")]]);
    const orders = [
      order("same", { updatedAt: hoursAgo(1) }),
      order("unknown", { status: "completed", paymentStatus: "paid", updatedAt: hoursAgo(1) }),
      order("stale", { status: "completed", createdAt: hoursAgo(24 * 10), updatedAt: hoursAgo(ORDER_EVENT_MAX_AGE_HOURS + 1) }),
    ];
    expect(detectOrderChanges(orders, previous, { initialImport: false, now: NOW })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Spiegel-Abgleich (echter syncOrdersDelta mit Test-Shop und Test-Speicher)
// ---------------------------------------------------------------------------

describe("Spiegel-Abgleich", () => {
  function setup() {
    vi.stubEnv("INVOICE_NUMBER_WATCHER_ENABLED", "false");
    const shop: { orders: Order[] } = { orders: [] };
    const mirror = new Map<string, Order>();
    const syncState: Record<string, unknown> = {};
    let failUpsert = false;
    const storage = {
      upsertShopwareSyncState: async (_entity: string, patch: Record<string, unknown>) => { Object.assign(syncState, patch); },
      getShopwareSyncState: async () => ({ ...syncState }),
      countShopwareOrderMirrors: async () => mirror.size,
      getShopwareOrderMirrorStates: async (ids: string[]) =>
        new Map(ids.filter((id) => mirror.has(id)).map((id) => [id, { status: mirror.get(id)!.status, paymentStatus: mirror.get(id)!.paymentStatus }])),
      upsertShopwareOrderMirrors: async (rows: Array<{ shopwareId: string; payload: unknown }>) => {
        // echte Wartezeit (Makrotask): wuerde vor dem Upsert gemeldet, liefen die Handler hier dazwischen
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (failUpsert) throw new Error("DB weg");
        for (const r of rows) mirror.set(r.shopwareId, structuredClone(r.payload) as Order);
      },
      deleteShopwareOrderMirrorsNotIn: async () => 0,
      listShopwareOrderMirrorIds: async () => [...mirror.keys()],
    };
    let fingerprint = 0;
    const client = {
      fetchOrdersFingerprintDetails: async () => ({ fingerprint: `fp${++fingerprint}`, total: shop.orders.length }),
      fetchOrders: async () => shop.orders.map((o) => structuredClone(o)),
      fetchAllOrderIds: async () => ({ ids: shop.orders.map((o) => o.id), total: shop.orders.length }),
    };
    const events: Array<Record<string, unknown>> = [];
    for (const name of ["order.created", "order.statusChanged", "order.paymentStatusChanged"] as const) {
      offs.push(onDomainEvent(name, (p: any) => {
        events.push({ name, id: p.order.id, previous: p.previousStatus ?? p.previousPaymentStatus, tenantId: p.tenantId, mirrorStatus: mirror.get(p.order.id)?.status });
      }));
    }
    const sync = async () => {
      await syncShopwareMirrorForTenant(storage as any, client as any, "tenant-a", { entities: ["orders"] });
      await flush();
    };
    return { shop, mirror, events, sync, failNextUpsert: () => { failUpsert = true; } };
  }

  it("Erstimport still; danach nur echte, junge Aenderungen - gemeldet erst nach dem Upsert", async () => {
    const now = new Date();
    const { shop, mirror, events, sync } = setup();
    shop.orders = [
      order("A", { createdAt: hoursAgo(5, now), orderDate: hoursAgo(5, now) }),
      order("OLD", { createdAt: hoursAgo(24 * 40, now), orderDate: hoursAgo(24 * 40, now), updatedAt: hoursAgo(24 * 39, now) }),
    ];
    await sync();
    expect(mirror.size).toBe(2);
    expect(events).toEqual([]);

    shop.orders = [
      { ...shop.orders[0], status: "in_progress", updatedAt: hoursAgo(0.1, now) },
      { ...shop.orders[1], status: "cancelled", updatedAt: hoursAgo(24 * 3, now) },
      order("B", { createdAt: hoursAgo(1, now), orderDate: hoursAgo(1, now) }),
    ];
    await sync();
    expect(events).toEqual([
      { name: "order.statusChanged", id: "A", previous: "open", tenantId: "tenant-a", mirrorStatus: "in_progress" },
      { name: "order.created", id: "B", previous: undefined, tenantId: "tenant-a", mirrorStatus: "open" },
    ]);

    // erneuter Abgleich ohne Aenderung: keine doppelten Meldungen
    await sync();
    expect(events).toHaveLength(2);
  });

  it("fehlgeschlagener Upsert meldet nichts", async () => {
    const now = new Date();
    const { shop, events, sync, failNextUpsert } = setup();
    shop.orders = [order("A", { createdAt: hoursAgo(5, now) })];
    await sync();
    shop.orders = [{ ...shop.orders[0], paymentStatus: "paid", updatedAt: hoursAgo(0.1, now) }];
    failNextUpsert();
    await expect(sync()).rejects.toThrow("DB weg");
    await flush();
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Regeln
// ---------------------------------------------------------------------------

let seq = 0;
function rule(overrides: Partial<AutomationRule> & { conditionsArr?: unknown[]; actionsArr?: unknown[] } = {}): AutomationRule {
  const { conditionsArr = [], actionsArr, ...rest } = overrides;
  seq += 1;
  return {
    id: `o${seq}`, tenantId: "tenant-a", name: `Bestellregel ${seq}`, description: null, enabled: 1, triggerType: "order_status_changed",
    conditions: JSON.stringify(conditionsArr),
    actions: JSON.stringify(actionsArr ?? [{ type: "create_ticket", params: { title: "{{order.orderNumber}}: {{order.previousStatus}} -> {{order.status}}", description: "{{order.customerName}}" } }]),
    priority: 0, schedule: null, lastExecutedAt: null, executionCount: 0, createdByUserId: null,
    createdAt: new Date(2026, 0, seq), updatedAt: new Date(),
    ...rest,
  } as AutomationRule;
}

function fakeDeps(rules: AutomationRule[]) {
  const created: any[] = [];
  const executions: any[] = [];
  let active = 0;
  let maxActive = 0;
  const storage = {
    getActiveAutomationRules: async () => rules.filter((r) => r.enabled === 1 && (r.tenantId ?? null) === getTenantIdFromContext()),
    createTicket: async (t: any) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      created.push({ ...t, tenantId: getTenantIdFromContext() });
      return { ...t, id: `t${created.length}`, ticketNumber: `T-${created.length}` };
    },
    createAutomationExecution: async (e: any) => { executions.push(e); return e; },
    incrementRuleExecutionCount: async () => {},
    createNotification: async (n: any) => n,
    getUser: async () => undefined,
    getTenantsForUser: async () => [],
  };
  const deps: AutomationDeps = { storage: storage as any, classifyTicket: vi.fn(), sendEmail: vi.fn(), onNotificationCreated: vi.fn() };
  return { deps, storage, created, executions, maxActive: () => maxActive };
}

describe("Regeln mit Bestell-Ausloeser", () => {
  it("Status geaendert: Bedingung auf vorherigen Status, Ticket mit Bestellbezug, Historie mit Bestellung", async () => {
    const r = rule({ conditionsArr: [
      { field: "order.previousStatus", operator: "equals", value: "open" },
      { field: "order.status", operator: "equals", value: "cancelled" },
    ] });
    const { deps, created, executions } = fakeDeps([r]);
    const o = order("9", { status: "cancelled" });

    await runAutomationEvent(deps, { trigger: "order_status_changed", tenantId: "tenant-a", order: o, previousStatus: "in_progress" });
    expect(created).toHaveLength(0);

    await runAutomationEvent(deps, { trigger: "order_status_changed", tenantId: "tenant-a", order: o, previousStatus: "open" });
    expect(created).toEqual([expect.objectContaining({ orderId: "9", orderNumber: "SW-9", title: "SW-9: open -> cancelled", description: "Kunde 9", tenantId: "tenant-a" })]);
    expect(executions[0]).toMatchObject({ status: "success", result: { trigger: "order_status_changed", entity: { type: "order", id: "9", number: "SW-9" } } });
  });

  it("Ereignisse aus dem Spiegel: richtiger Mandant, richtiger Ausloeser, nacheinander abgearbeitet", async () => {
    const payment = rule({
      triggerType: "order_payment_changed",
      conditionsArr: [{ field: "order.paymentStatus", operator: "equals", value: "failed" }],
      actionsArr: [{ type: "create_ticket", params: { title: "Zahlung {{order.orderNumber}}", description: "vorher: {{order.previousPaymentStatus}}" } }],
    });
    const createdRule = rule({ triggerType: "order_created", actionsArr: [{ type: "create_ticket", params: { title: "Neu {{order.orderNumber}}", description: "-" } }] });
    const otherTenant = rule({ triggerType: "order_created", tenantId: "tenant-b" });
    const { storage, created, maxActive } = fakeDeps([payment, createdRule, otherTenant]);
    offs.push(registerAutomationTriggers(storage as any));

    const failed = order("P", { paymentStatus: "failed" });
    emitOrderChanges(
      [
        { kind: "paymentStatusChanged", order: failed, previousPaymentStatus: "open" },
        { kind: "created", order: order("N1") },
        { kind: "created", order: order("N2") },
        { kind: "created", order: order("N3") },
      ],
      "tenant-a",
    );
    await vi.waitFor(() => expect(created).toHaveLength(4));
    expect(created.map((t) => `${t.tenantId}|${t.title}|${t.description}`)).toEqual([
      "tenant-a|Zahlung SW-P|vorher: open",
      "tenant-a|Neu SW-N1|-",
      "tenant-a|Neu SW-N2|-",
      "tenant-a|Neu SW-N3|-",
    ]);
    expect(maxActive()).toBe(1);
  });

  it("Pruefung: Vorher-Felder nur beim passenden Ausloeser, keine Ticket-Aktionen", () => {
    const createTicket = { type: "create_ticket", params: { title: "x", description: "y" } };
    expect(validateAutomationRule({ triggerType: "order_payment_changed", conditions: [{ field: "order.previousPaymentStatus", operator: "equals", value: "open" }], actions: [createTicket] })).toEqual([]);
    const errors = validateAutomationRule({
      triggerType: "order_created",
      conditions: [{ field: "order.previousStatus", operator: "equals", value: "open" }],
      actions: [{ type: "assign_ticket", params: { userId: "u1" } }],
    });
    expect(errors.join(" | ")).toMatch(/Feld "order.previousStatus" passt nicht zum Auslöser/);
    expect(errors.join(" | ")).toMatch(/braucht einen Ticket-Auslöser/);
  });
});
