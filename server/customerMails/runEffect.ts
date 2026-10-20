/**
 * Kundenmails B6: Wirkung einer Aussendung. Brevo-Kampagnenzahlen (Zustellung, Öffnungen, Klicks, Abmeldungen),
 * Klicks aus dem Webhook und Bestellungen der Empfänger in den EFFECT_WINDOW_DAYS Tagen nach dem Versand, verglichen
 * mit der Kontrollgruppe des Laufs (Empfänger mit Grund „controlGroup“, z. B. bei der Reaktivierung).
 * Bestellungen: MO aus dem Spiegel, ohne Storno und durchgeschleuste, netto.
 */
import { and, eq, isNull, sql, type AnyColumn } from "drizzle-orm";
import { db } from "../db";
import { marketingEvents, marketingMailRecipients, marketingMailRuns } from "@shared/schema";
import type { CustomerMailRunEffect } from "@shared/customerMails";
import { brevoErrorText } from "./brevoClient";
import { normalizeEmail } from "./legalBasis";
import type { LetterOrder } from "./regularLetter";
import { loadLetterOrders } from "./regularLetterRun";
import { CustomerMailError, getBrevoApiKey, type CustomerMailDeps } from "./customerMailsRun";

export const EFFECT_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

/** Bestellungen einer Adressgruppe im Fenster nach dem Versand (rein, getestet) */
export function ordersAfter(orders: LetterOrder[], emails: Set<string>, from: Date, days = EFFECT_WINDOW_DAYS): { customers: number; orders: number; net: number } {
  const to = from.getTime() + days * DAY_MS;
  const hits = orders.filter((o) => {
    const e = normalizeEmail(o.email);
    const t = o.createdAt.getTime();
    return e && emails.has(e) && /^MO/i.test(o.orderNumber) && o.status !== "cancelled" && !o.passthrough && t > from.getTime() && t <= to;
  });
  return {
    customers: new Set(hits.map((o) => normalizeEmail(o.email))).size,
    orders: hits.length,
    net: Math.round(hits.reduce((s, o) => s + (o.net ?? 0), 0) * 100) / 100,
  };
}

export async function runEffect(deps: CustomerMailDeps, tenantId: string | null, runId: string): Promise<CustomerMailRunEffect> {
  const [run] = await db.select().from(marketingMailRuns).where(and(eq(marketingMailRuns.id, runId), tenantIs(marketingMailRuns.tenantId, tenantId)));
  if (!run) throw new CustomerMailError("runNotFound");
  const recipients = await db.select({ email: marketingMailRecipients.email, status: marketingMailRecipients.status, skipReason: marketingMailRecipients.skipReason }).from(marketingMailRecipients).where(eq(marketingMailRecipients.runId, runId));
  const sentEmails = new Set(recipients.filter((r) => r.status === "sent").map((r) => r.email));
  const control = new Set(recipients.filter((r) => r.skipReason === "controlGroup").map((r) => r.email));

  let brevo: CustomerMailRunEffect["brevo"] = null;
  let brevoError: string | null = null;
  if (run.brevoCampaignId) {
    const key = await getBrevoApiKey(deps.storage, tenantId);
    if (key) {
      try {
        brevo = await deps.brevo(key).campaignStats(run.brevoCampaignId);
      } catch (err) {
        brevoError = brevoErrorText(err);
      }
    }
  }
  const [{ clickers }] = run.brevoCampaignId
    ? await db
        .select({ clickers: sql<number>`count(distinct ${marketingEvents.email})::int` })
        .from(marketingEvents)
        .where(and(tenantIs(marketingEvents.tenantId, tenantId), eq(marketingEvents.campaignId, run.brevoCampaignId), eq(marketingEvents.event, "click")))
    : [{ clickers: 0 }];

  const orders = run.sentAt ? await loadLetterOrders(tenantId) : [];
  const empty = { customers: 0, orders: 0, net: 0 };
  return {
    runId,
    sentAt: run.sentAt ? run.sentAt.toISOString() : null,
    sent: sentEmails.size,
    brevo,
    brevoError,
    clickers: Number(clickers) || 0,
    windowDays: EFFECT_WINDOW_DAYS,
    orders: run.sentAt ? ordersAfter(orders, sentEmails, run.sentAt) : empty,
    control: control.size ? { size: control.size, ...(run.sentAt ? ordersAfter(orders, control, run.sentAt) : empty) } : null,
  };
}
