/**
 * Suchindex fuer FAQ und semantische Suche (server/semantic/semanticIndexer.ts). Vorher war er in
 * allen Mandanten leer (nie ausgeloest), las Entwuerfe/Tickets ohne Mandantenfilter (Daten anderer
 * Mandanten im eigenen Index) und loeschte/berechnete bei jedem Lauf alles neu.
 * - Abgleich einer Quelle: unveraendert uebersprungen, geaendert neu, entfernt geloescht, Mandant
 *   in jeder Operation (simulierter Index)
 * - Quellen lesen nur den eigenen Mandanten (statische Pruefung; Lauf gegen die echte DB im PR)
 * - Ausloesen: Start im Hintergrund, kein zweiter Lauf gleichzeitig, Status
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const ctl = vi.hoisted(() => ({ running: false, release: null as null | (() => void), starts: 0 }));

vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = { id: "u1" };
    req.tenantId = "tenant-a";
    next();
  };
  return { ...actual, requireAuth: pass, requireManageSettings: pass };
});

import { documentFingerprint, syncSourceDocuments, type IndexDoc, type IndexStore } from "../../server/semantic/semanticIndexer";
import * as indexer from "../../server/semantic/semanticIndexer";
import { storage } from "../../server/storage";

/** Index im Speicher, je Mandant getrennt; protokolliert die Mandanten-IDs jeder Operation */
function memoryIndex() {
  const rows = new Map<string, { sourceId: string; contentHash: string; embeddingProvider: string; tenantId: string | null; title: string }>();
  const key = (t: string | null, type: string, id: string) => `${t}|${type}|${id}`;
  const tenantsSeen: Array<string | null> = [];
  let upserts = 0;
  const store: IndexStore = {
    listExisting: async (t, type) => {
      tenantsSeen.push(t);
      return [...rows].filter(([k]) => k.startsWith(`${t}|${type}|`)).map(([, r]) => r);
    },
    upsert: async (batch, t) => {
      tenantsSeen.push(t);
      for (const r of batch) {
        upserts += 1;
        expect(r.tenantId).toBe(t);
        rows.set(key(t, r.sourceType, r.sourceId), { sourceId: r.sourceId, contentHash: r.contentHash, embeddingProvider: r.embeddingProvider ?? "local", tenantId: t, title: r.title });
      }
    },
    deleteIds: async (t, type, ids) => {
      tenantsSeen.push(t);
      for (const id of ids) rows.delete(key(t, type, id));
    },
  };
  return { store, rows, tenantsSeen, upserts: () => upserts };
}

const fakeStorage = { getSetting: async () => undefined } as any;
const doc = (id: string, content = `Inhalt ${id}`, metadata: Record<string, unknown> = {}): IndexDoc => ({ sourceType: "ticket", sourceId: id, title: `T ${id}`, content, metadata });
const sync = (store: IndexStore, tenantId: string | null, docs: IndexDoc[], preferOpenAI = false) =>
  syncSourceDocuments(fakeStorage, tenantId, "ticket", docs, preferOpenAI, store);

describe("Abgleich einer Quelle", () => {
  it("erster Lauf: alles neu, mit Mandant und Fingerabdruck", async () => {
    const idx = memoryIndex();
    expect(await sync(idx.store, "t1", [doc("a"), doc("b"), doc("c")])).toEqual({ total: 3, updated: 3, unchanged: 0, removed: 0 });
    expect([...idx.rows.values()].every((r) => r.tenantId === "t1" && r.contentHash === documentFingerprint(doc(r.sourceId)))).toBe(true);
    expect(new Set(idx.tenantsSeen)).toEqual(new Set(["t1"]));
  });

  it("zweiter Lauf ohne Aenderung: nichts neu berechnet", async () => {
    const idx = memoryIndex();
    await sync(idx.store, "t1", [doc("a"), doc("b")]);
    const before = idx.upserts();
    expect(await sync(idx.store, "t1", [doc("a"), doc("b")])).toEqual({ total: 2, updated: 0, unchanged: 2, removed: 0 });
    expect(idx.upserts()).toBe(before);
  });

  it("geaenderter Inhalt, Titel oder Metadaten (z. B. Ticket-Status) -> neu; entfernt -> geloescht", async () => {
    const idx = memoryIndex();
    await sync(idx.store, "t1", [doc("a"), doc("b", "x", { status: "open" }), doc("c")]);
    const result = await sync(idx.store, "t1", [doc("a", "neu"), doc("b", "x", { status: "closed" })]);
    expect(result).toEqual({ total: 2, updated: 2, unchanged: 0, removed: 1 });
    expect(idx.rows.has("t1|ticket|c")).toBe(false);
  });

  it("Dokument ohne Inhalt wird nicht indexiert (und aus dem Index genommen)", async () => {
    const idx = memoryIndex();
    await sync(idx.store, "t1", [doc("a")]);
    expect(await sync(idx.store, "t1", [doc("a", "")])).toEqual({ total: 0, updated: 0, unchanged: 0, removed: 1 });
  });

  it("Mandanten getrennt: Lauf fuer t2 sieht und loescht nichts von t1", async () => {
    const idx = memoryIndex();
    await sync(idx.store, "t1", [doc("a"), doc("b")]);
    expect(await sync(idx.store, "t2", [doc("z")])).toEqual({ total: 1, updated: 1, unchanged: 0, removed: 0 });
    expect([...idx.rows.keys()].sort()).toEqual(["t1|ticket|a", "t1|ticket|b", "t2|ticket|z"]);
  });

  it("OpenAI gewuenscht: vorhandene OpenAI-Embeddings bleiben, lokal berechnete werden neu angefragt", async () => {
    const idx = memoryIndex();
    await sync(idx.store, "t1", [doc("a"), doc("b")]);
    idx.rows.get("t1|ticket|a")!.embeddingProvider = "openai";
    const result = await sync(idx.store, "t1", [doc("a"), doc("b")], true);
    expect(result).toMatchObject({ unchanged: 1, updated: 1 });
  });
});

describe("Quellen lesen nur den eigenen Mandanten", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../server/semantic/semanticIndexer.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function runSemanticIndex("), src.indexOf("export function documentFingerprint("));

  it("jede Tabellenabfrage mit Mandantenfilter (Kommentare ueber die Ticket-IDs des Mandanten)", () => {
    for (const table of ["offerDrafts", "orderDrafts", "tickets", "ticketTemplates"]) {
      expect(body, table).toContain(`db.select().from(${table}).where(tenantFilter(${table}.tenantId, tenantId))`);
    }
    expect(body).toContain("where(inArray(ticketComments.ticketId, ids.slice(i, i + 500)))");
    expect(body).not.toMatch(/db\.select\(\)\.from\(\w+\);/);
  });

  it("Lauf im Kontext des Mandanten (Produkt-Cache, Einstellungen); keine Loeschung aller Quellen vorab", () => {
    expect(body).toContain("return runWithTenantContext(tenantId, async () => {");
    expect(src).not.toContain("deleteSemanticDocumentsBySourceTypes");
  });
});

describe("Ausloesen und Status", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    vi.spyOn(indexer, "isSemanticIndexRunning").mockImplementation(() => ctl.running);
    vi.spyOn(indexer, "runSemanticIndexForTenant").mockImplementation(async () => {
      ctl.starts += 1;
      ctl.running = true;
      await new Promise<void>((r) => (ctl.release = r));
      ctl.running = false;
      return null;
    });
    vi.spyOn(indexer, "getSemanticIndexCounts").mockResolvedValue({ product: 3, ticket: 1 });
    vi.spyOn(storage, "getSetting").mockResolvedValue({ finishedAt: "2026-10-05T10:00:00.000Z", durationMs: 1200, result: {} });
    const { registerAiRoutes } = await import("../../server/routes/aiRoutes");
    const app = express();
    app.use(express.json());
    registerAiRoutes(app as any);
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    ctl.running = false;
    ctl.starts = 0;
  });

  it("Start antwortet sofort (202), zweiter Start waehrend des Laufs 409", async () => {
    const first = await fetch(`${base}/api/semantic/index`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(first.status).toBe(202);
    const second = await fetch(`${base}/api/semantic/index`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "running" });
    expect(ctl.starts).toBe(1);
    ctl.release?.();
  });

  it("Status: Eintraege je Quelle, Summe, laeuft, letzter Lauf", async () => {
    const res = await fetch(`${base}/api/semantic/index/status`);
    expect(await res.json()).toEqual({
      running: false,
      counts: { product: 3, ticket: 1 },
      total: 4,
      lastRun: { finishedAt: "2026-10-05T10:00:00.000Z", durationMs: 1200, result: {} },
    });
  });
});

describe("Verdrahtung", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../..", p), "utf8");
  it("automatischer Lauf nach dem Start und regelmaessig (abschaltbar)", () => {
    const src = read("server/index.ts");
    expect(src).toContain('process.env.SEMANTIC_INDEX_ENABLED !== "false"');
    expect(src).toMatch(/setTimeout\(runSemanticIndexJob, [^)]+\);\s*setInterval\(runSemanticIndexJob, /);
  });
  it("Einstellungen zeigen den Index, die Suche weist auf einen leeren Index hin", () => {
    expect(read("client/src/pages/SettingsPage.tsx")).toContain("<SearchIndexCard />");
    expect(read("client/src/pages/SemanticSearchPage.tsx")).toContain('data-testid="hint-search-index-empty"');
  });
});
