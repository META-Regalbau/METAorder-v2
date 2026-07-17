import OpenAI from "openai";
import { decrypt } from "./encryption";
import { isReplitOpenAIAvailable } from "./openaiClient";

/**
 * Zentrale, provider-fähige LLM-Konfiguration.
 *
 * Ziel: Kosten steuern, indem nicht jede Aufgabe teuer läuft. Es gibt zwei
 * Modell-Stufen:
 *   - "fast"  → Standard für die Masse (günstig, z. B. gpt-4o-mini / gemini-flash)
 *   - "smart" → nur für schwierige Aufgaben (z. B. Claude Opus / gpt-4o / gemini-pro)
 *
 * Unterstützte Anbieter:
 *   - openai    (OpenAI SDK, Chat Completions)
 *   - anthropic (Claude, nur über llmChat.chatCompletion – separate SDK)
 *   - google    (Gemini über den OpenAI-kompatiblen Endpoint)
 *
 * Hinweis: Embeddings (semanticEmbeddings) und die PDF-Vision über die
 * OpenAI Responses/Files-API (orderPdfVisionExtraction) bleiben bewusst auf
 * OpenAI – ein Wechsel würde den Vektor-Index brechen bzw. wird vom
 * Gemini-OpenAI-Shim nicht unterstützt.
 */

export type ChatProvider = "openai" | "anthropic" | "google";
export type ModelTier = "fast" | "smart";

export type StoredLlmSettings = {
  enabled?: boolean;
  /** OpenAI-Key (verschlüsselt) */
  apiKey?: string;
  /** Aktiver Standard-/Fast-Provider */
  chatProvider?: ChatProvider;
  /** Anthropic (Claude) */
  anthropicApiKey?: string;
  anthropicModel?: string;
  /** OpenAI */
  openaiChatModel?: string;
  /** Google Gemini (verschlüsselt) */
  geminiApiKey?: string;
  googleModel?: string;
  /** Smart-Stufe für schwierige Aufgaben (leer = identisch mit Fast-Stufe) */
  smartProvider?: ChatProvider | "";
  smartModel?: string;
};

/** OpenAI-kompatibler Gemini-Endpoint. */
export const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";

/** Default-Modelle je Anbieter und Stufe. */
export const DEFAULT_MODELS: Record<ChatProvider, Record<ModelTier, string>> = {
  openai: { fast: "gpt-4o-mini", smart: "gpt-4o" },
  anthropic: { fast: "claude-3-5-haiku-latest", smart: "claude-3-5-sonnet-20241022" },
  google: { fast: "gemini-2.0-flash", smart: "gemini-2.5-pro" },
};

/** OpenAI-Modellnamen nicht an Anthropic/Gemini durchreichen. */
const LOOKS_LIKE_OPENAI_MODEL = /^(gpt-|o\d|chatgpt-)/i;

export function normalizeProvider(value: unknown): ChatProvider {
  if (value === "anthropic" || value === "google") return value;
  return "openai";
}

/** Provider der angegebenen Stufe (smart fällt auf fast zurück, wenn nicht gesetzt). */
export function resolveTierProvider(
  settings: StoredLlmSettings,
  tier: ModelTier
): ChatProvider {
  const fast = normalizeProvider(settings.chatProvider);
  if (tier === "fast") return fast;
  const smart = settings.smartProvider;
  if (smart === "openai" || smart === "anthropic" || smart === "google") return smart;
  return fast;
}

/** Modellname der angegebenen Stufe für den (bereits ermittelten) Provider. */
export function resolveTierModel(
  settings: StoredLlmSettings,
  tier: ModelTier,
  provider: ChatProvider
): string {
  if (tier === "smart") {
    const smartProvider = resolveTierProvider(settings, "smart");
    if (smartProvider === provider) {
      const configured = settings.smartModel?.trim();
      if (configured) return configured;
    }
  }
  const perProvider =
    provider === "openai"
      ? settings.openaiChatModel
      : provider === "anthropic"
        ? settings.anthropicModel
        : settings.googleModel;
  const configured = perProvider?.trim();
  if (configured) {
    // Fast-Stufe verwendet das provider-eigene Modellfeld; für Anthropic keine
    // OpenAI-Namen durchreichen.
    if (provider === "anthropic" && LOOKS_LIKE_OPENAI_MODEL.test(configured)) {
      return DEFAULT_MODELS[provider][tier];
    }
    if (tier === "fast") return configured;
  }
  return DEFAULT_MODELS[provider][tier];
}

/** Ergebnis der Client-Auflösung für Chat-Completions-Aufrufer. */
export type ResolvedChatClient = {
  client: OpenAI;
  /** Tatsächlich verwendeter Anbieter dieses Clients (openai oder google). */
  provider: Extract<ChatProvider, "openai" | "google">;
  /** Modellname für die gewünschte Stufe. */
  model: string;
  /** Modell für eine beliebige Stufe (falls ein Aufrufer mischt). */
  resolveModel: (tier: ModelTier) => string;
};

function buildGeminiClient(encryptedKey: string): OpenAI {
  return new OpenAI({
    apiKey: decrypt(encryptedKey),
    baseURL: GEMINI_OPENAI_BASE_URL,
  });
}

function buildOpenAIClient(encryptedKey?: string): OpenAI | null {
  if (isReplitOpenAIAvailable()) {
    return new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });
  }
  if (!encryptedKey) return null;
  return new OpenAI({ apiKey: decrypt(encryptedKey) });
}

/**
 * Liefert einen OpenAI-SDK-kompatiblen Client (OpenAI oder Gemini) plus das
 * für die Stufe passende Modell. Für Chat-Completions-Aufrufer, die heute
 * direkt `client.chat.completions.create({ model })` nutzen.
 *
 * Anthropic hat keinen OpenAI-kompatiblen Chat-Endpoint: Ist Anthropic aktiv,
 * fällt dieser Helfer auf einen verfügbaren OpenAI-kompatiblen Anbieter zurück
 * (OpenAI → Gemini). Die native Claude-Anbindung läuft über
 * llmChat.chatCompletion (Text-Chat / Intent).
 */
export async function getChatClientFromSettings(
  getSetting: (key: string) => Promise<any>,
  opts?: { tier?: ModelTier }
): Promise<ResolvedChatClient | null> {
  const tier = opts?.tier ?? "fast";
  const settings = ((await getSetting("openai_settings")) || {}) as StoredLlmSettings;
  const desired = resolveTierProvider(settings, tier);

  const geminiKey = settings.geminiApiKey;
  const openAIClient = buildOpenAIClient(settings.enabled ? settings.apiKey : undefined);

  // Gewünschten Anbieter bedienen, sonst sinnvoll zurückfallen.
  const order: ChatProvider[] =
    desired === "google"
      ? ["google", "openai"]
      : desired === "anthropic"
        ? ["openai", "google"] // Anthropic hier nicht möglich → OpenAI/Gemini
        : ["openai", "google"];

  for (const provider of order) {
    if (provider === "google" && settings.enabled && geminiKey) {
      const client = buildGeminiClient(geminiKey);
      return {
        client,
        provider: "google",
        model: resolveTierModel(settings, tier, "google"),
        resolveModel: (t) => resolveTierModel(settings, t, "google"),
      };
    }
    if (provider === "openai" && openAIClient) {
      return {
        client: openAIClient,
        provider: "openai",
        model: resolveTierModel(settings, tier, "openai"),
        resolveModel: (t) => resolveTierModel(settings, t, "openai"),
      };
    }
  }
  return null;
}
