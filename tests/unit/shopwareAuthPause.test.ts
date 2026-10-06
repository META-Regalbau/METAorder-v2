/**
 * Abgelehnte Shopware-Zugangsdaten: in Produktion versuchte der Abgleich eines Mandanten (Testshop) alle
 * 3 Minuten erneut, obwohl Shopware die Zugangsdaten ablehnte (401 "Client authentication failed") -
 * Shopware drosselte daraufhin (429), ~600 Fehlerzeilen in 7,5 Stunden. Jetzt: Anmeldung mit diesen
 * Zugangsdaten pausiert (6 h), Aufrufe scheitern sofort ohne Anfrage; neue Zugangsdaten, "Verbindung
 * testen" und Speichern versuchen sofort; Drosselung: Pause so lange wie angegeben; der Abgleich loggt
 * die Pause einmal statt bei jedem Lauf. Gegen ein simuliertes Shopware.
 * Ausführung: npm test
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const shop = vi.hoisted(() => ({
  mode: "reject" as "reject" | "throttle" | "ok" | "down",
  tokenRequests: 0,
}));

vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = { id: "admin" };
    next();
  };
  return { ...actual, requireAuth: pass, requireManageSettings: pass };
});

import {
  clearShopwareAuthPause,
  getSharedShopwareToken,
  isShopwareAuthPaused,
  REJECTED_PAUSE_MS,
  resetShopwareTokenCacheForTests,
  ShopwareAuthPausedError,
} from "../../server/shopware/shopwareTokenCache";
import { ShopwareClient } from "../../server/shopware/shopware";
import { B2BSellersClient } from "../../server/b2b/b2bSellersClient";
import { logSyncFailure } from "../../server/shopware/shopwareMirror";
import { createLogger, setLoggerForTests } from "../../server/lib/logger";
import { storage } from "../../server/storage";

const BASE = "https://test-shop.invalid";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const realFetch = globalThis.fetch;

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    if (String(url).startsWith("http://127.0.0.1")) return realFetch(url, init);
    const path = new URL(String(url)).pathname;
    if (path === "/api/oauth/token") {
      shop.tokenRequests += 1;
      if (shop.mode === "reject") return json({ errors: [{ code: "4", status: "401", title: "Unauthorized", detail: "Client authentication failed" }] }, 401);
      if (shop.mode === "throttle") return json({ errors: [{ status: "429", code: "FRAMEWORK__NOTIFICATION_THROTTLED", detail: "Notification throttled for 120 seconds." }] }, 429);
      if (shop.mode === "down") return json({ errors: [{ status: "503" }] }, 503);
      return json({ access_token: "tok", expires_in: 600, token_type: "Bearer" });
    }
    return json({ data: [], total: 0 });
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  resetShopwareTokenCacheForTests();
  shop.mode = "reject";
  shop.tokenRequests = 0;
});
afterEach(() => vi.useRealTimers());

const token = (secret = "s") => getSharedShopwareToken(BASE, "k", secret);

describe("Anmeldung an Shopware pausieren", () => {
  it("abgelehnt (401): eine Anfrage, danach scheitern alle Aufrufer sofort mit klarer Meldung", async () => {
    await expect(token()).rejects.toBeInstanceOf(ShopwareAuthPausedError);
    await expect(token()).rejects.toMatchObject({ reason: "rejected", code: "shopware_auth_paused" });
    const client = new ShopwareClient({ shopwareUrl: BASE, apiKey: "k", apiSecret: "s" } as any);
    await expect(client.authenticate()).rejects.toThrow(/Shopware lehnt die Zugangsdaten ab \(test-shop.invalid\) – Anmeldung pausiert bis/);
    await expect(new B2BSellersClient({ shopwareUrl: BASE, apiKey: "k", apiSecret: "s" } as any).fetchOffers({ page: 1, limit: 1 })).rejects.toSatisfy(isShopwareAuthPaused);
    expect(shop.tokenRequests).toBe(1);
  });

  it("nach der Pause (6 h) ein neuer Versuch; gelingt er, ist die Pause weg", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await expect(token()).rejects.toBeInstanceOf(ShopwareAuthPausedError);
    vi.setSystemTime(Date.now() + REJECTED_PAUSE_MS - 1000);
    await expect(token()).rejects.toBeInstanceOf(ShopwareAuthPausedError);
    expect(shop.tokenRequests).toBe(1);
    vi.setSystemTime(Date.now() + 2000);
    shop.mode = "ok";
    await expect(token()).resolves.toMatchObject({ token: "tok" });
    expect(shop.tokenRequests).toBe(2);
  });

  it("neue Zugangsdaten werden sofort versucht; 'Verbindung testen'/Speichern heben die Pause auf", async () => {
    await expect(token("alt")).rejects.toBeInstanceOf(ShopwareAuthPausedError);
    shop.mode = "ok";
    await expect(token("neu")).resolves.toMatchObject({ token: "tok" });
    await expect(token("alt")).rejects.toBeInstanceOf(ShopwareAuthPausedError);
    clearShopwareAuthPause(BASE, "k", "alt");
    await expect(token("alt")).resolves.toMatchObject({ token: "tok" });
    expect(shop.tokenRequests).toBe(3);
  });

  it("Drosselung (429): Pause so lange wie angegeben (120 s), dann wieder", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    shop.mode = "throttle";
    await expect(token()).rejects.toMatchObject({ reason: "throttled" });
    vi.setSystemTime(Date.now() + 119_000);
    await expect(token()).rejects.toMatchObject({ reason: "throttled" });
    expect(shop.tokenRequests).toBe(1);
    vi.setSystemTime(Date.now() + 2_000);
    shop.mode = "ok";
    await expect(token()).resolves.toMatchObject({ token: "tok" });
  });

  it("Shopware gestoert (503): keine Pause, naechster Aufruf versucht es wieder", async () => {
    shop.mode = "down";
    await expect(token()).rejects.toThrow(/Authentication failed: 503/);
    await expect(token()).rejects.not.toBeInstanceOf(ShopwareAuthPausedError);
    expect(shop.tokenRequests).toBe(2);
  });
});

describe("Abgleich loggt die Pause einmal", () => {
  it("gleiche Pause: eine Warnung statt eines Fehlers je Lauf; andere Fehler weiter als Fehler", () => {
    const lines: Array<{ level: string; msg: string }> = [];
    setLoggerForTests(createLogger({ level: "info", format: "json", destination: { write: (s: string) => void lines.push(JSON.parse(s)) } }));
    try {
      const paused = new ShopwareAuthPausedError("test-shop.invalid", "rejected", Date.now() + 1000);
      for (let i = 0; i < 5; i++) logSyncFailure("t1", paused, "Sync failed");
      logSyncFailure("t2", paused, "Sync failed");
      logSyncFailure("t1", new Error("Shopware weg"), "Sync failed for tenant t1");
      expect(lines.map((l) => l.level)).toEqual(["warn", "warn", "error"]);
      expect(lines[0].msg).toMatch(/Abgleich pausiert \(tenant=t1\): Shopware lehnt die Zugangsdaten ab/);
    } finally {
      setLoggerForTests(null);
    }
  });
});

describe("Einstellungen: Verbindung testen", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: BASE, apiKey: "k", apiSecret: "s" } as any);
    const { registerSettingsRoutes } = await import("../../server/routes/settingsRoutes");
    const app = express();
    app.use(express.json());
    registerSettingsRoutes(app as any);
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("prueft pausierte Zugangsdaten wirklich (nach Freischalten in Shopware sofort gruen)", async () => {
    await expect(token()).rejects.toBeInstanceOf(ShopwareAuthPausedError);
    shop.mode = "ok";
    const res = await fetch(`${base}/api/settings/shopware/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopwareUrl: BASE, apiKey: "k" }),
    });
    expect(await res.json()).toMatchObject({ success: true });
    expect(shop.tokenRequests).toBe(2);
  });
});
