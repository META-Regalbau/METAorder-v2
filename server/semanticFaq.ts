import type { IStorage } from "./storage";
import { getAISettings } from "./aiConfig";
import { getOpenAIClientFromSettings } from "./openaiClient";

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
  options?: { preferOpenAI?: boolean; language?: "de" | "en" | "es" }
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
  const openaiConfig = await getOpenAIClientFromSettings(storage.getSetting.bind(storage));
  const wantsOpenAI = options?.preferOpenAI || aiSettings.mode === "openai_only";
  const language = options?.language || inferLanguage(query);

  if (aiSettings.mode === "openai_only" && !openaiConfig) {
    throw new Error("OpenAI mode is required but no API key configured.");
  }

  if (!openaiConfig || aiSettings.mode === "local_only") {
    return {
      answer: buildFallbackAnswer(language, sources),
      sources,
      model: "local-fallback",
    };
  }

  if (aiSettings.mode === "openai_optional" && !wantsOpenAI) {
    return {
      answer: buildFallbackAnswer(language, sources),
      sources,
      model: "local-fallback",
    };
  }

  const sourceContext = sources
    .map((source, index) => `[${index}] ${source.title}\n${source.excerpt}`)
    .join("\n\n");

  const systemPrompt = buildSystemPrompt(language, promptOverrides.faqSystemAddon);
  const userPrompt = `Frage: ${query}\n\nQuellen:\n${sourceContext}`;

  try {
    const completion = await openaiConfig.client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const content = completion.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as { answer?: string; sourceIndexes?: number[] };
    const answer = parsed.answer?.trim() || null;
    const sourceIndexes = Array.isArray(parsed.sourceIndexes) ? parsed.sourceIndexes : [];
    const filteredSources =
      sourceIndexes.length > 0
        ? sourceIndexes
            .map((index) => sources[index])
            .filter(Boolean)
        : sources;

    return {
      answer: answer || buildFallbackAnswer(language, sources),
      sources: filteredSources,
      model: "gpt-4o",
    };
  } catch (error) {
    console.error("[SemanticFAQ] OpenAI error:", error);
    return {
      answer: buildFallbackAnswer(language, sources),
      sources,
      model: "local-fallback",
    };
  }
}
