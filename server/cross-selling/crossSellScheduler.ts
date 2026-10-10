// Zeitgesteuerte Cross-Selling-Laeufe (derzeit: Lernlauf aus dem Bestellspiegel).
// Je Mandant im Mandanten-Kontext (KI- und E-Mail-Einstellungen werden mandantengenau
// gelesen); Laeufe ueberlappen nie.
import type { IStorage } from "../storage";
import type { ShopwareSettings } from "@shared/schema";
import { runCrossSellLearning } from "./crossSellLearning";
import { runWithTenantContext } from "../lib/tenantContext";
import { ShopwareClient } from "../shopware/shopware";
import { getMirrorOrdersLikeLive } from "../routes/routeHelpers";
import { runCrossSellCandidates } from "./crossSellCandidates";
import { runCrossSellMonthlyReview } from "./crossSellMonthlyReview";
import { runBackfillStep } from "./crossSellBackfill";
import { sendEmail } from "../email/emailOutbound";
import { notificationEvents } from "../lib/events";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellScheduler" });

export type CrossSellSchedulerDeps = {
  storage: Pick<IStorage, "getAllTenants" | "getShopwareSettings">;
  runLearning: (settings: ShopwareSettings, tenantId: string | null) => Promise<unknown>;
  /** Taeglicher Kandidatenlauf (Teilautomatik); prueft Modus und Tagessperre selbst. */
  runCandidates?: (settings: ShopwareSettings, tenantId: string | null) => Promise<unknown>;
};

/** Ein Durchlauf ueber alle Mandanten mit Shopware-Anbindung. */
export async function runCrossSellLearningForAllTenants(deps: CrossSellSchedulerDeps): Promise<void> {
  const tenants = await deps.storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  for (const tenantId of tenantIds) {
    await runWithTenantContext(tenantId, async () => {
      try {
        const settings = await deps.storage.getShopwareSettings(tenantId);
        if (!settings) return;
        await deps.runLearning(settings, tenantId);
        moduleLog.info({ tenantId }, "Cross-Selling-Lernlauf abgeschlossen");
        if (deps.runCandidates) {
          try {
            await deps.runCandidates(settings, tenantId);
          } catch (err) {
            moduleLog.error({ err, tenantId }, "Cross-Selling-Kandidatenlauf fehlgeschlagen");
          }
        }
      } catch (err) {
        moduleLog.error({ err, tenantId }, "Cross-Selling-Lernlauf fehlgeschlagen");
      }
    });
  }
}

/** Intervall aus CROSS_SELL_LEARNING_INTERVAL_HOURS (Standard 24, mind. 1). */
export function resolveLearningIntervalHours(raw: string | undefined = process.env.CROSS_SELL_LEARNING_INTERVAL_HOURS): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 24;
}

/**
 * Startet den Lernlauf beim Serverstart: erster Lauf nach 30 Sekunden, danach im Intervall.
 */
export function startCrossSellScheduler(storage: IStorage): () => void {
  const deps: CrossSellSchedulerDeps = {
    storage,
    runLearning: (settings, tenantId) => runCrossSellLearning(storage, settings, tenantId),
    runCandidates: (settings, tenantId) => runCandidatesForTenant(storage, settings, tenantId, "scheduled"),
  };
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runCrossSellLearningForAllTenants(deps);
    } catch (err) {
      moduleLog.error({ err }, "Cross-Selling-Lernlauf fehlgeschlagen");
    } finally {
      running = false;
    }
  };
  const hours = resolveLearningIntervalHours();
  const first = setTimeout(run, 30 * 1000);
  const timer = setInterval(run, hours * 60 * 60 * 1000);
  moduleLog.info({ intervalHours: hours }, "Cross-Selling-Lernlauf geplant");

  // Monatspruefung: stuendlicher Takt, faellig ab Tag/Stunde der Einstellung; ein Lauf je Monat (Sperre).
  let reviewRunning = false;
  const reviewTick = async () => {
    if (reviewRunning) return;
    reviewRunning = true;
    try {
      await forEachShopTenant(storage, (settings, tenantId) => runMonthlyReviewForTenant(storage, settings, tenantId, "scheduled"));
      // Erstbefuellung (falls gestartet): ein Schritt je Stunde
      await forEachShopTenant(storage, (settings, tenantId) => runBackfillForTenant(storage, settings, tenantId, "scheduled"));
    } catch (err) {
      moduleLog.error({ err }, "Cross-Selling-Monatspruefung fehlgeschlagen");
    } finally {
      reviewRunning = false;
    }
  };
  const reviewFirst = setTimeout(reviewTick, 5 * 60 * 1000);
  const reviewTimer = setInterval(reviewTick, 60 * 60 * 1000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    clearTimeout(reviewFirst);
    clearInterval(reviewTimer);
  };
}

function candidateDeps(storage: IStorage, settings: ShopwareSettings, tenantId: string | null) {
  const client = new ShopwareClient(settings);
  return {
    storage,
    client: {
      fetchProductCrossSelling: client.fetchProductCrossSelling.bind(client),
      fetchCrossSellingAssignments: client.fetchCrossSellingAssignments.bind(client),
      createProductCrossSelling: client.createProductCrossSelling.bind(client),
      syncCrossSellingAssignments: client.syncCrossSellingAssignments.bind(client),
    },
    loadOrders: () => getMirrorOrdersLikeLive(client, tenantId),
    getSetting: (key: string) => storage.getSetting(key, tenantId),
  };
}

/** Ein Schritt der Erstbefuellung fuer einen Mandanten (Scheduler und Route). */
export async function runBackfillForTenant(
  storage: IStorage,
  settings: ShopwareSettings,
  tenantId: string | null,
  trigger: "scheduled" | "manual",
  userId?: string | null,
) {
  return runBackfillStep(candidateDeps(storage, settings, tenantId), { tenantId, userId, trigger });
}

/** Kandidatenlauf fuer einen Mandanten mit echten Abhaengigkeiten (Scheduler und Route). */
export async function runCandidatesForTenant(
  storage: IStorage,
  settings: ShopwareSettings,
  tenantId: string | null,
  trigger: "scheduled" | "manual",
  userId?: string | null,
) {
  return runCrossSellCandidates(candidateDeps(storage, settings, tenantId), { tenantId, userId, trigger });
}

async function forEachShopTenant(
  storage: Pick<IStorage, "getAllTenants" | "getShopwareSettings">,
  fn: (settings: ShopwareSettings, tenantId: string | null) => Promise<unknown>,
): Promise<void> {
  const tenants = await storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  for (const tenantId of tenantIds) {
    await runWithTenantContext(tenantId, async () => {
      try {
        const settings = await storage.getShopwareSettings(tenantId);
        if (settings) await fn(settings, tenantId);
      } catch (err) {
        moduleLog.error({ err, tenantId }, "Cross-Selling-Monatspruefung fuer Mandant fehlgeschlagen");
      }
    });
  }
}

/** Monatspruefung fuer einen Mandanten mit echten Abhaengigkeiten (Scheduler und Route). */
export async function runMonthlyReviewForTenant(
  storage: IStorage,
  settings: ShopwareSettings,
  tenantId: string | null,
  trigger: "scheduled" | "manual",
  userId?: string | null,
) {
  const client = new ShopwareClient(settings);
  return runCrossSellMonthlyReview(
    {
      storage,
      client: { searchCrossSellingGroups: client.searchCrossSellingGroups.bind(client) },
      loadOrders: () => getMirrorOrdersLikeLive(client, tenantId),
      getSetting: (key) => storage.getSetting(key, tenantId),
      sendEmail: (params) => sendEmail(storage, params),
      onNotificationCreated: (n) => notificationEvents.emitNotificationCreated(n),
      appUrl: process.env.PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || null,
    },
    { tenantId, userId, trigger },
  );
}
