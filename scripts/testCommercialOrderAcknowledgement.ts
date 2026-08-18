/**
 * Unit-Tests für die Auftragsbestätigung an das Kunden-ERP.
 *
 *   npm run test:order-acknowledgement
 */

import assert from "node:assert/strict";
import {
  buildOrderAcknowledgement,
  extractBuyerDocumentNumber,
  mapDraftStatusToAcknowledgement,
} from "../server/commercialOrderAcknowledgement";

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

const NOW = new Date("2026-08-14T09:12:00.000Z");

function draftWith(overrides: Record<string, unknown> = {}) {
  return {
    status: "review_required",
    createdAt: NOW,
    updatedAt: NOW,
    shopwareOrderId: null,
    extractedData: {
      documentExtraction: {
        document: { type: "purchase_order", number: "PO-4711", currency: "EUR" },
        line_items: [
          {
            position: 10,
            quantity: 12,
            unit: "Stk",
            buyer_sku: "KD-88231",
            description: "Holm 1000 mm",
            unit_price_net: 21.5,
          },
        ],
      },
      lineItems: [{ extractedProductName: "Holm 1000 mm", quantity: 12, extractedPrice: 21.5 }],
    },
    matchingResults: {
      overallConfidence: 100,
      items: [
        {
          extractedProductName: "Holm 1000 mm",
          quantity: 6,
          originalQuantity: 12,
          convertedQuantity: 6,
          conversionNote: "1 Holmebene = 2 Holme",
          confidence: 100,
          status: "matched",
          matchedProduct: { id: "p1", productNumber: "4026212260212", name: "Holmebene", price: 43 },
        },
      ],
    },
    ...overrides,
  };
}

console.log("\n=== commercialOrderAcknowledgement Unit Tests ===\n");

check("liest die Belegnummer des Kunden", () => {
  assert.equal(
    extractBuyerDocumentNumber({ documentExtraction: { document: { number: " PO-4711 " } } }),
    "PO-4711"
  );
  assert.equal(extractBuyerDocumentNumber({ documentExtraction: { document: {} } }), null);
  assert.equal(extractBuyerDocumentNumber(null), null);
  assert.equal(extractBuyerDocumentNumber({ documentExtraction: { document: { number: "" } } }), null);
});

check("Statusabbildung: intern → Kundensicht", () => {
  assert.equal(mapDraftStatusToAcknowledgement({ status: "pending" }), "in_review");
  assert.equal(mapDraftStatusToAcknowledgement({ status: "review_required" }), "in_review");
  // approved heißt intern nur „Extraktion sauber", nicht „wir liefern"
  assert.equal(mapDraftStatusToAcknowledgement({ status: "approved" }), "in_review");
  assert.equal(mapDraftStatusToAcknowledgement({ status: "rejected" }), "rejected");
  assert.equal(
    mapDraftStatusToAcknowledgement({ status: "created", shopwareOrderId: "o1" }),
    "confirmed"
  );
});

check("created ohne Shopware-Beleg gilt nicht als bestätigt", () => {
  assert.equal(
    mapDraftStatusToAcknowledgement({ status: "created", shopwareOrderId: null }),
    "in_review"
  );
});

check("Mengenumrechnung wird als quantity_changed gemeldet", () => {
  const ack = buildOrderAcknowledgement({ draft: draftWith(), draftKind: "order" });
  assert.equal(ack.buyer_document_number, "PO-4711");
  assert.equal(ack.document_type, "purchase_order");
  assert.equal(ack.status, "in_review");
  assert.equal(ack.line_items.length, 1);

  const line = ack.line_items[0];
  assert.equal(line.status, "quantity_changed");
  assert.equal(line.position, 10);
  assert.equal(line.buyer_sku, "KD-88231", "Kundenartikelnummer muss zurückkommen");
  assert.equal(line.supplier_sku, "4026212260212");
  assert.equal(line.quantity_ordered, 12);
  assert.equal(line.quantity_confirmed, 6);
  assert.equal(line.note, "1 Holmebene = 2 Holme");
});

check("in Prüfung: keine bestätigten Preise, keine Belegnummer", () => {
  const ack = buildOrderAcknowledgement({ draft: draftWith(), draftKind: "order" });
  assert.equal(ack.supplier_order_number, null);
  assert.equal(ack.total_confirmed_net, null);
  assert.equal(ack.line_items[0].unit_price_confirmed_net, null);
  // Der vom Kunden genannte Preis wird gespiegelt, damit er die Erfassung prüfen kann
  assert.equal(ack.line_items[0].unit_price_ordered_net, 21.5);
});

check("bestätigt: Preise stammen aus der Shopware-Bestellung", () => {
  const ack = buildOrderAcknowledgement({
    draft: draftWith({ status: "created", shopwareOrderId: "o1" }),
    draftKind: "order",
    shopwareOrder: {
      orderNumber: "SW-10023",
      amountNet: 258,
      lineItems: [
        { productNumber: "4026212260212", quantity: 6, unitPrice: 43, totalPrice: 258 },
      ],
    },
  });
  assert.equal(ack.status, "confirmed");
  assert.equal(ack.supplier_order_number, "SW-10023");
  assert.equal(ack.total_confirmed_net, 258);
  assert.equal(ack.line_items[0].unit_price_confirmed_net, 43);
  assert.equal(ack.line_items[0].line_total_confirmed_net, 258);
});

check("Shopware-Preise werden über die Artikelnummer zugeordnet, nicht über die Reihenfolge", () => {
  const draft = draftWith({ status: "created", shopwareOrderId: "o1" });
  const ack = buildOrderAcknowledgement({
    draft,
    draftKind: "order",
    shopwareOrder: {
      orderNumber: "SW-1",
      amountNet: 258,
      lineItems: [
        { productNumber: "9999999999999", quantity: 1, unitPrice: 5, totalPrice: 5 },
        { productNumber: "4026212260212", quantity: 6, unitPrice: 43, totalPrice: 258 },
      ],
    },
  });
  assert.equal(ack.line_items[0].unit_price_confirmed_net, 43);
});

check("nicht zugeordnete Position fordert Klärung und nennt keine Menge", () => {
  const draft = draftWith({
    matchingResults: {
      overallConfidence: 0,
      items: [{ extractedProductName: "Sonderteil", quantity: 3, status: "not_found", confidence: 0 }],
    },
  });
  const ack = buildOrderAcknowledgement({ draft, draftKind: "order" });
  assert.equal(ack.line_items[0].status, "clarification_required");
  assert.equal(ack.line_items[0].supplier_sku, null);
  assert.equal(ack.line_items[0].quantity_confirmed, null);
});

check("übersprungenes Katalog-Matching fordert Klärung", () => {
  const draft = draftWith({
    matchingResults: {
      overallConfidence: 0,
      items: [
        {
          extractedProductName: "Mit freundlichen Grüßen",
          quantity: 1,
          status: "matched",
          catalogMatchSkipped: true,
          matchedProduct: { id: "x", productNumber: "X", name: "X", price: 1 },
        },
      ],
    },
  });
  assert.equal(
    buildOrderAcknowledgement({ draft, draftKind: "order" }).line_items[0].status,
    "clarification_required"
  );
});

check("gleiche Menge ohne Umrechnung ist schlicht bestätigt", () => {
  const draft = draftWith({
    matchingResults: {
      overallConfidence: 100,
      items: [
        {
          extractedProductName: "Regalboden",
          quantity: 12,
          status: "matched",
          confidence: 100,
          matchedProduct: { id: "p2", productNumber: "4026212000001", name: "Regalboden", price: 10 },
        },
      ],
    },
  });
  const line = buildOrderAcknowledgement({ draft, draftKind: "order" }).line_items[0];
  assert.equal(line.status, "confirmed");
  assert.equal(line.quantity_ordered, 12);
  assert.equal(line.quantity_confirmed, 12);
  assert.equal(line.note, null);
});

check("Angebotsanfrage wird als quote_request gemeldet", () => {
  const draft = draftWith({
    extractedData: {
      documentExtraction: {
        document: { type: "quote_request", number: "AF-9", currency: "CHF" },
        line_items: [],
      },
      lineItems: [],
    },
    matchingResults: { overallConfidence: 0, items: [] },
  });
  const ack = buildOrderAcknowledgement({ draft, draftKind: "offer" });
  assert.equal(ack.document_type, "quote_request");
  assert.equal(ack.currency, "CHF");
  assert.equal(ack.line_items.length, 0);
});

check("gibt keine internen Bewertungsdaten preis", () => {
  const ack = buildOrderAcknowledgement({
    draft: draftWith({
      extractedData: {
        ...draftWith().extractedData,
        strictAutoCreateTrace: { allowed: false, reasons: ["line_1_not_matched"] },
      },
    }),
    draftKind: "order",
  });
  const serialized = JSON.stringify(ack);
  for (const forbidden of ["confidence", "strictAutoCreate", "reasons", "alternativeMatches", "learningHint"]) {
    assert.ok(!serialized.includes(forbidden), `Antwort enthält internes Feld: ${forbidden}`);
  }
});

check("kommt mit unvollständigen Daten klar", () => {
  const ack = buildOrderAcknowledgement({
    draft: { status: "pending", createdAt: NOW, updatedAt: NOW },
    draftKind: "order",
  });
  assert.equal(ack.buyer_document_number, null);
  assert.equal(ack.status, "in_review");
  assert.equal(ack.currency, "EUR");
  assert.deepEqual(ack.line_items, []);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll tests passed.\n");
