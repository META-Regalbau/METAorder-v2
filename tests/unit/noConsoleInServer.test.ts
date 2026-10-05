/**
 * Server loggt ueber den zentralen Logger (server/lib/logger.ts), je Modul mit Komponente:
 * logger.child({ component: "routes/orderRoutes" }), Fehler als Feld err (mit Stacktrace), Werte als
 * Felder. Vorher ~1.284 console.*-Aufrufe, die nur ueber die console-Bruecke als Text im Log landeten.
 * Die Bruecke bleibt fuer console-Ausgaben von Bibliotheken.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const ALLOWED = new Set(["server/lib/consoleBridge.ts", "server/lib/logger.ts"]);

function serverFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return serverFiles(p);
    return entry.name.endsWith(".ts") ? [p] : [];
  });
}
/** Code ohne Kommentare */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("Logging im Server", () => {
  const files = serverFiles(path.join(ROOT, "server")).map((f) => path.relative(ROOT, f));

  it("kein console.* ausser in der Bruecke (neuer Code: Modul-Logger)", () => {
    const offenders = files
      .filter((f) => !ALLOWED.has(f))
      .flatMap((f) =>
        code(fs.readFileSync(path.join(ROOT, f), "utf8"))
          .split("\n")
          .map((line, i) => (/\bconsole\.(log|info|warn|error|debug)\(/.test(line) ? `${f}:${i + 1}` : null))
          .filter(Boolean),
      );
    expect(offenders).toEqual([]);
  });

  it("Modul-Logger mit Komponente = Dateipfad unter server/", () => {
    const withChild = files.filter((f) => /logger\.child\(\{ component: "/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(withChild.length).toBeGreaterThan(100);
    for (const f of withChild) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      const component = src.match(/logger\.child\(\{ component: "([^"]+)" \}\)/)?.[1];
      // einige Module hatten schon eigene Komponenten (z. B. "shopware-mirror"); neue heissen wie die Datei
      if (component && component.includes("/")) expect(component).toBe(f.replace(/^server\//, "").replace(/\.ts$/, ""));
    }
  });
});
