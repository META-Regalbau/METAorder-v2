/**
 * FAQ: KI-Antwort nur auf Knopfdruck. Im Standard-Modus "KI optional" zeigt die FAQ den besten
 * Treffer (kein KI-Aufruf je Suche); "KI-Antwort erzeugen" fordert die Antwort ausdruecklich an
 * (aiAnswer). Hoechstens 5 KI-Antworten je Nutzer und Minute. Das Such-Embedding bleibt dabei
 * unveraendert (sonst wuerden Anfrage und Index verschieden berechnet).
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const llm = vi.hoisted(() => ({
  configured: true,
  mode: "openai_optional" as string,
  calls: 0,
  reply: JSON.stringify({ answer: "KI: Kragarmregale gibt es einseitig.", sourceIndexes: [1] }) as string | Error,
}));

vi.mock("../../server/ai/llmChat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/ai/llmChat")>();
  return {
    ...actual,
    isChatLlmConfigured: async () => llm.configured,
    chatCompletion: async () => {
      llm.calls += 1;
      if (llm.reply instanceof Error) throw llm.reply;
      return llm.reply;
    },
    resolveChatTarget: async () => ({ provider: "anthropic", model: "claude-sonnet" }),
  };
});
vi.mock("../../server/ai/aiConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/ai/aiConfig")>();
  return { ...actual, getAISettings: async () => ({ ...(await actual.getAISettings({ getSetting: async () => undefined } as any)), mode: llm.mode }) };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = { id: "u1" };
    req.tenantId = "tenant-a";
    next();
  };
  return { ...actual, requireAuth: pass, requireManageSettings: pass };
});

import { generateFaqAnswer } from "../../server/semantic/semanticFaq";
import * as embeddings from "../../server/semantic/semanticEmbeddings";
import { storage } from "../../server/storage";
import { resetMinuteBucketsForTests } from "../../server/analytics/nlQueryLimit";

const results = [
  { sourceType: "product", sourceId: "p1", title: "Fachbodenregal", content: "Fachbodenregal verzinkt" },
  { sourceType: "product", sourceId: "p2", title: "Kragarmregal", content: "Kragarmregal einseitig RAL 5010" },
];
const fakeStorage = { getSetting: async () => undefined } as any;

beforeEach(() => {
  llm.configured = true;
  llm.mode = "openai_optional";
  llm.calls = 0;
  llm.reply = JSON.stringify({ answer: "KI: Kragarmregale gibt es einseitig.", sourceIndexes: [1] });
  resetMinuteBucketsForTests();
});

describe("FAQ-Antwort", () => {
  it("ohne Anforderung: bester Treffer, kein KI-Aufruf, KI waere moeglich", async () => {
    const r = await generateFaqAnswer(fakeStorage, "Kragarm", results, { language: "de" });
    expect(r).toMatchObject({ aiAvailable: true, aiGenerated: false, model: "local-fallback" });
    expect(r.answer).toMatch(/^Basierend auf Fachbodenregal/);
    expect(llm.calls).toBe(0);
  });

  it("mit aiAnswer: ein KI-Aufruf, Antwort und Quellen der KI", async () => {
    const r = await generateFaqAnswer(fakeStorage, "Kragarm", results, { language: "de", aiAnswer: true });
    expect(r).toMatchObject({ answer: "KI: Kragarmregale gibt es einseitig.", aiAvailable: true, aiGenerated: true, model: "claude-sonnet" });
    expect(r.sources.map((s) => s.sourceId)).toEqual(["p2"]);
    expect(llm.calls).toBe(1);
  });

  it("Modus 'nur lokal' oder kein Anbieter: keine KI, auch nicht auf Anforderung", async () => {
    llm.mode = "local_only";
    expect(await generateFaqAnswer(fakeStorage, "x", results, { aiAnswer: true })).toMatchObject({ aiAvailable: false, aiGenerated: false });
    llm.mode = "openai_optional";
    llm.configured = false;
    expect(await generateFaqAnswer(fakeStorage, "x", results, { aiAnswer: true })).toMatchObject({ aiAvailable: false, aiGenerated: false });
    expect(llm.calls).toBe(0);
  });

  it("KI-Fehler oder leere KI-Antwort: bester Treffer, als solcher markiert", async () => {
    llm.reply = new Error("timeout");
    expect(await generateFaqAnswer(fakeStorage, "x", results, { aiAnswer: true })).toMatchObject({ aiGenerated: false, aiAvailable: true });
    llm.reply = JSON.stringify({ answer: "  " });
    expect(await generateFaqAnswer(fakeStorage, "x", results, { aiAnswer: true })).toMatchObject({ aiGenerated: false });
  });

  it("ohne Treffer keine Antwort und kein Aufruf", async () => {
    expect(await generateFaqAnswer(fakeStorage, "x", [], { aiAnswer: true })).toEqual({ answer: null, sources: [] });
    expect(llm.calls).toBe(0);
  });
});

describe("Route /api/semantic/faq", () => {
  let server: Server;
  let base = "";
  const embedCalls: Array<{ preferOpenAI?: boolean }> = [];
  beforeAll(async () => {
    vi.spyOn(embeddings, "generateEmbedding").mockImplementation(async (_t, _s, opts) => {
      embedCalls.push({ preferOpenAI: opts?.preferOpenAI });
      return { embedding: [1, 0], provider: "local", model: "local-hash-v1" };
    });
    vi.spyOn(storage, "searchSemanticDocuments").mockResolvedValue(results as any);
    vi.spyOn(storage, "getSetting").mockResolvedValue(undefined);
    const { registerAiRoutes } = await import("../../server/routes/aiRoutes");
    const app = express();
    app.use(express.json());
    registerAiRoutes(app as any);
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const faq = async (body: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/semantic/faq`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "Kragarm", ...body }) });
    return { status: res.status, body: await res.json() };
  };

  it("Suche ohne Knopf: kein KI-Aufruf; mit Knopf: KI-Antwort, Such-Embedding unveraendert lokal", async () => {
    expect((await faq({})).body).toMatchObject({ aiAvailable: true, aiGenerated: false });
    expect(llm.calls).toBe(0);
    expect((await faq({ aiAnswer: true })).body).toMatchObject({ aiGenerated: true });
    expect(llm.calls).toBe(1);
    expect(embedCalls.every((c) => c.preferOpenAI === false)).toBe(true);
  });

  it("hoechstens 5 KI-Antworten je Minute; normale Suche bleibt frei", async () => {
    for (let i = 0; i < 5; i++) expect((await faq({ aiAnswer: true })).status).toBe(200);
    expect(await faq({ aiAnswer: true })).toMatchObject({ status: 429, body: { code: "rate_limited" } });
    expect((await faq({})).status).toBe(200);
  });
});

describe("Suchseite", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../client/src/pages/SemanticSearchPage.tsx"), "utf8");
  it("automatische FAQ-Abfrage ohne aiAnswer, Knopf mit aiAnswer: true", () => {
    const auto = src.slice(src.indexOf('queryKey: ["/api/semantic/faq"'), src.indexOf("enabled: Boolean(searchQuery),", src.indexOf('queryKey: ["/api/semantic/faq"')));
    expect(auto).not.toContain("aiAnswer");
    expect(src).toContain("aiAnswer: true,");
    expect(src).toContain('data-testid="button-faq-ai-answer"');
    expect(src).toContain("{faqData?.aiAvailable && !aiFaq?.aiGenerated && (");
  });
});
