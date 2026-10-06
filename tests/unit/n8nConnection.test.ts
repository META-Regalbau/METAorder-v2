/**
 * n8n-Verbindung in den Einstellungen: Adresse + API-Key je Mandant (Key verschluesselt, nie in
 * Antworten), Verbindungstest und Uebersicht der Mail-Workflows mit letzten Ausfuehrungen.
 * Geprueft: Adresspruefung, Client gegen eine nachgebaute n8n-API (Header, Seiten, Fehlercodes),
 * Zusammenfassung der Workflows (Postfach, Upload-Ziel, keine Parameter-Werte), echte Routen mit
 * gemockter Anmeldung und gemocktem Speicher, Einbindung in der Einstellungsseite.
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
import {
  N8nApiError,
  N8nClient,
  loadN8nOverview,
  normalizeN8nBaseUrl,
  summarizeN8nExecutions,
  summarizeN8nWorkflow,
} from "../../server/integration/n8nConnection";

const ROOT = path.resolve(__dirname, "../..");
const N8N = "https://meta.app.n8n.cloud";
const KEY = "n8n-key-0123456789";
const OTHER_KEY = "n8n-key-zweiter";
const HEADER_SECRET = "geheimer-header-wert";

const m365Workflow = {
  id: "wf-mail",
  name: "m365.mail",
  active: true,
  updatedAt: "2026-10-05T08:00:00.000Z",
  nodes: [
    { name: "Outlook Trigger", type: "n8n-nodes-base.microsoftOutlookTrigger", parameters: { pollTimes: {} } },
    {
      name: "Weiterleiten",
      type: "n8n-nodes-base.httpRequest",
      parameters: { url: "https://example.com/hook", headerParameters: { parameters: [{ name: "X-Token", value: HEADER_SECRET }] } },
    },
  ],
};
const uploadWorkflow = {
  id: "wf-upload",
  name: "METAorder – M365",
  active: false,
  nodes: [
    { name: "Outlook Trigger", type: "n8n-nodes-base.microsoftOutlookTrigger", parameters: {} },
    { name: "Upload", type: "n8n-nodes-base.httpRequest", parameters: { url: "https://metaorder.example/api/commercial-drafts/upload?debug=1" } },
  ],
};
const otherWorkflow = { id: "wf-other", name: "Slack-Report", active: true, nodes: [{ name: "Cron", type: "n8n-nodes-base.scheduleTrigger" }] };
const archivedWorkflow = { id: "wf-old", name: "alt", active: false, isArchived: true, nodes: [{ name: "Gmail", type: "n8n-nodes-base.gmailTrigger" }] };

/** Nachgebaute n8n-API: Workflows in zwei Seiten, Ausfuehrungen je Workflow */
function fakeN8n(options: { key?: string; status?: number; html?: boolean } = {}) {
  const calls: Array<{ url: URL; key: string | null }> = [];
  const handler = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const key = new Headers(init?.headers).get("X-N8N-API-KEY");
    calls.push({ url, key });
    if (options.status) return new Response("{}", { status: options.status });
    if (key !== (options.key ?? KEY)) return new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 });
    if (options.html) return new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } });
    if (url.pathname === "/api/v1/workflows") {
      const page2 = url.searchParams.get("cursor") === "seite-2";
      const data = page2 ? [otherWorkflow, archivedWorkflow] : [m365Workflow, uploadWorkflow];
      return Response.json({ data, nextCursor: page2 ? null : "seite-2" });
    }
    if (url.pathname === "/api/v1/executions") {
      const id = url.searchParams.get("workflowId");
      const data =
        id === "wf-mail"
          ? [
              { id: 1, status: "success", startedAt: "2026-10-06T08:00:00.000Z" },
              { id: 2, status: "error", startedAt: "2026-10-06T09:00:00.000Z" },
              { id: 3, status: "success", startedAt: "2026-10-06T10:00:00.000Z" },
            ]
          : [];
      return Response.json({ data, nextCursor: null });
    }
    return new Response("not found", { status: 404 });
  };
  return { handler, calls };
}

describe("normalizeN8nBaseUrl", () => {
  it("https, ohne Schraegstrich und /api/v1 am Ende", () => {
    expect(normalizeN8nBaseUrl(" https://meta.app.n8n.cloud/ ")).toEqual({ ok: true, baseUrl: N8N });
    expect(normalizeN8nBaseUrl("https://meta.app.n8n.cloud/api/v1/")).toEqual({ ok: true, baseUrl: N8N });
    expect(normalizeN8nBaseUrl("https://n8n.firma.de/automation")).toEqual({ ok: true, baseUrl: "https://n8n.firma.de/automation" });
  });

  it("http nur fuer lokale Hosts; keine Zugangsdaten oder Query in der Adresse", () => {
    for (const local of ["http://localhost:5678", "http://n8n:5678", "http://host.docker.internal:5678", "http://n8n.localhost"]) {
      expect(normalizeN8nBaseUrl(local).ok, local).toBe(true);
    }
    expect(normalizeN8nBaseUrl("http://n8n.firma.de")).toEqual({ ok: false, code: "n8n_url_https" });
    expect(normalizeN8nBaseUrl("ftp://n8n.firma.de")).toEqual({ ok: false, code: "n8n_url_https" });
    expect(normalizeN8nBaseUrl("https://user:pw@n8n.firma.de")).toEqual({ ok: false, code: "n8n_url_invalid" });
    expect(normalizeN8nBaseUrl("https://n8n.firma.de/?x=1")).toEqual({ ok: false, code: "n8n_url_invalid" });
    expect(normalizeN8nBaseUrl("kein url")).toEqual({ ok: false, code: "n8n_url_invalid" });
    expect(normalizeN8nBaseUrl("  ")).toEqual({ ok: false, code: "n8n_url_missing" });
    expect(normalizeN8nBaseUrl(undefined)).toEqual({ ok: false, code: "n8n_url_missing" });
  });
});

describe("N8nClient", () => {
  it("sendet den Key im Header und liest alle Seiten (ohne gepinnte Daten)", async () => {
    const n8n = fakeN8n();
    const workflows = await new N8nClient({ baseUrl: N8N, apiKey: KEY }, n8n.handler).listWorkflows();
    expect(workflows.map((wf) => wf.id)).toEqual(["wf-mail", "wf-upload", "wf-other", "wf-old"]);
    expect(n8n.calls).toHaveLength(2);
    for (const call of n8n.calls) {
      expect(call.key).toBe(KEY);
      expect(call.url.origin + call.url.pathname).toBe(`${N8N}/api/v1/workflows`);
      expect(call.url.searchParams.get("excludePinnedData")).toBe("true");
      // der Key steht nie in der Adresse
      expect(call.url.toString()).not.toContain(KEY);
    }
    expect(n8n.calls[1].url.searchParams.get("cursor")).toBe("seite-2");
  });

  it("hoechstens 4 Seiten, auch wenn n8n immer weiter blaettert", async () => {
    let calls = 0;
    const endless = async () => {
      calls++;
      return Response.json({ data: [{ id: `wf${calls}` }], nextCursor: `c${calls}` });
    };
    expect(await new N8nClient({ baseUrl: N8N, apiKey: KEY }, endless).listWorkflows()).toHaveLength(4);
    expect(calls).toBe(4);
  });

  it("Fehler als Code: Key abgelehnt, keine API, Fehlerstatus, nicht erreichbar", async () => {
    const codeOf = async (handler: any) => {
      try {
        await new N8nClient({ baseUrl: N8N, apiKey: KEY }, handler).test();
        return "ok";
      } catch (error) {
        expect(error).toBeInstanceOf(N8nApiError);
        return `${(error as N8nApiError).code}:${(error as N8nApiError).status}`;
      }
    };
    expect(await codeOf(fakeN8n().handler)).toBe("ok");
    expect(await codeOf(fakeN8n({ key: "anderer" }).handler)).toBe("n8n_unauthorized:401");
    expect(await codeOf(fakeN8n({ status: 403 }).handler)).toBe("n8n_unauthorized:403");
    expect(await codeOf(fakeN8n({ status: 404 }).handler)).toBe("n8n_no_api:404");
    expect(await codeOf(fakeN8n({ html: true }).handler)).toBe("n8n_no_api:200");
    expect(await codeOf(fakeN8n({ status: 500 }).handler)).toBe("n8n_failed:500");
    expect(
      await codeOf(async () => {
        throw new TypeError("fetch failed");
      }),
    ).toBe("n8n_unreachable:null");
  });
});

describe("Zusammenfassung der Workflows", () => {
  it("Postfach, Upload an METAorder (ohne Query), Ziel ausserhalb; keine Parameter-Werte", () => {
    const own = "https://metaorder.example";
    expect(summarizeN8nWorkflow(m365Workflow, own)).toMatchObject({
      id: "wf-mail",
      mailSources: ["m365"],
      metaorderUploads: [],
      uploadsElsewhere: false,
    });
    expect(JSON.stringify(summarizeN8nWorkflow(m365Workflow, own))).not.toContain(HEADER_SECRET);
    expect(summarizeN8nWorkflow(uploadWorkflow, own)).toMatchObject({
      metaorderUploads: ["https://metaorder.example/api/commercial-drafts/upload"],
      uploadsElsewhere: false,
    });
    // lokale Adresse aus der Vorlage, aber METAorder laeuft woanders
    const local = {
      nodes: [{ type: "n8n-nodes-base.httpRequest", parameters: { url: "http://host.docker.internal:5001/api/commercial-drafts/upload" } }],
    };
    expect(summarizeN8nWorkflow(local, own)).toMatchObject({ uploadsElsewhere: true });
    // Ausdruck: Ziel erst zur Laufzeit bekannt -> keine Warnung
    const expression = {
      nodes: [
        { type: "n8n-nodes-base.httpRequest", parameters: { url: "={{ $env.METAORDER_BASE_URL }}/api/commercial-drafts/upload" } },
        { type: "n8n-nodes-base.httpRequest", disabled: true, parameters: { url: "https://alt.example/api/commercial-drafts/upload" } },
        { type: "n8n-nodes-base.gmailTrigger" },
        { type: "n8n-nodes-base.gmail" },
        { type: "n8n-nodes-base.emailReadImap" },
      ],
    };
    expect(summarizeN8nWorkflow(expression, own)).toMatchObject({
      metaorderUploads: ["{…}/api/commercial-drafts/upload"],
      uploadsElsewhere: false,
      mailSources: ["gmail", "imap"],
    });
  });

  it("Ausfuehrungen: Anzahl je Status, letzte und letzter Fehler", () => {
    expect(
      summarizeN8nExecutions([
        { status: "success", startedAt: "2026-10-06T08:00:00Z" },
        { status: "crashed", startedAt: "2026-10-06T07:00:00Z" },
        { status: "error", startedAt: "2026-10-06T09:00:00Z" },
        { status: "running", startedAt: "2026-10-06T10:00:00Z" },
        { status: "waiting", startedAt: "2026-10-06T06:00:00Z" },
      ]),
    ).toEqual({
      total: 5,
      success: 1,
      error: 2,
      running: 2,
      lastStartedAt: "2026-10-06T10:00:00Z",
      lastStatus: "running",
      lastErrorAt: "2026-10-06T09:00:00Z",
    });
    expect(summarizeN8nExecutions([])).toMatchObject({ total: 0, lastStartedAt: null, lastStatus: null, lastErrorAt: null });
  });

  it("Uebersicht: Mail-Workflows zuerst, Ausfuehrungen nur fuer sie, archivierte nicht", async () => {
    const n8n = fakeN8n();
    const overview = await loadN8nOverview(new N8nClient({ baseUrl: N8N, apiKey: KEY }, n8n.handler), "https://metaorder.example");
    expect(overview.map((wf) => wf.id)).toEqual(["wf-mail", "wf-upload", "wf-other"]);
    expect(overview[0].executions).toMatchObject({ total: 3, success: 2, error: 1, lastStatus: "success" });
    expect(overview[2].executions).toBeNull();
    const executionCalls = n8n.calls.filter((call) => call.url.pathname === "/api/v1/executions");
    expect(executionCalls.map((call) => call.url.searchParams.get("workflowId")).sort()).toEqual(["wf-mail", "wf-upload"]);
    expect(executionCalls.every((call) => call.url.searchParams.get("includeData") === "false")).toBe(true);
  });
});

describe("Einstellungen: n8n-Verbindung (Routen)", () => {
  const settings = new Map<string, any>();
  let n8n = fakeN8n();
  let server: Server;
  let base = "";
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    vi.stubEnv("ENCRYPTION_KEY", "unit-tests-only-encryption-key");
    vi.spyOn(storage, "getSetting").mockImplementation(async (key: string) => settings.get(key));
    vi.spyOn(storage, "saveSetting").mockImplementation(async (key: string, value: any) => {
      settings.set(key, value);
    });
    // Aufrufe an n8n gehen an die Attrappe, die Testaufrufe an den lokalen Server
    vi.stubGlobal("fetch", (input: any, init?: RequestInit) =>
      String(input).startsWith(N8N) ? n8n.handler(String(input), init) : realFetch(input, init),
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
    n8n = fakeN8n();
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
    const stored = settings.get("n8n_connection")?.apiKey;
    if (stored) expect(text).not.toContain(stored);
    return { status: res.status, body: JSON.parse(text) };
  };

  it("speichern: Key verschluesselt; GET zeigt nur, dass einer gespeichert ist", async () => {
    expect(await call("GET", "/api/settings/n8n-connection")).toEqual({ status: 200, body: { configured: false, baseUrl: "", hasApiKey: false } });
    expect(await call("POST", "/api/settings/n8n-connection", { baseUrl: "http://n8n.firma.de", apiKey: KEY })).toMatchObject({
      status: 400,
      body: { code: "n8n_url_https" },
    });
    expect(await call("POST", "/api/settings/n8n-connection", { baseUrl: N8N })).toMatchObject({ status: 400, body: { code: "n8n_key_missing" } });
    expect(settings.has("n8n_connection")).toBe(false);

    expect(await call("POST", "/api/settings/n8n-connection", { baseUrl: `${N8N}/api/v1/`, apiKey: ` ${KEY} ` })).toEqual({
      status: 200,
      body: { configured: true, baseUrl: N8N, hasApiKey: true },
    });
    const stored = settings.get("n8n_connection");
    expect(stored.baseUrl).toBe(N8N);
    expect(stored.apiKey).not.toBe(KEY);
    expect(decrypt(stored.apiKey)).toBe(KEY);
    expect(await call("GET", "/api/settings/n8n-connection")).toEqual({ status: 200, body: { configured: true, baseUrl: N8N, hasApiKey: true } });
  });

  it("leerer Key behaelt den gespeicherten; neuer Key ersetzt ihn", async () => {
    await call("POST", "/api/settings/n8n-connection", { baseUrl: N8N, apiKey: KEY });
    await call("POST", "/api/settings/n8n-connection", { baseUrl: "https://n8n.firma.de", apiKey: "" });
    expect(settings.get("n8n_connection").baseUrl).toBe("https://n8n.firma.de");
    expect(decrypt(settings.get("n8n_connection").apiKey)).toBe(KEY);
    await call("POST", "/api/settings/n8n-connection", { baseUrl: N8N, apiKey: OTHER_KEY });
    expect(decrypt(settings.get("n8n_connection").apiKey)).toBe(OTHER_KEY);
  });

  it("testen: mit eingegebenem oder gespeichertem Key, ohne zu speichern; Ablehnung als Code", async () => {
    expect(await call("POST", "/api/settings/n8n-connection/test", { baseUrl: N8N })).toMatchObject({ status: 400, body: { code: "n8n_key_missing" } });
    expect(await call("POST", "/api/settings/n8n-connection/test", { baseUrl: N8N, apiKey: KEY })).toEqual({ status: 200, body: { success: true } });
    expect(settings.has("n8n_connection")).toBe(false);
    expect(n8n.calls.at(-1)?.key).toBe(KEY);

    await call("POST", "/api/settings/n8n-connection", { baseUrl: N8N, apiKey: KEY });
    expect(await call("POST", "/api/settings/n8n-connection/test", { baseUrl: N8N, apiKey: "" })).toMatchObject({ status: 200 });
    expect(n8n.calls.at(-1)?.key).toBe(KEY);
    expect(await call("POST", "/api/settings/n8n-connection/test", {})).toMatchObject({ status: 200 });

    expect(await call("POST", "/api/settings/n8n-connection/test", { baseUrl: N8N, apiKey: OTHER_KEY })).toEqual({
      status: 502,
      body: { error: "n8n-Anfrage fehlgeschlagen", code: "n8n_unauthorized", n8nStatus: 401 },
    });
  });

  it("Workflows: Uebersicht mit eigenem METAorder als Bezug; ohne Verbindung 400; entfernen", async () => {
    expect(await call("GET", "/api/settings/n8n-connection/workflows")).toMatchObject({ status: 400, body: { code: "n8n_not_configured" } });
    await call("POST", "/api/settings/n8n-connection", { baseUrl: N8N, apiKey: KEY });
    const { status, body } = await call("GET", "/api/settings/n8n-connection/workflows");
    expect(status).toBe(200);
    // Bezug ist die Adresse, unter der METAorder aufgerufen wird (in Produktion ueber den Proxy)
    expect(body.ownOrigin).toBe(base);
    expect(body.workflows.map((wf: any) => [wf.id, wf.mailSources, wf.executions?.total ?? null])).toEqual([
      ["wf-mail", ["m365"], 3],
      ["wf-upload", ["m365"], 0],
      ["wf-other", [], null],
    ]);
    // Upload-Ziel https://metaorder.example ist nicht dieses METAorder -> Hinweis
    expect(body.workflows[1].uploadsElsewhere).toBe(true);
    expect(JSON.stringify(body)).not.toContain(HEADER_SECRET);

    // mit PUBLIC_APP_URL (Produktion) gilt diese Adresse
    vi.stubEnv("PUBLIC_APP_URL", "https://metaorder.example/");
    const withPublicUrl = (await call("GET", "/api/settings/n8n-connection/workflows")).body;
    vi.stubEnv("PUBLIC_APP_URL", "");
    expect(withPublicUrl.ownOrigin).toBe("https://metaorder.example");
    expect(withPublicUrl.workflows[1].uploadsElsewhere).toBe(false);

    expect(await call("DELETE", "/api/settings/n8n-connection")).toEqual({ status: 200, body: { configured: false, baseUrl: "", hasApiKey: false } });
    expect(await call("GET", "/api/settings/n8n-connection")).toMatchObject({ body: { configured: false } });
    expect(await call("GET", "/api/settings/n8n-connection/workflows")).toMatchObject({ status: 400 });
  });
});

describe("Einstellungsseite", () => {
  it("Abschnitt im Reiter Integration; Key als Passwortfeld, nie vorbelegt", () => {
    const page = readFileSync(path.join(ROOT, "client/src/pages/SettingsPage.tsx"), "utf8");
    expect(page).toMatch(/<TabsContent value="integration"[^>]*>[\s\S]*?<N8nConnectionSection \/>/);
    const section = readFileSync(path.join(ROOT, "client/src/components/N8nConnectionSection.tsx"), "utf8");
    expect(section).toMatch(/type="password"/);
    expect(section).toMatch(/autoComplete="new-password"/);
    expect(section).toMatch(/apiRequest\("POST", "\/api\/settings\/n8n-connection", \{ baseUrl, apiKey \}\)/);
    expect(section).toMatch(/apiRequest\("POST", "\/api\/settings\/n8n-connection\/test", \{ baseUrl, apiKey \}\)/);
    expect(section).toMatch(/apiRequest\("DELETE", "\/api\/settings\/n8n-connection"\)/);
    // Key-Feld wird nach dem Speichern geleert und nie aus der Antwort befuellt
    expect(section).not.toMatch(/setApiKey\((connection|saved|data)/);
  });
});
