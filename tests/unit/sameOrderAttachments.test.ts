/**
 * Bestellung + Lieferschein derselben Bestellung in einer Mail (Heinrich & Schleyer, Live 11.10.2026):
 * „Best_BE730134.pdf“ und „Lief_BE730134.pdf“ ergaben zwei Bestellentwürfe, weil der Lieferschein
 * keine erkennbare Titelzeile hatte und „Lief_“ kein Dateinamen-Signal war.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { classifyCommercialAttachment, type AttachmentClassification } from "../../server/commercial/commercialAttachmentClassifier";
import { demoteSameOrderCompanions, type SupportingDocumentPart } from "../../server/commercial/commercialDraftAttachments";
import type { InboundCommercialDocPart } from "../../server/commercial/commercialInboundPdfContext";

const part = (filename: string): InboundCommercialDocPart => ({ filename, contentType: "application/pdf", buffer: Buffer.from(filename) });

function run(entries: Array<[InboundCommercialDocPart, AttachmentClassification]>) {
  const draftParts = entries.map(([p]) => p);
  const supportingParts: SupportingDocumentPart[] = [];
  const classifications = new Map(entries);
  demoteSameOrderCompanions(draftParts, supportingParts, classifications);
  return { draftParts, supportingParts };
}

const ORDER_TEXT = "Bestellung\nBE730134\nHeinrich & Schleyer GmbH\nBestell-Nr.: BE730134\nPos Menge Artikel Preis\n1 5 Palettenregal-Ständerrahmen 190,73\nWir bitten um Auftragsbestätigung an ab@heinrich-und-schleyer.de";
// Lieferschein-Druck ohne eigene Titelzeile, nur Bezug auf die Bestellung
const LIEF_TEXT = "Heinrich & Schleyer GmbH Neutral liefern an\nBestell-Nr.: BE730134 vom 27.08.26\nPos Menge Artikel\n1 5 Palettenregal-Ständerrahmen SR 100/20\nAnlage: Lieferschein";

describe("Dateiname als Lieferschein-Signal", () => {
  it("Lief_ und LS_ zählen, Lieferant/Lieferung nicht", () => {
    for (const f of ["Lief_BE730134.pdf", "LS 32135328.pdf", "LS_4711.pdf", "lief-2026-10.pdf"]) {
      const c = classifyCommercialAttachment({ filename: f, text: LIEF_TEXT });
      assert.ok(c.signals.includes("filename_delivery_note"), `${f}: ${c.signals.join(",")}`);
    }
    for (const f of ["Lieferantenbestellung_4711.pdf", "Best_BE730134.pdf", "Lieferung.pdf"]) {
      const c = classifyCommercialAttachment({ filename: f, text: ORDER_TEXT });
      assert.ok(!c.signals.includes("filename_delivery_note"), `${f}: ${c.signals.join(",")}`);
    }
  });
});

describe("Gleiche Belegnummer in einer Mail", () => {
  it("Best_ + Lief_: nur die Bestellung wird Entwurf, Lieferschein Beilage", () => {
    const best = part("Best_BE730134.pdf");
    const lief = part("Lief_BE730134.pdf");
    const { draftParts, supportingParts } = run([
      [best, classifyCommercialAttachment({ filename: best.filename, text: ORDER_TEXT })],
      [lief, { kind: "unknown", confidence: 0.2, signals: [], references: { orderNumber: "BE730134" } }],
    ]);
    assert.deepEqual(draftParts, [best]);
    assert.equal(supportingParts[0].part, lief);
    assert.equal(supportingParts[0].classification.kind, "other");
    assert.ok(supportingParts[0].classification.signals.includes("same_order_number_as_draft"));
  });

  it("auch wenn der Lieferschein als Bestellung eingestuft wurde (Bestell-Nr. im Text)", () => {
    const best = part("Best_BE730038.pdf");
    const lief = part("Lief_BE730038.pdf");
    const liefClass = classifyCommercialAttachment({ filename: lief.filename, text: LIEF_TEXT.replace(/BE730134/g, "BE730038") });
    const { draftParts, supportingParts } = run([
      [lief, { ...liefClass, kind: "purchase_order", signals: [...liefClass.signals, "order_number_label"] }],
      [best, classifyCommercialAttachment({ filename: best.filename, text: ORDER_TEXT.replace(/BE730134/g, "BE730038") })],
    ]);
    assert.deepEqual(draftParts, [best]);
    assert.equal(supportingParts[0].classification.kind, "delivery_note");
  });

  it("verschiedene Bestellungen in einer Mail bleiben getrennt", () => {
    const a = part("Best_BE730134.pdf");
    const b = part("Best_BE730041.pdf");
    const cls = (f: string) => classifyCommercialAttachment({ filename: f, text: ORDER_TEXT });
    const { draftParts } = run([[a, cls(a.filename)], [b, { ...cls(b.filename), references: { orderNumber: "BE730041" } }]]);
    assert.equal(draftParts.length, 2);
  });

  it("zwei Teile mit eigenem Bestell-Titel bleiben beide Entwurf", () => {
    const a = part("Bestellung_4711_Teil1.pdf");
    const b = part("Bestellung_4711_Teil2.pdf");
    const c: AttachmentClassification = { kind: "purchase_order", confidence: 0.9, signals: ["title_bestellung"], references: { orderNumber: "47110815" } };
    const { draftParts } = run([[a, c], [b, c]]);
    assert.equal(draftParts.length, 2);
  });

  it("Scans eines Tages (Datum im Dateinamen, kein Text) bleiben getrennt", () => {
    const a = part("Scan_20261011_01.pdf");
    const b = part("Scan_20261011_02.pdf");
    const c: AttachmentClassification = { kind: "unknown", confidence: 0, signals: ["no_text"], references: {} };
    const { draftParts } = run([[a, c], [b, c]]);
    assert.equal(draftParts.length, 2);
  });
});
