/**
 * Feste Fehlertexte der Server-Antworten (fuer apiError.test.ts): jedes res.json({ error: "..." })
 * und - bei Status ab 400 - res.status(4xx/5xx).json({ message: "..." }), auch als Rueckfall
 * (error.message || "Failed to ..."). Per TypeScript-Parser, damit auch mehrzeilige Aufrufe zaehlen.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export type ServerErrorText = { text: string; file: string; line: number };

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(p);
    return entry.name.endsWith(".ts") ? [p] : [];
  });
}

/** Status aus der Kette res.status(404).json(...) - null, wenn keiner als Zahl dasteht */
function chainStatus(call: ts.CallExpression): number | null {
  let expr: ts.Expression = (call.expression as ts.PropertyAccessExpression).expression;
  while (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "status") {
      const arg = expr.arguments[0];
      return arg && ts.isNumericLiteral(arg) ? Number(arg.text) : null;
    }
    expr = ts.isPropertyAccessExpression(callee) ? callee.expression : callee;
  }
  return null;
}

/** Feste Texte eines Ausdrucks, auch als Rueckfall: error.message || "Failed to ...", a ?? "...", x ? "a" : "b" */
function literalTexts(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return literalTexts(node.expression);
  if (ts.isConditionalExpression(node)) return [...literalTexts(node.whenTrue), ...literalTexts(node.whenFalse)];
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [...literalTexts(node.left), ...literalTexts(node.right)];
  }
  return [];
}

export function serverErrorTexts(root: string): ServerErrorText[] {
  const out: ServerErrorText[] = [];
  for (const file of sourceFiles(path.join(root, "server"))) {
    const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "json" &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const status = chainStatus(node);
        for (const prop of node.arguments[0].properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
          const name = prop.name.text;
          if (name !== "error" && !(name === "message" && status !== null && status >= 400)) continue;
          for (const text of literalTexts(prop.initializer)) {
            if (!text.trim()) continue;
            out.push({ text, file: path.relative(root, file), line: src.getLineAndCharacterOfPosition(prop.getStart()).line + 1 });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return out;
}
