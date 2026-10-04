/**
 * Barrierefreiheit: Bedienelemente brauchen einen Namen fuer Screenreader (axe: button-name, label,
 * select-name) - sonst liest der Screenreader nur "Schaltflaeche", "Auswahl" oder "Eingabefeld".
 * Statische Pruefung des Client-Codes; laeuft in der CI (die Playwright-Pruefung mit axe nicht).
 * - Schaltflaechen nur mit Symbol (Button size="icon")
 * - Auswahlfelder (SelectTrigger): Rolle combobox, der Name kommt nie aus dem angezeigten Wert
 * - Eingabefelder (Input, input, Textarea, textarea, select)
 * Als Name gelten aria-label/aria-labelledby, eine id (verknuepftes <Label htmlFor>), FormControl
 * (react-hook-form verknuepft FormLabel), bei Eingabefeldern auch placeholder.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "examples" || e.name === "ui" ? [] : sourceFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

/** Kommentare durch Leerzeichen ersetzen (Zeilennummern bleiben), damit "<input>" in Kommentaren nicht zaehlt. */
const withoutComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, (c) => " ".repeat(c.length));

/** Oeffnendes Tag bis zum ">" auf Klammerebene 0 (Props koennen ">" in Ausdruecken enthalten). */
function openingTagEnd(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return src.length;
}

type Hit = { file: string; line: number; tag: string; body: string; before: string };
function tags(pattern: RegExp, closing?: string): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles(path.join(ROOT, "client/src"))) {
    const src = withoutComments(fs.readFileSync(file, "utf8"));
    for (const m of src.matchAll(pattern)) {
      const end = openingTagEnd(src, m.index! + m[0].length);
      const tag = src.slice(m.index!, end + 1);
      const close = closing && !tag.endsWith("/>") ? src.indexOf(closing, end) : -1;
      hits.push({
        file: path.relative(ROOT, file),
        line: src.slice(0, m.index).split("\n").length,
        tag,
        body: close === -1 ? "" : src.slice(end + 1, close),
        before: src.slice(Math.max(0, m.index! - 120), m.index),
      });
    }
  }
  return hits;
}

const NAMED = /aria-label|aria-labelledby|\bid=/;
const where = (h: Hit) => `${h.file}:${h.line}`;

describe("Barrierefreiheit: Namen fuer Bedienelemente", () => {
  it("Schaltflaechen nur mit Symbol", () => {
    const missing = tags(/<Button\b/g, "</Button>")
      .filter((h) => /size="icon"/.test(h.tag) && !h.tag.endsWith("/>"))
      .filter((h) => {
        // sichtbarer Text: ohne Tags und JSX-Ausdruecke (Variablen wie {isOpen ? ...} sind kein Text),
        // ausser Uebersetzungen {t("...")}
        let text = h.body;
        for (let prev = ""; prev !== text; ) {
          prev = text;
          text = text.replace(/\{(?![^{}]*\bt\()[^{}]*\}/g, "");
        }
        text = text.replace(/<[^>]*>/g, "");
        const labelled =
          /aria-label|aria-labelledby|title=/.test(h.tag) ||
          /sr-only|aria-label=/.test(h.body) ||
          /\{t\(|[A-Za-zÄÖÜäöü]{3,}/.test(text);
        return !labelled;
      })
      .map(where);
    expect(missing).toEqual([]);
  });

  it("Auswahlfelder (SelectTrigger)", () => {
    const missing = tags(/<SelectTrigger\b/g)
      .filter((h) => !NAMED.test(h.tag) && !h.before.includes("<FormControl>"))
      .map(where);
    expect(missing).toEqual([]);
  });

  it("Eingabefelder", () => {
    const missing = tags(/<(Input|input|Textarea|textarea|select)\b/g)
      .filter((h) => !/type="(hidden|checkbox|radio|submit)"|className="(hidden|sr-only)"|\bhidden\b|placeholder=/.test(h.tag))
      .filter((h) => !NAMED.test(h.tag) && !h.before.includes("<FormControl>"))
      .map(where);
    expect(missing).toEqual([]);
  });
});
