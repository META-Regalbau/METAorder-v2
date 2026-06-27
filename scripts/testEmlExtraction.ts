/**
 * Fixture-Tests für EML: Signatur-Label, verschachtelte Nachricht, Anhang-Abschnitt.
 * Ausführen: npx tsx scripts/testEmlExtraction.ts
 */
import assert from "node:assert/strict";
import {
  splitEmailBodyMainAndSignature,
  formatParsedEmailForDraftExpanded,
} from "../server/documentTextExtraction.ts";
import { parseEmlFile } from "../server/emailParser.ts";

function fail(msg: string): never {
  throw new Error(msg);
}

async function main() {
  const body =
    "Sehr geehrte Damen und Herren,\n\nbitte um ein Angebot für die unten genannten Artikel.\n\nMit freundlichen Grüßen\n\nMax Mustermann\nMuster GmbH\nmax@muster.de\n+49 30 12345";
  const split = splitEmailBodyMainAndSignature(body);
  assert.ok(split.signature, "Signatur soll erkannt werden");
  assert.match(split.signature || "", /Mit freundlichen Grüßen/);
  assert.match(split.main || "", /bitte um ein Angebot/);

  const nestedInner =
    "From: inner@kunde.de\r\n" +
    "To: shop@meta.de\r\n" +
    "Subject: Innere Anfrage\r\n" +
    "MIME-Version: 1.0\r\n" +
    "Content-Type: text/plain; charset=utf-8\r\n" +
    "\r\n" +
    "Produktzeile INNER_UNIQUE_MARKER_42 Stück 10\r\n";

  const outerEml =
    "From: aussen@firma.de\r\n" +
    "To: vertrieb@meta.de\r\n" +
    "Subject: AW: Angebot\r\n" +
    "MIME-Version: 1.0\r\n" +
    "Content-Type: multipart/mixed; boundary=\"outer123\"\r\n" +
    "\r\n" +
    "--outer123\r\n" +
    "Content-Type: text/plain; charset=utf-8\r\n" +
    "\r\n" +
    "Hallo, anbei die Details.\r\n" +
    "\r\n" +
    "--outer123\r\n" +
    "Content-Type: message/rfc822\r\n" +
    "Content-Disposition: attachment; filename=\"inner.eml\"\r\n" +
    "\r\n" +
    nestedInner.replace(/\n/g, "\r\n") +
    "\r\n" +
    "--outer123--\r\n";

  const buf = Buffer.from(outerEml, "utf8");
  const parsed = await parseEmlFile(buf);
  const expanded = await formatParsedEmailForDraftExpanded(parsed, { ocrEnabled: false });

  assert.match(expanded, /\[Eingebettete Nachricht:/, "Verschachtelte EML soll Abschnitt erzeugen");
  assert.match(expanded, /INNER_UNIQUE_MARKER_42/, "Inhalt der inneren Mail soll im Text landen");

  const simpleEml =
    "From: x@y.de\r\nSubject: T\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nHi";
  const p2 = await parseEmlFile(Buffer.from(simpleEml, "utf8"));
  const ex2 = await formatParsedEmailForDraftExpanded(p2, { ocrEnabled: false });
  assert.match(ex2, /Betreff: T/, "Einfache EML ohne Anhänge");

  console.log("testEmlExtraction: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
