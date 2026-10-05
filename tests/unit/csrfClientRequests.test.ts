/**
 * Schreibende Aufrufe aus dem Client brauchen den X-CSRF-Token-Header: server/index.ts prueft jeden
 * POST/PUT/PATCH/DELETE (Double-Submit: Header == Cookie csrf_token), ausser Login, Notfall-Reset,
 * Integrations-Key und /api/public/. Ein rohes fetch ohne Header endet mit 403 "CSRF token missing" -
 * so beim ERP-Automatisierungs-Ausloeser, Ticket aus E-Mail, E-Mail-Dropzone, CPQ-Cross-Selling im
 * Angebotsentwurf und Ticket-Export. Normalweg ist apiRequest (lib/queryClient.ts), das den Header setzt.
 * Statische Pruefung: jedes fetch mit schreibender Methode traegt den Token im Options-Objekt
 * oder baut seine Header als Variable/Funktion in einer Datei, die den Token liest.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const CLIENT = path.join(ROOT, "client/src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Options-Objekt eines fetch-Aufrufs ab der oeffnenden Klammer bis zur passenden schliessenden. */
function objectAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

function fetchesWithoutCsrf(src: string): Array<{ line: number; url: string }> {
  const fileReadsToken = /csrf/i.test(src);
  const found: Array<{ line: number; url: string }> = [];
  const re = /\bfetch\(\s*([^,()]+?),\s*\{/g;
  for (let m; (m = re.exec(src)); ) {
    const url = m[1].trim();
    const options = objectAt(src, m.index + m[0].length - 1);
    const method = options.match(/\bmethod:\s*([^,\n}]+)/)?.[1] ?? "";
    if (!/POST|PUT|PATCH|DELETE/.test(method)) continue;
    if (/^["'`]\/api\/public\//.test(url)) continue; // ohne CSRF-Pruefung (Link-Token)
    if (/csrf/i.test(options)) continue;
    const headers = options.match(/\bheaders(?:\s*:\s*([^,\n}]+))?/);
    const headersFromVariable = headers && !headers[1]?.trim().startsWith("{");
    if (headersFromVariable && fileReadsToken) continue;
    found.push({ line: src.slice(0, m.index).split("\n").length, url });
  }
  return found;
}

describe("CSRF-Token bei schreibenden fetch-Aufrufen im Client", () => {
  it("kein schreibendes fetch ohne X-CSRF-Token", () => {
    const found = sourceFiles(CLIENT).flatMap((file) =>
      fetchesWithoutCsrf(fs.readFileSync(file, "utf8")).map(
        ({ line, url }) => `${path.relative(ROOT, file)}:${line} ${url}`,
      ),
    );
    expect(found).toEqual([]);
  });

  it("erkennt den alten Ausloeser und laesst gueltige Formen durch", () => {
    const old = `await fetch('/api/erp-automation/trigger', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });`;
    expect(fetchesWithoutCsrf(old)).toHaveLength(1);
    expect(fetchesWithoutCsrf(`fetch("/api/x", { method: "DELETE" })`)).toHaveLength(1);

    const inline = `fetch("/api/x", { method: "POST", headers: { "X-CSRF-Token": t } })`;
    const variable = `const csrf = getCsrfToken(); fetch("/api/x", { method: "POST", headers });`;
    const read = `fetch("/api/x", { credentials: "include" })`;
    const pub = "fetch(`/api/public/offers/${t}/accept`, { method: \"POST\" })";
    for (const src of [inline, variable, read, pub]) expect(fetchesWithoutCsrf(src), src).toEqual([]);
  });
});
