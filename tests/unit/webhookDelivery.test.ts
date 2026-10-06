/**
 * Webhook-Zustellung mit Ergebnis (deliver) und API-Key-Header – Unit-Tests.
 * Ausführung: npm test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configs: any[] = [];
const logs: any[] = [];

vi.mock("../../server/storage", () => ({
  storage: {
    getAllWebhookConfigs: async () => configs,
    createWebhookLog: async (log: any) => {
      logs.push(log);
      return log;
    },
  },
}));

const { webhookService } = await import("../../server/lib/webhookService");

const PAYLOAD = {
  to: "einkauf@haendler.de",
  subject: "Passwort",
  text: "Passwort: Abcdefgh2345",
  html: "<p>Passwort: Abcdefgh2345</p>",
  customerNumber: "10012345",
  employeeId: "e1",
  customerId: "c1",
  requestedAt: "2026-10-06T12:00:00.000Z",
};

function setConfig(overrides: Record<string, unknown> = {}) {
  configs.length = 0;
  configs.push({
    eventType: "b2b.portal_password_requested",
    targetUrl: "https://n8n.example.com/webhook/metaorder-portal-password",
    enabled: 1,
    secret: null,
    apiKey: "geheimer-key",
    maxAttempts: 1,
    initialBackoffMs: 1,
    backoffFactor: 1,
    timeoutMs: 1000,
    ...overrides,
  });
  webhookService.invalidateCache();
}

describe("webhookService.deliver", () => {
  beforeEach(() => {
    logs.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("schickt den API-Key als X-API-Key und meldet delivered", async () => {
    setConfig();
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await webhookService.isEnabled("b2b.portal_password_requested")).toBe(true);
    const result = await webhookService.deliver("b2b.portal_password_requested", PAYLOAD);

    expect(result).toBe("delivered");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://n8n.example.com/webhook/metaorder-portal-password");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("geheimer-key");
    expect(JSON.parse(String(init.body)).data.to).toBe("einkauf@haendler.de");
  });

  it("speichert das Passwort nicht im Webhook-Log", async () => {
    setConfig();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    await webhookService.deliver("b2b.portal_password_requested", PAYLOAD);
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0])).not.toContain("Abcdefgh2345");
  });

  it("meldet failed bei Fehlerantwort und not_configured ohne aktiven Webhook", async () => {
    setConfig();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await webhookService.deliver("b2b.portal_password_requested", PAYLOAD)).toBe("failed");

    setConfig({ enabled: 0 });
    expect(await webhookService.isEnabled("b2b.portal_password_requested")).toBe(false);
    expect(await webhookService.deliver("b2b.portal_password_requested", PAYLOAD)).toBe("not_configured");
  });

  it("ohne API-Key wird kein X-API-Key-Header gesendet", async () => {
    setConfig({ apiKey: null });
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await webhookService.deliver("b2b.portal_password_requested", PAYLOAD);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBeUndefined();
  });
});
