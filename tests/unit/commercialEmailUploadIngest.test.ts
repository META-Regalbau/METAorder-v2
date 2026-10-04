/**
 * Unit-Tests für die Zerlegung hochgeladener E-Mail-Container (.eml/.msg).
 *
 * Deckt die deterministischen Teile ab — Container-Erkennung, Message-ID-Ableitung
 * und die Trennung von Geschäftsdokumenten und Signaturbildern. Die eigentliche
 * Entwurfserzeugung hängt an Storage/Shopware/OpenAI und wird hier nicht gefahren.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  deriveUploadMessageId,
  isEmailContainerUpload,
  splitCommercialEmailParts,
} from "../../server/commercial/commercialEmailUploadIngest";

// Aus scripts/testCommercialEmailUploadIngest.ts uebernommen: Pruefungen unveraendert, je Pruefung ein Vitest-Fall.
describe("CommercialEmailUploadIngest", () => {
  it("erkennt .eml/.msg und rfc822 als Container", () => {
    assert.equal(isEmailContainerUpload("Bestellung.eml", "application/octet-stream"), true);
    assert.equal(isEmailContainerUpload("Anfrage.MSG", ""), true);
    assert.equal(isEmailContainerUpload("gmail-123", "message/rfc822"), true);
    assert.equal(isEmailContainerUpload("mail", "application/vnd.ms-outlook"), true);
  });

  it("behandelt Einzeldokumente nicht als Container", () => {
    assert.equal(isEmailContainerUpload("Bestellung.pdf", "application/pdf"), false);
    assert.equal(isEmailContainerUpload("scan.png", "image/png"), false);
    assert.equal(isEmailContainerUpload("Auftrag.docx", "application/msword"), false);
  });

  it("nutzt die Message-ID aus dem Header", () => {
    const eml = Buffer.from(
      ["From: a@b.de", "Message-ID: <abc123@mail.example.com>", "Subject: Test", "", "Body"].join(
        "\r\n"
      ),
      "utf8"
    );
    assert.equal(deriveUploadMessageId(eml), "mail:abc123@mail.example.com");
  });

  it("Message-ID-Erkennung ist case-insensitiv", () => {
    const eml = Buffer.from(["message-id:  <X-9@host>", "", "Body"].join("\r\n"), "utf8");
    assert.equal(deriveUploadMessageId(eml), "mail:X-9@host");
  });

  it("fällt ohne Message-ID auf einen Inhalts-Hash zurück", () => {
    const eml = Buffer.from("From: a@b.de\r\nSubject: Ohne ID\r\n\r\nBody", "utf8");
    const id = deriveUploadMessageId(eml);
    assert.ok(id.startsWith("sha256:"), `unerwartete Kennung: ${id}`);
    // Stabil: derselbe Inhalt → dieselbe Kennung (n8n-Retry erzeugt keinen Doppelentwurf)
    assert.equal(id, deriveUploadMessageId(Buffer.from(eml)));
  });

  it("unterschiedliche Mails erhalten unterschiedliche Kennungen", () => {
    const a = deriveUploadMessageId(Buffer.from("Subject: A\r\n\r\nEins", "utf8"));
    const b = deriveUploadMessageId(Buffer.from("Subject: B\r\n\r\nZwei", "utf8"));
    assert.notEqual(a, b);
  });

  it("PDF-Anhang wird Geschäftsdokument, Signaturlogo nicht", () => {
    const pdf = Buffer.from("%PDF-1.4 Bestellung", "utf8");
    // > 80 Bytes, damit das Bild als Signaturkandidat in Frage kommt
    const logo = Buffer.alloc(2048, 7);
    const { commercialParts, signatureImageBuffers } = splitCommercialEmailParts({
      attachments: [
        { content: pdf, filename: "Bestellung_4711.pdf", contentType: "application/pdf" },
        { content: logo, filename: "logo.png", contentType: "image/png" },
      ],
      html: '<p>Gruß</p><img src="cid:logo.png">',
    });

    assert.equal(commercialParts.length, 1, "genau ein Geschäftsdokument erwartet");
    assert.equal(commercialParts[0].filename, "Bestellung_4711.pdf");
    assert.equal(signatureImageBuffers.length, 1, "Logo als Signaturbild erwartet");
    assert.equal(signatureImageBuffers[0].mimeType, "image/png");
  });

  it("gescanntes Bestell-Bild bleibt Geschäftsdokument", () => {
    // Ein großer Scan ohne Signatur-Merkmale darf NICHT als Signatur eingestuft werden.
    const scan = Buffer.alloc(600_000, 3);
    const { commercialParts, signatureImageBuffers } = splitCommercialEmailParts({
      attachments: [{ content: scan, filename: "Scan_Bestellung.jpg", contentType: "image/jpeg" }],
      html: null,
    });
    assert.equal(signatureImageBuffers.length, 0, "Scan darf kein Signaturbild sein");
    assert.equal(commercialParts.length, 1);
    assert.equal(commercialParts[0].filename, "Scan_Bestellung.jpg");
  });

  it("mehrere Bestell-PDFs ergeben mehrere Geschäftsdokumente", () => {
    const { commercialParts } = splitCommercialEmailParts({
      attachments: [
        { content: Buffer.from("%PDF a"), filename: "Bestellung_1.pdf", contentType: "application/pdf" },
        { content: Buffer.from("%PDF b"), filename: "Bestellung_2.pdf", contentType: "application/pdf" },
      ],
      html: null,
    });
    assert.equal(commercialParts.length, 2);
  });

  it("Mail ohne Anhänge liefert keine Geschäftsdokumente", () => {
    const { commercialParts, signatureImageBuffers } = splitCommercialEmailParts({
      attachments: [],
      html: null,
    });
    assert.equal(commercialParts.length, 0);
    assert.equal(signatureImageBuffers.length, 0);
  });
});
