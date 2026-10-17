/**
 * Shop-Wächter: führt den Prüfkatalog (shopWatchChecks.ts) gegen den Shop eines Mandanten aus und merkt
 * sich Ergebnis, Soll-Stand und Deploy-Fingerabdruck in den Einstellungen (shop_watch_state,
 * shop_watch_baseline). Prüfungen laufen nacheinander (Live nicht parallel abfragen), Seiten werden je
 * Lauf nur einmal geladen. Nur lesend.
 */
import { readFileSync } from "fs";
import path from "path";
import {
  fingerprintComplete,
  worstStatus,
  type ShopWatchBaseline,
  type ShopWatchCheckResult,
  type ShopWatchDeployChange,
  type ShopWatchDeployFingerprint,
  type ShopWatchRun,
} from "@shared/shopWatch";
import type { ShopwareSettings } from "@shared/schema";
import { logger } from "../lib/logger";
import { findDeChannel, shopApi, type ShopApi } from "./shopProducts";
import { SHOP_WATCH_CHECKS, type ShopPage, type ShopPlugin, type ShopWatchCheckDef, type ShopWatchContext, type ThemeAssets } from "./shopWatchChecks";

const log = logger.child({ component: "shopContent/shopWatch" });

export const SHOP_WATCH_STATE_KEY = "shop_watch_state";
export const SHOP_WATCH_BASELINE_KEY = "shop_watch_baseline";
const HISTORY_LENGTH = 30;
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "Mozilla/5.0 (compatible; METAorder-Shopwaechter/1.0)";
const SNIPPET_DIR = path.resolve(process.cwd(), "shopware", "storefront-snippets");

type SettingsStore = {
  getSetting(key: string, tenantId?: string | null): Promise<any>;
  saveSetting(key: string, value: any, tenantId?: string | null): Promise<any>;
  getShopwareSettings(tenantId?: string | null): Promise<ShopwareSettings | undefined | null>;
};

export type ShopWatchHistoryEntry = Pick<ShopWatchRun, "startedAt" | "trigger" | "status" | "deployChanges"> & { failed: number; warned: number };

export type ShopWatchState = {
  lastRun?: ShopWatchRun & { categoryFields?: Record<string, string> };
  history?: ShopWatchHistoryEntry[];
};

export async function getShopWatchState(store: SettingsStore, tenantId: string | null): Promise<ShopWatchState> {
  const raw = await store.getSetting(SHOP_WATCH_STATE_KEY, tenantId);
  return raw && typeof raw === "object" ? (raw as ShopWatchState) : {};
}

export async function getShopWatchBaseline(store: SettingsStore, tenantId: string | null): Promise<ShopWatchBaseline | null> {
  const raw = await store.getSetting(SHOP_WATCH_BASELINE_KEY, tenantId);
  return raw && typeof raw === "object" && raw.counts ? (raw as ShopWatchBaseline) : null;
}

/** Soll-Stand aus einem Lauf: Kennzahlen aller Prüfpunkte und die Fingerabdrücke der Kategorie-Felder */
export function baselineFromRun(run: ShopWatchState["lastRun"], at = new Date()): ShopWatchBaseline {
  const counts: Record<string, number> = {};
  for (const r of run?.results ?? []) {
    if (r.status === "error") continue;
    if (typeof r.count === "number") counts[r.id] = r.count;
    Object.assign(counts, r.counts ?? {});
  }
  return { takenAt: at.toISOString(), counts, categoryFields: run?.categoryFields ?? {} };
}

export async function saveShopWatchBaselineFromLastRun(store: SettingsStore, tenantId: string | null): Promise<ShopWatchBaseline> {
  const state = await getShopWatchState(store, tenantId);
  if (!state.lastRun) throw new Error("No shop watch run yet");
  const baseline = baselineFromRun(state.lastRun);
  await store.saveSetting(SHOP_WATCH_BASELINE_KEY, baseline, tenantId);
  return baseline;
}

export function diffFingerprint(before: ShopWatchDeployFingerprint | undefined, after: ShopWatchDeployFingerprint): ShopWatchDeployChange[] {
  if (!before) return [];
  const changes: ShopWatchDeployChange[] = [];
  if ((before.shopwareVersion ?? "") !== (after.shopwareVersion ?? "")) {
    changes.push({ field: "shopwareVersion", before: before.shopwareVersion ?? "–", after: after.shopwareVersion ?? "–" });
  }
  const removed = before.plugins.filter((p) => !after.plugins.includes(p));
  const added = after.plugins.filter((p) => !before.plugins.includes(p));
  if (removed.length || added.length) changes.push({ field: "plugins", before: removed.join(", ") || "–", after: added.join(", ") || "–" });
  if ((before.themeAsset ?? "") !== (after.themeAsset ?? "")) changes.push({ field: "themeAsset", before: before.themeAsset ?? "–", after: after.themeAsset ?? "–" });
  return changes;
}

/** Theme-Dateien aus der Startseite: Hash-Ordner und Zeitstempel ändern sich bei jedem Theme-Neubau */
export function themeAssetUrls(html: string): { js: string | null; css: string | null; key: string | null } {
  const js = html.match(/(?:src|href)="([^"]*\/theme\/[0-9a-f]+\/js\/dne-custom-css-js\/dne-custom-css-js\.js[^"]*)"/)?.[1] ?? null;
  const css = html.match(/href="([^"]*\/theme\/[0-9a-f]+\/css\/all\.css[^"]*)"/)?.[1] ?? null;
  const m = (css ?? js ?? "").match(/\/theme\/([0-9a-f]+)\/[^?"]*(?:\?(\d+))?/);
  return { js, css, key: m ? `${m[1]}${m[2] ? `?${m[2]}` : ""}` : null };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Kontext für einen Lauf: Seiten- und Asset-Abrufe gemerkt, Plugins einmal geladen */
export function createShopWatchContext(opts: {
  api: ShopApi;
  channelId: string;
  storefront: string;
  baseline: ShopWatchBaseline | null;
  fetchImpl?: FetchLike;
  readSnippet?: (file: string) => { js: string; css: string } | null;
}): ShopWatchContext {
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const pages = new Map<string, Promise<ShopPage>>();
  const texts = new Map<string, Promise<string>>();
  let assets: Promise<ThemeAssets> | null = null;
  let plugins: Promise<ShopPlugin[]> | null = null;
  const abs = (p: string) => (/^https?:/.test(p) ? p : `${opts.storefront}${p.startsWith("/") ? p : `/${p}`}`);
  const get = (url: string, redirect: "follow" | "manual") =>
    doFetch(url, { redirect, headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const text = (url: string) => {
    if (!texts.has(url)) texts.set(url, get(url, "follow").then((r) => (r.ok ? r.text() : "")).catch(() => ""));
    return texts.get(url)!;
  };

  const ctx: ShopWatchContext = {
    api: opts.api,
    channelId: opts.channelId,
    storefront: opts.storefront,
    baseline: opts.baseline,
    page(p, o) {
      const redirect = o?.redirect ?? "follow";
      const key = `${redirect}:${p}`;
      if (!pages.has(key)) {
        pages.set(key, (async () => {
          const r = await get(abs(p), redirect);
          return { status: r.status, html: redirect === "manual" && r.status >= 300 && r.status < 400 ? "" : await r.text(), location: r.headers.get("location") };
        })());
      }
      return pages.get(key)!;
    },
    async status(url) {
      const r = await get(abs(url), "follow");
      await r.body?.cancel().catch(() => undefined);
      return r.status;
    },
    themeAssets() {
      assets ??= (async () => {
        const home = await ctx.page("/");
        const urls = themeAssetUrls(home.html);
        return { js: urls.js ? await text(urls.js) : "", css: urls.css ? await text(urls.css) : "", key: urls.key };
      })();
      return assets;
    },
    plugins() {
      plugins ??= opts.api("POST", "search/plugin", { limit: 500, includes: { plugin: ["name", "version", "active"] } })
        .then((res) => (res?.data ?? []).map((p: any) => ({ name: String(p.name), version: String(p.version ?? ""), active: !!p.active })));
      return plugins;
    },
    snippetSource: opts.readSnippet ?? readSnippetSource,
  };
  return ctx;
}

function readSnippetSource(file: string): { js: string; css: string } | null {
  try {
    return { js: readFileSync(path.join(SNIPPET_DIR, `${file}.js`), "utf8"), css: readFileSync(path.join(SNIPPET_DIR, `${file}.css`), "utf8") };
  } catch {
    return null;
  }
}

export async function deployFingerprint(ctx: ShopWatchContext): Promise<ShopWatchDeployFingerprint> {
  const version = await ctx.api("GET", "_info/version").then((v) => (v?.version ? String(v.version) : null)).catch(() => null);
  const plugins = await ctx.plugins().catch(() => [] as ShopPlugin[]);
  const assets = await ctx.themeAssets().catch(() => null);
  return {
    shopwareVersion: version,
    plugins: plugins.map((p) => `${p.name}@${p.version}${p.active ? "" : " (aus)"}`).sort(),
    themeAsset: assets?.key ?? null,
  };
}

/** Prüfpunkte nacheinander; ein Fehler in einer Prüfung (Netz, API) wird Status error dieses Prüfpunkts */
export async function runShopWatchChecks(
  ctx: ShopWatchContext,
  checks: ShopWatchCheckDef[],
  opts: { tenantId: string; live: boolean },
): Promise<{ results: ShopWatchCheckResult[]; categoryFields?: Record<string, string> }> {
  const results: ShopWatchCheckResult[] = [];
  let categoryFields: Record<string, string> | undefined;
  for (const check of checks) {
    const started = Date.now();
    const base = { id: check.id, group: check.group, kind: check.kind, label: check.label, url: check.url, repair: check.repair(opts) };
    try {
      const outcome = await check.run(ctx);
      if (outcome.categoryFields) categoryFields = outcome.categoryFields;
      results.push({
        ...base,
        status: worstStatus(outcome.findings.map((f) => f.severity)),
        findings: outcome.findings,
        count: outcome.count,
        counts: outcome.counts,
        ms: Date.now() - started,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ ...base, status: "error", findings: [{ code: "checkFailed", severity: "error", params: { message: message.slice(0, 300) } }], ms: Date.now() - started });
    }
  }
  return { results, categoryFields };
}

const running = new Set<string>();
const tenantKey = (tenantId: string | null) => tenantId ?? "_";

export function isShopWatchRunning(tenantId: string | null): boolean {
  return running.has(tenantKey(tenantId));
}

/**
 * Leichter Deploy-Abgleich (alle 15 Minuten): nur Shopware-Version, Plugins und Theme-Dateien der
 * Startseite, verglichen mit dem Fingerabdruck des letzten Laufs. Unter derselben Sperre wie ein Lauf.
 */
export async function checkShopWatchFingerprint(
  store: SettingsStore,
  tenantId: string | null,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<{ complete: boolean; changes: ShopWatchDeployChange[]; fingerprint: ShopWatchDeployFingerprint }> {
  const key = tenantKey(tenantId);
  if (running.has(key)) throw new Error("Shop watch run already in progress");
  running.add(key);
  try {
    const settings = await store.getShopwareSettings(tenantId);
    if (!settings) throw new Error("Shopware settings not configured");
    const { api, base } = shopApi(settings);
    const channel = await findDeChannel(api, base);
    const state = await getShopWatchState(store, tenantId);
    const ctx = createShopWatchContext({ api, channelId: channel.id, storefront: channel.domain, baseline: null, fetchImpl: opts.fetchImpl });
    const fingerprint = await deployFingerprint(ctx);
    const complete = fingerprintComplete(fingerprint);
    return { complete, changes: complete ? diffFingerprint(state.lastRun?.fingerprint, fingerprint) : [], fingerprint };
  } finally {
    running.delete(key);
  }
}

/**
 * Ein Lauf für einen Mandanten: alle Prüfpunkte (oder nur die stündlichen), Ergebnis speichern.
 * Ohne Soll-Stand wird der erste vollständige Lauf zum Soll-Stand.
 */
export async function runShopWatch(
  store: SettingsStore,
  tenantId: string | null,
  opts: {
    trigger: ShopWatchRun["trigger"];
    cadence?: "all" | "hourly";
    fetchImpl?: FetchLike;
    /** Läuft noch unter der Sperre des Mandanten (Meldungen, Zeitplan-Stand) */
    afterRun?: (run: ShopWatchRun) => Promise<void>;
  } = { trigger: "manual" },
): Promise<ShopWatchRun> {
  const key = tenantKey(tenantId);
  if (running.has(key)) throw new Error("Shop watch run already in progress");
  running.add(key);
  try {
    const settings = await store.getShopwareSettings(tenantId);
    if (!settings) throw new Error("Shopware settings not configured");
    const { api, base, isTest } = shopApi(settings);
    const channel = await findDeChannel(api, base);
    const [state, baseline] = await Promise.all([getShopWatchState(store, tenantId), getShopWatchBaseline(store, tenantId)]);
    const ctx = createShopWatchContext({ api, channelId: channel.id, storefront: channel.domain, baseline, fetchImpl: opts.fetchImpl });
    const startedAt = new Date().toISOString();
    // Unvollständig gelesene Merkmale (Shop kurz nicht erreichbar) nicht vergleichen und nicht speichern
    const read = await deployFingerprint(ctx);
    const fingerprint = fingerprintComplete(read) ? read : state.lastRun?.fingerprint ?? read;
    const checks = opts.cadence === "hourly" ? SHOP_WATCH_CHECKS.filter((c) => c.cadence === "hourly") : SHOP_WATCH_CHECKS;
    const { results, categoryFields } = await runShopWatchChecks(ctx, checks, { tenantId: tenantId ?? "<tenantId>", live: !isTest });
    // Ergebnisse der nicht geprüften Massendaten aus dem letzten Lauf übernehmen, damit die Übersicht vollständig bleibt
    const carried = (state.lastRun?.results ?? []).filter((r) => !results.some((x) => x.id === r.id) && SHOP_WATCH_CHECKS.some((c) => c.id === r.id));
    const all = SHOP_WATCH_CHECKS.map((c) => results.find((r) => r.id === c.id) ?? carried.find((r) => r.id === c.id)).filter((r): r is ShopWatchCheckResult => !!r);
    const run: ShopWatchRun & { categoryFields?: Record<string, string> } = {
      startedAt,
      finishedAt: new Date().toISOString(),
      trigger: opts.trigger,
      shopUrl: channel.domain,
      status: worstStatus(all.map((r) => r.status)),
      results: all,
      fingerprint,
      deployChanges: fingerprintComplete(read) ? diffFingerprint(state.lastRun?.fingerprint, read) : [],
      categoryFields: categoryFields ?? state.lastRun?.categoryFields,
    };
    const entry: ShopWatchHistoryEntry = {
      startedAt,
      trigger: run.trigger,
      status: run.status,
      deployChanges: run.deployChanges,
      failed: all.filter((r) => r.status === "fail").length,
      warned: all.filter((r) => r.status === "warn").length,
    };
    await store.saveSetting(SHOP_WATCH_STATE_KEY, { lastRun: run, history: [entry, ...(state.history ?? [])].slice(0, HISTORY_LENGTH) }, tenantId);
    if (!baseline && opts.cadence !== "hourly") await store.saveSetting(SHOP_WATCH_BASELINE_KEY, baselineFromRun(run), tenantId);

    for (const r of all.filter((x) => results.includes(x) && x.status !== "ok")) {
      const level = r.status === "warn" ? "warn" : "error";
      log[level]({ tenantId, check: r.id, status: r.status, findings: r.findings }, `Shop-Wächter: ${r.label} – ${r.status}`);
    }
    if (run.deployChanges.length) log.warn({ tenantId, changes: run.deployChanges }, "Shop-Wächter: Änderung an Shopware, Plugins oder Theme erkannt");
    if (!fingerprintComplete(read)) log.warn({ tenantId, fingerprint: read }, "Shop-Wächter: Deploy-Merkmale unvollständig gelesen, kein Vergleich");
    log.info({ tenantId, status: run.status, checks: results.length, ms: Date.parse(run.finishedAt) - Date.parse(startedAt) }, "Shop-Wächter: Lauf beendet");
    if (opts.afterRun) {
      try {
        await opts.afterRun(run);
      } catch (err) {
        log.error({ err, tenantId }, "Shop-Wächter: Nachbereitung (Meldungen) fehlgeschlagen");
      }
    }
    return run;
  } finally {
    running.delete(key);
  }
}
