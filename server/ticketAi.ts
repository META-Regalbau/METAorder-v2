import { z } from "zod";
import type { TicketCategory, TicketPriority } from "@shared/schema";
import type { Ticket } from "@shared/schema";
import type { IStorage } from "./storage";
import { getOpenAIClientFromSettings } from "./openaiClient";

export type TicketAiResult = {
  category: TicketCategory;
  priority: TicketPriority;
  sentiment: "positive" | "neutral" | "negative";
  confidence: number;
  source: "openai" | "heuristic";
};

const CATEGORY_RULES: Array<{ keywords: string[]; category: TicketCategory; priority?: TicketPriority }> = [
  { keywords: ["rechnung", "invoice", "zahlung", "payment", "mahnung", "billing"], category: "order_issue" },
  { keywords: ["versand", "lieferung", "tracking", "shipment", "delivery", "status"], category: "order_issue" },
  { keywords: ["produkt", "product", "article", "kompatibel", "spec", "spezifikation"], category: "product_inquiry" },
  { keywords: ["fehler", "bug", "issue", "login", "konto", "technical", "support"], category: "technical_support" },
  { keywords: ["retoure", "rückgabe", "defekt", "complaint", "reklamation"], category: "complaint" },
  { keywords: ["feature", "wunsch", "request", "idea"], category: "feature_request" },
];

const NEGATIVE_KEYWORDS = ["beschwerde", "defekt", "reklamation", "unzufrieden", "angry", "bad", "problem"];
const POSITIVE_KEYWORDS = ["danke", "thank you", "great", "super", "zufrieden"];
const URGENT_KEYWORDS = ["urgent", "dringend", "sofort", "asap", "eilig"];

function normalize(text: string) {
  return text.toLowerCase();
}

function buildText(ticket: Ticket) {
  return [
    ticket.title,
    ticket.description,
    ticket.emailSubject,
    ticket.emailFrom,
    ticket.customerEmail,
    ticket.customerName,
    Array.isArray(ticket.tags) ? ticket.tags.join(" ") : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 12000);
}

function heuristicClassification(ticket: Ticket): TicketAiResult {
  const text = normalize(buildText(ticket));
  let bestScore = 0;
  let bestCategory: TicketCategory = "general";

  for (const rule of CATEGORY_RULES) {
    const matches = rule.keywords.filter((keyword) => text.includes(keyword)).length;
    if (matches > bestScore) {
      bestScore = matches;
      bestCategory = rule.category;
    }
  }

  const priority: TicketPriority = URGENT_KEYWORDS.some((k) => text.includes(k)) ? "urgent" : "normal";
  const sentiment = NEGATIVE_KEYWORDS.some((k) => text.includes(k))
    ? "negative"
    : POSITIVE_KEYWORDS.some((k) => text.includes(k))
      ? "positive"
      : "neutral";

  return {
    category: bestCategory,
    priority,
    sentiment,
    confidence: bestScore > 0 ? Math.min(0.8, 0.3 + bestScore * 0.2) : 0.2,
    source: "heuristic",
  };
}

export async function classifyTicketForRules(storage: IStorage, ticket: Ticket): Promise<TicketAiResult> {
  const openaiConfig = await getOpenAIClientFromSettings(storage.getSetting.bind(storage));
  if (!openaiConfig) {
    return heuristicClassification(ticket);
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
    priority: z.enum(["low", "normal", "high", "urgent"]),
    sentiment: z.enum(["positive", "neutral", "negative"]),
    confidence: z.number().min(0).max(1),
  });

  const prompt = [
    "Classify the following ticket into category, priority and sentiment.",
    "Return JSON only with keys: category, priority, sentiment, confidence.",
    `Text:\n${buildText(ticket)}`,
  ].join("\n");

  try {
    const response = await openaiConfig.client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: "You are a JSON-only classifier for support tickets." },
        { role: "user", content: prompt },
      ],
    });

    const raw = response.choices[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : raw;
    const parsed = schema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      return heuristicClassification(ticket);
    }

    return {
      category: parsed.data.category,
      priority: parsed.data.priority,
      sentiment: parsed.data.sentiment,
      confidence: parsed.data.confidence,
      source: "openai",
    };
  } catch (error) {
    console.error("[TicketAI] Classification failed:", error);
    return heuristicClassification(ticket);
  }
}
