/**
 * Übergabe von Entwurfsdaten in die Zusatzfelder der Shopware-Bestellung (Entscheidung 12.10.2026):
 * Einstellung normalisieren, Werte je Feldtyp, Kundenbestellnummer vorne im Kommissionstext,
 * Wunschtermin, Positionstexte, Besteller/Vertriebsmitarbeiter nur bei eindeutigem Treffer.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  DEFAULT_ORDER_FIELD_MAPPING,
  DELIVERY_DATE_TARGET,
  normalizeOrderFieldMapping,
} from "../../shared/orderFieldMapping";
import {
  buildOrderFieldValues,
  collectLineCustomerTexts,
  collectOrderFieldInputs,
  ordererEmailCandidates,
  parseRequestedDeliveryDate,
} from "../../server/shopware/orderFieldValues";
import { resolveOrderPeople, salesRepIdOf, type PeopleLookup } from "../../server/shopware/orderPeople";

const NOW = new Date("2026-10-12T09:00:00Z");

describe("Einstellung", () => {
  it("leer → Standard; ERP-Felder, kaputte Namen und Dubletten fliegen raus; Wunschtermin nur ins Lieferfeld", () => {
    assert.deepEqual(normalizeOrderFieldMapping(undefined), DEFAULT_ORDER_FIELD_MAPPING);
    const n = normalizeOrderFieldMapping({
      enabled: false,
      targets: {
        commission: [
          { field: "wdu_sap_order_number", type: "text" },
          { field: "custom_order_numbers_ab", type: "text" },
          { field: "b2b_order_customer_commission", type: "text" },
          { field: "b2b_order_customer_commission", type: "text" },
          { field: "x y", type: "text" },
          { field: DELIVERY_DATE_TARGET, type: "datetime" },
        ],
        deliveryDate: [{ field: "b2b_order_customer_note", type: "text" }],
        notes: [],
      },
    });
    assert.equal(n.enabled, false);
    assert.deepEqual(n.targets.commission, [{ field: "b2b_order_customer_commission", type: "text" }]);
    assert.deepEqual(n.targets.deliveryDate, []);
    assert.deepEqual(n.targets.notes, []);
    // nicht genannte Quellen behalten den Standard
    assert.deepEqual(n.targets.invoiceEmail, DEFAULT_ORDER_FIELD_MAPPING.targets.invoiceEmail);
  });
});

describe("Feldwerte", () => {
  it("Standard: Bestellnummer in „Ihr Zeichen“ und vorne im Kommissionstext, AB-Mail als JSON wie im Portal", () => {
    const v = buildOrderFieldValues(DEFAULT_ORDER_FIELD_MAPPING, {
      customerOrderNumber: "4500662763",
      commission: "Halle 3",
      notes: "Anlieferung nur vormittags",
      confirmationEmail: "Einkauf@Kunde.de",
      invoiceEmail: "rechnung@kunde.de",
      offerId: "01a1168b22677267956d082a7d050809",
      ordererEmployeeId: "emp1",
      salesRepresentativeId: "rep1",
    });
    assert.deepEqual(v.order, {
      custom_buyerreference_invoice: "4500662763",
      b2b_order_customer_commission: "4500662763 / Halle 3",
      b2b_order_customer_note: "Anlieferung nur vormittags",
      b2b_order_mail_recipients: { "einkauf@kunde.de": "einkauf@kunde.de" },
      custom_invoice_email_address: "rechnung@kunde.de",
      b2bsellers_offer_id: "01a1168b22677267956d082a7d050809",
      b2b_order_customer_employee_id: "emp1",
      b2b_order_sales_representative_id: "rep1",
    });
  });

  it("nur Kommission ohne Bestellnummer; leere Werte werden nicht übergeben; ausgeschaltet → nichts", () => {
    const v = buildOrderFieldValues(DEFAULT_ORDER_FIELD_MAPPING, { commission: "AB26.14809", notes: "  ", confirmationEmail: "keine-mail" });
    assert.deepEqual(v.order, { b2b_order_customer_commission: "AB26.14809" });
    const off = buildOrderFieldValues({ ...DEFAULT_ORDER_FIELD_MAPPING, enabled: false }, { commission: "X" });
    assert.deepEqual(off.order, {});
    assert.equal(off.applied.length, 0);
  });

  it("Wunschtermin in die Lieferung, Positionstexte je Produkt", () => {
    const v = buildOrderFieldValues(DEFAULT_ORDER_FIELD_MAPPING, {
      deliveryDate: { earliest: "2026-10-19T00:00:00.000Z", latest: "2026-10-23T00:00:00.000Z" },
      lineCustomerText: new Map([["pa", "Kd.-Art.-Nr. 77 · Boden"]]),
    });
    assert.deepEqual(v.delivery, { shippingDateEarliest: "2026-10-19T00:00:00.000Z", shippingDateLatest: "2026-10-23T00:00:00.000Z" });
    assert.deepEqual(v.lineItems.get("pa"), { b2b_order_line_item_comment: "Kd.-Art.-Nr. 77 · Boden" });
  });
});

describe("Wunschtermin", () => {
  it("Tag, deutsches Datum, Kalenderwoche; Vergangenes und Unlesbares → null", () => {
    assert.deepEqual(parseRequestedDeliveryDate("2026-10-20", NOW), { earliest: "2026-10-20T00:00:00.000Z", latest: "2026-10-20T00:00:00.000Z" });
    assert.deepEqual(parseRequestedDeliveryDate("Liefertermin 20.10.26", NOW), { earliest: "2026-10-20T00:00:00.000Z", latest: "2026-10-20T00:00:00.000Z" });
    // KW 43/2026: Montag 19.10. bis Freitag 23.10.
    assert.deepEqual(parseRequestedDeliveryDate("KW 43", NOW), { earliest: "2026-10-19T00:00:00.000Z", latest: "2026-10-23T00:00:00.000Z" });
    assert.deepEqual(parseRequestedDeliveryDate("KW43/2026", NOW), { earliest: "2026-10-19T00:00:00.000Z", latest: "2026-10-23T00:00:00.000Z" });
    // laufende Woche: ab heute
    assert.deepEqual(parseRequestedDeliveryDate("KW 42", NOW), { earliest: "2026-10-12T00:00:00.000Z", latest: "2026-10-16T00:00:00.000Z" });
    // Woche ohne Jahr schon vorbei → nächstes Jahr
    assert.equal(parseRequestedDeliveryDate("KW 2", NOW)?.earliest, "2027-01-11T00:00:00.000Z");
    assert.equal(parseRequestedDeliveryDate("2026-10-01", NOW), null);
    assert.equal(parseRequestedDeliveryDate("31.02.2027", NOW), null);
    assert.equal(parseRequestedDeliveryDate("asap", NOW), null);
    assert.equal(parseRequestedDeliveryDate(null, NOW), null);
  });
});

describe("Eingaben aus dem Entwurf", () => {
  const draft = {
    buyerDocumentNumber: "4500662763",
    extractedData: {
      orderNotes: "Teillieferung erlaubt: nein",
      documentReferences: { commission: "4500662763", deliveryNoteInstructions: "Lieferschein 2-fach", orderConfirmationEmail: "ab@kunde.de" },
      documentExtraction: {
        document: { number: "ignoriert", delivery_date: "KW 43" },
        line_items: [
          { position: 10, description: "Fachboden 1000x400", buyer_sku: "921027516" },
          { position: 20, description: "Andere Zeile", buyer_sku: "111" },
        ],
      },
      offerReference: { offerId: "off1", noteCode: "already_matched" },
    },
    matchingResults: {
      items: [
        { extractedProductName: "Fachboden 1000x400", extractedPositionNumber: "10", matchedProduct: { id: "AB-CD" } },
        { extractedProductName: "Fachboden 1000x400", extractedPositionNumber: "30", matchedProduct: { id: "ab-cd" } },
        // Position passt, Text nicht (z. B. nach Stücklisten-Auflösung) → keine Kunden-Artikelnummer
        { extractedProductName: "Stütze", extractedPositionNumber: "20", matchedProduct: { id: "ef" } },
        { extractedProductName: "Set", bundle: {}, matchedProduct: null },
      ],
    },
  };

  it("Bestellnummer aus dem Entwurf, Kommission gleich Bestellnummer nur einmal, Hinweise zusammen, Angebot", () => {
    const i = collectOrderFieldInputs(draft, NOW);
    assert.equal(i.customerOrderNumber, "4500662763");
    assert.equal(i.commission, null);
    assert.equal(i.notes, "Teillieferung erlaubt: nein\nLieferschein/Anlieferung: Lieferschein 2-fach");
    assert.equal(i.confirmationEmail, "ab@kunde.de");
    assert.equal(i.offerId, "off1");
    assert.equal(i.deliveryDate?.earliest, "2026-10-19T00:00:00.000Z");
  });

  it("Angebot eines anderen Kunden wird nicht übergeben", () => {
    const other = { ...draft, extractedData: { ...draft.extractedData, offerReference: { offerId: "off1", noteCode: "other_customer" } } };
    assert.equal(collectOrderFieldInputs(other, NOW).offerId, null);
  });

  it("Positionstexte: Kunden-Artikelnummer nur bei passender Position und Text, gleiche Artikel zusammengefasst", () => {
    const texts = collectLineCustomerTexts(draft.extractedData, draft.matchingResults.items);
    assert.deepEqual(Object.fromEntries(texts), {
      abcd: "Kd.-Art.-Nr. 921027516 · Fachboden 1000x400 | Fachboden 1000x400",
      ef: "Stütze",
    });
  });

  it("E-Mails für den Besteller: Absender vor Beleg-Kontakt, ohne Dubletten", () => {
    assert.deepEqual(
      ordererEmailCandidates({ customer: { email: "Max@Kunde.de" }, documentExtraction: { buyer: { email: "max@kunde.de" } }, documentReferences: { orderConfirmationEmail: "ab@kunde.de" } }),
      ["max@kunde.de", "ab@kunde.de"],
    );
  });
});

describe("Besteller und Vertriebsmitarbeiter", () => {
  const lookup = (over: Partial<PeopleLookup> = {}): PeopleLookup => ({
    employeesByEmail: async (email) => (email === "max@kunde.de" ? [{ id: "e1" }, { id: "e2" }] : email === "ab@kunde.de" ? [{ id: "e3" }] : []),
    activeLink: async (employeeId, customerId) => (customerId === "cust1" && employeeId !== "e2" ? { active: employeeId !== "e3" } : null),
    salesRepAssignments: async () => [{ id: "x", attributes: { customerId: "cust1", salesRepresentativeId: "rep1" } }],
    ...over,
  });

  it("eindeutig verknüpfter, aktiver Mitarbeiter; eigene Adressen werden ignoriert", async () => {
    const p = await resolveOrderPeople(lookup(), { customerId: "CUST1", emails: ["kollege@meta-online.com", "max@kunde.de"], wantOrderer: true, wantSalesRep: true });
    assert.equal(p.ordererEmployeeId, "e1");
    assert.equal(p.ordererNote, "found");
    assert.equal(p.salesRepresentativeId, "rep1");
  });

  it("inaktive Verknüpfung → nicht gefunden; zwei Treffer → nicht eindeutig; Fehler → leer", async () => {
    const inactive = await resolveOrderPeople(lookup(), { customerId: "cust1", emails: ["ab@kunde.de"], wantOrderer: true, wantSalesRep: false });
    assert.deepEqual([inactive.ordererEmployeeId, inactive.ordererNote], [null, "not_found"]);
    const two = await resolveOrderPeople(lookup({ activeLink: async () => ({ active: true }) }), {
      customerId: "cust1",
      emails: ["max@kunde.de"],
      wantOrderer: true,
      wantSalesRep: false,
    });
    assert.deepEqual([two.ordererEmployeeId, two.ordererNote], [null, "ambiguous"]);
    const broken = await resolveOrderPeople(
      lookup({ employeesByEmail: async () => { throw new Error("weg"); }, salesRepAssignments: async () => { throw new Error("404"); } }),
      { customerId: "cust1", emails: ["max@kunde.de"], wantOrderer: true, wantSalesRep: true },
    );
    assert.deepEqual([broken.ordererNote, broken.salesRepNote, broken.salesRepresentativeId], ["error", "error", null]);
  });

  it("mehrere Vertriebsmitarbeiter → keiner; Feldname je Plugin-Version", async () => {
    const many = await resolveOrderPeople(
      lookup({ salesRepAssignments: async () => [{ salesRepresentativeId: "r1" }, { salesRepresentativeCustomerId: "r2" }] }),
      { customerId: "cust1", emails: [], wantOrderer: false, wantSalesRep: true },
    );
    assert.deepEqual([many.salesRepresentativeId, many.salesRepNote], [null, "ambiguous"]);
    assert.equal(salesRepIdOf({ attributes: { customerId: "c", mySalesRepId: "r9" } }), "r9");
    assert.equal(salesRepIdOf({ customerId: "c" }), null);
  });
});
