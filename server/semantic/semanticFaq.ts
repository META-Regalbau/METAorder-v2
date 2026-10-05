import type { IStorage } from "../storage";
import { getAISettings } from "../ai/aiConfig";
import { chatCompletion, isChatLlmConfigured, parseLlmJsonResponse, resolveChatTarget } from "../ai/llmChat";

type SemanticResult = {
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
  metadata?: Record<string, any> | null;
};

export type FaqSource = {
  sourceType: string;
  sourceId: string;
  title: string;
  excerpt: string;
  metadata?: Record<string, any> | null;
};

export type FaqAnswer = {
  answer: string | null;
  sources: FaqSource[];
  model?: string;
  /** KI-Antwort waere moeglich (Chat-Anbieter eingerichtet, Modus nicht "nur lokal") */
  aiAvailable?: boolean;
  /** diese Antwort hat die KI formuliert (sonst: bester Treffer) */
  aiGenerated?: boolean;
};

function buildExcerpt(text: string, maxChars: number) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3))}...`;
}

function inferLanguage(query: string, fallback: "de" | "en" | "es" = "de") {
  if (/[äöüß]/i.test(query)) return "de";
  if (/[¿¡]/.test(query)) return "es";
  if (/[a-z]/i.test(query)) return fallback;
  return fallback;
}

function buildSystemPrompt(language: "de" | "en" | "es", addon?: string) {
  if (language === "en") {
    return [
      "You are a concise FAQ assistant. Use only the provided sources. If the sources do not contain the answer, say so. Respond in JSON: {\"answer\":\"...\",\"sourceIndexes\":[0,2]}.",
      addon ? `Additional instructions: ${addon}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (language === "es") {
    return [
      "Eres un asistente de FAQ conciso. Usa solo las fuentes proporcionadas. Si no contienen la respuesta, dilo. Responde en JSON: {\"answer\":\"...\",\"sourceIndexes\":[0,2]}.",
      addon ? `Instrucciones adicionales: ${addon}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "Du bist ein präziser FAQ-Assistent. Nutze ausschließlich die gelieferten Quellen. Wenn keine Antwort ableitbar ist, sage das. Antworte im JSON-Format: {\"answer\":\"...\",\"sourceIndexes\":[0,2]}.",
    addon ? `Zusätzliche Anweisungen: ${addon}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFallbackAnswer(language: "de" | "en" | "es", sources: FaqSource[]) {
  if (!sources.length) return null;
  const lead = sources[0];
  if (language === "en") {
    return `Based on ${lead.title}: ${lead.excerpt}`;
  }
  if (language === "es") {
    return `Basado en ${lead.title}: ${lead.excerpt}`;
  }
  return `Basierend auf ${lead.title}: ${lead.excerpt}`;
}

export async function generateFaqAnswer(
  storage: IStorage,
  query: string,
  results: SemanticResult[],
  // aiAnswer: KI-Antwort ausdruecklich angefordert (Knopf "KI-Antwort erzeugen"); ohne bleibt es im
  // Modus "KI optional" beim besten Treffer - die Suche selbst kostet so keinen KI-Aufruf
  options?: { preferOpenAI?: boolean; language?: "de" | "en" | "es"; aiAnswer?: boolean }
): Promise<FaqAnswer> {
  const sources: FaqSource[] = results.map((result) => ({
    sourceType: result.sourceType,
    sourceId: result.sourceId,
    title: result.title,
    excerpt: buildExcerpt(result.content || "", 420),
    metadata: result.metadata,
  }));

  if (sources.length === 0) {
    return { answer: null, sources };
  }

  const aiSettings = await getAISettings(storage);
  const promptOverrides = (await storage.getSetting("ai_prompt_overrides")) || {};
  // Chat-Anbieter des Mandanten (OpenAI, Claude oder Gemini); die Modi heissen historisch "openai_*"
  const getSetting = storage.getSetting.bind(storage);
  const llmConfigured = await isChatLlmConfigured(getSetting);
  const wantsOpenAI = options?.preferOpenAI || aiSettings.mode === "openai_only";
  const language = options?.language || inferLanguage(query);

  if (aiSettings.mode === "openai_only" && !llmConfigured) {
    throw new Error("AI mode is required but no chat provider is configured.");
  }

  const aiAvailable = llmConfigured && aiSettings.mode !== "local_only";
  const fallback = (): FaqAnswer => ({
    answer: buildFallbackAnswer(language, sources),
    sources,
    model: "local-fallback",
    aiAvailable,
    aiGenerated: false,
  });

  if (!aiAvailable) {
    return fallback();
  }

  if (aiSettings.mode === "openai_optional" && !wantsOpenAI && !options?.aiAnswer) {
    return fallback();
  }

  const sourceContext = sources
    .map((source, index) => `[${index}] ${source.title}\n${source.excerpt}`)
    .join("\n\n");

  const systemPrompt = buildSystemPrompt(language, promptOverrides.faqSystemAddon);
  const userPrompt = `Frage: ${query}\n\nQuellen:\n${sourceContext}`;

  try {
    const content = await chatCompletion(getSetting, {
      tier: "smart",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      response_json: true,
    });

    const parsed = parseLlmJsonResponse(content) as { answer?: string; sourceIndexes?: number[] };
    const answer = parsed.answer?.trim() || null;
    const sourceIndexes = Array.isArray(parsed.sourceIndexes) ? parsed.sourceIndexes : [];
    const filteredSources =
      sourceIndexes.length > 0
        ? sourceIndexes
            .map((index) => sources[index])
            .filter(Boolean)
        : sources;

    if (!answer) return fallback();
    return {
      answer,
      sources: filteredSources,
      model: (await resolveChatTarget(getSetting, "smart")).model,
      aiAvailable,
      aiGenerated: true,
    };
  } catch (error) {
    console.error("[SemanticFAQ] LLM error:", error);
    return fallback();
  }
}
