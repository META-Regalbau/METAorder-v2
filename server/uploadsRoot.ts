import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Projektroot: über `server/` in Entwicklung; ein Verzeichnis über `dist/`, wenn dieser Code
 * im gebündelten `dist/index.js` läuft (import.meta.url zeigt dann auf die Ausgabedatei).
 */
export const APP_ROOT = path.resolve(here, "..");

function resolveUploadsRoot(): string {
  const fromEnv = process.env.UPLOADS_DIR?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(APP_ROOT, "uploads");
}

let memo: string | null = null;

/**
 * Lazy, damit Werte aus `.env` geladen sind, bevor der Pfad das erste Mal gebraucht wird
 * (statische Imports laufen vor dem `loadEnv()`-Block in `index.ts`).
 */
export function getUploadsRoot(): string {
  if (memo === null) {
    memo = resolveUploadsRoot();
    if (process.env.NODE_ENV === "production") {
      console.log(`[METAorder] UPLOADS_ROOT=${memo}`);
    }
  }
  return memo;
}
