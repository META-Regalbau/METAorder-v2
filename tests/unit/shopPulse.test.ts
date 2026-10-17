/**
 * Shop-Puls (PR A): aus Funden Meldungen machen (neu, wieder offen, erledigt, Lernwoche, ruhig gestellt),
 * Einstellungen und Lernwoche, Prüfung Spiegel-Frische, Tagesbericht-Zeitpunkt, Teams-Karten, Weg der
 * Wächter-Meldungen, n8n-Vorlage und ein Lauf mit simulierter Datenbank.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";

vi.mock("../../server/db", () => ({ db: {} }));

import { reconcileSignals, dailyReportSignals, type ReconcileResult } from "../../server/shopPulse/shopPulseSignals";
import {
  applyShopPulseSettingsUpdate,
  getShopPulseState,
  SHOP_PULSE_SETTINGS_KEY,
  SHOP_PULSE_TEAMS_OUTBOX_KEY,
  shopWatchTeamsWebhookUrl,
} from "../../server/shopPulse/shopPulseSettings";
import { mirrorFreshnessDetections } from "../../server/shopPulse/detectors/mirrorFreshness";
import { isDailyReportDue, runShopPulseForTenant, type ShopPulseDeps } from "../../server/shopPulse/shopPulseScheduler";
import { buildShopPulseDailyCard, buildShopPulseNoticeCard, buildShopPulseTestCard } from "../../server/shopPulse/shopPulseNotify";
import { getTeamsOutbox } from "../../server/lib/teamsOutbox";
import { mirrorFreshnessDetector } from "../../server/shopPulse/detectors/mirrorFreshness";
import {
  DEFAULT_SHOP_PULSE_SETTINGS,
  normalizeShopPulseSettings,
  type ShopPulseDetection,
  type ShopPulseSignal,
} from "../../shared/shopPulse";
import { EMAIL_INTAKE_SETTING_KEY } from "../../shared/emailIntake";

const WEBHOOK = "https://prod-01.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x";
const NOW = new Date("2026-10-19T10:00:00Z"); // Montag, 12:00 Berlin

const detection = (over: Partial<ShopPulseDetection> = {}): ShopPulseDetection => ({
  key: "system:mirror:orders",
  source: "system",
  code: "mirrorStale",
  severity: "critical",
  params: { minutes: 42 },
  ...over,
});

const signal = (over: Partial<ShopPulseSignal> = {}): ShopPulseSignal => ({
  id: "s1",
  key: "system:mirror:orders",
  source: "system",
  code: "mirrorStale",
  severity: "critical",
  status: "open",
  params: { minutes: 31 },
  evidence: {},
  lossPerHour: null,
  firstSeenAt: "2026-10-19T09:00:00.000Z",
  lastSeenAt: "2026-10-19T09:45:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
  mutedUntil: null,
  notifiedAt: "2026-10-19T09:00:00.000Z",
  notifiedSeverity: "critical",
  ...over,
});

let ids = 0;
const opts = (over: Partial<Parameters<typeof reconcileSignals>[2]> = {}) => ({
  now: NOW,
  learning: false,
  completeSources: ["system" as const],
  newId: () => `new-${++ids}`,
  ...over,
});

describe("Funde → Meldungen", () => {
  it("neuer kritischer Fund: Meldung und Sofort-Nachricht", () => {
    const r = reconcileSignals([], [detection()], opts());
    expect(r.inserts).toHaveLength(1);
    expect(r.inserts[0]).toMatchObject({ status: "open", severity: "critical", notifiedSeverity: "critical", notifiedAt: NOW.toISOString() });
    expect(r.notices.map((n) => n.kind)).toEqual(["new"]);
  });

  it("neue Warnung: nur Tagesbericht, keine Sofort-Nachricht", () => {
    const r = reconcileSignals([], [detection({ severity: "warning" })], opts());
    expect(r.inserts[0]).toMatchObject({ notifiedSeverity: "warning", notifiedAt: null });
    expect(r.notices).toEqual([]);
  });

  it("Lernwoche: still berücksichtigt, danach nicht nachgeholt", () => {
    const first = reconcileSignals([], [detection()], opts({ learning: true }));
    expect(first.notices).toEqual([]);
    expect(first.inserts[0]).toMatchObject({ notifiedSeverity: "critical", notifiedAt: null });
    const after = reconcileSignals([first.inserts[0]], [detection()], opts());
    expect(after.notices).toEqual([]);
    expect(after.updates[0].patch).toMatchObject({ lastSeenAt: NOW.toISOString() });
  });

  it("Warnung wird kritisch: jetzt Sofort-Nachricht", () => {
    const prev = signal({ severity: "warning", notifiedSeverity: "warning", notifiedAt: null });
    const r = reconcileSignals([prev], [detection()], opts());
    expect(r.notices.map((n) => n.kind)).toEqual(["new"]);
    expect(r.updates[0].patch).toMatchObject({ severity: "critical", notifiedSeverity: "critical", notifiedAt: NOW.toISOString() });
  });

  it("offener, schon gemeldeter Fund: keine Wiederholung", () => {
    const r = reconcileSignals([signal()], [detection()], opts());
    expect(r.notices).toEqual([]);
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0].patch.params).toEqual({ minutes: 42 });
  });

  it("ruhig gestellt: keine Nachricht, auch nicht bei Entwarnung", () => {
    const muted = { mutedUntil: "2026-10-26T10:00:00.000Z" };
    expect(reconcileSignals([], [detection()], opts()).notices).toHaveLength(1);
    const prev = signal({ ...muted, severity: "warning", notifiedSeverity: "warning", notifiedAt: null });
    expect(reconcileSignals([prev], [detection()], opts()).notices).toEqual([]);
    expect(reconcileSignals([signal(muted)], [], opts()).notices).toEqual([]);
  });

  it("Fund verschwindet: erledigt, Entwarnung nur für gesendete kritische Meldungen", () => {
    const r = reconcileSignals([signal()], [], opts());
    expect(r.updates[0].patch).toMatchObject({ status: "resolved", resolvedAt: NOW.toISOString(), resolvedBy: null });
    expect(r.notices.map((n) => n.kind)).toEqual(["resolved"]);
    const silent = reconcileSignals([signal({ notifiedAt: null })], [], opts());
    expect(silent.updates[0].patch.status).toBe("resolved");
    expect(silent.notices).toEqual([]);
  });

  it("Quelle nicht vollständig geprüft: offene Meldung bleibt offen", () => {
    const r = reconcileSignals([signal()], [], opts({ completeSources: [] }));
    expect(r.updates).toEqual([]);
  });

  it("früherer Fund kommt wieder: dieselbe Zeile, wieder offen, wieder gemeldet", () => {
    const prev = signal({ status: "resolved", resolvedAt: "2026-10-18T10:00:00.000Z", resolvedBy: "oliver" });
    const r = reconcileSignals([prev], [detection()], opts());
    expect(r.inserts).toEqual([]);
    expect(r.updates[0]).toMatchObject({ id: "s1", reopen: true, patch: { status: "open", firstSeenAt: NOW.toISOString(), resolvedBy: null } });
    expect(r.notices.map((n) => n.kind)).toEqual(["new"]);
  });

  it("derselbe Schlüssel zweimal in einem Lauf: der erste zählt", () => {
    const r = reconcileSignals([], [detection(), detection({ code: "mirrorError" })], opts());
    expect(r.inserts).toHaveLength(1);
    expect(r.inserts[0].code).toBe("mirrorStale");
  });

  it("Tagesbericht: offene, nicht ruhig gestellte, kritisch zuerst", () => {
    const list = dailyReportSignals(
      [
        signal({ id: "w", severity: "warning", lossPerHour: 900 }),
        signal({ id: "c", severity: "critical" }),
        signal({ id: "m", mutedUntil: "2026-10-26T00:00:00.000Z" }),
        signal({ id: "r", status: "resolved" }),
      ],
      NOW,
    );
    expect(list.map((s) => s.id)).toEqual(["c", "w"]);
  });
});

describe("Einstellungen und Lernwoche", () => {
  it("erstes Einschalten startet die Lernwoche, erneutes nicht", () => {
    const on = applyShopPulseSettingsUpdate(DEFAULT_SHOP_PULSE_SETTINGS, { enabled: true }, NOW);
    expect(on.learningUntil).toBe("2026-10-26T10:00:00.000Z");
    const off = applyShopPulseSettingsUpdate(on, { enabled: false }, NOW);
    const later = new Date("2026-11-01T10:00:00Z");
    expect(applyShopPulseSettingsUpdate(off, { enabled: true }, later).learningUntil).toBe("2026-10-26T10:00:00.000Z");
  });

  it("Lernwoche vorzeitig beenden", () => {
    const on = applyShopPulseSettingsUpdate(DEFAULT_SHOP_PULSE_SETTINGS, { enabled: true }, NOW);
    expect(applyShopPulseSettingsUpdate(on, { endLearning: true }, new Date("2026-10-20T08:00:00Z")).learningUntil).toBe("2026-10-20T08:00:00.000Z");
  });

  it("nur Webhook-Adressen von Microsoft", () => {
    expect(normalizeShopPulseSettings({ teamsWebhookUrl: WEBHOOK }).teamsWebhookUrl).toBe(WEBHOOK);
    expect(normalizeShopPulseSettings({ teamsWebhookUrl: "https://evil.example/hook" }).teamsWebhookUrl).toBe("");
    expect(normalizeShopPulseSettings(null)).toEqual(DEFAULT_SHOP_PULSE_SETTINGS);
  });

  it("Wächter-Meldungen: Direktnachricht nur wenn eingestellt, sonst Kanal aus dem E-Mail-Eingang", async () => {
    const store = memoryStore();
    const channel = "https://x.webhook.office.com/channel";
    await store.saveSetting(EMAIL_INTAKE_SETTING_KEY, { teamsWebhookUrl: channel }, "t1");
    expect(await shopWatchTeamsWebhookUrl(store as any, "t1")).toBe(channel);
    await store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { teamsWebhookUrl: WEBHOOK, shopWatchDirect: false }, "t1");
    expect(await shopWatchTeamsWebhookUrl(store as any, "t1")).toBe(channel);
    await store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { teamsWebhookUrl: WEBHOOK, shopWatchDirect: true }, "t1");
    expect(await shopWatchTeamsWebhookUrl(store as any, "t1")).toBe(WEBHOOK);
  });
});

describe("Prüfung Spiegel-Frische", () => {
  const state = (minutesAgo: number, status = "idle", error: string | null = null) => ({
    status,
    error,
    lastDeltaAt: new Date(NOW.getTime() - minutesAgo * 60000),
    updatedAt: NOW,
  });

  it("frisch oder noch nie gelaufen: kein Fund", () => {
    expect(mirrorFreshnessDetections(state(5), NOW)).toEqual([]);
    expect(mirrorFreshnessDetections(undefined, NOW)).toEqual([]);
    expect(mirrorFreshnessDetections(state(29, "error", "boom"), NOW)).toEqual([]);
  });

  it("ab 30 Minuten: hängt bzw. schlägt fehl (mit Fehlertext)", () => {
    expect(mirrorFreshnessDetections(state(31), NOW)).toEqual([expect.objectContaining({ code: "mirrorStale", severity: "critical", params: { minutes: 31, error: "" } })]);
    expect(mirrorFreshnessDetections(state(45, "error", "Failed to authenticate"), NOW)[0]).toMatchObject({ code: "mirrorError", params: { error: "Failed to authenticate" } });
  });
});

describe("Tagesbericht-Zeitpunkt", () => {
  it("Montag bis Samstag 8–12 Uhr Berlin, einmal je Tag", () => {
    expect(isDailyReportDue({}, new Date("2026-10-19T05:59:00Z"))).toBe(false); // 7:59
    expect(isDailyReportDue({}, new Date("2026-10-19T06:00:00Z"))).toBe(true); // 8:00
    expect(isDailyReportDue({ lastDailyReportDay: "2026-10-19" }, new Date("2026-10-19T07:00:00Z"))).toBe(false);
    expect(isDailyReportDue({}, new Date("2026-10-19T10:00:00Z"))).toBe(false); // 12:00
    expect(isDailyReportDue({}, new Date("2026-10-18T07:00:00Z"))).toBe(false); // Sonntag
    expect(isDailyReportDue({}, new Date("2026-10-24T07:00:00Z"))).toBe(true); // Samstag
  });
});

describe("Teams-Karten", () => {
  const body = (m: any) => m.attachments[0].content.body as Array<{ text?: string }>;
  const actions = (m: any) => (m.attachments[0].content.actions ?? []) as Array<{ title: string; url: string }>;

  it("Sofort-Meldung mit Text aus dem Katalog, Links auf die Meldung und zum Ruhigstellen", () => {
    const card = buildShopPulseNoticeCard({ kind: "new", signal: signal({ lossPerHour: 400 }) }, "https://app.example/");
    expect(body(card)[0].text).toBe("🔴 Bestellabgleich mit dem Shop hängt");
    expect(body(card)[1].text).toContain("31 Minuten");
    expect(JSON.stringify(card)).toContain("rund 400");
    expect(actions(card)).toEqual([
      { type: "Action.OpenUrl", title: "In METAorder öffnen", url: "https://app.example/admin/shop-puls?signal=s1" },
      { type: "Action.OpenUrl", title: "7 Tage ruhig stellen", url: "https://app.example/admin/shop-puls?signal=s1&action=mute" },
    ]);
  });

  it("Entwarnung ohne Ruhigstellen", () => {
    const card = buildShopPulseNoticeCard({ kind: "resolved", signal: signal({ status: "resolved", resolvedAt: NOW.toISOString() }) }, "https://app.example");
    expect(body(card)[0].text).toBe("✅ Behoben: Bestellabgleich mit dem Shop hängt");
    expect(actions(card).map((a) => a.title)).toEqual(["In METAorder öffnen"]);
  });

  it("Tagesbericht kürzt lange Listen, Testnachricht", () => {
    const many = Array.from({ length: 14 }, (_, i) => signal({ id: `s${i}` }));
    const daily = buildShopPulseDailyCard(many, NOW, null);
    expect(body(daily)[0].text).toBe("Shop-Puls: Tagesbericht vom 19.10.2026");
    expect(body(daily)[1].text).toBe("14 offene Meldung(en), davon 14 kritisch.");
    expect(body(daily).at(-1)?.text).toBe("… und 2 weitere");
    expect(body(buildShopPulseTestCard(null, NOW))[0].text).toBe("Shop-Puls: Testnachricht");
  });

  it("n8n-Vorlage holt beim Shop-Puls ab und quittiert dort", () => {
    const wf = readFileSync("n8n-workflows/shop-pulse-teams.json", "utf8");
    expect(wf).toContain("/api/shop-pulse/teams-outbox");
    expect(wf).toContain("/api/shop-pulse/teams-outbox/ack");
    expect(wf).not.toContain("/api/shop-content/watch");
  });
});

// -------------------------------------------------------------------------------------------------
// Lauf mit simulierter Datenbank

function memoryStore() {
  const settings = new Map<string, any>();
  const k = (key: string, t?: string | null) => `${t ?? "_"}:${key}`;
  return {
    settings,
    getSetting: async (key: string, t?: string | null) => structuredClone(settings.get(k(key, t))),
    saveSetting: async (key: string, value: any, t?: string | null) => void settings.set(k(key, t), structuredClone(value)),
  };
}

function memoryRepo() {
  const rows: ShopPulseSignal[] = [];
  return {
    rows,
    listSignalsBySources: async (_t: string | null, sources: string[]) => structuredClone(rows.filter((r) => sources.includes(r.source))),
    listOpenSignals: async () => structuredClone(rows.filter((r) => r.status === "open")),
    applyReconcile: async (_t: string | null, result: ReconcileResult) => {
      rows.push(...structuredClone(result.inserts));
      for (const u of result.updates) Object.assign(rows.find((r) => r.id === u.id)!, structuredClone(u.patch));
    },
  };
}

describe("Lauf mit simulierter Datenbank", () => {
  beforeAll(() => vi.useFakeTimers());
  afterAll(() => vi.useRealTimers());

  function setup() {
    const store = memoryStore();
    const repo = memoryRepo();
    const notifications: any[] = [];
    const sync = { status: "idle", error: null as string | null, lastDeltaAt: new Date("2026-10-19T09:58:00Z"), updatedAt: new Date() };
    let now = NOW;
    const deps: ShopPulseDeps = {
      storage: {
        ...store,
        getAllTenants: async () => [{ id: "t1" }] as any,
        getShopwareSettings: async () => ({}) as any,
        getUsersWithPermissionInTenant: async () => [{ id: "admin-1", username: "admin", email: null }],
        createNotification: async (n: any) => {
          notifications.push(n);
          return { ...n, id: `n${notifications.length}`, createdAt: new Date() };
        },
        getShopwareSyncState: async () => sync as any,
      } as any,
      repo,
      detectors: [mirrorFreshnessDetector],
      loadOrders: async () => [],
      onNotificationCreated: () => undefined,
      baseUrl: "https://app.example",
      now: () => now,
    };
    const outbox = async () => (await getTeamsOutbox(store, SHOP_PULSE_TEAMS_OUTBOX_KEY, "t1", now)).map((i) => (i.message as any).attachments[0].content.body[0].text as string);
    return { store, repo, notifications, sync, deps, outbox, setNow: (d: Date) => (now = d) };
  }

  it("ausgeschaltet: sammelt, sendet nichts", async () => {
    const { deps, repo, outbox, notifications, sync } = setup();
    sync.lastDeltaAt = new Date("2026-10-19T09:00:00Z");
    await runShopPulseForTenant(deps, "t1");
    expect(repo.rows).toHaveLength(1);
    expect(await outbox()).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it("eingeschaltet nach der Lernwoche: melden, nicht wiederholen, entwarnen", async () => {
    const { deps, store, repo, outbox, notifications, sync, setNow } = setup();
    await store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { enabled: true, learningUntil: "2026-10-12T00:00:00Z", teamsWebhookUrl: WEBHOOK }, "t1");

    // in Ordnung: nichts
    await runShopPulseForTenant(deps, "t1");
    expect(repo.rows).toEqual([]);
    expect((await getShopPulseState(store, "t1")).detectors?.mirrorFreshness).toMatchObject({ ok: true, findings: 0 });

    // Abgleich hängt seit 40 Minuten: Teams + Glocke
    sync.lastDeltaAt = new Date("2026-10-19T09:20:00Z");
    await runShopPulseForTenant(deps, "t1");
    expect(await outbox()).toEqual(["🔴 Bestellabgleich mit dem Shop hängt"]);
    expect(notifications).toEqual([expect.objectContaining({ type: "shop_pulse", title: "Shop-Puls: Bestellabgleich mit dem Shop hängt", link: `/admin/shop-puls?signal=${repo.rows[0].id}` })]);

    // 15 Minuten später, noch immer: keine Wiederholung
    setNow(new Date("2026-10-19T10:15:00Z"));
    await runShopPulseForTenant(deps, "t1");
    expect(await outbox()).toHaveLength(1);
    expect(repo.rows[0].params.minutes).toBe(55);

    // läuft wieder: Entwarnung
    sync.lastDeltaAt = new Date("2026-10-19T10:14:00Z");
    setNow(new Date("2026-10-19T10:30:00Z"));
    await runShopPulseForTenant(deps, "t1");
    expect(repo.rows[0].status).toBe("resolved");
    expect(await outbox()).toEqual(["🔴 Bestellabgleich mit dem Shop hängt", "✅ Behoben: Bestellabgleich mit dem Shop hängt"]);
    expect(notifications).toHaveLength(2);
  });

  it("Lernwoche: nichts senden, auch keinen Tagesbericht", async () => {
    const { deps, store, outbox, notifications, sync, setNow } = setup();
    await store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { enabled: true, learningUntil: "2026-10-26T00:00:00Z", teamsWebhookUrl: WEBHOOK }, "t1");
    sync.lastDeltaAt = new Date("2026-10-19T05:00:00Z");
    setNow(new Date("2026-10-19T06:15:00Z"));
    await runShopPulseForTenant(deps, "t1");
    expect(await outbox()).toEqual([]);
    expect(notifications).toEqual([]);
    expect((await getShopPulseState(store, "t1")).lastDailyReportDay).toBe("2026-10-19");
  });

  it("Tagesbericht ab 8 Uhr mit offenen Meldungen, einmal je Tag", async () => {
    const { deps, store, repo, outbox, sync, setNow } = setup();
    repo.rows.push(signal({ id: "old", lastSeenAt: "2026-10-19T05:00:00.000Z" }));
    await store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { enabled: true, learningUntil: "2026-10-12T00:00:00Z", teamsWebhookUrl: WEBHOOK }, "t1");
    sync.lastDeltaAt = new Date("2026-10-19T05:00:00Z");
    setNow(new Date("2026-10-19T06:15:00Z"));
    await runShopPulseForTenant(deps, "t1");
    expect(await outbox()).toEqual(["Shop-Puls: Tagesbericht vom 19.10.2026"]);
    setNow(new Date("2026-10-19T06:30:00Z"));
    await runShopPulseForTenant(deps, "t1");
    expect(await outbox()).toHaveLength(1);
  });

  it("Prüfung scheitert: Meldung bleibt offen, Stand zeigt den Fehler", async () => {
    const { deps, store, repo } = setup();
    repo.rows.push(signal());
    await store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { enabled: true, learningUntil: "2026-10-12T00:00:00Z" }, "t1");
    deps.storage.getShopwareSyncState = async () => {
      throw new Error("db down");
    };
    await runShopPulseForTenant(deps, "t1");
    expect(repo.rows[0].status).toBe("open");
    expect((await getShopPulseState(store, "t1")).detectors?.mirrorFreshness).toMatchObject({ ok: false, error: "db down" });
  });
});
