/**
 * Automatisierungsregeln: Speichern (echter DbStorage, Datenbank gemockt) und Lesen durch die Engine.
 * Hintergrund: Route und Speicher haben beide JSON.stringify angewendet - gespeichert war ein doppelt
 * kodierter JSON-Text, die Engine hat jede so angelegte Regel uebersprungen. Die bisherigen Tests
 * nutzten einen Test-Speicher mit fertigem JSON und haben das nicht gesehen.
 * Ausführung: npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const written: { inserts: any[]; updates: any[] } = vi.hoisted(() => ({ inserts: [], updates: [] }));
vi.mock("../../server/db", () => {
  const chain = (rows: () => any[]) => {
    const c: any = {};
    for (const m of ["where", "orderBy", "limit"]) c[m] = () => c;
    c.returning = async () => rows();
    c.then = (res: (v: any[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows()).then(res, rej);
    return c;
  };
  return {
    db: {
      insert: () => ({ values: (v: any) => { written.inserts.push(v); return chain(() => [{ id: "rule-1", ...v }]); } }),
      update: () => ({ set: (v: any) => { written.updates.push(v); return chain(() => [{ id: "rule-1", ...v }]); } }),
    },
    pool: {},
  };
});

import { automationRuleJson, DbStorage } from "../../server/dbStorage";
import { parseStoredRuleList } from "../../shared/automation";
import { prepareRules, runAutomationEvent } from "../../server/automation/engine";
import type { AutomationDeps } from "../../server/automation/actions";
import type { AutomationRule, Ticket } from "../../shared/schema";
import { getTenantIdFromContext } from "../../server/lib/tenantContext";

const conditions = [{ field: "ticket.category", operator: "equals", value: "complaint" }];
const actions = [{ type: "update_ticket_priority", params: { priority: "urgent" } }];

beforeEach(() => {
  written.inserts.length = 0;
  written.updates.length = 0;
});

describe("parseStoredRuleList", () => {
  it("liest Array, JSON-Text und doppelt kodierten Altbestand", () => {
    expect(parseStoredRuleList(conditions)).toEqual(conditions);
    expect(parseStoredRuleList(JSON.stringify(conditions))).toEqual(conditions);
    expect(parseStoredRuleList(JSON.stringify(JSON.stringify(conditions)))).toEqual(conditions);
  });

  it("leer -> [], ungueltig oder kein Array -> null", () => {
    expect(parseStoredRuleList(null)).toEqual([]);
    expect(parseStoredRuleList("")).toEqual([]);
    expect(parseStoredRuleList("[")).toBeNull();
    expect(parseStoredRuleList('{"a":1}')).toBeNull();
    expect(parseStoredRuleList(JSON.stringify("kein Array"))).toBeNull();
  });
});

describe("DbStorage: Regeln werden einfach kodiert gespeichert", () => {
  it("createAutomationRule mit JSON-Text wie von der Route -> Spalte enthaelt genau diesen Text", async () => {
    await new DbStorage().createAutomationRule(
      { name: "R", triggerType: "ticket_created", enabled: 1, priority: 0, conditions: JSON.stringify(conditions), actions: JSON.stringify(actions) },
      "tenant-a",
    );
    const row = written.inserts[0];
    expect(row.conditions).toBe(JSON.stringify(conditions));
    expect(row.actions).toBe(JSON.stringify(actions));
    expect(JSON.parse(row.actions)).toEqual(actions);
  });

  it("updateAutomationRule ebenso; leere Bedingungen bleiben null", async () => {
    await new DbStorage().updateAutomationRule("rule-1", { conditions: JSON.stringify(conditions), actions: JSON.stringify(actions) }, "tenant-a");
    expect(written.updates[0]).toMatchObject({ conditions: JSON.stringify(conditions), actions: JSON.stringify(actions) });
    await new DbStorage().updateAutomationRule("rule-1", { conditions: null }, "tenant-a");
    expect(written.updates[1].conditions).toBeNull();
  });

  it("automationRuleJson: Arrays werden kodiert, fertiger Text nicht noch einmal", () => {
    expect(automationRuleJson(actions)).toBe(JSON.stringify(actions));
    expect(automationRuleJson(JSON.stringify(actions))).toBe(JSON.stringify(actions));
    expect(automationRuleJson(undefined)).toBeNull();
  });
});

describe("gespeicherte Regel wird von der Engine ausgefuehrt", () => {
  function storedRule(row: Record<string, unknown>): AutomationRule {
    return { id: "rule-1", tenantId: "tenant-a", name: "R", description: null, enabled: 1, triggerType: "ticket_created", priority: 0, schedule: null, lastExecutedAt: null, executionCount: 0, createdByUserId: null, createdAt: new Date(), updatedAt: new Date(), ...row } as AutomationRule;
  }
  function deps(rules: AutomationRule[]) {
    const updates: any[] = [];
    const storage = {
      getActiveAutomationRules: async () => rules.filter((r) => r.tenantId === getTenantIdFromContext()),
      updateTicket: async (id: string, u: any) => { updates.push(u); return { id, ...u }; },
      createAutomationExecution: async (e: any) => e,
      incrementRuleExecutionCount: async () => {},
    };
    return { deps: { storage: storage as any, classifyTicket: vi.fn(), sendEmail: vi.fn(), onNotificationCreated: vi.fn() } as AutomationDeps, updates };
  }
  const ticket = { id: "t1", tenantId: "tenant-a", ticketNumber: "T-1", title: "x", description: "y", status: "open", priority: "normal", category: "complaint" } as Ticket;

  it("Regel ueber DbStorage gespeichert -> Engine fuehrt sie aus", async () => {
    await new DbStorage().createAutomationRule(
      { name: "R", triggerType: "ticket_created", enabled: 1, priority: 0, conditions: JSON.stringify(conditions), actions: JSON.stringify(actions) },
      "tenant-a",
    );
    const { deps: d, updates } = deps([storedRule(written.inserts[0])]);
    const outcomes = await runAutomationEvent(d, { trigger: "ticket_created", tenantId: "tenant-a", ticket });
    expect(outcomes).toHaveLength(1);
    expect(updates).toEqual([{ priority: "urgent" }]);
  });

  it("Altbestand (doppelt kodiert) wird ebenfalls gelesen statt uebersprungen", async () => {
    const legacy = storedRule({ conditions: JSON.stringify(JSON.stringify(conditions)), actions: JSON.stringify(JSON.stringify(actions)) });
    const { deps: d } = deps([legacy]);
    const { runWithTenantContext } = await import("../../server/lib/tenantContext");
    const prepared = await runWithTenantContext("tenant-a", () => prepareRules(d, "ticket_created"));
    expect(prepared).toHaveLength(1);
    expect(prepared[0].conditions).toEqual(conditions);
  });
});
