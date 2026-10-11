/**
 * Fehler aus dem ersten Live-Abruf (11.10.2026, Bestellung per Mail mit zwei EANs):
 * - Positionen nur mit EAN (Beschreibung leer) liefen nicht in den Katalogabgleich
 * - Kopfzeile „Info Oliver <info@…>“ ergab Vorname „Info“
 * - HTML im Mailtext landete in der Adress-/Firmenerkennung
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { shouldSkipCatalogMatchingForLineItem } from "../../server/extraction/lineItemProductScreening";
import { parseEmailHeaderContact } from "../../server/extraction/emailHeaderContactEnrichment";
import { translateDocumentExtractionToLegacy } from "../../server/extraction/documentExtractionTranslate";
import { htmlToPlainText, parseEmailBufferAutodetect } from "../../server/email/emailParser";
import { EMPTY_DOCUMENT_EXTRACTION_REFERENCES } from "../../shared/documentExtractionSchema";

describe("Positionen nur mit Artikelnummer", () => {
  it("EAN ohne Beschreibung geht in den Katalogabgleich", () => {
    assert.equal(shouldSkipCatalogMatchingForLineItem({ extractedProductName: "", extractedProductNumber: "4026212325393", quantity: 4 }).skip, false);
    assert.equal(shouldSkipCatalogMatchingForLineItem({ extractedProductName: "", extractedProductNumber: "MC-S3-2010", quantity: 1 }).skip, false);
  });

  it("ganz leere Zeile und kurze Zahl ohne Bezug bleiben draußen", () => {
    assert.deepEqual(shouldSkipCatalogMatchingForLineItem({ extractedProductName: "", quantity: 1 }), { skip: true, reason: "leer" });
    assert.equal(shouldSkipCatalogMatchingForLineItem({ extractedProductName: "", extractedProductNumber: "12", quantity: 1 }).skip, true);
  });

  it("strukturierte Extraktion: Nummer wird auch Name, wenn die Beschreibung fehlt", () => {
    const legacy = translateDocumentExtractionToLegacy({
      document: { type: "purchase_order", number: "12345", date: null, delivery_date: null, currency: "EUR", language: "de", total_net: null, buyer_is_meta: false, recipient_is_meta: false },
      buyer: { company: null, contact_person: "Oliver", street: null, zip: null, city: null, country: null, email: "info@indiesemsinne.de", phone: null, vat_id: null, customer_number: null },
      delivery_address: { same_as_buyer: true, company: null, street: null, zip: null, city: null, country: null, delivery_window: null },
      line_items: [
        { position: 1, quantity: 4, unit: "Stück", description: "", supplier_sku: "4026212325393", buyer_sku: null, alternative_skus: [], unit_price_net: null, line_total_net: null, attributes: { color: null, system: null, surface: null, dimensions_raw: null }, confidence_warnings: [] },
        { position: 2, quantity: 1, unit: "Stück", description: "Fachboden 1000x400", supplier_sku: "4026212434125", buyer_sku: null, alternative_skus: [], unit_price_net: null, line_total_net: null, attributes: { color: null, system: null, surface: null, dimensions_raw: null }, confidence_warnings: [] },
      ],
      terms: { payment: null, incoterms: null, partial_delivery_allowed: null, notes: null },
      references: EMPTY_DOCUMENT_EXTRACTION_REFERENCES,
      extraction_meta: { overall_confidence: "low", warnings: [], calculated_total_net: null, total_matches_calculated: null },
    } as never);
    assert.equal(legacy.lineItems?.[0].extractedProductName, "4026212325393");
    assert.equal(legacy.lineItems?.[1].extractedProductName, "Fachboden 1000x400");
  });
});

describe("Kopfzeile: Sammelpostfächer sind keine Personen", () => {
  it("„Info Oliver“ → nur Nachname Oliver", () => {
    assert.deepEqual(parseEmailHeaderContact("Von: Info Oliver <info@indiesemsinne.de>"), { lastName: "Oliver", email: "info@indiesemsinne.de" });
  });

  it("reiner Rollenname ergibt keinen Namen, echte Namen bleiben", () => {
    assert.deepEqual(parseEmailHeaderContact('From: "Einkauf" <einkauf@kunde.de>'), { email: "einkauf@kunde.de" });
    assert.deepEqual(parseEmailHeaderContact("Von: Anna Berger <a.berger@kunde.de>"), { firstName: "Anna", lastName: "Berger", email: "a.berger@kunde.de" });
  });
});

describe("HTML im Mailtext", () => {
  it("wird zu Text mit Zeilenumbrüchen", () => {
    const text = htmlToPlainText(
      '<style>p{}</style><div>4x 4026212325393</div><table border="0" cellspacing="0" style="padding: 0px"><tr><td>indiesemsinne.de<br>Sch&uuml;ttweg&nbsp;3<br>59494 Soest</td></tr></table>',
    );
    assert.ok(!text.includes("<"), text);
    assert.match(text, /4x 4026212325393\nindiesemsinne\.de\nSchüttweg 3\n59494 Soest/);
  });

  it("Apple Mail: <br class=\"\"> und <div class=\"\"> trennen Zeilen, unsichtbare Zeichen fallen weg", () => {
    // so kam die zweite Live-Testmail an: alles zusammengeklebt, PLZ aus der EAN gelesen
    const text = htmlToPlainText(
      '<div class="">2x 4026212434125</div><div class=""><br class=""></div><div class="">Liebe Grüße<br class="">Oliver<br class="">indiesemsinne.de<br class="">Schüttweg 3<br class="">59494 Soest<br class="">USt.ID: DE815873054&zwj;\u200d</div>',
    );
    assert.equal(text, "2x 4026212434125\n\nLiebe Grüße\nOliver\nindiesemsinne.de\nSchüttweg 3\n59494 Soest\nUSt.ID: DE815873054");
  });

  it("Textteil mit HTML wird beim Lesen der Mail umgewandelt", async () => {
    const eml = [
      "Received: x",
      "From: Oliver <info@indiesemsinne.de>",
      "Subject: Bestellung 12345",
      "Content-Type: text/plain; charset=utf-8",
      "",
      '<table border="0" width="100%"><tr><td>Schüttweg 3<br>59494 Soest</td></tr></table>',
    ].join("\r\n");
    const parsed = await parseEmailBufferAutodetect(Buffer.from(eml));
    assert.equal(parsed.body, "Schüttweg 3\n59494 Soest");
  });
});
