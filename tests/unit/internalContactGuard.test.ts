/**
 * Namen aus der internen Weiterleitung sind keine Kundenkontakte (Live 11.10.2026, Böttcher AG:
 * Kunde „Oliver Steiling“, weil die KI den Absender der Weiterleitung übernahm).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { collectInternalIdentities, stripInternalContacts } from "../../server/extraction/internalContactGuard";
import { enrichExtractedDataFromEmailHeaders } from "../../server/extraction/emailHeaderContactEnrichment";

const MAIL = [
  "Betreff: WG: Bestellung 4711",
  "Von: Oliver Steiling <OSteiling@meta-online.com>",
  "",
  "-----Ursprüngliche Nachricht-----",
  "Von: Bestellwesen Böttcher AG <bestellwesen@bueromarkt-ag.de>",
  "An: \"Nöcker, Isabell\" <inoecker@meta-online.com>",
  "Bitte liefern Sie 2 Regale.",
].join("\n");

describe("Interne Identitäten", () => {
  it("Namen und Adressen mit eigener Domain, auch „Nachname, Vorname“", () => {
    const ids = collectInternalIdentities([MAIL]);
    assert.ok(ids.emails.has("osteiling@meta-online.com"));
    assert.ok(ids.emails.has("inoecker@meta-online.com"));
    assert.ok(!ids.emails.has("bestellwesen@bueromarkt-ag.de"));
    assert.ok(ids.names.has("oliver steiling"));
    assert.ok(ids.names.has("isabell nocker"));
  });
});

describe("Kontakte bereinigen", () => {
  it("Böttcher: Weiterleitender raus aus Kunde, Rechnung, Ansprechpartner; Kundendaten bleiben", () => {
    const data: Record<string, any> = {
      customer: { firstName: "Oliver", lastName: "Steiling", email: "bestellwesen@bueromarkt-ag.de", company: "Böttcher AG" },
      billingAddress: { firstName: "Oliver", lastName: "Steiling", company: "Böttcher AG", street: "Weg 1" },
      shippingAddress: { firstName: "Isabell", lastName: "Nöcker" },
      documentExtraction: { buyer: { contact_person: "Steiling, Oliver", email: "OSteiling@meta-online.com" } },
      documentReferences: { deliveryContactName: "Oliver Steiling", orderConfirmationEmail: "osteiling@meta-online.com" },
    };
    const removed = stripInternalContacts(data, [MAIL]);
    assert.equal(data.customer.firstName, undefined);
    assert.equal(data.customer.email, "bestellwesen@bueromarkt-ag.de");
    assert.equal(data.customer.company, "Böttcher AG");
    assert.equal(data.billingAddress.lastName, undefined);
    assert.equal(data.billingAddress.street, "Weg 1");
    assert.equal(data.shippingAddress.lastName, undefined);
    assert.equal(data.documentExtraction.buyer.contact_person, null);
    assert.equal(data.documentExtraction.buyer.email, null);
    assert.equal(data.documentReferences.deliveryContactName, undefined);
    assert.equal(data.documentReferences.orderConfirmationEmail, undefined);
    assert.ok(removed.length >= 7);
  });

  it("echter Kundenkontakt bleibt", () => {
    const data: Record<string, any> = { customer: { firstName: "Heike", lastName: "Eichler", email: "heike.eichler@mercateo.com" } };
    assert.deepEqual(stripInternalContacts(data, [MAIL]), []);
    assert.equal(data.customer.lastName, "Eichler");
  });
});

describe("Kopfzeilen-Ergänzung", () => {
  it("übernimmt keinen eigenen Absender", () => {
    const data: Record<string, any> = {};
    assert.equal(enrichExtractedDataFromEmailHeaders(data, "Von: Oliver Steiling <OSteiling@meta-online.com>\n\nText"), false);
    assert.equal(data.customer, undefined);
    assert.equal(enrichExtractedDataFromEmailHeaders(data, "Von: Jan Kunde <jan@kunde.de>\n\nText"), true);
    assert.equal(data.customer.lastName, "Kunde");
  });
});
