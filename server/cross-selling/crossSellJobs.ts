// Hintergrund-Jobs fuer grosse Cross-Selling-Laeufe (Staging-Neuberechnung, KI-Lernlauf).
// Die Laeufe dauern laenger als Proxy-/Browser-Timeouts; der POST antwortet 202 und der
// Client pollt GET /api/cross-selling/jobs/status. Laufzustand im Prozess, Start und Ende
// zusaetzlich in den Einstellungen – so meldet ein Poll nach einem Neustart "abgebrochen"
// statt ewig "unbekannt".
import { logger } from "../lib/logger";
import { runWithTenantContext } from "../lib/tenantContext";

const moduleLog = logger.child({ component: "cross-selling/crossSellJobs" });

export type CrossSellJobType = "staging" | "ai" | "import" | "candidates" | "review";

export type CrossSellJobState = {
  type: CrossSellJobType;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  processed: number;
  total: number;
  result?: unknown;
  error?: string;
};

export type CrossSellJobStatusResponse = {
  status: "idle" | "running" | "done" | "error";
  processed?: number;
  total?: number;
  startedAt?: string;
  finishedAt?: string | null;
  result?: unknown;
  error?: string | null;
  /** "interrupted": Job lief beim letzten Neustart noch (Client zeigt eigenen Text). */
  code?: "interrupted";
};

type SettingsStore = {
  getSetting(key: string, tenantId?: string | null): Promise<any>;
  saveSetting(key: string, value: any, tenantId?: string | null): Promise<any>;
};

/** Fehlertext, wenn ein Job durch einen Neustart abgebrochen wurde (Fehlerkatalog im Client). */
export const CROSS_SELL_JOB_INTERRUPTED = "Cross-selling job was interrupted by a server restart";

const jobs = new Map<string, CrossSellJobState>();

const jobKey = (tenantId: string | null, type: CrossSellJobType) => `${tenantId ?? "__default__"}:${type}`;
const settingKey = (type: CrossSellJobType) => `cross_sell_job_last_${type}`;

function toResponse(state: CrossSellJobState): CrossSellJobStatusResponse {
  return {
    status: state.status,
    processed: state.processed,
    total: state.total,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt ?? null,
    result: state.status === "done" ? state.result : null,
    error: state.status === "error" ? state.error ?? null : null,
  };
}

async function persist(store: SettingsStore, tenantId: string | null, state: CrossSellJobState): Promise<void> {
  try {
    // Ergebnis nicht mitspeichern (kann gross sein); fuer den Poll nach Neustart reicht der Status.
    const { result: _result, ...rest } = state;
    await store.saveSetting(settingKey(state.type), rest, tenantId);
  } catch (err) {
    moduleLog.warn({ err, type: state.type }, "Job-Status konnte nicht gespeichert werden");
  }
}

/**
 * Startet einen Job, falls fuer Mandant und Typ keiner laeuft. Der Lauf erhaelt den
 * Mandanten-Kontext (KI-Einstellungen, E-Mail etc. werden mandantengenau gelesen).
 */
export function startCrossSellJob(
  store: SettingsStore,
  tenantId: string | null,
  type: CrossSellJobType,
  run: (job: CrossSellJobState) => Promise<unknown>,
): { started: boolean; state: CrossSellJobState } {
  const key = jobKey(tenantId, type);
  const existing = jobs.get(key);
  if (existing && existing.status === "running") {
    return { started: false, state: existing };
  }
  const state: CrossSellJobState = {
    type,
    status: "running",
    startedAt: new Date().toISOString(),
    processed: 0,
    total: 0,
  };
  jobs.set(key, state);
  void runWithTenantContext(tenantId, async () => {
    await persist(store, tenantId, state);
    try {
      state.result = await run(state);
      state.status = "done";
    } catch (err: any) {
      state.error = err?.message || String(err);
      state.status = "error";
      moduleLog.error({ err, type, tenantId }, "Cross-Selling-Job fehlgeschlagen");
    } finally {
      state.finishedAt = new Date().toISOString();
      await persist(store, tenantId, state);
    }
  });
  return { started: true, state };
}

export async function getCrossSellJobStatus(
  store: SettingsStore,
  tenantId: string | null,
  type: CrossSellJobType,
): Promise<CrossSellJobStatusResponse> {
  const state = jobs.get(jobKey(tenantId, type));
  if (state) return toResponse(state);

  const last = (await store.getSetting(settingKey(type), tenantId).catch(() => null)) as CrossSellJobState | null;
  if (!last || !last.status) return { status: "idle" };
  if (last.status === "running") {
    return {
      status: "error",
      startedAt: last.startedAt,
      finishedAt: null,
      error: CROSS_SELL_JOB_INTERRUPTED,
      code: "interrupted",
    };
  }
  return { ...toResponse(last), result: last.status === "done" ? {} : null };
}

/** Nur fuer Tests. */
export function resetCrossSellJobsForTests(): void {
  jobs.clear();
}
