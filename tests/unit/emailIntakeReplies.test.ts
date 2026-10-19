/**
 * Kundenantworten aus dem E-Mail-Eingang: Mailart, Bestellbezug (nur eigene Bestellung), Fakten ohne
 * Shopware-Liefertermin, KI-Entwurf mit Platzhaltern und Gruß.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { Order } from "../../shared/schema";
import { DEFAULT_EMAIL_INTAKE_SETTINGS, normalizeEmailIntakeSettings, replyPlaceholders } from "../../shared/emailIntake";
import {
  buildReplyPrompt,
  findOrderNumbers,
  interpretReplyResponse,
  orderFactsFor,
  pickOrderForSender,
  replyKindFor,
  withSignature,
  type ReplyFacts,
} from "../../server/commercial/emailIntakeReplyDraft";
import { generateReplyDraft, internetMessageIdOf, replyPlanFor } from "../../server/commercial/emailIntakeReplies";

function order(partial: Partial<Order>): Order {
  return {
    id: "o1",
    orderNumber: "MO102925",
    customerName: "Max Kunde",
    customerEmail: "kunde@example.com",
    orderDate: "2026-10-12T09:00:00.000Z",
    totalAmount: 100,
    netTotalAmount: 84,
    status: "in_progress",
    paymentStatus: "paid",
    salesChannelId: "sc",
    deliveryDateEarliest: "2026-10-12T00:00:00.000Z",
    deliveryDateLatest: "2026-10-14T00:00:00.000Z",
    items: [{ id: "i1", name: "Fachbodenregal CLIP", quantity: 2, price: 50, netPrice: 42, total: 100, netTotal: 84, taxRate: 19 } as never],
    ...partial,
  } as Order;
}

const enabledSettings = {
  ...DEFAULT_EMAIL_INTAKE_SETTINGS,
  mailboxes: [{ address: "shop@meta-online.com", mode: "personal" as const, enabled: true }],
  replyDrafts: { order_status: true, complaint: true, general: false, offer_request: true },
};

const envelope = (customerEmail: string | null) => ({
  headerFrom: "Kunde <kunde@example.com>",
  customerFrom: "Max Kunde <kunde@example.com>",
  customerEmail,
  toAddresses: ["shop@meta-online.com"],
  ccAddresses: [],
});

const facts = (partial: Partial<ReplyFacts> = {}): ReplyFacts => ({
  orderNumbers: [],
  order: null,
  orderNote: null,
  mail: { subject: "Wo bleibt meine Bestellung MO102925?", from: "Max Kunde <kunde@example.com>", text: "Hallo, wann kommt die Lieferung?" },
  ...partial,
});

describe("Kundenantworten: Mailart und Bestellbezug", () => {
  it("ordnet Eingangsergebnisse den Antwortarten zu", () => {
    assert.equal(replyKindFor({ outcome: "other", otherType: "order_status" }), "order_status");
    assert.equal(replyKindFor({ outcome: "other", otherType: "complaint" }), "complaint");
    assert.equal(replyKindFor({ outcome: "other", otherType: "general" }), "general");
    assert.equal(replyKindFor({ outcome: "offer", otherType: null }), "offer_request");
    for (const otherType of ["invoice", "delivery", "newsletter", "spam", "auto_reply", "application"] as const) {
      assert.equal(replyKindFor({ outcome: "other", otherType }), null, otherType);
    }
    assert.equal(replyKindFor({ outcome: "order", otherType: null }), null);
    assert.equal(replyKindFor({ outcome: "ignored", otherType: null }), null);
  });

  it("findet Bestellnummern in Betreff und Text", () => {
    assert.deepEqual(findOrderNumbers("Re: Lieferstatus Bestellung MO102925", "zu mo102925"), ["MO102925"]);
    assert.deepEqual(findOrderNumbers("Anfrage", "Unsere Bestellnummer: 4500123456 vom 1.10."), ["4500123456"]);
    assert.deepEqual(findOrderNumbers("Regal 2000 x 1000", "Höhe 2500 mm, 3 Stück"), []);
  });

  it("verwendet nur Bestellungen der Absenderadresse, bei Dubletten die zuletzt geänderte", () => {
    const foreign = order({ customerEmail: "anderer@example.com" });
    assert.equal(pickOrderForSender([foreign], "kunde@example.com").order, null);
    assert.match(pickOrderForSender([foreign], "kunde@example.com").note ?? "", /anderen E-Mail-Adresse/);
    assert.match(pickOrderForSender([], "kunde@example.com").note ?? "", /nicht gefunden/);
    const old = order({ id: "alt", updatedAt: "2026-10-01T00:00:00Z" });
    const recent = order({ id: "neu", customerEmail: "Kunde@Example.com", updatedAt: "2026-10-18T00:00:00Z" });
    assert.equal(pickOrderForSender([old, foreign, recent], "kunde@example.com").order?.id, "neu");
  });

  it("Fakten ohne Shopware-Liefertermin, mit Sendungsnummer", () => {
    const f = orderFactsFor(
      order({ shippingInfo: { carrier: "DHL", trackingCodes: ["00340434"], trackingLinks: [{ code: "00340434", url: "https://dhl.de/t/00340434" }], shippedDate: "2026-10-15T10:00:00Z" } }),
    );
    assert.equal(f.status, "in Bearbeitung");
    assert.equal(f.shipped, true);
    assert.deepEqual(f.trackingCodes, ["00340434"]);
    assert.deepEqual(f.items, ["2 × Fachbodenregal CLIP"]);
    const prompt = buildReplyPrompt({ kind: "order_status", facts: facts({ orderNumbers: ["MO102925"], order: f }) });
    assert.match(prompt, /Liefertermin: unbekannt/);
    assert.match(prompt, /Sendungsnummer\(n\): 00340434/);
    assert.doesNotMatch(prompt, /2026-10-14/);
    assert.match(prompt, /\[Liefertermin eintragen\]/);
  });

  it("ohne Bestelldaten: Hinweis auf fehlenden Stand", () => {
    const prompt = buildReplyPrompt({ kind: "order_status", facts: facts({ orderNumbers: ["MO999999"] }) });
    assert.match(prompt, /MO999999 \(Stand liegt nicht vor\)/);
  });
});

describe("Kundenantworten: Entwurf", () => {
  it("liest die KI-Antwort und hängt den Gruß an", () => {
    assert.equal(interpretReplyResponse("kein json"), null);
    assert.equal(interpretReplyResponse('{"needsReply":true,"reply":""}'), null);
    assert.deepEqual(interpretReplyResponse('{"needsReply":false,"reason":"Dank"}'), { needsReply: false, reason: "Dank", reply: "" });
    assert.equal(withSignature("Guten Tag,\n\nText.", ""), "Guten Tag,\n\nText.\n\nMit freundlichen Grüßen\n[Name eintragen]");
    assert.equal(withSignature("Text.", "Ihr META-Shop-Team"), "Text.\n\nMit freundlichen Grüßen\nIhr META-Shop-Team");
  });

  it("Platzhalter werden erkannt", () => {
    assert.deepEqual(replyPlaceholders("Lieferung am [Liefertermin eintragen]. Gruß [Name eintragen] [Name eintragen]"), [
      "[Liefertermin eintragen]",
      "[Name eintragen]",
    ]);
    assert.deepEqual(replyPlaceholders("Kein Platzhalter, nur [x]."), []);
  });

  it("erstellt den Entwurf mit der KI, ohne KI mit Fehlerhinweis", async () => {
    const storage = { getSetting: async () => undefined } as never;
    let prompt = "";
    const ok = await generateReplyDraft(storage, { kind: "order_status", facts: facts(), signature: "Ihr Team" }, async (_s, user) => {
      prompt = user;
      return '{"needsReply":true,"reason":"Frage","reply":"Guten Tag Herr Kunde,\\n\\nIhre Bestellung ist in Bearbeitung. Voraussichtliche Lieferung: [Liefertermin eintragen]."}';
    });
    assert.match(prompt, /KUNDENMAIL/);
    assert.equal(ok.error, null);
    assert.match(ok.draft ?? "", /\[Liefertermin eintragen\]\.\n\nMit freundlichen Grüßen\nIhr Team$/);
    const none = await generateReplyDraft(storage, { kind: "general", facts: facts(), signature: "" }, async () => '{"needsReply":false,"reason":"nur Dank"}');
    assert.equal(none.needsReply, false);
    const failed = await generateReplyDraft(storage, { kind: "general", facts: facts(), signature: "" }, async () => {
      throw new Error("timeout");
    });
    assert.equal(failed.draft, null);
    assert.equal(failed.error, "timeout");
    const noAi = await generateReplyDraft(storage, { kind: "general", facts: facts(), signature: "" });
    assert.equal(noAi.error, "KI nicht eingerichtet");
  });
});

describe("Kundenantworten: wann ein Ticket entsteht", () => {
  it("nur für eingeschaltete Mailarten und externe Absender", () => {
    assert.deepEqual(
      replyPlanFor({ settings: enabledSettings, outcome: "other", otherType: "order_status", envelope: envelope("Kunde@Example.com") }),
      { kind: "order_status", customerEmail: "kunde@example.com" },
    );
    assert.equal(replyPlanFor({ settings: enabledSettings, outcome: "other", otherType: "general", envelope: envelope("kunde@example.com") }), null);
    assert.equal(replyPlanFor({ settings: enabledSettings, outcome: "other", otherType: "complaint", envelope: envelope(null) }), null);
    assert.equal(
      replyPlanFor({ settings: enabledSettings, outcome: "other", otherType: "complaint", envelope: envelope("kollege@meta-online.com") }),
      null,
    );
    assert.equal(replyPlanFor({ settings: DEFAULT_EMAIL_INTAKE_SETTINGS, outcome: "offer", otherType: null, envelope: envelope("kunde@example.com") }), null);
  });

  it("Message-ID für die Suche im Postfach", () => {
    assert.equal(internetMessageIdOf("mail:abc@kunde.de"), "<abc@kunde.de>");
    assert.equal(internetMessageIdOf("mail:<abc@kunde.de>"), "<abc@kunde.de>");
    assert.equal(internetMessageIdOf("sha256:ff00"), null);
  });

  it("Einstellungen: ältere Stände ohne Antwortfelder bekommen die Standardwerte", () => {
    const s = normalizeEmailIntakeSettings({ enabled: true, replyDrafts: { complaint: true, general: "ja" } });
    assert.deepEqual(s.replyDrafts, { order_status: false, complaint: true, general: false, offer_request: false });
    assert.equal(s.replySignature, "");
  });
});
