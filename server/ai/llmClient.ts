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
  anthropic: { fast: "claude-haiku-4-5-20251001", smart: "claude-sonnet-5" },
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
