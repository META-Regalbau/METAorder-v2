import { createRequire } from "node:module";
import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";
import { getRequestId } from "./requestContext";
import { getTenantIdFromContext } from "./tenantContext";

/**
 * Zentraler Logger (pino).
 *
 * - Produktion: eine JSON-Zeile je Eintrag (time, level, msg, requestId, tenantId, Felder).
 * - Entwicklung: lesbare Zeilen (pino-pretty, nur als devDependency vorhanden).
 * - Steuerung: LOG_LEVEL (trace|debug|info|warn|error|fatal, Standard info),
 *   LOG_FORMAT (json|pretty, Standard: pretty bei NODE_ENV=development, sonst json).
 *
 * Erst beim ersten Gebrauch erzeugt: index.ts laedt .env erst nach den Imports.
 * Bestehende console.*-Aufrufe leitet ./consoleBridge hierher um.
 */

const REDACT_PATHS = [
  "password", "*.password", "newPassword", "*.newPassword",
  "token", "*.token", "accessToken", "*.accessToken", "refreshToken", "*.refreshToken",
  "apiKey", "*.apiKey", "apiSecret", "*.apiSecret", "secret", "*.secret",
  "authorization", "*.authorization", "cookie", "*.cookie",
  "headers.authorization", "headers.cookie", "*.headers.authorization", "*.headers.cookie",
  // express.json() haengt bei kaputtem JSON den rohen Body an den Fehler - z. B. ein Login mit Passwort
  "err.body",
];

export type LogFormat = "json" | "pretty";

export function resolveLogFormat(env: NodeJS.ProcessEnv = process.env): LogFormat {
  const raw = env.LOG_FORMAT?.trim().toLowerCase();
  if (raw === "json" || raw === "pretty") return raw;
  return env.NODE_ENV === "development" ? "pretty" : "json";
}

export function createLogger(opts: { level?: string; format?: LogFormat; destination?: DestinationStream } = {}): Logger {
  const format = opts.format ?? resolveLogFormat();
  const options: LoggerOptions = {
    level: opts.level ?? (process.env.LOG_LEVEL?.trim() || "info"),
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    // Kontext der laufenden Anfrage bzw. des Mandanten automatisch an jede Zeile haengen
    mixin() {
      const context: Record<string, string> = {};
      const requestId = getRequestId();
      if (requestId) context.requestId = requestId;
      const tenantId = getTenantIdFromContext();
      if (tenantId) context.tenantId = tenantId;
      return context;
    },
  };

  if (format === "pretty" && !opts.destination) {
    const pretty = loadPinoPretty();
    if (pretty) {
      return pino(options, pretty({
        colorize: true,
        sync: true,
        translateTime: "HH:MM:ss",
        // Request-Felder stehen schon in der Nachricht ("GET /api/x 200 in 12ms")
        ignore: "requestId,tenantId,userId,method,path,status,durationMs",
        messageFormat: (log: Record<string, unknown>, messageKey: string) => {
          const rid = typeof log.requestId === "string" ? `[${log.requestId.slice(0, 8)}] ` : "";
          return `${rid}${String(log[messageKey] ?? "")}`;
        },
      }));
    }
  }

  // JSON: Level als Text ("info" statt 30) - lesbarer in Log-Ansichten ohne Werkzeug
  options.formatters = { level: (label) => ({ level: label }) };
  // Synchron nach stdout wie console: auch die letzten Zeilen vor einem Absturz landen im Log
  return pino(options, opts.destination ?? pino.destination({ dest: 1, sync: true }));
}

function loadPinoPretty(): ((options: Record<string, unknown>) => DestinationStream) | null {
  try {
    const require = createRequire(import.meta.url);
    return require("pino-pretty");
  } catch {
    // In der Produktion (devDependencies entfernt) bleibt es bei JSON.
    return null;
  }
}

let instance: Logger | null = null;

export function getLogger(): Logger {
  return (instance ??= createLogger());
}

/** Nur fuer Tests: eigenen Logger setzen bzw. zuruecksetzen. */
export function setLoggerForTests(logger: Logger | null): void {
  instance = logger;
}

type LogFn = Logger["info"];
const delegate = (level: "trace" | "debug" | "info" | "warn" | "error" | "fatal"): LogFn =>
  ((...args: Parameters<LogFn>) => getLogger()[level](...args)) as LogFn;

/** Strukturiert loggen: logger.info({ orderId }, "Bestellung angelegt"), logger.error({ err }, "...") */
export const logger = {
  trace: delegate("trace"),
  debug: delegate("debug"),
  info: delegate("info"),
  warn: delegate("warn"),
  error: delegate("error"),
  fatal: delegate("fatal"),
  child: (bindings: Record<string, unknown>) => getLogger().child(bindings),
};
