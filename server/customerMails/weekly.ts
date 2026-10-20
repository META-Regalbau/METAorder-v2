/**
 * Kundenmails B6 im Shop-Puls-Wochenbericht: Aussendungen an Kunden in der Berichtswoche (ohne Testaussendungen),
 * Bestellungen der Empfänger in 14 Tagen nach dem jeweiligen Versand und Abmeldungen/Spam-Meldungen der Woche.
 * null = in der Woche nichts an Kunden verschickt (dann kein Abschnitt).
 */
import { and, eq, gte, inArray, isNull, lt, ne, type AnyColumn } from "drizzle-orm";
import { db } from "../db";
import { marketingEvents, marketingMailRecipients, marketingMailRuns } from "@shared/schema";
import type { ShopPulseWeeklyCustomerMails } from "@shared/shopPulseWeekly";
import { loadLetterOrders } from "./regularLetterRun";
import { ordersAfter } from "./runEffect";

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

export async function customerMailsWeek(tenantId: string | null, from: Date, to: Date): Promise<ShopPulseWeeklyCustomerMails | null> {
  const runs = await db
    .select({ id: marketingMailRuns.id, mailType: marketingMailRuns.mailType, sentAt: marketingMailRuns.sentAt })
    .from(marketingMailRuns)
    .where(and(tenantIs(marketingMailRuns.tenantId, tenantId), ne(marketingMailRuns.mailType, "test"), gte(marketingMailRuns.sentAt, from), lt(marketingMailRuns.sentAt, to)));
  if (!runs.length) return null;
  const recipients = await db
    .select({ runId: marketingMailRecipients.runId, email: marketingMailRecipients.email })
    .from(marketingMailRecipients)
    .where(and(inArray(marketingMailRecipients.runId, runs.map((r) => r.id)), eq(marketingMailRecipients.status, "sent")));
  const orders = await loadLetterOrders(tenantId);
  const byType = new Map<string, { mailType: string; runs: number; sent: number }>();
  const total = { customers: 0, orders: 0, net: 0 };
  for (const run of runs) {
    const emails = new Set(recipients.filter((r) => r.runId === run.id).map((r) => r.email));
    const t = byType.get(run.mailType) ?? { mailType: run.mailType, runs: 0, sent: 0 };
    t.runs += 1;
    t.sent += emails.size;
    byType.set(run.mailType, t);
    if (run.sentAt) {
      const o = ordersAfter(orders, emails, run.sentAt);
      total.customers += o.customers;
      total.orders += o.orders;
      total.net = Math.round((total.net + o.net) * 100) / 100;
    }
  }
  const objections = await db
    .select({ email: marketingEvents.email })
    .from(marketingEvents)
    .where(and(tenantIs(marketingEvents.tenantId, tenantId), inArray(marketingEvents.event, ["unsubscribe", "unsubscribed", "spam"]), gte(marketingEvents.occurredAt, from), lt(marketingEvents.occurredAt, to)));
  return {
    runs: runs.length,
    sent: Array.from(byType.values()).reduce((s, x) => s + x.sent, 0),
    byType: Array.from(byType.values()),
    orders: total,
    objections: new Set(objections.map((o) => o.email)).size,
  };
}
