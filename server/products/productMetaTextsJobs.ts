// Laeufe der Meta-Texte: von Hand aus den Einstellungen (Testlauf mit wenigen Artikeln oder
// Schreiben) und taeglich je Mandant, wenn eingeschaltet. Je Mandant hoechstens ein Lauf.
import type { IStorage } from "../storage";
import type { ShopwareSettings } from "@shared/schema";
import { ShopwareClient } from "../shopware/shopware";
import { isChatLlmConfigured } from "../ai/llmChat";
import { runWithTenantContext } from "../lib/tenantContext";
import { logger } from "../lib/logger";
import { berlinDayAndHour, isScheduledRunDue } from "./productImageTexts";
import {
  getProductMetaTextsSettings,
  getProductMetaTextsState,
  llmMetaGenerator,
  META_DRY_RUN_PRODUCTS,
  runProductMetaTexts,
  saveProductMetaTextsState,
  type MetaGenerator,
  type MetaTextsClient,
  type MetaTextsRunSummary,
  type MetaTextsTrigger,
} from "./productMetaTexts";

const moduleLog = logger.child({ component: "products/productMetaTextsJobs" });

type JobStorage = Pick<IStorage, "getAllTenants" | "getShopwareSettings" | "getSetting" | "saveSetting">;

const running = new Map<string, { done: number; total: number }>();
const runKey = (tenantId: string | null) => tenantId ?? "__default__";

/** Fortschritt des laufenden Laufs, sonst null. */
export function productMetaTextsProgress(tenantId: string | null): { done: number; total: number } | null {
  return running.get(runKey(tenantId)) ?? null;
}

export function metaTextsClient(settings: ShopwareSettings): MetaTextsClient {
  const client = new ShopwareClient(settings);
  return {
    fetchProductMetaSources: client.fetchProductMetaSources.bind(client),
    syncProductMetaTexts: client.syncProductMetaTexts.bind(client),
  };
}

function failedSummary(trigger: MetaTextsTrigger, dryRun: boolean, startedAt: string, error: string): MetaTextsRunSummary {
  return {
    trigger,
    dryRun,
    startedAt,
    finishedAt: new Date().toISOString(),
    products: 0,
    candidates: 0,
    processed: 0,
    written: 0,
    titleChanges: 0,
    descriptionChanges: 0,
    rejected: 0,
    remaining: 0,
    keptManualTitle: 0,
    keptManualDescription: 0,
    unchanged: 0,
    examples: [],
    rejectedExamples: [],
    error,
  };
}

/** Fuehrt einen Lauf aus und legt das Ergebnis (auch Fehler) im Zustand ab. */
export async function runProductMetaTextsForTenant(
  storage: JobStorage,
  tenantId: string | null,
  options: {
    dryRun: boolean;
    trigger: MetaTextsTrigger;
    maxProducts?: number;
    client?: MetaTextsClient;
    generate?: MetaGenerator;
    /** KI-Einstellungen eines anderen Mandanten (nur fuer Skripte) */
    llmTenantId?: string | null;
  },
): Promise<MetaTextsRunSummary | null> {
  const key = runKey(tenantId);
  if (running.has(key)) return null;
  running.set(key, { done: 0, total: 0 });
  const startedAt = new Date().toISOString();
  try {
    const settings = await storage.getShopwareSettings(tenantId);
    if (!settings) throw new Error("Shopware settings not configured");
    const llmTenant = options.llmTenantId !== undefined ? options.llmTenantId : tenantId;
    const getSetting = (k: string) => storage.getSetting(k, llmTenant);
    if (!options.generate && !(await isChatLlmConfigured(getSetting))) throw new Error("AI is not configured");
    const metaSettings = await getProductMetaTextsSettings(storage, tenantId);
    const summary = await runProductMetaTexts(options.client ?? metaTextsClient(settings), options.generate ?? llmMetaGenerator(getSetting), {
      dryRun: options.dryRun,
      trigger: options.trigger,
      maxProducts: options.maxProducts ?? (options.dryRun ? META_DRY_RUN_PRODUCTS : metaSettings.maxPerRun),
      onProgress: (done, total) => running.set(key, { done, total }),
    });
    await saveProductMetaTextsState(storage, { lastRun: summary }, tenantId);
    return summary;
  } catch (err) {
    moduleLog.error({ err, tenantId }, "Meta-Texte: Lauf fehlgeschlagen");
    const failed = failedSummary(options.trigger, options.dryRun, startedAt, err instanceof Error ? err.message : String(err));
    await saveProductMetaTextsState(storage, { lastRun: failed }, tenantId);
    return failed;
  } finally {
    running.delete(key);
  }
}

/** Ein Takt: je Mandant pruefen, ob der Tageslauf faellig ist. */
export async function productMetaTextsTick(storage: JobStorage, now: Date = new Date()): Promise<void> {
  const tenants = await storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  for (const tenantId of tenantIds) {
    await runWithTenantContext(tenantId, async () => {
      try {
        const settings = await getProductMetaTextsSettings(storage, tenantId);
        const state = await getProductMetaTextsState(storage, tenantId);
        if (!isScheduledRunDue(now, settings, state)) return;
        // Tag vorab sperren: ein Fehler wiederholt sich nicht stuendlich gegen Shop und KI
        await saveProductMetaTextsState(storage, { lastScheduledDay: berlinDayAndHour(now).day }, tenantId);
        await runProductMetaTextsForTenant(storage, tenantId, { dryRun: false, trigger: "scheduled" });
      } catch (err) {
        moduleLog.error({ err, tenantId }, "Meta-Texte: Tagespruefung fehlgeschlagen");
      }
    });
  }
}

/** Stuendlicher Takt; der Lauf selbst ist je Mandant hoechstens einmal am Tag faellig. */
export function startProductMetaTextsScheduler(storage: JobStorage): () => void {
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await productMetaTextsTick(storage);
    } finally {
      ticking = false;
    }
  };
  const first = setTimeout(tick, 12 * 60 * 1000);
  const timer = setInterval(tick, 60 * 60 * 1000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
