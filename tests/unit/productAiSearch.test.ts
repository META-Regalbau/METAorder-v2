/**
 * KI-Produktsuche angebunden: die Route /api/products/semantic-search rief keine Seite auf. Jetzt
 * "Mit KI auslegen" auf der Produktseite - die KI zerlegt die Eingabe in Produkttyp und Abmessungen,
 * daraus werden Suchwort und Breite/Hoehe/Tiefe (die Treffer liefert die normale Produktsuche).
 * Ein KI-Aufruf je Klick, hoechstens 10 je Nutzer und Minute (vorher ohne Limit).
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { filtersFromInterpretation } from "../../client/src/lib/productAiSearch";

const llm = vi.hoisted(() => ({ calls: 0, reply: "{}" }));
vi.mock("../../server/ai/llmChat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/ai/llmChat")>()),
  chatCompletion: async () => {
    llm.calls += 1;
    return llm.reply;
  },
}));
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = { id: "u1" };
    req.tenantId = "tenant-a";
    next();
  };
  return { ...actual, requireAuth: pass };
});

import { storage } from "../../server/storage";
import { resetMinuteBucketsForTests } from "../../server/analytics/nlQueryLimit";
import { PRODUCT_AI_PER_MINUTE } from "../../server/routes/productRoutes";

describe("Auslegung -> Filter der Produktseite", () => {
  it("Produkttyp und Serie als Suchwort, Abmessungen in mm", () => {
    expect(
      filtersFromInterpretation(
        {
          productType: "Regal",
          keywords: ["Regal", "2000mm", "hoch"],
          properties: { series: "CLIP" },
          dimensions: { height: { value: 2000 }, width: { value: 3000.4 } },
          interpretation: "Suche nach Regalen mit 2000 mm Höhe",
        },
        "Regal 2 m hoch, 3 m breit",
      ),
    ).toEqual({ search: "Regal CLIP", width: "3000", height: "2000", depth: "", summary: "Suche nach Regalen mit 2000 mm Höhe" });
  });

  it("ohne Produkttyp: erstes Schluesselwort ohne Zahlen; ohne alles: die Eingabe", () => {
    expect(filtersFromInterpretation({ keywords: ["2000mm", "Holmebene", "hoch"] }, "x").search).toBe("Holmebene");
    expect(filtersFromInterpretation({}, "  Kragarm ").search).toBe("Kragarm");
    expect(filtersFromInterpretation({ dimensions: { depth: { value: -5 } } }, "x").depth).toBe("");
  });
});

describe("Route POST /api/products/semantic-search", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    vi.spyOn(storage, "getSetting").mockResolvedValue(undefined);
    const { registerProductRoutes } = await import("../../server/routes/productRoutes");
    const app = express();
    app.use(express.json());
    registerProductRoutes(app as any);
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    llm.calls = 0;
    llm.reply = JSON.stringify({ productType: "Regal", dimensions: { height: { value: 2000 } }, interpretation: "Regale 2000 mm" });
    resetMinuteBucketsForTests();
  });
  const post = (body: Record<string, unknown>) =>
    fetch(`${base}/api/products/semantic-search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("interpretOnly: nur die Auslegung (ein KI-Aufruf), keine Produkte geladen", async () => {
    const res = await post({ query: "Regal 2 m hoch", language: "de", interpretOnly: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ interpretation: { productType: "Regal", dimensions: { height: { value: 2000 } }, interpretation: "Regale 2000 mm" } });
    expect(llm.calls).toBe(1);
  });

  it(`hoechstens ${PRODUCT_AI_PER_MINUTE} je Nutzer und Minute, dann 429 mit Code`, async () => {
    for (let i = 0; i < PRODUCT_AI_PER_MINUTE; i++) expect((await post({ query: "Regal", interpretOnly: true })).status).toBe(200);
    const limited = await post({ query: "Regal", interpretOnly: true });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "rate_limited" });
    expect(llm.calls).toBe(PRODUCT_AI_PER_MINUTE);
  });

  it("ohne Anfrage 400, ohne KI-Aufruf", async () => {
    expect((await post({ interpretOnly: true })).status).toBe(400);
    expect(llm.calls).toBe(0);
  });
});

describe("Produktseite", () => {
  it("Knopf 'Mit KI auslegen' fragt nur die Auslegung an und setzt die Filter", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../client/src/pages/ProductsPage.tsx"), "utf8");
    expect(src).toContain('data-testid="button-ai-interpret-search"');
    expect(src).toContain("interpretOnly: true,");
    expect(src).toMatch(/setSearchInput\(filters\.search\);\s*setWidthInput\(filters\.width\);\s*setHeightInput\(filters\.height\);\s*setDepthInput\(filters\.depth\);/);
  });
});
