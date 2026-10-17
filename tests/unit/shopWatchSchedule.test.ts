/**
 * Shop-Wächter Schritt 2: wann gemeldet wird (Statuswechsel, Deploy, Entwarnung), Zeitplan (Takt,
 * stündlich, nachts), Teams-Karte und Warteschlange für n8n, n8n-Vorlage, und ein Takt gegen einen
 * simulierten Shop (Admin-API + Storefront) mit Deploy-Erkennung.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import {
  ackShopWatchTeamsOutbox,
  buildShopWatchNotification,
  buildShopWatchTeamsMessage,
  decideShopWatchNotice,
  enqueueShopWatchTeamsMessage,
  getShopWatchTeamsOutbox,
  shopWatchFindingText,
} from "../../server/shopContent/shopWatchNotify";
import {
  berlinDayHour,
  dueShopWatchCadence,
  getShopWatchScheduleState,
  runShopWatchTick,
  SHOP_WATCH_SETTINGS_KEY,
  shopWatchTickForTenant,
  type ShopWatchDeps,
} from "../../server/shopContent/shopWatchScheduler";
import { getShopWatchState } from "../../server/shopContent/shopWatch";
import {
  classifyDeployChanges,
  fingerprintComplete,
  type ShopWatchCheckResult,
  type ShopWatchRun,
  type ShopWatchScheduleState,
  type ShopWatchStatus,
} from "../../shared/shopWatch";

const result = (id: string, status: ShopWatchStatus, findings: ShopWatchCheckResult["findings"] = []): ShopWatchCheckResult => ({
  id,
  group: "own",
  kind: "snippet",
  label: id,
  status,
  findings: status === "ok" || findings.length ? findings : [{ code: "entityMissing", severity: status, params: { entity: "Eigenes CSS/JS", name: id } }],
  repair: { mode: "auto" },
  ms: 1,
});
const run = (results: ShopWatchCheckResult[], deployChanges: ShopWatchRun["deployChanges"] = []): ShopWatchRun => ({
  startedAt: "2026-10-17T10:00:00.000Z",
  finishedAt: "2026-10-17T10:00:12.000Z",
  trigger: "schedule",
  shopUrl: "https://shop.example",
  status: results.reduce<ShopWatchStatus>((w, r) => (r.status === "fail" ? "fail" : w === "fail" ? w : r.status !== "ok" ? r.status : w), "ok"),
  results,
  fingerprint: { shopwareVersion: "6.7", plugins: ["A@1"], themeAsset: "abc?1" },
  deployChanges,
});

/** Läufe nacheinander durch die Entscheidung schicken, Zustand fortschreiben */
function sequence(runs: ShopWatchRun[]) {
  let state: ShopWatchScheduleState = {};
  return runs.map((r) => {
    const d = decideShopWatchNotice(state, r);
    state = { ...state, ...d.state, ...(d.notice ? { lastNotice: d.notice } : {}) };
    return d.notice ? `${d.notice.kind}:${d.notice.level}:${d.newIds.join(",")}` : null;
  });
}

describe("Meldung nur bei Statuswechsel", () => {
  it("grün → rot meldet, gleicher Stand nicht erneut, wieder grün = Entwarnung", () => {
    expect(sequence([
      run([result("a", "ok"), result("b", "ok")]),
      run([result("a", "fail"), result("b", "ok")]),
      run([result("a", "fail"), result("b", "ok")]),
      run([result("a", "ok"), result("b", "ok")]),
      run([result("a", "ok"), result("b", "ok")]),
    ])).toEqual([null, "alert:red:a", null, "allClear:green:", null]);
  });

  it("gelb → rot meldet erneut, rot → gelb nicht, danach wieder rot schon", () => {
    expect(sequence([
      run([result("a", "warn")]),
      run([result("a", "fail")]),
      run([result("a", "warn")]),
      run([result("a", "fail")]),
    ])).toEqual(["alert:yellow:a", "alert:red:a", null, "alert:red:a"]);
  });

  it("weiterer Prüfpunkt kommt dazu: nur der neue ist NEU; behobener kommt zurück: wieder gemeldet", () => {
    expect(sequence([
      run([result("a", "fail"), result("b", "ok")]),
      run([result("a", "fail"), result("b", "warn")]),
      run([result("a", "ok"), result("b", "warn")]),
      run([result("a", "fail"), result("b", "warn")]),
    ])).toEqual(["alert:red:a", "alert:red:b", null, "alert:red:a"]);
  });

  it("gescheiterte Prüfung (Netz) erst beim zweiten Mal in Folge; einmalige Störung bleibt still", () => {
    expect(sequence([
      run([result("a", "error")]),
      run([result("a", "ok")]),
      run([result("a", "error")]),
      run([result("a", "error")]),
      run([result("a", "ok")]),
    ])).toEqual([null, null, null, "alert:yellow:a", "allClear:green:"]);
  });

  it("Deploy (Version/Plugins) meldet immer, nur Theme neu erstellt nicht", () => {
    const theme = [{ field: "themeAsset" as const, before: "a?1", after: "b?2" }];
    const plugins = [{ field: "plugins" as const, before: "A@1", after: "A@2" }];
    expect(classifyDeployChanges([])).toBeNull();
    expect(classifyDeployChanges(theme)).toBe("themeRebuilt");
    expect(classifyDeployChanges([...theme, ...plugins])).toBe("deploy");
    expect(sequence([
      run([result("a", "ok")]),
      run([result("a", "ok")], theme),
      run([result("a", "ok")], plugins),
      run([result("a", "fail")], plugins),
    ])).toEqual([null, null, "deploy:green:", "deploy:red:a"]);
  });

  it("Fingerabdruck nur vollständig vergleichbar", () => {
    expect(fingerprintComplete({ shopwareVersion: "6.7", plugins: ["A@1"], themeAsset: "x" })).toBe(true);
    expect(fingerprintComplete({ shopwareVersion: null, plugins: ["A@1"], themeAsset: "x" })).toBe(false);
    expect(fingerprintComplete({ shopwareVersion: "6.7", plugins: [], themeAsset: "x" })).toBe(false);
    expect(fingerprintComplete({ shopwareVersion: "6.7", plugins: ["A@1"], themeAsset: null })).toBe(false);
  });
});

describe("Zeitplan", () => {
  it("Berlin-Tag und -Stunde auch über die Zeitumstellung", () => {
    expect(berlinDayHour(new Date("2026-10-17T22:30:00Z"))).toEqual({ day: "2026-10-18", hour: 0 });
    expect(berlinDayHour(new Date("2026-10-25T01:30:00Z"))).toEqual({ day: "2026-10-25", hour: 2 });
    expect(berlinDayHour(new Date("2026-07-01T00:30:00Z"))).toEqual({ day: "2026-07-01", hour: 2 });
  });

  it("ohne Lauf alles, nachts einmal alles, sonst stündlich", () => {
    const noon = new Date("2026-10-17T10:00:00Z");
    expect(dueShopWatchCadence({}, undefined, noon)).toBe("all");
    expect(dueShopWatchCadence({}, "2026-10-17T09:30:00Z", noon)).toBeNull();
    expect(dueShopWatchCadence({}, "2026-10-17T09:04:00Z", noon)).toBe("hourly");
    const night = new Date("2026-10-18T01:15:00Z"); // 03:15 Berlin
    expect(dueShopWatchCadence({ lastFullRunAt: "2026-10-17T10:00:00Z" }, "2026-10-18T01:00:00Z", night)).toBe("all");
    expect(dueShopWatchCadence({ lastFullRunAt: "2026-10-18T00:20:00Z" }, "2026-10-18T01:00:00Z", night)).toBeNull();
  });
});

describe("Teams-Karte und Glocke", () => {
  const r = run(
    [
      result("snippet:x", "fail", [{ code: "entityMissing", severity: "fail", params: { entity: "Eigenes CSS/JS", name: "Schnell<konfig>" } }]),
      result("bulk:y", "warn", [{ code: "countDropped", severity: "warn", params: { before: 100, after: 90 } }]),
      result("ok", "ok"),
    ],
    [{ field: "plugins", before: "A@1", after: "A@2" }],
  );
  const d = decideShopWatchNotice({ notified: { "bulk:y": "warn" } }, r);

  it("deutsche Befundtexte aus dem Übersetzungskatalog", () => {
    expect(shopWatchFindingText({ code: "countDropped", severity: "warn", params: { before: 100, after: 90 } })).toBe("Weniger als im Soll-Stand: 90 statt 100");
  });

  it("Karte: Titel, Deploy-Änderung, Prüfpunkte (neue zuerst), Link auf die Seite, nichts aus dem Shop als Markup", () => {
    const msg = buildShopWatchTeamsMessage(d.notice!, r, { baseUrl: "https://app.example/", newIds: d.newIds }) as any;
    const card = msg.attachments[0].content;
    const texts = card.body.filter((b: any) => b.type === "TextBlock").map((b: any) => b.text);
    expect(texts[0]).toBe("🚀 Shop-Wächter: Deploy im Shop erkannt – 1 rot, 1 gelb");
    expect(texts).toContain("- Plugins entfernt/alt: A@1 · neu: A@2");
    expect(texts).toContain("🔴 NEU: Baustein „Eigenes CSS/JS“ „snippet:x“: Eigenes CSS/JS „Schnell konfig “ fehlt im Shop");
    expect(texts).toContain("🟡 Baustein „Eigenes CSS/JS“ „bulk:y“: Weniger als im Soll-Stand: 90 statt 100");
    expect(card.body.find((b: any) => b.type === "FactSet").facts[2]).toEqual({ title: "Ergebnis", value: "1 von 3 Prüfpunkten in Ordnung" });
    expect(card.actions).toEqual([{ type: "Action.OpenUrl", title: "Shop-Wächter öffnen", url: "https://app.example/admin/shop-waechter" }]);
  });

  it("Glocke: Titel und kurze Nachricht", () => {
    const n = buildShopWatchNotification(d.notice!, r, d.newIds);
    expect(n.title).toBe("Shop-Wächter: Deploy im Shop erkannt – 1 rot, 1 gelb");
    expect(n.message.split("\n")[0]).toBe("Plugins entfernt/alt: A@1 · neu: A@2");
  });

  it("Entwarnung", () => {
    const green = run([result("a", "ok")]);
    const allClear = decideShopWatchNotice({ notified: { a: "fail" } }, green).notice!;
    expect(buildShopWatchNotification(allClear, green, [])).toEqual({ title: "Shop-Wächter: wieder alles in Ordnung", message: "Alle 1 Prüfpunkte sind wieder grün." });
  });
});

function memoryStore() {
  const settings = new Map<string, any>();
  const k = (key: string, t?: string | null) => `${t ?? "_"}:${key}`;
  return {
    settings,
    getSetting: async (key: string, t?: string | null) => structuredClone(settings.get(k(key, t))),
    saveSetting: async (key: string, value: any, t?: string | null) => void settings.set(k(key, t), structuredClone(value)),
  };
}

describe("Warteschlange für n8n", () => {
  it("einreihen, quittieren, nach 48 Stunden verfallen", async () => {
    const store = memoryStore();
    const t0 = new Date("2026-10-17T10:00:00Z");
    await enqueueShopWatchTeamsMessage(store, "t1", { n: 1 }, t0);
    await enqueueShopWatchTeamsMessage(store, "t1", { n: 2 }, new Date("2026-10-18T10:00:00Z"));
    const items = await getShopWatchTeamsOutbox(store, "t1", new Date("2026-10-18T11:00:00Z"));
    expect(items.map((i) => i.message)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(await ackShopWatchTeamsOutbox(store, "t1", [items[0].id, "fremd"], new Date("2026-10-18T11:00:00Z"))).toBe(1);
    expect((await getShopWatchTeamsOutbox(store, "t1", new Date("2026-10-18T11:00:00Z"))).map((i) => i.message)).toEqual([{ n: 2 }]);
    expect(await getShopWatchTeamsOutbox(store, "t1", new Date("2026-10-20T11:00:00Z"))).toEqual([]);
    expect(await getShopWatchTeamsOutbox(store, "anderer", t0)).toEqual([]);
  });

  it("n8n-Vorlage: holt mit Integration-Key ab, postet einzeln, quittiert nur Erfolgreiches", () => {
    const raw = readFileSync("n8n-workflows/shop-watch-teams.json", "utf8");
    expect(raw).not.toContain("$env");
    const wf = JSON.parse(raw);
    const node = (name: string) => wf.nodes.find((n: any) => n.name === name);
    for (const name of ["METAorder: Meldungen", "METAorder: quittieren"]) {
      expect(node(name).credentials).toEqual({ httpHeaderAuth: { id: "METAORDER_INTEGRATION_KEY_CREDENTIAL_ID", name: "METAorder Integration-Key" } });
    }
    expect(node("METAorder: Meldungen").parameters.url).toBe("={{ $json.metaorderUrl }}/api/shop-content/watch/teams-outbox");
    expect(node("Einstellungen").parameters.assignments.assignments[0].value).toBe("https://p-bbpye5.project.space");

    const split = new Function("$input", node("Meldungen einzeln").parameters.jsCode);
    const items = split({ all: () => [{ json: { webhookUrl: "https://hook", items: [{ id: "1", message: { a: 1 } }, { id: "2", message: { b: 2 } }] } }] });
    expect(items).toEqual([
      { json: { webhookUrl: "https://hook", id: "1", message: { a: 1 } } },
      { json: { webhookUrl: "https://hook", id: "2", message: { b: 2 } } },
    ]);
    expect(split({ all: () => [{ json: { webhookUrl: "", items: [] } }] })).toEqual([]);

    const collect = new Function("$", "$input", node("Gesendete sammeln").parameters.jsCode);
    const $ = (name: string) =>
      name === "Meldungen einzeln" ? { all: () => items } : { first: () => ({ json: { metaorderUrl: "https://metaorder" } }) };
    expect(collect($, { all: () => [{ json: { statusCode: 202 } }, { json: { statusCode: 500 } }] })).toEqual([
      { json: { metaorderUrl: "https://metaorder", ids: ["1"] } },
    ]);
    expect(collect($, { all: () => [{ json: { statusCode: 400 } }, { json: {} }] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Takt gegen einen simulierten Shop

const SHOP = "https://test.shop-watch.invalid";
const shop = vi.hoisted(() => ({
  version: "6.7.14.2" as string | null,
  plugins: [{ name: "DneCustomCssJs", version: "5.0.0", active: true }],
  theme: "abc123",
  calls: [] as string[],
}));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T10:00:00Z")); // 12:00 Berlin
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? "GET";
    shop.calls.push(`${method} ${u.pathname}`);
    if (u.pathname === "/api/oauth/token") return json({ access_token: "tok", expires_in: 600, token_type: "Bearer" });
    if (u.pathname === "/api/_info/version") return shop.version ? json({ version: shop.version }) : json({ errors: [] }, 503);
    if (u.pathname === "/api/search/plugin") return json({ data: shop.plugins });
    if (u.pathname === "/api/search/sales-channel") {
      return json({ data: [{ id: "ch-de", name: "META Regalbau DE", domains: [{ url: SHOP }] }] });
    }
    if (u.pathname.startsWith("/api/")) return json({ data: [], total: 0 });
    if (u.pathname === "/") {
      return new Response(`<html><head><link rel="stylesheet" href="${SHOP}/theme/${shop.theme}/css/all.css?1700000000"></head><body></body></html>`);
    }
    return new Response("", { status: 404 });
  });
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeDeps(webhook = "https://x.logic.azure.com/hook") {
  const store = memoryStore();
  const notifications: any[] = [];
  const deps: ShopWatchDeps = {
    storage: {
      ...store,
      getAllTenants: async () => [{ id: "t1" }] as any,
      getShopwareSettings: async (t?: string | null) => (t === "t1" ? { shopwareUrl: SHOP, apiKey: "k", apiSecret: "s" } : undefined),
      getUsersWithPermissionInTenant: async () => [{ id: "admin-1", username: "admin", email: null }],
      createNotification: async (n: any) => {
        notifications.push(n);
        return { ...n, id: `n${notifications.length}`, createdAt: new Date() };
      },
    } as any,
    teamsWebhookUrl: async () => webhook,
    onNotificationCreated: () => undefined,
    baseUrl: "https://app.example",
  };
  return { deps, store, notifications };
}

describe("Takt gegen einen simulierten Shop", () => {
  beforeEach(() => {
    shop.version = "6.7.14.2";
    shop.plugins = [{ name: "DneCustomCssJs", version: "5.0.0", active: true }];
    shop.theme = "abc123";
    shop.calls = [];
    vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
  });

  it("aus: kein Abruf beim Shop", async () => {
    const { deps } = fakeDeps();
    await runShopWatchTick(deps);
    expect(shop.calls).toEqual([]);
  });

  it("erster Lauf, Ruhe, Deploy, nur Theme, stündlich, unvollständige Merkmale", async () => {
    const { deps, store, notifications } = fakeDeps();
    await store.saveSetting(SHOP_WATCH_SETTINGS_KEY, { enabled: true }, "t1");
    const outbox = async () => (await getShopWatchTeamsOutbox(store, "t1")).map((i) => i.message.attachments[0].content.body[0].text as string);

    // 1. Noch kein Lauf: Vollprüfung, im leeren simulierten Shop fehlt alles → Meldung rot
    expect(await shopWatchTickForTenant(deps, "t1")).toBe("all");
    expect((await getShopWatchState(store, "t1")).lastRun?.trigger).toBe("schedule");
    expect(await outbox()).toEqual([expect.stringMatching(/^🔴 Shop-Wächter: \d+ rot/)]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ userId: "admin-1", type: "shop_watch", link: "/admin/shop-waechter" });
    const schedule = await getShopWatchScheduleState(store, "t1");
    expect(schedule.lastFullRunAt).toBeTruthy();
    expect(schedule.lastNotice).toMatchObject({ kind: "alert", level: "red", teams: true });

    // 2. Gleich danach: nur der leichte Abgleich, nichts fällig, keine neue Meldung
    shop.calls = [];
    expect(await shopWatchTickForTenant(deps, "t1")).toBe("idle");
    expect(shop.calls.filter((c) => c.startsWith("POST /api/search/") && !/sales-channel|plugin/.test(c))).toEqual([]);
    expect(shop.calls).toContain("GET /api/_info/version");
    expect(shop.calls).toContain("GET /");
    expect(notifications).toHaveLength(1);

    // 3. Agentur rollt ein Plugin-Update aus: sofort Vollprüfung „deploy“, Meldung
    shop.plugins = [{ name: "DneCustomCssJs", version: "5.1.0", active: true }];
    vi.setSystemTime(new Date("2026-10-17T10:15:00Z"));
    expect(await shopWatchTickForTenant(deps, "t1")).toBe("deploy");
    const afterDeploy = (await getShopWatchState(store, "t1")).lastRun!;
    expect(afterDeploy.trigger).toBe("deploy");
    expect(afterDeploy.deployChanges).toEqual([{ field: "plugins", before: "DneCustomCssJs@5.0.0", after: "DneCustomCssJs@5.1.0" }]);
    expect((await outbox())[1]).toMatch(/^🚀 Shop-Wächter: Deploy im Shop erkannt/);
    expect(notifications).toHaveLength(2);

    // 4. Nur das Theme neu erstellt (z. B. unser Schreibskript): Vollprüfung, aber keine Meldung
    shop.theme = "def456";
    vi.setSystemTime(new Date("2026-10-17T10:30:00Z"));
    expect(await shopWatchTickForTenant(deps, "t1")).toBe("deploy");
    expect((await getShopWatchState(store, "t1")).lastRun!.deployChanges.map((c) => c.field)).toEqual(["themeAsset"]);
    expect(await outbox()).toHaveLength(2);
    expect(notifications).toHaveLength(2);

    // 5. Eine Stunde später: stündliche Prüfpunkte, Massendaten aus dem letzten Lauf übernommen
    vi.setSystemTime(new Date("2026-10-17T11:30:00Z"));
    const before = (await getShopWatchState(store, "t1")).lastRun!.results.length;
    expect(await shopWatchTickForTenant(deps, "t1")).toBe("hourly");
    expect((await getShopWatchState(store, "t1")).lastRun!.results).toHaveLength(before);

    // 6. Shopware-Version kurz nicht lesbar: kein Fehlalarm, nichts fällig
    shop.version = null;
    vi.setSystemTime(new Date("2026-10-17T11:45:00Z"));
    expect(await shopWatchTickForTenant(deps, "t1")).toBe("idle");
    expect(await outbox()).toHaveLength(2);
  });

  it("ohne Teams-Webhook nur die Glocke", async () => {
    const { deps, store, notifications } = fakeDeps("");
    await store.saveSetting(SHOP_WATCH_SETTINGS_KEY, { enabled: true }, "t1");
    expect(await shopWatchTickForTenant(deps, "t1")).toBe("all");
    expect(await getShopWatchTeamsOutbox(store, "t1")).toEqual([]);
    expect(notifications).toHaveLength(1);
    expect((await getShopWatchScheduleState(store, "t1")).lastNotice?.teams).toBe(false);
  });
});
