// Zeitgesteuerte Cross-Selling-Laeufe (derzeit: Lernlauf aus dem Bestellspiegel).
// Je Mandant im Mandanten-Kontext (KI- und E-Mail-Einstellungen werden mandantengenau
// gelesen); Laeufe ueberlappen nie.
import type { IStorage } from "../storage";
import type { ShopwareSettings } from "@shared/schema";
import { runCrossSellLearning } from "./crossSellLearning";
import { runWithTenantContext } from "../lib/tenantContext";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellScheduler" });

export type CrossSellSchedulerDeps = {
  storage: Pick<IStorage, "getAllTenants" | "getShopwareSettings">;
  runLearning: (settings: ShopwareSettings, tenantId: string | null) => Promise<unknown>;
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
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
