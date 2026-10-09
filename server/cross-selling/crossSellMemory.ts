// Cross-Selling-Gedaechtnis: abgelehnte Paare nie wieder vorschlagen, Entscheidungen merken,
// jeden Schreibvorgang nach Shopware protokollieren und den Paar-Zustand nachfuehren.
// Paare werden je Familie gefuehrt (siehe crossSellCatalog).
import type { CrossSellPairOrigin, CrossSellPairState } from "@shared/schema";
import type { IStorage, CrossSellPairStateUpdateColumn } from "../storage";
import type { CrossSellApplyChange } from "./crossSellApply";
import type { CrossSellCatalog } from "./crossSellCatalog";
import { loadCrossSellCatalog } from "./crossSellCatalog";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellMemory" });

/** Sperrfrist, nachdem ein Paar aus dem Shop entfernt wurde (nicht sofort wieder vorschlagen). */
export const CROSS_SELL_REMOVAL_COOLDOWN_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;
const pairKey = (source: string, target: string) => `${source}\u0000${target}`;

export type CrossSellPairFilter = {
  /** Abgelehnt oder in der Sperrfrist (Artikelnummern beliebig, werden auf die Familie abgebildet). */
  isBlocked(sourceProductNumber: string | null | undefined, targetProductNumber: string | null | undefined): boolean;
  /** Von Menschen einzeln freigegebene bzw. gesetzte Paare (Familien-Nummern) - Lernverstaerkung. */
  approvedPairs: Array<{ source: string; target: string }>;
  blockedCount: number;
};

export function buildCrossSellPairFilter(
  states: Array<Pick<CrossSellPairState, "sourceProductNumber" | "targetProductNumber" | "status" | "cooldownUntil" | "decisionSource">>,
  catalog: Pick<CrossSellCatalog, "canonicalNumber">,
  now: Date = new Date(),
): CrossSellPairFilter {
  const blocked = new Set<string>();
  const approvedPairs: Array<{ source: string; target: string }> = [];
  for (const s of states) {
    const inCooldown = s.cooldownUntil ? new Date(s.cooldownUntil).getTime() > now.getTime() : false;
    if (s.status === "rejected" || inCooldown) {
      blocked.add(pairKey(s.sourceProductNumber, s.targetProductNumber));
    } else if ((s.status === "approved" || s.status === "applied") && s.decisionSource === "user") {
      approvedPairs.push({ source: s.sourceProductNumber, target: s.targetProductNumber });
    }
  }
  return {
    isBlocked(source, target) {
      if (!source || !target || blocked.size === 0) return false;
      const s = source.trim();
      const t = target.trim();
      return (
        blocked.has(pairKey(catalog.canonicalNumber(s), catalog.canonicalNumber(t))) || blocked.has(pairKey(s, t))
      );
    },
    approvedPairs,
    blockedCount: blocked.size,
  };
}

const EMPTY_FILTER: CrossSellPairFilter = { isBlocked: () => false, approvedPairs: [], blockedCount: 0 };

export async function loadCrossSellPairFilter(
  storage: Pick<IStorage, "getCrossSellPairStates" | "getShopwareProductIdentities">,
  tenantId: string | null,
): Promise<CrossSellPairFilter> {
  try {
    const [states, catalog] = await Promise.all([
      storage.getCrossSellPairStates({ statuses: ["rejected", "removed", "approved", "applied"] }, tenantId),
      loadCrossSellCatalog(storage, tenantId),
    ]);
    return buildCrossSellPairFilter(states, catalog);
  } catch (err) {
    moduleLog.warn({ err, tenantId }, "Cross-Selling-Gedaechtnis nicht geladen, Vorschlaege ungefiltert");
    return EMPTY_FILTER;
  }
}

type PairRow = Parameters<IStorage["upsertCrossSellPairStates"]>[0][number];

/**
 * Haken fuer applyCrossSellPlan: protokolliert jede Aenderung und fuehrt den Paar-Zustand nach.
 * - Einzelentscheidung im Produkt-Dialog oder in der Pruefliste: decisionSource "user"
 * - Staging-Uebernahme und Massenausfuehrung: "batch" (zaehlt nicht als Einzel-Freigabe)
 * Fehler beim Protokollieren brechen den Schreibvorgang nicht ab.
 */
export function createCrossSellChangeRecorder(
  storage: Pick<IStorage, "appendCrossSellChangeLog" | "upsertCrossSellPairStates">,
  catalog: Pick<CrossSellCatalog, "canonicalNumberForId" | "numberForId">,
  ctx: { tenantId: string | null; userId: string | null; runId?: string | null; origin: CrossSellPairOrigin; now?: () => Date },
): (change: CrossSellApplyChange) => Promise<void> {
  return async (change) => {
    try {
      const now = ctx.now?.() ?? new Date();
      const isUserDecision = change.mode === "product_ui" || change.mode === "approved";
      const decisionSource = isUserDecision ? "user" : change.mode === "auto" ? "auto" : change.mode === "undo" ? "undo" : "batch";
      const logMode = change.dryRun ? "dry_run" : change.mode;
      const sourceNumber = catalog.numberForId(change.sourceProductId) ?? change.sourceProductNumber ?? null;
      const sourceFamily = catalog.canonicalNumberForId(change.sourceProductId) ?? change.sourceProductNumber ?? null;
      const beforeSnapshot = change.before.map((a) => ({ productId: a.productId, position: a.position }));
      const base = {
        runId: ctx.runId ?? null,
        mode: logMode,
        userId: ctx.userId,
        sourceProductId: change.sourceProductId,
        sourceProductNumber: sourceNumber,
        crossSellingId: change.crossSellingId,
        groupName: change.groupName,
        success: true,
        before: beforeSnapshot,
      };
      const log: Parameters<IStorage["appendCrossSellChangeLog"]>[0] = [];
      if (change.createdGroup) log.push({ ...base, action: "create_group" });
      for (const a of change.diff.toAdd) {
        log.push({ ...base, action: "add", targetProductId: a.productId, targetProductNumber: catalog.numberForId(a.productId), position: a.position });
      }
      for (const r of change.diff.toRemove) {
        log.push({ ...base, action: "remove", targetProductId: r.productId, targetProductNumber: catalog.numberForId(r.productId), assignmentId: r.id });
      }
      for (const p of change.diff.reposition) {
        log.push({ ...base, action: "reposition", targetProductId: p.productId, targetProductNumber: catalog.numberForId(p.productId), assignmentId: p.id, position: p.position });
      }
      await storage.appendCrossSellChangeLog(log, ctx.tenantId);

      if (change.dryRun || !sourceFamily) return;

      const added: PairRow[] = [];
      for (const a of change.diff.toAdd) {
        const target = catalog.canonicalNumberForId(a.productId);
        if (!target || target === sourceFamily) continue;
        added.push({
          sourceProductNumber: sourceFamily,
          targetProductNumber: target,
          sourceProductId: change.sourceProductId,
          targetProductId: a.productId,
          status: "applied",
          origin: ctx.origin,
          decisionSource,
          decidedByUserId: ctx.userId,
          decidedAt: now,
          appliedAt: now,
          lastSeenInShopAt: now,
          removedAt: null,
          cooldownUntil: null,
        });
      }
      const removed: PairRow[] = [];
      for (const r of change.diff.toRemove) {
        const target = catalog.canonicalNumberForId(r.productId);
        if (!target || target === sourceFamily) continue;
        removed.push({
          sourceProductNumber: sourceFamily,
          targetProductNumber: target,
          sourceProductId: change.sourceProductId,
          targetProductId: r.productId,
          status: "removed",
          origin: ctx.origin,
          decisionSource,
          decidedByUserId: ctx.userId,
          decidedAt: now,
          removedAt: now,
          cooldownUntil: new Date(now.getTime() + CROSS_SELL_REMOVAL_COOLDOWN_DAYS * DAY_MS),
        });
      }
      const common: CrossSellPairStateUpdateColumn[] = ["status", "decisionSource", "decidedByUserId", "decidedAt", "sourceProductId", "targetProductId", "removedAt", "cooldownUntil"];
      await storage.upsertCrossSellPairStates(added, [...common, "appliedAt", "lastSeenInShopAt"], ctx.tenantId);
      await storage.upsertCrossSellPairStates(removed, common, ctx.tenantId);
    } catch (err) {
      moduleLog.warn({ err, sourceProductId: change.sourceProductId }, "Cross-Selling-Aenderung nicht protokolliert");
    }
  };
}

/** Paar dauerhaft ablehnen (optional beide Richtungen). Liefert die gespeicherten Paare. */
export async function rejectCrossSellPair(
  storage: Pick<IStorage, "upsertCrossSellPairStates">,
  catalog: Pick<CrossSellCatalog, "canonicalNumber">,
  args: {
    tenantId: string | null;
    userId: string | null;
    sourceProductNumber: string;
    targetProductNumber: string;
    reasonCode: string;
    note?: string | null;
    bothDirections?: boolean;
    origin?: CrossSellPairOrigin;
    now?: Date;
  },
): Promise<CrossSellPairState[]> {
  const now = args.now ?? new Date();
  const source = catalog.canonicalNumber(args.sourceProductNumber);
  const target = catalog.canonicalNumber(args.targetProductNumber);
  if (!source || !target || source === target) return [];
  const row = (s: string, t: string): PairRow => ({
    sourceProductNumber: s,
    targetProductNumber: t,
    status: "rejected",
    origin: args.origin ?? "user",
    pendingAction: null,
    decisionSource: "user",
    decidedByUserId: args.userId,
    decidedAt: now,
    decisionReasonCode: args.reasonCode,
    decisionNote: args.note?.trim() || null,
  });
  const rows = [row(source, target)];
  if (args.bothDirections) rows.push(row(target, source));
  return storage.upsertCrossSellPairStates(
    rows,
    ["status", "pendingAction", "decisionSource", "decidedByUserId", "decidedAt", "decisionReasonCode", "decisionNote"],
    args.tenantId,
  );
}
