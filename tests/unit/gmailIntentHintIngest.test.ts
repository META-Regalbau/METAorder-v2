/**
 * uploadHint-Boost in Intent-Klassifikation (offline, ohne LLM).
 * Ausführung: npm test
 */
import { describe, it } from "vitest";
import {
  applyUploadIntentHintBoost,
  type CommercialDocumentIntent,
} from "../../server/commercial/commercialDocumentIntent";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Aus scripts/testGmailIntentHintIngest.ts uebernommen: Pruefungen unveraendert, je Pruefung ein Vitest-Fall.
// Prueft jetzt die echte Funktion (frueher eine Kopie im Test, die schon vom Original abwich).
describe("GmailIntentHintIngest", () => {
  it("unclear + order hint → purchase_order", () => {
    const base: CommercialDocumentIntent = {
      intent: "unclear",
      confidence: 0.4,
      rationale: "test",
      signals: [],
    };
    const boosted = applyUploadIntentHintBoost(base, "order");
    assert(boosted.intent === "purchase_order", "unclear + order hint");
    assert(boosted.confidence >= 0.58, "confidence raised");
  });

  it("agree hint +0.05", () => {
    const base: CommercialDocumentIntent = {
      intent: "quote_request",
      confidence: 0.9,
      signals: [],
    };
    const boosted = applyUploadIntentHintBoost(base, "offer");
    assert(boosted.confidence >= 0.95 && boosted.confidence <= 1, "agreeing hint +0.05");
    assert(boosted.signals?.includes("upload_hint_agrees"), "signal set");
  });

  it("conflicting hint does not override", () => {
    const base: CommercialDocumentIntent = {
      intent: "quote_request",
      confidence: 0.7,
      signals: [],
    };
    const boosted = applyUploadIntentHintBoost(base, "order");
    assert(boosted.intent === "quote_request", "conflicting hint does not override strong LLM");
  });
});
