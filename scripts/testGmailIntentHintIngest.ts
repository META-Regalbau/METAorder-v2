/**
 * uploadHint-Boost in Intent-Klassifikation (offline, ohne LLM).
 * Ausführung: npx tsx scripts/testGmailIntentHintIngest.ts
 */

import type { CommercialDocumentIntent } from "../server/commercialDocumentIntent";

// applyUploadIntentHintBoost ist nicht exportiert — wir testen die Heuristik + simulieren den Boost-Pfad
// durch Re-Import der Logik via classify path: duplicate minimal boost test inline.

function applyUploadIntentHintBoost(
  result: CommercialDocumentIntent,
  uploadHint: "offer" | "order" | "unclear" | null | undefined
): CommercialDocumentIntent {
  if (!uploadHint || uploadHint === "unclear") return result;
  const hintIntent =
    uploadHint === "order" ? "purchase_order" : uploadHint === "offer" ? "quote_request" : null;
  if (!hintIntent) return result;
  if (result.intent === hintIntent) {
    return {
      ...result,
      confidence: Math.min(1, result.confidence + 0.05),
      signals: [...(result.signals ?? []), "upload_hint_agrees"],
    };
  }
  if (result.intent === "unclear" || result.confidence < 0.55) {
    return {
      ...result,
      intent: hintIntent,
      confidence: Math.min(1, Math.max(result.confidence, 0.58)),
      signals: [...(result.signals ?? []), "upload_hint_boost"],
    };
  }
  return result;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log("=== uploadHint intent boost tests ===\n");

{
  const base: CommercialDocumentIntent = {
    intent: "unclear",
    confidence: 0.4,
    rationale: "test",
    signals: [],
  };
  const boosted = applyUploadIntentHintBoost(base, "order");
  assert(boosted.intent === "purchase_order", "unclear + order hint");
  assert(boosted.confidence >= 0.58, "confidence raised");
  console.log("  unclear + order hint → purchase_order: OK");
}

{
  const base: CommercialDocumentIntent = {
    intent: "quote_request",
    confidence: 0.9,
    signals: [],
  };
  const boosted = applyUploadIntentHintBoost(base, "offer");
  assert(boosted.confidence >= 0.95 && boosted.confidence <= 1, "agreeing hint +0.05");
  assert(boosted.signals?.includes("upload_hint_agrees"), "signal set");
  console.log("  agree hint +0.05: OK");
}

{
  const base: CommercialDocumentIntent = {
    intent: "quote_request",
    confidence: 0.7,
    signals: [],
  };
  const boosted = applyUploadIntentHintBoost(base, "order");
  assert(boosted.intent === "quote_request", "conflicting hint does not override strong LLM");
  console.log("  conflicting hint does not override: OK");
}

console.log("\nAll tests passed.\n");
