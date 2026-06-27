import { z } from "zod";
import type { EmailRoutingSettings, TicketCategory, TicketPriority } from "@shared/schema";
import { getOpenAIClientFromSettings } from "./openaiClient";
import type { IStorage } from "./storage";

export type EmailClassification = {
  category: TicketCategory;
  priority: TicketPriority;
  skill?: string;
  confidence: number;
  source: "heuristic" | "openai";
};

const KEYWORD_RULES: Array<{
  keywords: string[];
  category: TicketCategory;
  skill?: string;
}> = [
  {
    keywords: ["rechnung", "invoice", "zahlung", "payment", "mahnung", "billing"],
    category: "order_issue",
    skill: "billing",
  },
  {
    keywords: ["versand", "lieferung", "tracking", "shipment", "delivery", "status"],
    category: "order_issue",
    skill: "shipping",
  },
  {
    keywords: ["produkt", "product", "article", "kompatibel", "spec", "spezifikation"],
    category: "product_inquiry",
    skill: "sales",
  },
  {
    keywords: ["fehler", "bug", "issue", "login", "konto", "technical", "support"],
    category: "technical_support",
    skill: "support",
  },
  {
    keywords: ["retoure", "rückgabe", "defekt", "complaint", "reklamation"],
    category: "complaint",
    skill: "support",
  },
  {
    keywords: ["feature", "wunsch", "request", "idea", "feature_request"],
    category: "feature_request",
    skill: "product",
  },
];

const URGENT_KEYWORDS = ["urgent", "dringend", "sofort", "asap", "eilig"];

function normalizeText(text: string) {
  return text.toLowerCase();
}

function heuristicClassification(
  text: string,
  settings: EmailRoutingSettings
): EmailClassification {
  const normalized = normalizeText(text);
  let bestScore = 0;
  let bestRule: typeof KEYWORD_RULES[number] | null = null;

  for (const rule of KEYWORD_RULES) {
    const matches = rule.keywords.filter((keyword) => normalized.includes(keyword)).length;
    if (matches > bestScore) {
      bestScore = matches;
      bestRule = rule;
    }
  }

  const urgent = URGENT_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const priority: TicketPriority = urgent ? "urgent" : settings.defaultPriority;

  if (!bestRule) {
    return {
      category: settings.defaultCategory,
      priority,
      skill: settings.defaultSkill,
      confidence: 0.2,
      source: "heuristic",
    };
  }

  const confidence = Math.min(0.9, 0.2 + bestScore * 0.2);
  return {
    category: bestRule.category,
    priority,
    skill: bestRule.skill || settings.defaultSkill,
    confidence,
    source: "heuristic",
  };
}

export async function classifyIncomingEmail(
  storage: IStorage,
  input: { subject: string; body: string; from?: string },
  settings: EmailRoutingSettings,
  skillCatalog: string[]
): Promise<EmailClassification> {
  const combined = `${input.subject}\n${input.body}\n${input.from || ""}`.slice(0, 12000);
  const openaiConfig = await getOpenAIClientFromSettings(storage.getSetting.bind(storage));

  if (!openaiConfig) {
    return heuristicClassification(combined, settings);
  }

  const schema = z.object({
    category: z.enum([
      "general",
      "order_issue",
      "product_inquiry",
      "technical_support",
      "complaint",
      "feature_request",
      "other",
    ]),
    priority: z.enum(["low", "normal", "high", "urgent"]).default(settings.defaultPriority),
    skill: z.string().optional(),
    confidence: z.number().min(0).max(1),
  });

  const skillOptions = skillCatalog.length > 0 ? skillCatalog : [settings.defaultSkill].filter(Boolean);
  const prompt = [
    "Classify the following customer email into a support category and optional skill.",
    "Return JSON only with keys: category, priority, skill, confidence.",
    `Allowed categories: ${schema.shape.category.options.join(", ")}`,
    `Allowed priorities: low, normal, high, urgent.`,
    `Allowed skills: ${skillOptions.join(", ") || "none"}`,
    "Email:",
    combined,
  ].join("\n");

  try {
    const response = await openaiConfig.client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: "You are a JSON-only classifier for support emails." },
        { role: "user", content: prompt },
      ],
    });

    const raw = response.choices[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : raw;
    const parsed = schema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      return heuristicClassification(combined, settings);
    }

    return {
      category: parsed.data.category,
      priority: parsed.data.priority,
      skill: parsed.data.skill || settings.defaultSkill,
      confidence: parsed.data.confidence,
      source: "openai",
    };
  } catch (error) {
    console.error("[EmailClassifier] OpenAI classification failed:", error);
    return heuristicClassification(combined, settings);
  }
}
