// Erstbefuellung des Cross-Sellings ueber den ganzen Katalog: stuendliche Laeufe des
// Kandidatenlaufs im Modus "backfill" (eigenes KI-Budget), bis alle Kandidaten geprueft sind
// oder das Budget verbraucht ist. Setzen/Pruefliste richten sich nach dem Automatik-Modus.
import { getCrossSellAutomationSettings } from "./crossSellAutomationSettings";
import { runCrossSellCandidates, type CandidateRunDeps } from "./crossSellCandidates";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellBackfill" });

export const BACKFILL_STATE_KEY = "cross_sell_backfill_state";

export type BackfillState = {
  status: "idle" | "running" | "done" | "stopped";
  startedAt?: string;
  finishedAt?: string;
  startedByUserId?: string | null;
  llmUsed: number;
  runs: number;
  autoApplied: number;
  dryRunFlagged: number;
  queued: number;
  remainingUnchecked?: number;
  lastRunAt?: string;
  lastError?: string | null;
};

type SettingsStore = {
  getSetting(key: string, tenantId?: string | null): Promise<any>;
  saveSetting(key: string, value: any, tenantId?: string | null): Promise<any>;
};

const EMPTY: BackfillState = { status: "idle", llmUsed: 0, runs: 0, autoApplied: 0, dryRunFlagged: 0, queued: 0 };

export async function getBackfillState(store: SettingsStore, tenantId: string | null): Promise<BackfillState> {
  const raw = await store.getSetting(BACKFILL_STATE_KEY, tenantId);
  return raw && typeof raw === "object" ? { ...EMPTY, ...raw } : { ...EMPTY };
}

export async function startBackfill(store: SettingsStore, tenantId: string | null, userId: string | null, now = new Date()): Promise<BackfillState> {
  const state: BackfillState = { ...EMPTY, status: "running", startedAt: now.toISOString(), startedByUserId: userId };
  await store.saveSetting(BACKFILL_STATE_KEY, state, tenantId);
  return state;
}

export async function stopBackfill(store: SettingsStore, tenantId: string | null, now = new Date()): Promise<BackfillState> {
  const state = { ...(await getBackfillState(store, tenantId)), status: "stopped" as const, finishedAt: now.toISOString() };
  await store.saveSetting(BACKFILL_STATE_KEY, state, tenantId);
  return state;
}

/**
 * Ein Schritt der Erstbefuellung. Ende: keine ungeprueften Kandidaten mehr oder Budget aufgebraucht.
 * Laeuft nur, solange der Zustand "running" ist.
 */
export async function runBackfillStep(
  deps: CandidateRunDeps,
  args: { tenantId: string | null; userId?: string | null; trigger: "scheduled" | "manual" },
  runCandidates: typeof runCrossSellCandidates = runCrossSellCandidates,
): Promise<{ skipped?: string; state: BackfillState }> {
  const store = deps.storage;
  const state = await getBackfillState(store, args.tenantId);
  if (state.status !== "running") return { skipped: "not_running", state };

  const result = await runCandidates(deps, { ...args, kind: "backfill", backfillLlmUsed: state.llmUsed });
  if (result.skipped || !result.stats) return { skipped: result.skipped ?? "no_stats", state };

  const s = result.stats;
  const settings = await getCrossSellAutomationSettings(store, args.tenantId);
  const next: BackfillState = {
    ...state,
    runs: state.runs + 1,
    llmUsed: state.llmUsed + s.llmCalls,
    autoApplied: state.autoApplied + s.autoApplied,
    dryRunFlagged: state.dryRunFlagged + s.dryRunFlagged,
    queued: s.queued,
    remainingUnchecked: s.remainingUnchecked,
    lastRunAt: new Date().toISOString(),
    lastError: s.llmNotConfigured ? "llm_not_configured" : null,
  };
  const budgetLeft = settings.backfillLlmBudget - next.llmUsed;
  if (s.remainingUnchecked === 0 || budgetLeft <= 0 || s.llmNotConfigured) {
    next.status = "done";
    next.finishedAt = new Date().toISOString();
  }
  await store.saveSetting(BACKFILL_STATE_KEY, next, args.tenantId);
  moduleLog.info(
    { tenantId: args.tenantId, runs: next.runs, llmUsed: next.llmUsed, remaining: s.remainingUnchecked, autoApplied: s.autoApplied, status: next.status },
    "Cross-Selling-Erstbefuellung: Schritt abgeschlossen",
  );
  return { state: next };
}
