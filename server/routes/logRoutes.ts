// Systemprotokoll fuer Administratoren: Log-Eintraege aus app_logs filtern, Warnungen/Fehler je Bereich
import type { Express, Request, Response } from "express";
import { isLogArea, LOG_LEVELS, logLevelName, type LogArea } from "@shared/logAreas";
import { requireAdministrator, requireAuth } from "../auth/auth";
import { appLogStats, queryAppLogs } from "../lib/appLogRepository";
import { logStoreRetentionDays } from "../lib/logStore";
import { logger } from "../lib/logger";

const log = logger.child({ component: "routes/logRoutes" });

const MIN_LEVEL: Record<string, number> = { info: LOG_LEVELS.info, warn: LOG_LEVELS.warn, error: LOG_LEVELS.error };
const HOUR = 60 * 60 * 1000;

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const positiveInt = (value: unknown) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};
const clamp = (value: number | undefined, min: number, max: number, fallback: number) =>
  value === undefined ? fallback : Math.min(max, Math.max(min, value));
const date = (value: unknown) => {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/** Filter aus der Adresse; Zeitraum: from/to oder die letzten `hours` (hoechstens die Aufbewahrungsfrist) */
export function parseLogQuery(query: Request["query"], tenantId: string | null) {
  const maxHours = logStoreRetentionDays() * 24;
  const to = date(query.to);
  const from = date(query.from) ?? new Date((to?.getTime() ?? Date.now()) - clamp(positiveInt(query.hours), 1, maxHours, 24) * HOUR);
  const areas = String(query.areas ?? "")
    .split(",")
    .map((area) => area.trim())
    .filter(isLogArea) as LogArea[];
  return {
    tenantId,
    includeSystem: query.system !== "0",
    from,
    to,
    minLevel: MIN_LEVEL[String(query.level ?? "info")] ?? LOG_LEVELS.info,
    areas,
    q: text(query.q, 200),
    requestId: text(query.requestId, 100),
    userId: text(query.userId, 100),
    beforeId: positiveInt(query.before),
    limit: clamp(positiveInt(query.limit), 1, 500, 200),
  };
}

export function registerLogRoutes(app: Express): void {
  app.get("/api/admin/logs", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      const query = parseLogQuery(req.query, (req as any).tenantId ?? null);
      const rows = await queryAppLogs(query);
      res.json({
        entries: rows.map((row) => ({
          ...row,
          time: row.time instanceof Date ? row.time.toISOString() : row.time,
          levelName: logLevelName(row.level),
        })),
        nextBefore: rows.length === query.limit ? rows[rows.length - 1].id : null,
        from: query.from.toISOString(),
        retentionDays: logStoreRetentionDays(),
      });
    } catch (error: any) {
      log.error({ err: error }, "Systemprotokoll konnte nicht gelesen werden");
      res.status(500).json({ error: "Systemprotokoll konnte nicht gelesen werden" });
    }
  });

  app.get("/api/admin/logs/stats", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      const hours = clamp(positiveInt(req.query.hours), 1, logStoreRetentionDays() * 24, 24);
      const since = new Date(Date.now() - hours * HOUR);
      const rows = await appLogStats({ tenantId: (req as any).tenantId ?? null, includeSystem: req.query.system !== "0", since });
      const areas = rows
        .filter((row) => isLogArea(row.area))
        .sort((a, b) => b.error - a.error || b.warn - a.warn || a.area.localeCompare(b.area));
      res.json({
        since: since.toISOString(),
        areas,
        totals: areas.reduce((sum, row) => ({ warn: sum.warn + row.warn, error: sum.error + row.error }), { warn: 0, error: 0 }),
      });
    } catch (error: any) {
      log.error({ err: error }, "Systemprotokoll: Zählung fehlgeschlagen");
      res.status(500).json({ error: "Systemprotokoll konnte nicht gelesen werden" });
    }
  });
}
