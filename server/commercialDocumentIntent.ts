import { z } from "zod";
import { createRequire } from "node:module";
import type { IStorage } from "./storage";
import { chatCompletion, isChatLlmConfigured, parseLlmJsonResponse } from "./llmChat";
import { getCommercialAgentSettings } from "./aiConfig";
import { formatExemplarsForIntentPrompt } from "./commercialAgentLearning";
import { logCommercialAgentDebug } from "./commercialAgentDebugLog";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

export const commercialIntentSchema = z.object({
  intent: z.enum(["quote_request", "purchase_order", "unclear"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(500).optional(),
  signals: z.array(z.string()).max(20).optional(),
});

export type CommercialDocumentIntent = z.infer<typeof commercialIntentSchema>;

const INTENT_SYSTEM = `Du klassifizierst geschäftliche E-Mails und optionale Dokumentauszüge (Deutsch/Englisch).

quote_request: Preisanfrage, Angebotswunsch, RFQ, Stücklisten/Mengen ohne verbindliche Bestellung, "bitte Angebot", "unverbindlich", "Kostenvoranschlag", Lieferantenanfrage zu Preisen.
purchase_order: Verbindlicher Auftrag — "hiermit bestellen", "wir beauftragen", Purchase Order / PO-Nummer im Bestellkontext, verbindliche Beauftragung mit Liefertermin.
unclear: Widerspruch zwischen Betreff und Inhalt, zu wenig Kontext, rein administrativ/spam, nicht zuordenbar.

"unclear" nur wenn wirklich nicht erkennbar. Typische B2B-Anfragen mit Artikeln und Mengen sind meist quote_request, nicht unclear.

Antworte NUR mit JSON:
{"intent":"quote_request"|"purchase_order"|"unclear","confidence":0.0-1.0,"rationale":"kurz","signals":["..."]}`;

function applyCommercialIntentHeuristics(
  result: CommercialDocumentIntent,
  input: ClassifyCommercialIntentInput
): CommercialDocumentIntent {
  const text = [input.subject, input.emailBody, input.documentTextPreview || ""]
    .join("\n")
    .toLowerCase();

  const orderHints =
    /\b(hiermit bestellen|wir beauftragen|beauftragen sie hiermit|purchase order|p\.?\s*o\.?\s*(nr|no\.?|nummer)|bestellung (hiermit|gemäß|gemaess|lt\.|laut))\b/i.test(
      text
    );

  const quoteHints =
    /\b(preisanfrage|angebotsanfrage|angebot(s)?anfrage|bitte um (ein |)(angebot|kostenvoranschlag|offer)|unverbindliche (preis)?anfrage|kostenvoranschlag|\brfq\b|nennen sie uns (bitte |)(die |)(preise|angebot)|info über folgende artikel|angebotslegung)\b/i.test(
      text
    );

  if (orderHints && quoteHints) {
    return result;
  }

  let { intent, confidence, rationale, signals } = result;
  const sig = new Set(signals || []);
  let rat = rationale ?? "";

  if (orderHints && !quoteHints) {
    if (intent !== "purchase_order" || confidence < 0.75) {
      intent = "purchase_order";
      confidence = Math.max(confidence, 0.82);
      sig.add("heuristic_order_language");
      rat = `${rat} Heuristik: verbindliche Bestellsprache.`.trim();
    }
  } else if (quoteHints && !orderHints && intent !== "purchase_order") {
    if (intent === "unclear" || confidence < 0.72) {
      intent = "quote_request";
      confidence = Math.max(confidence, 0.78);
      sig.add("heuristic_quote_rfq");
      rat = `${rat} Heuristik: typische Angebots-/Preisanfrage.`.trim();
    }
  }

  return {
    intent,
    confidence: Math.min(1, confidence),
    rationale: rat.slice(0, 500),
    signals: [...sig].slice(0, 20),
  };
}

export async function extractPdfTextPreview(buffer: Buffer, maxChars = 6000): Promise<string> {
  try {
    const parser = new PDFParse({ data: buffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    const text = (pdfData.text || "").replace(/\s+/g, " ").trim();
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  } catch {
    return "";
  }
}

export type ClassifyCommercialIntentInput = {
  subject: string;
  emailBody: string;
  /** Optional plain-text preview from PDF or message */
  documentTextPreview?: string;
  /** Mandant für Few-Shot-Exemplare */
  tenantId?: string | null;
  /** Korrelation in COMMERCIAL_AGENT_DEBUG-Logs (z. B. E-Mail Message-ID) */
  traceId?: string | null;
  /**
   * Optionaler Vorschlag von n8n (Gmail-Workflow). Wird nur als leichter Boost (+0.05)
   * verwendet, überschreibt das LLM-Ergebnis nie.
   */
  uploadHint?: "offer" | "order" | "unclear" | null;
};

function applyUploadIntentHintBoost(
  result: CommercialDocumentIntent,
  uploadHint: ClassifyCommercialIntentInput["uploadHint"]
): CommercialDocumentIntent {
  if (!uploadHint || uploadHint === "unclear") return result;
  const hintIntent =
    uploadHint === "order" ? "purchase_order" : uploadHint === "offer" ? "quote_request" : null;
  if (!hintIntent) return result;
  if (result.intent === hintIntent) {
    return {
      ...result,
      confidence: Math.min(1, result.confidence + 0.05),
      signals: [...(result.signals ?? []), "upload_hint_agrees"].slice(0, 20),
    };
  }
  if (result.intent === "unclear" || result.confidence < 0.55) {
    return {
      ...result,
      intent: hintIntent,
      confidence: Math.min(1, Math.max(result.confidence, 0.58)),
      rationale: `${result.rationale ?? ""} Upload-Hint (n8n): ${uploadHint}.`.trim().slice(0, 500),
      signals: [...(result.signals ?? []), "upload_hint_boost"].slice(0, 20),
    };
  }
  return result;
}

export async function classifyCommercialDocumentIntent(
  storage: IStorage,
  input: ClassifyCommercialIntentInput
): Promise<CommercialDocumentIntent> {
  const configured = await isChatLlmConfigured(storage.getSetting.bind(storage));
  if (!configured) {
    return {
      intent: "unclear",
      confidence: 0,
      rationale: "KI-Chat (OpenAI oder Anthropic) nicht konfiguriert",
      signals: [],
    };
  }

  const agentCfg = await getCommercialAgentSettings(storage);
  let fewShotSuffix = "";
  if (agentCfg.documentLearningEnabled !== false && input.tenantId) {
    const max = agentCfg.exemplarsInPromptMax ?? 5;
    const exemplars = await storage.getCommercialAgentExemplarsForPrompt(input.tenantId, max);
    fewShotSuffix = formatExemplarsForIntentPrompt(exemplars);
  }

  const body = (input.emailBody || "").slice(0, 8000);
  const doc = (input.documentTextPreview || "").slice(0, 6000);
  const userContent = [
    `Betreff: ${(input.subject || "").slice(0, 500)}`,
    "",
    "E-Mail-Text:",
    body || "(leer)",
    doc ? `\nDokument-/PDF-Auszug:\n${doc}` : "",
  ].join("\n");

  try {
    const t0 = Date.now();
    const raw = await chatCompletion(storage.getSetting.bind(storage), {
      messages: [
        { role: "system", content: INTENT_SYSTEM + fewShotSuffix },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      response_json: true,
      max_tokens: 400,
    });
    const parsed = parseLlmJsonResponse(raw);
    const safe = commercialIntentSchema.safeParse(parsed);
    if (!safe.success) {
      logCommercialAgentDebug(
        "intent_classify_invalid",
        {
          ms: Date.now() - t0,
          tenantId: input.tenantId ?? null,
          subjectLen: (input.subject || "").length,
          bodyLen: body.length,
          docLen: doc.length,
          fewShotChars: fewShotSuffix.length,
        },
        input.traceId
      );
      return {
        intent: "unclear",
        confidence: 0.4,
        rationale: "Antwort konnte nicht validiert werden",
        signals: [],
      };
    }
    const fromLlm = safe.data;
    const afterHeuristics = applyCommercialIntentHeuristics(fromLlm, input);
    const finalIntent = applyUploadIntentHintBoost(afterHeuristics, input.uploadHint);
    logCommercialAgentDebug(
      "intent_classify",
      {
        ms: Date.now() - t0,
        tenantId: input.tenantId ?? null,
        subjectLen: (input.subject || "").length,
        bodyLen: body.length,
        docLen: doc.length,
        fewShotChars: fewShotSuffix.length,
        llmIntent: fromLlm.intent,
        llmConfidence: fromLlm.confidence,
        finalIntent: finalIntent.intent,
        finalConfidence: finalIntent.confidence,
        signals: finalIntent.signals,
        rationale: finalIntent.rationale,
      },
      input.traceId
    );
    return finalIntent;
  } catch (e) {
    console.error("[CommercialIntent] classification failed:", e);
    logCommercialAgentDebug("intent_classify_error", { error: String(e) }, input.traceId);
    return {
      intent: "unclear",
      confidence: 0.35,
      rationale: "Klassifikation fehlgeschlagen",
      signals: [],
    };
  }
}
