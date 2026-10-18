/**
 * Shop-Puls, Zeitplan (Konzept Stufe 1, 17.10.2026). Takt alle 15 Minuten, je Mandant mit
 * Shopware-Anbindung und eingeschaltetem Shop-Puls (Settings shop_pulse_settings, Standard aus):
 *
 * 1. alle Prüfungen nacheinander (server/shopPulse/detectors), Funde → Meldungen (shopPulseSignals.ts)
 * 2. Sofort-Meldungen (kritisch, neu oder schlimmer) und Entwarnungen: Teams-Direktnachricht über n8n und
 *    Glocke der Administratoren
 * 3. Tagesbericht Montag bis Samstag ab 8 Uhr (Berlin), einmal je Tag: Zahlen von gestern (montags vom
 *    Wochenende) und die offenen Meldungen
 *
 * Hängt der Bestellabgleich (Fund der Spiegel-Frische), setzen die Umsatz-Prüfungen aus; ihre offenen
 * Meldungen bleiben offen, und der Tagesbericht lässt die Zahlen weg.
 *
 * Prüfungen mit cadence "nightly" (Kaufbarkeit der Artikel) laufen einmal je Nacht zwischen 5 und 7 Uhr
 * (Berlin), Prüfungen mit eigenem Takt (due, z. B. Warenkorb-Probe) nur wenn fällig; „Jetzt prüfen“
 * startet sie immer. Die Storefront-Prüfungen fragen den Shop unter der Sperre des Shop-Wächters ab; ist
 * sie belegt, setzen sie in diesem Takt aus.
 *
 * Ist die Warenkorb-Probe rot, wird eine gleichzeitig offene Bestell-Lücke kritisch (bestätigt). Sonst
 * gleicht der Live-Trichter aus GA4 sie ab: Trichter bis zur Kasse normal ohne Käufe → „Zahlung/Abschluss
 * gestört“ (kritisch), deutlich weniger Besucher → „Besucherproblem“. Ist GA4 nicht eingerichtet, setzen
 * die GA4-Prüfungen aus (Hinweis unter „Prüfungen“).
 *
 * In der Lernwoche wird alles gesammelt, aber nichts gesendet. Mandanten nacheinander, nie zwei Läufe
 * für denselben Mandanten gleichzeitig.
 */
import { randomUUID } from "crypto";
import type { IStorage } from "../storage";
import type { InsertNotification, Notification } from "@shared/schema";
import { isLearning, type ShopPulseDetection, type ShopPulseSignal, type ShopPulseSource, type ShopPulseState } from "@shared/shopPulse";
import { runWithTenantContext } from "../lib/tenantContext";
import { notificationEvents } from "../lib/events";
import { logger } from "../lib/logger";
import { enqueueTeamsMessage } from "../lib/teamsOutbox";
import { publicAppBaseUrl } from "../commercial/emailIntakeTeams";
import { berlinDayHour } from "../shopContent/shopWatchScheduler";
import { SHOP_PULSE_DETECTORS } from "./detectors";
import { MIRROR_SIGNAL_KEY } from "./detectors/mirrorFreshness";
import { dailyNumbers, type DailyNumbers } from "./detectors/revenue";
import { loadPulseOrders, type PulseOrder } from "./pulseOrders";
import type { BuyabilitySources, ChannelMethods, ShopPulseDetector, StorefrontAccess, StorefrontShop } from "./detectors/types";
import { loadBuyabilityProducts, loadPriceChanges, loadProductRevenue } from "./buyabilityData";
import { findDeChannel, shopApi } from "../shopContent/shopProducts";
import { ShopBusyError, withShopLock } from "../shopContent/shopWatch";
import { CART_PROBE_KEY, cartProbeDetector, confirmOrderGap } from "./detectors/storefront";
import { getGa4State, linkOrderGapWithGa4 } from "./detectors/ga4";
import { ga4Access, Ga4NotConfiguredError, type Ga4Access } from "./ga4Client";
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
/** So weit zurück lesen die Umsatz-Prüfungen den Spiegel (Vorjahreswoche + Puffer) */
const ORDERS_LOOKBACK_DAYS = 400;
/** Gewichtung der Kaufbarkeit: Umsatz der letzten 365 Tage */
const REVENUE_LOOKBACK_DAYS = 365;
const NIGHTLY_FROM_HOUR = 5;
const NIGHTLY_TO_HOUR = 7;
/** Pause zwischen zwei Storefront-Abrufen (Live schonen) */
const STOREFRONT_PAUSE_MS = 1000;

export type ShopPulseRepo = Pick<typeof repo, "listSignalsBySources" | "applyReconcile" | "listOpenSignals">;

export type ShopPulseDeps = {
  storage: Pick<IStorage, "getAllTenants" | "getShopwareSettings" | "getSetting" | "saveSetting" | "getUsersWithPermissionInTenant" | "createNotification" | "getShopwareSyncState">;
  repo: ShopPulseRepo;
  detectors: ShopPulseDetector[];
  loadOrders: (tenantId: string | null, since: Date) => Promise<PulseOrder[]>;
  /** Datenquellen der Kaufbarkeit (Spiegel, Preis-Historie, Admin-API); fehlt sie, scheitern deren Prüfungen */
  loadBuyability?: (tenantId: string | null, now: Date) => BuyabilitySources;
  /** Storefront des Shops (unter der Sperre des Shop-Wächters); fehlt sie, scheitern deren Prüfungen */
  loadStorefront?: (tenantId: string | null) => StorefrontAccess;
  /** GA4-Property des Mandanten; fehlt sie, gilt GA4 als nicht eingerichtet */
  loadGa4?: (tenantId: string | null) => Ga4Access;
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

type DetectorState = NonNullable<ShopPulseState["detectors"]>[string];

/** Nachtlauf fällig: noch nie gelaufen, oder 5–7 Uhr Berlin und heute noch nicht */
export function isNightlyDue(prev: DetectorState | undefined, now: Date): boolean {
  if (!prev) return true;
  const { day, hour } = berlinDayHour(now);
  return hour >= NIGHTLY_FROM_HOUR && hour < NIGHTLY_TO_HOUR && berlinDayHour(new Date(prev.at)).day !== day;
}

/** Daten nur einmal je Lauf laden */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= load());
}

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
  dailyReport: { sent: boolean; signals: number; numbers: boolean } | null;
};

/** Ein Lauf für einen Mandanten (Zeitplan und „Jetzt prüfen“; force: auch die Nachtläufe) */
export async function runShopPulseForTenant(deps: ShopPulseDeps, tenantId: string | null, opts: { force?: boolean } = {}): Promise<ShopPulseRunResult | null> {
  const key = lockKey(tenantId);
  if (running.has(key)) return null;
  running.add(key);
  try {
    const now = deps.now?.() ?? new Date();
    const settings = await getShopPulseSettings(deps.storage, tenantId);
    // Ausgeschaltet („Jetzt prüfen“) oder Lernwoche: sammeln, nichts senden
    const silent = !settings.enabled || isLearning(settings, now);

    const state = await getShopPulseState(deps.storage, tenantId);

    // Bestellungen und Kaufbarkeits-Daten höchstens einmal je Lauf lesen
    const orders = once(() => deps.loadOrders(tenantId, new Date(now.getTime() - ORDERS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)));
    const sources = deps.loadBuyability?.(tenantId, now);
    const missing = () => Promise.reject(new Error("Kaufbarkeits-Daten nicht verfügbar"));
    const buyability: BuyabilitySources = {
      products: once(sources?.products ?? missing),
      revenue: once(sources?.revenue ?? missing),
      priceChanges: (since) => (sources ? sources.priceChanges(since) : missing()),
      channelMethods: once(sources?.channelMethods ?? missing),
    };
    const storefront: StorefrontAccess = deps.loadStorefront?.(tenantId) ?? { withShop: () => Promise.reject(new Error("Storefront nicht verfügbar")) };
    const ga4: Ga4Access = deps.loadGa4?.(tenantId) ?? { property: () => Promise.reject(new Ga4NotConfiguredError("disabled")) };

    // 1. Prüfungen nacheinander; eine Quelle ist vollständig, wenn alle ihre Prüfungen liefen
    const detections: ShopPulseDetection[] = [];
    const detectorState: NonNullable<ShopPulseState["detectors"]> = {};
    const failedSources = new Set<ShopPulseSource>();
    const completePrefixes: string[] = [];
    const ran = new Set<string>();
    const mirrorStale = () => detections.some((d) => d.key === MIRROR_SIGNAL_KEY) || detectorState.mirrorFreshness?.ok === false;
    for (const d of deps.detectors) {
      const prev = state.detectors?.[d.id];
      const notDue = (d.cadence === "nightly" && !isNightlyDue(prev, now)) || (d.due !== undefined && !d.due(prev, now));
      if (notDue && !opts.force) {
        // nicht fällig: Stand des letzten Laufs behalten, Meldungen bleiben wie sie sind
        failedSources.add(d.source);
        if (prev) detectorState[d.id] = prev;
        continue;
      }
      if (d.needsFreshMirror && mirrorStale()) {
        // ausgesetzt: zählt als unvollständig, damit offene Meldungen nicht still erledigt werden
        failedSources.add(d.source);
        detectorState[d.id] = { at: now.toISOString(), ok: true, skipped: "mirror", findings: 0 };
        continue;
      }
      try {
        const found = await d.run({ storage: deps.storage, tenantId, now, orders, buyability, storefront, ga4, lastRunAt: prev?.ok ? prev.at : null });
        detections.push(...found);
        detectorState[d.id] = { at: now.toISOString(), ok: true, findings: found.length };
        ran.add(d.id);
        if (d.keyPrefix) completePrefixes.push(d.keyPrefix);
      } catch (err) {
        if (err instanceof ShopBusyError) {
          // Shop-Wächter fragt den Shop gerade ab: aussetzen, im nächsten Takt wieder
          failedSources.add(d.source);
          detectorState[d.id] = { at: now.toISOString(), ok: true, skipped: "busy", findings: 0 };
          continue;
        }
        if (err instanceof Ga4NotConfiguredError) {
          // GA4 nicht eingerichtet: keine Funde, offene GA4-Meldungen bleiben (kein „alles gut“)
          failedSources.add(d.source);
          detectorState[d.id] = { at: now.toISOString(), ok: true, skipped: "ga4", ga4Problem: err.reason, findings: 0 };
          continue;
        }
        failedSources.add(d.source);
        detectorState[d.id] = { at: now.toISOString(), ok: false, error: err instanceof Error ? err.message.slice(0, 300) : String(err), findings: 0 };
        log.warn({ err, tenantId, detector: d.id }, "Shop-Puls: Prüfung fehlgeschlagen");
      }
    }
    const allSources = Array.from(new Set(deps.detectors.map((d) => d.source)));
    const completeSources = allSources.filter((s) => !failedSources.has(s));

    // 2. Abgleich mit den gespeicherten Meldungen; Warenkorb-Probe rot (jetzt, oder nicht gelaufen und
    //    noch offen) bestätigt eine Bestell-Lücke
    const existing = await deps.repo.listSignalsBySources(tenantId, allSources);
    const cartRed =
      detections.some((d) => d.key === CART_PROBE_KEY && d.severity === "critical") ||
      (!ran.has(cartProbeDetector.id) && existing.some((s) => s.key === CART_PROBE_KEY && s.status === "open" && s.severity === "critical"));
    let linked = confirmOrderGap(detections, cartRed);
    if (!cartRed && linked.some((d) => d.code === "orderGap")) {
      // Live-Trichter (Stand des GA4-Live-Laufs) zur Bestell-Lücke; ohne Stand bleibt sie, wie sie ist
      const ga4State = await getGa4State({ storage: deps.storage, tenantId }).catch(() => null);
      linked = linkOrderGapWithGa4(linked, ga4State, now);
    }
    const result = reconcileSignals(existing, linked, {
      now,
      learning: silent,
      completeSources,
      completeKeyPrefixes: completePrefixes,
      newId: deps.newId ?? randomUUID,
    });
    await deps.repo.applyReconcile(tenantId, result);

    // 3. Sofort-Meldungen und Entwarnungen
    const webhook = settings.teamsWebhookUrl;
    for (const notice of result.notices) {
      if (webhook) await enqueueTeamsMessage(deps.storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId, buildShopPulseNoticeCard(notice, deps.baseUrl), now);
      await notifyAdmins(deps, tenantId, buildShopPulseBellText(notice), `${SHOP_PULSE_PAGE_PATH}?signal=${encodeURIComponent(notice.signal.id)}`);
      log.warn({ tenantId, kind: notice.kind, key: notice.signal.key, severity: notice.signal.severity, teams: !!webhook }, "Shop-Puls: Meldung");
    }

    // 4. Tagesbericht
    let dailyReport: ShopPulseRunResult["dailyReport"] = null;
    const patch: Partial<ShopPulseState> = { lastTickAt: now.toISOString(), detectors: detectorState };
    if (settings.enabled && isDailyReportDue(state, now)) {
      patch.lastDailyReportDay = berlinDayHour(now).day;
      const open: ShopPulseSignal[] = dailyReportSignals(await deps.repo.listOpenSignals(tenantId), now);
      let numbers: DailyNumbers | null = null;
      if (!mirrorStale()) {
        try {
          numbers = dailyNumbers(await orders(), now);
        } catch (err) {
          log.warn({ err, tenantId }, "Shop-Puls: Zahlen für den Tagesbericht nicht gelesen");
        }
      }
      const send = !silent && (open.length > 0 || numbers !== null);
      if (send) {
        if (webhook) await enqueueTeamsMessage(deps.storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId, buildShopPulseDailyCard(open, now, deps.baseUrl, numbers), now);
        await notifyAdmins(deps, tenantId, buildShopPulseDailyBellText(open, now, numbers), SHOP_PULSE_PAGE_PATH);
      }
      dailyReport = { sent: send, signals: open.length, numbers: numbers !== null };
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
    loadOrders: loadPulseOrders,
    loadBuyability: (tenantId, now) => ({
      products: () => loadBuyabilityProducts(tenantId),
      revenue: () => loadProductRevenue(tenantId, new Date(now.getTime() - REVENUE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)),
      priceChanges: (since) => loadPriceChanges(tenantId, since),
      channelMethods: async () => {
        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) throw new Error("Shopware settings not configured");
        return loadChannelMethods(settings);
      },
    }),
    loadStorefront: (tenantId) => storefrontAccess(storage, tenantId),
    loadGa4: (tenantId) => ga4Access(storage, tenantId),
    onNotificationCreated: (n) => notificationEvents.emitNotificationCreated(n),
    baseUrl: publicAppBaseUrl(process.env.APP_URL?.trim() || null),
  };
}

/** Storefront des Kanals META Regalbau DE, je Zugriff unter der Sperre des Shop-Wächters */
export function storefrontAccess(storage: Pick<IStorage, "getShopwareSettings">, tenantId: string | null): StorefrontAccess {
  let shop: Promise<StorefrontShop> | null = null;
  const load = async (): Promise<StorefrontShop> => {
    const settings = await storage.getShopwareSettings(tenantId);
    if (!settings) throw new Error("Shopware settings not configured");
    const { api, base } = shopApi(settings);
    const channel = await findDeChannel(api, base);
    return { storefront: channel.domain, channelId: channel.id, api, pauseMs: STOREFRONT_PAUSE_MS };
  };
  return {
    withShop: (fn) =>
      withShopLock(tenantId, async () => {
        shop ??= load().catch((err) => {
          shop = null;
          throw err;
        });
        return fn(await shop);
      }),
  };
}

/** Zahl- und Versandarten des Kanals META Regalbau DE mit Aktiv-Kennzeichen (zwei Abfragen, nacheinander) */
export async function loadChannelMethods(settings: Parameters<typeof shopApi>[0]): Promise<ChannelMethods> {
  const { api, base } = shopApi(settings);
  const de = await findDeChannel(api, base);
  const res = await api("POST", "search/sales-channel", {
    ids: [de.id],
    associations: { paymentMethods: {}, shippingMethods: {} },
    includes: {
      sales_channel: ["id", "paymentMethods", "shippingMethods"],
      payment_method: ["id", "name", "translated", "active"],
      shipping_method: ["id", "name", "translated", "active"],
    },
  });
  const channel = res?.data?.[0];
  if (!channel) throw new Error("Verkaufskanal META Regalbau DE nicht gelesen");
  const map = (list: any[] | undefined) =>
    (list ?? []).map((m) => ({ id: String(m.id), name: String(m.translated?.name ?? m.name ?? m.id), active: m.active === true }));
  return { payment: map(channel.paymentMethods), shipping: map(channel.shippingMethods) };
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
