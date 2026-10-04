import type { Order } from "@shared/schema";
import {
  SCHEDULED_LOOKBACK_DAYS,
  SCHEDULED_MAX_FAILED_ATTEMPTS,
  SCHEDULED_MAX_PER_RULE_PER_RUN,
  evaluateConditions,
  type AutomationConditionInput,
} from "@shared/automation";
import { logger } from "../lib/logger";
import { runWithTenantContext } from "../lib/tenantContext";
import { mirrorRowsToOrders } from "../shopware/shopwareMirror";
import type { AutomationDeps } from "./actions";
import { executeRule, orderFacts, prepareRules } from "./engine";

/**
 * Zeitgesteuerte Regeln: prueft regelmaessig die Bestellungen aus dem Shopware-Spiegel.
 * Sicherungen: nur Bestellungen der letzten SCHEDULED_LOOKBACK_DAYS Tage; je Bestellung
 * hoechstens einmal pro Regel (Fehlversuche bis SCHEDULED_MAX_FAILED_ATTEMPTS wiederholt);
 * hoechstens SCHEDULED_MAX_PER_RULE_PER_RUN Ausfuehrungen je Regel und Lauf (aelteste zuerst).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bestellungen des Mandanten (aus dem Kontext) im Pruefzeitraum, aelteste zuerst. */
async function candidateOrders(deps: AutomationDeps, tenantId: string | null, now: Date): Promise<Order[]> {
  const { rows } = await deps.storage.getShopwareOrderMirrors(tenantId);
  const since = now.getTime() - SCHEDULED_LOOKBACK_DAYS * DAY_MS;
  return mirrorRowsToOrders(rows)
    .filter((o) => {
      const t = new Date(o.orderDate).getTime();
      return !Number.isNaN(t) && t >= since;
    })
    .sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());
}

type Due = { order: Order; facts: ReturnType<typeof orderFacts> };

/** Bestellungen, auf die die Bedingungen zutreffen - getrennt nach "faellig" und "schon erledigt". */
async function matchOrders(
  deps: AutomationDeps,
  conditions: AutomationConditionInput[],
  orders: Order[],
  ruleId: string | null,
  now: Date,
): Promise<{ due: Due[]; done: number; matching: number }> {
  const stats = ruleId ? await deps.storage.getAutomationEntityRunStats(ruleId, "order") : new Map();
  const due: Due[] = [];
  let done = 0;
  let matching = 0;
  for (const order of orders) {
    const facts = orderFacts(order, now);
    if (!evaluateConditions(conditions, facts)) continue;
    matching += 1;
    const s = stats.get(order.id);
    if (s?.succeeded || (s?.failures ?? 0) >= SCHEDULED_MAX_FAILED_ATTEMPTS) done += 1;
    else due.push({ order, facts });
  }
  return { due, done, matching };
}

export type ScheduledRunSummary = { tenantId: string | null; ruleId: string; ruleName: string; matching: number; executed: number; remaining: number };

export async function runScheduledAutomations(deps: AutomationDeps, now: Date = new Date()): Promise<ScheduledRunSummary[]> {
  const tenants = await deps.storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  const summary: ScheduledRunSummary[] = [];

  for (const tenantId of tenantIds) {
    try {
      await runWithTenantContext(tenantId, async () => {
        const prepared = await prepareRules(deps, "scheduled");
        if (prepared.length === 0) return;
        const orders = await candidateOrders(deps, tenantId, now);
        for (const p of prepared) {
          const { due, matching } = await matchOrders(deps, p.conditions, orders, p.rule.id, now);
          const batch = due.slice(0, SCHEDULED_MAX_PER_RULE_PER_RUN);
          for (const { order, facts } of batch) {
            await executeRule(deps, p, { trigger: "scheduled", tenantId, facts, order });
          }
          summary.push({ tenantId, ruleId: p.rule.id, ruleName: p.rule.name, matching, executed: batch.length, remaining: due.length - batch.length });
          if (batch.length > 0 || due.length > 0) {
            logger.info(
              { tenantId, ruleId: p.rule.id, matching, executed: batch.length, remaining: due.length - batch.length },
              `Zeitgesteuerte Regel "${p.rule.name}": ${batch.length} ausgefuehrt`,
            );
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
