/**
 * Zeitgesteuerte Automatisierung: Bestellungen aus dem Shopware-Spiegel pruefen.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";
import type { AutomationRule, Order } from "../../shared/schema";
import { SCHEDULED_MAX_PER_RULE_PER_RUN, validateAutomationRule } from "../../shared/automation";
import { orderFacts } from "../../server/automation/engine";
import { previewScheduledRule, runScheduledAutomations } from "../../server/automation/scheduler";
import { resolveScheduleIntervalMinutes } from "../../server/automation";
import type { AutomationDeps } from "../../server/automation/actions";
import { getTenantIdFromContext } from "../../server/lib/tenantContext";

const NOW = new Date("2026-10-04T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`,
    orderDate: daysAgo(10), deliveryDateLatest: daysAgo(5), totalAmount: 100, netTotalAmount: 84,
    status: "in_progress", paymentStatus: "paid", salesChannelId: "sc1", items: [],
    ...overrides,
  } as Order;
}

let seq = 0;
function rule(overrides: Partial<AutomationRule> & { conditionsArr?: unknown[]; actionsArr?: unknown[] } = {}): AutomationRule {
  const { conditionsArr, actionsArr, ...rest } = overrides;
  seq += 1;
  return {
    id: `s${seq}`, tenantId: "tenant-a", name: `Zeitregel ${seq}`, description: null, enabled: 1, triggerType: "scheduled",
    conditions: JSON.stringify(conditionsArr ?? [{ field: "order.daysPastDeliveryDate", operator: "greaterThanOrEqual", value: 3 }]),
    actions: JSON.stringify(actionsArr ?? [{ type: "create_ticket", params: { title: "{{order.orderNumber}} verspätet", description: "{{order.customerName}}: {{order.daysPastDeliveryDate}} Tage" } }]),
    priority: 0, schedule: null, lastExecutedAt: null, executionCount: 0, createdByUserId: null,
    createdAt: new Date(2026, 0, seq), updatedAt: new Date(),
    ...rest,
  } as AutomationRule;
}

/** Test-Speicher wie DbStorage: Mandant aus dem Kontext; Statistik aus den protokollierten Ausfuehrungen. */
function fake(rules: AutomationRule[], ordersByTenant: Record<string, Order[]>, opts: { sendEmailFails?: boolean } = {}) {
  const executions: any[] = [];
  const created: any[] = [];
  const storage = {
    getAllTenants: async () => [{ id: "tenant-a" }, { id: "tenant-b" }],
    getActiveAutomationRules: async () => rules.filter((r) => r.enabled === 1 && (r.tenantId ?? null) === getTenantIdFromContext()),
    getShopwareOrderMirrors: async (tenantId: string | null) => {
      const list = ordersByTenant[tenantId ?? ""] ?? [];
      return { rows: list.map((o) => ({ payload: o })), total: list.length };
    },
    getAutomationEntityRunStats: async (ruleId: string, type: string) => {
      const stats = new Map<string, { succeeded: boolean; failures: number }>();
      for (const e of executions.filter((x) => x.ruleId === ruleId && x.result.entity?.type === type)) {
        const s = stats.get(e.result.entity.id) ?? { succeeded: false, failures: 0 };
        if (e.status === "success") s.succeeded = true; else s.failures += 1;
        stats.set(e.result.entity.id, s);
      }
      return stats;
    },
    createAutomationExecution: async (e: any) => { executions.push({ ...e, tenantId: getTenantIdFromContext() }); return e; },
    incrementRuleExecutionCount: async () => {},
    createTicket: async (t: any) => { created.push({ ...t, tenantId: getTenantIdFromContext() }); return { ...t, id: `t${created.length}`, ticketNumber: `T-${created.length}` }; },
    createNotification: async (n: any) => n,
    getUser: async () => undefined,
    getTenantsForUser: async () => [],
  };
  const deps: AutomationDeps = {
    storage: storage as any,
    classifyTicket: vi.fn(),
    sendEmail: vi.fn(async () => { if (opts.sendEmailFails) throw new Error("Outbound email disabled"); }),
    onNotificationCreated: vi.fn(),
  };
  return { deps, executions, created };
}

describe("Fakten einer Bestellung", () => {
  it("Tage seit Bestellung und seit spaetestem Lieferdatum (sonst Bestelldatum)", () => {
    const f = orderFacts(order("1", { orderDate: daysAgo(10), deliveryDateLatest: daysAgo(4) }), NOW);
    expect(f["order.daysSinceOrder"]).toBe(10);
    expect(f["order.daysPastDeliveryDate"]).toBe(4);
    expect(orderFacts(order("2", { deliveryDateLatest: undefined }), NOW)["order.daysPastDeliveryDate"]).toBe(10);
  });

  it("ja/nein: ERP-Auftragsnummer, Rechnung (Nummer oder Dokument), versandt (Versanddatum oder Sendungsnummer)", () => {
    const facts = (o: Partial<Order>) => orderFacts(order("x", o), NOW);
    const none = facts({});
    expect([none["order.hasErpNumber"], none["order.hasInvoice"], none["order.isShipped"]]).toEqual([false, false, false]);
    expect(facts({ erpNumber: " 0000013398 " })["order.hasErpNumber"]).toBe(true);
    expect(facts({ erpNumber: "  " })["order.hasErpNumber"]).toBe(false);
    expect(facts({ invoiceNumber: "RE-1" })["order.hasInvoice"]).toBe(true);
    expect(facts({ hasInvoiceDocument: true })["order.hasInvoice"]).toBe(true);
    expect(facts({ shippingInfo: { carrier: "DPD", shippedDate: daysAgo(1) } })["order.isShipped"]).toBe(true);
    expect(facts({ shippingInfo: { trackingCodes: ["123"] } })["order.isShipped"]).toBe(true);
    expect(facts({ shippingInfo: { carrier: "Spedition" } })["order.isShipped"]).toBe(false);
  });
});

describe("Zeitgesteuerte Regeln", () => {
  it("legt fuer passende Bestellungen ein verknuepftes Ticket an - nur im eigenen Mandanten", async () => {
    const r = rule({ conditionsArr: [
      { field: "order.daysPastDeliveryDate", operator: "greaterThanOrEqual", value: 3 },
      { field: "order.status", operator: "notEquals", value: "completed" },
    ] });
    const { deps, created } = fake([r], {
      "tenant-a": [order("a1"), order("a2", { status: "completed" }), order("a3", { deliveryDateLatest: daysAgo(1) })],
      "tenant-b": [order("b1")],
    });
    const summary = await runScheduledAutomations(deps, NOW);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ orderId: "a1", orderNumber: "SW-a1", customerEmail: "a1@example.com", title: "SW-a1 verspätet", description: "Kunde a1: 5 Tage", tenantId: "tenant-a" });
    expect(summary).toEqual([expect.objectContaining({ tenantId: "tenant-a", matching: 1, executed: 1, remaining: 0 })]);
  });

  it("Listen-Operatoren und ja/nein-Felder", async () => {
    const r = rule({ conditionsArr: [
      { field: "order.paymentMethod", operator: "containsAny", value: ["Vorkasse", "Echtzeitüberweisung"] },
      { field: "order.paymentStatus", operator: "isOneOf", value: ["open", "failed"] },
      { field: "order.hasErpNumber", operator: "equals", value: false },
    ] });
    const { deps, created } = fake([r], { "tenant-a": [
      order("v1", { paymentMethod: "Vorkasse", paymentStatus: "open" }),
      order("v2", { paymentMethod: "Echtzeitüberweisung", paymentStatus: "failed" }),
      order("v3", { paymentMethod: "Vorkasse", paymentStatus: "paid" }),
      order("v4", { paymentMethod: "PayPal", paymentStatus: "open" }),
      order("v5", { paymentMethod: "Vorkasse", paymentStatus: "open", erpNumber: "0000013398" }),
    ] });
    await runScheduledAutomations(deps, NOW);
    expect(created.map((t) => t.orderId)).toEqual(["v1", "v2"]);
  });

  it(`ignoriert Bestellungen ausserhalb des Pruefzeitraums`, async () => {
    const { deps, created } = fake([rule()], { "tenant-a": [order("alt", { orderDate: daysAgo(400), deliveryDateLatest: daysAgo(390) })] });
    await runScheduledAutomations(deps, NOW);
    expect(created).toHaveLength(0);
  });

  it("verarbeitet jede Bestellung nur einmal pro Regel", async () => {
    const { deps, created } = fake([rule()], { "tenant-a": [order("1"), order("2")] });
    await runScheduledAutomations(deps, NOW);
    await runScheduledAutomations(deps, NOW);
    expect(created.map((t) => t.orderId)).toEqual(["1", "2"]);
  });

  it("wiederholt Fehlversuche, aber hoechstens dreimal", async () => {
    const r = rule({ actionsArr: [{ type: "send_email", params: { to: "{{order.customerEmail}}", subject: "x", body: "y" } }] });
    const { deps, executions } = fake([r], { "tenant-a": [order("1")] }, { sendEmailFails: true });
    for (let i = 0; i < 5; i++) await runScheduledAutomations(deps, NOW);
    expect(executions.filter((e) => e.status === "failure")).toHaveLength(3);
    expect(deps.sendEmail).toHaveBeenCalledTimes(3);
  });

  it(`hoechstens ${SCHEDULED_MAX_PER_RULE_PER_RUN} Ausfuehrungen je Lauf, aelteste Bestellungen zuerst`, async () => {
    // 30 Bestellungen, alle mindestens 6 Tage ueber dem Lieferdatum
    const many = Array.from({ length: 30 }, (_, i) => order(`o${i}`, { orderDate: daysAgo(45 - i), deliveryDateLatest: daysAgo(35 - i) }));
    const { deps, created } = fake([rule()], { "tenant-a": [...many].reverse() });
    const first = await runScheduledAutomations(deps, NOW);
    expect(created).toHaveLength(SCHEDULED_MAX_PER_RULE_PER_RUN);
    expect(created[0].orderId).toBe("o0");
    expect(first[0]).toMatchObject({ matching: 30, executed: 25, remaining: 5 });
    await runScheduledAutomations(deps, NOW);
    expect(created).toHaveLength(30);
  });

  it("Vorschau zaehlt, zieht Erledigtes ab und fuehrt nichts aus", async () => {
    const r = rule();
    const { deps, created, executions } = fake([r], { "tenant-a": [order("1"), order("2"), order("3", { deliveryDateLatest: daysAgo(0) })] });
    const conditions = JSON.parse(r.conditions!);
    const before = await previewScheduledRule(deps, "tenant-a", conditions, null, NOW);
    expect(before).toMatchObject({ matching: 2, alreadyDone: 0, nextRun: 2 });
    expect(before.sample.map((s) => s.orderNumber)).toEqual(["SW-1", "SW-2"]);
    expect(created).toHaveLength(0);
    expect(executions).toHaveLength(0);

    await runScheduledAutomations(deps, NOW);
    const after = await previewScheduledRule(deps, "tenant-a", conditions, r.id, NOW);
    expect(after).toMatchObject({ matching: 2, alreadyDone: 2, nextRun: 0, sample: [] });
  });

  describe("doppelt angelegte Bestellungen (gleiche Bestellnummer)", () => {
    const notCompleted = [
      { field: "order.daysPastDeliveryDate", operator: "greaterThanOrEqual", value: 3 },
      { field: "order.status", operator: "notEquals", value: "completed" },
    ];

    it("passen beide Kopien, gibt es nur eine Ausfuehrung - auch in spaeteren Laeufen", async () => {
      const { deps, created } = fake([rule()], { "tenant-a": [order("k2", { orderNumber: "278278" }), order("k1", { orderNumber: "278278" }), order("x")] });
      const first = await runScheduledAutomations(deps, NOW);
      await runScheduledAutomations(deps, NOW);
      expect(created.map((t) => t.orderId)).toEqual(["k1", "x"]); // gleiches Datum: nach id
      expect(first[0]).toMatchObject({ matching: 2, executed: 2, remaining: 0 });
    });

    it("die Bedingungen gelten je Kopie: passt nur die zweite (erste storniert), wird sie ausgefuehrt", async () => {
      const { deps, created } = fake([rule({ conditionsArr: notCompleted })], {
        "tenant-a": [order("k1", { orderNumber: "278278", status: "completed" }), order("k2", { orderNumber: "278278" })],
      });
      await runScheduledAutomations(deps, NOW);
      expect(created.map((t) => t.orderId)).toEqual(["k2"]);
    });

    it("ist eine Kopie schon erledigt, laeuft die Regel fuer die andere nicht mehr", async () => {
      const r = rule({ conditionsArr: notCompleted });
      const orders = [order("k1", { orderNumber: "278278" }), order("k2", { orderNumber: "278278", status: "completed" })];
      const { deps, created } = fake([r], { "tenant-a": orders });
      await runScheduledAutomations(deps, NOW);
      // spaeter: k1 abgeschlossen, k2 wieder offen
      orders[0].status = "completed";
      orders[1].status = "in_progress";
      await runScheduledAutomations(deps, NOW);
      expect(created.map((t) => t.orderId)).toEqual(["k1"]);
      const preview = await previewScheduledRule(deps, "tenant-a", notCompleted as any, r.id, NOW);
      expect(preview).toMatchObject({ matching: 1, alreadyDone: 1, nextRun: 0 });
    });

    it("erledigt zaehlt auch, wenn die erledigte Kopie ausserhalb des Pruefzeitraums liegt", async () => {
      const r = rule();
      const { deps, created, executions } = fake([r], {
        "tenant-a": [order("alt", { orderNumber: "286101", orderDate: daysAgo(70) }), order("neu", { orderNumber: "286101" })],
      });
      executions.push({ ruleId: r.id, status: "success", result: { entity: { type: "order", id: "alt" } } });
      await runScheduledAutomations(deps, NOW);
      expect(created).toHaveLength(0);
    });
  });

  it("verlangt mindestens eine Bedingung; Aktionen fuer Tickets sind nicht erlaubt", () => {
    const errors = validateAutomationRule({ triggerType: "scheduled", conditions: [], actions: [{ type: "assign_ticket", params: { userId: "u1" } }] });
    expect(errors.join(" | ")).toMatch(/mindestens eine Bedingung/);
    expect(errors.join(" | ")).toMatch(/braucht einen Ticket-Auslöser/);
  });

  it("Intervall: mindestens 5 Minuten, sonst Standard", () => {
    expect(resolveScheduleIntervalMinutes("15")).toBe(15);
    expect(resolveScheduleIntervalMinutes("2")).toBe(60);
    expect(resolveScheduleIntervalMinutes("abc")).toBe(60);
    expect(resolveScheduleIntervalMinutes(undefined)).toBe(60);
  });
});
