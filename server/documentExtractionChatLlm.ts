/**
 * Provider-neutrale Dokument-Extraktion über den Chat-Provider des Mandanten
 * (llmChat.chatCompletion: OpenAI, Anthropic oder Gemini — je nach Einstellungen).
 *
 * Hintergrund: Die Extraktion war fest an den OpenAI-Client gebunden. Mandanten, die
 * Anthropic als Chat-Provider nutzen, fielen damit still auf den lokalen Zeilenparser
 * zurück. Für Dokumente MIT Textlayer reicht ein Text-Chat; nur Vision (Scans/Bilder)
 * bleibt OpenAI-only.
 */

import type { DocumentExtraction } from "@shared/documentExtractionSchema";
import type { ChatCompletionParams } from "./llmChat";
import { chatCompletion, isChatLlmConfigured, parseLlmJsonResponse } from "./llmChat";
import type { IStorage } from "./storage";

export type DocumentExtractionChatLlm = (params: ChatCompletionParams) => Promise<string>;

/** Liefert einen gebundenen Chat-Aufruf, wenn für den aktuellen Mandanten ein Chat-LLM konfiguriert ist. */
export async function resolveDocumentExtractionChatLlm(storage: IStorage): Promise<DocumentExtractionChatLlm | null> {
  const getSetting = storage.getSetting.bind(storage);
  try {
    if (!(await isChatLlmConfigured(getSetting))) return null;
  } catch {
    return null;
  }
  return (params) => chatCompletion(getSetting, params);
}

export async function runDocumentExtractionViaChatLlm(params: {
  chatLlm: DocumentExtractionChatLlm;
  systemPrompt: string;
  fewShotMessages: Array<{ role: "user" | "assistant"; content: string }>;
  userContent: string;
}): Promise<DocumentExtraction> {
  const raw = await params.chatLlm({
    messages: [
      { role: "system", content: params.systemPrompt },
      ...params.fewShotMessages,
      { role: "user", content: params.userContent },
    ],
    temperature: 0,
    // Großzügig: formatiertes JSON mit 10+ Positionen sprengt 4096 Tokens — ein abgeschnittenes
    // Ergebnis wäre schlimmer als ein langsames (Positionen fehlen dann still).
    max_tokens: 16000,
    response_json: true,
    tier: "smart",
  });
  const trimmed = raw.trim().replace(/```\s*$/, "").trim();
  if (!trimmed.endsWith("}")) {
    throw new Error("Chat-LLM-Antwort ist abgeschnitten (JSON endet nicht mit '}')");
  }
  const parsed = parseLlmJsonResponse(raw) as DocumentExtraction | null;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as DocumentExtraction).line_items)) {
    throw new Error("Chat-LLM lieferte kein gültiges JSON für die Dokument-Extraktion");
  }
  return parsed;
}
