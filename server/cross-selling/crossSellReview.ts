// Pruefliste der Cross-Selling-Teilautomatik: Vorschlaege freigeben (schreibt in den Shop),
// ablehnen (Gedaechtnis) und Aenderungen rueckgaengig machen.
import type { CrossSellPairState, CrossSellChangeLogEntry } from "@shared/schema";
import type { IStorage } from "../storage";
import type { ShopwareClient } from "../shopware/shopware";
import { applyCrossSellPlan, type CrossSellApplyOperation } from "./crossSellApply";
import { createCrossSellChangeRecorder, rejectCrossSellPair } from "./crossSellMemory";
import type { CrossSellCatalog } from "./crossSellCatalog";
import type { CrossSellAutomationSettings } from "./crossSellAutomationSettings";

type ReviewClient = {
  [K in "fetchProductCrossSelling" | "fetchCrossSellingAssignments" | "createProductCrossSelling" | "syncCrossSellingAssignments"]: OmitThisParameter<ShopwareClient[K]>;
};

export type ApproveOutcome = {
  approved: string[];
  alreadyInShop: string[];
  groupFull: string[];
  failed: Array<{ id: string; error: string }>;
};

/**
 * Vorgeschlagene Ergaenzungen freigeben: je Quelle in die verwaltete Liste schreiben.
 * Steht ein Ziel schon in einer anderen Liste der Quelle, gilt das Paar als im Shop.
 */
export async function approveCrossSellPairs(
  deps: { storage: IStorage; client: ReviewClient; catalog: CrossSellCatalog; settings: CrossSellAutomationSettings },
  pairs: CrossSellPairState[],
  ctx: { tenantId: string | null; userId: string | null },
): Promise<ApproveOutcome> {
  const out: ApproveOutcome = { approved: [], alreadyInShop: [], groupFull: [], failed: [] };
  const ops = new Map<string, CrossSellApplyOperation & { pairs: Array<{ pair: CrossSellPairState; targetId: string }> }>();
  for (const pair of pairs) {
    if (pair.pendingAction !== "add") {
      out.failed.push({ id: pair.id, error: "not_pending_add" });
      continue;
    }
    const sourceId = pair.sourceProductId ?? deps.catalog.byNumber.get(pair.sourceProductNumber)?.id;
    const targetId = pair.targetProductId ?? deps.catalog.byNumber.get(pair.targetProductNumber)?.id;
    if (!sourceId || !targetId) {
      out.failed.push({ id: pair.id, error: "product_not_found" });
      continue;
    }
    const op = ops.get(sourceId) ?? { sourceProductId: sourceId, sourceProductNumber: pair.sourceProductNumber, targetProductIds: [], pairs: [] };
    op.targetProductIds.push(targetId);
    op.pairs.push({ pair, targetId });
    ops.set(sourceId, op);
  }
  if (ops.size === 0) return out;

  const result = await applyCrossSellPlan(deps.client, Array.from(ops.values()), {
    mode: "approved",
    groupName: deps.settings.managedGroupName,
    maxTargets: deps.settings.maxTargetsPerManagedGroup,
    replace: false,
    onChange: createCrossSellChangeRecorder(deps.storage, deps.catalog, { tenantId: ctx.tenantId, userId: ctx.userId, origin: "ai" }),
  });
  const now = new Date();
  for (const op of ops.values()) {
    const src = result.sources.find((s) => s.sourceProductId === op.sourceProductId);
    const err = result.errors.find((e) => e.sourceProductId === op.sourceProductId);
    for (const { pair, targetId } of op.pairs) {
      if (err || !src) {
        out.failed.push({ id: pair.id, error: err?.error ?? "apply_failed" });
        continue;
      }
      if (src.added.includes(targetId)) {
        out.approved.push(pair.id);
        await deps.storage.updateCrossSellPairState(
          pair.id,
          { pendingAction: null, baseline: { ...(pair.stats ?? {}), at: now.toISOString() } },
          ctx.tenantId,
        );
      } else if (src.skippedInOtherGroups.includes(targetId)) {
        out.alreadyInShop.push(pair.id);
        await deps.storage.updateCrossSellPairState(
          pair.id,
          { pendingAction: null, status: "applied", decisionSource: "user", decidedByUserId: ctx.userId, decidedAt: now, lastSeenInShopAt: now },
          ctx.tenantId,
        );
      } else if (src.skippedForCap.includes(targetId)) {
        out.groupFull.push(pair.id);
      } else {
        // schon in der verwalteten Liste
        out.alreadyInShop.push(pair.id);
        await deps.storage.updateCrossSellPairState(
          pair.id,
          { pendingAction: null, status: "applied", decisionSource: "user", decidedByUserId: ctx.userId, decidedAt: now, lastSeenInShopAt: now },
          ctx.tenantId,
        );
      }
    }
  }
  return out;
}

export async function rejectQueuedCrossSellPairs(
  deps: { storage: IStorage; catalog: CrossSellCatalog },
  pairs: CrossSellPairState[],
  ctx: { tenantId: string | null; userId: string | null; reasonCode: string; note?: string | null; bothDirections?: boolean },
): Promise<number> {
  let n = 0;
  for (const pair of pairs) {
    const saved = await rejectCrossSellPair(deps.storage, deps.catalog, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      sourceProductNumber: pair.sourceProductNumber,
      targetProductNumber: pair.targetProductNumber,
      reasonCode: ctx.reasonCode,
      note: ctx.note,
      bothDirections: ctx.bothDirections,
      origin: pair.origin,
    });
    n += saved.length > 0 ? 1 : 0;
  }
  return n;
}

export type UndoOutcome = { undone: number[]; skipped: Array<{ id: number; reason: string }> };

/**
 * Hinzufuegen bzw. Entfernen rueckgaengig machen. Ein rueckgaengig gemachtes Hinzufuegen
 * wird als Ablehnung gemerkt (Grund "undo"), damit das Paar nicht gleich wiederkommt.
 */
export async function undoCrossSellChanges(
  deps: { storage: IStorage; client: Pick<ReviewClient, "fetchCrossSellingAssignments" | "syncCrossSellingAssignments">; catalog: CrossSellCatalog },
  entries: CrossSellChangeLogEntry[],
  ctx: { tenantId: string | null; userId: string | null },
): Promise<UndoOutcome> {
  const out: UndoOutcome = { undone: [], skipped: [] };
  for (const e of entries) {
    if (e.undoneById) {
      out.skipped.push({ id: e.id, reason: "already_undone" });
      continue;
    }
    if (!e.success || e.mode === "dry_run" || !e.crossSellingId || !e.targetProductId || (e.action !== "add" && e.action !== "remove")) {
      out.skipped.push({ id: e.id, reason: "not_undoable" });
      continue;
    }
    try {
      const current = await deps.client.fetchCrossSellingAssignments(e.crossSellingId);
      let position: number | null = null;
      if (e.action === "add") {
        const assignment = current.find((a) => a.productId === e.targetProductId);
        if (!assignment) {
          out.skipped.push({ id: e.id, reason: "not_in_shop" });
          continue;
        }
        await deps.client.syncCrossSellingAssignments(e.crossSellingId, { upsert: [], deleteIds: [assignment.id] });
      } else {
        if (current.some((a) => a.productId === e.targetProductId)) {
          out.skipped.push({ id: e.id, reason: "already_in_shop" });
          continue;
        }
        position = current.reduce((m, a) => Math.max(m, a.position), 0) + 1;
        await deps.client.syncCrossSellingAssignments(e.crossSellingId, {
          upsert: [{ productId: e.targetProductId, position }],
          deleteIds: [],
        });
      }
      const [undoId] = await deps.storage.appendCrossSellChangeLog(
        [
          {
            runId: e.runId,
            action: e.action === "add" ? "remove" : "add",
            mode: "undo",
            userId: ctx.userId,
            sourceProductId: e.sourceProductId,
            sourceProductNumber: e.sourceProductNumber,
            targetProductId: e.targetProductId,
            targetProductNumber: e.targetProductNumber,
            crossSellingId: e.crossSellingId,
            groupName: e.groupName,
            position,
            success: true,
            undoOfId: e.id,
          },
        ],
        ctx.tenantId,
      );
      if (undoId) await deps.storage.markCrossSellChangeUndone(e.id, undoId, ctx.tenantId);

      const source = e.sourceProductId ? deps.catalog.canonicalNumberForId(e.sourceProductId) : null;
      const target = deps.catalog.canonicalNumberForId(e.targetProductId);
      if (source && target && source !== target) {
        const now = new Date();
        await deps.storage.upsertCrossSellPairStates(
          [
            e.action === "add"
              ? {
                  sourceProductNumber: source,
                  targetProductNumber: target,
                  status: "rejected",
                  origin: "ai",
                  pendingAction: null,
                  decisionSource: "undo",
                  decidedByUserId: ctx.userId,
                  decidedAt: now,
                  decisionReasonCode: "undo",
                  removedAt: now,
                }
              : {
                  sourceProductNumber: source,
                  targetProductNumber: target,
                  status: "applied",
                  origin: "ai",
                  pendingAction: null,
                  decisionSource: "undo",
                  decidedByUserId: ctx.userId,
                  decidedAt: now,
                  removedAt: null,
                  cooldownUntil: null,
                  appliedAt: now,
                },
          ],
          e.action === "add"
            ? ["status", "pendingAction", "decisionSource", "decidedByUserId", "decidedAt", "decisionReasonCode", "removedAt"]
            : ["status", "pendingAction", "decisionSource", "decidedByUserId", "decidedAt", "removedAt", "cooldownUntil", "appliedAt"],
          ctx.tenantId,
        );
      }
      out.undone.push(e.id);
    } catch (err: any) {
      out.skipped.push({ id: e.id, reason: err?.message || "error" });
    }
  }
  return out;
}

export type RemovalOutcome = { removed: string[]; notInShop: string[]; failed: Array<{ id: string; error: string }> };

/**
 * Entfernen-Vorschlaege bestaetigen: das Ziel aus jeder festen Liste der Quelle nehmen, in der
 * es laut Gedaechtnis steht (auch Handgruppen - "Mitverwalten"). Gruppen bleiben bestehen.
 */
export async function approveCrossSellRemovals(
  deps: { storage: IStorage; client: Pick<ReviewClient, "fetchCrossSellingAssignments" | "syncCrossSellingAssignments">; catalog: CrossSellCatalog },
  pairs: CrossSellPairState[],
  ctx: { tenantId: string | null; userId: string | null },
): Promise<RemovalOutcome> {
  const out: RemovalOutcome = { removed: [], notInShop: [], failed: [] };
  const recorder = createCrossSellChangeRecorder(deps.storage, deps.catalog, { tenantId: ctx.tenantId, userId: ctx.userId, origin: "ai" });
  for (const pair of pairs) {
    if (pair.pendingAction !== "remove") {
      out.failed.push({ id: pair.id, error: "not_pending_remove" });
      continue;
    }
    try {
      const refs = pair.shopRefs ?? [];
      let removedAny = false;
      for (const groupId of Array.from(new Set(refs.map((r) => r.groupId)))) {
        const groupRefs = refs.filter((r) => r.groupId === groupId);
        const before = await deps.client.fetchCrossSellingAssignments(groupId);
        const targetIds = new Set(groupRefs.map((r) => r.productId));
        const toRemove = before.filter((a) => targetIds.has(a.productId)).map((a) => ({ id: a.id, productId: a.productId }));
        if (toRemove.length === 0) continue;
        await deps.client.syncCrossSellingAssignments(groupId, { upsert: [], deleteIds: toRemove.map((r) => r.id) });
        removedAny = true;
        await recorder({
          mode: "approved",
          dryRun: false,
          sourceProductId: groupRefs[0].ownerProductId,
          sourceProductNumber: pair.sourceProductNumber,
          crossSellingId: groupId,
          groupName: groupRefs[0].groupName,
          createdGroup: false,
          before,
          diff: { toAdd: [], toRemove, reposition: [], skippedForCap: [], unchanged: before.length - toRemove.length },
        });
      }
      await deps.storage.updateCrossSellPairState(
        pair.id,
        {
          pendingAction: null,
          status: "removed",
          shopRefs: [],
          decisionSource: "user",
          decidedByUserId: ctx.userId,
          decidedAt: new Date(),
          removedAt: new Date(),
          cooldownUntil: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        },
        ctx.tenantId,
      );
      (removedAny ? out.removed : out.notInShop).push(pair.id);
    } catch (err: any) {
      out.failed.push({ id: pair.id, error: err?.message || "error" });
    }
  }
  return out;
}

/** Entfernen-Vorschlag ablehnen: Paar bleibt im Shop und wird kuenftig nicht mehr vorgeschlagen. */
export async function keepCrossSellPairs(
  storage: Pick<IStorage, "updateCrossSellPairState">,
  pairs: CrossSellPairState[],
  ctx: { tenantId: string | null; userId: string | null; note?: string | null },
): Promise<number> {
  let n = 0;
  for (const pair of pairs) {
    if (pair.pendingAction !== "remove") continue;
    await storage.updateCrossSellPairState(
      pair.id,
      {
        pendingAction: null,
        status: "applied",
        protected: true,
        decisionSource: "user",
        decidedByUserId: ctx.userId,
        decidedAt: new Date(),
        decisionReasonCode: "keep",
        decisionNote: ctx.note?.trim() || null,
      },
      ctx.tenantId,
    );
    n += 1;
  }
  return n;
}
