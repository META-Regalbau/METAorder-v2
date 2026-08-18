/**
 * Unit-Tests für die Eingangsbestätigung.
 *
 * Besonders wichtig, weil hier automatisch Mail an echte Kunden geht: Jede Sperre
 * wird einzeln geprüft.
 *
 *   npm run test:inbound-ack
 */

import assert from "node:assert/strict";
import {
  buildAcknowledgementMail,
  decideAcknowledgementMail,
} from "../server/commercialInboundAcknowledgementMail";
import { buildOrderAcknowledgement } from "../server/commercialOrderAcknowledgement";

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

const allow = {
  enabled: true,
  recipientEmail: "einkauf@kunde.at",
  alreadySentAt: null,
  ownDomains: ["meta-online.com"],
  senderCompany: "Mustermann Logistik GmbH",
};

console.log("\n=== Eingangsbestätigung Unit Tests ===\n");

check("Standard: ausgeschaltet sendet nicht", () => {
  const d = decideAcknowledgementMail({ ...allow, enabled: false });
  assert.deepEqual(d, { send: false, reason: "disabled" });
});

check("gültiger Empfänger wird freigegeben", () => {
  const d = decideAcknowledgementMail(allow);
  assert.equal(d.send, true);
  if (d.send) assert.equal(d.recipient, "einkauf@kunde.at");
});

check("nur einmal je Vorgang", () => {
  const d = decideAcknowledgementMail({ ...allow, alreadySentAt: "2026-08-14T10:00:00Z" });
  assert.deepEqual(d, { send: false, reason: "already_sent" });
});

check("ohne Empfänger kein Versand", () => {
  assert.deepEqual(decideAcknowledgementMail({ ...allow, recipientEmail: null }), {
    send: false,
    reason: "no_recipient",
  });
  assert.deepEqual(decideAcknowledgementMail({ ...allow, recipientEmail: "   " }), {
    send: false,
    reason: "no_recipient",
  });
});

check("unplausible Adresse wird abgelehnt", () => {
  for (const bad of ["kein-at-zeichen", "a@b", "a@b.c", "@domain.de"]) {
    const d = decideAcknowledgementMail({ ...allow, recipientEmail: bad });
    assert.equal(d.send, false, `hätte ablehnen müssen: ${bad}`);
  }
});

check("Automaten-Adressen werden geblockt (Mailschleifen)", () => {
  for (const local of ["noreply", "no-reply", "DoNotReply", "mailer-daemon", "postmaster", "bounces"]) {
    const d = decideAcknowledgementMail({ ...allow, recipientEmail: `${local}@kunde.at` });
    assert.deepEqual(d, { send: false, reason: "automated_recipient" }, `nicht geblockt: ${local}`);
  }
});

check("eigene Domains werden geblockt, inkl. Subdomains", () => {
  assert.deepEqual(decideAcknowledgementMail({ ...allow, recipientEmail: "a@meta-online.com" }), {
    send: false,
    reason: "own_domain",
  });
  assert.deepEqual(
    decideAcknowledgementMail({ ...allow, recipientEmail: "a@mail.meta-online.com" }),
    { send: false, reason: "own_domain" }
  );
  // Fremde Domain, die nur ähnlich endet, darf NICHT blocken
  assert.equal(
    decideAcknowledgementMail({ ...allow, recipientEmail: "a@notmeta-online.com" }).send,
    true
  );
});

check("META-eigene Absenderfirma wird geblockt", () => {
  const d = decideAcknowledgementMail({
    ...allow,
    senderCompany: "META Lagertechnik Ges.m.b.H.",
  });
  assert.deepEqual(d, { send: false, reason: "own_domain" });
});

function ackFrom(draftOverrides: Record<string, unknown> = {}) {
  return buildOrderAcknowledgement({
    draft: {
      status: "review_required",
      createdAt: new Date("2026-08-14T09:12:00Z"),
      updatedAt: new Date("2026-08-14T09:12:00Z"),
      extractedData: {
        documentExtraction: {
          document: { type: "purchase_order", number: "PO-4711", currency: "EUR", language: "de" },
          line_items: [
            { position: 10, quantity: 12, unit: "Stk", buyer_sku: "KD-88231", description: "Holm 1000 mm" },
            { position: 20, quantity: 4, unit: "Stk", buyer_sku: "KD-90011", description: "Sonderteil" },
          ],
        },
        lineItems: [
          { extractedProductName: "Holm 1000 mm", quantity: 12 },
          { extractedProductName: "Sonderteil", quantity: 4 },
        ],
      },
      matchingResults: {
        overallConfidence: 50,
        items: [
          {
            extractedProductName: "Holm 1000 mm",
            quantity: 6,
            originalQuantity: 12,
            convertedQuantity: 6,
            conversionNote: "1 Holmebene = 2 Holme",
            status: "matched",
            matchedProduct: { id: "p1", productNumber: "4026212260212", name: "Holmebene", price: 43 },
          },
          { extractedProductName: "Sonderteil", quantity: 4, status: "not_found" },
        ],
      },
      ...draftOverrides,
    },
    draftKind: "order",
  });
}

check("Betreff nennt Belegart und Belegnummer", () => {
  const mail = buildAcknowledgementMail({ acknowledgement: ackFrom(), language: "de" });
  assert.equal(mail.subject, "Ihre Bestellung PO-4711 ist bei uns eingegangen");
});

check("Text spiegelt Positionen inklusive Mengenänderung", () => {
  const mail = buildAcknowledgementMail({ acknowledgement: ackFrom(), language: "de" });
  assert.ok(mail.text.includes("PO-4711"), "Belegnummer fehlt");
  assert.ok(mail.text.includes("Holm 1000 mm"), "Position fehlt");
  assert.ok(mail.text.includes("Menge angepasst"), "Mengenänderung nicht markiert");
  assert.ok(mail.text.includes("12 -> 6"), "Mengenänderung nicht beziffert");
  assert.ok(mail.text.includes("1 Holmebene = 2 Holme"), "Begründung fehlt");
  assert.ok(mail.text.includes("Rückfrage nötig"), "offene Position nicht markiert");
});

check("Text verspricht ausdrücklich keine Zusage", () => {
  const text = buildAcknowledgementMail({ acknowledgement: ackFrom(), language: "de" }).text;
  assert.ok(
    text.includes("noch keine Auftragsbestätigung"),
    "Der Text muss klarstellen, dass dies keine Auftragsbestätigung ist"
  );
});

check("keine Preise in der Eingangsbestätigung", () => {
  // Zum Eingangszeitpunkt gibt es keinen verbindlichen Preis — es darf keiner drinstehen.
  const text = buildAcknowledgementMail({ acknowledgement: ackFrom(), language: "de" }).text;
  for (const forbidden of ["EUR", "€"]) {
    assert.ok(!text.includes(forbidden), `Preisangabe im Text gefunden: ${forbidden}`);
  }
});

check("englische Fassung bei englischem Beleg", () => {
  const ack = ackFrom();
  const mail = buildAcknowledgementMail({ acknowledgement: ack, language: "en" });
  assert.equal(mail.subject, "We received your order PO-4711");
  assert.ok(mail.text.includes("not yet an order confirmation"));
});

check("Anfrage statt Bestellung wird korrekt benannt", () => {
  const ack = buildOrderAcknowledgement({
    draft: {
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
      extractedData: {
        documentExtraction: {
          document: { type: "quote_request", number: "AF-9", currency: "EUR" },
          line_items: [],
        },
        lineItems: [],
      },
      matchingResults: { overallConfidence: 0, items: [] },
    },
    draftKind: "offer",
  });
  const mail = buildAcknowledgementMail({ acknowledgement: ack, language: "de" });
  assert.equal(mail.subject, "Ihre Anfrage AF-9 ist bei uns eingegangen");
  assert.ok(mail.text.includes("keine Positionen automatisch erfassen"));
});

check("Signatur wird angehängt, wenn gesetzt", () => {
  const mail = buildAcknowledgementMail({
    acknowledgement: ackFrom(),
    language: "de",
    senderName: "Ihr META-Team",
  });
  assert.ok(mail.text.trimEnd().endsWith("Ihr META-Team"));
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll tests passed.\n");
