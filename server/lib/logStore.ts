import type { InsertAppLog } from "@shared/schema";
import { LOG_LEVELS } from "@shared/logAreas";
import { areaForEntry } from "./logAreas";

/**
 * Systemprotokoll: der Logger schreibt jede Zeile zusaetzlich hierher (Abzweig in logger.ts).
 * Die Zeilen werden gefiltert, gepuffert und gebuendelt in app_logs geschrieben - Anfragen warten
 * nie auf die Datenbank. Bis zum Start (nach der Datenbank-Vorbereitung in index.ts) sammelt der
 * Puffer schon die Startmeldungen.
 *
 * Gespeichert wird ab Stufe info, ausser erfolgreichen Lese-Anfragen (GET/HEAD/OPTIONS unter 400,
 * auch 401 bei GET = nicht angemeldet): die waeren reines Rauschen. Aenderungen (POST/PATCH/...) mit
 * Benutzer und alle Fehler bleiben drin.
 * Kann die Datenbank nicht schreiben, gehen Eintraege verloren statt den Server zu bremsen; die Zahl
 * steht danach als eigener Eintrag im Protokoll. Eigene Fehler meldet der Speicher nur auf stderr
 * (nicht ueber den Logger - das waere eine Schleife).
 */

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Felder, die eigene Spalten haben oder nichts aussagen */
const COLUMN_FIELDS = new Set(["time", "level", "msg", "component", "area", "tenantId", "userId", "requestId", "pid", "hostname", "v"]);
const MAX_MSG = 2_000;
const MAX_DATA = 20_000;

export type ParsedLogLine = Record<string, unknown> & { level: number; time: string; msg: string };

function levelNumber(level: unknown): number | null {
  if (typeof level === "number" && Number.isFinite(level)) return level;
  if (typeof level === "string" && level in LOG_LEVELS) return LOG_LEVELS[level as keyof typeof LOG_LEVELS];
  return null;
}

/** Eine Zeile des Loggers (JSON) lesen; null bei allem, was kein Log-Eintrag ist */
export function parseLogLine(line: string): ParsedLogLine | null {
  const text = line.trim();
  if (!text.startsWith("{")) return null;
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(text);
  } catch {
    return null;
  }
  const level = levelNumber(record.level);
  if (level === null) return null;
  const time = typeof record.time === "number" ? new Date(record.time).toISOString() : String(record.time ?? new Date().toISOString());
  return { ...record, level, time, msg: typeof record.msg === "string" ? record.msg : "" };
}

const isRequestLine = (record: Record<string, unknown>) =>
  typeof record.method === "string" && typeof record.path === "string" && typeof record.status === "number" && typeof record.durationMs === "number";

export function shouldStoreLogLine(record: ParsedLogLine): boolean {
  if (record.level < LOG_LEVELS.info) return false;
  if (record.component === "lib/logStore") return false;
  if (isRequestLine(record) && record.level < LOG_LEVELS.warn) {
    const method = String(record.method).toUpperCase();
    const status = Number(record.status);
    if (READ_METHODS.has(method) && (status < 400 || status === 401)) return false;
  }
  return true;
}

/** Postgres nimmt kein \u0000 in text/jsonb */
const clean = (value: string) => value.replace(/\u0000/g, "");
const optionalText = (value: unknown) => (typeof value === "string" && value ? clean(value).slice(0, 200) : null);

export function logLineToRow(record: ParsedLogLine): InsertAppLog {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!COLUMN_FIELDS.has(key) && value !== undefined) rest[key] = value;
  }
  let data: unknown = Object.keys(rest).length ? rest : null;
  if (data) {
    const json = clean(JSON.stringify(data));
    data = json.length > MAX_DATA ? { truncated: true, preview: json.slice(0, MAX_DATA) } : JSON.parse(json);
  }
  const time = new Date(record.time);
  return {
    time: Number.isNaN(time.getTime()) ? new Date() : time,
    level: record.level,
    area: areaForEntry(record),
    component: optionalText(record.component) ?? optionalText(record.source),
    msg: clean(record.msg).slice(0, MAX_MSG),
    tenantId: optionalText(record.tenantId),
    userId: optionalText(record.userId),
    requestId: optionalText(record.requestId),
    data: data as InsertAppLog["data"],
  };
}

export type LogStoreOptions = { flushMs: number; maxBatch: number; maxBuffer: number };
const DEFAULTS: LogStoreOptions = { flushMs: 2_000, maxBatch: 500, maxBuffer: 5_000 };

export class LogStoreSink {
  private buffer: InsertAppLog[] = [];
  private dropped = 0;
  private insert: ((rows: InsertAppLog[]) => Promise<void>) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private lastFailureNote = 0;
  private readonly options: LogStoreOptions;

  constructor(options: Partial<LogStoreOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** pino ruft write je Eintrag mit einer JSON-Zeile auf */
  write(chunk: string): void {
    for (const line of String(chunk).split("\n")) {
      if (!line) continue;
      const record = parseLogLine(line);
      if (!record || !shouldStoreLogLine(record)) continue;
      let row: InsertAppLog;
      try {
        row = logLineToRow(record);
      } catch {
        continue;
      }
      this.buffer.push(row);
      if (this.buffer.length > this.options.maxBuffer) {
        this.buffer.shift();
        this.dropped++;
      }
    }
    if (this.insert && this.buffer.length >= this.options.maxBatch) void this.flush();
  }

  /** Ab jetzt in die Datenbank schreiben (vorher nur puffern) */
  start(insert: (rows: InsertAppLog[]) => Promise<void>): void {
    this.insert = insert;
    this.timer ??= setInterval(() => void this.flush(), this.options.flushMs);
    this.timer.unref?.();
    void this.flush();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
    this.insert = null;
  }

  get pending(): number {
    return this.buffer.length;
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushAll().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushAll(): Promise<void> {
    while (this.insert && (this.buffer.length > 0 || this.dropped > 0)) {
      const batch = this.buffer.splice(0, this.options.maxBatch);
      const entries = batch.length;
      const carried = this.dropped;
      if (carried > 0) {
        batch.push({
          time: new Date(),
          level: LOG_LEVELS.warn,
          area: "system",
          component: "lib/logStore",
          msg: `${carried} Protokolleinträge verworfen (Puffer voll oder Datenbank nicht erreichbar)`,
          data: { dropped: carried },
        });
        this.dropped = 0;
      }
      try {
        await this.insert(batch);
      } catch (error) {
        // verwerfen statt endlos puffern (bisherige Zahl bleibt erhalten); Hinweis hoechstens einmal pro Minute
        this.dropped += carried + entries;
        const now = Date.now();
        if (now - this.lastFailureNote > 60_000) {
          this.lastFailureNote = now;
          process.stderr.write(`[logStore] Schreiben in app_logs fehlgeschlagen: ${(error as Error)?.message ?? error}\n`);
        }
        return;
      }
    }
  }
}

let sink: LogStoreSink | null = null;

/** Abzweig fuer den Logger: aus bei LOG_STORE=off und in Tests (vitest) */
export function logStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LOG_STORE?.trim().toLowerCase() !== "off" && !env.VITEST;
}

export function getLogStoreSink(): LogStoreSink {
  return (sink ??= new LogStoreSink());
}

/** Aufbewahrung in Tagen (LOG_STORE_DAYS, 1-90, Standard 14) */
export function logStoreRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number(env.LOG_STORE_DAYS);
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 14;
}
