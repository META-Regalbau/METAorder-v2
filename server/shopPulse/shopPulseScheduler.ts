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
 * KI-Texte (PR F, Einstellung „KI-Texte“, nur mit eingerichtetem KI-Anbieter): Sofort-Meldungen und die
 * Zusammenfassung des Tagesberichts formuliert die KI, geprüft gegen die Eingabedaten (shopPulseAi.ts);
 * sonst die feste Vorlage. Je Meldung höchstens ein Aufruf je Schwere; je Lauf bekommen außerdem bis zu
 * drei offene Meldungen ohne Text einen (Warnungen, Lernwoche). Wo eine Prüfung keinen Verlust schätzt,
 * schätzt lossEstimate.ts ihn aus dem Spiegel.
 *
 * Stufe 2 (S2-1): Jeder Takt zieht das Maßnahmen-Protokoll aus den automatischen Quellen nach
 * (actionSync.ts). Montags ab 8 Uhr geht statt des Tagesberichts der Wochenbericht der abgeschlossenen
 * Woche raus (weeklyReport.ts, weeklyReportRun.ts) und landet im Archiv; scheitert er, kommt wie bisher der
 * Tagesbericht. In der Lernwoche wird er nur archiviert.
 *
 * Stufe 2 (S2-2): Die Angebotsanfragen-Wache (detectors/offers.ts) liest einmal je Stunde die offenen
 * B2B-Angebotsanfragen; der Tagesbericht nennt sie zusammengefasst, der Wochenbericht zusätzlich den
 * B2B-Anteil der Shop-Bestellungen.
 *
 * Stufe 2 (S2-3): Ist der Schalter „Warenkorb-Alarm“ an (Standard aus), prüft jeder Takt die vom Plugin
 * gemeldeten Warenkörbe (cartAlarmRun.ts) und schickt Alarme an den Außendienst; in der Lernwoche nicht.
 *
 * Stufe 2 (S2-4): Google Ads einmal am Tag (detectors/ads.ts), nur lesend; ohne Einrichtung setzt die
 * Prüfung aus wie GA4 (skipped "ads").
 *
 * Stufe 2 (S2-5): Search Console einmal am Tag ab 9 Uhr (detectors/gsc.ts), nur lesend; ohne Einrichtung setzt
 * sie aus (skipped "gsc"). Die URL-Prüfung fragt die Storefront-Adresse unter der Sperre des Shop-Wächters ab.
 *
 * Stufe 2 (S2-6): Einmal am Tag ab 5 Uhr rechnet effectsRun.ts die Wirkung der Maßnahmen neu (nicht, wenn
 * der Bestellabgleich hängt); der Wochenbericht nennt die gesicherten Wirkungen.
 *
 * Stufe 3 (S3-1): Jeder Takt erledigt Weitergaben, deren Meldung erledigt ist, und erinnert nach 2 Werktagen
 * (handoffRun.ts); montags ab 8 Uhr geht die Jana-Liste an Oliver. Neue Suchbegriffe ohne Treffer aus der
 * GA4-Meldung werden geprüft und eindeutige (außerhalb der Lernwoche) am Produkt eingetragen
 * (searchKeywordsRun.ts).
 *
 * Stufe 3 (S3-3): Die Zahlungsanbieter-Wache (detectors/payments.ts) liest jeden Takt den Zahlungsstatus der
 * Shop-Bestellungen aus dem Spiegel (auch stornierte): zwei Fehlschläge in Folge bei einer Zahlart, die sonst
 * klappt, sind kritisch; hängende Online-Zahlungen nach 24 Stunden stehen als Liste im Tagesbericht.
 *
 * Stufe 3 (S3-4): Einmal am Tag (Mo–Fr ab 8 Uhr) prüft die Stammkunden-Wache (regularsRun.ts), welche Kunden
 * überfällig sind, und meldet sie an den Außendienst bzw. Oliver (höchstens einmal in 90 Tagen je Kunde).
 *
 * Stufe 3 (S3-5): Ladezeit einmal am Tag ab 7 Uhr (detectors/speed.ts): Template-Kommentare der Startseite
 * immer, PageSpeed-Messungen je Seitentyp nur mit API-Schlüssel (sonst skipped "speed").
 *
 * Stufe 3 (S3-6): Google Merchant Center einmal am Tag ab 7 Uhr (detectors/merchant.ts), nur lesend; ohne
 * Einrichtung setzt es aus (skipped "merchant").
 *
 * In der Lernwoche wird alles gesammelt, aber nichts gesendet. Mandanten nacheinander, nie zwei Läufe
 * für denselben Mandanten gleichzeitig.
 */
import { randomUUID } from "crypto";
import type { IStorage } from "../storage";
import type { InsertNotification, Notification } from "@shared/schema";
import {
  isLearning,
  needsAiNote,
  type ShopPulseDetection,
  type ShopPulseLossEstimate,
  type ShopPulseSignal,
  type ShopPulseSource,
  type ShopPulseState,
} from "@shared/shopPulse";
import { runWithTenantContext } from "../lib/tenantContext";
import { notificationEvents } from "../lib/events";
import { logger } from "../lib/logger";
import { enqueueTeamsMessage } from "../lib/teamsOutbox";
import { publicAppBaseUrl } from "../commercial/emailIntakeTeams";
import { berlinDayHour } from "../shopContent/shopWatchScheduler";
import { SHOP_PULSE_DETECTORS } from "./detectors";
import { MIRROR_SIGNAL_KEY } from "./detectors/mirrorFreshness";
import { dailyNumbers, type DailyNumbers } from "./detectors/revenue";
import { loadPaymentOrders, loadPulseOrders, type PulseOrder } from "./pulseOrders";
import type { PaymentOrder, PaymentSources } from "./detectors/payments";
import type { SpeedSources } from "./detectors/speed";
import type { MerchantSources } from "./detectors/merchant";
import { merchantAccess, MerchantNotConfiguredError } from "./merchantClient";
import { loadEanMap } from "./buyabilityData";
import { DEFAULT_PAGE_PATHS, getPageSpeedSettings, measurePage, PAGE_SPEED_HISTORY_KEY, SpeedNotConfiguredError, type SpeedHistory } from "./pageSpeed";
import { getShopWatchState } from "../shopContent/shopWatch";
import { classifyDeployChanges } from "@shared/shopWatch";
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
  dailyAiText,
  lossEstimateFor,
  shopPulseAiDeps,
  writeBacklogNotes,
  writeSignalNote,
  type ShopPulseAiDeps,
  type ShopPulseAiRun,
} from "./shopPulseAi";
import {
  buildShopPulseBellText,
  buildShopPulseDailyBellText,
  buildShopPulseDailyCard,
  buildShopPulseNoticeCard,
  SHOP_PULSE_PAGE_PATH,
} from "./shopPulseNotify";
import { getShopPulseSettings, getShopPulseState, patchShopPulseState, SHOP_PULSE_TEAMS_OUTBOX_KEY } from "./shopPulseSettings";
import { buildShopPulseWeeklyBellText, buildShopPulseWeeklyCard } from "./shopPulseNotify";
import { isWeeklyReportDue, reportedWeekStart } from "./weeklyReport";
import { buildWeeklyReport, shopPulseWeeklyDeps, type ShopPulseWeeklyDeps } from "./weeklyReportRun";
import { syncActionLog } from "./actionSync";
import { isEffectsDue, refreshEffects, shopPulseEffectsDeps } from "./effectsRun";
import { adsAccess, AdsNotConfiguredError } from "./adsClient";
import { gscAccess, GscNotConfiguredError } from "./gscClient";
import { GSC_INDEX_STATE_KEY, gscCatalogPaths, type GscIndexState, type GscSources } from "./detectors/gsc";
import { listActions } from "./actionLogRepository";
import type { AdsSources } from "./detectors/ads";
import { avgDb1PerOrder } from "./weeklyReport";
import { loadHerstellpreiseForNumbers } from "./weeklyReportRun";
import { getCartSettings, listCarts, loadSalesReps, markCartAlarmed, markCartOrdered, purgeCarts, rowToCart, runCartAlarm, type CartAlarmDeps } from "./cartAlarmRun";
import { insertCandidates } from "./actionLogRepository";
import { sendEmail } from "../email/emailOutbound";
import type { OfferWatchSources } from "./detectors/offers";
import { offerWatchSources } from "./offerRequests";
import { offerSummary } from "./weeklyReport";
import type { ShopPulseWeeklyReport } from "@shared/shopPulseWeekly";
import { handoffDeps, runHandoffReminders, sendJanaList } from "./handoffRun";
import { getRegularState, isRegularsDue, listRegularRows, loadRegularOrders, loadRegularPriceChanges, loadRegularProducts, runRegulars, saveRegularRow, type RegularDeps } from "./regularsRun";
import { keywordDeps, runKeywordSuggestions, type KeywordRunResult } from "./searchKeywordsRun";

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
  /** Search Console (S2-5); fehlt sie, gilt sie als nicht eingerichtet */
  loadGsc?: (tenantId: string | null, storefront: StorefrontAccess) => GscSources;
  /** Google Ads (S2-4); fehlt es, gilt Ads als nicht eingerichtet */
  loadAds?: (tenantId: string | null) => AdsSources;
  /** Google Merchant Center (S3-6); fehlt es, gilt es als nicht eingerichtet */
  loadMerchant?: (tenantId: string | null) => MerchantSources;
  /** PageSpeed-Insights (S3-5); fehlt es, gilt PageSpeed als nicht eingerichtet */
  loadSpeed?: (tenantId: string | null) => SpeedSources;
  /** Zahlungsstatus der Shop-Bestellungen (S3-3); fehlt er, scheitert die Zahlungsanbieter-Wache */
  loadPayments?: (tenantId: string | null, since: Date) => Promise<PaymentOrder[]>;
  /** B2B-Angebotsanfragen (S2-2); fehlt sie, scheitert die Angebotsanfragen-Wache */
  loadOfferWatch?: (tenantId: string | null, now: Date) => OfferWatchSources;
  /** KI-Texte (PR F); fehlt sie, gehen immer die festen Vorlagen raus */
  ai?: ShopPulseAiDeps;
  /** Wochenbericht (Stufe 2); fehlt er, kommt auch montags der Tagesbericht */
  weekly?: ShopPulseWeeklyDeps;
  /** Maßnahmen-Protokoll nachziehen (Stufe 2); fehlt es, ruht die Übernahme */
  syncActions?: (tenantId: string | null, now: Date) => Promise<unknown>;
  /** Wirkung der Maßnahmen neu rechnen (Stufe 2, S2-6); fehlt sie, ruht die Wirkungsmessung */
  refreshEffects?: (tenantId: string | null, now: Date) => Promise<unknown>;
  /** B2B-Warenkorb-Alarm (Stufe 2, S2-3); fehlt er, ruht der Alarm */
  cartAlarm?: CartAlarmDeps;
  /** Stufe 3 (S3-4): Stammkunden-Wache (einmal am Tag); fehlt sie, ruht sie */
  regulars?: RegularDeps;
  /** Stufe 3 (S3-1): Erinnerungen an Weitergaben, Jana-Liste, Suchwörter; fehlt es, ruht das */
  followUp?: {
    reminders: (tenantId: string | null, now: Date) => Promise<{ done: number; reminded: number }>;
    janaList: (tenantId: string | null, now: Date) => Promise<unknown>;
    keywords: (tenantId: string | null, signals: ShopPulseSignal[], now: Date, opts: { allowApply: boolean }) => Promise<KeywordRunResult>;
  };
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

async function notifyAdmins(deps: Pick<ShopPulseDeps, "storage" | "onNotificationCreated">, tenantId: string | null, text: { title: string; message: string }, link: string): Promise<number> {
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
  weeklyReport: { sent: boolean; weekStart: string; levers: number; numbers: boolean } | null;
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
    const ads: AdsSources = deps.loadAds?.(tenantId) ?? { account: () => Promise.reject(new AdsNotConfiguredError("disabled")), avgDb1PerOrder: async () => null };
    const gsc: GscSources = deps.loadGsc?.(tenantId, storefront) ?? noGsc;
    const noOffers = () => Promise.reject(new Error("Angebotsanfragen nicht verfügbar"));
    const b2b: OfferWatchSources = deps.loadOfferWatch?.(tenantId, now) ?? { requests: noOffers, salesReps: noOffers, defaultAssignee: noOffers, channelNames: noOffers };
    const speed: SpeedSources = deps.loadSpeed?.(tenantId) ?? noSpeed;
    const merchant: MerchantSources = deps.loadMerchant?.(tenantId) ?? { account: () => Promise.reject(new MerchantNotConfiguredError("disabled")), eans: async () => new Map() };
    const payments: PaymentSources = { orders: (since) => (deps.loadPayments ? deps.loadPayments(tenantId, since) : Promise.reject(new Error("Zahlungsdaten nicht verfügbar"))) };

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
        const found = await d.run({ storage: deps.storage, tenantId, now, orders, buyability, storefront, ga4, b2b, ads, gsc, payments, speed, merchant, lastRunAt: prev?.ok ? prev.at : null, firstRun: !prev });
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
        if (err instanceof MerchantNotConfiguredError) {
          // Merchant Center nicht eingerichtet: aussetzen, Hinweis auf der Seite
          failedSources.add(d.source);
          detectorState[d.id] = { at: now.toISOString(), ok: true, skipped: "merchant", merchantProblem: err.reason, findings: 0 };
          continue;
        }
        if (err instanceof SpeedNotConfiguredError) {
          // PageSpeed nicht eingerichtet (kein Schlüssel): aussetzen, Hinweis auf der Seite
          failedSources.add(d.source);
          detectorState[d.id] = { at: now.toISOString(), ok: true, skipped: "speed", speedProblem: err.reason, findings: 0 };
          continue;
        }
        if (err instanceof GscNotConfiguredError) {
          // Search Console nicht eingerichtet: aussetzen, offene Meldungen bleiben
          failedSources.add(d.source);
          detectorState[d.id] = { at: now.toISOString(), ok: true, skipped: "gsc", gscProblem: err.reason, findings: 0 };
          continue;
        }
        if (err instanceof AdsNotConfiguredError) {
          // Google Ads nicht eingerichtet: wie GA4 aussetzen, offene Ads-Meldungen bleiben
          failedSources.add(d.source);
          detectorState[d.id] = { at: now.toISOString(), ok: true, skipped: "ads", adsProblem: err.reason, findings: 0 };
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

    // Maßnahmen-Protokoll: neue Live-Veröffentlichungen, erledigte Meldungen, Deploys, Preisänderungen
    if (deps.syncActions) {
      try {
        await deps.syncActions(tenantId, now);
      } catch (err) {
        log.warn({ err, tenantId }, "Shop-Puls: Maßnahmen-Protokoll nicht abgeglichen");
      }
    }

    // Warenkorb-Alarm (eigener Schalter, Standard aus); in der Lernwoche nichts senden
    if (deps.cartAlarm) {
      try {
        const cart = await runCartAlarm(deps.cartAlarm, tenantId, now, { silent, pageUrl: deps.baseUrl ? `${deps.baseUrl}${SHOP_PULSE_PAGE_PATH}?tab=cart` : null });
        if (cart && (cart.alarms || cart.won)) log.info({ tenantId, ...cart }, "Shop-Puls: Warenkorb-Alarm");
      } catch (err) {
        log.warn({ err, tenantId }, "Shop-Puls: Warenkorb-Alarm fehlgeschlagen");
      }
    }

    // Stufe 3 (S3-1): Weitergaben erledigen bzw. erinnern, Jana-Liste (montags), Suchwörter aus der GA4-Meldung.
    // Erinnerungen und Jana-Liste nur bei eingeschaltetem Shop-Puls; Suchwörter werden immer geprüft, aber nur
    // bei eingeschaltetem Shop-Puls außerhalb der Lernwoche eingetragen.
    if (deps.followUp && settings.enabled) {
      try {
        const r = await deps.followUp.reminders(tenantId, now);
        if (r.done || r.reminded) log.info({ tenantId, ...r }, "Shop-Puls: Weitergaben");
      } catch (err) {
        log.warn({ err, tenantId }, "Shop-Puls: Erinnerungen an Weitergaben fehlgeschlagen");
      }
      try {
        await deps.followUp.janaList(tenantId, now);
      } catch (err) {
        log.warn({ err, tenantId }, "Shop-Puls: Jana-Liste fehlgeschlagen");
      }
    }
    if (deps.followUp) {
      try {
        const k = await deps.followUp.keywords(tenantId, await deps.repo.listOpenSignals(tenantId), now, { allowApply: !silent });
        if (k.checked || k.applied) log.info({ tenantId, ...k }, "Shop-Puls: Suchwörter");
      } catch (err) {
        log.warn({ err, tenantId }, "Shop-Puls: Suchwörter fehlgeschlagen");
      }
    }

    // Stammkunden-Wache (S3-4): einmal am Tag Mo–Fr ab 8 Uhr, nur mit frischem Bestellspiegel; senden nicht in der Lernwoche
    if (deps.regulars && !mirrorStale() && isRegularsDue(await getRegularState(deps.storage, tenantId), now)) {
      try {
        const r = await runRegulars(deps.regulars, tenantId, now, { silent });
        if (r && (r.alerts || r.won || r.backlog)) log.info({ tenantId, ...r }, "Shop-Puls: Stammkunden");
      } catch (err) {
        log.warn({ err, tenantId }, "Shop-Puls: Stammkunden-Wache fehlgeschlagen");
      }
    }

    // Wirkung der Maßnahmen: einmal am Tag, nur mit frischem Bestellspiegel
    const patchEffects: Partial<ShopPulseState> = {};
    if (deps.refreshEffects && !mirrorStale() && isEffectsDue(state.lastEffectsDay, now)) {
      patchEffects.lastEffectsDay = berlinDayHour(now).day;
      try {
        await deps.refreshEffects(tenantId, now);
      } catch (err) {
        log.warn({ err, tenantId }, "Shop-Puls: Wirkung nicht berechnet");
      }
    }

    // KI nur bei eingeschaltetem Shop-Puls, Schalter „KI-Texte“ und eingerichtetem Anbieter
    const aiOn = !!deps.ai && settings.enabled && settings.aiTexts && (await deps.ai.configured(tenantId).catch(() => false));
    const aiRun: ShopPulseAiRun = {
      tenantId,
      now,
      ai: aiOn ? deps.ai! : null,
      // Hängt der Bestellabgleich, keine Schätzung aus dem Spiegel
      orders: () => (mirrorStale() ? Promise.reject(new Error("Bestellabgleich hängt")) : orders()),
      productRevenue: buyability.revenue,
      openSignals: once(() => deps.repo.listOpenSignals(tenantId)),
    };
    const withAi = aiRun.ai ? { ...aiRun, ai: aiRun.ai } : null;

    // 3. Sofort-Meldungen und Entwarnungen (KI-Text, sonst Vorlage)
    const webhook = settings.teamsWebhookUrl;
    const written = new Set<string>();
    for (const notice of result.notices) {
      let estimate: ShopPulseLossEstimate | null = null;
      if (notice.kind !== "resolved") {
        estimate = await lossEstimateFor(notice.signal, aiRun);
        if (withAi && needsAiNote(notice.signal)) {
          notice.signal.aiNote = await writeSignalNote(notice.signal, estimate, withAi);
          written.add(notice.signal.id);
        }
      }
      if (webhook) await enqueueTeamsMessage(deps.storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId, buildShopPulseNoticeCard(notice, deps.baseUrl, estimate), now);
      await notifyAdmins(deps, tenantId, buildShopPulseBellText(notice), `${SHOP_PULSE_PAGE_PATH}?signal=${encodeURIComponent(notice.signal.id)}`);
      log.warn(
        { tenantId, kind: notice.kind, key: notice.signal.key, severity: notice.signal.severity, teams: !!webhook, ai: notice.signal.aiNote?.text ? "text" : (notice.signal.aiNote?.rejected ?? null) },
        "Shop-Puls: Meldung",
      );
    }
    // Offene Meldungen ohne KI-Text nachziehen (begrenzt), damit die Seite sie zeigt
    if (withAi) {
      try {
        await writeBacklogNotes(withAi, written);
      } catch (err) {
        log.warn({ err, tenantId }, "Shop-Puls: KI-Texte für offene Meldungen nicht geschrieben");
      }
    }

    // 4. Wochenbericht (montags) bzw. Tagesbericht
    let dailyReport: ShopPulseRunResult["dailyReport"] = null;
    let weeklyReport: ShopPulseRunResult["weeklyReport"] = null;
    const patch: Partial<ShopPulseState> = { lastTickAt: now.toISOString(), detectors: detectorState, ...patchEffects };
    if (settings.enabled && deps.weekly && isWeeklyReportDue(state, now)) {
      try {
        const report = await buildAndSaveWeeklyReport(deps, deps.weekly, {
          tenantId,
          now,
          mirrorStale: mirrorStale(),
          send: !silent,
          ai: silent ? null : (withAi?.ai ?? null),
          aiRun,
        });
        patch.lastWeeklyReportWeek = report.weekStart;
        // ersetzt den Tagesbericht dieses Montags
        patch.lastDailyReportDay = berlinDayHour(now).day;
        weeklyReport = { sent: !!report.sentAt && !silent, weekStart: report.weekStart, levers: report.data.levers.length, numbers: report.data.numbers !== null };
      } catch (err) {
        log.error({ err, tenantId }, "Shop-Puls: Wochenbericht fehlgeschlagen, Tagesbericht statt dessen");
        patch.lastWeeklyReportWeek = reportedWeekStart(now);
      }
    }
    if (settings.enabled && !weeklyReport && isDailyReportDue(state, now)) {
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
        let aiSummary: string | null = null;
        if (withAi) {
          const daily = await dailySummary(withAi, open, numbers);
          aiSummary = daily.text;
          patch.lastDailyAi = daily;
        }
        const offers = offerSummary(open);
        if (webhook) await enqueueTeamsMessage(deps.storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId, buildShopPulseDailyCard(open, now, deps.baseUrl, numbers, aiSummary, offers), now);
        await notifyAdmins(deps, tenantId, buildShopPulseDailyBellText(open, now, numbers, aiSummary, offers), SHOP_PULSE_PAGE_PATH);
      }
      dailyReport = { sent: send, signals: open.length, numbers: numbers !== null };
    }
    await patchShopPulseState(deps.storage, tenantId, patch);

    return { detectors: detectorState, result, notices: result.notices, dailyReport, weeklyReport };
  } finally {
    running.delete(key);
  }
}

/**
 * Wochenbericht der abgeschlossenen Woche bauen, im Archiv speichern und (send) über Teams und die Glocke
 * schicken. Auch für „Jetzt erstellen“ auf der Seite (send false).
 */
export async function buildAndSaveWeeklyReport(
  deps: Pick<ShopPulseDeps, "storage" | "repo" | "onNotificationCreated" | "baseUrl">,
  weekly: ShopPulseWeeklyDeps,
  opts: { tenantId: string | null; now: Date; mirrorStale: boolean; send: boolean; ai: ShopPulseAiDeps | null; aiRun: Pick<ShopPulseAiRun, "now" | "orders" | "productRevenue"> },
): Promise<ShopPulseWeeklyReport> {
  const { tenantId, now } = opts;
  const open = dailyReportSignals(await deps.repo.listOpenSignals(tenantId), now);
  const built = await buildWeeklyReport(weekly, {
    tenantId,
    now,
    mirrorStale: opts.mirrorStale,
    openSignals: open,
    estimateFor: (s) => lossEstimateFor(s, opts.aiRun),
    ai: opts.ai,
  });
  const report = await weekly.saveReport(tenantId, { ...built, sentAt: opts.send ? now : null });
  if (opts.send) {
    const settings = await getShopPulseSettings(deps.storage, tenantId);
    if (settings.teamsWebhookUrl) await enqueueTeamsMessage(deps.storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId, buildShopPulseWeeklyCard(report, deps.baseUrl), now);
    await notifyAdmins(deps, tenantId, buildShopPulseWeeklyBellText(report), `${SHOP_PULSE_PAGE_PATH}?tab=weekly&week=${encodeURIComponent(report.weekStart)}`);
    log.info({ tenantId, weekStart: report.weekStart, levers: report.data.levers.length, ai: report.ai?.text ? "text" : (report.ai?.rejected ?? null) }, "Shop-Puls: Wochenbericht gesendet");
  }
  return report;
}

/** KI-Zusammenfassung des Tagesberichts (geprüft); null-Text = Vorlage */
async function dailySummary(run: ShopPulseAiRun & { ai: ShopPulseAiDeps }, open: ShopPulseSignal[], numbers: DailyNumbers | null): Promise<NonNullable<ShopPulseState["lastDailyAi"]>> {
  const estimates = new Map<string, ShopPulseLossEstimate | null>();
  for (const s of open.slice(0, 12)) estimates.set(s.id, await lossEstimateFor(s, run));
  const deploys = await run.ai.deploys(run.tenantId, new Date(run.now.getTime() - 48 * 60 * 60 * 1000)).catch(() => []);
  const r = await dailyAiText({ now: run.now, signals: open, numbers, estimates, deploys }, (m) => run.ai.ask(run.tenantId, m), run.ai.timeoutMs);
  if (r.rejected) log.warn({ tenantId: run.tenantId, rejected: r.rejected, badNumbers: r.badNumbers }, "Shop-Puls: KI-Tagesbericht verworfen, Vorlage");
  return { at: run.now.toISOString(), text: r.text, ...(r.rejected ? { rejected: r.rejected } : {}) };
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
        if (run && (run.result.inserts.length || run.notices.length || run.dailyReport?.sent || run.weeklyReport)) {
          log.info({ tenantId, new: run.result.inserts.length, notices: run.notices.length, daily: run.dailyReport, weekly: run.weeklyReport }, "Shop-Puls: Takt");
        }
      } catch (err) {
        log.error({ err, tenantId }, "Shop-Puls: Takt fehlgeschlagen");
      }
    });
  }
}

export function shopPulseDeps(storage: IStorage): ShopPulseDeps {
  const effectsDeps = shopPulseEffectsDeps(storage);
  return {
    storage,
    repo,
    detectors: SHOP_PULSE_DETECTORS,
    loadOrders: loadPulseOrders,
    loadPayments: loadPaymentOrders,
    loadSpeed: (tenantId) => speedSources(storage, tenantId),
    loadMerchant: (tenantId) => ({ ...merchantAccess(storage, tenantId), eans: () => loadEanMap(tenantId) }),
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
    loadAds: (tenantId) => adsSources(storage, tenantId),
    loadGsc: (tenantId, storefront) => gscSources(storage, tenantId, storefront),
    loadOfferWatch: (tenantId, now) => offerWatchSources(storage, tenantId, now),
    ai: shopPulseAiDeps(storage),
    weekly: { ...shopPulseWeeklyDeps(storage), effects: (tenantId, now) => refreshEffects(effectsDeps, tenantId, now) },
    syncActions: (tenantId, now) => syncActionLog(storage, tenantId, now),
    refreshEffects: (tenantId, now) => refreshEffects(effectsDeps, tenantId, now),
    cartAlarm: cartAlarmDeps(storage),
    followUp: followUpDeps(storage),
    regulars: regularDeps(storage),
    onNotificationCreated: (n) => notificationEvents.emitNotificationCreated(n),
    baseUrl: publicAppBaseUrl(process.env.APP_URL?.trim() || null),
  };
}

/** Google Ads des Mandanten und Ø Deckungsbeitrag je MO-Bestellung (Spiegel, Herstellpreise) */
export function adsSources(storage: IStorage, tenantId: string | null): AdsSources {
  const access = adsAccess(storage, tenantId);
  return {
    account: () => access.account(),
    avgDb1PerOrder: async (from, to) => {
      const orders = await loadPulseOrders(tenantId, new Date(Date.parse(`${from}T00:00:00Z`) - 2 * 60 * 60 * 1000), { items: true });
      const numbers = Array.from(new Set(orders.flatMap((o) => (o.items ?? []).map((i) => i.productNumber))));
      const hk = await loadHerstellpreiseForNumbers(storage, tenantId, numbers);
      return avgDb1PerOrder(orders, from, to, (pn) => hk.get(pn) ?? null);
    },
  };
}

const noSpeed: SpeedSources = {
  settings: async () => ({ enabled: false, apiKey: "", paths: { ...DEFAULT_PAGE_PATHS } }),
  history: async () => ({ days: [] }),
  saveHistory: async () => undefined,
  lastDeploy: async () => null,
  measure: () => Promise.reject(new SpeedNotConfiguredError("disabled")),
};

/** PageSpeed des Mandanten: Einstellungen, Verlauf, letzter Deploy laut Shop-Wächter */
export function speedSources(storage: IStorage, tenantId: string | null): SpeedSources {
  return {
    settings: () => getPageSpeedSettings(storage, tenantId),
    history: async () => {
      const raw = await storage.getSetting(PAGE_SPEED_HISTORY_KEY, tenantId);
      return raw && typeof raw === "object" && Array.isArray((raw as SpeedHistory).days) ? (raw as SpeedHistory) : { days: [] };
    },
    saveHistory: (history) => storage.saveSetting(PAGE_SPEED_HISTORY_KEY, history, tenantId).then(() => undefined),
    lastDeploy: async () => {
      const state = await getShopWatchState(storage, tenantId);
      const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const d = (state.history ?? []).find((h) => classifyDeployChanges(h.deployChanges ?? []) === "deploy" && Date.parse(h.startedAt) >= since);
      return d ? { at: d.startedAt, changes: (d.deployChanges ?? []).map((c) => `${c.field}: ${c.before || "–"} → ${c.after || "–"}`).join("; ") } : null;
    },
    measure: (apiKey, type, url) => measurePage(apiKey, type, url),
  };
}

const noGsc: GscSources = {
  property: () => Promise.reject(new GscNotConfiguredError("disabled")),
  actions: async () => [],
  catalogPaths: () => [],
  shopBaseUrl: () => Promise.reject(new Error("Storefront nicht verfügbar")),
  indexState: async () => ({}),
  saveIndexState: async () => undefined,
};

/** Search Console des Mandanten, eigene Seiten aus dem Wächter-Katalog, Storefront-Adresse für die URL-Prüfung */
export function gscSources(storage: IStorage, tenantId: string | null, storefront: StorefrontAccess): GscSources {
  const access = gscAccess(storage, tenantId);
  return {
    property: () => access.property(),
    actions: (since) => listActions(tenantId, { from: since, limit: 2000 }),
    catalogPaths: gscCatalogPaths,
    shopBaseUrl: () => storefront.withShop(async (shop) => shop.storefront.replace(/\/+$/, "")),
    indexState: async () => {
      const raw = await storage.getSetting(GSC_INDEX_STATE_KEY, tenantId);
      return raw && typeof raw === "object" ? (raw as GscIndexState) : {};
    },
    saveIndexState: (state) => storage.saveSetting(GSC_INDEX_STATE_KEY, state, tenantId).then(() => undefined),
  };
}

/** Stufe 3 (S3-4): Stammkunden-Wache mit Spiegel, Zuordnung, interner E-Mail, Teams-Warteschlange und Glocke */
export function regularDeps(storage: IStorage): RegularDeps {
  const cart = cartAlarmDeps(storage);
  const baseUrl = publicAppBaseUrl(process.env.APP_URL?.trim() || null);
  return {
    storage,
    loadOrders: loadRegularOrders,
    products: loadRegularProducts,
    priceChanges: loadRegularPriceChanges,
    salesReps: loadSalesReps,
    rows: listRegularRows,
    saveRow: saveRegularRow,
    sendMail: cart.sendMail,
    enqueueTeams: cart.enqueueTeams,
    notify: async (tenantId, email, text) => {
      const link = `${SHOP_PULSE_PAGE_PATH}?tab=regulars`;
      const user = email ? (await storage.getAllUsers()).find((u) => u.email?.trim().toLowerCase() === email.trim().toLowerCase()) : undefined;
      if (!user) {
        await notifyAdmins({ storage, onNotificationCreated: (n) => notificationEvents.emitNotificationCreated(n) }, tenantId, text, link);
        return;
      }
      const n: InsertNotification = { userId: user.id, type: "shop_pulse", title: text.title, message: text.message, link, ticketId: null, ticketNumber: null, read: 0 };
      notificationEvents.emitNotificationCreated(await storage.createNotification(n, tenantId));
    },
    insertActions: insertCandidates,
    pageUrl: baseUrl ? `${baseUrl}${SHOP_PULSE_PAGE_PATH}` : null,
  };
}

/** Stufe 3 (S3-1): Weitergaben, Jana-Liste und Suchwörter mit echter Datenbank, Teams und Shopware */
export function followUpDeps(storage: IStorage): NonNullable<ShopPulseDeps["followUp"]> {
  const onNotificationCreated = (n: Notification) => notificationEvents.emitNotificationCreated(n);
  const baseUrl = publicAppBaseUrl(process.env.APP_URL?.trim() || null);
  const handoff = handoffDeps(storage, onNotificationCreated, baseUrl);
  const keywords = keywordDeps(storage, { onNotificationCreated, baseUrl }, insertCandidates);
  return {
    reminders: (tenantId, now) => runHandoffReminders(handoff, tenantId, now),
    janaList: (tenantId, now) => sendJanaList(handoff, tenantId, now),
    keywords: (tenantId, signals, now, opts) => runKeywordSuggestions(keywords, tenantId, signals, now, opts),
  };
}

/** Echte Quellen des Warenkorb-Alarms (Spiegel, Zuordnung, interne E-Mail, Teams-Warteschlange, Glocke) */
export function cartAlarmDeps(storage: IStorage): CartAlarmDeps {
  const glocke = { storage, onNotificationCreated: (n: Notification) => notificationEvents.emitNotificationCreated(n) };
  return {
    settings: (tenantId) => getCartSettings(storage, tenantId),
    listCarts: async (tenantId) => {
      const settings = await getCartSettings(storage, tenantId);
      return (await listCarts(tenantId)).map((r) => rowToCart(r, settings));
    },
    purge: purgeCarts,
    loadOrders: async (tenantId, since) =>
      (await loadPulseOrders(tenantId, since, { customer: true }))
        .filter((o) => o.customer?.customerNumber)
        .map((o) => ({ customerNumber: o.customer!.customerNumber, orderNumber: o.orderNumber, createdAt: o.createdAt })),
    salesReps: loadSalesReps,
    markAlarmed: markCartAlarmed,
    markOrdered: markCartOrdered,
    sendMail: (_tenantId, to, subject, text) => sendEmail(storage, { to, subject, text }).then(() => undefined),
    enqueueTeams: async (tenantId, message, now) => {
      if ((await getShopPulseSettings(storage, tenantId)).teamsWebhookUrl) await enqueueTeamsMessage(storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId, message, now);
    },
    notify: async (tenantId, email, text) => {
      const link = `${SHOP_PULSE_PAGE_PATH}?tab=cart`;
      const user = email ? (await storage.getAllUsers()).find((u) => u.email?.trim().toLowerCase() === email.trim().toLowerCase()) : undefined;
      if (!user) {
        await notifyAdmins(glocke, tenantId, text, link);
        return;
      }
      const n: InsertNotification = { userId: user.id, type: "shop_pulse", title: text.title, message: text.message, link, ticketId: null, ticketNumber: null, read: 0 };
      glocke.onNotificationCreated(await storage.createNotification(n, tenantId));
    },
    insertActions: insertCandidates,
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
