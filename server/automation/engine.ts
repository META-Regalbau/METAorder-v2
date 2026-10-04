import type { AutomationRule, Ticket } from "@shared/schema";
import {
  AUTOMATION_FIELDS,
  evaluateConditions,
  validateAutomationRule,
  type AutomationActionInput,
  type AutomationConditionInput,
  type AutomationFacts,
  type AutomationTriggerTypeId,
} from "@shared/automation";
import { logger } from "../lib/logger";
import { runWithTenantContext } from "../lib/tenantContext";
import { executeAction, type AutomationDeps } from "./actions";
import { runInsideAutomation } from "./context";

export type AutomationEvent = {
  trigger: AutomationTriggerTypeId;
  tenantId: string | null;
  ticket?: Ticket;
  previousStatus?: string;
};

export type ActionOutcome = { type: string; ok: boolean; message: string };
export type RuleOutcome = { ruleId: string; ruleName: string; status: "success" | "failure"; actions: ActionOutcome[] };

export function ticketFacts(ticket: Ticket, previousStatus?: string): AutomationFacts {
  return {
    "ticket.id": ticket.id,
    "ticket.ticketNumber": ticket.ticketNumber,
    "ticket.title": ticket.title,
    "ticket.description": ticket.description,
    "ticket.status": ticket.status,
    "ticket.previousStatus": previousStatus ?? null,
    "ticket.priority": ticket.priority,
    "ticket.category": ticket.category,
    "ticket.customerEmail": ticket.customerEmail,
    "ticket.customerName": ticket.customerName,
    "ticket.orderNumber": ticket.orderNumber,
    "ticket.isAssigned": Boolean(ticket.assignedToUserId),
    "ticket.fromEmail": Boolean(ticket.emailFrom || ticket.emailSubject),
  };
}

function parseJsonArray<T>(raw: string | null | undefined): T[] | null {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fuehrt alle aktiven Regeln des Mandanten fuer ein Ereignis aus.
 * - Reihenfolge: Prioritaet absteigend, bei Gleichstand aelteste Regel zuerst.
 * - Bedingungen beziehen sich auf den Stand beim Ausloesen (nicht auf Aenderungen frueherer Regeln).
 * - Fehlerhafte bzw. unvollstaendige Regeln (z. B. altes Format) werden uebersprungen und geloggt.
 * - Jede Ausfuehrung landet in der Historie; eine fehlgeschlagene Aktion stoppt die folgenden nicht.
 */
export async function runAutomationEvent(deps: AutomationDeps, event: AutomationEvent): Promise<RuleOutcome[]> {
  return runWithTenantContext(event.tenantId, async () => {
    const rules = (await deps.storage.getActiveAutomationRules())
      .filter((r) => r.triggerType === event.trigger)
      .sort((a, b) => b.priority - a.priority || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (rules.length === 0) return [];

    const prepared: Array<{ rule: AutomationRule; conditions: AutomationConditionInput[]; actions: AutomationActionInput[] }> = [];
    for (const rule of rules) {
      const conditions = parseJsonArray<AutomationConditionInput>(rule.conditions);
      const actions = parseJsonArray<AutomationActionInput>(rule.actions);
      const errors = conditions && actions ? validateAutomationRule({ triggerType: rule.triggerType, conditions, actions }) : ["Bedingungen/Aktionen sind kein gueltiges JSON"];
      if (errors.length > 0) {
        logger.warn({ ruleId: rule.id, ruleName: rule.name, errors }, "Automatisierungsregel uebersprungen: unvollstaendig oder veraltet");
        continue;
      }
      prepared.push({ rule, conditions: conditions!, actions: actions! });
    }

    const facts: AutomationFacts = event.ticket ? ticketFacts(event.ticket, event.previousStatus) : {};
    // KI-Felder nur ermitteln, wenn eine Regel sie braucht - und dann nur einmal je Ereignis
    const needsSentiment = prepared.some((p) => p.conditions.some((c) => AUTOMATION_FIELDS[c.field]?.computed));
    if (needsSentiment && event.ticket) {
      try {
        facts["ticket.sentiment"] = (await deps.classifyTicket(event.ticket)).sentiment;
      } catch (err) {
        logger.warn({ err, ticketId: event.ticket.id }, "Stimmung fuer Automatisierung nicht ermittelbar");
      }
    }

    const outcomes: RuleOutcome[] = [];
    for (const { rule, conditions, actions } of prepared) {
      if (!evaluateConditions(conditions, facts)) continue;

      const results: ActionOutcome[] = [];
      await runInsideAutomation(rule.id, async () => {
        for (const action of actions) {
          try {
            const message = await executeAction(action, { deps, tenantId: event.tenantId, ticket: event.ticket, facts });
            results.push({ type: action.type, ok: true, message });
          } catch (err) {
            results.push({ type: action.type, ok: false, message: err instanceof Error ? err.message : String(err) });
          }
        }
      });

      const status = results.every((r) => r.ok) ? "success" : "failure";
      const firstError = results.find((r) => !r.ok)?.message ?? null;
      try {
        await deps.storage.createAutomationExecution({
          ruleId: rule.id,
          status,
          result: {
            trigger: event.trigger,
            entity: event.ticket ? { type: "ticket", id: event.ticket.id, number: event.ticket.ticketNumber } : null,
            actions: results,
          },
          error: firstError,
        });
        await deps.storage.incrementRuleExecutionCount(rule.id);
      } catch (err) {
        logger.error({ err, ruleId: rule.id }, "Ausfuehrung der Automatisierungsregel nicht protokolliert");
      }
      logger[status === "success" ? "info" : "warn"](
        { ruleId: rule.id, ruleName: rule.name, trigger: event.trigger, ticketId: event.ticket?.id, actions: results },
        `Automatisierungsregel "${rule.name}" ausgefuehrt: ${status}`,
      );
      outcomes.push({ ruleId: rule.id, ruleName: rule.name, status, actions: results });
    }
    return outcomes;
  });
}
