/**
 * Zeitgesteuerte Ticket-Regeln (Wiedervorlage): offene Tickets pruefen, je Ticket einmal bis zur
 * naechsten Aenderung, eigene Aenderungen der Regel zaehlen nicht.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";
import type { AutomationRule, Ticket } from "../../shared/schema";
import { SCHEDULED_MAX_PER_RULE_PER_RUN, validateAutomationRule } from "../../shared/automation";
import { runAutomationEvent, ticketFacts } from "../../server/automation/engine";
import { previewScheduledTicketRule, runScheduledAutomations } from "../../server/automation/scheduler";
import type { AutomationDeps } from "../../server/automation/actions";
import { getTenantIdFromContext } from "../../server/lib/tenantContext";

const NOW = new Date("2026-10-06T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

function ticket(id: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id, tenantId: "tenant-a", ticketNumber: `T-${id}`, title: `Ticket ${id}`, description: "x",
    status: "open", priority: "normal", category: "order_issue", orderId: null, orderNumber: null, assignedToUserId: "u1",
    createdByUserId: null, customerId: null, customerEmail: "kunde@example.com", customerName: "Erika Muster", dueDate: null,
    tags: null, emailSubject: null, emailFrom: null, returnReason: null, returnItems: null,
    createdAt: daysAgo(10), updatedAt: daysAgo(5), resolvedAt: null, closedAt: null,
    ...overrides,
  } as Ticket;
}

let seq = 0;
function rule(overrides: Partial<AutomationRule> & { conditionsArr?: unknown[]; actionsArr?: unknown[] } = {}): AutomationRule {
  const { conditionsArr, actionsArr, ...rest } = overrides;
  seq += 1;
  return {
    id: `w${seq}`, tenantId: "tenant-a", name: `Wiedervorlage ${seq}`, description: null, enabled: 1, triggerType: "scheduled_tickets",
    conditions: JSON.stringify(conditionsArr ?? [{ field: "ticket.daysSinceUpdated", operator: "greaterThanOrEqual", value: 3 }]),
    actions: JSON.stringify(actionsArr ?? [{ type: "send_notification", params: { userId: "u2", title: "Wiedervorlage {{ticket.ticketNumber}}", message: "{{ticket.title}}: {{ticket.assigneeName}}, {{ticket.daysSinceUpdated}} Tage" } }]),
    priority: 0, schedule: null, lastExecutedAt: null, executionCount: 0, createdByUserId: null,
    createdAt: new Date(2026, 0, seq), updatedAt: new Date(),
    ...rest,
  } as AutomationRule;
}

/** Test-Speicher wie DbStorage: Mandant aus dem Kontext; Statistik (inkl. behandeltem Stand) aus den Ausfuehrungen. */
function fake(rules: AutomationRule[], tickets: Ticket[], opts: { notificationFails?: boolean } = {}) {
  const executions: any[] = [];
  const notifications: any[] = [];
  const clock = { now: NOW };
  const inTenant = (t: Ticket) => (t.tenantId ?? null) === getTenantIdFromContext();
  const users: Record<string, string> = { u1: "inoecker", u2: "vertretung" };
  const storage = {
    getAllTenants: async () => [{ id: "tenant-a" }, { id: "tenant-b" }],
    getActiveAutomationRules: async () => rules.filter((r) => r.enabled === 1 && (r.tenantId ?? null) === getTenantIdFromContext()),
    getShopwareOrderMirrors: async () => ({ rows: [], total: 0 }),
    getAllTickets: async () => tickets.filter(inTenant).map((t) => ({ ...t })),
    getTicket: async (id: string) => { const t = tickets.find((x) => x.id === id && inTenant(x)); return t ? { ...t } : undefined; },
    updateTicket: async (id: string, updates: Partial<Ticket>) => {
      const t = tickets.find((x) => x.id === id)!;
      Object.assign(t, updates, { updatedAt: new Date(clock.now) });
      return { ...t };
    },
    getUser: async (id: string) => (users[id] ? { id, username: users[id] } : undefined),
    getTenantsForUser: async () => [{ id: "tenant-a" }],
    getAutomationEntityRunStats: async (ruleId: string, type: string) => {
      const stats = new Map<string, { succeeded: boolean; failures: number; lastHandledAt: string | null }>();
      for (const e of executions.filter((x) => x.ruleId === ruleId && x.result.entity?.type === type)) {
        const s = stats.get(e.result.entity.id) ?? { succeeded: false, failures: 0, lastHandledAt: null };
        if (e.status === "success") {
          s.succeeded = true;
          const at = e.result.entity.stateAt ?? null;
          if (at && (!s.lastHandledAt || at > s.lastHandledAt)) s.lastHandledAt = at;
        } else s.failures += 1;
        stats.set(e.result.entity.id, s);
      }
      return stats;
    },
    createAutomationExecution: async (e: any) => { executions.push({ ...e, tenantId: getTenantIdFromContext() }); return e; },
    incrementRuleExecutionCount: async () => {},
    createNotification: async (n: any) => {
      if (opts.notificationFails) throw new Error("Benachrichtigung fehlgeschlagen");
      notifications.push(n);
      return { id: `n${notifications.length}`, ...n };
    },
  };
  const deps: AutomationDeps = {
    storage: storage as any,
    classifyTicket: vi.fn(),
    sendEmail: vi.fn(async () => undefined),
    onNotificationCreated: vi.fn(),
  };
  return { deps, executions, notifications, clock };
}

describe("Fakten eines Tickets", () => {
  it("Tage seit Erstellung, letzter Aenderung und ueber Faelligkeit; Zustaendiger als Name", () => {
    const f = ticketFacts(ticket("1", { dueDate: daysAgo(2) }), undefined, { assigneeName: "inoecker", now: NOW });
    expect(f["ticket.daysSinceCreated"]).toBe(10);
    expect(f["ticket.daysSinceUpdated"]).toBe(5);
    expect(f["ticket.daysPastDueDate"]).toBe(2);
    expect(f["ticket.assigneeName"]).toBe("inoecker");
    expect(ticketFacts(ticket("2"), undefined, { now: NOW })["ticket.daysPastDueDate"]).toBeNull();
  });

  it("Ereignis-Regeln kennen den Zustaendigen ebenfalls", async () => {
    const r = rule({ triggerType: "ticket_created", conditionsArr: [{ field: "ticket.assigneeName", operator: "equals", value: "inoecker" }] });
    const { deps, notifications } = fake([r], []);
    await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket("1") });
    await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: "tenant-a", ticket: ticket("2", { assignedToUserId: null }) });
    expect(notifications).toHaveLength(1);
  });
});

describe("Zeitgesteuerte Ticket-Regeln", () => {
  it("prueft nur offene Tickets des eigenen Mandanten; Platzhalter mit Zustaendigem und Tagen", async () => {
    const tickets = [
      ticket("1"),
      ticket("2", { status: "resolved" }),
      ticket("3", { status: "closed" }),
      ticket("4", { status: "waiting_for_customer" }),
      ticket("5", { updatedAt: daysAgo(1) }),
      ticket("6", { tenantId: "tenant-b" }),
    ];
    const { deps, notifications, executions } = fake([rule()], tickets);
    const summary = await runScheduledAutomations(deps, NOW);
    expect(notifications.map((n) => n.title)).toEqual(["Wiedervorlage T-1", "Wiedervorlage T-4"]);
    expect(notifications[0]).toMatchObject({ userId: "u2", message: "Ticket 1: inoecker, 5 Tage" });
    expect(executions[0].result.entity).toMatchObject({ type: "ticket", id: "1", number: "T-1", stateAt: daysAgo(5).toISOString() });
    expect(summary).toEqual([expect.objectContaining({ tenantId: "tenant-a", matching: 2, executed: 2, remaining: 0 })]);
  });

  it("je Ticket einmal - erst eine spaetere Aenderung macht es wieder faellig", async () => {
    const tickets = [ticket("1")];
    const { deps, notifications, clock } = fake([rule()], tickets);
    await runScheduledAutomations(deps, NOW);
    await runScheduledAutomations(deps, NOW);
    expect(notifications).toHaveLength(1);

    // Kommentar o. ae. vor 4 Tagen (nach dem behandelten Stand) - wieder faellig, sobald 3 Tage still
    clock.now = daysAgo(4);
    tickets[0].updatedAt = daysAgo(4);
    await runScheduledAutomations(deps, NOW);
    expect(notifications).toHaveLength(2);
    await runScheduledAutomations(deps, NOW);
    expect(notifications).toHaveLength(2);
  });

  it("Aenderungen der Regel selbst machen das Ticket nicht wieder faellig", async () => {
    const tickets = [ticket("1")];
    const r = rule({
      conditionsArr: [{ field: "ticket.daysSinceCreated", operator: "greaterThanOrEqual", value: 3 }],
      actionsArr: [{ type: "update_ticket_priority", params: { priority: "high" } }],
    });
    const { deps, executions } = fake([r], tickets);
    await runScheduledAutomations(deps, NOW);
    await runScheduledAutomations(deps, NOW);
    expect(executions).toHaveLength(1);
    expect(tickets[0].priority).toBe("high");
    expect(executions[0].result.entity.stateAt).toBe(NOW.toISOString());
  });

  it("wiederholt Fehlversuche, aber hoechstens dreimal", async () => {
    const { deps, executions } = fake([rule()], [ticket("1")], { notificationFails: true });
    for (let i = 0; i < 5; i++) await runScheduledAutomations(deps, NOW);
    expect(executions.map((e) => e.status)).toEqual(["failure", "failure", "failure"]);
  });

  it(`hoechstens ${SCHEDULED_MAX_PER_RULE_PER_RUN} Ausfuehrungen je Lauf, aelteste Tickets zuerst`, async () => {
    const tickets = Array.from({ length: SCHEDULED_MAX_PER_RULE_PER_RUN + 5 }, (_, i) => ticket(String(i), { createdAt: daysAgo(40 - i) }));
    const { deps, executions } = fake([rule()], tickets);
    const [first] = await runScheduledAutomations(deps, NOW);
    expect(first).toMatchObject({ executed: SCHEDULED_MAX_PER_RULE_PER_RUN, remaining: 5 });
    expect(executions[0].result.entity.id).toBe("0");
    await runScheduledAutomations(deps, NOW);
    expect(executions).toHaveLength(SCHEDULED_MAX_PER_RULE_PER_RUN + 5);
  });

  it("laeuft auch ohne zeitgesteuerte Bestellregeln, neben ihnen", async () => {
    const orderRule = rule({ triggerType: "scheduled", conditionsArr: [{ field: "order.daysSinceOrder", operator: "greaterThanOrEqual", value: 1 }], actionsArr: [{ type: "send_notification", params: { userId: "u2", title: "x", message: "y" } }] });
    const { deps, notifications } = fake([orderRule, rule()], [ticket("1")]);
    const summary = await runScheduledAutomations(deps, NOW);
    expect(summary.map((s) => s.ruleId)).toEqual([orderRule.id, expect.any(String)]);
    expect(notifications).toHaveLength(1);
  });

  it("Vorschau zaehlt, zieht Erledigtes ab und fuehrt nichts aus", async () => {
    const r = rule();
    const tickets = [ticket("1"), ticket("2", { assignedToUserId: null })];
    const { deps, notifications } = fake([r], tickets);
    const before = await previewScheduledTicketRule(deps, "tenant-a", JSON.parse(r.conditions!), r.id, NOW);
    expect(before).toMatchObject({ matching: 2, alreadyDone: 0, nextRun: 2 });
    expect(before.sample[0]).toEqual({ ticketNumber: "T-1", title: "Ticket 1", status: "open", assigneeName: "inoecker", daysSinceUpdated: 5 });
    expect(notifications).toHaveLength(0);
    await runScheduledAutomations(deps, NOW);
    expect(await previewScheduledTicketRule(deps, "tenant-a", JSON.parse(r.conditions!), r.id, NOW)).toMatchObject({ matching: 2, alreadyDone: 2, nextRun: 0 });
  });

  it("Pruefung: Bedingung Pflicht; keine KI-Stimmung, kein Vorher-Status, keine Bestellfelder; Ticket-Aktionen erlaubt", () => {
    const notify = { type: "send_notification", params: { userId: "u2", title: "x", message: "y" } };
    expect(validateAutomationRule({ triggerType: "scheduled_tickets", conditions: [], actions: [notify] }).join(" | ")).toMatch(/jedes Ticket/);
    const errors = validateAutomationRule({
      triggerType: "scheduled_tickets",
      conditions: [
        { field: "ticket.sentiment", operator: "equals", value: "negative" },
        { field: "ticket.previousStatus", operator: "equals", value: "open" },
        { field: "order.daysSinceOrder", operator: "greaterThan", value: 1 },
      ],
      actions: [notify],
    });
    expect(errors.filter((e) => /passt nicht zum Auslöser/.test(e))).toHaveLength(3);
    expect(validateAutomationRule({
      triggerType: "scheduled_tickets",
      conditions: [{ field: "ticket.daysSinceUpdated", operator: "greaterThanOrEqual", value: 3 }, { field: "ticket.status", operator: "isOneOf", value: ["open", "in_progress"] }],
      actions: [{ type: "assign_ticket", params: { userId: "u2" } }, { type: "update_ticket_priority", params: { priority: "high" } }, notify],
    })).toEqual([]);
    // Ticket-Zeitfelder nur zeitgesteuert
    expect(validateAutomationRule({ triggerType: "ticket_created", conditions: [{ field: "ticket.daysSinceUpdated", operator: "greaterThan", value: 1 }], actions: [notify] }).join()).toMatch(/passt nicht zum Auslöser/);
  });
});
