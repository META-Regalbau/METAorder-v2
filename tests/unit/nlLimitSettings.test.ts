/**
 * Limit "Natuerliche Sprache" in den KI-Einstellungen: GET liefert die geltenden Werte (Standard,
 * wenn nicht gesetzt), POST speichert sie in openai_settings; ohne Angabe bleibt der alte Wert,
 * ungueltige Werte werden abgelehnt. Echte Route; Anmeldung und Speicher sind gemockt.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const settings = vi.hoisted(() => new Map<string, any>());

vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = { id: "u1" };
    req.tenantId = "tenant-a";
    next();
  };
  return { ...actual, requireAuth: pass, requireManageSettings: pass, requireCsrf: pass };
});

import { storage } from "../../server/storage";
import { registerSettingsRoutes } from "../../server/routes/settingsRoutes";

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getSetting").mockImplementation(async (key: string) => settings.get(key));
  vi.spyOn(storage, "saveSetting").mockImplementation(async (key: string, value: any) => {
    settings.set(key, value);
    return value;
  });
  const app = express();
  app.use(express.json());
  registerSettingsRoutes(app as any);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => settings.clear());

const get = async () => (await fetch(`${base}/api/settings/ai`)).json();
const post = async (body: Record<string, unknown>) => {
  const res = await fetch(`${base}/api/settings/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, ...body }) });
  return res.status;
};

describe("KI-Einstellungen: Limit Natürliche Sprache", () => {
  it("ohne Eintrag: Standard 30 / 300", async () => {
    expect(await get()).toMatchObject({ nlDailyLimitPerUser: 30, nlDailyLimitPerTenant: 300 });
  });

  it("speichern und wieder lesen; ohne Angabe bleibt der alte Wert", async () => {
    expect(await post({ nlDailyLimitPerUser: 12, nlDailyLimitPerTenant: 120 })).toBe(200);
    expect(settings.get("openai_settings")).toMatchObject({ nlDailyLimitPerUser: 12, nlDailyLimitPerTenant: 120 });
    expect(await get()).toMatchObject({ nlDailyLimitPerUser: 12, nlDailyLimitPerTenant: 120 });
    expect(await post({ chatProvider: "anthropic" })).toBe(200);
    expect(settings.get("openai_settings")).toMatchObject({ nlDailyLimitPerUser: 12, nlDailyLimitPerTenant: 120 });
  });

  it("0 sperrt (erlaubt), ungueltige Werte werden abgelehnt", async () => {
    expect(await post({ nlDailyLimitPerUser: 0 })).toBe(200);
    expect(await get()).toMatchObject({ nlDailyLimitPerUser: 0 });
    for (const bad of [-1, 2.5, 10_001, "20"]) expect(await post({ nlDailyLimitPerUser: bad }), String(bad)).toBe(400);
  });
});
