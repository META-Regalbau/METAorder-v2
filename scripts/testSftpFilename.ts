/**
 * Schnelltest: Dateinamen-Schema für den SFTP-Upload (server/sftpUpload.ts).
 *   npm run test:sftp-filename
 */
import assert from "node:assert/strict";
import { renderSftpFilename } from "../server/sftpUpload";
import { normalizeRemotePath } from "../server/sftpServers";
import type { DraftAttachment } from "../shared/schema";

const attachment: DraftAttachment = {
  id: "a1b2c3",
  documentKind: "delivery_note",
  fileName: "381345 000 Lieferschein Müller & Söhne.pdf",
  filePath: "/tmp/x.pdf",
  mimeType: "application/pdf",
  size: 1,
  classification: { confidence: 0.9, signals: [] },
  references: { deliveryNoteNumber: "LS 1433099/1", orderNumber: null, invoiceNumber: null, commission: "BV Nord/Halle 3", documentDate: null },
  exportStatus: "pending",
  createdAt: new Date().toISOString(),
};
const draft = { id: "d-1", buyerDocumentNumber: "381345/000", extractedData: { documentReferences: { customerReference: "K-77" } } };
const order = { shopwareOrderId: "o", orderNumber: "10042", customerNumber: "K10001", customerName: "Müller" };

const a = renderSftpFilename({ template: "{orderNumber}_{documentKind}_{originalName}", attachment, draft, order });
assert.equal(a, "10042_delivery_note_381345_000_Lieferschein_Muller_Sohne.pdf");

const b = renderSftpFilename({ template: "{customerNumber}/{buyerDocumentNumber}-{deliveryNoteNumber}", attachment, draft, order });
assert.equal(b, "K10001_381345_000-LS_1433099_1.pdf"); // Slash im Schema wird nie zum Unterordner

const c = renderSftpFilename({ template: "{orderNumber}_{commission}_{customerReference}.{ext}", attachment, draft, order });
assert.equal(c, "10042_BV_Nord_Halle_3_K-77.pdf");

// Fehlende Bestellnummer → kein führender Unterstrich
const d = renderSftpFilename({ template: "{orderNumber}_{originalName}", attachment, draft, order: { ...order, orderNumber: null } });
assert.equal(d, "381345_000_Lieferschein_Muller_Sohne.pdf");

// Leeres Ergebnis → Fallback auf Belegart + Anhang-ID
const e = renderSftpFilename({ template: "{invoiceNumber}", attachment, draft, order });
assert.equal(e, "delivery_note_a1b2c3.pdf");

assert.equal(normalizeRemotePath("in/lieferscheine/"), "/in/lieferscheine");
assert.equal(normalizeRemotePath("//a//b"), "/a/b");
assert.equal(normalizeRemotePath(""), "/");
assert.throws(() => normalizeRemotePath("/a/../b"));

console.log("testSftpFilename: OK");
