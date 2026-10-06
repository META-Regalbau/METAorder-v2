/**
 * Systemprotokoll fuer Admins: Bereiche je Eintrag, Speicher (Filter, Puffer, Datenbank-Ausfall),
 * Abzweig im Logger, Abfrage-Bedingungen, Admin-Routen und Einbindung im Client.
 * Ausführung: npm test
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PgDialect } from "drizzle-orm/pg-core";
import { and } from "drizzle-orm";

const repo = vi.hoisted(() => ({
  queryAppLogs: vi.fn(),
  appLogStats: vi.fn(),
}));
vi.mock("../../server/lib/appLogRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/lib/appLogRepository")>();
  return { ...actual, queryAppLogs: repo.queryAppLogs, appLogStats: repo.appLogStats };
});
vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  // Testbenutzer aus dem Header: admin | rolle | mitarbeiter
  const requireAuth = (req: any, _res: any, next: () => void) => {
    const kind = req.headers["x-test-user"];
    req.user =
      kind === "admin"
        ? { id: "u-admin", role: "admin" }
        : kind === "rolle"
          ? { id: "u-rolle", role: "employee", roleDetails: { name: "Administrator" } }
          : { id: "u-ma", role: "employee", roleDetails: { name: "Vertrieb", permissions: { manageSettings: true } } };
    req.tenantId = req.headers["x-test-tenant"] === "none" ? null : "tenant-a";
    next();
  };
  return { ...actual, requireAuth };
});

import { LOG_AREAS, LOG_LEVELS, isLogArea, logLevelName } from "../../shared/logAreas";
import { areaForComponent, areaForEntry, areaForMessage, areaForPath } from "../../server/lib/logAreas";
import { LogStoreSink, logLineToRow, logStoreEnabled, logStoreRetentionDays, parseLogLine, shouldStoreLogLine } from "../../server/lib/logStore";
import { createLogger, logger, setLoggerForTests, withArea } from "../../server/lib/logger";
import { requestLoggingMiddleware } from "../../server/lib/httpLogging";
import { appLogConditions } from "../../server/lib/appLogRepository";
import { parseLogQuery, registerLogRoutes } from "../../server/routes/logRoutes";
import { openApiPaths } from "../../server/openapi/openapi.paths";

const ROOT = path.resolve(__dirname, "../..");
const line = (record: Record<string, unknown>) => JSON.stringify({ time: "2026-10-06T10:00:00.000Z", level: "info", msg: "x", ...record });

describe("Bereiche", () => {
  it("Module: Unterbereiche vor Oberbereichen, Routen-Dateien nach Fachbereich", () => {
    expect(areaForComponent("erp/shipping/sendcloudWebhook")).toBe("shipping");
    expect(areaForComponent("erp/erpStockReconcile")).toBe("erp");
    expect(areaForComponent("shopware/client/orders")).toBe("shopware");
    expect(areaForComponent("shopware-mirror")).toBe("shopware");
    expect(areaForComponent("commercial/commercialDraftPipeline")).toBe("drafts");
    expect(areaForComponent("extraction/orderDraftExtractor")).toBe("drafts");
    expect(areaForComponent("invoice-watcher")).toBe("invoicing");
    expect(areaForComponent("lib/webhookService")).toBe("integration");
    expect(areaForComponent("sftp/sftpUpload")).toBe("integration");
    expect(areaForComponent("automation/scheduler")).toBe("automation");
    expect(areaForComponent("semantic/semanticIndexer")).toBe("ai");
    expect(areaForComponent("routes/draftRoutes")).toBe("drafts");
    expect(areaForComponent("routes/routeHelpers")).toBe("orders");
    expect(areaForComponent("routes/userRoutes")).toBe("auth");
    expect(areaForComponent("lib/objectStorage")).toBeNull();
    expect(areaForComponent("")).toBeNull();
    expect(areaForComponent(undefined)).toBeNull();
  });

  it("jedes Modul mit eigenem Logger hat einen Fachbereich (ausser Infrastruktur)", () => {
    const infrastructure = /^(lib\/(?!webhookService)|db$|dbStorage$|index$|seedData$|uploadsRoot$|routes$|observability\/|routes\/(notificationRoutes|logRoutes)$)/;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(path.join(ROOT, "server"));
    const components = new Set<string>();
    for (const file of files) {
      for (const match of fs.readFileSync(file, "utf8").matchAll(/logger\.child\(\{\s*component: "([^"]+)"/g)) components.add(match[1]);
    }
    expect(components.size).toBeGreaterThan(100);
    const unmapped = [...components].filter((c) => !infrastructure.test(c) && areaForComponent(c) === null).sort();
    expect(unmapped).toEqual([]);
  });

  it("API-Pfade: Einstellungen nach Thema, ERP-Versand, sonst erstes Segment; kaum etwas bleibt System", () => {
    expect(areaForPath("/api/settings/n8n-connection/test")).toBe("integration");
    expect(areaForPath("/api/settings/email-inbound")).toBe("email");
    expect(areaForPath("/api/settings/ai-prompts")).toBe("ai");
    expect(areaForPath("/api/settings/shopware/test")).toBe("shopware");
    expect(areaForPath("/api/settings/ticket-sla")).toBe("settings");
    expect(areaForPath("/api/erp/pick-lists/1")).toBe("shipping");
    expect(areaForPath("/api/erp/stock/2")).toBe("erp");
    expect(areaForPath("/api/orders/abc")).toBe("orders");
    expect(areaForPath("/api/ai/cross-selling/x")).toBe("crossSelling");
    expect(areaForPath("/api/commercial-drafts/upload")).toBe("drafts");
    expect(areaForPath("/api/public/portal-password-request")).toBe("b2b");
    expect(areaForPath("/api/unbekannt")).toBe("system");
    expect(areaForPath("/assets/app.js")).toBeNull();
    const system = Object.keys(openApiPaths).filter((p) => areaForPath(p.replace(/\{[^}]+\}/g, "x")) === "system").sort();
    // System bleiben nur Infrastruktur-Pfade (Benachrichtigungen, Version, Debug, Protokoll selbst)
    expect(system.length).toBeGreaterThan(0);
    expect(system.filter((p) => !/^\/api\/(admin\/logs|debug|notifications|openapi\.json|version)\b/.test(p))).toEqual([]);
  });

  it("Praefix der Meldung, Vorrang und ungueltige Angaben", () => {
    expect(areaForMessage("[CrossSellLearning] Learning job completed")).toBe("crossSelling");
    expect(areaForMessage("[ShopwareMirror] Sync scheduled")).toBe("shopware");
    expect(areaForMessage("[SemanticIndex] Index scheduled")).toBe("ai");
    expect(areaForMessage("serving on port 5000")).toBeNull();
    expect(areaForEntry({ area: "orders", component: "shopware/shopware" })).toBe("orders");
    expect(areaForEntry({ area: "quatsch", component: "shopware/shopware" })).toBe("shopware");
    expect(areaForEntry({ component: "lib/objectStorage", path: "/api/orders/1" })).toBe("orders");
    // Pfad der Anfrage vor dem Praefix der Meldung
    expect(areaForEntry({ path: "/api/orders/1", msg: "[ShopwareHTTP] POST /api/search" })).toBe("orders");
    expect(areaForEntry({ msg: "[OfferLearning] done" })).toBe("offers");
    expect(areaForEntry({ msg: "serving on port 5000" })).toBe("system");
    expect(LOG_AREAS.every(isLogArea)).toBe(true);
    expect([10, 20, 30, 40, 50, 60, 35].map(logLevelName)).toEqual(["trace", "debug", "info", "warn", "error", "fatal", "info"]);
  });
});

describe("Speicher: Zeilen lesen und auswaehlen", () => {
  it("liest JSON mit Stufe als Text oder Zahl, Zeit als ISO oder Zahl", () => {
    expect(parseLogLine(line({ level: "warn" }))).toMatchObject({ level: 40, time: "2026-10-06T10:00:00.000Z", msg: "x" });
    expect(parseLogLine(line({ level: 50, time: Date.UTC(2026, 9, 6) }))).toMatchObject({ level: 50, time: "2026-10-06T00:00:00.000Z" });
    expect(parseLogLine("[12:00] Hallo")).toBeNull();
    expect(parseLogLine("{kaputt")).toBeNull();
    expect(parseLogLine(line({ level: "laut" }))).toBeNull();
    expect(parseLogLine(JSON.stringify({ level: 30 }))?.msg).toBe("");
  });

  it("speichert ab info; erfolgreiche Lese-Anfragen und 401 bei GET nicht", () => {
    const keep = (record: Record<string, unknown>) => shouldStoreLogLine(parseLogLine(line(record))!);
    const request = (method: string, status: number, level = "info") => keep({ level, method, path: "/api/x", status, durationMs: 3 });
    expect(keep({ level: "debug" })).toBe(false);
    expect(keep({ level: "info" })).toBe(true);
    expect(keep({ level: "info", component: "lib/logStore" })).toBe(false);
    expect(request("GET", 200)).toBe(false);
    expect(request("HEAD", 304)).toBe(false);
    expect(request("GET", 401)).toBe(false);
    expect(request("GET", 404)).toBe(true);
    expect(request("GET", 422, "warn")).toBe(true);
    expect(request("POST", 200)).toBe(true);
    expect(request("DELETE", 204)).toBe(true);
    // langsame Lese-Anfrage kommt als Warnung
    expect(request("GET", 200, "warn")).toBe(true);
  });

  it("Zeile -> Datensatz: Spalten, uebrige Felder in data, Kuerzung, ohne \\u0000", () => {
    const row = logLineToRow(
      parseLogLine(
        line({
          level: "error",
          msg: "Fehler\u0000 beim Abgleich",
          component: "shopware/shopwareTokenCache",
          tenantId: "tenant-a",
          userId: "u1",
          requestId: "req-1",
          pid: 1,
          hostname: "h",
          err: { message: "kaputt", stack: "Error: kaputt\n    at x" },
          orderNumber: "10042",
        }),
      )!,
    );
    expect(row).toMatchObject({
      level: 50,
      area: "shopware",
      component: "shopware/shopwareTokenCache",
      msg: "Fehler beim Abgleich",
      tenantId: "tenant-a",
      userId: "u1",
      requestId: "req-1",
      data: { err: { message: "kaputt", stack: "Error: kaputt\n    at x" }, orderNumber: "10042" },
    });
    expect(row.time).toEqual(new Date("2026-10-06T10:00:00.000Z"));
    const plain = logLineToRow(parseLogLine(line({ source: "express", msg: "[ShopwareMirror] Sync" }))!);
    expect(plain).toMatchObject({ component: "express", area: "shopware", data: { source: "express" }, tenantId: null });
    expect(logLineToRow(parseLogLine(line({}))!).data).toBeNull();
    const big = logLineToRow(parseLogLine(line({ msg: "m".repeat(5000), payload: "p".repeat(30_000) }))!);
    expect(big.msg).toHaveLength(2000);
    expect(big.data).toMatchObject({ truncated: true });
    expect((big.data as { preview: string }).preview).toHaveLength(20_000);
    const request = logLineToRow(parseLogLine(line({ method: "POST", path: "/api/orders/1/status", status: 200, durationMs: 5 }))!);
    expect(request.area).toBe("orders");
  });

  it("Schalter und Aufbewahrung", () => {
    expect(logStoreEnabled({})).toBe(true);
    expect(logStoreEnabled({ LOG_STORE: "OFF" })).toBe(false);
    expect(logStoreEnabled({ VITEST: "true" })).toBe(false);
    expect(logStoreRetentionDays({})).toBe(14);
    expect(logStoreRetentionDays({ LOG_STORE_DAYS: "30" })).toBe(30);
    for (const bad of ["0", "91", "2.5", "x"]) expect(logStoreRetentionDays({ LOG_STORE_DAYS: bad })).toBe(14);
  });
});

describe("Speicher: Puffer und Schreiben", () => {
  const entry = (msg: string) => line({ msg });

  it("puffert bis zum Start, schreibt dann in Paketen", async () => {
    const batches: string[][] = [];
    const sink = new LogStoreSink({ flushMs: 60_000, maxBatch: 2, maxBuffer: 100 });
    sink.write(entry("a"));
    sink.write(`${entry("b")}\n${entry("c")}\n`);
    sink.write(line({ level: "debug", msg: "leise" }));
    expect(sink.pending).toBe(3);
    sink.start(async (rows) => {
      batches.push(rows.map((r) => r.msg));
    });
    await sink.flush();
    expect(batches).toEqual([["a", "b"], ["c"]]);
    sink.write(entry("d"));
    await sink.stop();
    expect(batches.at(-1)).toEqual(["d"]);
  });

  it("voller Puffer verwirft die aeltesten und meldet die Zahl", async () => {
    const written: string[] = [];
    const sink = new LogStoreSink({ flushMs: 60_000, maxBatch: 50, maxBuffer: 3 });
    for (const msg of ["1", "2", "3", "4", "5"]) sink.write(entry(msg));
    sink.start(async (rows) => {
      written.push(...rows.map((r) => r.msg));
    });
    await sink.stop();
    expect(written.slice(0, 3)).toEqual(["3", "4", "5"]);
    expect(written[3]).toMatch(/^2 Protokolleinträge verworfen/);
  });

  it("Datenbank-Ausfall: verwerfen, einmal auf stderr melden, spaeter nachtragen", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let fail = true;
    const written: string[] = [];
    const sink = new LogStoreSink({ flushMs: 60_000, maxBatch: 50, maxBuffer: 100 });
    sink.start(async (rows) => {
      if (fail) throw new Error("db weg");
      written.push(...rows.map((r) => r.msg));
    });
    await sink.flush(); // erster (leerer) Durchlauf beim Start
    sink.write(entry("a"));
    sink.write(entry("b"));
    await sink.flush();
    sink.write(entry("c"));
    await sink.flush();
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0][0])).toContain("db weg");
    fail = false;
    sink.write(entry("d"));
    await sink.stop();
    expect(written[0]).toBe("d");
    expect(written[1]).toMatch(/^3 Protokolleinträge verworfen/);
    stderr.mockRestore();
  });
});

describe("Logger", () => {
  afterEach(() => setLoggerForTests(null));

  it("Modul-Logger tragen ihren Bereich; ausdruecklicher Bereich bleibt", () => {
    const lines: any[] = [];
    setLoggerForTests(createLogger({ level: "info", format: "json", destination: { write: (c: string) => lines.push(JSON.parse(c)) } }));
    logger.child({ component: "shopware/shopwareTokenCache" }).info("a");
    logger.child({ component: "automation/engine", area: "orders" }).info("b");
    logger.child({ component: "lib/objectStorage" }).info("c");
    logger.info("d");
    expect(lines.map((l) => [l.msg, l.area])).toEqual([["a", "shopware"], ["b", "orders"], ["c", "system"], ["d", undefined]]);
    expect(withArea({ tenantId: "t" })).toEqual({ tenantId: "t" });
  });

  it("Anfrage-Zeile: Bereich aus dem Pfad, Stufe nach Status", async () => {
    const lines: any[] = [];
    setLoggerForTests(createLogger({ level: "info", format: "json", destination: { write: (c: string) => lines.push(JSON.parse(c)) } }));
    const app = express();
    app.use(requestLoggingMiddleware());
    for (const status of [200, 401, 403, 404, 422, 500]) app.get(`/api/orders/s${status}`, (_req, res) => res.sendStatus(status));
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const status of [200, 401, 403, 404, 422, 500]) await fetch(`${base}/api/orders/s${status}`);
    await new Promise<void>((r) => server.close(() => r()));
    const requests = lines.filter((l) => l.component === "http");
    expect(requests.map((l) => [l.status, l.level, l.area])).toEqual([
      [200, "info", "orders"],
      [401, "info", "orders"],
      [403, "warn", "orders"],
      [404, "info", "orders"],
      [422, "warn", "orders"],
      [500, "error", "orders"],
    ]);
  });
});

describe("Abfrage-Bedingungen", () => {
  const dialect = new PgDialect();
  const render = (query: Parameters<typeof appLogConditions>[0]) => {
    const { sql, params } = dialect.sqlToQuery(and(...appLogConditions(query))!);
    return { sql, params };
  };

  it("Mandant: eigener plus Systemmeldungen, nur eigener, ohne Mandant nur System", () => {
    expect(render({ tenantId: "t1", includeSystem: true })).toEqual({
      sql: '("app_logs"."tenant_id" = $1 or "app_logs"."tenant_id" is null)',
      params: ["t1"],
    });
    expect(render({ tenantId: "t1", includeSystem: false })).toEqual({ sql: '"app_logs"."tenant_id" = $1', params: ["t1"] });
    expect(render({ tenantId: null, includeSystem: false })).toEqual({ sql: '"app_logs"."tenant_id" is null', params: [] });
  });

  it("Filter und woertliche Suche (% und _ maskiert)", () => {
    const from = new Date("2026-10-06T00:00:00Z");
    const { sql, params } = render({
      tenantId: "t1",
      includeSystem: false,
      from,
      minLevel: 40,
      areas: ["orders", "shopware"],
      requestId: "r1",
      userId: "u1",
      beforeId: 99,
      q: "50%_rabatt",
    });
    expect(sql).toContain('"app_logs"."time" >= $2');
    expect(sql).toContain('"app_logs"."level" >= $3');
    expect(sql).toContain('"app_logs"."area" in ($4, $5)');
    expect(sql).toContain('"app_logs"."id" < $8');
    expect(sql).toContain('("app_logs"."msg" ILIKE $9 OR "app_logs"."data"::text ILIKE $10)');
    expect(params).toEqual(["t1", from.toISOString(), 40, "orders", "shopware", "r1", "u1", 99, "%50\\%\\_rabatt%", "%50\\%\\_rabatt%"]);
  });
});

describe("Admin-Routen", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    registerLogRoutes(app as any);
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  afterEach(() => {
    repo.queryAppLogs.mockReset();
    repo.appLogStats.mockReset();
    vi.unstubAllEnvs();
  });

  const get = async (url: string, user = "admin", headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${url}`, { headers: { "x-test-user": user, ...headers } });
    return { status: res.status, body: await res.json() };
  };
  const row = (id: number) => ({ id, time: new Date("2026-10-06T10:00:00Z"), level: 50, area: "orders", component: "http", msg: "m", tenantId: "tenant-a", userId: null, userName: null, requestId: null, data: null });

  it("nur Administratoren (Altrolle admin oder Rolle Administrator), nicht Verwaltungsrechte", async () => {
    repo.queryAppLogs.mockResolvedValue([]);
    repo.appLogStats.mockResolvedValue([]);
    expect(await get("/api/admin/logs", "mitarbeiter")).toEqual({ status: 403, body: { error: "Nur für Administratoren" } });
    expect((await get("/api/admin/logs/stats", "mitarbeiter")).status).toBe(403);
    expect(repo.queryAppLogs).not.toHaveBeenCalled();
    expect((await get("/api/admin/logs", "admin")).status).toBe(200);
    expect((await get("/api/admin/logs", "rolle")).status).toBe(200);
  });

  it("Eintraege mit Stufenname und Blaettern; Mandant aus der Anmeldung", async () => {
    repo.queryAppLogs.mockResolvedValue([row(9), row(8)]);
    const { body } = await get("/api/admin/logs?limit=2&level=error&areas=orders,quatsch&q=%20Bestellung%20&system=0");
    expect(body.entries.map((e: any) => [e.id, e.levelName, e.time])).toEqual([
      [9, "error", "2026-10-06T10:00:00.000Z"],
      [8, "error", "2026-10-06T10:00:00.000Z"],
    ]);
    expect(body.nextBefore).toBe(8);
    expect(body.retentionDays).toBe(14);
    expect(repo.queryAppLogs.mock.calls[0][0]).toMatchObject({
      tenantId: "tenant-a",
      includeSystem: false,
      minLevel: 50,
      areas: ["orders"],
      q: "Bestellung",
      limit: 2,
    });
    repo.queryAppLogs.mockResolvedValue([row(7)]);
    expect((await get("/api/admin/logs?limit=2&before=8")).body.nextBefore).toBeNull();
    expect(repo.queryAppLogs.mock.calls[1][0]).toMatchObject({ beforeId: 8, includeSystem: true, minLevel: 30 });
    await get("/api/admin/logs", "admin", { "x-test-tenant": "none" });
    expect(repo.queryAppLogs.mock.calls[2][0].tenantId).toBeNull();
  });

  it("Zaehlung je Bereich: Fehler zuerst, Summen, unbekannte Bereiche weg", async () => {
    repo.appLogStats.mockResolvedValue([
      { area: "system", warn: 5, error: 0 },
      { area: "shopware", warn: 6, error: 8 },
      { area: "orders", warn: 0, error: 1 },
      { area: "alt", warn: 3, error: 3 },
    ]);
    const { body } = await get("/api/admin/logs/stats?hours=48");
    expect(body.areas.map((a: any) => a.area)).toEqual(["shopware", "orders", "system"]);
    expect(body.totals).toEqual({ warn: 11, error: 9 });
    const since = repo.appLogStats.mock.calls[0][0].since as Date;
    expect(Date.now() - since.getTime()).toBeGreaterThan(47.9 * 3600_000);
  });

  it("Zeitraum: hoechstens die Aufbewahrungsfrist, from/to vor hours, Grenzen fuer limit und Texte", () => {
    const now = Date.now();
    const hoursAgo = (q: ReturnType<typeof parseLogQuery>) => Math.round((now - q.from.getTime()) / 3600_000);
    expect(hoursAgo(parseLogQuery({}, "t"))).toBe(24);
    expect(hoursAgo(parseLogQuery({ hours: "9999" }, "t"))).toBe(14 * 24);
    vi.stubEnv("LOG_STORE_DAYS", "30");
    expect(hoursAgo(parseLogQuery({ hours: "9999" }, "t"))).toBe(30 * 24);
    const fixed = parseLogQuery({ from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z", hours: "1" }, "t");
    expect([fixed.from.toISOString(), fixed.to?.toISOString()]).toEqual(["2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"]);
    expect(parseLogQuery({ limit: "100000" }, "t").limit).toBe(500);
    expect(parseLogQuery({ limit: "-3" }, "t").limit).toBe(200);
    expect(parseLogQuery({ level: "fatal" }, "t").minLevel).toBe(LOG_LEVELS.info);
    expect(parseLogQuery({ q: "x".repeat(500) }, "t").q).toHaveLength(200);
    expect(parseLogQuery({ q: "   " }, "t").q).toBeUndefined();
    expect(parseLogQuery({ before: "abc" }, "t").beforeId).toBeUndefined();
  });
});

describe("Einbindung", () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

  it("Route, Menue nur fuer Admins, Rollenname in /api/auth/me, Start im Server", () => {
    expect(read("client/src/App.tsx")).toMatch(/<Route path="\/admin\/logs" component=\{SystemLogPage\} \/>/);
    expect(read("client/src/App.tsx")).toMatch(/isAdmin=\{user\.role === "admin" \|\| user\.roleName === "Administrator"\}/);
    const sidebar = read("client/src/components/AppSidebar.tsx");
    expect(sidebar).toMatch(/url: "\/admin\/logs",[\s\S]{0,80}adminOnly: true/);
    expect(sidebar).toMatch(/item\.adminOnly\s*\?\s*isAdmin/);
    expect(read("server/routes/authRoutes.ts")).toMatch(/roleName: roleDetails\?\.name \?\? null/);
    expect(read("server/routes.ts")).toMatch(/registerLogRoutes\(app\)/);
    const index = read("server/index.ts");
    expect(index).toMatch(/await ensureVectorExtension\(\);\s*startSystemLog\(\);/);
    expect(index).toMatch(/sink\.start\(insertAppLogs\)/);
    expect(read("migrations/0044_app_logs.sql")).toMatch(/CREATE TABLE IF NOT EXISTS app_logs/);
  });
});
