/**
 * CPQ-Verwaltung uebersetzt (de/en/es): Admin-Seite, Pruefwarteschlange und die CPQ-Bausteine
 * (Freigabe und Rabatt-Ampel erscheinen auch in den Angebots-Dialogen) waren nur deutsch.
 * Statische Pruefung: kein sichtbarer Text mehr direkt im Code. Ob die Schluessel in allen
 * Sprachen existieren, prueft i18nKeys.test.ts.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const CLIENT = path.join(ROOT, "client/src");
const FILES = [
  "pages/CPQAdminPage.tsx",
  "pages/CPQReviewQueuePage.tsx",
  ...fs.readdirSync(path.join(CLIENT, "components/cpq")).filter((f) => f.endsWith(".tsx")).map((f) => `components/cpq/${f}`),
];

/** Kommentare (auch JSX-Kommentare) durch Leerzeichen ersetzen, Zeilen bleiben. */
const withoutComments = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, (m, p) => p + " ".repeat(m.length - p.length));

/** Technische Platzhalter ohne Sprache (Beispiel-Slug, Pfad) */
const ALLOWED_PROPS = new Set(["meta-clip", "/cpq-models/..."]);

function findings(rel: string): string[] {
  const src = withoutComments(fs.readFileSync(path.join(CLIENT, rel), "utf8"));
  const line = (i: number) => src.slice(0, i).split("\n").length;
  const out: string[] = [];
  // JSX-Text zwischen Tags (Codeteile wie ") : x ? (" ausgenommen)
  for (const m of src.matchAll(/>([^<>{}]*[A-Za-zÄÖÜäöüß]{2,}[^<>{}]*)</g)) {
    const text = m[1].trim();
    if (text && !/[()=;?&|]/.test(text)) out.push(`${rel}:${line(m.index!)} Text "${text}"`);
  }
  // sichtbare Attribute mit festem Text
  for (const m of src.matchAll(/\b(placeholder|title|aria-label|alt|label|heading|description)=["']([^"']*[A-Za-zÄÖÜäöüß]{2,}[^"']*)["']/g)) {
    if (!ALLOWED_PROPS.has(m[2])) out.push(`${rel}:${line(m.index!)} ${m[1]}="${m[2]}"`);
  }
  // deutsche Zeichen in Zeichenketten (Schluessel enthalten keine)
  for (const m of src.matchAll(/["'`]([^"'`\n]*[äöüÄÖÜß][^"'`\n]*)["'`]/g)) out.push(`${rel}:${line(m.index!)} "${m[1]}"`);
  // Text in Ausdruecken: {x && "Wartet auf Freigabe"}, cond ? "Freigegeben" : ..., label: "Systeme"
  for (const m of src.matchAll(/(?:&&|\?|:)\s*"([A-ZÄÖÜ][a-zäöüß]{3,}(?: [A-Za-zÄÖÜäöüß]+)*)"/g)) out.push(`${rel}:${line(m.index!)} "${m[1]}"`);
  return out;
}

describe("CPQ-Verwaltung ohne festen Text", () => {
  it("alle CPQ-Dateien", () => {
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES.flatMap(findings)).toEqual([]);
  });

  it("Abzeichen zeigen beschriftete Werte statt roher Datenbankwerte", () => {
    const admin = fs.readFileSync(path.join(CLIENT, "pages/CPQAdminPage.tsx"), "utf8");
    for (const raw of ["{sys.status}", "{m.status}", "{r.type}", "{r.status}", "{dl.approvalType}", "{dl.status}"]) {
      expect(admin, raw).not.toContain(`>${raw}</Badge>`);
    }
    expect(admin).toContain("label(statusLabels, sys.status)");
    expect(admin).toContain("label(approvalStatusLabels, e.approvalStatus || \"pending\")");
  });

  it("Pruefwarteschlange in der Navigation uebersetzt", () => {
    const sidebar = fs.readFileSync(path.join(CLIENT, "components/AppSidebar.tsx"), "utf8");
    expect(sidebar).toContain('titleKey: "nav.cpqReviewQueue"');
    expect(sidebar).not.toContain('titleKey: "CPQ Review Queue"');
  });
});
