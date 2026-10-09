// "Shop-Zuordnungen einlesen": alle festen Cross-Selling-Listen (productList) des Shops ins
// Gedaechtnis uebernehmen. Nur lesend gegenueber Shopware. Dynamische Gruppen (productStream)
// werden nur gezaehlt. Von Hand im Shop entfernte Paare werden als "entfernt" markiert.
import type { CrossSellPairOrigin, CrossSellPairShopRef, CrossSellPairState } from "@shared/schema";
import { SHOPWARE_CROSS_SELLING_STOREFRONT_NAME } from "@shared/schema";
import type { IStorage, CrossSellPairStateUpdateColumn } from "../storage";
import type { ShopwareClient } from "../shopware/shopware";
import type { CrossSellingGroupWithAssignments } from "../shopware/client/crossSelling";
import type { CrossSellCatalog } from "./crossSellCatalog";
import { loadCrossSellCatalog } from "./crossSellCatalog";
import { CROSS_SELL_REMOVAL_COOLDOWN_DAYS } from "./crossSellMemory";
import { getCrossSellAutomationSettings } from "./crossSellAutomationSettings";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellImport" });
const DAY_MS = 24 * 60 * 60 * 1000;

/** Gruppen, die METAorder (oder fruehere Versionen) angelegt hat; alles andere gilt als Handpflege. */
export function classifyCrossSellGroupOrigin(groupName: string, managedGroupName: string): CrossSellPairOrigin {
  const name = groupName.trim();
  if (name === managedGroupName.trim() || name === SHOPWARE_CROSS_SELLING_STOREFRONT_NAME) return "legacy_metaorder";
  if (/^(Auto|Staging) Cross-Selling \(/.test(name)) return "legacy_metaorder";
  return "shopware_manual";
}

export type CrossSellImportStats = {
  groupsScanned: number;
  productListGroups: number;
  productStreamGroups: number;
  assignments: number;
  unknownProducts: number;
  pairsLive: number;
  pairsNew: number;
  pairsRemovedExternally: number;
  byOrigin: Record<string, number>;
  byGroupName: Record<string, number>;
};

type PairRow = Parameters<IStorage["upsertCrossSellPairStates"]>[0][number];

/**
 * Reine Funktion: aus Shop-Gruppen und bisherigem Gedaechtnis die Aenderungen berechnen.
 * - Paare im Shop: Shop-Stand aktualisieren; neue Paare mit Herkunft anlegen. Abgelehnte bzw.
 *   zur Entfernung vorgeschlagene Paare behalten ihren Status (die Monatspruefung kuemmert sich).
 * - Frueher gesehene, jetzt fehlende Paare mit Status "im Shop": "entfernt" + Sperrfrist.
 */
export function planCrossSellImport(
  groups: CrossSellingGroupWithAssignments[],
  existing: Array<Pick<CrossSellPairState, "sourceProductNumber" | "targetProductNumber" | "status" | "appliedAt" | "lastSeenInShopAt">>,
  catalog: Pick<CrossSellCatalog, "canonicalNumberForId">,
  managedGroupName: string,
  now: Date,
): { live: PairRow[]; keepStatus: PairRow[]; removed: PairRow[]; stats: CrossSellImportStats } {
  const stats: CrossSellImportStats = {
    groupsScanned: groups.length,
    productListGroups: 0,
    productStreamGroups: 0,
    assignments: 0,
    unknownProducts: 0,
    pairsLive: 0,
    pairsNew: 0,
    pairsRemovedExternally: 0,
    byOrigin: {},
    byGroupName: {},
  };
  type Acc = { source: string; target: string; sourceId: string; targetId: string; refs: CrossSellPairShopRef[]; origin: CrossSellPairOrigin };
  const pairs = new Map<string, Acc>();
  for (const g of groups) {
    if (g.type !== "productList") {
      stats.productStreamGroups += 1;
      continue;
    }
    stats.productListGroups += 1;
    stats.byGroupName[g.name] = (stats.byGroupName[g.name] ?? 0) + 1;
    const source = catalog.canonicalNumberForId(g.productId);
    const origin = classifyCrossSellGroupOrigin(g.name, managedGroupName);
    for (const a of g.assignedProducts) {
      stats.assignments += 1;
      const target = catalog.canonicalNumberForId(a.productId);
      if (!source || !target) {
        stats.unknownProducts += 1;
        continue;
      }
      if (source === target) continue;
      const key = `${source}\u0000${target}`;
      let acc = pairs.get(key);
      if (!acc) {
        acc = { source, target, sourceId: g.productId, targetId: a.productId, refs: [], origin };
        pairs.set(key, acc);
      }
      // Handpflege hat Vorrang: steht ein Paar auch in einer Handgruppe, gilt es als handgepflegt.
      if (origin === "shopware_manual") acc.origin = "shopware_manual";
      acc.refs.push({
        groupId: g.id,
        groupName: g.name,
        groupActive: g.active,
        ownerProductId: g.productId,
        assignmentId: a.id,
        productId: a.productId,
        position: a.position,
        createdAt: a.createdAt ?? null,
      });
    }
  }

  const existingByKey = new Map(existing.map((e) => [`${e.sourceProductNumber}\u0000${e.targetProductNumber}`, e]));
  const live: PairRow[] = [];
  const keepStatus: PairRow[] = [];
  for (const [key, acc] of pairs) {
    const prev = existingByKey.get(key);
    const firstSeen = acc.refs
      .map((r) => (r.createdAt ? new Date(r.createdAt).getTime() : NaN))
      .filter((t) => Number.isFinite(t))
      .sort((x, y) => x - y)[0];
    const row: PairRow = {
      sourceProductNumber: acc.source,
      targetProductNumber: acc.target,
      sourceProductId: acc.sourceId,
      targetProductId: acc.targetId,
      origin: acc.origin,
      status: "applied",
      decisionSource: "import",
      shopRefs: acc.refs,
      lastSeenInShopAt: now,
      appliedAt: prev?.appliedAt ?? (firstSeen ? new Date(firstSeen) : now),
      removedAt: null,
      cooldownUntil: null,
    };
    stats.pairsLive += 1;
    stats.byOrigin[acc.origin] = (stats.byOrigin[acc.origin] ?? 0) + 1;
    if (!prev) stats.pairsNew += 1;
    if (prev && (prev.status === "rejected" || prev.status === "removal_proposed")) {
      keepStatus.push(row);
    } else {
      live.push(row);
    }
  }

  const removed: PairRow[] = [];
  for (const e of existing) {
    const key = `${e.sourceProductNumber}\u0000${e.targetProductNumber}`;
    if (pairs.has(key) || e.status !== "applied" || !e.lastSeenInShopAt) continue;
    stats.pairsRemovedExternally += 1;
    removed.push({
      sourceProductNumber: e.sourceProductNumber,
      targetProductNumber: e.targetProductNumber,
      status: "removed",
      origin: "shopware_manual",
      decisionSource: "external",
      removedAt: now,
      cooldownUntil: new Date(now.getTime() + CROSS_SELL_REMOVAL_COOLDOWN_DAYS * DAY_MS),
      shopRefs: [],
    });
  }
  return { live, keepStatus, removed, stats };
}

type ImportClient = { searchCrossSellingGroups: OmitThisParameter<ShopwareClient["searchCrossSellingGroups"]> };

/** Alle Gruppen laden (bricht bei einem Fehler ab, damit nichts faelschlich als entfernt gilt). */
export async function fetchAllCrossSellingGroups(client: ImportClient, onPage?: (loaded: number) => void): Promise<CrossSellingGroupWithAssignments[]> {
  const all: CrossSellingGroupWithAssignments[] = [];
  for (let page = 1; page <= 400; page++) {
    const { groups, hasMore } = await client.searchCrossSellingGroups(page);
    all.push(...groups);
    onPage?.(all.length);
    if (!hasMore) break;
  }
  return all;
}

/**
 * Shop-Stand ins Gedaechtnis uebernehmen (ohne eigenen Lauf). Nutzt der Import und die
 * Monatspruefung. Liefert die Gruppen fuer weitere Pruefungen mit.
 */
export async function syncShopAssignmentsIntoMemory(
  storage: IStorage,
  client: ImportClient,
  args: { tenantId: string | null; onProgress?: (loaded: number) => void; now?: Date },
): Promise<{ stats: CrossSellImportStats; groups: CrossSellingGroupWithAssignments[]; catalog: CrossSellCatalog }> {
  const settings = await getCrossSellAutomationSettings(storage, args.tenantId);
  const [groups, catalog, existing] = await Promise.all([
    fetchAllCrossSellingGroups(client, args.onProgress),
    loadCrossSellCatalog(storage, args.tenantId, { fresh: true }),
    storage.getCrossSellPairStates({}, args.tenantId),
  ]);
  const plan = planCrossSellImport(groups, existing, catalog, settings.managedGroupName, args.now ?? new Date());
  const shopColumns: CrossSellPairStateUpdateColumn[] = ["shopRefs", "lastSeenInShopAt", "sourceProductId", "targetProductId"];
  await storage.upsertCrossSellPairStates(plan.live, [...shopColumns, "status", "appliedAt", "removedAt", "cooldownUntil"], args.tenantId);
  await storage.upsertCrossSellPairStates(plan.keepStatus, shopColumns, args.tenantId);
  await storage.upsertCrossSellPairStates(
    plan.removed,
    ["status", "decisionSource", "removedAt", "cooldownUntil", "shopRefs"],
    args.tenantId,
  );
  return { stats: plan.stats, groups, catalog };
}

export async function runCrossSellImport(
  storage: IStorage,
  client: ImportClient,
  args: { tenantId: string | null; userId: string | null; onProgress?: (loaded: number) => void },
): Promise<{ runId: string | null; stats: CrossSellImportStats }> {
  const run = await storage.acquireCrossSellRun(
    { kind: "import", periodKey: `manual:${new Date().toISOString()}`, userId: args.userId },
    args.tenantId,
  );
  try {
    const { stats } = await syncShopAssignmentsIntoMemory(storage, client, args);
    if (run) await storage.finishCrossSellRun(run.id, { status: "completed", stats }, args.tenantId);
    moduleLog.info({ tenantId: args.tenantId, ...stats, byGroupName: undefined }, "Shop-Zuordnungen eingelesen");
    return { runId: run?.id ?? null, stats };
  } catch (err: any) {
    if (run) await storage.finishCrossSellRun(run.id, { status: "failed", error: err?.message || String(err) }, args.tenantId);
    throw err;
  }
}
