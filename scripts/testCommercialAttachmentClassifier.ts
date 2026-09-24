/**
 * Belegart-Erkennung je Mail-Anhang — Unit-Tests.
 *
 *   npm run test:attachment-classifier
 *
 * Läuft ohne Datenbank, Shopware und OpenAI. Die echten Belege unter
 * training/document-classification/ werden per PDF-Textlayer gelesen.
 */

import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {
  attachmentKindProducesDraft,
  classifyCommercialAttachment,
  extractAttachmentReferences,
} from "../server/commercialAttachmentClassifier";
import { extractPlainTextForDraft } from "../server/documentTextExtraction";

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ${name}: OK`);
  } catch (error) {
    failures += 1;
    console.error(`  ${name}: FAILED`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function pdfText(file: string): Promise<string> {
  const buf = await fs.readFile(path.join("training", "document-classification", file));
  const raw = await extractPlainTextForDraft({ fileBuffer: buf, mimeType: "application/pdf", fileName: file, ocrEnabled: false });
  return (raw || "").slice(0, 12000);
}

console.log("\n=== commercialAttachmentClassifier Unit Tests ===\n");

await check("C+P Lieferschein wird als delivery_note erkannt (kein Entwurf)", async () => {
  const text = await pdfText("real_cp_lieferschein_1433099.pdf");
  const c = classifyCommercialAttachment({ filename: "381345_000.pdf", text });
  assert.equal(c.kind, "delivery_note", `kind=${c.kind} signals=${c.signals.join(",")}`);
  assert.ok(c.confidence >= 0.6, `confidence ${c.confidence}`);
  assert.equal(attachmentKindProducesDraft(c.kind, c.confidence), false);
  assert.equal(c.references.deliveryNoteNumber, "1433099");
  assert.equal(c.references.orderNumber, "8054002 /1174415");
});

await check("C+P Bestellung bleibt purchase_order (Entwurf)", async () => {
  const text = await pdfText("real_cp_bestellung_381345.pdf");
  const c = classifyCommercialAttachment({ filename: "cd3003_augad_3465810_284860.pdf", text });
  assert.equal(c.kind, "purchase_order", `kind=${c.kind} signals=${c.signals.join(",")}`);
  assert.equal(attachmentKindProducesDraft(c.kind, c.confidence), true);
  assert.equal(c.references.orderNumber, "381345/000");
  assert.equal(c.references.commission, "2000528/678");
});

await check("HMF Bestellung bleibt purchase_order", async () => {
  const text = await pdfText("real_hmf_bestellung_26631.pdf");
  const c = classifyCommercialAttachment({ filename: "Bestellung 26631.pdf", text });
  assert.equal(c.kind, "purchase_order", `kind=${c.kind}`);
  assert.equal(c.references.orderNumber, "26631");
});

await check("Roloff Bestellung bleibt purchase_order trotz Bitte um Auftragsbestätigung", async () => {
  const text = await pdfText("real_roloff_bestellung_112608258.pdf");
  const c = classifyCommercialAttachment({ filename: "Bestellung_112608258.pdf", text });
  assert.equal(c.kind, "purchase_order", `kind=${c.kind} signals=${c.signals.join(",")}`);
  assert.equal(c.references.orderNumber, "112608258");
});

await check("Delker Bestellung bleibt purchase_order trotz Rechnungsadresse invoice@delker.com", async () => {
  const text = await pdfText("real_delker_bestellung_21433803.pdf");
  const c = classifyCommercialAttachment({ filename: "Bestellung21433803.pdf", text });
  assert.equal(c.kind, "purchase_order", `kind=${c.kind} signals=${c.signals.join(",")}`);
  assert.equal(c.references.orderNumber, "21433803");
});

await check("Cordes & Graefe: gesperrter Titel B E S T E L L U N G wird erkannt", async () => {
  const text = await pdfText("real_cordes_bestellung_09473957.pdf");
  const c = classifyCommercialAttachment({ filename: "09473957_002.PDF", text });
  assert.equal(c.kind, "purchase_order", `kind=${c.kind} signals=${c.signals.join(",")}`);
});

await check("Rechnung wird als invoice erkannt", () => {
  const c = classifyCommercialAttachment({
    filename: "RE-2026-1234.pdf",
    text: "Rechnung\nRechnungs-Nr.: RE-2026-1234\nRechnungsdatum 01.09.2026\nLeistungsdatum 28.08.2026\nRechnungsbetrag 1.234,00 EUR\nzahlbar bis 15.09.2026\nUmsatzsteuer 19 %",
  });
  assert.equal(c.kind, "invoice");
  assert.equal(attachmentKindProducesDraft(c.kind, c.confidence), false);
  assert.equal(c.references.invoiceNumber, "RE-2026-1234");
});

await check("Auftragsbestätigung wird als order_confirmation erkannt", () => {
  const c = classifyCommercialAttachment({
    filename: "AB_556677.pdf",
    text: "Auftragsbestätigung\nAB-Nr.: 556677\nWir bestätigen Ihren Auftrag vom 02.09.2026 mit folgenden Positionen\nLiefertermin KW 40",
  });
  assert.equal(c.kind, "order_confirmation");
  assert.equal(attachmentKindProducesDraft(c.kind, c.confidence), false);
});

await check("Ohne Text bleibt der Anhang Entwurfs-Kandidat (Scan → Vision)", () => {
  const c = classifyCommercialAttachment({ filename: "scan0001.pdf", text: "" });
  assert.equal(c.kind, "unknown");
  assert.equal(attachmentKindProducesDraft(c.kind, c.confidence), true);
});

await check("Lieferschein-Nummer aus Fließtext", () => {
  const r = extractAttachmentReferences("Lieferschein Nr. LS-4711 vom 21.09.2026 Ihre Bestellung: 998877 Kom: BAU-12");
  assert.equal(r.deliveryNoteNumber, "LS-4711");
  assert.equal(r.commission, "BAU-12");
});

if (failures > 0) {
  console.error(`\n${failures} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log("\nAlle Tests bestanden\n");
