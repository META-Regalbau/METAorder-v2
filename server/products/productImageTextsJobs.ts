// Laeufe der Bildtexte (ALT/TITLE): von Hand aus den Einstellungen (Test oder Schreiben) und
// taeglich je Mandant, wenn eingeschaltet. Je Mandant laeuft hoechstens ein Lauf gleichzeitig.
import type { IStorage } from "../storage";
import type { ShopwareSettings } from "@shared/schema";
import { ShopwareClient } from "../shopware/shopware";
import { runWithTenantContext } from "../lib/tenantContext";
import { logger } from "../lib/logger";
import {
  getProductImageTextsSettings,
  getProductImageTextsState,
  isScheduledRunDue,
  berlinDayAndHour,
  runProductImageTexts,
  saveProductImageTextsState,
  type ImageTextsClient,
  type ImageTextsRunSummary,
  type ImageTextsTrigger,
} from "./productImageTexts";

const moduleLog = logger.child({ component: "products/productImageTextsJobs" });

type JobStorage = Pick<IStorage, "getAllTenants" | "getShopwareSettings" | "getSetting" | "saveSetting">;

const running = new Set<string>();
const runKey = (tenantId: string | null) => tenantId ?? "__default__";

export function isProductImageTextsRunning(tenantId: string | null): boolean {
  return running.has(runKey(tenantId));
}

export function imageTextsClient(settings: ShopwareSettings): ImageTextsClient {
  const client = new ShopwareClient(settings);
  return {
    fetchProductImageLinks: client.fetchProductImageLinks.bind(client),
    fetchProductImageProducts: client.fetchProductImageProducts.bind(client),
    fetchMediaTexts: client.fetchMediaTexts.bind(client),
    syncMediaTexts: client.syncMediaTexts.bind(client),
  };
}

/** Fuehrt einen Lauf aus und legt das Ergebnis (auch Fehler) im Zustand ab. */
export async function runProductImageTextsForTenant(
  storage: JobStorage,
  tenantId: string | null,
  options: { dryRun: boolean; trigger: ImageTextsTrigger; client?: ImageTextsClient },
): Promise<ImageTextsRunSummary | null> {
  const key = runKey(tenantId);
  if (running.has(key)) return null;
  running.add(key);
  const startedAt = new Date().toISOString();
  try {
    const settings = await storage.getShopwareSettings(tenantId);
    if (!settings) throw new Error("Shopware settings not configured");
    const summary = await runProductImageTexts(options.client ?? imageTextsClient(settings), options);
    await saveProductImageTextsState(storage, { lastRun: summary }, tenantId);
    return summary;
  } catch (err) {
    moduleLog.error({ err, tenantId }, "Bildtexte: Lauf fehlgeschlagen");
    const failed: ImageTextsRunSummary = {
      trigger: options.trigger,
      dryRun: options.dryRun,
      startedAt,
      finishedAt: new Date().toISOString(),
      images: 0,
      changed: 0,
      altChanges: 0,
      titleChanges: 0,
      keptManualAlt: 0,
      keptManualTitle: 0,
      unchanged: 0,
      withoutProductName: 0,
      examples: [],
      error: err instanceof Error ? err.message : String(err),
    };
    await saveProductImageTextsState(storage, { lastRun: failed }, tenantId);
    return failed;
  } finally {
    running.delete(key);
  }
}

/** Ein Takt: je Mandant pruefen, ob der Tageslauf faellig ist. */
export async function productImageTextsTick(storage: JobStorage, now: Date = new Date()): Promise<void> {
  const tenants = await storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  for (const tenantId of tenantIds) {
    await runWithTenantContext(tenantId, async () => {
      try {
        const settings = await getProductImageTextsSettings(storage, tenantId);
        const state = await getProductImageTextsState(storage, tenantId);
        if (!isScheduledRunDue(now, settings, state)) return;
        // Tag vorab sperren: ein Fehler wiederholt sich nicht stuendlich gegen den Shop
        await saveProductImageTextsState(storage, { lastScheduledDay: berlinDayAndHour(now).day }, tenantId);
        await runProductImageTextsForTenant(storage, tenantId, { dryRun: false, trigger: "scheduled" });
      } catch (err) {
        moduleLog.error({ err, tenantId }, "Bildtexte: Tagespruefung fehlgeschlagen");
      }
    });
  }
}

/** Stuendlicher Takt; der Lauf selbst ist je Mandant hoechstens einmal am Tag faellig. */
export function startProductImageTextsScheduler(storage: JobStorage): () => void {
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await productImageTextsTick(storage);
    } finally {
      ticking = false;
    }
  };
  const first = setTimeout(tick, 10 * 60 * 1000);
  const timer = setInterval(tick, 60 * 60 * 1000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
