/**
 * KI-Module ueber den Chat-Anbieter des Mandanten (OpenAI, Claude, Gemini): Ticket-Einordnung,
 * E-Mail-Einordnung, FAQ-Antworten, semantische Produktsuche und Cross-Selling-Sortierung liefen
 * ueber einen Client, der Claude nicht bedienen kann - bei einem Mandanten nur mit Claude fielen sie
 * still auf Regeln/Heuristik zurueck. Geprueft mit Claude als Anbieter (chatCompletion gemockt,
 * Einstellungen und Anbieter-Ermittlung echt) und ohne Anbieter (Rueckfall, kein KI-Aufruf).
 * Ausführung: npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, Ticket } from "../../shared/schema";

type Call = { tier?: string; response_json?: boolean; system: string; user: string };
const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  reply: "{}",
  fail: false,
  calls: [] as Call[],
}));

vi.mock("../../server/ai/llmChat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/ai/llmChat")>();
  return {
    ...actual,
    chatCompletion: async (getSetting: (key: string) => Promise<any>, params: any) => {
      // wie der echte Aufruf: Einstellungen des Mandanten lesen
      await getSetting("openai_settings");
      state.calls.push({
        tier: params.tier,
        response_json: params.response_json,
        system: params.messages.find((m: any) => m.role === "system")?.content ?? "",
        user: params.messages.find((m: any) => m.role === "user")?.content ?? "",
      });
      if (state.fail) throw new Error("Anbieter nicht erreichbar");
      return state.reply;
    },
  };
});

import { classifyTicketForRules } from "../../server/tickets/ticketAi";
import { classifyIncomingEmail } from "../../server/email/emailClassifier";
import { generateFaqAnswer } from "../../server/semantic/semanticFaq";
import { executeSemanticProductSearch } from "../../server/semantic/semanticProductSearch";
import { llmRerankCrossSellCandidates } from "../../server/cross-selling/crossSellLlmRerank";

const CLAUDE_ONLY = { enabled: true, chatProvider: "anthropic", anthropicApiKey: "verschluesselt" };
// Claude ausgeschaltet: unabhaengig von einem OpenAI-Schluessel in der Umgebung kein Anbieter
const NO_PROVIDER = { enabled: false, chatProvider: "anthropic" };

const storage = {
  getSetting: async (key: string) => state.settings[key],
  saveSetting: async (key: string, value: unknown) => {
    state.settings[key] = value;
  },
} as any;

beforeEach(() => {
  state.settings = { openai_settings: CLAUDE_ONLY, ai_settings: { mode: "openai_only" } };
  state.reply = "{}";
  state.fail = false;
  state.calls = [];
});

const ticket = {
  id: "t1",
  title: "Lieferung beschädigt",
  description: "Die Ware kam kaputt an, bitte dringend Ersatz",
  tags: [],
} as unknown as Ticket;

describe("Ticket-Einordnung", () => {
  it("Claude als Anbieter: KI-Einordnung statt Schluesselwoerter, Quelle = Anbieter", async () => {
    state.reply = JSON.stringify({ category: "complaint", priority: "high", sentiment: "negative", confidence: 0.92 });
    const result = await classifyTicketForRules(storage, ticket);
    expect(result).toEqual({ category: "complaint", priority: "high", sentiment: "negative", confidence: 0.92, source: "anthropic" });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ tier: "fast", response_json: true });
  });

  it("ohne Anbieter: Schluesselwoerter, kein KI-Aufruf", async () => {
    state.settings.openai_settings = NO_PROVIDER;
    const result = await classifyTicketForRules(storage, ticket);
    expect(result.source).toBe("heuristic");
    expect(state.calls).toHaveLength(0);
  });

  it("Anbieter-Fehler oder ungueltige Antwort: Schluesselwoerter", async () => {
    state.fail = true;
    expect((await classifyTicketForRules(storage, ticket)).source).toBe("heuristic");
    state.fail = false;
    state.reply = JSON.stringify({ category: "unbekannt" });
    expect((await classifyTicketForRules(storage, ticket)).source).toBe("heuristic");
  });
});

describe("E-Mail-Einordnung", () => {
  const routing = { defaultPriority: "normal", defaultSkill: "support", rules: [] } as any;

  it("Claude als Anbieter: KI-Einordnung mit Skill aus dem Katalog", async () => {
    state.reply = "```json\n" + JSON.stringify({ category: "order_issue", priority: "urgent", skill: "versand", confidence: 0.8 }) + "\n```";
    const result = await classifyIncomingEmail(storage, { subject: "Bestellung fehlt", body: "Wo bleibt meine Lieferung?" }, routing, ["versand", "support"]);
    expect(result).toEqual({ category: "order_issue", priority: "urgent", skill: "versand", confidence: 0.8, source: "anthropic" });
    expect(state.calls[0].user).toContain("Allowed skills: versand, support");
  });

  it("ohne Anbieter: Regeln, kein KI-Aufruf", async () => {
    state.settings.openai_settings = NO_PROVIDER;
    const result = await classifyIncomingEmail(storage, { subject: "Hallo", body: "Frage" }, routing, []);
    expect(result.source).toBe("heuristic");
    expect(state.calls).toHaveLength(0);
  });
});

describe("FAQ-Antworten", () => {
  const results = [
    { sourceType: "faq", sourceId: "1", title: "Lieferzeiten", content: "Standardregale liefern wir in 5 Werktagen." },
    { sourceType: "faq", sourceId: "2", title: "Montage", content: "Montage auf Anfrage." },
  ];

  it("Claude als Anbieter: Antwort der KI, Quellen nach Index, Modell des Anbieters", async () => {
    state.reply = JSON.stringify({ answer: "In 5 Werktagen.", sourceIndexes: [0] });
    const answer = await generateFaqAnswer(storage, "Wie lange dauert die Lieferung?", results);
    expect(answer.answer).toBe("In 5 Werktagen.");
    expect(answer.sources.map((s) => s.sourceId)).toEqual(["1"]);
    expect(answer.model).toMatch(/^claude-/);
    expect(state.calls[0]).toMatchObject({ tier: "smart", response_json: true });
  });

  it("KI verlangt, aber kein Anbieter: Fehler wie bisher", async () => {
    state.settings.openai_settings = NO_PROVIDER;
    await expect(generateFaqAnswer(storage, "Lieferung?", results)).rejects.toThrow("no chat provider");
  });

  it("KI optional ohne Wunsch: Antwort aus der ersten Quelle, kein KI-Aufruf", async () => {
    state.settings.ai_settings = { mode: "openai_optional" };
    const answer = await generateFaqAnswer(storage, "Lieferung?", results);
    expect(answer).toMatchObject({ model: "local-fallback", answer: "Basierend auf Lieferzeiten: Standardregale liefern wir in 5 Werktagen." });
    expect(state.calls).toHaveLength(0);
  });
});

describe("Semantische Produktsuche", () => {
  const products = [
    { id: "p1", productNumber: "A-1", name: "Fachbodenregal 2000 x 1000", description: "", price: 100 },
    { id: "p2", productNumber: "B-2", name: "Kragarmregal", description: "", price: 200 },
  ] as unknown as Product[];
  const getSetting = (key: string) => storage.getSetting(key);

  it("Claude als Anbieter: Deutung der KI", async () => {
    state.reply = JSON.stringify({ keywords: ["kragarmregal"], interpretation: "Kragarmregal gesucht" });
    const result = await executeSemanticProductSearch({ query: "Kragarm", language: "de" }, products, { getSetting });
    expect(result.interpretation.interpretation).toBe("Kragarmregal gesucht");
    expect(state.calls[0]).toMatchObject({ tier: "smart", response_json: true });
  });

  it("ungueltige Antwort oder Fehler: Rueckfall-Deutung", async () => {
    state.reply = "kein JSON";
    const invalid = await executeSemanticProductSearch({ query: "Kragarm", language: "de" }, products, { getSetting });
    expect(invalid.interpretation.interpretation).not.toBe("Kragarmregal gesucht");
    state.fail = true;
    const failed = await executeSemanticProductSearch({ query: "Kragarm", language: "de" }, products, { getSetting });
    expect(failed.interpretation).toEqual(invalid.interpretation);
  });
});

describe("Cross-Selling-Sortierung", () => {
  const source = { id: "s", productNumber: "SRC", name: "Fachbodenregal" } as unknown as Product;
  const candidates = ["X1", "X2", "X3"].map((pn, i) => ({ id: `c${i}`, productNumber: pn, name: pn, hybridScore: 1 - i * 0.1 })) as any[];
  const params = { storage, tenantId: "tenant-a", sourceProduct: source, candidates, topK: 3, topN: 3, ttlHours: 1, useLlmFromSettings: true };

  it("Claude als Anbieter: Reihenfolge und Begruendung der KI", async () => {
    state.reply = JSON.stringify({ ranking: [{ productNumber: "X3", reason: "passender Boden" }, { productNumber: "X1", reason: "Zubehoer" }] });
    const ranked = await llmRerankCrossSellCandidates(params);
    expect(ranked.map((r) => r.productNumber)).toEqual(["X3", "X1", "X2"]);
    expect(ranked[0].crossSellReason).toBe("passender Boden");
    expect(state.calls[0]).toMatchObject({ tier: "smart", response_json: true });
  });

  it("ohne Anbieter: Hybrid-Reihenfolge, kein KI-Aufruf", async () => {
    state.settings.openai_settings = NO_PROVIDER;
    const ranked = await llmRerankCrossSellCandidates(params);
    expect(ranked.map((r) => r.productNumber)).toEqual(["X1", "X2", "X3"]);
    expect(state.calls).toHaveLength(0);
  });
});
