// Cross-Selling nach Shopware schreiben: Abgleich (Diff) statt "alles loeschen, neu setzen".
// Standard ist Nur-Hinzufuegen in die eigene Gruppe; Entfernen nur ausdruecklich (replace).
// Andere Gruppen (handgepflegt, productStream) werden hier nie angefasst.
import type { ShopwareClient } from "../shopware/shopware";
import type { CrossSellingAssignment } from "../shopware/client/crossSelling";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellApply" });

export const DEFAULT_MAX_TARGETS_PER_MANAGED_GROUP = 10;

export type AssignmentDiff = {
  /** Neue Zuordnungen mit Zielposition. */
  toAdd: Array<{ productId: string; position: number }>;
  /** Zuordnungs-IDs, die entfernt werden. */
  toRemove: Array<{ id: string; productId: string }>;
  /** Bestehende Zuordnungen mit neuer Position (nur im replace-Modus). */
  reposition: Array<{ id: string; productId: string; position: number }>;
  /** Gewuenschte Ziele, die wegen der Obergrenze nicht gesetzt werden. */
  skippedForCap: string[];
  unchanged: number;
};

/**
 * Reine Funktion: vergleicht die aktuelle Gruppe mit der gewuenschten Liste (in Reihenfolge).
 * - Nur-Hinzufuegen: bestehende Eintraege bleiben, neue werden hinten angehaengt, solange die
 *   Gruppe unter maxTargets liegt.
 * - removeMissing: die Gruppe wird genau auf die ersten maxTargets gewuenschten Ziele gebracht.
 */
export function diffAssignments(
  current: CrossSellingAssignment[],
  desired: string[],
  opts: { removeMissing: boolean; maxTargets: number },
): AssignmentDiff {
  const maxTargets = Math.max(0, opts.maxTargets);
  const desiredUnique = Array.from(new Set(desired.filter(Boolean)));
  const currentByProduct = new Map(current.map((a) => [a.productId, a]));

  if (!opts.removeMissing) {
    const fresh = desiredUnique.filter((id) => !currentByProduct.has(id));
    const room = Math.max(0, maxTargets - current.length);
    const maxPos = current.reduce((m, a) => Math.max(m, a.position), 0);
    const adding = fresh.slice(0, room);
    return {
      toAdd: adding.map((productId, i) => ({ productId, position: maxPos + 1 + i })),
      toRemove: [],
      reposition: [],
      skippedForCap: fresh.slice(room),
      unchanged: current.length,
    };
  }

  const finalList = desiredUnique.slice(0, maxTargets);
  const finalSet = new Set(finalList);
  const toAdd: AssignmentDiff["toAdd"] = [];
  const reposition: AssignmentDiff["reposition"] = [];
  let unchanged = 0;
  finalList.forEach((productId, i) => {
    const position = i + 1;
    const existing = currentByProduct.get(productId);
    if (!existing) {
      toAdd.push({ productId, position });
    } else if (existing.position !== position) {
      reposition.push({ id: existing.id, productId, position });
    } else {
      unchanged += 1;
    }
  });
  return {
    toAdd,
    toRemove: current.filter((a) => !finalSet.has(a.productId)).map((a) => ({ id: a.id, productId: a.productId })),
    reposition,
    skippedForCap: desiredUnique.slice(maxTargets),
    unchanged,
  };
}

export type CrossSellApplyOperation = {
  sourceProductId: string;
  sourceProductNumber?: string | null;
  /** Gewuenschte Ziel-Produkt-IDs in Reihenfolge (beste zuerst). */
  targetProductIds: string[];
};

export type CrossSellApplyMode = "staging" | "bulk" | "product_ui" | "auto" | "approved" | "undo";

export type CrossSellApplyChange = {
  mode: CrossSellApplyMode;
  dryRun: boolean;
  sourceProductId: string;
  sourceProductNumber?: string | null;
  crossSellingId: string | null;
  groupName: string;
  createdGroup: boolean;
  before: CrossSellingAssignment[];
  diff: AssignmentDiff;
};

export type CrossSellApplyOptions = {
  mode: CrossSellApplyMode;
  groupName: string;
  maxTargets?: number;
  /** Ziele, die nicht in der Liste stehen, aus der eigenen Gruppe entfernen. */
  replace?: boolean;
  /** Nur berechnen, nichts schreiben. */
  dryRun?: boolean;
  /** Ziel nicht setzen, wenn es schon in einer anderen productList-Gruppe der Quelle steht. */
  skipTargetsInOtherGroups?: boolean;
  onChange?: (change: CrossSellApplyChange) => Promise<void> | void;
};

export type CrossSellApplySourceResult = {
  sourceProductId: string;
  sourceProductNumber?: string | null;
  crossSellingId: string | null;
  createdGroup: boolean;
  added: string[];
  removed: string[];
  skippedForCap: string[];
  skippedInOtherGroups: string[];
};

export type CrossSellApplyResult = {
  sourcesProcessed: number;
  crossSellingsCreated: number;
  crossSellingsUpdated: number;
  sourcesUnchanged: number;
  productsAdded: number;
  productsRemoved: number;
  errors: Array<{ sourceProductId: string; sourceProductNumber?: string | null; error: string }>;
  sources: CrossSellApplySourceResult[];
};

type ApplyClient = {
  [K in "fetchProductCrossSelling" | "fetchCrossSellingAssignments" | "createProductCrossSelling" | "syncCrossSellingAssignments"]: OmitThisParameter<ShopwareClient[K]>;
};

/**
 * Schreibt je Quelle die gewuenschten Ziele in die eigene Gruppe (groupName, productList).
 * Liest den Stand unmittelbar vor dem Schreiben neu ein, fuegt vor dem Loeschen hinzu und
 * faehrt bei Fehlern einer Quelle mit der naechsten fort.
 */
export async function applyCrossSellPlan(
  client: ApplyClient,
  operations: CrossSellApplyOperation[],
  opts: CrossSellApplyOptions,
): Promise<CrossSellApplyResult> {
  const maxTargets = opts.maxTargets ?? DEFAULT_MAX_TARGETS_PER_MANAGED_GROUP;
  const dryRun = opts.dryRun === true;
  const result: CrossSellApplyResult = {
    sourcesProcessed: 0,
    crossSellingsCreated: 0,
    crossSellingsUpdated: 0,
    sourcesUnchanged: 0,
    productsAdded: 0,
    productsRemoved: 0,
    errors: [],
    sources: [],
  };

  for (const op of operations) {
    try {
      const groups = await client.fetchProductCrossSelling(op.sourceProductId);
      const listGroups = groups.filter((g) => g.type === "productList");
      const managed = listGroups.find((g) => g.name === opts.groupName);

      let before: CrossSellingAssignment[] = [];
      if (managed) {
        before = await client.fetchCrossSellingAssignments(managed.id);
      }

      let desired = op.targetProductIds.filter((id) => id && id !== op.sourceProductId);
      let skippedInOtherGroups: string[] = [];
      if (opts.skipTargetsInOtherGroups !== false) {
        const inOther = new Set<string>();
        for (const g of listGroups) {
          if (g.id === managed?.id) continue;
          for (const a of await client.fetchCrossSellingAssignments(g.id)) inOther.add(a.productId);
        }
        skippedInOtherGroups = desired.filter((id) => inOther.has(id));
        desired = desired.filter((id) => !inOther.has(id));
      }

      const diff = diffAssignments(before, desired, { removeMissing: opts.replace === true, maxTargets });
      const hasWrites = diff.toAdd.length > 0 || diff.toRemove.length > 0 || diff.reposition.length > 0;

      let crossSellingId = managed?.id ?? null;
      let createdGroup = false;
      if (hasWrites && !dryRun) {
        if (!crossSellingId) {
          const nextGroupPosition = groups.reduce((m, g) => Math.max(m, g.position ?? 0), 0) + 1;
          crossSellingId = await client.createProductCrossSelling(
            op.sourceProductId,
            opts.groupName,
            "productList",
            nextGroupPosition,
          );
          createdGroup = true;
        }
        await client.syncCrossSellingAssignments(crossSellingId, {
          upsert: [
            ...diff.toAdd.map((a) => ({ productId: a.productId, position: a.position })),
            ...diff.reposition.map((a) => ({ id: a.id, productId: a.productId, position: a.position })),
          ],
          deleteIds: diff.toRemove.map((r) => r.id),
        });
      } else if (hasWrites && dryRun && !crossSellingId) {
        createdGroup = true;
      }

      result.sourcesProcessed += 1;
      if (!hasWrites) {
        result.sourcesUnchanged += 1;
      } else if (createdGroup) {
        result.crossSellingsCreated += 1;
      } else {
        result.crossSellingsUpdated += 1;
      }
      result.productsAdded += diff.toAdd.length;
      result.productsRemoved += diff.toRemove.length;
      result.sources.push({
        sourceProductId: op.sourceProductId,
        sourceProductNumber: op.sourceProductNumber ?? null,
        crossSellingId,
        createdGroup,
        added: diff.toAdd.map((a) => a.productId),
        removed: diff.toRemove.map((r) => r.productId),
        skippedForCap: diff.skippedForCap,
        skippedInOtherGroups,
      });

      if (hasWrites && opts.onChange) {
        await opts.onChange({
          mode: opts.mode,
          dryRun,
          sourceProductId: op.sourceProductId,
          sourceProductNumber: op.sourceProductNumber ?? null,
          crossSellingId,
          groupName: opts.groupName,
          createdGroup,
          before,
          diff,
        });
      }
    } catch (error: any) {
      moduleLog.warn(
        { err: error, sourceProductId: op.sourceProductId, sourceProductNumber: op.sourceProductNumber },
        "Cross-Selling fuer Quelle konnte nicht geschrieben werden",
      );
      result.errors.push({
        sourceProductId: op.sourceProductId,
        sourceProductNumber: op.sourceProductNumber ?? null,
        error: error?.message || String(error),
      });
    }
  }

  moduleLog.info(
    {
      mode: opts.mode,
      dryRun,
      replace: opts.replace === true,
      sources: operations.length,
      created: result.crossSellingsCreated,
      updated: result.crossSellingsUpdated,
      added: result.productsAdded,
      removed: result.productsRemoved,
      errors: result.errors.length,
    },
    "Cross-Selling nach Shopware abgeglichen",
  );
  return result;
}
