import type { AutomationRule, Order, Ticket } from "@shared/schema";
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
  order?: Order;
  /** Vorheriger Status (Ticket bzw. Bestellung, je nach Ausloeser) */
  previousStatus?: string;
  previousPaymentStatus?: string;
};

export type ActionOutcome = { type: string; ok: boolean; message: string };
export type RuleOutcome = { ruleId: string; ruleName: string; status: "success" | "failure"; actions: ActionOutcome[] };

export type PreparedRule = { rule: AutomationRule; conditions: AutomationConditionInput[]; actions: AutomationActionInput[] };

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Ganze Tage seit einem Datum (abgerundet); null bei fehlendem/ungueltigem Datum. */
function daysSince(value: string | undefined | null, now: Date): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / DAY_MS);
}

export function orderFacts(
  order: Order,
  now: Date = new Date(),
  previous: { status?: string; paymentStatus?: string } = {},
): AutomationFacts {
  const daysSinceOrder = daysSince(order.orderDate, now);
  // Wie die Ansicht "Verspaetete Bestellungen": spaetestes Lieferdatum, sonst Bestelldatum
  const daysPastDelivery = daysSince(order.deliveryDateLatest ?? order.orderDate, now);
  return {
    "order.id": order.id,
    "order.orderNumber": order.orderNumber,
    "order.orderDate": order.orderDate ? order.orderDate.slice(0, 10) : null,
    "order.status": order.status,
    "order.previousStatus": previous.status ?? null,
    "order.paymentStatus": order.paymentStatus,
    "order.previousPaymentStatus": previous.paymentStatus ?? null,
    "order.daysSinceOrder": daysSinceOrder,
    "order.daysPastDeliveryDate": daysPastDelivery,
    "order.totalAmount": typeof order.totalAmount === "number" ? order.totalAmount : null,
    "order.customerName": order.customerName,
    "order.customerEmail": order.customerEmail,
    "order.paymentMethod": order.paymentMethod ?? null,
    "order.shippingMethod": order.shippingMethod ?? null,
    "order.salesChannelName": order.salesChannelName ?? null,
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
 * Aktive, vollstaendige Regeln eines Ausloesers fuer den Mandanten aus dem Kontext.
 * Reihenfolge: Prioritaet absteigend, bei Gleichstand aelteste zuerst. Unvollstaendige bzw.
 * veraltete Regeln (z. B. altes Format) werden uebersprungen und geloggt.
 */
export async function prepareRules(deps: AutomationDeps, trigger: AutomationTriggerTypeId): Promise<PreparedRule[]> {
  const rules = (await deps.storage.getActiveAutomationRules())
    .filter((r) => r.triggerType === trigger)
    .sort((a, b) => b.priority - a.priority || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const prepared: PreparedRule[] = [];
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
  return prepared;
}

/**
 * Fuehrt die Aktionen einer Regel aus (Schleifenschutz aktiv), protokolliert die Ausfuehrung
 * und zaehlt hoch. Eine fehlgeschlagene Aktion stoppt die folgenden nicht.
 */
export async function executeRule(
  deps: AutomationDeps,
  prepared: PreparedRule,
  ctx: { trigger: AutomationTriggerTypeId; tenantId: string | null; facts: AutomationFacts; ticket?: Ticket; order?: Order },
): Promise<RuleOutcome> {
  const { rule, actions } = prepared;
  const results: ActionOutcome[] = [];
  await runInsideAutomation(rule.id, async () => {
    for (const action of actions) {
      try {
        const message = await executeAction(action, { deps, tenantId: ctx.tenantId, ticket: ctx.ticket, order: ctx.order, facts: ctx.facts });
        results.push({ type: action.type, ok: true, message });
      } catch (err) {
        results.push({ type: action.type, ok: false, message: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  const status = results.every((r) => r.ok) ? "success" : "failure";
  const entity = ctx.ticket
    ? { type: "ticket", id: ctx.ticket.id, number: ctx.ticket.ticketNumber }
    : ctx.order
      ? { type: "order", id: ctx.order.id, number: ctx.order.orderNumber }
      : null;
  try {
    await deps.storage.createAutomationExecution({
      ruleId: rule.id,
      status,
      result: { trigger: ctx.trigger, entity, actions: results },
      error: results.find((r) => !r.ok)?.message ?? null,
    });
    await deps.storage.incrementRuleExecutionCount(rule.id);
  } catch (err) {
    logger.error({ err, ruleId: rule.id }, "Ausfuehrung der Automatisierungsregel nicht protokolliert");
  }
  logger[status === "success" ? "info" : "warn"](
    { ruleId: rule.id, ruleName: rule.name, trigger: ctx.trigger, entity, actions: results },
    `Automatisierungsregel "${rule.name}" ausgefuehrt: ${status}`,
  );
  return { ruleId: rule.id, ruleName: rule.name, status, actions: results };
}

/**
 * Ticket- oder Bestell-Ereignis: alle passenden Regeln des Mandanten ausfuehren.
 * Bedingungen beziehen sich auf den Stand beim Ausloesen (nicht auf Aenderungen frueherer Regeln).
 */
export async function runAutomationEvent(deps: AutomationDeps, event: AutomationEvent): Promise<RuleOutcome[]> {
  return runWithTenantContext(event.tenantId, async () => {
    const prepared = await prepareRules(deps, event.trigger);
    if (prepared.length === 0) return [];

    const facts: AutomationFacts = event.ticket
      ? ticketFacts(event.ticket, event.previousStatus)
      : event.order
        ? orderFacts(event.order, new Date(), { status: event.previousStatus, paymentStatus: event.previousPaymentStatus })
        : {};
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
    for (const p of prepared) {
      if (!evaluateConditions(p.conditions, facts)) continue;
      outcomes.push(await executeRule(deps, p, { trigger: event.trigger, tenantId: event.tenantId, facts, ticket: event.ticket, order: event.order }));
    }
    return outcomes;
  });
}
