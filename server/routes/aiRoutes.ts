// KI: Textverbesserung, Sentiment, Kategorien, Antwortvorschlaege, KI-Insights (Cross-Selling/Angebote) und semantische Suche/FAQ.
import { requireAuth, requireManageSettings, requireManageCrossSellingRules, requireViewAnalytics, requireManageOffers } from "../auth/auth";
import { z } from "zod";
import { storage } from "../storage";
import {
  getSemanticIndexCounts,
  isSemanticIndexRunning,
  runSemanticIndexForTenant,
  SEMANTIC_INDEX_STATUS_KEY,
} from "../semantic/semanticIndexer";
import { generateEmbedding } from "../semantic/semanticEmbeddings";
import { generateFaqAnswer } from "../semantic/semanticFaq";
import { runCrossSellLearning } from "../cross-selling/crossSellLearning";
import { generateCrossSellStaging } from "../cross-selling/crossSellService";
import { runOfferLearning } from "../offers/offerLearning";
import rateLimit from "express-rate-limit";
import type { Express } from "express";


import { takeMinuteSlot } from "../analytics/nlQueryLimit";

/** KI-Antworten der FAQ je Nutzer und Minute (jede kostet einen Aufruf im "smart"-Modell) */
const FAQ_AI_PER_MINUTE = 5;
// Rate limiters for expensive endpoints
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});


const semanticRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

export function registerAiRoutes(app: Express): void {
  // AI Text Improvement
  app.post("/api/ai/improve-text", requireAuth, aiRateLimiter, async (req, res) => {
    try {
      const textSchema = z.object({
        text: z.string().min(1, "Text is required"),
      });

      const validatedData = textSchema.parse(req.body);
      const { text } = validatedData;

      const { chatCompletion } = await import("../ai/llmChat");
      let improvedText: string;
      try {
        improvedText = await chatCompletion((key) => storage.getSetting(key), {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Verbessere diesen Kundenservice-Text. Mache ihn freundlicher und professioneller, aber halte die Kernaussage bei. Antworte nur mit dem verbesserten Text, ohne Erklärungen.",
            },
            { role: "user", content: text },
          ],
          max_tokens: 500,
        });
      } catch {
        return res.status(400).json({ error: "AI features are not enabled" });
      }

      res.json({ improvedText: improvedText?.trim() ? improvedText : text });
    } catch (error: any) {
      console.error("Error improving text with AI:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to improve text" });
    }
  });

  // AI Sentiment Analysis
  app.post("/api/ai/analyze-sentiment", requireAuth, aiRateLimiter, async (req, res) => {
    try {
      const sentimentSchema = z.object({
        text: z.string().min(1, "Text is required"),
      });

      const validatedData = sentimentSchema.parse(req.body);
      const { text } = validatedData;

      const { chatCompletion } = await import("../ai/llmChat");
      let sentimentRaw: string;
      try {
        sentimentRaw = await chatCompletion((key) => storage.getSetting(key), {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Analysiere den Sentiment dieses Kundenservice-Textes. Antworte NUR mit einem einzigen Wort: 'positive', 'negative', oder 'neutral'.",
            },
            { role: "user", content: text },
          ],
          max_tokens: 10,
          temperature: 0.3,
        });
      } catch {
        return res.status(400).json({ error: "AI features are not enabled" });
      }

      const sentiment = sentimentRaw?.toLowerCase().trim() || "neutral";
      
      // Validate sentiment response
      const validSentiments = ["positive", "negative", "neutral"];
      const finalSentiment = validSentiments.includes(sentiment) ? sentiment : "neutral";

      res.json({ sentiment: finalSentiment });
    } catch (error: any) {
      console.error("Error analyzing sentiment:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to analyze sentiment" });
    }
  });

  // AI Category and Tag Suggestions
  app.post("/api/ai/suggest-categories", requireAuth, aiRateLimiter, async (req, res) => {
    try {
      const categorySchema = z.object({
        title: z.string(),
        description: z.string(),
      });

      const validatedData = categorySchema.parse(req.body);
      const { title, description } = validatedData;

      const { chatCompletion, parseLlmJsonResponse } = await import("../ai/llmChat");
      let categoryJson: string;
      try {
        categoryJson = await chatCompletion((key) => storage.getSetting(key), {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Analysiere dieses Kundenservice-Ticket und schlage eine Kategorie und passende Tags vor.

Verfügbare Kategorien:
- general (Allgemeine Anfrage)
- order_issue (Bestellproblem)
- product_inquiry (Produktanfrage)
- technical_support (Technischer Support)
- complaint (Beschwerde)
- feature_request (Feature-Wunsch)
- other (Sonstiges)

Antworte im JSON-Format:
{
  "category": "eine_der_verfügbaren_kategorien",
  "tags": ["tag1", "tag2", "tag3"]
}

Die Tags sollten spezifisch und relevant sein (z.B. "Versand", "Zahlung", "Reklamation", "Dringend").`,
            },
            {
              role: "user",
              content: `Titel: ${title}\n\nBeschreibung: ${description}`,
            },
          ],
          max_tokens: 150,
          temperature: 0.5,
          response_json: true,
        });
      } catch {
        return res.status(400).json({ error: "AI features are not enabled" });
      }

      const result = parseLlmJsonResponse(categoryJson) as Record<string, unknown>;
      
      res.json({
        category: result.category || "general",
        tags: result.tags || []
      });
    } catch (error: any) {
      console.error("Error suggesting categories:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to suggest categories" });
    }
  });

  // AI Smart Reply Generator
  app.post("/api/ai/generate-replies", requireAuth, aiRateLimiter, async (req, res) => {
    try {
      const replySchema = z.object({
        title: z.string(),
        description: z.string(),
        category: z.string().optional(),
      });

      const validatedData = replySchema.parse(req.body);
      const { title, description, category } = validatedData;

      const { chatCompletion, parseLlmJsonResponse: parseRepliesJson } = await import("../ai/llmChat");
      let repliesJson: string;
      try {
        repliesJson = await chatCompletion((key) => storage.getSetting(key), {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Du bist ein professioneller Kundenservice-Mitarbeiter. Generiere 3 verschiedene, hilfreiche Antwort-Vorschläge für dieses Ticket.

Die Antworten sollten:
- Freundlich und professionell sein
- Konkret auf das Problem eingehen
- Lösungsansätze anbieten
- In deutscher Sprache verfasst sein

Antworte im JSON-Format:
{
  "replies": [
    "Erste Antwort...",
    "Zweite Antwort...",
    "Dritte Antwort..."
  ]
}`,
            },
            {
              role: "user",
              content: `Kategorie: ${category || "Allgemein"}\nTitel: ${title}\n\nBeschreibung: ${description}`,
            },
          ],
          max_tokens: 800,
          temperature: 0.7,
          response_json: true,
        });
      } catch {
        return res.status(400).json({ error: "AI features are not enabled" });
      }

      const result = parseRepliesJson(repliesJson) as Record<string, unknown>;
      
      res.json({
        replies: result.replies || []
      });
    } catch (error: any) {
      console.error("Error generating replies:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to generate replies" });
    }
  });

  // Index des eigenen Mandanten aufbauen/aktualisieren. Laeuft im Hintergrund (erster Aufbau mit
  // tausenden Produkten dauert); Fortschritt ueber GET /api/semantic/index/status.
  app.post("/api/semantic/index", requireAuth, requireManageSettings, semanticRateLimiter, async (req, res) => {
    const tenantId = (req as any).tenantId ?? null;
    if (isSemanticIndexRunning(tenantId)) {
      return res.status(409).json({ error: "Indexing already running", code: "running" });
    }
    const { sources, useOpenAI } = req.body || {};
    void runSemanticIndexForTenant(storage, tenantId, {
      sources: Array.isArray(sources) ? sources : undefined,
      preferOpenAI: Boolean(useOpenAI),
    }).catch((error) => console.error("[SemanticIndex] Error:", error));
    res.status(202).json({ started: true });
  });

  // Stand des Index: Eintraege je Quelle, laeuft gerade, letzter Lauf (Suche zeigt bei leerem Index einen Hinweis)
  app.get("/api/semantic/index/status", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const counts = await getSemanticIndexCounts(tenantId);
      res.json({
        running: isSemanticIndexRunning(tenantId),
        counts,
        total: Object.values(counts).reduce((sum, n) => sum + n, 0),
        lastRun: (await storage.getSetting(SEMANTIC_INDEX_STATUS_KEY, tenantId)) ?? null,
      });
    } catch (error: any) {
      console.error("[SemanticIndex] Status error:", error);
      res.status(500).json({ error: error.message || "Failed to load index status" });
    }
  });

  app.post("/api/semantic/search", requireAuth, semanticRateLimiter, async (req, res) => {
    try {
      const { query, limit = 10, sourceTypes, useOpenAI } = req.body || {};
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query is required" });
      }
      const tenantId = (req as any).tenantId ?? null;
      const { embedding, provider } = await generateEmbedding(query, storage, {
        preferOpenAI: Boolean(useOpenAI),
      });
      const results = await storage.searchSemanticDocuments(embedding, {
        localQueryEmbedding: provider === "local",
        limit: Number(limit) || 10,
        sourceTypes: Array.isArray(sourceTypes) ? sourceTypes : undefined,
        query,
      }, tenantId);
      const sanitized = results.map(({ embedding, embeddingProvider, embeddingModel, contentHash, ...rest }) => rest);
      res.json({ results: sanitized });
    } catch (error: any) {
      console.error("[SemanticSearch] Error:", error);
      res.status(500).json({ error: error.message || "Semantic search failed" });
    }
  });

  app.post("/api/semantic/faq", requireAuth, semanticRateLimiter, async (req, res) => {
    try {
      const { query, limit = 6, sourceTypes, useOpenAI, language } = req.body || {};
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query is required" });
      }
      const tenantId = (req as any).tenantId ?? null;
      // KI-Antwort nur auf ausdruecklichen Wunsch (Knopf); hoechstens 5 je Nutzer und Minute
      const aiAnswer = req.body?.aiAnswer === true;
      if (aiAnswer && !takeMinuteSlot(`faq:${tenantId ?? ""}:${(req.user as any)?.id ?? ""}`, FAQ_AI_PER_MINUTE)) {
        return res.status(429).json({ error: "Too many AI answers, please wait a minute", code: "rate_limited" });
      }
      const { embedding, provider } = await generateEmbedding(query, storage, {
        preferOpenAI: Boolean(useOpenAI),
      });
      const results = await storage.searchSemanticDocuments(embedding, {
        localQueryEmbedding: provider === "local",
        limit: Number(limit) || 6,
        sourceTypes: Array.isArray(sourceTypes) ? sourceTypes : undefined,
        query,
      }, tenantId);
      const normalizedResults = results.map((entry) => ({
        ...entry,
        metadata: entry.metadata ?? undefined,
      }));
      const faqAnswer = await generateFaqAnswer(storage, query, normalizedResults, {
        preferOpenAI: Boolean(useOpenAI),
        language: language === "en" || language === "es" ? language : "de",
        aiAnswer,
      });
      res.json(faqAnswer);
    } catch (error: any) {
      console.error("[SemanticFAQ] Error:", error);
      res.status(500).json({ error: error.message || "Semantic FAQ failed" });
    }
  });

  app.post("/api/semantic/faq/feedback", requireAuth, semanticRateLimiter, async (req, res) => {
    try {
      const schema = z.object({
        query: z.string().min(1),
        helpful: z.boolean(),
        sourceIds: z.array(z.string()).optional(),
      });
      const data = schema.parse(req.body);
      const tenantId = (req as any).tenantId ?? null;
      const existing = (await storage.getSetting("semantic_faq_feedback", tenantId)) || [];
      const entry = {
        query: data.query,
        helpful: data.helpful,
        sourceIds: data.sourceIds || [],
        userId: (req.user as any)?.id || null,
        createdAt: new Date().toISOString(),
      };
      const next = Array.isArray(existing) ? [...existing, entry].slice(-500) : [entry];
      await storage.saveSetting("semantic_faq_feedback", next, tenantId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[SemanticFAQ] Feedback error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Semantic FAQ feedback failed" });
    }
  });

  app.post("/api/semantic/search/feedback", requireAuth, semanticRateLimiter, async (req, res) => {
    try {
      const schema = z.object({
        query: z.string().min(1),
        sourceType: z.string().min(1),
        sourceId: z.string().min(1),
        action: z.enum(["open", "like", "dislike"]).optional(),
      });
      const data = schema.parse(req.body);
      const tenantId = (req as any).tenantId ?? null;
      const existing = (await storage.getSetting("semantic_search_feedback", tenantId)) || [];
      const entry = {
        query: data.query,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        action: data.action || "open",
        userId: (req.user as any)?.id || null,
        createdAt: new Date().toISOString(),
      };
      const next = Array.isArray(existing) ? [...existing, entry].slice(-1000) : [entry];
      await storage.saveSetting("semantic_search_feedback", next, tenantId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[SemanticSearch] Feedback error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Semantic search feedback failed" });
    }
  });

  app.post("/api/semantic/similar", requireAuth, semanticRateLimiter, async (req, res) => {
    try {
      const { sourceType, sourceId, limit = 10 } = req.body || {};
      if (!sourceType || !sourceId) {
        return res.status(400).json({ error: "sourceType and sourceId are required" });
      }
      const tenantId = (req as any).tenantId ?? null;
      const embedding = await storage.getSemanticDocumentEmbedding(sourceType, sourceId);
      if (!embedding) {
        return res.status(404).json({ error: "Source document not indexed" });
      }
      const results = await storage.searchSemanticDocuments(embedding, {
        limit: Number(limit) || 10,
      }, tenantId);
      const sanitized = results.map(({ embedding, embeddingProvider, embeddingModel, contentHash, ...rest }) => rest);
      res.json({
        results: sanitized.filter((entry) => !(entry.sourceType === sourceType && entry.sourceId === sourceId)),
      });
    } catch (error: any) {
      console.error("[SemanticSimilar] Error:", error);
      res.status(500).json({ error: error.message || "Semantic similar search failed" });
    }
  });

  // AI-generated cross-selling rules
  app.get("/api/ai/cross-selling/rules", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const rules = await storage.getAiCrossSellRules(req.tenantId ?? null);
      console.log("[CrossSellLearning] GET /rules", {
        tenantId: req.tenantId ?? null,
        rules: rules.length,
      });
      // #endregion
      res.json({ rules });
    } catch (error: any) {
      console.error("Error fetching AI cross-selling rules:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI rules" });
    }
  });

  app.get("/api/ai/cross-selling/insights", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const insights = await storage.getAiInsights(req.tenantId ?? null);
      res.json({ insights });
    } catch (error: any) {
      console.error("Error fetching cross-selling AI insights:", error);
      res.status(500).json({ error: error.message || "Failed to fetch insights" });
    }
  });

  app.get("/api/ai/cross-selling/recommendations", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const productNumber = (req.query.productNumber as string) || undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const recommendations = await storage.getAiRecommendations(productNumber, limit, req.tenantId ?? null);
      res.json({ recommendations });
    } catch (error: any) {
      console.error("Error fetching AI recommendations:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI recommendations" });
    }
  });

  app.get("/api/ai/insights", requireAuth, requireViewAnalytics, async (req, res) => {
    try {
      const insights = await storage.getAiInsights(req.tenantId ?? null);
      res.json({ insights });
    } catch (error: any) {
      console.error("Error fetching AI insights:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI insights" });
    }
  });

  app.get("/api/ai/cross-selling/status", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const status = await storage.getSetting("cross_sell_learning_status", req.tenantId ?? null);
      res.json(status || { status: "idle" });
    } catch (error: any) {
      console.error("Error fetching learning status:", error);
      res.status(500).json({ error: error.message || "Failed to fetch status" });
    }
  });

  app.post("/api/ai/cross-selling/run", requireAuth, requireManageCrossSellingRules, aiRateLimiter, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      console.log("[CrossSellLearning] POST /run", {
        tenantId: req.tenantId ?? null,
        userId: (req.user as any)?.id ?? null,
      });
      // #endregion
      const status = await runCrossSellLearning(storage, settings, req.tenantId ?? null);
      let staging: {
        batchId: string;
        rulesCount: number;
        suggestionsCount: number;
        productsWithSuggestions: number;
        productsWithoutSuggestions: number;
      } | null = null;
      try {
        staging = await generateCrossSellStaging(req.tenantId ?? null, (req.user as any)?.id ?? null);
      } catch (stagingError: any) {
        console.warn("[CrossSellLearning] Staging generation failed:", stagingError?.message || stagingError);
      }
      // #endregion
      res.json({ ...status, staging });
    } catch (error: any) {
      console.error("Error running cross-selling learning:", error);
      res.status(500).json({ error: error.message || "Failed to run learning job" });
    }
  });

  // Offer Learning Insights
  app.get("/api/ai/offers/insights", requireAuth, requireViewAnalytics, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const insights = await storage.getOfferLearningInsights(tenantId);
      res.json({ insights });
    } catch (error: any) {
      console.error("Error fetching offer insights:", error);
      res.status(500).json({ error: error.message || "Failed to fetch offer insights" });
    }
  });

  app.post("/api/ai/offers/run", requireAuth, requireManageOffers, aiRateLimiter, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const result = await runOfferLearning(storage, settings, tenantId);
      res.json(result);
    } catch (error: any) {
      console.error("Error running offer learning:", error);
      res.status(500).json({ error: error.message || "Failed to run offer learning" });
    }
  });
}
