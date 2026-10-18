/**
 * Pimcore-Verbindung in den Einstellungen ueber die REST-Exporte des Blackbit Data Director:
 * Adresse, API-Key (verschluesselt, nie in Antworten, nur im Header), Dataports (Artikel vollstaendig,
 * Artikel-Aenderungen, Preise) und Nummernfeld je Mandant; Verbindungstest mit Anzahl, Feldern, Beispiel.
 * Geprueft: Eingabepruefung, Client gegen einen nachgebauten Data Director (Header statt Adresse,
 * Fehlercodes inkl. fehlender REST-Route und HTML statt JSON), Formen der JSON-Antwort, Test ruft den
 * Aenderungs-Dataport nie ab, echte Routen mit gemockter Anmeldung und gemocktem Speicher,
 * Systemprotokoll-Bereich, Einbindung in der Einstellungsseite.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = { id: "admin" };
    req.tenantId = "tenant-a";
    next();
  };
  return { ...actual, requireAuth: pass, requireManageSettings: pass, requireCsrf: pass };
});

import { storage } from "../../server/storage";
import { registerSettingsRoutes } from "../../server/routes/settingsRoutes";
import { decrypt } from "../../server/lib/encryption";
import { areaForComponent, areaForPath } from "../../server/lib/logAreas";
import {
  PimcoreApiError,
  PimcoreClient,
  dataportExportUrl,
  exportFields,
  exportRecords,
  normalizePimcoreTarget,
  testPimcoreConnection,
  type StoredPimcoreConnection,
} from "../../server/integration/pimcoreConnection";

const ROOT = path.resolve(__dirname, "../..");
const PIM = "https://pim.example.com";
const KEY = "pimcore-key-0123456789";
const OTHER_KEY = "pimcore-key-zweiter";

const ARTICLES = [
  { GTIN: "4026212138719", name: "Sicherungsstift", hoehe: 12, montagezeit: 0 },
  { GTIN: "4026212348231", name: "Einzelholm", hoehe: 50, montagezeit: 2, serie: "CLIP" },
];
const PRICES = [{ GTIN: "4026212138719", basePrice: 0.43, onlinepiceDE: 0.6 }];

type FakeOptions = { key?: string; noRoute?: boolean; html?: boolean; status?: number; articlesBody?: unknown };

/** Nachgebauter Data Director: GET /api/rest/export/<dataport>, Key im Header oder als apikey */
function fakeDataDirector(options: FakeOptions = {}) {
  const calls: Array<{ url: URL; key: string | null }> = [];
  const handler = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const key = new Headers(init?.headers).get("X-API-Key") ?? url.searchParams.get("apikey");
    calls.push({ url, key });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    const html = (title: string, status: number) =>
      new Response(`<!-- ${title} --><html><head><title>${title}</title></head></html>`, { status, headers: { "content-type": "text/html" } });
    if (options.noRoute) return html(`No route found for "GET ${input}" (404 Not Found)`, 404);
    if (key !== (options.key ?? KEY)) return html("Access Denied. (403 Forbidden)", 403);
    if (options.status) return json({ message: "Dataport kaputt" }, options.status);
    const dataport = decodeURIComponent(url.pathname.replace(/^\/api\/rest\/export\//, ""));
    if (options.html) return html("Export", 200);
    if (dataport === "metaorder-artikel") return json(options.articlesBody ?? ARTICLES);
    if (dataport === "metaorder-preise") return json({ data: PRICES });
    if (dataport === "metaorder-artikel-aenderungen") return json([ARTICLES[1]]);
    return html("Dataport not found", 404);
  };
  return { calls, handler };
}

const connection = (overrides: Partial<StoredPimcoreConnection> = {}): StoredPimcoreConnection => ({
  baseUrl: PIM,
  apiKey: KEY,
  articlesFullDataport: "metaorder-artikel",
  articlesChangesDataport: "metaorder-artikel-aenderungen",
  pricesDataport: "metaorder-preise",
  productNumberField: "GTIN",
  ...overrides,
});

describe("Pimcore-Eingaben", () => {
  it("Adresse: HTTPS Pflicht, ohne Zugangsdaten/Parameter; Export-Adresse wird zerlegt", () => {
    expect(normalizePimcoreTarget({ baseUrl: "" })).toEqual({ ok: false, code: "pimcore_url_missing" });
    expect(normalizePimcoreTarget({ baseUrl: "pim" })).toEqual({ ok: false, code: "pimcore_url_invalid" });
    expect(normalizePimcoreTarget({ baseUrl: "http://pim.example.com" })).toEqual({ ok: false, code: "pimcore_url_https" });
    // apikey in der Adresse landet in Zugriffsprotokollen
    expect(normalizePimcoreTarget({ baseUrl: `${PIM}/api/rest/export/x?apikey=geheim` })).toEqual({ ok: false, code: "pimcore_url_invalid" });
    expect(normalizePimcoreTarget({ baseUrl: " https://pim.example.com/ " })).toEqual({
      ok: true,
      target: {
        baseUrl: PIM,
        articlesFullDataport: "metaorder-artikel",
        articlesChangesDataport: "metaorder-artikel-aenderungen",
        pricesDataport: "metaorder-preise",
        productNumberField: "GTIN",
      },
    });
    expect(normalizePimcoreTarget({ baseUrl: `${PIM}/api/rest/export/Artikel%20Export/` })).toMatchObject({
      ok: true,
      target: { baseUrl: PIM, articlesFullDataport: "Artikel Export" },
    });
    expect(normalizePimcoreTarget({ baseUrl: "http://localhost:8080" })).toMatchObject({ ok: true, target: { baseUrl: "http://localhost:8080" } });
  });

  it("leere Aenderungs-/Preis-Dataports bleiben leer (nicht genutzt); Namen werden geprueft", () => {
    expect(normalizePimcoreTarget({ baseUrl: PIM, articlesChangesDataport: "", pricesDataport: " " })).toMatchObject({
      ok: true,
      target: { articlesChangesDataport: "", pricesDataport: "" },
    });
    expect(normalizePimcoreTarget({ baseUrl: PIM, articlesFullDataport: "" })).toMatchObject({ ok: true, target: { articlesFullDataport: "metaorder-artikel" } });
    expect(normalizePimcoreTarget({ baseUrl: PIM, pricesDataport: "../admin" })).toEqual({ ok: false, code: "pimcore_dataport_invalid" });
    expect(normalizePimcoreTarget({ baseUrl: PIM, articlesFullDataport: "42" })).toMatchObject({ ok: true });
    expect(normalizePimcoreTarget({ baseUrl: PIM, productNumberField: "GTIN{x}" })).toEqual({ ok: false, code: "pimcore_field_invalid" });
    expect(normalizePimcoreTarget({ baseUrl: PIM, productNumberField: "Artikel-Nr." })).toMatchObject({ ok: true });
  });

  it("Export-Adresse mit kodiertem Dataport-Namen", () => {
    expect(dataportExportUrl(PIM, "Artikel Export", { locale: "de" })).toBe(`${PIM}/api/rest/export/Artikel%20Export?locale=de`);
  });
});

describe("JSON-Antworten des Data Director", () => {
  it("Liste, Objekt mit einer Liste, Objekt von Objekten, Einzelobjekt", () => {
    expect(exportRecords(ARTICLES)).toHaveLength(2);
    expect(exportRecords({ data: PRICES, total: 1 })).toEqual(PRICES);
    expect(exportRecords({ "11": { GTIN: "1" }, "12": { GTIN: "2" } })).toEqual([{ GTIN: "1" }, { GTIN: "2" }]);
    expect(exportRecords({ GTIN: "1", name: "x" })).toEqual([{ GTIN: "1", name: "x" }]);
    expect(exportRecords([1, "x", null, { GTIN: "1" }])).toEqual([{ GTIN: "1" }]);
    expect(exportRecords(null)).toEqual([]);
    expect(exportFields(ARTICLES)).toEqual(["GTIN", "name", "hoehe", "montagezeit", "serie"]);
  });
});

describe("Pimcore-Client", () => {
  it("Key nur im Header X-API-Key, nie in der Adresse", async () => {
    const fake = fakeDataDirector();
    await new PimcoreClient(connection(), fake.handler).exportDataport("metaorder-artikel");
    expect(fake.calls[0].url.toString()).toBe(`${PIM}/api/rest/export/metaorder-artikel`);
    expect(fake.calls[0].url.toString()).not.toContain(KEY);
    expect(fake.calls[0].key).toBe(KEY);
  });

  it("Fehler als Code: Key abgelehnt, keine REST-Route, unbekannter Dataport, kein JSON, Serverfehler, nicht erreichbar", async () => {
    const run = async (conn: StoredPimcoreConnection, fake = fakeDataDirector(), dataport = "metaorder-artikel") => {
      try {
        await new PimcoreClient(conn, fake.handler).exportDataport(dataport);
        return null;
      } catch (error) {
        expect(error).toBeInstanceOf(PimcoreApiError);
        const e = error as PimcoreApiError;
        return { code: e.code, status: e.status, detail: e.detail };
      }
    };
    expect(await run(connection({ apiKey: OTHER_KEY }))).toEqual({ code: "pimcore_unauthorized", status: 403, detail: "Access Denied. (403 Forbidden)" });
    expect(await run(connection(), fakeDataDirector({ noRoute: true }))).toMatchObject({ code: "pimcore_no_rest", status: 404 });
    expect(await run(connection(), fakeDataDirector(), "gibts-nicht")).toEqual({ code: "pimcore_dataport_unknown", status: 404, detail: "gibts-nicht" });
    expect(await run(connection(), fakeDataDirector({ html: true }))).toMatchObject({ code: "pimcore_not_json", status: 200 });
    expect(await run(connection(), fakeDataDirector({ status: 500 }))).toEqual({ code: "pimcore_failed", status: 500, detail: "Dataport kaputt" });
    const offline = { handler: async () => { throw new TypeError("fetch failed"); } } as any;
    expect(await run(connection(), offline)).toMatchObject({ code: "pimcore_unreachable", status: null });
  });
});

describe("Pimcore-Verbindungstest", () => {
  it("Artikel und Preise mit Anzahl, Feldern, Beispiel; Aenderungs-Dataport wird NICHT abgerufen", async () => {
    const fake = fakeDataDirector();
    const result = await testPimcoreConnection(new PimcoreClient(connection(), fake.handler), connection());
    expect(result).toEqual({
      baseUrl: PIM,
      articles: {
        dataport: "metaorder-artikel",
        count: 2,
        fields: ["GTIN", "name", "hoehe", "montagezeit", "serie"],
        numberFieldFound: true,
        sample: "4026212138719",
      },
      prices: { dataport: "metaorder-preise", count: 1, fields: ["GTIN", "basePrice", "onlinepiceDE"], sample: JSON.stringify(PRICES[0]) },
      changesDataport: "metaorder-artikel-aenderungen",
    });
    expect(fake.calls.map((c) => c.url.pathname)).toEqual(["/api/rest/export/metaorder-artikel", "/api/rest/export/metaorder-preise"]);
  });

  it("Nummernfeld fehlt: Hinweis statt Fehler; ohne Preis-Dataport nur Artikel", async () => {
    const conn = connection({ productNumberField: "Artikelnummer", pricesDataport: "", articlesChangesDataport: "" });
    const result = await testPimcoreConnection(new PimcoreClient(conn, fakeDataDirector().handler), conn);
    expect(result.articles.numberFieldFound).toBe(false);
    expect(result.articles.sample).toBe(JSON.stringify(ARTICLES[0]));
    expect(result.prices).toBeNull();
    expect(result.changesDataport).toBeNull();
  });

  it("Fehler nennt den betroffenen Dataport", async () => {
    await expect(
      testPimcoreConnection(new PimcoreClient(connection({ apiKey: OTHER_KEY }), fakeDataDirector().handler), connection({ apiKey: OTHER_KEY })),
    ).rejects.toMatchObject({ code: "pimcore_unauthorized", detail: "metaorder-artikel: Access Denied. (403 Forbidden)" });
    await expect(
      testPimcoreConnection(new PimcoreClient(connection(), fakeDataDirector().handler), connection({ pricesDataport: "preise-alt" })),
    ).rejects.toMatchObject({ code: "pimcore_dataport_unknown", detail: "preise-alt" });
  });
});

describe("Einstellungen: Pimcore-Verbindung (Routen)", () => {
  const settings = new Map<string, any>();
  let pim = fakeDataDirector();
  let server: Server;
  let base = "";
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    vi.stubEnv("ENCRYPTION_KEY", "unit-tests-only-encryption-key");
    vi.spyOn(storage, "getSetting").mockImplementation(async (key: string) => settings.get(key));
    vi.spyOn(storage, "saveSetting").mockImplementation(async (key: string, value: any) => {
      settings.set(key, value);
    });
    vi.stubGlobal("fetch", (input: any, init?: RequestInit) =>
      String(input).startsWith(PIM) ? pim.handler(String(input), init) : realFetch(input, init),
    );
    const app = express();
    app.use(express.json());
    registerSettingsRoutes(app as any);
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await new Promise<void>((r) => server.close(() => r()));
  });
  beforeEach(() => {
    settings.clear();
    pim = fakeDataDirector();
  });

  const call = async (method: string, url: string, body?: unknown) => {
    const res = await realFetch(`${base}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    // weder Klartext noch verschluesselter Key verlassen den Server
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(OTHER_KEY);
    const stored = settings.get("pimcore_connection")?.apiKey;
    if (stored) expect(text).not.toContain(stored);
    return { status: res.status, body: JSON.parse(text) };
  };

  const empty = {
    configured: false,
    baseUrl: "",
    articlesFullDataport: "metaorder-artikel",
    articlesChangesDataport: "metaorder-artikel-aenderungen",
    pricesDataport: "metaorder-preise",
    productNumberField: "GTIN",
    hasApiKey: false,
  };

  it("speichern: Key verschluesselt; GET zeigt nur, dass einer gespeichert ist", async () => {
    expect(await call("GET", "/api/settings/pimcore-connection")).toEqual({ status: 200, body: empty });
    expect(await call("POST", "/api/settings/pimcore-connection", { baseUrl: "http://pim.example.com", apiKey: KEY })).toMatchObject({
      status: 400,
      body: { error: "Ungültige Pimcore-Angaben", code: "pimcore_url_https" },
    });
    expect(await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM })).toMatchObject({
      status: 400,
      body: { error: "Pimcore-API-Key fehlt", code: "pimcore_key_missing" },
    });
    expect(settings.has("pimcore_connection")).toBe(false);

    const saved = await call("POST", "/api/settings/pimcore-connection", { baseUrl: `${PIM}/`, pricesDataport: "", apiKey: ` ${KEY} ` });
    expect(saved).toEqual({ status: 200, body: { ...empty, configured: true, baseUrl: PIM, pricesDataport: "", hasApiKey: true } });
    const stored = settings.get("pimcore_connection");
    expect(stored).toMatchObject({ baseUrl: PIM, articlesFullDataport: "metaorder-artikel", pricesDataport: "" });
    expect(stored.apiKey).not.toBe(KEY);
    expect(decrypt(stored.apiKey)).toBe(KEY);
    expect(await call("GET", "/api/settings/pimcore-connection")).toMatchObject({ body: { configured: true, pricesDataport: "", hasApiKey: true } });
  });

  it("leerer Key behaelt den gespeicherten; neuer Key ersetzt ihn", async () => {
    await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM, apiKey: KEY });
    await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM, articlesFullDataport: "artikel-voll", apiKey: "" });
    expect(settings.get("pimcore_connection").articlesFullDataport).toBe("artikel-voll");
    expect(decrypt(settings.get("pimcore_connection").apiKey)).toBe(KEY);
    await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM, apiKey: OTHER_KEY });
    expect(decrypt(settings.get("pimcore_connection").apiKey)).toBe(OTHER_KEY);
  });

  it("testen: mit eingegebenem oder gespeichertem Key, ohne zu speichern; Fehler als Code mit Pimcore-Meldung", async () => {
    expect(await call("POST", "/api/settings/pimcore-connection/test", { baseUrl: PIM })).toMatchObject({ status: 400, body: { code: "pimcore_key_missing" } });
    const ok = await call("POST", "/api/settings/pimcore-connection/test", { baseUrl: PIM, apiKey: KEY });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ success: true, articles: { count: 2, sample: "4026212138719" }, prices: { count: 1 } });
    expect(settings.has("pimcore_connection")).toBe(false);
    expect(pim.calls.some((c) => c.url.pathname.endsWith("aenderungen"))).toBe(false);

    await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM, apiKey: KEY });
    expect(await call("POST", "/api/settings/pimcore-connection/test", {})).toMatchObject({ status: 200 });
    expect(pim.calls.at(-1)?.key).toBe(KEY);

    expect(await call("POST", "/api/settings/pimcore-connection/test", { apiKey: OTHER_KEY })).toEqual({
      status: 502,
      body: {
        error: "Pimcore-Anfrage fehlgeschlagen",
        code: "pimcore_unauthorized",
        pimcoreStatus: 403,
        detail: "metaorder-artikel: Access Denied. (403 Forbidden)",
      },
    });
    pim = fakeDataDirector({ noRoute: true });
    expect(await call("POST", "/api/settings/pimcore-connection/test", {})).toMatchObject({ status: 502, body: { code: "pimcore_no_rest", pimcoreStatus: 404 } });
  });

  it("entfernen", async () => {
    await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM, apiKey: KEY });
    expect(await call("DELETE", "/api/settings/pimcore-connection")).toEqual({ status: 200, body: empty });
    expect(await call("GET", "/api/settings/pimcore-connection")).toMatchObject({ body: { configured: false } });
  });
});

describe("Systemprotokoll und Einstellungsseite", () => {
  it("eigener Bereich Pimcore fuer Modul und API-Pfad", () => {
    expect(areaForComponent("integration/pimcoreConnection")).toBe("pimcore");
    expect(areaForComponent("integration/n8nConnection")).toBe("integration");
    expect(areaForPath("/api/settings/pimcore-connection/test")).toBe("pimcore");
  });

  it("Abschnitt im Reiter Integration; Key als Passwortfeld, nie vorbelegt; keine Datahub-Reste", () => {
    const page = readFileSync(path.join(ROOT, "client/src/pages/SettingsPage.tsx"), "utf8");
    expect(page).toMatch(/<TabsContent value="integration"[^>]*>[\s\S]*?<PimcoreConnectionSection \/>/);
    const section = readFileSync(path.join(ROOT, "client/src/components/PimcoreConnectionSection.tsx"), "utf8");
    expect(section).toMatch(/type="password"/);
    expect(section).toMatch(/autoComplete="new-password"/);
    expect(section).toMatch(/apiRequest\("POST", "\/api\/settings\/pimcore-connection", \{ \.\.\.form, apiKey \}\)/);
    expect(section).toMatch(/apiRequest\("POST", "\/api\/settings\/pimcore-connection\/test", \{ \.\.\.form, apiKey \}\)/);
    expect(section).toMatch(/apiRequest\("DELETE", "\/api\/settings\/pimcore-connection"\)/);
    expect(section).not.toMatch(/setApiKey\((connection|saved|data|result)/);
    const module = readFileSync(path.join(ROOT, "server/integration/pimcoreConnection.ts"), "utf8");
    expect(module).not.toMatch(/graphql|introspection/i);
  });
});
