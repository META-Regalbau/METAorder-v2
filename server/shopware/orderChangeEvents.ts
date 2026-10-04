import type { Order } from "@shared/schema";
import { ORDER_EVENT_MAX_AGE_HOURS } from "@shared/automation";
import { emitDomainEvent } from "../lib/domainEvents";

/**
 * Aenderungserkennung beim Bestell-Spiegel: vergleicht frisch geladene Bestellungen mit dem
 * bisherigen Spiegelstand und meldet "erstellt", "Status geaendert", "Zahlungsstatus geaendert"
 * (z. B. fuer Automatisierungsregeln).
 *
 * Schutz vor Massenmeldungen:
 * - Erstimport (Spiegel des Mandanten war leer): keine Meldungen.
 * - Nur Aenderungen, die in Shopware hoechstens ORDER_EVENT_MAX_AGE_HOURS zurueckliegen
 *   (updatedAt, sonst createdAt/orderDate). War der Spiegel laenger angehalten, loesen die
 *   nachgeholten alten Aenderungen nichts mehr aus.
 * - "Erstellt" nur fuer Bestellungen, die selbst so jung sind - eine alte Bestellung, die
 *   bisher im Spiegel fehlte, ist keine neue Bestellung.
 * - Gemeldet wird erst nach dem Upsert; der naechste Abgleich sieht den neuen Stand.
 */
export type OrderChange =
  | { kind: "created"; order: Order }
  | { kind: "statusChanged"; order: Order; previousStatus: string }
  | { kind: "paymentStatusChanged"; order: Order; previousPaymentStatus: string };

export type PreviousOrderState = { status: string | null; paymentStatus: string | null };

function isRecent(raw: string | undefined | null, now: Date): boolean {
  const t = raw ? new Date(raw).getTime() : NaN;
  return !Number.isNaN(t) && now.getTime() - t <= ORDER_EVENT_MAX_AGE_HOURS * 60 * 60 * 1000;
}

export function detectOrderChanges(
  orders: Order[],
  previous: Map<string, PreviousOrderState>,
  opts: { initialImport: boolean; now?: Date },
): OrderChange[] {
  if (opts.initialImport) return [];
  const now = opts.now ?? new Date();
  const changes: OrderChange[] = [];
  for (const order of orders) {
    // Neue Bestellungen haben updatedAt = null, bis sie erstmals geaendert werden
    if (!isRecent(order.updatedAt ?? order.createdAt ?? order.orderDate, now)) continue;
    const before = previous.get(order.id);
    if (!before) {
      if (isRecent(order.createdAt ?? order.orderDate, now)) changes.push({ kind: "created", order });
      continue;
    }
    if (before.status && order.status && before.status !== order.status) {
      changes.push({ kind: "statusChanged", order, previousStatus: before.status });
    }
    if (before.paymentStatus && order.paymentStatus && before.paymentStatus !== order.paymentStatus) {
      changes.push({ kind: "paymentStatusChanged", order, previousPaymentStatus: before.paymentStatus });
    }
  }
  return changes;
}

export function emitOrderChanges(changes: OrderChange[], tenantId: string | null): void {
  for (const c of changes) {
    if (c.kind === "created") emitDomainEvent("order.created", { order: c.order, tenantId });
    else if (c.kind === "statusChanged") emitDomainEvent("order.statusChanged", { order: c.order, tenantId, previousStatus: c.previousStatus });
    else emitDomainEvent("order.paymentStatusChanged", { order: c.order, tenantId, previousPaymentStatus: c.previousPaymentStatus });
  }
}
