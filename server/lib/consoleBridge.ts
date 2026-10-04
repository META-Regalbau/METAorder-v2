import { format } from "node:util";
import type { Logger } from "pino";
import { getLogger } from "./logger";

/**
 * Leitet console.log/info/warn/error/debug in den zentralen Logger um, damit auch die
 * vielen bestehenden console-Aufrufe strukturiert und mit requestId/tenantId im Log landen.
 *
 * Der Text entsteht wie bei console (util.format, inkl. %s/%d/%o). Ein uebergebenes
 * Error-Objekt wird als Feld `err` (mit Stacktrace) geloggt und im Text durch seine
 * Meldung ersetzt - so bleibt z. B. console.error("Fehler:", err) vollstaendig erhalten.
 *
 * Neuer Code sollte direkt `logger` aus ./logger nutzen (Felder statt Text).
 */

const LEVEL_BY_METHOD = {
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
  debug: "debug",
} as const;

type Method = keyof typeof LEVEL_BY_METHOD;

let originals: Partial<Record<Method, (...args: unknown[]) => void>> | null = null;
let busy = false;

export function installConsoleBridge(getLog: () => Logger = getLogger): void {
  if (originals) return;
  const saved: Partial<Record<Method, (...args: unknown[]) => void>> = {};
  originals = saved;
  for (const method of Object.keys(LEVEL_BY_METHOD) as Method[]) {
    const level = LEVEL_BY_METHOD[method];
    const original = console[method];
    saved[method] = original;
    console[method] = (...args: unknown[]) => {
      // Schutz gegen Rekursion, falls der Logger selbst console nutzt
      if (busy) return original.apply(console, args);
      busy = true;
      try {
        const err = args.find((a): a is Error => a instanceof Error);
        const text = format(...args.map((a) => (err && a === err ? err.message : a)));
        const log = getLog();
        if (err) log[level]({ err }, "%s", text);
        else log[level]("%s", text);
      } finally {
        busy = false;
      }
    };
  }
}

/** Nur fuer Tests: urspruengliche console-Methoden wiederherstellen. */
export function uninstallConsoleBridge(): void {
  if (!originals) return;
  for (const [method, fn] of Object.entries(originals)) {
    (console as unknown as Record<string, unknown>)[method] = fn;
  }
  originals = null;
}
