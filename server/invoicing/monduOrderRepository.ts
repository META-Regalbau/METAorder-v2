import { and, eq, isNull, notInArray, or, type AnyColumn } from "drizzle-orm";
import { monduOrders, type InsertMonduOrderRow, type MonduOrderRow } from "@shared/schema";
import { MONDU_SELL_CLOSED_STATES, type MonduHistoryEvent, type MonduSellInfo } from "@shared/mondu";
import { db } from "../db";

/**
 * Datenbankzugriff für Mondu an Bestellungen (Tabelle mondu_orders, Migration 0055). Jede Abfrage ist auf
 * den Mandanten begrenzt; ohne Mandant nur Zeilen ohne Mandant.
 */

export type MonduOrderKind = "sell" | "shop";
export type MonduOrderPatch = Partial<Omit<InsertMonduOrderRow, "id" | "tenantId" | "shopwareOrderId" | "kind">>;

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

/** Höchstens so viele Ereignisse je Zeile behalten (älteste fallen weg) */
const HISTORY_LIMIT = 50;

export function historyOf(row: Pick<MonduOrderRow, "history"> | null | undefined): MonduHistoryEvent[] {
  return Array.isArray(row?.history) ? (row!.history as MonduHistoryEvent[]) : [];
}

export function withEvent(row: Pick<MonduOrderRow, "history"> | null | undefined, event: MonduHistoryEvent): MonduHistoryEvent[] {
  return [...historyOf(row), event].slice(-HISTORY_LIMIT);
}

export function rowToSellInfo(row: MonduOrderRow): MonduSellInfo {
  return {
    monduOrderUuid: row.monduOrderUuid,
    externalReferenceId: row.externalReferenceId,
    state: row.state,
    stateReason: row.stateReason,
    grossAmountCents: row.grossAmountCents,
    currency: row.currency,
    buyerEmail: row.buyerEmail,
    netTerm: row.netTerm,
    attempt: row.attempt,
    invoicePending: row.invoicePending,
    invoiceUuid: row.invoiceUuid,
    invoiceNumber: row.invoiceNumber,
    invoiceState: row.invoiceState,
    lastError: row.lastError,
    history: historyOf(row),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
  };
}

export async function getMonduOrder(tenantId: string | null, shopwareOrderId: string, kind: MonduOrderKind): Promise<MonduOrderRow | null> {
  const rows = await db
    .select()
    .from(monduOrders)
    .where(and(tenantIs(monduOrders.tenantId, tenantId), eq(monduOrders.shopwareOrderId, shopwareOrderId), eq(monduOrders.kind, kind)))
    .limit(1);
  return rows[0] ?? null;
}

/** Zeile anlegen oder ändern (je Mandant, Bestellung und Art genau eine) */
export async function saveMonduOrder(
  tenantId: string | null,
  shopwareOrderId: string,
  kind: MonduOrderKind,
  patch: MonduOrderPatch,
): Promise<MonduOrderRow> {
  const existing = await getMonduOrder(tenantId, shopwareOrderId, kind);
  if (existing) {
    const [row] = await db
      .update(monduOrders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(monduOrders.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(monduOrders)
    .values({ ...patch, tenantId, shopwareOrderId, kind })
    .returning();
  return row;
}

/** Mondu-Sell-Bestellungen, die der Abgleich ansehen muss: alle außer abgelehnt/storniert/abgeschlossen */
export async function listOpenSellOrders(tenantId: string | null): Promise<MonduOrderRow[]> {
  return db
    .select()
    .from(monduOrders)
    .where(
      and(
        tenantIs(monduOrders.tenantId, tenantId),
        eq(monduOrders.kind, "sell"),
        or(isNull(monduOrders.state), notInArray(monduOrders.state, [...MONDU_SELL_CLOSED_STATES, "complete"])),
      ),
    );
}
