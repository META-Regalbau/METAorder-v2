/**
 * Automatisierungsregeln: Katalog (Bedingungen, Pruefung, Platzhalter) und Engine (Mandanten,
 * Reihenfolge, Aktionen, Historie, Schleifenschutz).
 * Ausführung: npm test
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { insertAutomationRuleSchema, type AutomationRule, type Order, type Ticket } from "../../shared/schema";
import { evaluateCondition, evaluateConditions, interpolate, validateAutomationRule, type AutomationConditionInput } from "../../shared/automation";
import { runAutomationEvent } from "../../server/automation/engine";
import type { AutomationDeps } from "../../server/automation/actions";
import { registerAutomationTriggers } from "../../server/automation";
import { emitDomainEvent } from "../../server/lib/domainEvents";
import { getTenantIdFromContext } from "../../server/lib/tenantContext";

// ---------------------------------------------------------------------------
// Testdaten
// ---------------------------------------------------------------------------

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1", tenantId: "tenant-a", ticketNumber: "T-1001", title: "Lieferung fehlt", description: "Paket nicht angekommen",
    status: "open", priority: "normal", category: "general", orderId: null, orderNumber: "SW-500", assignedToUserId: null,
    createdByUserId: null, customerId: null, customerEmail: "kunde@example.com", customerName: "Erika Muster", dueDate: null,
    tags: null, emailSubject: null, emailFrom: null, returnReason: null, returnItems: null,
    createdAt: new Date(), updatedAt: new Date(), resolvedAt: null, closedAt: null,
    ...overrides,
  } as Ticket;
}

let ruleSeq = 0;
function rule(overrides: Partial<AutomationRule> & { conditionsArr?: unknown[]; actionsArr?: unknown[] } = {}): AutomationRule {
  const { conditionsArr = [], actionsArr = [], ...rest } = overrides;
  ruleSeq += 1;
  return {
    id: `r${ruleSeq}`, tenantId: "tenant-a", name: `Regel ${ruleSeq}`, description: null, enabled: 1, triggerType: "ticket_created",
    conditions: JSON.stringify(conditionsArr), actions: JSON.stringify(actionsArr), priority: 0, schedule: null,
    lastExecutedAt: null, executionCount: 0, createdByUserId: null, createdAt: new Date(2026, 0, ruleSeq), updatedAt: new Date(),
    ...rest,
  } as AutomationRule;
}

/** Test-Speicher: Mandantentrennung wie DbStorage (Mandant aus dem Kontext). */
function fakeDeps(rules: AutomationRule[], opts: { onCreateTicket?: (t: Ticket) => void; tickets?: Ticket[] } = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const executions: any[] = [];
  const users: Record<string, { id: string; username: string; tenants: string[] }> = {
    u1: { id: "u1", username: "anna", tenants: ["tenant-a"] },
    u2: { id: "u2", username: "bernd", tenants: ["tenant-b"] },
  };
  const storage = {
    getActiveAutomationRules: async () => rules.filter((r) => r.enabled === 1 && (r.tenantId ?? null) === getTenantIdFromContext()),
    updateTicket: async (id: string, updates: unknown) => { calls.push(["updateTicket", id, updates]); return ticket({ id }); },
    createTicket: async (data: Partial<Ticket>) => {
      const t = ticket({ ...data, id: `new-${calls.length}`, ticketNumber: "T-2000", tenantId: getTenantIdFromContext() });
      calls.push(["createTicket", data]);
      opts.onCreateTicket?.(t);
      return t;
    },
    getTicketsByOrderId: async (orderId: string) => (opts.tickets ?? []).filter((t) => t.orderId === orderId && (t.tenantId ?? null) === getTenantIdFromContext()),
    createNotification: async (n: any) => { calls.push(["createNotification", n]); return { id: "n1", ...n }; },
    getUser: async (id: string) => users[id] ? { id, username: users[id].username } : undefined,
    getTenantsForUser: async (id: string) => (users[id]?.tenants ?? []).map((t) => ({ id: t })),
    createAutomationExecution: async (e: any) => { executions.push(e); return e; },
    incrementRuleExecutionCount: async (id: string) => { calls.push(["increment", id]); },
  };
  const deps: AutomationDeps = {
    storage: storage as any,
    classifyTicket: vi.fn(async () => ({ category: "complaint", priority: "high", sentiment: "negative", confidence: 0.9, source: "heuristic" }) as any),
    sendEmail: vi.fn(async () => undefined),
    onNotificationCreated: vi.fn(),
  };
  return { deps, calls, executions };
}

// ---------------------------------------------------------------------------
// Katalog
// ---------------------------------------------------------------------------

describe("Bedingungen", () => {
  const facts = { "ticket.priority": "high", "ticket.title": "Lieferung FEHLT komplett", "ticket.isAssigned": false, "ticket.status": "open" };

  it("Auswahlfelder: gleich / ungleich", () => {
    expect(evaluateCondition({ field: "ticket.priority", operator: "equals", value: "high" }, facts)).toBe(true);
    expect(evaluateCondition({ field: "ticket.priority", operator: "notEquals", value: "high" }, facts)).toBe(false);
  });

  it("Text: enthaelt ohne Gross-/Kleinschreibung, leerer Suchtext trifft nie", () => {
    expect(evaluateCondition({ field: "ticket.title", operator: "contains", value: "fehlt" }, facts)).toBe(true);
    expect(evaluateCondition({ field: "ticket.title", operator: "contains", value: "" }, facts)).toBe(false);
  });

  it("ja/nein-Felder akzeptieren true/false und \"true\"/\"false\"", () => {
    expect(evaluateCondition({ field: "ticket.isAssigned", operator: "equals", value: false }, facts)).toBe(true);
    expect(evaluateCondition({ field: "ticket.isAssigned", operator: "equals", value: "true" }, facts)).toBe(false);
  });

  it("Listen: 'ist einer von' (Auswahl), 'enthaelt eines von' (Text); leere Eintraege zaehlen nicht", () => {
    expect(evaluateCondition({ field: "ticket.priority", operator: "isOneOf", value: ["urgent", "HIGH"] }, facts)).toBe(true);
    expect(evaluateCondition({ field: "ticket.priority", operator: "isOneOf", value: ["low", "normal"] }, facts)).toBe(false);
    expect(evaluateCondition({ field: "ticket.title", operator: "containsAny", value: ["storno", " komplett "] }, facts)).toBe(true);
    expect(evaluateCondition({ field: "ticket.title", operator: "containsAny", value: ["", " "] }, facts)).toBe(false);
  });

  it("Liste nur mit Listen-Operator und umgekehrt", () => {
    expect(evaluateCondition({ field: "ticket.priority", operator: "equals", value: ["high"] }, facts)).toBe(false);
    expect(evaluateCondition({ field: "ticket.priority", operator: "isOneOf", value: "high" }, facts)).toBe(false);
  });

  it("unbekannte Felder und unpassende Operatoren treffen nie zu", () => {
    expect(evaluateCondition({ field: "orderAge", operator: "greaterThan", value: 3 }, facts)).toBe(false);
    expect(evaluateCondition({ field: "ticket.priority", operator: "contains", value: "hi" }, facts)).toBe(false);
  });

  it("alle Bedingungen muessen zutreffen; keine Bedingung trifft immer", () => {
    expect(evaluateConditions([], facts)).toBe(true);
    expect(evaluateConditions([
      { field: "ticket.priority", operator: "equals", value: "high" },
      { field: "ticket.status", operator: "equals", value: "closed" },
    ], facts)).toBe(false);
  });
});

describe("Regel-Pruefung", () => {
  const assign = { type: "assign_ticket", params: { userId: "u1" } };

  it("akzeptiert eine vollstaendige Regel", () => {
    expect(validateAutomationRule({ triggerType: "ticket_created", conditions: [{ field: "ticket.category", operator: "equals", value: "complaint" }], actions: [assign] })).toEqual([]);
  });

  it("meldet unbekannte Ausloeser, nicht verfuegbare Aktionen, unbekannte Felder, falsche Werte und fehlende Parameter", () => {
    expect(validateAutomationRule({ triggerType: "order_shipped", conditions: [], actions: [assign] })).toEqual(["Unbekannter Auslöser: order_shipped"]);
    const errors = validateAutomationRule({
      triggerType: "ticket_created",
      conditions: [{ field: "orderAge", operator: "greaterThan", value: 3 }],
      actions: [{ type: "update_order_status", params: {} }, { type: "assign_ticket", params: {} }],
    });
    expect(errors.join(" | ")).toMatch(/unbekanntes Feld "orderAge"/);
    expect(errors.join(" | ")).toMatch(/"update_order_status" ist noch nicht verfügbar/);
    expect(errors.join(" | ")).toMatch(/Benutzer fehlt/);
  });

  it("previousStatus nur beim Ausloeser 'Status geaendert'; E-Mail-Empfaenger muss Adresse oder Platzhalter sein", () => {
    const errors = validateAutomationRule({
      triggerType: "ticket_created",
      conditions: [{ field: "ticket.previousStatus", operator: "equals", value: "open" }],
      actions: [{ type: "send_email", params: { to: "keine-adresse", subject: "x", body: "y" } }],
    });
    expect(errors.join(" | ")).toMatch(/passt nicht zum Auslöser/);
    expect(errors.join(" | ")).toMatch(/keine E-Mail-Adresse/);
    expect(validateAutomationRule({ triggerType: "ticket_created", actions: [{ type: "send_email", params: { to: "{{ticket.customerEmail}}", subject: "x", body: "y" } }] })).toEqual([]);
  });

  it("Listen-Operatoren: mindestens ein Wert, nur erlaubte Werte, nicht bei ja/nein; Liste nur mit Listen-Operator", () => {
    const check = (condition: AutomationConditionInput) =>
      validateAutomationRule({ triggerType: "ticket_created", conditions: [condition], actions: [assign] }).join(" | ");
    expect(check({ field: "ticket.priority", operator: "isOneOf", value: ["high", "urgent"] })).toBe("");
    expect(check({ field: "ticket.title", operator: "containsAny", value: ["storno", "rückgabe"] })).toBe("");
    expect(check({ field: "ticket.priority", operator: "isOneOf", value: [" ", ""] })).toMatch(/mindestens ein Wert/);
    expect(check({ field: "ticket.priority", operator: "isOneOf", value: "high" })).toMatch(/mindestens ein Wert/);
    expect(check({ field: "ticket.priority", operator: "isOneOf", value: ["high", "sofort"] })).toMatch(/Wert "sofort" ist nicht erlaubt/);
    expect(check({ field: "ticket.isAssigned", operator: "isOneOf", value: ["true"] })).toMatch(/Operator "isOneOf" passt nicht zum Feld/);
    expect(check({ field: "ticket.priority", operator: "equals", value: ["high"] })).toMatch(/mehrere Werte nur/);
  });

  it("Eingabe-Schema der Route nimmt Listen-Werte an", () => {
    const parsed = insertAutomationRuleSchema.parse({
      name: "x", enabled: true, triggerType: "scheduled", actions: [],
      conditions: [{ field: "order.paymentStatus", operator: "isOneOf", value: ["open", "failed"] }, { field: "order.paymentMethod", operator: "containsAny", value: ["Vorkasse"] }],
    });
    expect(parsed.conditions?.[0].value).toEqual(["open", "failed"]);
  });

  it("Platzhalter werden ersetzt, unbekannte leer", () => {
    expect(interpolate("Ticket {{ticket.ticketNumber}} von {{ ticket.customerName }}{{x.y}}", { "ticket.ticketNumber": "T-1", "ticket.customerName": "Erika" })).toBe("Ticket T-1 von Erika");
  });

  it("Platzhalter lesbar: Datum TT.MM.JJJJ, Betrag mit zwei Nachkommastellen, Status/Prioritaet/Kategorie als Text", () => {
    const facts = {
      "order.orderDate": "2026-09-01", "order.deliveryDateLatest": "2026-10-05", "order.totalAmount": 2547.79,
      "order.status": "in_progress", "order.previousPaymentStatus": "failed", "order.daysSinceOrder": 35,
      "ticket.priority": "urgent", "ticket.category": "order_issue", "ticket.status": "waiting_for_customer",
    };
    expect(interpolate("vom {{order.orderDate}}, Lieferdatum {{order.deliveryDateLatest}}, {{order.totalAmount}} €, seit {{order.daysSinceOrder}} Tagen", facts))
      .toBe("vom 01.09.2026, Lieferdatum 05.10.2026, 2.547,79 €, seit 35 Tagen");
    expect(interpolate("{{order.status}} / {{order.previousPaymentStatus}} / {{ticket.priority}} / {{ticket.category}} / {{ticket.status}}", facts))
      .toBe("In Bearbeitung / Fehlgeschlagen / Dringend / Bestellproblem / Wartet auf Kunden");
    // Unbekannte Werte bleiben, wie sie sind
    expect(interpolate("{{order.status}} {{order.totalAmount}}", { "order.status": "neu", "order.totalAmount": 5 })).toBe("neu 5,00");
  });
});

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

describe("Engine", () => {
  it("fuehrt passende Regel aus, protokolliert Erfolg und zaehlt hoch", async () => {
    const r = rule({ actionsArr: [{ type: "assign_ticket", params: { userId: "u1" } }] });
    const { deps, calls, executions } = fakeDeps([r]);
    const out = await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket() });
    expect(out).toHaveLength(1);
    expect(calls).toContainEqual(["updateTicket", "t1", { assignedToUserId: "u1" }]);
    expect(calls).toContainEqual(["increment", r.id]);
    expect(executions[0]).toMatchObject({ ruleId: r.id, status: "success", error: null });
    expect(executions[0].result.actions[0]).toMatchObject({ type: "assign_ticket", ok: true });
  });

  it("Bedingung nicht erfuellt: keine Aktion, kein Eintrag in der Historie", async () => {
    const r = rule({ conditionsArr: [{ field: "ticket.priority", operator: "equals", value: "urgent" }], actionsArr: [{ type: "update_ticket_priority", params: { priority: "high" } }] });
    const { deps, calls, executions } = fakeDeps([r]);
    await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket() });
    expect(calls).toEqual([]);
    expect(executions).toEqual([]);
  });

  it("Mandantentrennung: Regel eines anderen Mandanten laeuft nicht", async () => {
    const r = rule({ tenantId: "tenant-b", actionsArr: [{ type: "update_ticket_priority", params: { priority: "high" } }] });
    const { deps, calls } = fakeDeps([r]);
    await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket() });
    expect(calls).toEqual([]);
  });

  it("nur Regeln des passenden Ausloesers, hoehere Prioritaet zuerst", async () => {
    const low = rule({ priority: 1, actionsArr: [{ type: "update_ticket_priority", params: { priority: "low" } }] });
    const high = rule({ priority: 5, actionsArr: [{ type: "update_ticket_priority", params: { priority: "urgent" } }] });
    const other = rule({ triggerType: "ticket_status_changed", actionsArr: [{ type: "update_ticket_priority", params: { priority: "high" } }] });
    const { deps, calls } = fakeDeps([low, other, high]);
    await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket() });
    expect(calls.filter((c) => c[0] === "updateTicket").map((c) => (c[2] as any).priority)).toEqual(["urgent", "low"]);
  });

  it("ueberspringt veraltete/unvollstaendige Regeln, andere laufen weiter", async () => {
    const legacy = rule({ conditions: JSON.stringify({ orderStatus: "open" }), actionsArr: [{ type: "update_ticket_priority", params: { priority: "urgent" } }] });
    const unknownField = rule({ conditionsArr: [{ field: "sentiment", operator: "equals", value: "negative" }], actionsArr: [{ type: "update_ticket_priority", params: { priority: "urgent" } }] });
    const ok = rule({ actionsArr: [{ type: "update_ticket_priority", params: { priority: "high" } }] });
    const { deps, calls, executions } = fakeDeps([legacy, unknownField, ok]);
    await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket() });
    expect(calls.filter((c) => c[0] === "updateTicket")).toEqual([["updateTicket", "t1", { priority: "high" }]]);
    expect(executions.map((e) => e.ruleId)).toEqual([ok.id]);
  });

  it("fehlgeschlagene Aktion stoppt die folgenden nicht; Status failure mit Fehlertext", async () => {
    const r = rule({ actionsArr: [
      { type: "assign_ticket", params: { userId: "u2" } }, // gehoert zu tenant-b
      { type: "update_ticket_priority", params: { priority: "high" } },
    ] });
    const { deps, calls, executions } = fakeDeps([r]);
    await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket() });
    expect(calls).toContainEqual(["updateTicket", "t1", { priority: "high" }]);
    expect(executions[0].status).toBe("failure");
    expect(executions[0].error).toMatch(/gehört nicht zu diesem Mandanten/);
  });

  it("Stimmung per KI nur, wenn eine Regel sie braucht - dann genau einmal", async () => {
    const a = rule({ conditionsArr: [{ field: "ticket.sentiment", operator: "equals", value: "negative" }], actionsArr: [{ type: "update_ticket_priority", params: { priority: "urgent" } }] });
    const b = rule({ conditionsArr: [{ field: "ticket.sentiment", operator: "equals", value: "negative" }], actionsArr: [{ type: "assign_ticket", params: { userId: "u1" } }] });
    const withAi = fakeDeps([a, b]);
    await runAutomationEvent(withAi.deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket() });
    expect(withAi.deps.classifyTicket).toHaveBeenCalledTimes(1);
    expect(withAi.calls.filter((c) => c[0] === "updateTicket")).toHaveLength(2);

    const noAi = fakeDeps([rule({ actionsArr: [{ type: "update_ticket_priority", params: { priority: "high" } }] })]);
    await runAutomationEvent(noAi.deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket() });
    expect(noAi.deps.classifyTicket).not.toHaveBeenCalled();
  });

  it("Benachrichtigung und E-Mail mit Platzhaltern; ungueltiger Empfaenger schlaegt fehl", async () => {
    const r = rule({ actionsArr: [
      { type: "send_notification", params: { userId: "u1", title: "Neu: {{ticket.ticketNumber}}", message: "{{ticket.title}}" } },
      { type: "send_email", params: { to: "{{ticket.customerEmail}}", subject: "Ihr Ticket {{ticket.ticketNumber}}", body: "Hallo {{ticket.customerName}}" } },
      { type: "send_email", params: { to: "{{ticket.orderNumber}}", subject: "x", body: "y" } },
    ] });
    const { deps, calls, executions } = fakeDeps([r]);
    await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket() });
    expect(calls.find((c) => c[0] === "createNotification")?.[1]).toMatchObject({ userId: "u1", title: "Neu: T-1001", message: "Lieferung fehlt", ticketId: "t1" });
    expect(deps.onNotificationCreated).toHaveBeenCalledOnce();
    expect(deps.sendEmail).toHaveBeenCalledWith({ to: "kunde@example.com", subject: "Ihr Ticket T-1001", text: "Hallo Erika Muster" });
    expect(deps.sendEmail).toHaveBeenCalledOnce();
    expect(executions[0].result.actions[2]).toMatchObject({ ok: false });
  });

  it("KI-Analyse: Kategorie nur bei 'general', negative Stimmung hebt normal auf hoch", async () => {
    const r = rule({ actionsArr: [{ type: "run_ai_analysis", params: { applyCategory: true, escalateNegative: true } }] });
    const first = fakeDeps([r]);
    await runAutomationEvent(first.deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket() });
    expect(first.calls).toContainEqual(["updateTicket", "t1", { category: "complaint", priority: "high" }]);

    const second = fakeDeps([r]);
    await runAutomationEvent(second.deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket({ category: "order_issue", priority: "urgent" }) });
    expect(second.calls.filter((c) => c[0] === "updateTicket")).toEqual([]);
  });

  it("Status geaendert: Bedingung auf vorherigen Status", async () => {
    const r = rule({ triggerType: "ticket_status_changed", conditionsArr: [
      { field: "ticket.previousStatus", operator: "equals", value: "waiting_for_customer" },
      { field: "ticket.status", operator: "equals", value: "open" },
    ], actionsArr: [{ type: "update_ticket_priority", params: { priority: "high" } }] });
    const { deps, calls } = fakeDeps([r]);
    await runAutomationEvent(deps, { trigger: "ticket_status_changed", tenantId: "tenant-a", ticket: ticket(), previousStatus: "waiting_for_customer" });
    await runAutomationEvent(deps, { trigger: "ticket_status_changed", tenantId: "tenant-a", ticket: ticket(), previousStatus: "in_progress" });
    expect(calls.filter((c) => c[0] === "updateTicket")).toHaveLength(1);
  });
});

describe("Aktion 'Ticket anlegen'", () => {
  const order = {
    id: "o1", orderNumber: "SW-1", customerName: "Erika Muster", customerEmail: "kunde@example.com", orderDate: new Date().toISOString(),
    totalAmount: 10, netTotalAmount: 8, status: "cancelled", paymentStatus: "open", salesChannelId: "sc", items: [],
  } as Order;
  const createRule = (params: Record<string, unknown>) => rule({
    triggerType: "order_status_changed",
    actionsArr: [{ type: "create_ticket", params: { title: "Storno {{order.orderNumber}}", description: "Bitte prüfen", ...params } }],
  });
  const run = (deps: AutomationDeps) => runAutomationEvent(deps, { trigger: "order_status_changed", tenantId: "tenant-a", order, previousStatus: "in_progress" });
  const createdTickets = (calls: Array<[string, ...unknown[]]>) => calls.filter((c) => c[0] === "createTicket").map((c) => c[1]);

  it("weist das Ticket gleich zu und benachrichtigt den Zustaendigen", async () => {
    const { deps, calls, executions } = fakeDeps([createRule({ assignToUserId: "u1" })]);
    await run(deps);
    expect(createdTickets(calls)).toEqual([expect.objectContaining({ orderId: "o1", orderNumber: "SW-1", assignedToUserId: "u1", title: "Storno SW-1" })]);
    expect(calls.find((c) => c[0] === "createNotification")?.[1]).toMatchObject({ userId: "u1", type: "ticket_assigned", ticketNumber: "T-2000", message: "Storno SW-1" });
    expect(deps.onNotificationCreated).toHaveBeenCalledOnce();
    expect(executions[0]).toMatchObject({ status: "success" });
    expect(executions[0].result.actions[0].message).toMatch(/anna zugewiesen/);
  });

  it("ohne Zustaendigen: Ticket ohne Zuweisung, keine Benachrichtigung", async () => {
    const { deps, calls } = fakeDeps([createRule({ assignToUserId: "" })]);
    await run(deps);
    expect(createdTickets(calls)).toEqual([expect.objectContaining({ assignedToUserId: null })]);
    expect(deps.onNotificationCreated).not.toHaveBeenCalled();
  });

  it("Zustaendiger aus anderem Mandanten: kein Ticket, Ausfuehrung fehlgeschlagen", async () => {
    const { deps, calls, executions } = fakeDeps([createRule({ assignToUserId: "u2" })]);
    await run(deps);
    expect(createdTickets(calls)).toEqual([]);
    expect(executions[0].status).toBe("failure");
    expect(executions[0].error).toMatch(/gehört nicht zu diesem Mandanten/);
  });

  it("kein weiteres Ticket, solange zur Bestellung eins offen ist - geloeste, geschlossene und fremde zaehlen nicht", async () => {
    const open = fakeDeps([createRule({ skipIfOpenTicket: true, assignToUserId: "u1" })], { tickets: [ticket({ id: "x", orderId: "o1", status: "waiting_for_customer", ticketNumber: "T-900" })] });
    await run(open.deps);
    expect(createdTickets(open.calls)).toEqual([]);
    expect(open.deps.onNotificationCreated).not.toHaveBeenCalled();
    expect(open.executions[0]).toMatchObject({ status: "success" });
    expect(open.executions[0].result.actions[0].message).toMatch(/T-900 zur Bestellung ist noch offen/);

    const done = fakeDeps([createRule({ skipIfOpenTicket: true })], { tickets: [
      ticket({ orderId: "o1", status: "resolved" }),
      ticket({ orderId: "o1", status: "closed" }),
      ticket({ orderId: "o2", status: "open" }),
      ticket({ orderId: "o1", status: "open", tenantId: "tenant-b" }),
    ] });
    await run(done.deps);
    expect(createdTickets(done.calls)).toHaveLength(1);

    const off = fakeDeps([createRule({ skipIfOpenTicket: false })], { tickets: [ticket({ orderId: "o1", status: "open" })] });
    await run(off.deps);
    expect(createdTickets(off.calls)).toHaveLength(1);
  });
});

describe("Anbindung an Ereignisse und Schleifenschutz", () => {
  let off: (() => void) | null = null;
  afterEach(() => { off?.(); off = null; });
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it("Ticket angelegt loest Regeln aus; von einer Regel angelegte Tickets loesen keine weiteren aus", async () => {
    // Regel legt bei jedem neuen Ticket ein weiteres an - ohne Schutz waere das eine Endlosschleife
    const r = rule({ actionsArr: [{ type: "create_ticket", params: { title: "Folge zu {{ticket.ticketNumber}}", description: "x" } }] });
    let fake: ReturnType<typeof fakeDeps>;
    fake = fakeDeps([r], { onCreateTicket: (t) => emitDomainEvent("ticket.created", { ticket: t }) });
    off = registerAutomationTriggers(fake.deps.storage);

    emitDomainEvent("ticket.created", { ticket: ticket() });
    await settle();
    expect(fake.calls.filter((c) => c[0] === "createTicket")).toHaveLength(1);
    expect((fake.calls.find((c) => c[0] === "createTicket")![1] as any).title).toBe("Folge zu T-1001");
  });
});
