/**
 * Barrierefreiheit: Bedienelemente brauchen einen Namen fuer Screenreader (axe: button-name, label,
 * select-name) - sonst liest der Screenreader nur "Schaltflaeche", "Auswahl" oder "Eingabefeld".
 * Statische Pruefung des Client-Codes; laeuft in der CI (die Playwright-Pruefung mit axe nicht).
 * - Schaltflaechen nur mit Symbol (Button size="icon")
 * - Schaltflaechen, deren Text auf kleinen Bildschirmen per "hidden sm:inline" verschwindet
 *   (am Handy sonst ohne Namen; stattdessen "sr-only sm:not-sr-only")
 * - Auswahlfelder (SelectTrigger): Rolle combobox, der Name kommt nie aus dem angezeigten Wert
 * - Eingabefelder (Input, input, Textarea, textarea, select)
 * - Schalter und Kontrollkaestchen (Switch, Checkbox aus components/ui; der Text daneben ist kein Name)
 * Als Name gelten aria-label/aria-labelledby, eine id (verknuepftes <Label htmlFor>), FormControl
 * (react-hook-form verknuepft FormLabel), bei Eingabefeldern auch placeholder, bei Schaltern ein
 * umschliessendes <label>.
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
function tags(pattern: RegExp, closing?: string, onlyIfImported?: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles(path.join(ROOT, "client/src"))) {
    const src = withoutComments(fs.readFileSync(file, "utf8"));
    if (onlyIfImported && !onlyIfImported.test(src)) continue;
    for (const m of src.matchAll(pattern)) {
      const end = openingTagEnd(src, m.index! + m[0].length);
      const tag = src.slice(m.index!, end + 1);
      const close = closing && !tag.endsWith("/>") ? src.indexOf(closing, end) : -1;
      hits.push({
        file: path.relative(ROOT, file),
        line: src.slice(0, m.index).split("\n").length,
        tag,
        body: close === -1 ? "" : src.slice(end + 1, close),
        before: src.slice(Math.max(0, m.index! - 400), m.index),
      });
    }
  }
  return hits;
}

const NAMED = /aria-label|aria-labelledby|\bid=/;

/** Hat die Schaltflaeche einen Namen? Sichtbarer Text ohne Tags und JSX-Ausdruecke (ausser t("...")). */
function buttonHasName(tag: string, body: string): boolean {
  let text = body;
  for (let prev = ""; prev !== text; ) {
    prev = text;
    text = text.replace(/\{(?![^{}]*\bt\()[^{}]*\}/g, "");
  }
  text = text.replace(/<[^>]*>/g, "");
  return /aria-label|aria-labelledby|title=/.test(tag) || /sr-only|aria-label=/.test(body) || /\{t\(|[A-Za-zÄÖÜäöü]{3,}/.test(text);
}

/** Elemente, die erst ab einer Breite sichtbar werden (className="hidden sm:inline" usw.), samt Inhalt. */
const RESPONSIVE_HIDDEN = /<(\w+)\b[^>]*className="[^"]*(?<![\w:-])hidden (?:sm|md|lg|xl):[^"]*"[^>]*>[\s\S]*?<\/\1>/g;
const where = (h: Hit) => `${h.file}:${h.line}`;

describe("Barrierefreiheit: Namen fuer Bedienelemente", () => {
  it("Schaltflaechen nur mit Symbol", () => {
    const missing = tags(/<Button\b/g, "</Button>")
      .filter((h) => /size="icon"/.test(h.tag) && !h.tag.endsWith("/>"))
      // sichtbarer Text: Variablen wie {isOpen ? ...} sind kein Text, Uebersetzungen {t("...")} schon
      .filter((h) => !buttonHasName(h.tag, h.body))
      .map(where);
    expect(missing).toEqual([]);
  });

  it("Schaltflaechen mit Text nur auf breiten Bildschirmen", () => {
    const missing = tags(/<Button\b/g, "</Button>")
      .filter((h) => !h.tag.endsWith("/>") && new RegExp(RESPONSIVE_HIDDEN.source).test(h.body))
      // am Handy bleibt, was nicht in einem "hidden sm:..."-Element steht
      .filter((h) => !buttonHasName(h.tag, h.body.replace(RESPONSIVE_HIDDEN, "")))
      .map(where);
    expect(missing).toEqual([]);
  });

  it("Auswahlfelder (SelectTrigger)", () => {
    const missing = tags(/<SelectTrigger\b/g)
      .filter((h) => !NAMED.test(h.tag) && !h.before.slice(-120).includes("<FormControl>"))
      .map(where);
    expect(missing).toEqual([]);
  });

  it("Eingabefelder", () => {
    const missing = tags(/<(Input|input|Textarea|textarea|select)\b/g)
      .filter((h) => !/type="(hidden|checkbox|radio|submit)"|className="(hidden|sr-only)"|\bhidden\b|placeholder=/.test(h.tag))
      .filter((h) => !NAMED.test(h.tag) && !h.before.slice(-120).includes("<FormControl>"))
      .map(where);
    expect(missing).toEqual([]);
  });

  it("Schalter und Kontrollkaestchen", () => {
    const fromUi = (name: string) => new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "@/components/ui/`);
    const missing = [
      ...tags(/<Switch\b/g, undefined, fromUi("Switch")),
      ...tags(/<Checkbox\b/g, undefined, fromUi("Checkbox")),
    ]
      .filter((h) => !NAMED.test(h.tag) && !h.before.slice(-120).includes("<FormControl>"))
      // umschliessendes <label> ohne schliessendes dazwischen
      .filter((h) => h.before.lastIndexOf("<label") <= h.before.lastIndexOf("</label>"))
      .map(where);
    expect(missing).toEqual([]);
  });
});
