import type { Order, Ticket } from "@shared/schema";
import {
  SCHEDULED_LOOKBACK_DAYS,
  SCHEDULED_MAX_FAILED_ATTEMPTS,
  SCHEDULED_MAX_PER_RULE_PER_RUN,
  SCHEDULED_TICKET_EXCLUDED_STATUSES,
  evaluateConditions,
  type AutomationConditionInput,
} from "@shared/automation";
import { logger } from "../lib/logger";
import { runWithTenantContext } from "../lib/tenantContext";
import { mirrorRowsToOrders } from "../shopware/shopwareMirror";
import type { AutomationDeps } from "./actions";
import type { AutomationEntityRunStats } from "../storage";
import { executeRule, orderFacts, prepareRules, resolveAssigneeName, ticketFacts, type PreparedRule } from "./engine";

/**
 * Zeitgesteuerte Regeln: prueft regelmaessig die Bestellungen aus dem Shopware-Spiegel.
 * Sicherungen: nur Bestellungen der letzten SCHEDULED_LOOKBACK_DAYS Tage; je Bestellung
 * hoechstens einmal pro Regel (Fehlversuche bis SCHEDULED_MAX_FAILED_ATTEMPTS wiederholt);
 * hoechstens SCHEDULED_MAX_PER_RULE_PER_RUN Ausfuehrungen je Regel und Lauf (aelteste zuerst).
 * Doppelt angelegte Bestellungen (gleiche Bestellnummer, Live: 31 Nummern mit 36 weiteren
 * Bestellungen): je Bestellnummer hoechstens eine Ausfuehrung pro Regel - die Bedingungen gelten fuer
 * jede Kopie, ausgefuehrt wird die erste passende; erledigt ist die Nummer, sobald eine ihrer Kopien
 * erledigt ist.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type Candidates = {
  /** Bestellungen im Pruefzeitraum, aelteste zuerst (bei gleichem Datum nach id) */
  orders: Order[];
  /** Bestellnummer je Bestell-id - alle Bestellungen, auch ausserhalb des Pruefzeitraums */
  orderNumberById: Map<string, string>;
};

/** Bestellungen des Mandanten (aus dem Kontext). */
async function candidateOrders(deps: AutomationDeps, tenantId: string | null, now: Date): Promise<Candidates> {
  const { rows } = await deps.storage.getShopwareOrderMirrors(tenantId);
  const all = mirrorRowsToOrders(rows);
  const since = now.getTime() - SCHEDULED_LOOKBACK_DAYS * DAY_MS;
  return {
    orders: all
      .filter((o) => {
        const t = new Date(o.orderDate).getTime();
        return !Number.isNaN(t) && t >= since;
      })
      .sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime() || a.id.localeCompare(b.id)),
    orderNumberById: new Map(all.filter((o) => o.orderNumber).map((o) => [o.id, o.orderNumber])),
  };
}

type RunStats = Pick<AutomationEntityRunStats, "succeeded" | "failures">;
const isSettled = (s: RunStats | undefined) => !!s && (s.succeeded || s.failures >= SCHEDULED_MAX_FAILED_ATTEMPTS);

type Due = { order: Order; facts: ReturnType<typeof orderFacts> };

/** Bestellungen, auf die die Bedingungen zutreffen - getrennt nach "faellig" und "schon erledigt". */
async function matchOrders(
  deps: AutomationDeps,
  conditions: AutomationConditionInput[],
  candidates: Candidates,
  ruleId: string | null,
  now: Date,
): Promise<{ due: Due[]; done: number; matching: number }> {
  const stats: Map<string, RunStats> = ruleId ? await deps.storage.getAutomationEntityRunStats(ruleId, "order") : new Map();
  const settledNumbers = new Set<string>();
  for (const [orderId, s] of stats) {
    const orderNumber = candidates.orderNumberById.get(orderId);
    if (orderNumber && isSettled(s)) settledNumbers.add(orderNumber);
  }
  const seenNumbers = new Set<string>();
  const due: Due[] = [];
  let done = 0;
  let matching = 0;
  for (const order of candidates.orders) {
    const facts = orderFacts(order, now);
    if (!evaluateConditions(conditions, facts)) continue;
    if (order.orderNumber) {
      if (seenNumbers.has(order.orderNumber)) continue;
      seenNumbers.add(order.orderNumber);
    }
    matching += 1;
    if (isSettled(stats.get(order.id)) || settledNumbers.has(order.orderNumber)) done += 1;
    else due.push({ order, facts });
  }
  return { due, done, matching };
}

export type ScheduledRunSummary = { tenantId: string | null; ruleId: string; ruleName: string; matching: number; executed: number; remaining: number };

// ---------------------------------------------------------------------------
// Tickets (Ausloeser "scheduled_tickets", z. B. Wiedervorlage)
// ---------------------------------------------------------------------------

/** Tickets des Mandanten (aus dem Kontext), die nicht geloest/geschlossen sind - aelteste zuerst. */
async function candidateTickets(deps: AutomationDeps): Promise<Ticket[]> {
  const all = await deps.storage.getAllTickets();
  return all
    .filter((t) => !SCHEDULED_TICKET_EXCLUDED_STATUSES.includes(t.status))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
}

/**
 * Erledigt: Fehlversuche ausgeschoepft, oder erfolgreich und das Ticket hat sich seit dem behandelten
 * Stand nicht geaendert. Ohne gemerkten Stand (Altbestand) gilt: einmal je Ticket.
 */
function isTicketSettled(s: AutomationEntityRunStats | undefined, ticket: Ticket): boolean {
  if (!s) return false;
  if (s.failures >= SCHEDULED_MAX_FAILED_ATTEMPTS) return true;
  if (!s.succeeded) return false;
  if (!s.lastHandledAt) return true;
  return new Date(ticket.updatedAt).getTime() <= new Date(s.lastHandledAt).getTime();
}

type DueTicket = { ticket: Ticket; facts: ReturnType<typeof ticketFacts> };

async function matchTickets(
  deps: AutomationDeps,
  conditions: AutomationConditionInput[],
  tickets: Ticket[],
  ruleId: string | null,
  now: Date,
  names: Map<string, string | null>,
): Promise<{ due: DueTicket[]; done: number; matching: number }> {
  const stats: Map<string, AutomationEntityRunStats> = ruleId ? await deps.storage.getAutomationEntityRunStats(ruleId, "ticket") : new Map();
  const due: DueTicket[] = [];
  let done = 0;
  let matching = 0;
  for (const ticket of tickets) {
    const facts = ticketFacts(ticket, undefined, { assigneeName: await resolveAssigneeName(deps, ticket, names), now });
    if (!evaluateConditions(conditions, facts)) continue;
    matching += 1;
    if (isTicketSettled(stats.get(ticket.id), ticket)) done += 1;
    else due.push({ ticket, facts });
  }
  return { due, done, matching };
}

// ---------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------

function logRun(tenantId: string | null, p: PreparedRule, matching: number, executed: number, remaining: number) {
  if (executed > 0 || remaining > 0) {
    logger.info(
      { tenantId, ruleId: p.rule.id, matching, executed, remaining },
      `Zeitgesteuerte Regel "${p.rule.name}": ${executed} ausgefuehrt`,
    );
  }
}

export async function runScheduledAutomations(deps: AutomationDeps, now: Date = new Date()): Promise<ScheduledRunSummary[]> {
  const tenants = await deps.storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  const summary: ScheduledRunSummary[] = [];

  for (const tenantId of tenantIds) {
    try {
      await runWithTenantContext(tenantId, async () => {
        const orderRules = await prepareRules(deps, "scheduled");
        if (orderRules.length > 0) {
          const orders = await candidateOrders(deps, tenantId, now);
          for (const p of orderRules) {
            const { due, matching } = await matchOrders(deps, p.conditions, orders, p.rule.id, now);
            const batch = due.slice(0, SCHEDULED_MAX_PER_RULE_PER_RUN);
            for (const { order, facts } of batch) {
              await executeRule(deps, p, { trigger: "scheduled", tenantId, facts, order });
            }
            summary.push({ tenantId, ruleId: p.rule.id, ruleName: p.rule.name, matching, executed: batch.length, remaining: due.length - batch.length });
            logRun(tenantId, p, matching, batch.length, due.length - batch.length);
          }
        }

        const ticketRules = await prepareRules(deps, "scheduled_tickets");
        if (ticketRules.length > 0) {
          const tickets = await candidateTickets(deps);
          const names = new Map<string, string | null>();
          for (const p of ticketRules) {
            // Je Regel neu pruefen: eine fruehere Regel kann Tickets geaendert haben
            const { due, matching } = await matchTickets(deps, p.conditions, tickets, p.rule.id, now, names);
            const batch = due.slice(0, SCHEDULED_MAX_PER_RULE_PER_RUN);
            for (const { ticket, facts } of batch) {
              await executeRule(deps, p, { trigger: "scheduled_tickets", tenantId, facts, ticket });
            }
            summary.push({ tenantId, ruleId: p.rule.id, ruleName: p.rule.name, matching, executed: batch.length, remaining: due.length - batch.length });
            logRun(tenantId, p, matching, batch.length, due.length - batch.length);
          }
        }
      });
    } catch (err) {
      logger.error({ err, tenantId }, "Zeitgesteuerte Automatisierung fuer Mandant fehlgeschlagen");
    }
  }
  return summary;
}

export type ScheduledPreview = {
  /** Bestellungen im Pruefzeitraum, auf die die Bedingungen zutreffen */
  matching: number;
  /** davon schon erledigt (nur bei bestehender Regel) */
  alreadyDone: number;
  /** im naechsten Lauf ausgefuehrt (begrenzt) */
  nextRun: number;
  sample: Array<{ orderNumber: string; customerName: string; orderDate: string; status: string; paymentStatus: string; daysPastDeliveryDate: number | null }>;
};

/** Was wuerde eine (ggf. noch ungespeicherte) zeitgesteuerte Regel jetzt tun? Fuehrt nichts aus. */
export async function previewScheduledRule(
  deps: AutomationDeps,
  tenantId: string | null,
  conditions: AutomationConditionInput[],
  ruleId: string | null,
  now: Date = new Date(),
): Promise<ScheduledPreview> {
  return runWithTenantContext(tenantId, async () => {
    const orders = await candidateOrders(deps, tenantId, now);
    const { due, done, matching } = await matchOrders(deps, conditions, orders, ruleId, now);
    return {
      matching,
      alreadyDone: done,
      nextRun: Math.min(due.length, SCHEDULED_MAX_PER_RULE_PER_RUN),
      sample: due.slice(0, 20).map(({ order, facts }) => ({
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        orderDate: order.orderDate,
        status: order.status,
        paymentStatus: order.paymentStatus,
        daysPastDeliveryDate: (facts["order.daysPastDeliveryDate"] as number | null) ?? null,
      })),
    };
  });
}

export type ScheduledTicketPreview = {
  /** Offene Tickets, auf die die Bedingungen zutreffen */
  matching: number;
  /** davon schon erledigt (nur bei bestehender Regel) */
  alreadyDone: number;
  /** im naechsten Lauf ausgefuehrt (begrenzt) */
  nextRun: number;
  sample: Array<{ ticketNumber: string; title: string; status: string; assigneeName: string | null; daysSinceUpdated: number | null }>;
};

/** Was wuerde eine (ggf. noch ungespeicherte) zeitgesteuerte Ticket-Regel jetzt tun? Fuehrt nichts aus. */
export async function previewScheduledTicketRule(
  deps: AutomationDeps,
  tenantId: string | null,
  conditions: AutomationConditionInput[],
  ruleId: string | null,
  now: Date = new Date(),
): Promise<ScheduledTicketPreview> {
  return runWithTenantContext(tenantId, async () => {
    const tickets = await candidateTickets(deps);
    const { due, done, matching } = await matchTickets(deps, conditions, tickets, ruleId, now, new Map());
    return {
      matching,
      alreadyDone: done,
      nextRun: Math.min(due.length, SCHEDULED_MAX_PER_RULE_PER_RUN),
      sample: due.slice(0, 20).map(({ ticket, facts }) => ({
        ticketNumber: ticket.ticketNumber,
        title: ticket.title,
        status: ticket.status,
        assigneeName: (facts["ticket.assigneeName"] as string | null) ?? null,
        daysSinceUpdated: (facts["ticket.daysSinceUpdated"] as number | null) ?? null,
      })),
    };
  });
}
