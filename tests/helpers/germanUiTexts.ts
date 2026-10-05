/**
 * Fest deutsche Texte im Client (fuer noGermanUiTexts.test.ts): Zeichenketten und JSX-Text, die nach
 * deutschem Oberflaechentext aussehen und nicht in t()/i18next.t() bzw. console.* stehen.
 * Per TypeScript-Parser; Kommentare, Importe, className, data-testid usw. zaehlen nicht.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export type GermanText = { file: string; line: number; text: string };

const GERMAN =
  /[äöüßÄÖÜ]|\b(nicht|keine?n?|wird|wurde|werden|bitte|Bitte|laden|Laden|Zurück|zurück|Speichern|speichern|Abbrechen|Löschen|löschen|Fehler|fehlgeschlagen|ausgewählt|Vorschau|gefunden|erfolgreich|Kunde|Kunden|Bestellung|Bestellungen|Angebot|Angebote|Hinzufügen|Bearbeiten|Schließen|Suche|Alle|und|oder|für|mit|ist|sind|eine?r?|der|die|das|den|dem|des|Stück|Datei|Menge|Preis|Anzahl|Lieferung|Versand|Rechnung|Seite|Zeile|Wert|Hinweis|Ja|Nein|Neu|Weiter|Fertig|Raum|Regal|Wand)\b/;

const SKIP_CALL = /^(t|i18n\.t|i18next\.t|console\.\w+|logger\.\w+|require)$/;
const SKIP_ATTR = /^(className|data-testid|key|id|href|to|src|type|name|role|htmlFor|value|variant|size)$/;
const SKIP_PROP = /^(className|queryKey|key|id|testId|href|path|url|type|method|role|variant)$/;

function skipped(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) return SKIP_CALL.test(p.expression.getText());
    if (ts.isJsxAttribute(p)) return SKIP_ATTR.test(p.name.getText());
    if (ts.isPropertyAssignment(p) && SKIP_PROP.test(p.name.getText().replace(/["']/g, ""))) return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
  }
  return false;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "i18n" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(entry.name) ? [p] : [];
  });
}

export function germanUiTexts(root: string): GermanText[] {
  const out: GermanText[] = [];
  const base = path.join(root, "client/src");
  for (const file of sourceFiles(base)) {
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
    const add = (node: ts.Node, raw: string) => {
      const text = raw.replace(/\s+/g, " ").trim();
      if (text.length < 3 || !GERMAN.test(text) || !/[A-Za-zÄÖÜäöüß]{3}/.test(text)) return;
      if (!/\s/.test(text) && /^[\w.-]+$/.test(text)) return; // Schluessel, Bezeichner
      out.push({ file: path.relative(base, file), line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) add(node, node.text);
      else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !skipped(node)) add(node, node.text);
      else if (ts.isTemplateExpression(node) && !skipped(node)) {
        add(node, [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("…"));
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return out;
}
