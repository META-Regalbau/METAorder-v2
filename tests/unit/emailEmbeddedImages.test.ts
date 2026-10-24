/**
 * Eingebettete Bilder (cid) im E-Mail-Eingang: Mailtext-Beiwerk oder fotografierte Bestellung?
 *
 * Anlass T-1086 (20.10.2026): Antwort „Hier kommt die Rechnung" mit image002–004 inline im
 * HTML, alle über 450 KB — jedes Bild wäre ein eigener Entwurf geworden. Die Bilder hier sind
 * synthetisch (nur gültiger Dateikopf mit Maßen, Rest Füllbytes), keine Kundendaten.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { splitCommercialEmailParts } from "../../server/commercial/commercialEmailUploadIngest";
import { collectMailDecorationBuffers } from "../../server/commercial/commercialSignatureImageCandidates";
import { parseEmailBufferAutodetect } from "../../server/email/emailParser";

function png(width: number, height: number, size: number): Buffer {
  const buf = Buffer.alloc(size, 0x11);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(buf, 0);
  buf.write("IHDR", 12, "latin1");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function jpeg(width: number, height: number, size: number): Buffer {
  const buf = Buffer.alloc(size, 0x22);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]).copy(buf, 0);
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  return buf;
}

function embedded(content: Buffer, filename: string, cid: string, contentType: string) {
  return { content, filename, contentType, contentDisposition: "inline", cid, related: true };
}

const pdf = (name: string) => ({
  content: Buffer.from("%PDF-1.4 Rechnung"),
  filename: name,
  contentType: "application/pdf",
  contentDisposition: "attachment",
});

/** Outlook-Antwort: eigener Text, Trennlinie, zitierter Verlauf mit Signaturbildern */
const outlookReply = (ownHtml: string, quotedHtml: string) =>
  `<html><body><div class=WordSection1><p class=MsoNormal>${ownHtml}</p>` +
  `<div style='border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm'>` +
  `<p class=MsoNormal><b>Von:</b> Einkauf &lt;einkauf@kunde.example&gt;<br><b>Gesendet:</b> Montag<br>` +
  `<b>Betreff:</b> AW: Bestellung</p></div>${quotedHtml}</div></body></html>`;

const iphoneHtml = (cid: string) =>
  `<html><body dir="auto"><img src="cid:${cid}" alt="image0.jpeg"><br><br>` +
  `<div dir="ltr">Gesendet von meinem iPhone</div></body></html>`;

function names(parts: Array<{ filename: string }>): string[] {
  return parts.map((p) => p.filename).sort();
}

describe("eingebettete Bilder im E-Mail-Eingang", () => {
  it("T-1086: Antwort mit Rechnung — große Inline-Bilder im Verlauf erzeugen keine Entwürfe", () => {
    const { commercialParts } = splitCommercialEmailParts(
      {
        attachments: [
          embedded(png(1600, 1000, 480_000), "image002.png", "image002.png@01DB2A", "image/png"),
          embedded(png(9992, 9992, 626_000), "image003.png", "image003.png@01DB2A", "image/png"),
          embedded(jpeg(2000, 1500, 700_000), "image004.jpg", "image004.jpg@01DB2A", "image/jpeg"),
          pdf("Rechnung_2026-1187.pdf"),
        ],
        html: outlookReply(
          "Hier kommt die Rechnung",
          '<img src="cid:image002.png@01DB2A"><img src="cid:image003.png@01DB2A"><img src="cid:image004.jpg@01DB2A">',
        ),
      },
      { subject: "AW: Bestellung" },
    );
    assert.deepEqual(names(commercialParts), ["Rechnung_2026-1187.pdf"]);
  });

  it("Antwort ohne Dokument: Fotos aus dem zitierten Verlauf erzeugen keinen Entwurf", () => {
    const { commercialParts } = splitCommercialEmailParts(
      {
        attachments: [embedded(jpeg(3024, 4032, 1_400_000), "image001.jpg", "image001.jpg@01DB2A", "image/jpeg")],
        html: outlookReply("Danke, passt so.", '<img src="cid:image001.jpg@01DB2A">'),
      },
      { subject: "AW: Bestellung vom 12.10." },
    );
    assert.equal(commercialParts.length, 0);
  });

  it("iPhone-Foto einer Bestellung bleibt Entwurfsquelle", () => {
    const photo = embedded(jpeg(3024, 4032, 1_800_000), "image0.jpeg", "A1B2C3D4-0001", "image/jpeg");
    const { commercialParts, signatureImageBuffers } = splitCommercialEmailParts(
      { attachments: [photo], html: iphoneHtml("A1B2C3D4-0001") },
      { subject: "Bestellung" },
    );
    assert.deepEqual(names(commercialParts), ["image0.jpeg"]);
    assert.equal(signatureImageBuffers.length, 0, "1,8 MB sind kein Signaturkandidat");
  });

  it("iPhone-Foto als HEIC (Maße nicht lesbar) bleibt Entwurfsquelle", () => {
    const heic = Buffer.alloc(1_200_000, 0x33);
    heic.write("ftypheic", 4, "latin1");
    const { commercialParts } = splitCommercialEmailParts({
      attachments: [embedded(heic, "IMG_4711.HEIC", "heic-1", "image/heic")],
      html: iphoneHtml("heic-1"),
    });
    assert.deepEqual(names(commercialParts), ["IMG_4711.HEIC"]);
  });

  it("zwei fotografierte Seiten ergeben zwei Entwurfsquellen", () => {
    const { commercialParts } = splitCommercialEmailParts({
      attachments: [
        embedded(jpeg(3024, 4032, 1_500_000), "image0.jpeg", "p1", "image/jpeg"),
        embedded(jpeg(3024, 4032, 1_400_000), "image1.jpeg", "p2", "image/jpeg"),
      ],
      html: '<img src="cid:p1"><br><img src="cid:p2"><br>Gesendet von meinem iPhone',
    });
    assert.deepEqual(names(commercialParts), ["image0.jpeg", "image1.jpeg"]);
  });

  it("eingebettetes Foto neben einem PDF: nur das PDF ist das Dokument", () => {
    const { commercialParts } = splitCommercialEmailParts({
      attachments: [
        embedded(jpeg(2400, 1800, 900_000), "image001.jpg", "image001.jpg@01DB2A", "image/jpeg"),
        pdf("Bestellung_4711.pdf"),
      ],
      html: '<p>Anbei die Bestellung.</p><img src="cid:image001.jpg@01DB2A">',
    });
    assert.deepEqual(names(commercialParts), ["Bestellung_4711.pdf"]);
  });

  it("großes quadratisches Logo im eigenen Teil ist kein Dokument", () => {
    const { commercialParts } = splitCommercialEmailParts({
      attachments: [embedded(png(1200, 1200, 520_000), "image001.png", "image001.png@01DB2A", "image/png")],
      html: '<p>Bitte um Angebot für 10 Fachböden.</p><p>Gruß</p><img src="cid:image001.png@01DB2A">',
    });
    assert.equal(commercialParts.length, 0);
  });

  it("9992×9992-Grafik (T-1086 image003) ist auch allein kein Dokument", () => {
    const { commercialParts } = splitCommercialEmailParts({
      attachments: [embedded(png(9992, 9992, 626_000), "image003.png", "image003.png@01DB2A", "image/png")],
      html: '<p>Hier kommt die Rechnung</p><img src="cid:image003.png@01DB2A">',
    });
    assert.equal(commercialParts.length, 0);
  });

  it("breites Werbebanner in der Signatur ist kein Dokument", () => {
    const { commercialParts } = splitCommercialEmailParts({
      attachments: [embedded(jpeg(2400, 600, 520_000), "image002.jpg", "image002.jpg@01DB2A", "image/jpeg")],
      html: '<p>Bitte um Rückruf.</p><img src="cid:image002.jpg@01DB2A">',
    });
    assert.equal(commercialParts.length, 0);
  });

  it("Kunde leitet ein Bestellfoto weiter (WG:): Foto im Verlauf bleibt Entwurfsquelle", () => {
    const { commercialParts } = splitCommercialEmailParts(
      {
        attachments: [embedded(jpeg(3024, 4032, 1_300_000), "image001.jpg", "image001.jpg@01DB2A", "image/jpeg")],
        html: outlookReply("Bitte so liefern.", '<img src="cid:image001.jpg@01DB2A">'),
      },
      { subject: "WG: Bestellung Lager" },
    );
    assert.deepEqual(names(commercialParts), ["image001.jpg"]);
  });

  it("interne Weiterleitung: Kundenfoto im Verlauf bleibt Entwurfsquelle", () => {
    const { commercialParts } = splitCommercialEmailParts(
      {
        attachments: [embedded(jpeg(3024, 4032, 1_300_000), "image001.jpg", "image001.jpg@01DB2A", "image/jpeg")],
        html: outlookReply("Moin, anbei eine Bestellung", '<img src="cid:image001.jpg@01DB2A">'),
      },
      { subject: "Bestellung", internalForward: true },
    );
    assert.deepEqual(names(commercialParts), ["image001.jpg"]);
  });

  it("echter Bildanhang (ohne Content-ID) bleibt wie bisher Entwurfsquelle", () => {
    const { commercialParts } = splitCommercialEmailParts({
      attachments: [
        {
          content: jpeg(1600, 1600, 600_000),
          filename: "Bestellung.jpg",
          contentType: "image/jpeg",
          contentDisposition: "attachment",
        },
      ],
      html: outlookReply("Anbei", ""),
    });
    assert.deepEqual(names(commercialParts), ["Bestellung.jpg"]);
  });

  it("HTML mit data:-URIs (Position unbekannt): multipart/related reicht als Einbettungsmerkmal", () => {
    const logo = embedded(png(1200, 1200, 520_000), "image001.png", "image001.png@01DB2A", "image/png");
    const photo = embedded(jpeg(3024, 4032, 1_300_000), "image0.jpeg", "p1", "image/jpeg");
    const html = '<img src="data:image/png;base64,AAAA"><blockquote>alt</blockquote>';
    const decoration = collectMailDecorationBuffers([logo, photo], html);
    assert.ok(decoration.has(logo.content), "Logo ist Beiwerk");
    assert.ok(!decoration.has(photo.content), "Foto ohne bekannte Position wird nicht verworfen");
  });

  it("geparste .eml behält cid:-Verweise; eingebettetes Signaturbild > 450 KB wird kein Entwurf", async () => {
    const banner = jpeg(2400, 600, 480_000);
    const eml = [
      "From: Einkauf <einkauf@kunde.example>",
      "To: bestellung@meta.example",
      "Subject: AW: Rechnung",
      "Message-ID: <t1086-synthetic@kunde.example>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="mix"',
      "",
      "--mix",
      'Content-Type: multipart/related; boundary="rel"',
      "",
      "--rel",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>Hier kommt die Rechnung</p><img src="cid:image002.jpg@01DB2A">',
      "--rel",
      'Content-Type: image/jpeg; name="image002.jpg"',
      'Content-Disposition: inline; filename="image002.jpg"',
      "Content-ID: <image002.jpg@01DB2A>",
      "Content-Transfer-Encoding: base64",
      "",
      banner.toString("base64").replace(/.{76}/g, "$&\r\n"),
      "--rel--",
      "--mix",
      'Content-Type: application/pdf; name="Rechnung.pdf"',
      'Content-Disposition: attachment; filename="Rechnung.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("%PDF-1.4 Rechnung").toString("base64"),
      "--mix--",
      "",
    ].join("\r\n");
    const parsed = await parseEmailBufferAutodetect(Buffer.from(eml, "utf8"));
    assert.ok(parsed.html?.includes("cid:image002.jpg@01DB2A"), "cid:-Verweis muss im HTML bleiben");
    assert.ok(!parsed.html?.includes("data:image"), "keine data:-URIs im HTML");
    const { commercialParts } = splitCommercialEmailParts(parsed, { subject: parsed.subject });
    assert.deepEqual(names(commercialParts), ["Rechnung.pdf"]);
  });
});
