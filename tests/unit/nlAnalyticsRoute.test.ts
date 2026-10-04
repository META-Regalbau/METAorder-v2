/**
 * Reiter "Natürliche Sprache" der Statistik: POST /api/analytics/nl-query mit der Sprache der
 * Oberflaeche. Geprueft: KI-Texte und feste Beschriftungen in der Sprache, Fehlercodes statt
 * gemischter Meldungen, verspaetete Bestellungen nach der Regel der Seite, Kanalfilter, kein
 * Live-Abruf. Echte Route; Anmeldung, Kanaele, Spiegel und der Chat-Anbieter sind gemockt.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Order } from "../../shared/schema";

type Message = { role: string; content: string };
const state = vi.hoisted(() => ({
  channels: null as string[] | null,
  live: 0,
  orders: [] as any[],
  llmConfigured: true,
  query: { type: "general_statistics", parameters: {} } as Record<string, unknown>,
  insightsFail: false,
  calls: [] as Array<{ system: string; user: string }>,
}));

vi.mock("../../server/ai/llmChat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/ai/llmChat")>();
  return {
    ...actual,
    isChatLlmConfigured: async () => state.llmConfigured,
    chatCompletion: async (_getSetting: unknown, params: { messages: Message[] }) => {
      const system = params.messages.find((m) => m.role === "system")?.content ?? "";
      const user = params.messages.find((m) => m.role === "user")?.content ?? "";
      state.calls.push({ system, user });
      if (system.startsWith("Du bist ein intelligenter Analytics-Assistent")) return JSON.stringify(state.query);
      if (system.includes("Business Intelligence")) {
        if (state.insightsFail) throw new Error("TIMEOUT");
        return JSON.stringify({ insights: [{ text: "AI insight", type: "trend", confidence: 90 }] });
      }
      return JSON.stringify({ suggestions: [{ category: "revenue", priority: "high", title: "T", description: "D", actionItems: ["a"] }] });
    },
  };
});
vi.mock("../../server/routes/routeHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/routes/routeHelpers")>();
  return { ...actual, getSalesChannelFilter: async () => state.channels };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = { id: "u1", roleDetails: { name: "Admin", permissions: { viewNaturalLanguageAnalytics: true } } };
    req.tenantId = "tenant-a";
    next();
  };
  return { ...actual, requireAuth: pass, requireViewNaturalLanguageAnalytics: pass };
});

import { storage } from "../../server/storage";
import { ShopwareClient } from "../../server/shopware/shopware";
import { registerAnalyticsRoutes } from "../../server/routes/analyticsRoutes";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10) + "T00:00:00.000+00:00";
let seq = 0;
function order(overrides: Partial<Order> = {}): Order {
  seq += 1;
  const id = `o${String(seq).padStart(4, "0")}`;
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: `${id}@example.com`, orderDate: daysAgo(1),
    totalAmount: 100, netTotalAmount: 84, status: "open", paymentStatus: "paid", salesChannelId: "sc1",
    items: [{ name: "Regal", quantity: 1, price: 100, total: 100 }], ...overrides,
  } as Order;
}

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "x", apiSecret: "y" } as any);
  vi.spyOn(storage, "countShopwareOrderMirrors").mockImplementation(async () => state.orders.length);
  vi.spyOn(storage, "getShopwareOrderMirrors").mockImplementation(async () => ({ rows: state.orders.map((o) => ({ shopwareId: o.id, payload: structuredClone(o) })) as any, total: state.orders.length }));
  vi.spyOn(ShopwareClient.prototype as any, "fetchOrders").mockImplementation(async () => { state.live += 1; throw new Error("Live-Abruf nicht erwartet"); });
  const app = express();
  app.use(express.json());
  registerAnalyticsRoutes(app as any);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  state.channels = null;
  state.live = 0;
  state.llmConfigured = true;
  state.insightsFail = false;
  state.calls = [];
  state.query = { type: "general_statistics", parameters: {} };
  seq = 0;
  state.orders = [
    order(),
    order({ items: [{ name: "Boden", quantity: 3, price: 10, total: 30 }, { name: "Regal", quantity: 2, price: 50, total: 100 }] as any }),
    // verspaetet nach der Seiten-Regel: bezahlt, Lieferdatum (sonst Bestelldatum) > 3 Tage vorbei
    order({ status: "in_progress", orderDate: daysAgo(30), deliveryDateLatest: daysAgo(20) }),
    order({ status: "in_progress", orderDate: daysAgo(10) }),
    // nach der alten Regel verspaetet, nach der Seite nicht: nicht bezahlt
    order({ status: "in_progress", paymentStatus: "authorized", orderDate: daysAgo(40), deliveryDateLatest: daysAgo(30) }),
    order({ salesChannelId: "sc2", totalAmount: 1000 }),
  ];
});

async function ask(body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/analytics/nl-query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("Natürliche Sprache: Sprache der Antwort", () => {
  it("Englisch: Insight-Prompt mit Zielsprache, feste Beschriftungen englisch", async () => {
    const { status, body } = await ask({ question: "How are we doing?", language: "en" });
    expect(status).toBe(200);
    expect(body.result.labels).toEqual(["Number of orders", "Total revenue", "Average order value"]);
    const insightCall = state.calls.find((c) => c.system.includes("Business Intelligence"))!;
    expect(insightCall.system).toContain("Zielsprache der Insight-Texte: Englisch");
    expect(insightCall.system).not.toContain("Alle Insights müssen auf Deutsch sein");
    expect(insightCall.user).toContain("auf Englisch");
    expect(body.insights).toEqual([{ text: "AI insight", type: "trend", confidence: 90 }]);
    expect(state.live).toBe(0);
  });

  it("ohne oder mit unbekannter Sprache Deutsch", async () => {
    for (const language of [undefined, "fr"]) {
      state.calls = [];
      const { body } = await ask({ question: "Wie läuft es?", language });
      expect(body.result.labels).toEqual(["Anzahl Bestellungen", "Gesamtumsatz", "Durchschn. Bestellwert"]);
      expect(state.calls.find((c) => c.system.includes("Business Intelligence"))!.system).toContain("Zielsprache der Insight-Texte: Deutsch");
    }
  });

  it("Spanisch: Positionen je Bestellung und Stueckzahlen spanisch beschriftet", async () => {
    state.query = { type: "item_count_analysis", parameters: {} };
    const { body } = await ask({ question: "¿Cuántos artículos?", language: "es-ES" });
    expect(body.result.labels).toEqual(["1 artículo", "2-3 artículos", "4-5 artículos", "6-10 artículos", "11-20 artículos", "20+ artículos"]);
    expect(body.result.metadata.quantityDistribution.map((b: any) => b.label)[0]).toBe("1-2 uds.");
  });

  it("Prognose: Verbesserungsvorschlaege mit Sprachvorgabe", async () => {
    state.query = { type: "revenue_forecast", parameters: { forecastPeriods: 2, groupBy: "day", forecastUnit: "day" } };
    const { body } = await ask({ question: "Prevé la facturación", language: "es" });
    const call = state.calls.find((c) => c.system.includes("Business Analyst"))!;
    expect(call.system).toContain("auf Spanisch");
    expect(call.user).toContain("auf Spanisch");
    expect(body.result.improvements).toHaveLength(1);
  });

  it("KI-Hinweise nicht erreichbar: regelbasierte Hinweise in der Sprache", async () => {
    state.insightsFail = true;
    state.query = { type: "delayed_orders", parameters: {} };
    const { body } = await ask({ question: "¿Qué pedidos están retrasados?", language: "es" });
    expect(body.insights.map((i: any) => i.text)).toContain("Hay 2 pedidos retrasados que requieren atención");
  });
});

describe("Natürliche Sprache: Daten", () => {
  it("verspaetete Bestellungen nach der Regel der Seite (bezahlt, Lieferdatum sonst Bestelldatum > 3 Tage)", async () => {
    state.query = { type: "delayed_orders", parameters: {} };
    const { body } = await ask({ question: "Welche Bestellungen sind verspätet?" });
    expect(body.result.labels).toEqual(["SW-o0003", "SW-o0004"]);
    expect(body.result.data.map((d: any) => d.daysDelayed)).toEqual([20, 10]);
  });

  it("nur die Kanaele des Nutzers", async () => {
    state.channels = ["sc1"];
    const { body } = await ask({ question: "Wie läuft es?" });
    expect(body.result.data[0]).toBe(5);
    state.channels = null;
    expect((await ask({ question: "Wie läuft es?" })).body.result.data[0]).toBe(6);
  });
});

describe("Natürliche Sprache: Fehlercodes", () => {
  it("leere Frage", async () => {
    expect(await ask({ question: "  " })).toMatchObject({ status: 400, body: { code: "invalid_question" } });
  });

  it("kein Chat-Anbieter eingerichtet: kein KI-Aufruf", async () => {
    state.llmConfigured = false;
    expect(await ask({ question: "Wie läuft es?" })).toMatchObject({ status: 503, body: { code: "llm_unavailable" } });
    expect(state.calls).toHaveLength(0);
  });

  it("unbekannter Abfragetyp der KI", async () => {
    state.query = { type: "drop_tables", parameters: {} };
    expect(await ask({ question: "Wie läuft es?" })).toMatchObject({ status: 400, body: { code: "not_understood" } });
  });
});
