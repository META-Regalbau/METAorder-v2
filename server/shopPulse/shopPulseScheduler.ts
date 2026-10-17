/**
 * Shop-Puls, Zeitplan (Konzept Stufe 1, 17.10.2026). Takt alle 15 Minuten, je Mandant mit
 * Shopware-Anbindung und eingeschaltetem Shop-Puls (Settings shop_pulse_settings, Standard aus):
 *
 * 1. alle Prüfungen nacheinander (server/shopPulse/detectors), Funde → Meldungen (shopPulseSignals.ts)
 * 2. Sofort-Meldungen (kritisch, neu oder schlimmer) und Entwarnungen: Teams-Direktnachricht über n8n und
 *    Glocke der Administratoren
 * 3. Tagesbericht Montag bis Samstag ab 8 Uhr (Berlin), einmal je Tag, nur mit offenen Meldungen
 *
 * In der Lernwoche wird alles gesammelt, aber nichts gesendet. Mandanten nacheinander, nie zwei Läufe
 * für denselben Mandanten gleichzeitig.
 */
import { randomUUID } from "crypto";
import type { IStorage } from "../storage";
import type { InsertNotification, Notification } from "@shared/schema";
import { isLearning, type ShopPulseSignal, type ShopPulseSource, type ShopPulseState } from "@shared/shopPulse";
import { runWithTenantContext } from "../lib/tenantContext";
import { notificationEvents } from "../lib/events";
import { logger } from "../lib/logger";
import { enqueueTeamsMessage } from "../lib/teamsOutbox";
import { publicAppBaseUrl } from "../commercial/emailIntakeTeams";
import { berlinDayHour } from "../shopContent/shopWatchScheduler";
import { SHOP_PULSE_DETECTORS } from "./detectors";
import type { ShopPulseDetector } from "./detectors/types";
import * as repo from "./shopPulseRepository";
import { dailyReportSignals, reconcileSignals, type ReconcileResult, type ShopPulseNotice } from "./shopPulseSignals";
import {
  buildShopPulseBellText,
  buildShopPulseDailyBellText,
  buildShopPulseDailyCard,
  buildShopPulseNoticeCard,
  SHOP_PULSE_PAGE_PATH,
} from "./shopPulseNotify";
import { getShopPulseSettings, getShopPulseState, patchShopPulseState, SHOP_PULSE_TEAMS_OUTBOX_KEY } from "./shopPulseSettings";

const log = logger.child({ component: "shopPulse/shopPulseScheduler" });

export const SHOP_PULSE_TICK_MS = 15 * 60 * 1000;
const DAILY_FROM_HOUR = 8;
/** Später am Tag (z. B. nach einem Neustart) keinen Tagesbericht mehr nachschicken */
const DAILY_TO_HOUR = 12;

export type ShopPulseRepo = Pick<typeof repo, "listSignalsBySources" | "applyReconcile" | "listOpenSignals">;

export type ShopPulseDeps = {
  storage: Pick<IStorage, "getAllTenants" | "getShopwareSettings" | "getSetting" | "saveSetting" | "getUsersWithPermissionInTenant" | "createNotification" | "getShopwareSyncState">;
  repo: ShopPulseRepo;
  detectors: ShopPulseDetector[];
  onNotificationCreated: (n: Notification) => void;
  baseUrl: string | null;
  now?: () => Date;
  newId?: () => string;
};

const running = new Set<string>();
const lockKey = (tenantId: string | null) => tenantId ?? "__default__";

export function isShopPulseRunning(tenantId: string | null): boolean {
  return running.has(lockKey(tenantId));
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", weekday: "short" });

/** Tagesbericht fällig: Montag bis Samstag, 8 bis 12 Uhr Berlin, heute noch keiner */
export function isDailyReportDue(state: ShopPulseState, now: Date): boolean {
  const { day, hour } = berlinDayHour(now);
  if (WEEKDAY.format(now) === "Sun") return false;
  if (hour < DAILY_FROM_HOUR || hour >= DAILY_TO_HOUR) return false;
  return state.lastDailyReportDay !== day;
}

async function notifyAdmins(deps: ShopPulseDeps, tenantId: string | null, text: { title: string; message: string }, link: string): Promise<number> {
  // Seite nur für Administratoren; ein eigenes Recht gibt es (noch) nicht
  const recipients = await deps.storage.getUsersWithPermissionInTenant("viewShopPulse", tenantId, { includeAdministrators: true });
  for (const u of recipients) {
    try {
      const n: InsertNotification = {
        userId: u.id,
        type: "shop_pulse",
        title: text.title,
        message: text.message,
        link,
        ticketId: null,
        ticketNumber: null,
        read: 0,
      };
      deps.onNotificationCreated(await deps.storage.createNotification(n, tenantId));
    } catch (err) {
      log.warn({ err, tenantId, userId: u.id }, "Shop-Puls: Benachrichtigung nicht erstellt");
    }
  }
  return recipients.length;
}

export type ShopPulseRunResult = {
  detectors: NonNullable<ShopPulseState["detectors"]>;
  result: ReconcileResult;
  notices: ShopPulseNotice[];
  dailyReport: { sent: boolean; signals: number } | null;
};

/** Ein Lauf für einen Mandanten (Zeitplan und „Jetzt prüfen“) */
export async function runShopPulseForTenant(deps: ShopPulseDeps, tenantId: string | null): Promise<ShopPulseRunResult | null> {
  const key = lockKey(tenantId);
  if (running.has(key)) return null;
  running.add(key);
  try {
    const now = deps.now?.() ?? new Date();
    const settings = await getShopPulseSettings(deps.storage, tenantId);
    // Ausgeschaltet („Jetzt prüfen“) oder Lernwoche: sammeln, nichts senden
    const silent = !settings.enabled || isLearning(settings, now);

    // 1. Prüfungen nacheinander; eine Quelle ist vollständig, wenn alle ihre Prüfungen liefen
    const detections = [];
    const detectorState: NonNullable<ShopPulseState["detectors"]> = {};
    const failedSources = new Set<ShopPulseSource>();
    for (const d of deps.detectors) {
      try {
        const found = await d.run({ storage: deps.storage, tenantId, now });
        detections.push(...found);
        detectorState[d.id] = { at: now.toISOString(), ok: true, findings: found.length };
      } catch (err) {
        failedSources.add(d.source);
        detectorState[d.id] = { at: now.toISOString(), ok: false, error: err instanceof Error ? err.message.slice(0, 300) : String(err), findings: 0 };
        log.warn({ err, tenantId, detector: d.id }, "Shop-Puls: Prüfung fehlgeschlagen");
      }
    }
    const sources = Array.from(new Set(deps.detectors.map((d) => d.source)));
    const completeSources = sources.filter((s) => !failedSources.has(s));

    // 2. Abgleich mit den gespeicherten Meldungen
    const existing = await deps.repo.listSignalsBySources(tenantId, sources);
    const result = reconcileSignals(existing, detections, { now, learning: silent, completeSources, newId: deps.newId ?? randomUUID });
    await deps.repo.applyReconcile(tenantId, result);

    // 3. Sofort-Meldungen und Entwarnungen
    const webhook = settings.teamsWebhookUrl;
    for (const notice of result.notices) {
      if (webhook) await enqueueTeamsMessage(deps.storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId, buildShopPulseNoticeCard(notice, deps.baseUrl), now);
      await notifyAdmins(deps, tenantId, buildShopPulseBellText(notice), `${SHOP_PULSE_PAGE_PATH}?signal=${encodeURIComponent(notice.signal.id)}`);
      log.warn({ tenantId, kind: notice.kind, key: notice.signal.key, severity: notice.signal.severity, teams: !!webhook }, "Shop-Puls: Meldung");
    }

    // 4. Tagesbericht
    const state = await getShopPulseState(deps.storage, tenantId);
    let dailyReport: ShopPulseRunResult["dailyReport"] = null;
    const patch: Partial<ShopPulseState> = { lastTickAt: now.toISOString(), detectors: detectorState };
    if (settings.enabled && isDailyReportDue(state, now)) {
      patch.lastDailyReportDay = berlinDayHour(now).day;
      const open: ShopPulseSignal[] = dailyReportSignals(await deps.repo.listOpenSignals(tenantId), now);
      const send = !silent && open.length > 0;
      if (send) {
        if (webhook) await enqueueTeamsMessage(deps.storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId, buildShopPulseDailyCard(open, now, deps.baseUrl), now);
        await notifyAdmins(deps, tenantId, buildShopPulseDailyBellText(open, now), SHOP_PULSE_PAGE_PATH);
      }
      dailyReport = { sent: send, signals: open.length };
    }
    await patchShopPulseState(deps.storage, tenantId, patch);

    return { detectors: detectorState, result, notices: result.notices, dailyReport };
  } finally {
    running.delete(key);
  }
}

/** Ein Takt über alle Mandanten mit Shopware-Anbindung und eingeschaltetem Shop-Puls, nacheinander */
export async function runShopPulseTick(deps: ShopPulseDeps): Promise<void> {
  const tenants = await deps.storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  for (const tenantId of tenantIds) {
    await runWithTenantContext(tenantId, async () => {
      try {
        if (!(await deps.storage.getShopwareSettings(tenantId))) return;
        if (!(await getShopPulseSettings(deps.storage, tenantId)).enabled) return;
        const run = await runShopPulseForTenant(deps, tenantId);
        if (run && (run.result.inserts.length || run.notices.length || run.dailyReport?.sent)) {
          log.info({ tenantId, new: run.result.inserts.length, notices: run.notices.length, daily: run.dailyReport }, "Shop-Puls: Takt");
        }
      } catch (err) {
        log.error({ err, tenantId }, "Shop-Puls: Takt fehlgeschlagen");
      }
    });
  }
}

export function shopPulseDeps(storage: IStorage): ShopPulseDeps {
  return {
    storage,
    repo,
    detectors: SHOP_PULSE_DETECTORS,
    onNotificationCreated: (n) => notificationEvents.emitNotificationCreated(n),
    baseUrl: publicAppBaseUrl(process.env.APP_URL?.trim() || null),
  };
}

/** Beim Serverstart: erster Takt nach 3 Minuten, danach alle 15 Minuten; Takte überlappen nie */
export function startShopPulseScheduler(storage: IStorage): () => void {
  const deps = shopPulseDeps(storage);
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runShopPulseTick(deps);
    } catch (err) {
      log.error({ err }, "Shop-Puls: Takt fehlgeschlagen");
    } finally {
      ticking = false;
    }
  };
  const first = setTimeout(tick, 3 * 60 * 1000);
  const timer = setInterval(tick, SHOP_PULSE_TICK_MS);
  first.unref?.();
  timer.unref?.();
  log.info({ intervalMinutes: SHOP_PULSE_TICK_MS / 60000 }, "Shop-Puls geplant");
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
