import { z } from "zod";
import type { TicketCategory, TicketPriority } from "@shared/schema";
import type { Ticket } from "@shared/schema";
import type { IStorage } from "../storage";
import { chatCompletion, isChatLlmConfigured, resolveChatTarget } from "../ai/llmChat";
import type { ChatProvider } from "../ai/llmClient";

export type TicketAiResult = {
  category: TicketCategory;
  priority: TicketPriority;
  sentiment: "positive" | "neutral" | "negative";
  confidence: number;
  /** Chat-Anbieter der KI-Einordnung oder "heuristic" (Schluesselwoerter) */
  source: ChatProvider | "heuristic";
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
  // Chat-Anbieter des Mandanten (OpenAI, Claude oder Gemini)
  const getSetting = storage.getSetting.bind(storage);
  if (!(await isChatLlmConfigured(getSetting))) {
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

  // Erlaubte Werte nennen: ohne sie antworten die Modelle frei ("Damaged Goods", "High") und die
  // Pruefung faellt auf die Schluesselwoerter zurueck
  const prompt = [
    "Classify the following ticket into category, priority and sentiment.",
    "Return JSON only with keys: category, priority, sentiment, confidence.",
    `Allowed categories: ${schema.shape.category.options.join(", ")}`,
    `Allowed priorities: ${schema.shape.priority.options.join(", ")}`,
    `Allowed sentiments: ${schema.shape.sentiment.options.join(", ")}`,
    "confidence: number between 0 and 1.",
    `Text:\n${buildText(ticket)}`,
  ].join("\n");

  try {
    const raw = await chatCompletion(getSetting, {
      tier: "fast",
      temperature: 0,
      response_json: true,
      messages: [
        { role: "system", content: "You are a JSON-only classifier for support tickets." },
        { role: "user", content: prompt },
      ],
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : raw;
    const json = JSON.parse(jsonText);
    // Gross-/Kleinschreibung der Werte ("High", "Negative") ist kein Grund fuer den Rueckfall
    for (const key of ["category", "priority", "sentiment"]) {
      if (typeof json?.[key] === "string") json[key] = json[key].trim().toLowerCase();
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return heuristicClassification(ticket);
    }

    return {
      category: parsed.data.category,
      priority: parsed.data.priority,
      sentiment: parsed.data.sentiment,
      confidence: parsed.data.confidence,
      source: (await resolveChatTarget(getSetting, "fast")).provider,
    };
  } catch (error) {
    console.error("[TicketAI] Classification failed:", error);
    return heuristicClassification(ticket);
  }
}
