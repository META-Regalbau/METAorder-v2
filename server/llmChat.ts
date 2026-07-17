import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { decrypt } from "./encryption";
import { getOpenAIClient, isReplitOpenAIAvailable } from "./openaiClient";
import {
  DEFAULT_MODELS,
  GEMINI_OPENAI_BASE_URL,
  type ModelTier,
  type StoredLlmSettings,
  resolveTierModel,
  resolveTierProvider,
} from "./llmClient";

/** Jede chatCompletion: Provider, Modell, Dauer (auch UI-Chat — kann laut werden). */
function llmTraceEnabled(): boolean {
  const v = (process.env.LLM_DEBUG || "").trim().toLowerCase();
  return v === "true" || v === "1";
}

function logLlmTrace(payload: Record<string, unknown>): void {
  if (!llmTraceEnabled()) return;
  console.log(`[LLM_DEBUG] ${JSON.stringify({ ts: new Date().toISOString(), ...payload })}`);
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatCompletionParams = {
  messages: ChatMessage[];
  /** Overrides default model for the active provider */
  model?: string;
  temperature?: number;
  max_tokens?: number;
  /** OpenAI json_object or JSON-only instruction for Claude */
  response_json?: boolean;
  /**
   * Modell-Stufe: "fast" (Standard, günstig) oder "smart" (schwierige
   * Aufgaben, z. B. Claude Opus). Default: "fast".
   */
  tier?: ModelTier;
};

/** @deprecated Verwende StoredLlmSettings aus ./llmClient */
export type StoredOpenaiSettings = StoredLlmSettings;

export const DEFAULT_ANTHROPIC_CHAT_MODEL = DEFAULT_MODELS.anthropic.smart;

/** OpenAI-Modellnamen nicht an die Anthropic-API durchreichen. */
const LOOKS_LIKE_OPENAI_MODEL = /^(gpt-|o\d|chatgpt-)/i;

function mergeAnthropicMessages(messages: ChatMessage[]): {
  system: string;
  params: Anthropic.MessageParam[];
} {
  const systemParts: string[] = [];
  const nonSystem: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") systemParts.push(m.content);
    else nonSystem.push(m);
  }
  const merged: Anthropic.MessageParam[] = [];
  for (const m of nonSystem) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = merged[merged.length - 1];
    if (last && last.role === role) {
      const prev = typeof last.content === "string" ? last.content : "";
      last.content = `${prev}\n\n${m.content}`;
    } else {
      merged.push({ role, content: m.content });
    }
  }
  return {
    system: systemParts.join("\n\n"),
    params: merged.length > 0 ? merged : [{ role: "user", content: " " }],
  };
}

function anthropicTextFromMessage(msg: Anthropic.Message): string {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
}

async function completeWithAnthropic(
  client: Anthropic,
  model: string,
  params: ChatCompletionParams,
  jsonOnly: boolean
): Promise<string> {
  let messages = params.messages;
  if (jsonOnly) {
    const hint =
      "Antworte ausschließlich mit gültigem JSON (kein Markdown, keine Code-Fences, kein Erklärtext davor oder danach).";
    const firstSystemIdx = messages.findIndex((m) => m.role === "system");
    if (firstSystemIdx >= 0) {
      messages = messages.map((m, i) =>
        i === firstSystemIdx ? { ...m, content: `${m.content}\n\n${hint}` } : m
      );
    } else {
      messages = [{ role: "system", content: hint }, ...messages];
    }
  }
  const { system, params: anthropicMessages } = mergeAnthropicMessages(messages);
  const res = await client.messages.create({
    model,
    max_tokens: params.max_tokens ?? 4096,
    temperature: params.temperature,
    system: system || undefined,
    messages: anthropicMessages,
  });
  return anthropicTextFromMessage(res);
}

async function completeWithOpenAI(
  client: OpenAI,
  model: string,
  params: ChatCompletionParams
): Promise<string> {
  const body: OpenAI.Chat.ChatCompletionCreateParams = {
    model,
    messages: params.messages,
    max_tokens: params.max_tokens,
    temperature: params.temperature,
  };
  if (params.response_json) {
    body.response_format = { type: "json_object" };
  }
  const completion = await client.chat.completions.create(body);
  return completion.choices[0]?.message?.content ?? "";
}

/**
 * Text-/Chat-Kompletionen über OpenAI oder Anthropic (Claude), gesteuert über openai_settings.chatProvider.
 * OpenAI-Embeddings und Vision in anderen Modulen bleiben unabhängig (eigener OpenAI-Key).
 */
export async function chatCompletion(
  getSetting: (key: string) => Promise<any>,
  params: ChatCompletionParams
): Promise<string> {
  const t0 = Date.now();
  const settings = ((await getSetting("openai_settings")) || {}) as StoredLlmSettings;
  const tier = params.tier ?? "fast";
  const provider = resolveTierProvider(settings, tier);
  const modelOverride =
    params.model?.trim() && !LOOKS_LIKE_OPENAI_MODEL.test(params.model.trim())
      ? params.model.trim()
      : provider === "openai"
        ? params.model?.trim() || undefined
        : undefined;

  try {
    if (provider === "anthropic") {
      if (!settings.enabled || !settings.anthropicApiKey) {
        throw new Error("Anthropic (Claude) API is not configured");
      }
      const client = new Anthropic({ apiKey: decrypt(settings.anthropicApiKey) });
      const model = modelOverride || resolveTierModel(settings, tier, "anthropic");
      const text = await completeWithAnthropic(client, model, params, Boolean(params.response_json));
      logLlmTrace({
        provider: "anthropic",
        tier,
        model,
        ms: Date.now() - t0,
        response_json: Boolean(params.response_json),
        responseChars: text.length,
        max_tokens: params.max_tokens,
      });
      return text;
    }

    if (provider === "google") {
      if (!settings.enabled || !settings.geminiApiKey) {
        throw new Error("Google (Gemini) API is not configured");
      }
      const client = new OpenAI({
        apiKey: decrypt(settings.geminiApiKey),
        baseURL: GEMINI_OPENAI_BASE_URL,
      });
      const model = modelOverride || resolveTierModel(settings, tier, "google");
      const text = await completeWithOpenAI(client, model, params);
      logLlmTrace({
        provider: "google",
        tier,
        model,
        ms: Date.now() - t0,
        response_json: Boolean(params.response_json),
        responseChars: text.length,
        max_tokens: params.max_tokens,
      });
      return text;
    }

    // provider === "openai"
    if (isReplitOpenAIAvailable()) {
      const { client } = getOpenAIClient();
      const model = modelOverride || resolveTierModel(settings, tier, "openai");
      const text = await completeWithOpenAI(client, model, params);
      logLlmTrace({
        provider: "openai",
        tier,
        model,
        ms: Date.now() - t0,
        response_json: Boolean(params.response_json),
        responseChars: text.length,
        max_tokens: params.max_tokens,
      });
      return text;
    }

    if (!settings.enabled || !settings.apiKey) {
      throw new Error("OpenAI API is not configured");
    }
    const { client } = getOpenAIClient(settings.apiKey);
    const model = modelOverride || resolveTierModel(settings, tier, "openai");
    const text = await completeWithOpenAI(client, model, params);
    logLlmTrace({
      provider: "openai",
      tier,
      model,
      ms: Date.now() - t0,
      response_json: Boolean(params.response_json),
      responseChars: text.length,
      max_tokens: params.max_tokens,
    });
    return text;
  } catch (e) {
    logLlmTrace({
      provider,
      tier,
      ms: Date.now() - t0,
      error: String(e),
    });
    throw e;
  }
}

/** JSON aus LLM-Antworten (inkl. optionaler ```json```-Fences von Claude). */
export function parseLlmJsonResponse(raw: string): unknown {
  let s = (raw || "").trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced) s = fenced[1].trim();
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

export async function isChatLlmConfigured(
  getSetting: (key: string) => Promise<any>
): Promise<boolean> {
  try {
    const settings = ((await getSetting("openai_settings")) || {}) as StoredLlmSettings;
    if (settings.chatProvider === "anthropic") {
      return Boolean(settings.enabled && settings.anthropicApiKey);
    }
    if (settings.chatProvider === "google") {
      return Boolean(settings.enabled && settings.geminiApiKey);
    }
    if (isReplitOpenAIAvailable()) return true;
    return Boolean(settings.enabled && settings.apiKey);
  } catch {
    return false;
  }
}
