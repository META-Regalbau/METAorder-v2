/**
 * Unit-Tests für die Eval-Bewertung.
 *
 * Wichtig, weil die Zahlen aus dieser Logik später Entscheidungen tragen — eine
 * falsch rechnende Auswertung wäre schädlicher als gar keine Zahl.
 *
 *   npm run test:extraction-eval
 */

import assert from "node:assert/strict";
import {
  aggregateEvalResults,
  compareDocumentExtraction,
  normalizeIdentifier,
  normalizeText,
} from "../server/extractionEvalScoring";

let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ${name}: OK`);
  } catch (error) {
    failures += 1;
    console.error(`  ${name}: FAILED`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

function outcomeOf(result: ReturnType<typeof compareDocumentExtraction>, field: string) {
  return result.documentFields.find((f) => f.field === field)?.outcome;
}

function lineOutcome(
  result: ReturnType<typeof compareDocumentExtraction>,
  position: number,
  field: string
) {
  return result.lineItems
    .find((l) => l.position === position)
    ?.fields.find((f) => f.field === field)?.outcome;
}

console.log("\n=== extractionEvalScoring Unit Tests ===\n");

check("Textnormalisierung ignoriert Formatierung, nicht Inhalt", () => {
  assert.equal(normalizeText("  Musterfirma   GmbH "), "musterfirma gmbh");
  assert.equal(normalizeText("Musterstraße 12."), "musterstraße 12");
  assert.equal(normalizeText(""), null);
  assert.equal(normalizeText(null), null);
  assert.notEqual(normalizeText("Musterfirma AG"), normalizeText("Musterfirma GmbH"));
});

check("Artikelnummern: Trennzeichen sind Formatierung", () => {
  assert.equal(normalizeIdentifier("4032 9812345678"), "40329812345678");
  assert.equal(normalizeIdentifier("META-AB-123"), "metaab123");
  assert.notEqual(normalizeIdentifier("123"), normalizeIdentifier("1234"));
});

check("identischer Datensatz ergibt volle Trefferquote", () => {
  const doc = {
    document: { type: "purchase_order", number: "PO-1", currency: "EUR", total_net: 100 },
    buyer: { company: "Musterfirma GmbH", street: "Weg 1", zip: "1234", city: "Ort" },
    line_items: [{ position: 10, quantity: 5, supplier_sku: "4026212260212", unit_price_net: 20 }],
  };
  const result = compareDocumentExtraction({ caseId: "c1", expected: doc, actual: doc });
  const summary = aggregateEvalResults([result]);
  assert.equal(summary.documentFields.wrong, 0);
  assert.equal(summary.documentFields.missing, 0);
  assert.equal(summary.documentFields.spurious, 0);
  assert.equal(summary.documentFields.accuracy, 100);
  assert.equal(summary.lineItemFields.accuracy, 100);
  assert.equal(summary.casesWithCorrectLineCount, 1);
});

check("unterscheidet fehlend, erfunden und falsch", () => {
  const result = compareDocumentExtraction({
    caseId: "c2",
    expected: {
      document: { number: "PO-1" },
      buyer: { company: "Musterfirma GmbH", street: "Weg 1", city: null },
      line_items: [],
    },
    actual: {
      document: { number: "PO-9" }, // falsch
      buyer: { company: null, street: "Weg 1", city: "Erfunden" }, // fehlend / korrekt / erfunden
      line_items: [],
    },
  });
  assert.equal(outcomeOf(result, "document.number"), "wrong");
  assert.equal(outcomeOf(result, "buyer.company"), "missing");
  assert.equal(outcomeOf(result, "buyer.street"), "correct");
  assert.equal(outcomeOf(result, "buyer.city"), "spurious");
});

check("beidseitig leer zählt als korrekt", () => {
  const result = compareDocumentExtraction({
    caseId: "c3",
    expected: { document: { delivery_date: null }, buyer: {}, line_items: [] },
    actual: { document: {}, buyer: {}, line_items: [] },
  });
  assert.equal(outcomeOf(result, "document.delivery_date"), "correct");
});

check("Beträge werden mit Rundungstoleranz verglichen", () => {
  const result = compareDocumentExtraction({
    caseId: "c4",
    expected: { document: { total_net: 3041.14 }, buyer: {}, line_items: [] },
    actual: { document: { total_net: 3041.145 }, buyer: {}, line_items: [] },
  });
  assert.equal(outcomeOf(result, "document.total_net"), "correct");
});

check("Mengen werden exakt verglichen", () => {
  const result = compareDocumentExtraction({
    caseId: "c5",
    expected: { document: {}, buyer: {}, line_items: [{ position: 10, quantity: 19 }] },
    actual: { document: {}, buyer: {}, line_items: [{ position: 10, quantity: 1 }] },
  });
  assert.equal(lineOutcome(result, 10, "line.quantity"), "wrong");
});

check("Positionen werden über die Positionsnummer zugeordnet, nicht über den Index", () => {
  // Klassischer Fehler: die Extraktion erzeugt eine Zeile zu viel. Position 20 muss
  // trotzdem korrekt bewertet werden statt zu verrutschen.
  const result = compareDocumentExtraction({
    caseId: "c6",
    expected: {
      document: {},
      buyer: {},
      line_items: [
        { position: 10, quantity: 19, supplier_sku: "4026212260212" },
        { position: 20, quantity: 4, supplier_sku: "4026212260229" },
      ],
    },
    actual: {
      document: {},
      buyer: {},
      line_items: [
        { position: 10, quantity: 19, supplier_sku: "4026212260212" },
        { position: 15, quantity: 1, supplier_sku: "160063041" }, // Geisterzeile aus der Preiszeile
        { position: 20, quantity: 4, supplier_sku: "4026212260229" },
      ],
    },
  });
  assert.equal(lineOutcome(result, 10, "line.quantity"), "correct");
  assert.equal(lineOutcome(result, 20, "line.quantity"), "correct");
  assert.equal(lineOutcome(result, 20, "line.supplier_sku"), "correct");
  // Die überzählige Zeile schlägt sich in der Positionsanzahl nieder
  assert.equal(result.lineItemCountExpected, 2);
  assert.equal(result.lineItemCountActual, 3);
  assert.equal(aggregateEvalResults([result]).casesWithCorrectLineCount, 0);
});

check("fehlende Extraktion wird vollständig als Fehler gewertet", () => {
  const result = compareDocumentExtraction({
    caseId: "c7",
    expected: {
      document: { number: "PO-1", currency: "EUR" },
      buyer: { company: "Musterfirma GmbH" },
      line_items: [{ position: 10, quantity: 5 }],
    },
    actual: null,
  });
  const summary = aggregateEvalResults([result]);
  assert.equal(summary.documentFields.correct > 0, true, "leere Felder gelten weiter als korrekt");
  assert.equal(outcomeOf(result, "document.number"), "missing");
  assert.equal(outcomeOf(result, "buyer.company"), "missing");
  assert.equal(lineOutcome(result, 10, "line.quantity"), "missing");
});

check("Fehlerquellen werden absteigend sortiert", () => {
  const bad = (id: string) =>
    compareDocumentExtraction({
      caseId: id,
      expected: { document: { number: "PO-1" }, buyer: { company: "A GmbH" }, line_items: [] },
      actual: { document: {}, buyer: { company: "A GmbH" }, line_items: [] },
    });
  const summary = aggregateEvalResults([bad("a"), bad("b"), bad("c")]);
  assert.equal(summary.worstFields[0].field, "document.number");
  assert.equal(summary.worstFields[0].missing, 3);
  assert.ok(!summary.worstFields.some((f) => f.field === "buyer.company"));
});

check("Trefferquote rechnet über mehrere Fälle korrekt", () => {
  const perfect = compareDocumentExtraction({
    caseId: "p",
    expected: { document: {}, buyer: {}, line_items: [{ position: 10, quantity: 1 }] },
    actual: { document: {}, buyer: {}, line_items: [{ position: 10, quantity: 1 }] },
  });
  const wrong = compareDocumentExtraction({
    caseId: "w",
    expected: { document: {}, buyer: {}, line_items: [{ position: 10, quantity: 1 }] },
    actual: { document: {}, buyer: {}, line_items: [{ position: 10, quantity: 2 }] },
  });
  const summary = aggregateEvalResults([perfect, wrong]);
  // 8 Positionsfelder gesamt (4 je Fall), davon 1 falsch
  assert.equal(summary.lineItemFields.correct, 7);
  assert.equal(summary.lineItemFields.wrong, 1);
  assert.equal(summary.lineItemFields.accuracy, 87.5);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll tests passed.\n");
