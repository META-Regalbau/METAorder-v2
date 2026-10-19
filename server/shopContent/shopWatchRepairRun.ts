/**
 * Shop-Wächter, Reparatur per Knopf mit Datenbank (Shop-Puls Stufe 3, S3-2, Entscheidung 19.10.2026: zuerst nur
 * per Knopf, keine Selbst-Reparatur). Die Einträge je Prüfpunkt und das Lesen/Schreiben stehen in
 * shopWatchRepair.ts.
 *
 * - Soll-Stand sichern: nach einem Lauf für jeden grünen, reparierbaren Prüfpunkt, bei der Vollprüfung (nachts,
 *   von Hand, nach einem Deploy) und immer, wenn es noch keinen gibt. Gespeichert wird nur ein vollständiger
 *   Stand, und nur wenn er sich geändert hat.
 * - Reparieren: unter der Sperre des Shops; erst den jetzigen Stand lesen (Rückweg), dann den Soll-Stand
 *   schreiben, danach den Prüfpunkt erneut prüfen. Höchstens einmal je Deploy und Prüfpunkt: Kommt die Änderung
 *   danach wieder, ist das vermutlich Absicht der Agentur, dann nur melden.
 * - Rücknahme schreibt den Stand von vorher zurück. Jede Reparatur und Rücknahme steht im Protokoll (Tabelle)
 *   und im Maßnahmen-Protokoll des Shop-Puls.
 */
import { and, desc, eq, isNull, type AnyColumn } from "drizzle-orm";
import { shopWatchRepairs, shopWatchTargets, type ShopWatchRepairRow } from "@shared/schema";
import { classifyDeployChanges, type ShopWatchCheckResult, type ShopWatchRepairRecord, type ShopWatchStatus } from "@shared/shopWatch";
import { db } from "../db";
import { logger } from "../lib/logger";
import type { ActionCandidate } from "../shopPulse/actionLog";
import { findDeChannel, shopApi, type ShopApi } from "./shopProducts";
import { SHOP_WATCH_CHECKS } from "./shopWatchChecks";
import {
  createShopWatchContext,
  getShopWatchBaseline,
  getShopWatchState,
  runShopWatchChecks,
  SHOP_WATCH_STATE_KEY,
  withShopLock,
  type FetchLike,
  type ShopWatchState,
} from "./shopWatch";
import { compileChannelTheme, isCompleteSnapshot, REPAIR_SPECS, revertEntities, snapshotHash, writeSnapshot, type RepairEnv, type SnapshotEntity } from "./shopWatchRepair";

const log = logger.child({ component: "shopContent/shopWatchRepairRun" });

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));
const iso = (d: Date | null) => (d ? d.toISOString() : null);

type Store = {
  getSetting(key: string, tenantId?: string | null): Promise<any>;
  saveSetting(key: string, value: any, tenantId?: string | null): Promise<any>;
  getShopwareSettings(tenantId?: string | null): Promise<any>;
};

// ---------------------------------------------------------------------------------------------
// Datenbank

export async function listTargets(tenantId: string | null): Promise<Array<{ checkId: string; takenAt: string; takenBy: string | null; hash: string; entities: SnapshotEntity[] }>> {
  const rows = await db.select().from(shopWatchTargets).where(tenantIs(shopWatchTargets.tenantId, tenantId));
  return rows.map((r) => ({ checkId: r.checkId, takenAt: r.takenAt.toISOString(), takenBy: r.takenBy ?? null, hash: r.hash, entities: Array.isArray(r.entities) ? (r.entities as SnapshotEntity[]) : [] }));
}

async function saveTarget(tenantId: string | null, checkId: string, entities: SnapshotEntity[], by: string | null, now: Date): Promise<void> {
  const hash = snapshotHash(entities);
  const existing = await db
    .select({ id: shopWatchTargets.id })
    .from(shopWatchTargets)
    .where(and(eq(shopWatchTargets.checkId, checkId), tenantIs(shopWatchTargets.tenantId, tenantId)))
    .limit(1);
  if (existing[0]) {
    await db.update(shopWatchTargets).set({ entities, hash, takenAt: now, takenBy: by }).where(eq(shopWatchTargets.id, existing[0].id));
  } else {
    await db.insert(shopWatchTargets).values({ tenantId, checkId, entities, hash, takenAt: now, takenBy: by }).onConflictDoNothing();
  }
}

export function rowToRepair(r: ShopWatchRepairRow): ShopWatchRepairRecord {
  return {
    id: r.id,
    checkId: r.checkId,
    deployKey: r.deployKey,
    status: r.status === "failed" ? "failed" : "ok",
    error: r.error ?? null,
    entities: Array.isArray(r.target) ? (r.target as unknown[]).length : 0,
    targetTakenAt: iso(r.targetTakenAt),
    checkStatusBefore: (r.checkStatusBefore as ShopWatchStatus | null) ?? null,
    checkStatusAfter: (r.checkStatusAfter as ShopWatchStatus | null) ?? null,
    repairedAt: r.repairedAt.toISOString(),
    repairedBy: r.repairedBy ?? null,
    revertedAt: iso(r.revertedAt),
    revertedBy: r.revertedBy ?? null,
  };
}

export async function listRepairs(tenantId: string | null, limit = 100): Promise<ShopWatchRepairRecord[]> {
  const rows = await db.select().from(shopWatchRepairs).where(tenantIs(shopWatchRepairs.tenantId, tenantId)).orderBy(desc(shopWatchRepairs.repairedAt)).limit(limit);
  return rows.map(rowToRepair);
}

// ---------------------------------------------------------------------------------------------
// Regeln (rein)

/** Deploy-Schlüssel: Beginn des letzten Laufs, der einen Deploy erkannt hat (Shopware-Version oder Plugins); sonst "none" */
export function currentDeployKey(state: Pick<ShopWatchState, "history">): string {
  const deploy = (state.history ?? []).find((h) => classifyDeployChanges(h.deployChanges ?? []) === "deploy");
  return deploy ? deploy.startedAt : "none";
}

/** Gab es seit dem letzten Deploy schon eine (nicht zurückgenommene) Reparatur dieses Prüfpunkts? */
export function alreadyRepaired(repairs: Array<Pick<ShopWatchRepairRecord, "checkId" | "deployKey" | "status" | "revertedAt">>, checkId: string, deployKey: string): boolean {
  return repairs.some((r) => r.checkId === checkId && r.deployKey === deployKey && r.status === "ok" && !r.revertedAt);
}

/** Welche Soll-Stände nach einem Lauf zu sichern sind: grüne, reparierbare Prüfpunkte; bei der stündlichen Prüfung nur ohne Soll-Stand */
export function targetsToCapture(results: Pick<ShopWatchCheckResult, "id" | "status">[], existing: Set<string>, cadence: "all" | "hourly"): string[] {
  return results.filter((r) => r.status === "ok" && r.id in REPAIR_SPECS && (cadence === "all" || !existing.has(r.id))).map((r) => r.id);
}

// ---------------------------------------------------------------------------------------------
// Ablauf

async function repairEnv(store: Store, tenantId: string | null, api: ShopApi, channel: { id: string; domain: string }): Promise<RepairEnv> {
  const baseline = await getShopWatchBaseline(store, tenantId);
  return { api, channelId: channel.id, storefront: channel.domain, categoryIds: Object.keys(baseline?.categoryFields ?? {}).sort() };
}

/**
 * Soll-Stände nach einem Lauf sichern (läuft noch unter der Sperre des Laufs). Fehler einzelner Prüfpunkte
 * werden nur protokolliert, der Lauf bleibt gültig.
 */
export async function captureTargets(
  store: Store,
  tenantId: string | null,
  env: { api: ShopApi; channel: { id: string; domain: string } },
  results: ShopWatchCheckResult[],
  cadence: "all" | "hourly",
  now = new Date(),
): Promise<string[]> {
  const targets = await listTargets(tenantId);
  const known = new Map(targets.map((t) => [t.checkId, t.hash]));
  const ids = targetsToCapture(results, new Set(known.keys()), cadence);
  if (!ids.length) return [];
  const repairEnvironment = await repairEnv(store, tenantId, env.api, env.channel);
  const saved: string[] = [];
  for (const id of ids) {
    try {
      const entities = await REPAIR_SPECS[id].read(repairEnvironment);
      if (!isCompleteSnapshot(entities)) continue;
      if (known.get(id) === snapshotHash(entities)) continue;
      await saveTarget(tenantId, id, entities, null, now);
      saved.push(id);
    } catch (err) {
      log.warn({ err, tenantId, check: id }, "Shop-Wächter: Soll-Stand nicht gesichert");
    }
  }
  if (saved.length) log.info({ tenantId, checks: saved }, "Shop-Wächter: Soll-Stand gesichert");
  return saved;
}

export class RepairError extends Error {
  constructor(readonly reason: "notRepairable" | "noTarget" | "alreadyRepaired" | "notFound" | "alreadyReverted" | "shopwareMissing") {
    super(reason);
  }
}

export type RepairDeps = {
  store: Store;
  insertActions: (tenantId: string | null, candidates: ActionCandidate[]) => Promise<unknown>;
  fetchImpl?: FetchLike;
  now?: () => Date;
};

async function openShop(store: Store, tenantId: string | null) {
  const settings = await store.getShopwareSettings(tenantId);
  if (!settings) throw new RepairError("shopwareMissing");
  const { api, base } = shopApi(settings);
  const channel = await findDeChannel(api, base);
  return { api, channel };
}

/** Prüfpunkt erneut prüfen und das Ergebnis in den letzten Lauf übernehmen (Übersicht zeigt den neuen Stand) */
async function recheck(deps: RepairDeps, tenantId: string | null, api: ShopApi, channel: { id: string; domain: string }, checkId: string): Promise<ShopWatchCheckResult | null> {
  const def = SHOP_WATCH_CHECKS.find((c) => c.id === checkId);
  if (!def) return null;
  const baseline = await getShopWatchBaseline(deps.store, tenantId);
  const ctx = createShopWatchContext({ api, channelId: channel.id, storefront: channel.domain, baseline, fetchImpl: deps.fetchImpl });
  const { results } = await runShopWatchChecks(ctx, [def], { tenantId: tenantId ?? "<tenantId>", live: true });
  const result = results[0] ?? null;
  if (result) {
    const state = await getShopWatchState(deps.store, tenantId);
    if (state.lastRun) {
      state.lastRun.results = state.lastRun.results.map((r) => (r.id === checkId ? { ...result, repair: r.repair } : r));
      await deps.store.saveSetting(SHOP_WATCH_STATE_KEY, state, tenantId);
    }
  }
  return result;
}

const labelOf = (checkId: string) => SHOP_WATCH_CHECKS.find((c) => c.id === checkId)?.label ?? checkId;

/** Reparieren per Knopf (siehe Dateikopf) */
export async function repairCheck(deps: RepairDeps, tenantId: string | null, checkId: string, by: string): Promise<ShopWatchRepairRecord> {
  const spec = REPAIR_SPECS[checkId];
  if (!spec) throw new RepairError("notRepairable");
  return withShopLock(tenantId, async () => {
    const now = deps.now?.() ?? new Date();
    const target = (await listTargets(tenantId)).find((t) => t.checkId === checkId);
    if (!target || !isCompleteSnapshot(target.entities)) throw new RepairError("noTarget");
    const state = await getShopWatchState(deps.store, tenantId);
    const deployKey = currentDeployKey(state);
    if (alreadyRepaired(await listRepairs(tenantId, 500), checkId, deployKey)) throw new RepairError("alreadyRepaired");
    const statusBefore = state.lastRun?.results.find((r) => r.id === checkId)?.status ?? null;
    const { api, channel } = await openShop(deps.store, tenantId);
    const env = await repairEnv(deps.store, tenantId, api, channel);
    const before = await spec.read(env);
    let status: "ok" | "failed" = "ok";
    let error: string | null = null;
    let after: ShopWatchCheckResult | null = null;
    try {
      await writeSnapshot(api, target.entities);
      if (spec.compileTheme) await compileChannelTheme(api, channel.id);
      after = await recheck(deps, tenantId, api, channel, checkId);
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message.slice(0, 1000) : String(err);
      log.error({ err, tenantId, check: checkId }, "Shop-Wächter: Reparatur fehlgeschlagen");
    }
    const [row] = await db
      .insert(shopWatchRepairs)
      .values({
        tenantId,
        checkId,
        deployKey,
        status,
        error,
        before,
        target: target.entities,
        targetTakenAt: new Date(target.takenAt),
        checkStatusBefore: statusBefore,
        checkStatusAfter: after?.status ?? null,
        repairedAt: now,
        repairedBy: by,
      })
      .returning();
    const record = rowToRepair(row);
    await deps.insertActions(tenantId, [
      {
        occurredAt: now.toISOString(),
        kind: "watchRepair",
        title: `Shop-Wächter repariert: ${labelOf(checkId)}${status === "failed" ? " (fehlgeschlagen)" : ""}`.slice(0, 300),
        description: `Soll-Stand vom ${new Date(target.takenAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} zurückgeschrieben (${target.entities.length} Einträge). Prüfung vorher: ${statusBefore ?? "–"}, danach: ${after?.status ?? "–"}.${error ? `\nFehler: ${error}` : ""}`,
        scope: { type: "shop", values: [] },
        source: "shopWatch",
        sourceKey: `repair:${record.id}`,
        actor: by,
      },
    ]);
    log.warn({ tenantId, check: checkId, status, after: after?.status, deployKey, by }, "Shop-Wächter: Reparatur per Knopf");
    if (status === "failed") throw Object.assign(new Error(error ?? "Reparatur fehlgeschlagen"), { record });
    return record;
  });
}

/** Reparatur zurücknehmen: Stand von vorher zurückschreiben (fehlende Einträge wieder löschen) */
export async function revertRepair(deps: RepairDeps, tenantId: string | null, repairId: string, by: string): Promise<ShopWatchRepairRecord> {
  return withShopLock(tenantId, async () => {
    const now = deps.now?.() ?? new Date();
    const rows = await db.select().from(shopWatchRepairs).where(and(eq(shopWatchRepairs.id, repairId), tenantIs(shopWatchRepairs.tenantId, tenantId))).limit(1);
    const row = rows[0];
    if (!row) throw new RepairError("notFound");
    if (row.revertedAt) throw new RepairError("alreadyReverted");
    const spec = REPAIR_SPECS[row.checkId];
    const { api, channel } = await openShop(deps.store, tenantId);
    await writeSnapshot(api, revertEntities(row.before as SnapshotEntity[], row.target as SnapshotEntity[]));
    if (spec?.compileTheme) await compileChannelTheme(api, channel.id);
    await recheck(deps, tenantId, api, channel, row.checkId).catch((err) => log.warn({ err, tenantId }, "Shop-Wächter: Prüfung nach Rücknahme fehlgeschlagen"));
    const [updated] = await db.update(shopWatchRepairs).set({ revertedAt: now, revertedBy: by }).where(eq(shopWatchRepairs.id, row.id)).returning();
    await deps.insertActions(tenantId, [
      {
        occurredAt: now.toISOString(),
        kind: "watchRepairRevert",
        title: `Shop-Wächter: Reparatur zurückgenommen: ${labelOf(row.checkId)}`.slice(0, 300),
        description: `Stand vor der Reparatur vom ${row.repairedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} zurückgeschrieben.`,
        scope: { type: "shop", values: [] },
        source: "shopWatch",
        sourceKey: `repair:${row.id}:revert`,
        actor: by,
      },
    ]);
    log.warn({ tenantId, check: row.checkId, by }, "Shop-Wächter: Reparatur zurückgenommen");
    return rowToRepair(updated);
  });
}

/** Soll-Stand eines grünen Prüfpunkts jetzt von Hand sichern (z. B. nach gewollter Änderung) */
export async function captureTargetNow(deps: RepairDeps, tenantId: string | null, checkId: string, by: string): Promise<boolean> {
  const spec = REPAIR_SPECS[checkId];
  if (!spec) throw new RepairError("notRepairable");
  return withShopLock(tenantId, async () => {
    const { api, channel } = await openShop(deps.store, tenantId);
    const entities = await spec.read(await repairEnv(deps.store, tenantId, api, channel));
    if (!isCompleteSnapshot(entities)) return false;
    await saveTarget(tenantId, checkId, entities, by, deps.now?.() ?? new Date());
    return true;
  });
}
