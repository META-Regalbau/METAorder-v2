/**
 * Shop-Wächter, Zeitplan (Schritt 2, Entscheidungen 17.10.2026). Takt alle 15 Minuten, je Mandant mit
 * Shopware-Anbindung und eingeschaltetem Wächter (Settings shop_watch_settings, Standard aus):
 *
 * 1. Leichter Deploy-Abgleich (Shopware-Version, Plugins, Theme-Dateien der Startseite). Geändert →
 *    sofort Vollprüfung mit Auslöser „deploy“.
 * 2. Sonst nachts (2–5 Uhr Berlin, einmal je Tag) eine Vollprüfung inkl. Massendaten,
 * 3. sonst stündlich die stündlichen Prüfpunkte.
 *
 * Mandanten nacheinander, nie zwei Abfragen gegen denselben Shop gleichzeitig (Sperre je Mandant in
 * shopWatch.ts, Takt überlappt nicht). Nach jedem Lauf – auch von Hand – entscheidet
 * shopWatchNotify.ts über Teams-Nachricht und Glocke.
 */
import type { IStorage } from "../storage";
import type { InsertNotification, Notification } from "@shared/schema";
import {
  normalizeShopWatchSettings,
  type ShopWatchRun,
  type ShopWatchScheduleState,
  type ShopWatchSettings,
} from "@shared/shopWatch";
import { runWithTenantContext } from "../lib/tenantContext";
import { notificationEvents } from "../lib/events";
import { logger } from "../lib/logger";
import { getEmailIntakeSettings } from "../commercial/emailIntakeSettings";
import { publicAppBaseUrl } from "../commercial/emailIntakeTeams";
import { checkShopWatchFingerprint, getShopWatchState, isShopWatchRunning, runShopWatch } from "./shopWatch";
import {
  buildShopWatchNotification,
  buildShopWatchTeamsMessage,
  decideShopWatchNotice,
  enqueueShopWatchTeamsMessage,
  SHOP_WATCH_PAGE_PATH,
} from "./shopWatchNotify";

const log = logger.child({ component: "shopContent/shopWatchScheduler" });

export const SHOP_WATCH_SETTINGS_KEY = "shop_watch_settings";
export const SHOP_WATCH_SCHEDULE_STATE_KEY = "shop_watch_schedule_state";
export const SHOP_WATCH_TICK_MS = 15 * 60 * 1000;
/** Stündlich mit etwas Spielraum, damit der 15-Minuten-Takt die Stunde nicht verpasst */
const HOURLY_MS = 55 * 60 * 1000;
const NIGHT_FROM_HOUR = 2;
const NIGHT_TO_HOUR = 5;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ShopWatchDeps = {
  storage: Pick<
    IStorage,
    "getAllTenants" | "getShopwareSettings" | "getSetting" | "saveSetting" | "getUsersWithPermissionInTenant" | "createNotification"
  >;
  /** Teams-Webhook aus den E-Mail-Eingang-Einstellungen ("" = keine Teams-Nachricht) */
  teamsWebhookUrl: (tenantId: string | null) => Promise<string>;
  onNotificationCreated: (n: Notification) => void;
  baseUrl: string | null;
  now?: () => Date;
  fetchImpl?: FetchLike;
};

export async function getShopWatchSettings(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<ShopWatchSettings> {
  return normalizeShopWatchSettings(await store.getSetting(SHOP_WATCH_SETTINGS_KEY, tenantId));
}

export async function getShopWatchScheduleState(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<ShopWatchScheduleState> {
  const raw = await store.getSetting(SHOP_WATCH_SCHEDULE_STATE_KEY, tenantId);
  return raw && typeof raw === "object" ? (raw as ShopWatchScheduleState) : {};
}

async function patchScheduleState(store: ShopWatchDeps["storage"], tenantId: string | null, patch: Partial<ShopWatchScheduleState>) {
  const current = await getShopWatchScheduleState(store, tenantId);
  await store.saveSetting(SHOP_WATCH_SCHEDULE_STATE_KEY, { ...current, ...patch }, tenantId);
}

const BERLIN_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Kalendertag und Stunde in Berlin */
export function berlinDayHour(d: Date): { day: string; hour: number } {
  const parts = Object.fromEntries(BERLIN_PARTS.formatToParts(d).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Was nach dem Deploy-Abgleich fällig ist: Vollprüfung, stündliche Prüfung oder nichts */
export function dueShopWatchCadence(
  schedule: ShopWatchScheduleState,
  lastRunStartedAt: string | undefined,
  now: Date,
): "all" | "hourly" | null {
  if (!lastRunStartedAt) return "all";
  const { day, hour } = berlinDayHour(now);
  const lastFullDay = schedule.lastFullRunAt ? berlinDayHour(new Date(schedule.lastFullRunAt)).day : null;
  if (hour >= NIGHT_FROM_HOUR && hour < NIGHT_TO_HOUR && lastFullDay !== day) return "all";
  if (now.getTime() - Date.parse(lastRunStartedAt) >= HOURLY_MS) return "hourly";
  return null;
}

/** Nach einem Lauf: Zeitplan-Stand fortschreiben, bei Bedarf Teams-Nachricht und Glocke */
export async function afterShopWatchRun(deps: ShopWatchDeps, tenantId: string | null, run: ShopWatchRun, cadence: "all" | "hourly"): Promise<void> {
  const store = deps.storage;
  const now = deps.now?.() ?? new Date();
  const [settings, schedule] = await Promise.all([getShopWatchSettings(store, tenantId), getShopWatchScheduleState(store, tenantId)]);
  const patch: Partial<ShopWatchScheduleState> = cadence === "all" ? { lastFullRunAt: run.finishedAt } : {};
  if (!settings.enabled) {
    await patchScheduleState(store, tenantId, patch);
    return;
  }
  const decision = decideShopWatchNotice(schedule, run, now);
  Object.assign(patch, decision.state);
  const notice = decision.notice;
  if (notice) {
    const webhook = (await deps.teamsWebhookUrl(tenantId).catch(() => "")).trim();
    if (webhook) {
      await enqueueShopWatchTeamsMessage(store, tenantId, buildShopWatchTeamsMessage(notice, run, { baseUrl: deps.baseUrl, newIds: decision.newIds }), now);
      notice.teams = true;
    }
    patch.lastNotice = notice;
    // Die Seite ist Administratoren vorbehalten; ein eigenes Recht gibt es (noch) nicht
    const recipients = await store.getUsersWithPermissionInTenant("viewShopWatch", tenantId, { includeAdministrators: true });
    const text = buildShopWatchNotification(notice, run, decision.newIds);
    for (const u of recipients) {
      try {
        const n: InsertNotification = {
          userId: u.id,
          type: "shop_watch",
          title: text.title,
          message: text.message,
          link: SHOP_WATCH_PAGE_PATH,
          ticketId: null,
          ticketNumber: null,
          read: 0,
        };
        deps.onNotificationCreated(await store.createNotification(n, tenantId));
      } catch (err) {
        log.warn({ err, tenantId, userId: u.id }, "Shop-Wächter: Benachrichtigung nicht erstellt");
      }
    }
    log.warn({ tenantId, kind: notice.kind, level: notice.level, problems: notice.problems, teams: notice.teams, users: recipients.length }, text.title);
  }
  await patchScheduleState(store, tenantId, patch);
}

/** Lauf mit Meldungen (Zeitplan und „Jetzt prüfen“) */
export function runShopWatchWithNotices(
  deps: ShopWatchDeps,
  tenantId: string | null,
  opts: { trigger: ShopWatchRun["trigger"]; cadence: "all" | "hourly" },
): Promise<ShopWatchRun> {
  return runShopWatch(deps.storage, tenantId, {
    trigger: opts.trigger,
    cadence: opts.cadence,
    fetchImpl: deps.fetchImpl,
    afterRun: (run) => afterShopWatchRun(deps, tenantId, run, opts.cadence),
  });
}

export type ShopWatchTickOutcome = "disabled" | "busy" | "deploy" | "all" | "hourly" | "idle";

/** Ein Takt für einen Mandanten */
export async function shopWatchTickForTenant(deps: ShopWatchDeps, tenantId: string | null): Promise<ShopWatchTickOutcome> {
  const store = deps.storage;
  if (!(await getShopWatchSettings(store, tenantId)).enabled) return "disabled";
  if (isShopWatchRunning(tenantId)) return "busy";
  const now = () => deps.now?.() ?? new Date();
  const state = await getShopWatchState(store, tenantId);

  if (state.lastRun) {
    const fp = await checkShopWatchFingerprint(store, tenantId, { fetchImpl: deps.fetchImpl });
    await patchScheduleState(store, tenantId, { lastFingerprintAt: now().toISOString() });
    if (!fp.complete) log.warn({ tenantId, fingerprint: fp.fingerprint }, "Shop-Wächter: Deploy-Merkmale unvollständig gelesen");
    if (fp.changes.length) {
      log.warn({ tenantId, changes: fp.changes }, "Shop-Wächter: Änderung erkannt, Vollprüfung");
      await runShopWatchWithNotices(deps, tenantId, { trigger: "deploy", cadence: "all" });
      return "deploy";
    }
  }

  const cadence = dueShopWatchCadence(await getShopWatchScheduleState(store, tenantId), state.lastRun?.startedAt, now());
  if (!cadence) return "idle";
  const run = await runShopWatchWithNotices(deps, tenantId, { trigger: "schedule", cadence });
  // Zwischen Abgleich und Lauf ausgerollt: Massendaten gleich mitprüfen
  if (cadence === "hourly" && run.deployChanges.length) {
    await runShopWatchWithNotices(deps, tenantId, { trigger: "deploy", cadence: "all" });
    return "deploy";
  }
  return cadence;
}

/** Ein Takt über alle Mandanten mit Shopware-Anbindung, nacheinander */
export async function runShopWatchTick(deps: ShopWatchDeps): Promise<void> {
  const tenants = await deps.storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  for (const tenantId of tenantIds) {
    await runWithTenantContext(tenantId, async () => {
      try {
        if (!(await deps.storage.getShopwareSettings(tenantId))) return;
        const outcome = await shopWatchTickForTenant(deps, tenantId);
        if (outcome !== "disabled" && outcome !== "idle") log.info({ tenantId, outcome }, "Shop-Wächter: Takt");
      } catch (err) {
        log.error({ err, tenantId }, "Shop-Wächter: Takt fehlgeschlagen");
      }
    });
  }
}

export function shopWatchDeps(storage: IStorage): ShopWatchDeps {
  return {
    storage,
    teamsWebhookUrl: async (tenantId) => (await getEmailIntakeSettings(storage, tenantId)).teamsWebhookUrl,
    onNotificationCreated: (n) => notificationEvents.emitNotificationCreated(n),
    baseUrl: publicAppBaseUrl(process.env.APP_URL?.trim() || null),
  };
}

/** Beim Serverstart: erster Takt nach 2 Minuten, danach alle 15 Minuten; Takte überlappen nie */
export function startShopWatchScheduler(storage: IStorage): () => void {
  const deps = shopWatchDeps(storage);
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runShopWatchTick(deps);
    } catch (err) {
      log.error({ err }, "Shop-Wächter: Takt fehlgeschlagen");
    } finally {
      ticking = false;
    }
  };
  const first = setTimeout(tick, 2 * 60 * 1000);
  const timer = setInterval(tick, SHOP_WATCH_TICK_MS);
  first.unref?.();
  timer.unref?.();
  log.info({ intervalMinutes: SHOP_WATCH_TICK_MS / 60000 }, "Shop-Wächter geplant");
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
