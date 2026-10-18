/**
 * Datenbankzugriff des Maßnahmen-Protokolls (shop_pulse_actions) und des Archivs der Wochenberichte
 * (shop_pulse_weekly_reports), Migration 0057. Jede Abfrage ist auf den Mandanten begrenzt.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, type AnyColumn } from "drizzle-orm";
import { shopPulseActions, shopPulseWeeklyReports, type ShopPulseActionRow, type ShopPulseWeeklyReportRow } from "@shared/schema";
import {
  SHOP_PULSE_ACTION_KINDS,
  SHOP_PULSE_ACTION_SCOPES,
  SHOP_PULSE_ACTION_SOURCES,
  type ShopPulseAction,
  type ShopPulseActionInput,
  type ShopPulseActionKind,
  type ShopPulseActionScopeType,
  type ShopPulseActionSource,
  type ShopPulseWeeklyReport,
  type ShopPulseWeeklyReportData,
} from "@shared/shopPulseWeekly";
import { isoWeekOf, normalizeActionScope } from "@shared/shopPulseWeekly";
import { db } from "../db";
import type { ActionCandidate } from "./actionLog";
import { newCandidates } from "./actionLog";
import { addDays } from "./pulseOrders";

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));
const oneOf = <T extends string>(list: readonly T[], v: string, fallback: T): T => ((list as readonly string[]).includes(v) ? (v as T) : fallback);
const CHUNK = 500;
/** Gelöschter automatischer Eintrag: Zeile bleibt mit Schlüssel stehen, damit der Abgleich ihn nicht neu anlegt */
const DELETED = "deleted";

export function rowToAction(row: ShopPulseActionRow): ShopPulseAction {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    kind: oneOf<ShopPulseActionKind>(SHOP_PULSE_ACTION_KINDS, row.kind, "manual"),
    title: row.title,
    description: row.description ?? "",
    scope: {
      type: oneOf<ShopPulseActionScopeType>(SHOP_PULSE_ACTION_SCOPES, row.scopeType, "shop"),
      values: Array.isArray(row.scopeValues) ? row.scopeValues.map(String) : [],
    },
    source: oneOf<ShopPulseActionSource>(SHOP_PULSE_ACTION_SOURCES, row.source, "manual"),
    sourceKey: row.sourceKey ?? null,
    actor: row.actor ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Einträge, neueste zuerst; mit from/to nur dieser Zeitraum (to ausschließlich) */
export async function listActions(tenantId: string | null, opts: { from?: Date; to?: Date; limit?: number } = {}): Promise<ShopPulseAction[]> {
  const conditions = [tenantIs(shopPulseActions.tenantId, tenantId), ne(shopPulseActions.kind, DELETED)];
  if (opts.from) conditions.push(gte(shopPulseActions.occurredAt, opts.from));
  if (opts.to) conditions.push(lt(shopPulseActions.occurredAt, opts.to));
  const rows = await db
    .select()
    .from(shopPulseActions)
    .where(and(...conditions))
    .orderBy(desc(shopPulseActions.occurredAt))
    .limit(opts.limit ?? 500);
  return rows.map(rowToAction);
}

/** Welche der Schlüssel es schon gibt */
export async function existingSourceKeys(tenantId: string | null, keys: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = Array.from(new Set(keys));
  for (let i = 0; i < unique.length; i += CHUNK) {
    const rows = await db
      .select({ key: shopPulseActions.sourceKey })
      .from(shopPulseActions)
      .where(and(tenantIs(shopPulseActions.tenantId, tenantId), isNotNull(shopPulseActions.sourceKey), inArray(shopPulseActions.sourceKey, unique.slice(i, i + CHUNK))));
    for (const r of rows) if (r.key) out.add(r.key);
  }
  return out;
}

/**
 * Automatische Einträge anlegen, die es noch nicht gibt (fester Schlüssel je Quelle). Der eindeutige Index
 * fängt gleichzeitige Läufe mit Mandant ab; liefert die neu angelegten Schlüssel.
 */
export async function insertCandidates(tenantId: string | null, candidates: ActionCandidate[]): Promise<string[]> {
  if (!candidates.length) return [];
  const fresh = newCandidates(candidates, await existingSourceKeys(tenantId, candidates.map((c) => c.sourceKey)));
  const inserted: string[] = [];
  for (let i = 0; i < fresh.length; i += 100) {
    const rows = await db
      .insert(shopPulseActions)
      .values(
        fresh.slice(i, i + 100).map((c) => ({
          tenantId,
          occurredAt: new Date(c.occurredAt),
          kind: c.kind,
          title: c.title.slice(0, 300),
          description: c.description.slice(0, 8000),
          scopeType: c.scope.type,
          scopeValues: c.scope.values,
          source: c.source,
          sourceKey: c.sourceKey,
          actor: c.actor,
          createdBy: null,
        })),
      )
      .onConflictDoNothing()
      .returning({ key: shopPulseActions.sourceKey });
    inserted.push(...rows.map((r) => r.key!).filter(Boolean));
  }
  return inserted;
}

const manualColumns = (input: ShopPulseActionInput) => {
  const scope = normalizeActionScope(input.scope);
  return {
    occurredAt: new Date(input.occurredAt),
    title: input.title,
    description: input.description,
    scopeType: scope.type,
    scopeValues: scope.values,
    actor: input.actor?.trim() || null,
  };
};

export async function createManualAction(tenantId: string | null, input: ShopPulseActionInput, by: string): Promise<ShopPulseAction> {
  const [row] = await db
    .insert(shopPulseActions)
    .values({ tenantId, kind: "manual", source: "manual", sourceKey: null, createdBy: by, ...manualColumns(input) })
    .returning();
  return rowToAction(row);
}

export async function getAction(tenantId: string | null, id: string): Promise<ShopPulseAction | undefined> {
  const rows = await db
    .select()
    .from(shopPulseActions)
    .where(and(eq(shopPulseActions.id, id), tenantIs(shopPulseActions.tenantId, tenantId), ne(shopPulseActions.kind, DELETED)))
    .limit(1);
  return rows[0] ? rowToAction(rows[0]) : undefined;
}

/**
 * Bearbeiten: Zeitpunkt, Titel, Beschreibung, Bereich, wer. Auch automatische Einträge (z. B. Bereich
 * ergänzen); Art, Quelle und Schlüssel bleiben, damit die Übernahme sie nicht neu anlegt.
 */
export async function updateAction(tenantId: string | null, id: string, input: ShopPulseActionInput): Promise<ShopPulseAction | undefined> {
  const rows = await db
    .update(shopPulseActions)
    .set({ ...manualColumns(input), updatedAt: new Date() })
    .where(and(eq(shopPulseActions.id, id), tenantIs(shopPulseActions.tenantId, tenantId), ne(shopPulseActions.kind, DELETED)))
    .returning();
  return rows[0] ? rowToAction(rows[0]) : undefined;
}

/**
 * Löschen. Von Hand eingetragene Einträge verschwinden ganz. Ein automatischer käme beim nächsten Abgleich
 * wieder; seine Zeile bleibt deshalb geleert mit Schlüssel stehen (Art "deleted") und ist überall ausgeblendet.
 */
export async function deleteAction(tenantId: string | null, id: string): Promise<boolean> {
  const existing = await getAction(tenantId, id);
  if (!existing) return false;
  const where = and(eq(shopPulseActions.id, id), tenantIs(shopPulseActions.tenantId, tenantId));
  if (!existing.sourceKey) {
    await db.delete(shopPulseActions).where(where);
  } else {
    await db.update(shopPulseActions).set({ kind: DELETED, title: "", description: "", scopeType: "shop", scopeValues: [], updatedAt: new Date() }).where(where);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Wochenberichte

export function rowToWeeklyReport(row: ShopPulseWeeklyReportRow): ShopPulseWeeklyReport {
  return {
    id: row.id,
    weekStart: row.weekStart,
    weekEnd: addDays(row.weekStart, 6),
    isoWeek: isoWeekOf(row.weekStart),
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    data: row.data as ShopPulseWeeklyReportData,
    ai: row.ai && typeof row.ai === "object" ? (row.ai as ShopPulseWeeklyReport["ai"]) : null,
  };
}

export async function listWeeklyReports(tenantId: string | null, limit = 104): Promise<ShopPulseWeeklyReport[]> {
  const rows = await db
    .select()
    .from(shopPulseWeeklyReports)
    .where(tenantIs(shopPulseWeeklyReports.tenantId, tenantId))
    .orderBy(desc(shopPulseWeeklyReports.weekStart))
    .limit(limit);
  return rows.map(rowToWeeklyReport);
}

export async function getWeeklyReport(tenantId: string | null, weekStart: string): Promise<ShopPulseWeeklyReport | undefined> {
  const rows = await db
    .select()
    .from(shopPulseWeeklyReports)
    .where(and(tenantIs(shopPulseWeeklyReports.tenantId, tenantId), eq(shopPulseWeeklyReports.weekStart, weekStart)))
    .limit(1);
  return rows[0] ? rowToWeeklyReport(rows[0]) : undefined;
}

/** Bericht einer Woche speichern (neu oder ersetzen); ein schon gesendeter behält seinen Sendezeitpunkt */
export async function saveWeeklyReport(
  tenantId: string | null,
  report: { weekStart: string; data: ShopPulseWeeklyReportData; ai: ShopPulseWeeklyReport["ai"]; sentAt: Date | null },
): Promise<ShopPulseWeeklyReport> {
  const existing = await getWeeklyReport(tenantId, report.weekStart);
  if (existing) {
    const [row] = await db
      .update(shopPulseWeeklyReports)
      .set({
        data: report.data,
        ai: report.ai,
        createdAt: new Date(),
        ...(report.sentAt ? { sentAt: report.sentAt } : {}),
      })
      .where(eq(shopPulseWeeklyReports.id, existing.id))
      .returning();
    return rowToWeeklyReport(row);
  }
  const [row] = await db
    .insert(shopPulseWeeklyReports)
    .values({ tenantId, weekStart: report.weekStart, data: report.data, ai: report.ai, sentAt: report.sentAt })
    .returning();
  return rowToWeeklyReport(row);
}
