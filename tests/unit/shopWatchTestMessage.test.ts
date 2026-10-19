/**
 * Shop-Wächter: Knopf „Testnachricht an Teams“ (POST /api/shop-content/watch/test-message). Geprüft:
 * Karte als Test gekennzeichnet und landet in der Warteschlange, die n8n abholt; Webhook wie beim
 * Zeitplan (E-Mail-Eingang oder Direktnachricht des Shop-Puls); ohne Webhook 400 mit Fehlercode aus
 * dem Katalog. Echte Route; Anmeldung und Settings (Speicher) sind gemockt.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import de from "../../client/src/i18n/locales/de.json";
import en from "../../client/src/i18n/locales/en.json";
import es from "../../client/src/i18n/locales/es.json";

vi.mock("../../server/auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/auth/auth")>();
  const pass = (req: any, _res: any, next: () => void) => {
    req.user = { id: "u1", username: "pruefer" };
    req.tenantId = "tenant-a";
    next();
  };
  return { ...actual, requireAuth: pass, requireAdministrator: pass, requireCsrf: (_req: any, _res: any, next: () => void) => next() };
});

import { storage } from "../../server/storage";
import { registerShopWatchRoutes } from "../../server/routes/shopWatchRoutes";
import { buildShopWatchTestTeamsMessage, SHOP_WATCH_TEAMS_OUTBOX_KEY } from "../../server/shopContent/shopWatchNotify";

const settings = new Map<string, any>();
const keyOf = (key: string, tenantId?: string | null) => `${tenantId ?? ""}|${key}`;

let server: Server;
let base = "";
beforeAll(async () => {
  vi.spyOn(storage, "getSetting").mockImplementation(async (key: string, tenantId?: string | null) => settings.get(keyOf(key, tenantId)));
  vi.spyOn(storage, "saveSetting").mockImplementation(async (key: string, value: any, tenantId?: string | null) => {
    settings.set(keyOf(key, tenantId), structuredClone(value));
    return value;
  });
  const app = express();
  app.use(express.json());
  registerShopWatchRoutes(app as any);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => settings.clear());

const post = async () => {
  const res = await fetch(`${base}/api/shop-content/watch/test-message`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  return { status: res.status, body: (await res.json()) as any };
};
const outbox = () => (settings.get(keyOf(SHOP_WATCH_TEAMS_OUTBOX_KEY, "tenant-a"))?.items ?? []) as Array<{ message: any }>;
const cardText = (message: any) => JSON.stringify(message.attachments[0].content.body);

describe("Testnachricht an Teams (Shop-Wächter)", () => {
  it("legt eine als Test gekennzeichnete Karte in die Warteschlange (Webhook aus dem E-Mail-Eingang)", async () => {
    settings.set(keyOf("email_intake_settings", "tenant-a"), { teamsWebhookUrl: "https://prod-01.westeurope.logic.azure.com/workflows/abc" });
    const first = await post();
    expect(first).toEqual({ status: 200, body: { queued: true, teamsPending: 1 } });
    const second = await post();
    expect(second.body.teamsPending).toBe(2);

    const items = outbox();
    expect(items).toHaveLength(2);
    expect(items[0].message.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(cardText(items[0].message)).toContain("TEST");
    expect(cardText(items[0].message)).toContain("pruefer");

  });

  it("nimmt die Direktnachricht des Shop-Puls, wenn dort eingestellt", async () => {
    settings.set(keyOf("shop_pulse_settings", "tenant-a"), { teamsWebhookUrl: "https://prod-02.westeurope.logic.azure.com/workflows/direct", shopWatchDirect: true });
    expect((await post()).status).toBe(200);
    expect(outbox()).toHaveLength(1);
  });

  it("ohne Webhook: 400 mit Fehlercode, nichts in der Warteschlange", async () => {
    const res = await post();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("shop_watch_teams_webhook_missing");
    expect(outbox()).toHaveLength(0);
    for (const locale of [de, en, es] as any[]) expect(typeof locale.apiErrors.codes.shop_watch_teams_webhook_missing).toBe("string");
  });
});

describe("Aufbau der Testkarte", () => {
  const now = new Date("2026-10-19T08:30:00Z");

  it("Titel als Test, Zeit in Berlin, Link zur Wächter-Seite", () => {
    const msg = buildShopWatchTestTeamsMessage({ baseUrl: "https://app.example/", requestedBy: "admin", now }) as any;
    const content = msg.attachments[0].content;
    expect(content.body[0].text).toMatch(/^🧪 TEST/);
    expect(JSON.stringify(content.body)).toContain("19.10.2026, 10:30");
    expect(content.actions).toEqual([{ type: "Action.OpenUrl", title: "Shop-Wächter öffnen", url: "https://app.example/admin/shop-waechter" }]);
  });

  it("ohne Basis-Adresse kein Link; Benutzername ohne Markdown", () => {
    const msg = buildShopWatchTestTeamsMessage({ baseUrl: null, requestedBy: "*fett*<b>", now }) as any;
    const content = msg.attachments[0].content;
    expect(content.actions ?? []).toEqual([]);
    expect(JSON.stringify(content.body)).not.toMatch(/[*<>]/);
  });
});
