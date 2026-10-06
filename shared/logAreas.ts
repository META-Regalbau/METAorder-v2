/**
 * Bereiche des Systemprotokolls (Feld `area` je Log-Eintrag). Server ordnet Module und API-Pfade
 * zu (server/lib/logAreas.ts), der Viewer filtert und beschriftet danach (logs.areas.<id>).
 */
export const LOG_AREAS = [
  "orders",
  "offers",
  "drafts",
  "shopware",
  "b2b",
  "crm",
  "products",
  "cpq",
  "crossSelling",
  "erp",
  "shipping",
  "invoicing",
  "email",
  "integration",
  "automation",
  "tickets",
  "ai",
  "analytics",
  "auth",
  "settings",
  "system",
] as const;

export type LogArea = (typeof LOG_AREAS)[number];

export function isLogArea(value: unknown): value is LogArea {
  return typeof value === "string" && (LOG_AREAS as readonly string[]).includes(value);
}

/** pino-Stufen als Zahl (so in app_logs gespeichert) */
export const LOG_LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const;
export type LogLevelName = keyof typeof LOG_LEVELS;

export function logLevelName(level: number): LogLevelName {
  if (level >= 60) return "fatal";
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  if (level >= 20) return "debug";
  return "trace";
}
