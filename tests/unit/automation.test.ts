/**
 * Automatisierungsregeln: Katalog (Bedingungen, Pruefung, Platzhalter) und Engine (Mandanten,
 * Reihenfolge, Aktionen, Historie, Schleifenschutz).
 * Ausführung: npm test
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationRule, Ticket } from "../../shared/schema";
import { evaluateCondition, evaluateConditions, interpolate, validateAutomationRule } from "../../shared/automation";
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
function fakeDeps(rules: AutomationRule[], opts: { onCreateTicket?: (t: Ticket) => void } = {}) {
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

  it("meldet nicht verfuegbare Ausloeser/Aktionen, unbekannte Felder, falsche Werte und fehlende Parameter", () => {
    const errors = validateAutomationRule({
      triggerType: "scheduled",
      conditions: [{ field: "orderAge", operator: "greaterThan", value: 3 }],
      actions: [{ type: "update_order_status", params: {} }, { type: "assign_ticket", params: {} }],
    });
    expect(errors.join(" | ")).toMatch(/Auslöser "scheduled" ist noch nicht verfügbar/);
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

  it("Platzhalter werden ersetzt, unbekannte leer", () => {
    expect(interpolate("Ticket {{ticket.ticketNumber}} von {{ ticket.customerName }}{{x.y}}", { "ticket.ticketNumber": "T-1", "ticket.customerName": "Erika" })).toBe("Ticket T-1 von Erika");
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
