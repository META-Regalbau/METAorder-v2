/**
 * Logging: Request-ID-Kontext, zentraler Logger (pino), console-Bruecke, Request-Log und Fehler-Handler.
 * Ausführung: npm test
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createLogger, setLoggerForTests } from "../../server/lib/logger";
import { installConsoleBridge, uninstallConsoleBridge } from "../../server/lib/consoleBridge";
import { getRequestId, requestIdMiddleware, resolveRequestId, runWithRequestId } from "../../server/lib/requestContext";
import { getTenantIdFromContext, restoreTenantContext, runWithTenantContext } from "../../server/lib/tenantContext";
import { errorHandler, requestLoggingMiddleware } from "../../server/lib/httpLogging";

/** Logger, der JSON-Zeilen in ein Array schreibt. */
function memoryLogger(level = "trace") {
  const lines: Record<string, any>[] = [];
  const raw: string[] = [];
  const log = createLogger({
    level,
    format: "json",
    destination: { write: (chunk: string) => { raw.push(chunk); lines.push(JSON.parse(chunk)); } },
  });
  return { log, lines, raw };
}

describe("requestContext", () => {
  it("uebernimmt eine gueltige mitgeschickte Request-ID", () => {
    expect(resolveRequestId("proxy-req-12345678")).toBe("proxy-req-12345678");
  });

  it("erzeugt eine neue ID bei fehlender, zu kurzer oder manipulierter Angabe", () => {
    const uuid = /^[0-9a-f-]{36}$/;
    expect(resolveRequestId(undefined)).toMatch(uuid);
    expect(resolveRequestId("abc")).toMatch(uuid);
    expect(resolveRequestId('x12345678\n{"level":"fatal"}')).toMatch(uuid);
    expect(resolveRequestId(["a", "b"])).toMatch(uuid);
  });

  it("setzt ID am Request, im Antwort-Header und im Kontext", () => {
    const req: { headers: Record<string, unknown>; requestId?: string } = { headers: {} };
    const headers: Record<string, string> = {};
    let inside: string | null = null;
    requestIdMiddleware(req, { setHeader: (n, v) => (headers[n] = v) }, () => { inside = getRequestId(); });
    expect(req.requestId).toBeTruthy();
    expect(headers["X-Request-Id"]).toBe(req.requestId);
    expect(inside).toBe(req.requestId);
    expect(getRequestId()).toBeNull();
  });

  it("restoreTenantContext stellt nach multer Mandant UND Request-ID wieder her", () => {
    let seen: [string | null, string | null] = [null, null];
    restoreTenantContext({ tenantId: "tenant-1", requestId: "req-12345678" }, {}, () => {
      seen = [getTenantIdFromContext(), getRequestId()];
    });
    expect(seen).toEqual(["tenant-1", "req-12345678"]);
  });
});

describe("logger", () => {
  it("schreibt JSON mit Text-Level, ISO-Zeit und Nachricht", () => {
    const { log, lines } = memoryLogger();
    log.info({ orderId: "o1" }, "Bestellung angelegt");
    expect(lines[0]).toMatchObject({ level: "info", msg: "Bestellung angelegt", orderId: "o1" });
    expect(new Date(lines[0].time).toISOString()).toBe(lines[0].time);
    expect(lines[0]).not.toHaveProperty("pid");
  });

  it("haengt requestId und tenantId aus dem Kontext an", () => {
    const { log, lines } = memoryLogger();
    runWithRequestId("req-12345678", () => runWithTenantContext("tenant-9", () => log.info("im Kontext")));
    log.info("ohne Kontext");
    expect(lines[0]).toMatchObject({ requestId: "req-12345678", tenantId: "tenant-9" });
    expect(lines[1]).not.toHaveProperty("requestId");
    expect(lines[1]).not.toHaveProperty("tenantId");
  });

  it("Kind-Logger mit gebundenem tenantId: Feld nur einmal, Kontext ergaenzt den Rest", () => {
    const { log, raw, lines } = memoryLogger();
    runWithRequestId("req-12345678", () =>
      runWithTenantContext("tenant-kontext", () => log.child({ tenantId: "tenant-gebunden", component: "x" }).info("gebunden")),
    );
    expect(raw[0].match(/"tenantId"/g)).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tenantId: "tenant-gebunden", requestId: "req-12345678", component: "x" });
  });

  it("schwaerzt Passwoerter, Tokens und Secrets in Feldern", () => {
    const { log, raw } = memoryLogger();
    log.info({ password: "pw1", user: { password: "pw2", apiSecret: "s3", token: "t4" }, headers: { authorization: "Bearer x" } }, "Login");
    expect(raw[0]).not.toMatch(/pw1|pw2|s3|t4|Bearer x/);
    expect(raw[0]).toContain("[REDACTED]");
  });

  it("filtert nach LOG_LEVEL", () => {
    const { log, lines } = memoryLogger("warn");
    log.info("leise");
    log.warn("laut");
    expect(lines.map((l) => l.msg)).toEqual(["laut"]);
  });
});

describe("consoleBridge", () => {
  let mem: ReturnType<typeof memoryLogger>;
  beforeEach(() => {
    mem = memoryLogger();
    installConsoleBridge(() => mem.log);
  });
  afterEach(() => uninstallConsoleBridge());

  it("console.error mit Fehlerobjekt: Text mit Meldung, Fehler als Feld samt Stacktrace", () => {
    console.error("[DunningJob] Run failed:", new Error("boom"));
    expect(mem.lines[0]).toMatchObject({ level: "error", msg: "[DunningJob] Run failed: boom" });
    expect(mem.lines[0].err.message).toBe("boom");
    expect(mem.lines[0].err.stack).toContain("boom");
  });

  it("formatiert wie console (Platzhalter, Objekte) und interpoliert nicht doppelt", () => {
    console.log("a %s %d", "b", 3);
    console.warn("Objekt:", { a: 1 });
    console.log("100%s Rabatt");
    expect(mem.lines.map((l) => [l.level, l.msg])).toEqual([
      ["info", "a b 3"],
      ["warn", "Objekt: { a: 1 }"],
      ["info", "100%s Rabatt"],
    ]);
  });

  it("traegt die requestId der laufenden Anfrage ein", () => {
    runWithRequestId("req-abcdef12", () => console.log("in der Anfrage"));
    expect(mem.lines[0].requestId).toBe("req-abcdef12");
  });

  it("stellt console beim Deinstallieren wieder her", () => {
    const bridged = console.log;
    uninstallConsoleBridge();
    expect(console.log).not.toBe(bridged);
    installConsoleBridge(() => mem.log);
  });
});

describe("Request-Log und Fehler-Handler (echte Express-App)", () => {
  let mem: ReturnType<typeof memoryLogger>;
  let base: string;
  let close: () => Promise<void>;
  const metrics: Array<{ route: string; statusCode: number }> = [];
  const oldSlow = process.env.REQUEST_LOG_SLOW_MS;

  beforeEach(async () => {
    mem = memoryLogger();
    setLoggerForTests(mem.log);
    metrics.length = 0;
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    app.use(requestLoggingMiddleware((m) => metrics.push(m)));
    app.post("/api/auth/login", (_req, res) => res.json({ ok: true }));
    app.get("/api/ok", (_req, res) => res.json({ kunde: "Max Mustermann", email: "max@example.com" }));
    app.get("/api/boom", () => { throw new Error("kaputt"); });
    app.get("/api/bad", () => { throw Object.assign(new Error("nope"), { status: 400 }); });
    app.get("/api/slow", (_req, res) => setTimeout(() => res.json({ ok: true }), 15));
    app.get("/static/x", (_req, res) => res.send("x"));
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });
  afterEach(async () => {
    await close();
    setLoggerForTests(null);
    if (oldSlow === undefined) delete process.env.REQUEST_LOG_SLOW_MS; else process.env.REQUEST_LOG_SLOW_MS = oldSlow;
  });
  const flush = () => new Promise((r) => setTimeout(r, 20));

  it("loggt Methode, Pfad, Status, Dauer und requestId - aber nicht den Antwort-Inhalt", async () => {
    const res = await fetch(`${base}/api/ok`);
    await res.json();
    await flush();
    const rid = res.headers.get("x-request-id");
    expect(rid).toBeTruthy();
    const entry = mem.lines.find((l) => l.path === "/api/ok");
    expect(entry).toMatchObject({ level: "info", method: "GET", status: 200, requestId: rid });
    expect(entry!.msg).toMatch(/^GET \/api\/ok 200 in \d+ms$/);
    expect(typeof entry!.durationMs).toBe("number");
    expect(JSON.stringify(mem.lines)).not.toMatch(/Mustermann|max@example\.com/);
    expect(metrics).toEqual([expect.objectContaining({ route: "/api/ok", method: "GET", statusCode: 200 })]);
  });

  it("uebernimmt eine gueltige X-Request-Id vom Aufrufer", async () => {
    const res = await fetch(`${base}/api/ok`, { headers: { "X-Request-Id": "caller-req-0001" } });
    await res.text();
    await flush();
    expect(res.headers.get("x-request-id")).toBe("caller-req-0001");
    expect(mem.lines.find((l) => l.path === "/api/ok")?.requestId).toBe("caller-req-0001");
  });

  it("Fehler 500: Antwort { message } wie bisher, Log mit Stacktrace und requestId", async () => {
    const res = await fetch(`${base}/api/boom`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "kaputt" });
    await flush();
    const err = mem.lines.find((l) => l.level === "error");
    expect(err).toMatchObject({ requestId: res.headers.get("x-request-id"), status: 500, path: "/api/boom" });
    expect(err!.err.stack).toContain("kaputt");
  });

  it("Fehler 4xx wird als Warnung geloggt", async () => {
    const res = await fetch(`${base}/api/bad`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "nope" });
    await flush();
    expect(mem.lines.find((l) => l.path === "/api/bad" && l.err)).toMatchObject({ level: "warn", status: 400 });
  });

  it("kaputtes JSON beim Login: 400, und das Passwort aus dem Rohtext landet nicht im Log", async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"username":"max","password":"geheim123",',
    });
    expect(res.status).toBe(400);
    await res.text();
    await flush();
    expect(mem.lines.some((l) => l.err && l.status === 400)).toBe(true);
    expect(mem.raw.join("")).not.toContain("geheim123");
  });

  it("langsame Anfragen zusaetzlich als [slow-request]-Warnung (REQUEST_LOG_SLOW_MS)", async () => {
    process.env.REQUEST_LOG_SLOW_MS = "5";
    await (await fetch(`${base}/api/slow`)).json();
    await flush();
    const slow = mem.lines.find((l) => l.slow === true);
    expect(slow).toMatchObject({ level: "warn", path: "/api/slow" });
    expect(slow!.msg).toMatch(/^\[slow-request\] \d+ms GET \/api\/slow 200$/);
  });

  it("loggt nur /api-Pfade", async () => {
    await (await fetch(`${base}/static/x`)).text();
    await flush();
    expect(mem.lines.filter((l) => l.path === "/static/x")).toHaveLength(0);
  });
});
