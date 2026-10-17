import { and, desc, eq, gte, inArray, isNull, or, sql, type AnyColumn } from "drizzle-orm";
import { shopPulseSignals, type ShopPulseSignalRow } from "@shared/schema";
import {
  SHOP_PULSE_CODES,
  SHOP_PULSE_SEVERITIES,
  SHOP_PULSE_SOURCES,
  type ShopPulseCode,
  type ShopPulseSeverity,
  type ShopPulseSignal,
  type ShopPulseSource,
} from "@shared/shopPulse";
import { db } from "../db";
import type { ReconcileResult } from "./shopPulseSignals";

/**
 * Datenbankzugriff des Shop-Puls (Tabelle shop_pulse_signals, Migration 0054). Jede Abfrage ist auf den
 * Mandanten begrenzt; ohne Mandant nur Zeilen ohne Mandant.
 */

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const date = (v: string | null | undefined) => (v ? new Date(v) : null);
const oneOf = <T extends string>(list: readonly T[], v: string, fallback: T): T => ((list as readonly string[]).includes(v) ? (v as T) : fallback);

export function rowToSignal(row: ShopPulseSignalRow): ShopPulseSignal {
  return {
    id: row.id,
    key: row.key,
    source: oneOf<ShopPulseSource>(SHOP_PULSE_SOURCES, row.source, "system"),
    code: oneOf<ShopPulseCode>(SHOP_PULSE_CODES, row.code, SHOP_PULSE_CODES[0]),
    severity: oneOf<ShopPulseSeverity>(SHOP_PULSE_SEVERITIES, row.severity, "warning"),
    status: row.status === "resolved" ? "resolved" : "open",
    params: (row.params ?? {}) as Record<string, string | number>,
    evidence: (row.evidence ?? {}) as Record<string, unknown>,
    lossPerHour: row.lossPerHour ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
    resolvedBy: row.resolvedBy ?? null,
    mutedUntil: iso(row.mutedUntil),
    notifiedAt: iso(row.notifiedAt),
    notifiedSeverity: row.notifiedSeverity ? oneOf<ShopPulseSeverity>(SHOP_PULSE_SEVERITIES, row.notifiedSeverity, "warning") : null,
  };
}

function toColumns(patch: Partial<ShopPulseSignal>) {
  const out: Partial<typeof shopPulseSignals.$inferInsert> = {};
  if (patch.source !== undefined) out.source = patch.source;
  if (patch.code !== undefined) out.code = patch.code;
  if (patch.severity !== undefined) out.severity = patch.severity;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.params !== undefined) out.params = patch.params;
  if (patch.evidence !== undefined) out.evidence = patch.evidence;
  if (patch.lossPerHour !== undefined) out.lossPerHour = patch.lossPerHour;
  if (patch.firstSeenAt !== undefined) out.firstSeenAt = new Date(patch.firstSeenAt);
  if (patch.lastSeenAt !== undefined) out.lastSeenAt = new Date(patch.lastSeenAt);
  if (patch.resolvedAt !== undefined) out.resolvedAt = date(patch.resolvedAt);
  if (patch.resolvedBy !== undefined) out.resolvedBy = patch.resolvedBy;
  if (patch.mutedUntil !== undefined) out.mutedUntil = date(patch.mutedUntil);
  if (patch.notifiedAt !== undefined) out.notifiedAt = date(patch.notifiedAt);
  if (patch.notifiedSeverity !== undefined) out.notifiedSeverity = patch.notifiedSeverity;
  return out;
}

/** Alle Meldungen der angegebenen Quellen (für den Abgleich nach einem Prüflauf) */
export async function listSignalsBySources(tenantId: string | null, sources: ShopPulseSource[]): Promise<ShopPulseSignal[]> {
  if (!sources.length) return [];
  const rows = await db
    .select()
    .from(shopPulseSignals)
    .where(and(tenantIs(shopPulseSignals.tenantId, tenantId), inArray(shopPulseSignals.source, sources)));
  return rows.map(rowToSignal);
}

/** Für die Seite: alle offenen und die in den letzten Tagen erledigten Meldungen */
export async function listSignalsForOverview(tenantId: string | null, resolvedSinceDays = 14, limit = 200): Promise<ShopPulseSignal[]> {
  const since = new Date(Date.now() - resolvedSinceDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(shopPulseSignals)
    .where(and(tenantIs(shopPulseSignals.tenantId, tenantId), or(eq(shopPulseSignals.status, "open"), gte(shopPulseSignals.lastSeenAt, since))))
    .orderBy(desc(shopPulseSignals.lastSeenAt))
    .limit(limit);
  return rows.map(rowToSignal);
}

export async function listOpenSignals(tenantId: string | null): Promise<ShopPulseSignal[]> {
  const rows = await db.select().from(shopPulseSignals).where(and(tenantIs(shopPulseSignals.tenantId, tenantId), eq(shopPulseSignals.status, "open")));
  return rows.map(rowToSignal);
}

export async function getSignal(tenantId: string | null, id: string): Promise<ShopPulseSignal | undefined> {
  const rows = await db
    .select()
    .from(shopPulseSignals)
    .where(and(eq(shopPulseSignals.id, id), tenantIs(shopPulseSignals.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? rowToSignal(rows[0]) : undefined;
}

/** Ergebnis von reconcileSignals schreiben (eine Transaktion) */
export async function applyReconcile(tenantId: string | null, result: ReconcileResult): Promise<void> {
  if (!result.inserts.length && !result.updates.length) return;
  await db.transaction(async (tx) => {
    for (const s of result.inserts) {
      await tx.insert(shopPulseSignals).values({ id: s.id, tenantId, key: s.key, ...toColumns(s) } as typeof shopPulseSignals.$inferInsert);
    }
    for (const u of result.updates) {
      const set: Record<string, unknown> = toColumns(u.patch);
      if (u.reopen) set.reopenCount = sql`${shopPulseSignals.reopenCount} + 1`;
      await tx
        .update(shopPulseSignals)
        .set(set)
        .where(and(eq(shopPulseSignals.id, u.id), tenantIs(shopPulseSignals.tenantId, tenantId)));
    }
  });
}

/** Von Hand erledigen; kommt der Fund wieder, öffnet der nächste Lauf die Meldung erneut */
export async function resolveSignalManually(tenantId: string | null, id: string, by: string): Promise<ShopPulseSignal | undefined> {
  const rows = await db
    .update(shopPulseSignals)
    .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: by })
    .where(and(eq(shopPulseSignals.id, id), tenantIs(shopPulseSignals.tenantId, tenantId)))
    .returning();
  return rows[0] ? rowToSignal(rows[0]) : undefined;
}

/** Ruhig stellen bis zum Zeitpunkt (null = wieder melden) */
export async function muteSignal(tenantId: string | null, id: string, until: Date | null): Promise<ShopPulseSignal | undefined> {
  const rows = await db
    .update(shopPulseSignals)
    .set({ mutedUntil: until })
    .where(and(eq(shopPulseSignals.id, id), tenantIs(shopPulseSignals.tenantId, tenantId)))
    .returning();
  return rows[0] ? rowToSignal(rows[0]) : undefined;
}
