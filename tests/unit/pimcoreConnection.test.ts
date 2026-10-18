/**
 * Pimcore-Verbindung in den Einstellungen (Datahub GraphQL): Adresse, Konfiguration, Artikelklasse,
 * Nummernfeld und API-Key je Mandant (Key verschluesselt, nie in Antworten), Verbindungstest mit
 * Introspection und Beispiel-Artikel.
 * Geprueft: Eingabepruefung, Client gegen einen nachgebauten Datahub (Header statt Adresse, Fehlercodes
 * inkl. fehlendem Datahub-Pfad), Test mit und ohne Introspection, echte Routen mit gemockter Anmeldung
 * und gemocktem Speicher, Systemprotokoll-Bereich, Einbindung in der Einstellungsseite.
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
  classesFromQueryFields,
  normalizePimcoreTarget,
  testPimcoreConnection,
  type StoredPimcoreConnection,
} from "../../server/integration/pimcoreConnection";

const ROOT = path.resolve(__dirname, "../..");
const PIM = "https://pim.example.com";
const ENDPOINT_URL = `${PIM}/pimcore-graphql-webservices/metaorder`;
const KEY = "pimcore-key-0123456789";
const OTHER_KEY = "pimcore-key-zweiter";

const scalar = (name: string) => ({ name, kind: "SCALAR", ofType: null });
const ARTIKEL_FIELDS = [
  { name: "id", type: { kind: "NON_NULL", name: null, ofType: scalar("ID") } },
  { name: "GTIN", type: scalar("String") },
  { name: "hoehe", type: scalar("Float") },
  { name: "bilder", type: { kind: "LIST", name: null, ofType: { name: "asset", kind: "OBJECT", ofType: null } } },
];

type FakeOptions = { key?: string; status?: number; html404?: boolean; noIntrospection?: boolean; classes?: string[] };

/** Nachgebauter Datahub-Endpunkt: Introspection (Schema + Typen) und Listen-Abfrage */
function fakeDatahub(options: FakeOptions = {}) {
  const calls: Array<{ url: string; key: string | null; query: string; variables?: any }> = [];
  const classes = options.classes ?? ["Artikel", "basePrice", "onlinepiceDE"];
  const handler = async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: input, key: headers.get("X-API-Key"), query: body.query, variables: body.variables });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (options.html404) return new Response("<!-- No route found --><html></html>", { status: 404, headers: { "content-type": "text/html" } });
    if (input !== ENDPOINT_URL) return json({ success: false, message: "configuration not found" }, 403);
    if (options.status) return json({ success: false, message: "boom" }, options.status);
    if (headers.get("X-API-Key") !== (options.key ?? KEY)) return json({ success: false, message: "Permission denied, apikey not valid" }, 403);
    if (body.query.includes("__schema") || body.query.includes("__type")) {
      if (options.noIntrospection) return json({ errors: [{ message: "GraphQL introspection is not allowed" }] });
      if (body.query.includes("__schema")) {
        return json({
          data: {
            __schema: {
              queryType: {
                fields: [
                  ...classes.flatMap((c) => [{ name: `get${c}` }, { name: `get${c}Listing` }]),
                  { name: "getAsset" },
                ],
              },
            },
          },
        });
      }
      const typeName = body.variables?.name;
      return json({ data: { __type: typeName === "object_Artikel" ? { name: typeName, fields: ARTIKEL_FIELDS } : { name: typeName, fields: [{ name: "id", type: scalar("ID") }] } } });
    }
    if (body.query.includes("getArtikelListing")) {
      if (body.query.includes("Unbekannt")) return json({ errors: [{ message: 'Cannot query field "Unbekannt"' }] });
      const node: Record<string, unknown> = { id: "4711" };
      if (body.query.includes("GTIN")) node.GTIN = "4026212138719";
      return json({ data: { getArtikelListing: { totalCount: 12873, edges: [{ node }] } } });
    }
    return json({ errors: [{ message: "unknown query" }] });
  };
  return { calls, handler };
}

const connection = (overrides: Partial<StoredPimcoreConnection> = {}): StoredPimcoreConnection => ({
  baseUrl: PIM,
  endpoint: "metaorder",
  apiKey: KEY,
  productClass: "Artikel",
  productNumberField: "GTIN",
  ...overrides,
});

describe("Pimcore-Eingaben", () => {
  it("Adresse: HTTPS Pflicht, ohne Zugangsdaten/Parameter; kompletter Endpunkt wird zerlegt", () => {
    expect(normalizePimcoreTarget({ baseUrl: "" })).toEqual({ ok: false, code: "pimcore_url_missing" });
    expect(normalizePimcoreTarget({ baseUrl: "pim" })).toEqual({ ok: false, code: "pimcore_url_invalid" });
    expect(normalizePimcoreTarget({ baseUrl: "http://pim.example.com" })).toEqual({ ok: false, code: "pimcore_url_https" });
    expect(normalizePimcoreTarget({ baseUrl: `${PIM}?apikey=x` })).toEqual({ ok: false, code: "pimcore_url_invalid" });
    expect(normalizePimcoreTarget({ baseUrl: "https://u:p@pim.example.com" })).toEqual({ ok: false, code: "pimcore_url_invalid" });
    expect(normalizePimcoreTarget({ baseUrl: " https://pim.example.com/ " })).toEqual({
      ok: true,
      target: { baseUrl: PIM, endpoint: "metaorder", productClass: "Artikel", productNumberField: "GTIN" },
    });
    expect(normalizePimcoreTarget({ baseUrl: `${PIM}/pimcore-graphql-webservices/produkte/` })).toMatchObject({
      ok: true,
      target: { baseUrl: PIM, endpoint: "produkte" },
    });
    expect(normalizePimcoreTarget({ baseUrl: "http://localhost:8080" })).toMatchObject({ ok: true, target: { baseUrl: "http://localhost:8080" } });
  });

  it("Namen gehen in Abfragen ein: nur Buchstaben, Ziffern, _ (Konfiguration auch -)", () => {
    expect(normalizePimcoreTarget({ baseUrl: PIM, endpoint: "meta order" })).toEqual({ ok: false, code: "pimcore_endpoint_invalid" });
    expect(normalizePimcoreTarget({ baseUrl: PIM, endpoint: "meta-order" })).toMatchObject({ ok: true });
    expect(normalizePimcoreTarget({ baseUrl: PIM, productClass: "Artikel{ x }" })).toEqual({ ok: false, code: "pimcore_class_invalid" });
    expect(normalizePimcoreTarget({ baseUrl: PIM, productNumberField: "GTIN }" })).toEqual({ ok: false, code: "pimcore_field_invalid" });
  });

  it("Klassen aus den Listen-Abfragen", () => {
    expect(classesFromQueryFields([{ name: "getArtikel" }, { name: "getArtikelListing" }, { name: "getbasePriceListing" }, { name: "getAsset" }])).toEqual([
      { name: "Artikel", listingField: "getArtikelListing", typeName: "object_Artikel" },
      { name: "basePrice", listingField: "getbasePriceListing", typeName: "object_basePrice" },
    ]);
  });
});

describe("Pimcore-Client", () => {
  it("Key nur im Header X-API-Key, nie in der Adresse", async () => {
    const fake = fakeDatahub();
    await new PimcoreClient(connection(), fake.handler).query("{ getArtikelListing(first: 1) { totalCount } }");
    expect(fake.calls[0].url).toBe(ENDPOINT_URL);
    expect(fake.calls[0].url).not.toContain(KEY);
    expect(fake.calls[0].key).toBe(KEY);
  });

  it("Fehler als Code: falscher Key, unbekannte Konfiguration, kein Datahub, nicht erreichbar, Abfragefehler", async () => {
    const run = async (conn: StoredPimcoreConnection, fake = fakeDatahub(), query = "{ getArtikelListing { totalCount } }") => {
      try {
        await new PimcoreClient(conn, fake.handler).query(query);
        return null;
      } catch (error) {
        expect(error).toBeInstanceOf(PimcoreApiError);
        return { code: (error as PimcoreApiError).code, status: (error as PimcoreApiError).status, detail: (error as PimcoreApiError).detail };
      }
    };
    expect(await run(connection({ apiKey: OTHER_KEY }))).toMatchObject({ code: "pimcore_unauthorized", status: 403 });
    expect(await run(connection({ endpoint: "andere" }))).toMatchObject({ code: "pimcore_endpoint_unknown", status: 403 });
    expect(await run(connection(), fakeDatahub({ html404: true }))).toMatchObject({ code: "pimcore_no_datahub", status: 404 });
    expect(await run(connection(), fakeDatahub({ status: 500 }))).toMatchObject({ code: "pimcore_failed", status: 500, detail: "boom" });
    expect(await run(connection(), fakeDatahub(), "{ getArtikelListing { Unbekannt } }")).toMatchObject({
      code: "pimcore_graphql_error",
      detail: 'Cannot query field "Unbekannt"',
    });
    const offline = { handler: async () => { throw new TypeError("fetch failed"); } } as any;
    expect(await run(connection(), offline)).toMatchObject({ code: "pimcore_unreachable", status: null });
  });
});

describe("Pimcore-Verbindungstest", () => {
  it("zeigt freigegebene Klassen mit Feldern und einen Beispiel-Artikel", async () => {
    const fake = fakeDatahub();
    const result = await testPimcoreConnection(new PimcoreClient(connection(), fake.handler), connection());
    expect(result.introspection).toBe(true);
    expect(result.classes.map((c) => c.name)).toEqual(["Artikel", "basePrice", "onlinepiceDE"]);
    expect(result.classes[0].fields).toEqual([
      { name: "id", type: "ID!" },
      { name: "GTIN", type: "String" },
      { name: "hoehe", type: "Float" },
      { name: "bilder", type: "[asset]" },
    ]);
    expect(result.product).toEqual({
      className: "Artikel",
      numberField: "GTIN",
      numberFieldFound: true,
      totalCount: 12873,
      sample: { id: "4711", number: "4026212138719" },
    });
    // nacheinander: Schema, je Klasse ein Typ, dann der Beispiel-Artikel
    expect(fake.calls).toHaveLength(5);
  });

  it("Nummernfeld nicht freigegeben: Hinweis statt Fehler, Beispiel nur mit id", async () => {
    const result = await testPimcoreConnection(
      new PimcoreClient(connection({ productNumberField: "Artikelnummer" }), fakeDatahub().handler),
      connection({ productNumberField: "Artikelnummer" }),
    );
    expect(result.product.numberFieldFound).toBe(false);
    expect(result.product.sample).toEqual({ id: "4711", number: null });
  });

  it("Klasse nicht freigegeben: Fehler pimcore_class_missing mit Klassenname", async () => {
    await expect(
      testPimcoreConnection(new PimcoreClient(connection(), fakeDatahub({ classes: ["basePrice"] }).handler), connection()),
    ).rejects.toMatchObject({ code: "pimcore_class_missing", detail: "Artikel" });
  });

  it("ohne Introspection: nur der Beispiel-Artikel", async () => {
    const result = await testPimcoreConnection(new PimcoreClient(connection(), fakeDatahub({ noIntrospection: true }).handler), connection());
    expect(result.introspection).toBe(false);
    expect(result.classes).toEqual([]);
    expect(result.product).toMatchObject({ numberFieldFound: true, totalCount: 12873, sample: { number: "4026212138719" } });
  });
});

describe("Einstellungen: Pimcore-Verbindung (Routen)", () => {
  const settings = new Map<string, any>();
  let pim = fakeDatahub();
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
    pim = fakeDatahub();
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

  const empty = { configured: false, baseUrl: "", endpoint: "metaorder", productClass: "Artikel", productNumberField: "GTIN", hasApiKey: false };

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

    const saved = await call("POST", "/api/settings/pimcore-connection", { baseUrl: `${PIM}/pimcore-graphql-webservices/metaorder`, apiKey: ` ${KEY} ` });
    expect(saved).toEqual({ status: 200, body: { ...empty, configured: true, baseUrl: PIM, hasApiKey: true } });
    const stored = settings.get("pimcore_connection");
    expect(stored).toMatchObject({ baseUrl: PIM, endpoint: "metaorder", productClass: "Artikel", productNumberField: "GTIN" });
    expect(stored.apiKey).not.toBe(KEY);
    expect(decrypt(stored.apiKey)).toBe(KEY);
    expect(await call("GET", "/api/settings/pimcore-connection")).toEqual({ status: 200, body: { ...empty, configured: true, baseUrl: PIM, hasApiKey: true } });
  });

  it("leerer Key behaelt den gespeicherten; neuer Key ersetzt ihn", async () => {
    await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM, apiKey: KEY });
    await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM, productClass: "Produkt", apiKey: "" });
    expect(settings.get("pimcore_connection").productClass).toBe("Produkt");
    expect(decrypt(settings.get("pimcore_connection").apiKey)).toBe(KEY);
    await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM, apiKey: OTHER_KEY });
    expect(decrypt(settings.get("pimcore_connection").apiKey)).toBe(OTHER_KEY);
  });

  it("testen: mit eingegebenem oder gespeichertem Key, ohne zu speichern; Fehler als Code mit Pimcore-Meldung", async () => {
    expect(await call("POST", "/api/settings/pimcore-connection/test", { baseUrl: PIM })).toMatchObject({ status: 400, body: { code: "pimcore_key_missing" } });
    const ok = await call("POST", "/api/settings/pimcore-connection/test", { baseUrl: PIM, apiKey: KEY });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ success: true, endpointUrl: ENDPOINT_URL, product: { totalCount: 12873, sample: { number: "4026212138719" } } });
    expect(settings.has("pimcore_connection")).toBe(false);

    await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM, apiKey: KEY });
    expect(await call("POST", "/api/settings/pimcore-connection/test", {})).toMatchObject({ status: 200 });
    expect(pim.calls.at(-1)?.key).toBe(KEY);

    expect(await call("POST", "/api/settings/pimcore-connection/test", { apiKey: OTHER_KEY })).toEqual({
      status: 502,
      body: { error: "Pimcore-Anfrage fehlgeschlagen", code: "pimcore_unauthorized", pimcoreStatus: 403, detail: "Permission denied, apikey not valid" },
    });
    pim = fakeDatahub({ html404: true });
    expect(await call("POST", "/api/settings/pimcore-connection/test", {})).toMatchObject({ status: 502, body: { code: "pimcore_no_datahub", pimcoreStatus: 404 } });
  });

  it("entfernen", async () => {
    await call("POST", "/api/settings/pimcore-connection", { baseUrl: PIM, apiKey: KEY });
    expect(await call("DELETE", "/api/settings/pimcore-connection")).toEqual({ status: 200, body: empty });
    expect(await call("GET", "/api/settings/pimcore-connection")).toMatchObject({ body: { configured: false } });
  });
});

describe("Systemprotokoll und Einstellungsseite", () => {
  it("eigener Bereich Pimcore fuer Modul und API-Pfad", () => {
    expect(areaForComponent("integration/pimcoreSync")).toBe("pimcore");
    expect(areaForComponent("integration/n8nConnection")).toBe("integration");
    expect(areaForPath("/api/settings/pimcore-connection/test")).toBe("pimcore");
  });

  it("Abschnitt im Reiter Integration; Key als Passwortfeld, nie vorbelegt", () => {
    const page = readFileSync(path.join(ROOT, "client/src/pages/SettingsPage.tsx"), "utf8");
    expect(page).toMatch(/<TabsContent value="integration"[^>]*>[\s\S]*?<PimcoreConnectionSection \/>/);
    const section = readFileSync(path.join(ROOT, "client/src/components/PimcoreConnectionSection.tsx"), "utf8");
    expect(section).toMatch(/type="password"/);
    expect(section).toMatch(/autoComplete="new-password"/);
    expect(section).toMatch(/apiRequest\("POST", "\/api\/settings\/pimcore-connection", \{ \.\.\.form, apiKey \}\)/);
    expect(section).toMatch(/apiRequest\("POST", "\/api\/settings\/pimcore-connection\/test", \{ \.\.\.form, apiKey \}\)/);
    expect(section).toMatch(/apiRequest\("DELETE", "\/api\/settings\/pimcore-connection"\)/);
    expect(section).not.toMatch(/setApiKey\((connection|saved|data|result)/);
  });
});
