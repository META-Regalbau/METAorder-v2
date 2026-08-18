/**
 * Misst die Trefferquote der Dokument-Extraktion gegen einen Soll-Datensatz.
 *
 *   npm run eval:extraction
 *   npm run eval:extraction -- --dir=training/document-extraction/eval --json=out.json
 *   npm run eval:extraction -- --case=bestellung_holme
 *
 * Voraussetzung: `OPENAI_API_KEY` (oder die Replit-Integration über
 * AI_INTEGRATIONS_OPENAI_BASE_URL / AI_INTEGRATIONS_OPENAI_API_KEY).
 *
 * Bewusst **ohne** Datenbank und Shopware: Bewertet wird ausschließlich die Extraktion.
 * Das Katalog-Matching hängt am Warenbestand und gehört in eine eigene Messung.
 *
 * Fälle liegen als Paar vor:
 *   <name>.input.(txt|eml|pdf|png|jpg)   — Eingangsdokument
 *   <name>.expected.json                 — Sollwert im DocumentExtraction-Schema
 */

import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { extractOrderDataFromDocument } from "../server/orderDraftExtractor";
import {
  aggregateEvalResults,
  compareDocumentExtraction,
  formatEvalSummary,
  type CaseResult,
} from "../server/extractionEvalScoring";

const DEFAULT_DIR = "training/document-extraction/eval";

const INPUT_EXTENSIONS: Array<{ ext: string; mimeType: string }> = [
  { ext: ".input.txt", mimeType: "text/plain" },
  { ext: ".input.eml", mimeType: "message/rfc822" },
  { ext: ".input.pdf", mimeType: "application/pdf" },
  { ext: ".input.png", mimeType: "image/png" },
  { ext: ".input.jpg", mimeType: "image/jpeg" },
];

function parseArgs(argv: string[]) {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  return {
    dir: get("dir") ?? DEFAULT_DIR,
    caseFilter: get("case"),
    jsonOut: get("json"),
    limit: Number(get("limit") ?? "0") || 0,
  };
}

function buildOpenAIClient(): OpenAI {
  if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });
  }
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    console.error(
      "OPENAI_API_KEY fehlt. Setzen, oder die Replit-Integration über\n" +
        "AI_INTEGRATIONS_OPENAI_BASE_URL / AI_INTEGRATIONS_OPENAI_API_KEY bereitstellen."
    );
    process.exit(1);
  }
  return new OpenAI({ apiKey: key });
}

type EvalCase = {
  id: string;
  inputPath: string;
  mimeType: string;
  expected: Record<string, unknown>;
};

async function loadCases(dir: string, caseFilter?: string): Promise<EvalCase[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    console.error(
      `Ordner "${dir}" nicht gefunden.\n` +
        `Lege Fälle als <name>.input.txt + <name>.expected.json dort ab (siehe README im Ordner).`
    );
    process.exit(1);
  }

  const cases: EvalCase[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".expected.json")) continue;
    const id = entry.slice(0, -".expected.json".length);
    if (caseFilter && !id.includes(caseFilter)) continue;

    let inputPath: string | null = null;
    let mimeType = "text/plain";
    for (const candidate of INPUT_EXTENSIONS) {
      const p = path.join(dir, `${id}${candidate.ext}`);
      try {
        await fs.access(p);
        inputPath = p;
        mimeType = candidate.mimeType;
        break;
      } catch {
        /* nächste Endung probieren */
      }
    }
    if (!inputPath) {
      console.warn(`  ! ${id}: kein Eingangsdokument gefunden — übersprungen`);
      continue;
    }

    const expected = JSON.parse(await fs.readFile(path.join(dir, entry), "utf8"));
    cases.push({ id, inputPath, mimeType, expected });
  }
  return cases;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const openai = buildOpenAIClient();

  console.log(`\n=== Extraktions-Eval (${args.dir}) ===\n`);
  let cases = await loadCases(args.dir, args.caseFilter);
  if (args.limit > 0) cases = cases.slice(0, args.limit);

  if (cases.length === 0) {
    console.error("Keine Fälle gefunden.");
    process.exit(1);
  }

  const results: CaseResult[] = [];
  const failedCases: Array<{ id: string; error: string }> = [];

  // Sequenziell: hält die Ausgabe lesbar und vermeidet Rate-Limits.
  for (const [index, testCase] of cases.entries()) {
    const label = `[${index + 1}/${cases.length}] ${testCase.id}`;
    try {
      const buffer = await fs.readFile(testCase.inputPath);
      const started = Date.now();
      const extracted = await extractOrderDataFromDocument(
        buffer,
        path.basename(testCase.inputPath),
        testCase.mimeType,
        {
          // openai_only: Die Messung soll den KI-Pfad bewerten, nicht den lokalen Fallback.
          mode: "openai_only",
          openaiClient: openai,
          ocrEnabled: true,
        }
      );
      const ms = Date.now() - started;
      const result = compareDocumentExtraction({
        caseId: testCase.id,
        expected: testCase.expected,
        actual: extracted.documentExtraction as Record<string, unknown> | undefined,
      });
      results.push(result);

      const docErrors = result.documentFields.filter((f) => f.outcome !== "correct").length;
      const lineErrors = result.lineItems.reduce(
        (sum, l) => sum + l.fields.filter((f) => f.outcome !== "correct").length,
        0
      );
      const lineCountOk = result.lineItemCountExpected === result.lineItemCountActual;
      console.log(
        `${label}: Kopf ${docErrors} Fehler, Positionen ${lineErrors} Fehler, ` +
          `Zeilen ${result.lineItemCountActual}/${result.lineItemCountExpected}` +
          `${lineCountOk ? "" : "  <-- Anzahl weicht ab"}  (${ms} ms)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedCases.push({ id: testCase.id, error: message });
      console.error(`${label}: FEHLER — ${message}`);
    }
  }

  const summary = aggregateEvalResults(results);
  console.log("\n" + "-".repeat(72));
  console.log(formatEvalSummary(summary));
  if (failedCases.length > 0) {
    console.log("");
    console.log(`Nicht auswertbar: ${failedCases.length} Fall/Fälle`);
    for (const f of failedCases) console.log(`  ${f.id}: ${f.error}`);
  }
  console.log("-".repeat(72) + "\n");

  if (args.jsonOut) {
    await fs.writeFile(
      args.jsonOut,
      JSON.stringify({ summary, results, failedCases }, null, 2),
      "utf8"
    );
    console.log(`Detailergebnis geschrieben: ${args.jsonOut}\n`);
  }

  // Exit-Code nur bei nicht auswertbaren Fällen — eine niedrige Trefferquote ist ein
  // Messergebnis, kein Skriptfehler.
  if (failedCases.length > 0) process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
