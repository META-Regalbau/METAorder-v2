import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { appLogs, users, type InsertAppLog } from "@shared/schema";
import { LOG_LEVELS, type LogArea } from "@shared/logAreas";
import { db } from "../db";

/**
 * Datenbankzugriff fuer das Systemprotokoll (app_logs): Schreiben (gebuendelt aus logStore.ts),
 * Abfragen fuer den Viewer, Zaehlen je Bereich und Aufraeumen nach Aufbewahrungsfrist.
 */

export async function insertAppLogs(rows: InsertAppLog[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(appLogs).values(rows);
}

export type AppLogQuery = {
  /** Mandant des Admins; null = nur Systemmeldungen */
  tenantId: string | null;
  /** Systemmeldungen (ohne Mandant) mit anzeigen */
  includeSystem: boolean;
  from?: Date;
  to?: Date;
  minLevel?: number;
  areas?: LogArea[];
  /** Text in Meldung oder Feldern (z. B. Bestellnummer) */
  q?: string;
  requestId?: string;
  userId?: string;
  /** Blaettern: nur Eintraege mit kleinerer id */
  beforeId?: number;
  limit: number;
};

export function tenantScope(tenantId: string | null, includeSystem: boolean): SQL | undefined {
  if (!tenantId) return isNull(appLogs.tenantId);
  return includeSystem ? or(eq(appLogs.tenantId, tenantId), isNull(appLogs.tenantId)) : eq(appLogs.tenantId, tenantId);
}

/** % und _ im Suchtext woertlich nehmen */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function appLogConditions(query: Omit<AppLogQuery, "limit" | "beforeId"> & { beforeId?: number }): SQL[] {
  const conditions: Array<SQL | undefined> = [tenantScope(query.tenantId, query.includeSystem)];
  if (query.from) conditions.push(gte(appLogs.time, query.from));
  if (query.to) conditions.push(lte(appLogs.time, query.to));
  if (query.minLevel) conditions.push(gte(appLogs.level, query.minLevel));
  if (query.areas?.length) conditions.push(inArray(appLogs.area, query.areas));
  if (query.requestId) conditions.push(eq(appLogs.requestId, query.requestId));
  if (query.userId) conditions.push(eq(appLogs.userId, query.userId));
  if (query.beforeId) conditions.push(lt(appLogs.id, query.beforeId));
  if (query.q) {
    const pattern = likePattern(query.q);
    conditions.push(sql`(${appLogs.msg} ILIKE ${pattern} OR ${appLogs.data}::text ILIKE ${pattern})`);
  }
  return conditions.filter((c): c is SQL => Boolean(c));
}

export async function queryAppLogs(query: AppLogQuery) {
  return db
    .select({
      id: appLogs.id,
      time: appLogs.time,
      level: appLogs.level,
      area: appLogs.area,
      component: appLogs.component,
      msg: appLogs.msg,
      tenantId: appLogs.tenantId,
      userId: appLogs.userId,
      userName: users.username,
      requestId: appLogs.requestId,
      data: appLogs.data,
    })
    .from(appLogs)
    .leftJoin(users, eq(users.id, appLogs.userId))
    .where(and(...appLogConditions(query)))
    .orderBy(desc(appLogs.id))
    .limit(query.limit);
}

/** Warnungen und Fehler je Bereich seit `since` */
export async function appLogStats(query: { tenantId: string | null; includeSystem: boolean; since: Date }) {
  return db
    .select({
      area: appLogs.area,
      warn: sql<number>`count(*) filter (where ${appLogs.level} < ${LOG_LEVELS.error})`.mapWith(Number),
      error: sql<number>`count(*) filter (where ${appLogs.level} >= ${LOG_LEVELS.error})`.mapWith(Number),
    })
    .from(appLogs)
    .where(and(tenantScope(query.tenantId, query.includeSystem), gte(appLogs.time, query.since), gte(appLogs.level, LOG_LEVELS.warn)))
    .groupBy(appLogs.area);
}

/** Eintraege vor `before` loeschen, in Paketen (keine langen Sperren); liefert die Anzahl */
export async function pruneAppLogs(before: Date, batchSize = 10_000): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(
      sql`DELETE FROM app_logs WHERE id IN (SELECT id FROM app_logs WHERE time < ${before} LIMIT ${batchSize})`,
    );
    const deleted = Number((result as { rowCount?: number | null }).rowCount ?? 0);
    total += deleted;
    if (deleted < batchSize) return total;
  }
}
