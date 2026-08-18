/**
 * Bewertung der Dokument-Extraktion gegen einen Soll-Datensatz.
 *
 * Zweck: eine belastbare Trefferquote statt Bauchgefühl — feldweise, damit sichtbar
 * wird **wo** es hakt (Adresse? Mengen? Artikelnummern?) und nicht nur *dass*.
 *
 * Bewusst frei von Netz- und Dateizugriffen, damit die Bewertung selbst testbar ist:
 * Eine falsch rechnende Auswertung wäre schädlicher als gar keine Zahl.
 */

import type { DocumentExtraction } from "@shared/documentExtractionSchema";

/**
 * Ergebnis je Feld.
 *
 * `missing` und `spurious` werden getrennt von `wrong` geführt — fachlich sind das
 * verschiedene Fehler: nicht erkannt vs. erfunden. Halluzinierte Werte sind der
 * gefährlichere Fall, weil sie unbemerkt in eine Bestellung laufen können.
 */
export type FieldOutcome = "correct" | "wrong" | "missing" | "spurious";

export type FieldResult = {
  field: string;
  outcome: FieldOutcome;
  expected: string | number | null;
  actual: string | number | null;
};

export type LineItemResult = {
  /** Position aus dem Sollwert; null bei überzähligen Ist-Zeilen */
  position: number | null;
  fields: FieldResult[];
};

export type CaseResult = {
  caseId: string;
  documentFields: FieldResult[];
  lineItemCountExpected: number;
  lineItemCountActual: number;
  lineItems: LineItemResult[];
};

export type OutcomeCounts = Record<FieldOutcome, number>;

export type EvalSummary = {
  cases: number;
  /** Fälle, bei denen die Zahl der Positionen exakt stimmt */
  casesWithCorrectLineCount: number;
  documentFields: OutcomeCounts & { accuracy: number };
  lineItemFields: OutcomeCounts & { accuracy: number };
  /** Feldweise Fehlerhäufigkeit, absteigend — zeigt, wo sich Arbeit lohnt */
  worstFields: Array<{ field: string; wrong: number; missing: number; spurious: number }>;
};

/** Vergleichsnormalisierung für Freitext: Groß/Klein, Mehrfach-Leerzeichen, Satzzeichen am Rand. */
export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/g, "")
    .toLowerCase();
  return normalized || null;
}

/** Artikelnummern/GTIN: Trennzeichen sind Formatierung, keine Bedeutung. */
export function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/[\s ._/-]/g, "").toLowerCase();
  return compact || null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compareField(params: {
  field: string;
  expected: unknown;
  actual: unknown;
  kind: "text" | "identifier" | "number";
  /** Toleranz für Beträge (Rundung), Standard exakt */
  epsilon?: number;
}): FieldResult {
  const { field, expected, actual, kind, epsilon = 0 } = params;

  if (kind === "number") {
    const e = numberOrNull(expected);
    const a = numberOrNull(actual);
    const base = { field, expected: e, actual: a };
    if (e === null && a === null) return { ...base, outcome: "correct" };
    if (e === null) return { ...base, outcome: "spurious" };
    if (a === null) return { ...base, outcome: "missing" };
    return { ...base, outcome: Math.abs(e - a) <= epsilon ? "correct" : "wrong" };
  }

  const normalize = kind === "identifier" ? normalizeIdentifier : normalizeText;
  const e = normalize(expected);
  const a = normalize(actual);
  const base = {
    field,
    expected: typeof expected === "string" ? expected : null,
    actual: typeof actual === "string" ? actual : null,
  };
  if (e === null && a === null) return { ...base, outcome: "correct" };
  if (e === null) return { ...base, outcome: "spurious" };
  if (a === null) return { ...base, outcome: "missing" };
  return { ...base, outcome: e === a ? "correct" : "wrong" };
}

function section(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Kopffelder, die fachlich zählen. Beschreibungstexte bleiben absichtlich außen vor. */
const DOCUMENT_FIELDS: Array<{ path: string; kind: "text" | "identifier" | "number"; epsilon?: number }> = [
  { path: "document.type", kind: "text" },
  { path: "document.number", kind: "identifier" },
  { path: "document.date", kind: "text" },
  { path: "document.delivery_date", kind: "text" },
  { path: "document.currency", kind: "text" },
  { path: "document.total_net", kind: "number", epsilon: 0.01 },
  { path: "buyer.company", kind: "text" },
  { path: "buyer.street", kind: "text" },
  { path: "buyer.zip", kind: "identifier" },
  { path: "buyer.city", kind: "text" },
  { path: "buyer.country", kind: "text" },
  { path: "buyer.vat_id", kind: "identifier" },
  { path: "buyer.customer_number", kind: "identifier" },
  { path: "buyer.email", kind: "text" },
  { path: "delivery_address.company", kind: "text" },
  { path: "delivery_address.street", kind: "text" },
  { path: "delivery_address.zip", kind: "identifier" },
  { path: "delivery_address.city", kind: "text" },
];

const LINE_FIELDS: Array<{ key: string; kind: "text" | "identifier" | "number"; epsilon?: number }> = [
  { key: "quantity", kind: "number" },
  { key: "supplier_sku", kind: "identifier" },
  { key: "buyer_sku", kind: "identifier" },
  { key: "unit_price_net", kind: "number", epsilon: 0.01 },
];

function readPath(source: unknown, path: string): unknown {
  const [head, tail] = path.split(".");
  return section(section(source)[head])[tail];
}

/**
 * Vergleicht eine Extraktion mit dem Sollwert.
 *
 * Positionen werden über `position` zugeordnet, nicht über den Index: Erzeugt die
 * Extraktion eine Zeile zu viel (klassischer Fehler bei mehrzeiligen Tabellen), sollen
 * die übrigen Positionen trotzdem korrekt bewertet werden statt alle zu verrutschen.
 */
export function compareDocumentExtraction(params: {
  caseId: string;
  expected: DocumentExtraction | Record<string, unknown>;
  actual: DocumentExtraction | Record<string, unknown> | null | undefined;
}): CaseResult {
  const { caseId, expected } = params;
  const actual = params.actual ?? {};

  const documentFields = DOCUMENT_FIELDS.map((f) =>
    compareField({
      field: f.path,
      expected: readPath(expected, f.path),
      actual: readPath(actual, f.path),
      kind: f.kind,
      epsilon: f.epsilon,
    })
  );

  const expectedLines = Array.isArray((expected as Record<string, unknown>).line_items)
    ? ((expected as Record<string, unknown>).line_items as Record<string, unknown>[])
    : [];
  const actualLines = Array.isArray((actual as Record<string, unknown>).line_items)
    ? ((actual as Record<string, unknown>).line_items as Record<string, unknown>[])
    : [];

  const actualByPosition = new Map<number, Record<string, unknown>>();
  actualLines.forEach((line, index) => {
    const pos = numberOrNull(line.position) ?? index + 1;
    if (!actualByPosition.has(pos)) actualByPosition.set(pos, line);
  });

  const lineItems: LineItemResult[] = expectedLines.map((expectedLine, index) => {
    const position = numberOrNull(expectedLine.position) ?? index + 1;
    const actualLine = actualByPosition.get(position) ?? actualLines[index] ?? {};
    return {
      position,
      fields: LINE_FIELDS.map((f) =>
        compareField({
          field: `line.${f.key}`,
          expected: expectedLine[f.key],
          actual: actualLine[f.key],
          kind: f.kind,
          epsilon: f.epsilon,
        })
      ),
    };
  });

  return {
    caseId,
    documentFields,
    lineItemCountExpected: expectedLines.length,
    lineItemCountActual: actualLines.length,
    lineItems,
  };
}

function emptyCounts(): OutcomeCounts {
  return { correct: 0, wrong: 0, missing: 0, spurious: 0 };
}

function tally(counts: OutcomeCounts, results: FieldResult[]): void {
  for (const r of results) counts[r.outcome] += 1;
}

function accuracyOf(counts: OutcomeCounts): number {
  const total = counts.correct + counts.wrong + counts.missing + counts.spurious;
  return total === 0 ? 0 : Math.round((counts.correct / total) * 1000) / 10;
}

export function aggregateEvalResults(results: CaseResult[]): EvalSummary {
  const documentCounts = emptyCounts();
  const lineCounts = emptyCounts();
  const perField = new Map<string, { wrong: number; missing: number; spurious: number }>();

  const note = (result: FieldResult) => {
    if (result.outcome === "correct") return;
    const entry = perField.get(result.field) ?? { wrong: 0, missing: 0, spurious: 0 };
    entry[result.outcome] += 1;
    perField.set(result.field, entry);
  };

  let casesWithCorrectLineCount = 0;
  for (const result of results) {
    tally(documentCounts, result.documentFields);
    result.documentFields.forEach(note);
    for (const line of result.lineItems) {
      tally(lineCounts, line.fields);
      line.fields.forEach(note);
    }
    if (result.lineItemCountExpected === result.lineItemCountActual) {
      casesWithCorrectLineCount += 1;
    }
  }

  const worstFields = [...perField.entries()]
    .map(([field, v]) => ({ field, ...v }))
    .sort(
      (a, b) =>
        b.wrong + b.missing + b.spurious - (a.wrong + a.missing + a.spurious) ||
        a.field.localeCompare(b.field)
    )
    .slice(0, 10);

  return {
    cases: results.length,
    casesWithCorrectLineCount,
    documentFields: { ...documentCounts, accuracy: accuracyOf(documentCounts) },
    lineItemFields: { ...lineCounts, accuracy: accuracyOf(lineCounts) },
    worstFields,
  };
}

/** Kurzbericht für die Konsole. */
export function formatEvalSummary(summary: EvalSummary): string {
  const lines: string[] = [];
  const pct = (n: number) => `${n.toFixed(1)} %`;
  lines.push(`Fälle:                        ${summary.cases}`);
  lines.push(
    `Positionsanzahl korrekt:      ${summary.casesWithCorrectLineCount}/${summary.cases}`
  );
  lines.push("");
  lines.push("Kopfdaten (Beleg, Käufer, Lieferadresse)");
  lines.push(
    `  Trefferquote:               ${pct(summary.documentFields.accuracy)}` +
      `  (richtig ${summary.documentFields.correct}, falsch ${summary.documentFields.wrong},` +
      ` fehlend ${summary.documentFields.missing}, erfunden ${summary.documentFields.spurious})`
  );
  lines.push("Positionen (Menge, Artikelnummern, Preis)");
  lines.push(
    `  Trefferquote:               ${pct(summary.lineItemFields.accuracy)}` +
      `  (richtig ${summary.lineItemFields.correct}, falsch ${summary.lineItemFields.wrong},` +
      ` fehlend ${summary.lineItemFields.missing}, erfunden ${summary.lineItemFields.spurious})`
  );
  if (summary.worstFields.length > 0) {
    lines.push("");
    lines.push("Häufigste Fehlerquellen:");
    for (const f of summary.worstFields) {
      const total = f.wrong + f.missing + f.spurious;
      lines.push(
        `  ${f.field.padEnd(28)} ${String(total).padStart(3)}` +
          `  (falsch ${f.wrong}, fehlend ${f.missing}, erfunden ${f.spurious})`
      );
    }
  }
  return lines.join("\n");
}
