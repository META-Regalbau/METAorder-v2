/**
 * n8n-Schluessel mit Benutzer: In Produktion fehlte der Ersatz-Benutzer "n8n-service" (nur mit
 * N8N_SERVICE_PASSWORD angelegt), jeder Schluessel aus den Einstellungen war ungebunden - jeder
 * n8n-Aufruf scheiterte mit "Kein Integrations-Benutzer gefunden". Geprueft:
 * - describeIntegrationUser / listIntegrationUserCandidates / loadFallbackIntegrationUser
 * - Einstellungs-Routen GET/POST/PATCH (echte Routen, Anmeldung und Speicher gemockt)
 * - requireAuthOrIntegrationKey nutzt fuer ungebundene Schluessel denselben Ersatz-Benutzer
 * - Vorlagen unter n8n-workflows/: Header-Auth-Credential statt $env, Produktions-URL
 * - Einstellungsseite: Auswahl "Arbeitet als Benutzer" und PATCH-Aufruf
 * Ausführung: npm test
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = { id: "admin" };
    req.tenantId = req.headers["x-test-tenant"] === "none" ? null : "tenant-a";
    next();
  };
  return { ...actual, requireAuth: pass, requireManageSettings: pass, requireCsrf: pass };
});

import { storage } from "../../server/storage";
import { registerSettingsRoutes } from "../../server/routes/settingsRoutes";
import { requireAuthOrIntegrationKey } from "../../server/auth/auth";
import {
  describeIntegrationUser,
  listIntegrationUserCandidates,
  loadFallbackIntegrationUser,
} from "../../server/integration/integrationKeyUsers";

const ROOT = path.resolve(__dirname, "../..");

const roles: any[] = [
  { id: "r-admin", name: "Administrator", permissions: ["manageOffers", "manageOrderDrafts", "manageSettings"] },
  { id: "r-clerk", name: "Sachbearbeitung", permissions: { manageOffers: true, manageOrderDrafts: false } },
  { id: "r-drafts", name: "Entwuerfe", permissions: { manageOffers: false, manageOrderDrafts: true } },
  { id: "r-list", name: "Angebote", permissions: ["manageOffers", "viewOrders"] },
];
const user = (id: string, extra: Record<string, unknown> = {}) => ({ id, username: id, role: "employee", roleId: null, ...extra }) as any;
const users: any[] = [
  user("zora", { roleId: "r-admin" }),
  user("clerk", { roleId: "r-clerk" }),
  user("drafts", { roleId: "r-drafts" }),
  user("legacy-admin", { role: "admin" }),
  user("legacy-employee"),
  user("outsider", { roleId: "r-admin" }),
  user("n8n-service", { roleId: "r-admin" }),
  user("anna", { roleId: "r-admin" }),
  user("liste", { roleId: "r-list" }),
];
const membership: Record<string, string[]> = {
  zora: ["tenant-a"],
  clerk: ["tenant-a"],
  drafts: ["tenant-a"],
  "legacy-admin": ["tenant-a", "tenant-b"],
  "legacy-employee": ["tenant-a"],
  outsider: ["tenant-b"],
  "n8n-service": ["tenant-a"],
  anna: ["tenant-a"],
  liste: ["tenant-a"],
};

type Key = { id: string; tenantId: string; name: string; createdAt: Date; userId: string | null; hash: string };
let keys: Key[] = [];
let hiddenUsers = new Set<string>();

const findUser = (id: string) => (hiddenUsers.has(id) ? undefined : users.find((u) => u.id === id));
const hashOf = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getUser").mockImplementation(async (id: string) => findUser(id));
  vi.spyOn(storage, "getUserByUsername").mockImplementation(async (name: string) => (hiddenUsers.has(name) ? undefined : users.find((u) => u.username === name)));
  vi.spyOn(storage, "getAllUsers").mockImplementation(async () => users.filter((u) => !hiddenUsers.has(u.id)));
  vi.spyOn(storage, "getRole").mockImplementation(async (id: string) => roles.find((r) => r.id === id));
  vi.spyOn(storage, "getAllRoles").mockImplementation(async () => roles);
  vi.spyOn(storage, "getTenantsForUser").mockImplementation(async (id: string) => (membership[id] ?? []).map((tenantId) => ({ id: tenantId }) as any));
  vi.spyOn(storage, "updateUser").mockImplementation(async () => undefined as any);
  vi.spyOn(storage, "listTenantIntegrationApiKeys").mockImplementation(async (tenantId: string) =>
    keys.filter((k) => k.tenantId === tenantId).map(({ id, name, createdAt, userId }) => ({ id, name, createdAt, userId })),
  );
  vi.spyOn(storage, "createTenantIntegrationApiKey").mockImplementation(async (tenantId: string, name: string, userId?: string | null) => {
    const id = `k${keys.length + 1}`;
    keys.push({ id, tenantId, name, createdAt: new Date("2026-10-06T10:00:00Z"), userId: userId ?? null, hash: hashOf(`raw-${id}`) });
    return { id, apiKey: `raw-${id}` } as any;
  });
  vi.spyOn(storage, "setTenantIntegrationApiKeyUser").mockImplementation(async (id: string, tenantId: string, userId: string | null) => {
    const key = keys.find((k) => k.id === id && k.tenantId === tenantId);
    if (!key) return false;
    key.userId = userId;
    return true;
  });
  vi.spyOn(storage, "findTenantIdByIntegrationKeyHash").mockImplementation(async (hash: string) => {
    const key = keys.find((k) => k.hash === hash);
    return key ? ({ tenantId: key.tenantId, userId: key.userId } as any) : undefined;
  });

  const app = express();
  app.use(express.json());
  registerSettingsRoutes(app as any);
  app.post("/probe", requireAuthOrIntegrationKey, (req: any, res) => res.json({ userId: req.user.id, tenantId: req.tenantId }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  keys = [];
  hiddenUsers = new Set();
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllEnvs());

const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const list = () => call("GET", "/api/settings/integration-api-keys");
const create = (body: Record<string, unknown>) => call("POST", "/api/settings/integration-api-keys", body);
const assign = (id: string, body: Record<string, unknown>) => call("PATCH", `/api/settings/integration-api-keys/${id}`, body);

describe("describeIntegrationUser", () => {
  it("bereit nur mit Mitgliedschaft UND beiden Rechten (Liste oder Objekt)", async () => {
    const info = (id: string) => describeIntegrationUser(storage, findUser(id), "tenant-a");
    expect(await info("zora")).toEqual({
      id: "zora",
      username: "zora",
      roleName: "Administrator",
      isTenantMember: true,
      canManageOffers: true,
      canManageOrderDrafts: true,
      ready: true,
    });
    expect(await info("clerk")).toMatchObject({ roleName: "Sachbearbeitung", canManageOffers: true, canManageOrderDrafts: false, ready: false });
    expect(await info("drafts")).toMatchObject({ canManageOffers: false, canManageOrderDrafts: true, ready: false });
    expect(await info("liste")).toMatchObject({ roleName: "Angebote", canManageOffers: true, canManageOrderDrafts: false, ready: false });
    expect(await info("outsider")).toMatchObject({ isTenantMember: false, canManageOffers: true, canManageOrderDrafts: true, ready: false });
  });

  it("Altbenutzer ohne roleId: Rolle ueber den Namen, ohne zu speichern", async () => {
    expect(await describeIntegrationUser(storage, findUser("legacy-admin"), "tenant-a")).toMatchObject({ roleName: "Administrator", ready: true });
    // keine Rolle "Employee" vorhanden -> keine Rechte
    expect(await describeIntegrationUser(storage, findUser("legacy-employee"), "tenant-a")).toMatchObject({
      roleName: null,
      canManageOffers: false,
      canManageOrderDrafts: false,
      ready: false,
    });
    expect(storage.updateUser).not.toHaveBeenCalled();
  });
});

describe("listIntegrationUserCandidates", () => {
  it("nur Mitglieder des Mandanten, geeignete zuerst, dann nach Name", async () => {
    const candidates = await listIntegrationUserCandidates(storage, "tenant-a");
    expect(candidates.map((c) => c.username)).toEqual([
      "anna",
      "legacy-admin",
      "n8n-service",
      "zora",
      "clerk",
      "drafts",
      "legacy-employee",
      "liste",
    ]);
    expect((await listIntegrationUserCandidates(storage, "tenant-b")).map((c) => c.username)).toEqual(["legacy-admin", "outsider"]);
  });
});

describe("loadFallbackIntegrationUser", () => {
  it("METAORDER_INTEGRATION_USER_ID vor n8n-service; ohne beide null", async () => {
    expect((await loadFallbackIntegrationUser(storage))?.id).toBe("n8n-service");
    vi.stubEnv("METAORDER_INTEGRATION_USER_ID", " zora ");
    expect((await loadFallbackIntegrationUser(storage))?.id).toBe("zora");
    vi.stubEnv("METAORDER_INTEGRATION_USER_ID", "fehlt");
    expect(await loadFallbackIntegrationUser(storage)).toBeNull();
    vi.stubEnv("METAORDER_INTEGRATION_USER_ID", "");
    hiddenUsers.add("n8n-service");
    expect(await loadFallbackIntegrationUser(storage)).toBeNull();
  });
});

describe("Einstellungen: Integrations-Schluessel mit Benutzer", () => {
  it("GET: je Schluessel der tatsaechliche Benutzer (gebunden oder Ersatz), Kandidaten und Ersatz-Benutzer", async () => {
    keys.push(
      { id: "bound", tenantId: "tenant-a", name: "n8n", createdAt: new Date(), userId: "clerk", hash: "h1" },
      { id: "free", tenantId: "tenant-a", name: "alt", createdAt: new Date(), userId: null, hash: "h2" },
      { id: "other", tenantId: "tenant-b", name: "fremd", createdAt: new Date(), userId: null, hash: "h3" },
    );
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.keys.map((k: any) => k.id)).toEqual(["bound", "free"]);
    expect(body.keys[0]).toMatchObject({ userId: "clerk", user: { id: "clerk", ready: false }, effectiveUser: { id: "clerk", canManageOrderDrafts: false } });
    expect(body.keys[1]).toMatchObject({ userId: null, user: null, effectiveUser: { id: "n8n-service", ready: true } });
    expect(body.fallbackUser).toMatchObject({ id: "n8n-service", ready: true });
    expect(body.users.map((u: any) => u.id)).not.toContain("outsider");
  });

  it("GET: ohne Ersatz-Benutzer laeuft ein ungebundener Schluessel unter niemandem", async () => {
    hiddenUsers.add("n8n-service");
    keys.push({ id: "free", tenantId: "tenant-a", name: "", createdAt: new Date(), userId: null, hash: "h" });
    const { body } = await list();
    expect(body.fallbackUser).toBeNull();
    expect(body.keys[0].effectiveUser).toBeNull();
  });

  it("GET: gebundener Benutzer ausserhalb des Mandanten bzw. geloescht", async () => {
    keys.push(
      { id: "away", tenantId: "tenant-a", name: "", createdAt: new Date(), userId: "outsider", hash: "h1" },
      { id: "gone", tenantId: "tenant-a", name: "", createdAt: new Date(), userId: "geloescht", hash: "h2" },
    );
    const { body } = await list();
    expect(body.keys[0].effectiveUser).toMatchObject({ id: "outsider", isTenantMember: false, ready: false });
    // geloeschter Benutzer: kein stiller Wechsel auf den Ersatz-Benutzer (wie requireAuthOrIntegrationKey)
    expect(body.keys[1]).toMatchObject({ userId: "geloescht", user: null, effectiveUser: null });
  });

  it("POST: Benutzer muss existieren und Mitglied sein; leer = Ersatz-Benutzer", async () => {
    expect(await create({ name: "a", userId: "unbekannt" })).toEqual({ status: 400, body: { error: "userId nicht gefunden" } });
    expect(await create({ name: "a", userId: "outsider" })).toEqual({
      status: 400,
      body: { error: "Der angegebene Benutzer ist diesem Mandanten nicht zugeordnet." },
    });
    expect(keys).toHaveLength(0);
    expect((await create({ name: "n8n", userId: " zora " })).status).toBe(200);
    expect((await create({ name: "ohne" })).status).toBe(200);
    expect(keys.map((k) => [k.name, k.userId])).toEqual([
      ["n8n", "zora"],
      ["ohne", null],
    ]);
  });

  it("PATCH: Benutzer wechseln, zuruecksetzen; fremder Schluessel 404, fremder Benutzer 400", async () => {
    keys.push(
      { id: "k1", tenantId: "tenant-a", name: "", createdAt: new Date(), userId: null, hash: "h1" },
      { id: "kb", tenantId: "tenant-b", name: "", createdAt: new Date(), userId: null, hash: "h2" },
    );
    expect(await assign("k1", { userId: "anna" })).toEqual({ status: 200, body: { ok: true, userId: "anna" } });
    expect(keys[0].userId).toBe("anna");
    expect(await assign("k1", { userId: "outsider" })).toMatchObject({ status: 400 });
    expect(await assign("k1", { userId: "unbekannt" })).toMatchObject({ status: 400 });
    expect(keys[0].userId).toBe("anna");
    expect(await assign("k1", { userId: null })).toEqual({ status: 200, body: { ok: true, userId: null } });
    expect(keys[0].userId).toBeNull();
    expect(await assign("kb", { userId: "anna" })).toEqual({ status: 404, body: { error: "Key not found" } });
    expect(keys[1].userId).toBeNull();
    expect(await assign("fehlt", { userId: "anna" })).toMatchObject({ status: 404 });
  });

  it("ohne Mandant: 400", async () => {
    const none = { "x-test-tenant": "none" };
    expect(await call("GET", "/api/settings/integration-api-keys", undefined, none)).toMatchObject({ status: 400, body: { error: "Tenant required" } });
    expect(await call("PATCH", "/api/settings/integration-api-keys/k1", { userId: "anna" }, none)).toMatchObject({ status: 400 });
  });
});

describe("requireAuthOrIntegrationKey mit Mandanten-Schluessel", () => {
  const probe = (raw: string) => call("POST", "/probe", {}, { "X-METAORDER-Integration-Key": raw });

  it("gebunden: arbeitet als dieser Benutzer im Mandanten des Schluessels", async () => {
    keys.push({ id: "k1", tenantId: "tenant-a", name: "", createdAt: new Date(), userId: "anna", hash: hashOf("geheim-1") });
    expect(await probe("geheim-1")).toEqual({ status: 200, body: { userId: "anna", tenantId: "tenant-a" } });
  });

  it("ungebunden: Ersatz-Benutzer; fehlt er, 500 mit Hinweis", async () => {
    keys.push({ id: "k1", tenantId: "tenant-a", name: "", createdAt: new Date(), userId: null, hash: hashOf("geheim-2") });
    expect(await probe("geheim-2")).toEqual({ status: 200, body: { userId: "n8n-service", tenantId: "tenant-a" } });
    vi.stubEnv("METAORDER_INTEGRATION_USER_ID", "zora");
    expect((await probe("geheim-2")).body.userId).toBe("zora");
    vi.stubEnv("METAORDER_INTEGRATION_USER_ID", "");
    hiddenUsers.add("n8n-service");
    const failed = await probe("geheim-2");
    expect(failed.status).toBe(500);
    expect(failed.body.error).toMatch(/Kein Integrations-Benutzer gefunden/);
  });

  it("gebundener Benutzer geloescht oder nicht Mitglied: abgelehnt, kein Wechsel auf den Ersatz-Benutzer", async () => {
    keys.push(
      { id: "k1", tenantId: "tenant-a", name: "", createdAt: new Date(), userId: "geloescht", hash: hashOf("geheim-3") },
      { id: "k2", tenantId: "tenant-a", name: "", createdAt: new Date(), userId: "outsider", hash: hashOf("geheim-4") },
    );
    expect((await probe("geheim-3")).status).toBe(403);
    expect((await probe("geheim-4")).status).toBe(403);
  });
});

describe("n8n-Vorlagen", () => {
  for (const file of ["gmail-to-metaorder.json", "m365-to-metaorder.json"]) {
    it(`${file}: Upload mit Header-Auth-Credential und Produktions-URL, ohne $env`, () => {
      const raw = readFileSync(path.join(ROOT, "n8n-workflows", file), "utf8");
      // n8n Cloud sperrt $env in Ausdruecken - die Vorlagen duerfen es nicht brauchen
      expect(raw).not.toContain("$env");
      const workflow = JSON.parse(raw);
      const upload = workflow.nodes.find((node: any) => node.name === "POST commercial-drafts/upload");
      expect(upload.parameters).toMatchObject({
        url: "https://p-bbpye5.project.space/api/commercial-drafts/upload",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
      });
      expect(upload.parameters.sendHeaders).toBeFalsy();
      expect(upload.credentials).toEqual({
        httpHeaderAuth: { id: "METAORDER_INTEGRATION_KEY_CREDENTIAL_ID", name: "METAorder Integration-Key" },
      });
      // Notiz am Knoten erklaert das Credential (Header-Name) und die lokale URL
      expect(upload.notes).toContain("X-METAORDER-Integration-Key");
      expect(upload.notes).toContain("http://host.docker.internal:5001");
    });
  }

  // Vorher lief "Prepare EML" einmal fuer alle Mails und nahm .first(): kamen in einer Abfrage
  // mehrere Mails, ging nur die erste an METAorder (im n8n-Container nachgestellt: 3 rein, 1 raus).
  const templates = [
    {
      file: "gmail-to-metaorder.json",
      trigger: "Gmail Trigger",
      previous: (mail: any) => ({ json: { raw: Buffer.from(`Subject: ${mail.subject}\r\n\r\nHallo ${mail.id}`).toString("base64url") } }),
    },
    {
      file: "m365-to-metaorder.json",
      trigger: "Outlook Trigger",
      previous: (mail: any) => ({
        json: {},
        binary: { data: { data: Buffer.from(`Subject: ${mail.subject}\r\n\r\nHallo ${mail.id}`).toString("base64"), mimeType: "text/plain" } },
      }),
    },
  ];
  for (const { file, trigger, previous } of templates) {
    it(`${file}: jede Mail einer Abfrage wird einzeln vorbereitet`, () => {
      const workflow = JSON.parse(readFileSync(path.join(ROOT, "n8n-workflows", file), "utf8"));
      const prepare = workflow.nodes.find((node: any) => node.type === "n8n-nodes-base.code");
      expect(prepare.parameters.mode).toBe("runOnceForEachItem");
      const mails = [
        { id: "m1", subject: "Bestellung 4711", snippet: "", bodyPreview: "" },
        { id: "m2", subject: "Preisanfrage Regal", snippet: "", bodyPreview: "" },
        { id: "m3", subject: "Hallo", snippet: "", bodyPreview: "" },
      ];
      const previousItems = mails.map(previous);
      // n8n je Element: $input.item / $('Trigger').item = das zugehoerige Element; first() = immer das erste
      const run = new Function("$", "$input", "Buffer", prepare.parameters.jsCode);
      const outputs = mails.map((_, i) =>
        run(
          (name: string) => {
            expect(name).toBe(trigger);
            return { item: { json: mails[i] }, first: () => ({ json: mails[0] }) };
          },
          { item: previousItems[i], first: () => previousItems[0] },
          Buffer,
        ),
      );
      expect(outputs.map((out: any) => [out.json.id, out.json.intentHint, out.binary.data.mimeType])).toEqual([
        ["m1", "order", "message/rfc822"],
        ["m2", "offer", "message/rfc822"],
        ["m3", "unclear", "message/rfc822"],
      ]);
      outputs.forEach((out: any, i: number) => {
        expect(out.binary.data.fileName).toContain(mails[i].id);
        expect(Buffer.from(out.binary.data.data, "base64").toString()).toContain(`Hallo ${mails[i].id}`);
      });
    });
  }
});

describe("Einstellungsseite n8n", () => {
  const source = readFileSync(path.join(ROOT, "client/src/components/N8nSettingsSection.tsx"), "utf8");

  it("Schluessel anlegen mit Benutzer; Benutzer nachtraeglich per PATCH aendern", () => {
    expect(source).toMatch(/apiRequest\("POST", "\/api\/settings\/integration-api-keys", \{ name, userId \}\)/);
    expect(source).toMatch(/apiRequest\("PATCH", `\/api\/settings\/integration-api-keys\/\$\{encodeURIComponent\(id\)\}`, \{ userId \}\)/);
    expect(source).toContain('data-testid="select-integration-key-user"');
    expect(source).toContain("data-testid={`select-integration-key-user-${key.id}`}");
    expect(source).toContain("data-testid={`integration-key-status-${key.id}`}");
    // Anlegen erst mit gewaehltem Benutzer
    expect(source).toMatch(/disabled=\{createMutation\.isPending \|\| !selectedNewUser\}/);
  });
});
