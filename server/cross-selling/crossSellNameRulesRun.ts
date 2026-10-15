// Lauf der festen Namensregeln (crossSellNameRules.ts): Paare berechnen und in die verwaltete
// Liste schreiben. Laeuft als eigener Lauf ("name_rules") mit Protokoll; "Lauf rueckgaengig"
// funktioniert wie bei der Automatik (mode "auto"). Herkunft der Paare: "heuristic" – die
// Monatspruefung prueft sie nicht per KI und schlaegt sie nicht wegen "passt nicht"/"wirkungslos"
// zum Entfernen vor. Paare, die jemand abgelehnt oder rueckgaengig gemacht hat, bleiben draussen.
import type { IStorage } from "../storage";
import type { ProductMetaSource } from "../shopware/client/productMeta";
import { applyCrossSellPlan, type CrossSellApplyOperation } from "./crossSellApply";
import type { CrossSellCatalog } from "./crossSellCatalog";
import type { CrossSellAutomationSettings } from "./crossSellAutomationSettings";
import { createCrossSellChangeRecorder } from "./crossSellMemory";
import { berlinDateKey } from "./crossSellCandidates";
import { buildNameRulePairs, type NameRuleKind } from "./crossSellNameRules";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellNameRulesRun" });

const CHUNK = 100;
const EXAMPLES = 15;

type ApplyClientMethods = Parameters<typeof applyCrossSellPlan>[0];

export type NameRuleRunDeps = {
  storage: Pick<
    IStorage,
    "acquireCrossSellRun" | "finishCrossSellRun" | "getCrossSellPairStates" | "appendCrossSellChangeLog" | "upsertCrossSellPairStates"
  >;
  client: ApplyClientMethods & { fetchProductMetaSources(): Promise<ProductMetaSource[]> };
  loadCatalog: () => Promise<CrossSellCatalog>;
  settings: CrossSellAutomationSettings;
  now?: () => Date;
};

export type NameRuleRunStats = {
  dryRun: boolean;
  products: number;
  sources: number;
  pairs: number;
  byKind: Record<NameRuleKind, number>;
  skippedRejected: number;
  sourcesWritten: number;
  /** Tatsaechlich gesetzt (im Testlauf 0) */
  autoApplied: number;
  /** Im Testlauf: wuerden gesetzt */
  dryRunFlagged: number;
  skippedInOtherGroups: number;
  skippedForCap: number;
  errors: number;
  examples: Array<{ source: string; sourceName: string; targets: Array<{ number: string; name: string; kind: NameRuleKind }> }>;
};

export async function runNameRuleCrossSelling(
  deps: NameRuleRunDeps,
  args: {
    tenantId: string | null;
    userId?: string | null;
    trigger: "scheduled" | "manual";
    dryRun: boolean;
    onProgress?: (processed: number, total: number) => void;
  },
): Promise<{ runId: string | null; skipped?: string; stats?: NameRuleRunStats }> {
  const now = deps.now?.() ?? new Date();
  const { storage, settings, tenantId } = { ...deps, tenantId: args.tenantId };
  const run = await storage.acquireCrossSellRun(
    {
      kind: "name_rules",
      periodKey: args.trigger === "scheduled" ? berlinDateKey(now) : `manual:${now.toISOString()}`,
      userId: args.userId ?? null,
    },
    tenantId,
  );
  if (!run) return { runId: null, skipped: "already_ran" };

  const stats: NameRuleRunStats = {
    dryRun: args.dryRun,
    products: 0,
    sources: 0,
    pairs: 0,
    byKind: { partner_shelf: 0, board: 0, back_wall: 0, side_wall: 0 },
    skippedRejected: 0,
    sourcesWritten: 0,
    autoApplied: 0,
    dryRunFlagged: 0,
    skippedInOtherGroups: 0,
    skippedForCap: 0,
    errors: 0,
    examples: [],
  };
  try {
    const products = (await deps.client.fetchProductMetaSources()).filter((p) => p.active && p.visible && p.name);
    stats.products = products.length;
    const byNumber = new Map(products.map((p) => [p.productNumber, p]));
    const allPairs = buildNameRulePairs(products, { maxPerSource: settings.maxTargetsPerManagedGroup });

    // Abgelehnt oder rueckgaengig gemacht (rejected) bzw. entfernt mit laufender Sperre: nicht erneut setzen
    const blocked = new Set<string>();
    for (const s of await storage.getCrossSellPairStates({ statuses: ["rejected", "removed"] }, tenantId)) {
      const coolingDown = s.status === "removed" && s.cooldownUntil && new Date(s.cooldownUntil).getTime() > now.getTime();
      if (s.status === "rejected" || coolingDown) blocked.add(`${s.sourceProductNumber}>${s.targetProductNumber}`);
    }
    const pairs = allPairs.filter((p) => {
      if (blocked.has(`${p.source}>${p.target}`)) {
        stats.skippedRejected += 1;
        return false;
      }
      return true;
    });
    stats.pairs = pairs.length;
    for (const p of pairs) stats.byKind[p.kind] += 1;

    const operations: CrossSellApplyOperation[] = [];
    const bySource = new Map<string, typeof pairs>();
    for (const p of pairs) bySource.set(p.source, [...(bySource.get(p.source) ?? []), p]);
    for (const [source, list] of bySource) {
      const src = byNumber.get(source);
      if (!src) continue;
      const targetProductIds = list.map((p) => byNumber.get(p.target)?.id).filter((id): id is string => Boolean(id));
      if (targetProductIds.length > 0) operations.push({ sourceProductId: src.id, sourceProductNumber: source, targetProductIds });
      if (stats.examples.length < EXAMPLES) {
        stats.examples.push({
          source,
          sourceName: src.name,
          targets: list.map((p) => ({ number: p.target, name: byNumber.get(p.target)?.name ?? "", kind: p.kind })),
        });
      }
    }
    stats.sources = operations.length;

    const catalog = await deps.loadCatalog();
    const recorder = createCrossSellChangeRecorder(storage, catalog, {
      tenantId,
      userId: args.userId ?? null,
      runId: run.id,
      origin: "heuristic",
      now: () => now,
    });
    for (let i = 0; i < operations.length; i += CHUNK) {
      const result = await applyCrossSellPlan(deps.client, operations.slice(i, i + CHUNK), {
        mode: "auto",
        groupName: settings.managedGroupName,
        maxTargets: settings.maxTargetsPerManagedGroup,
        replace: false,
        dryRun: args.dryRun,
        skipTargetsInOtherGroups: true,
        onChange: recorder,
      });
      stats.sourcesWritten += result.crossSellingsCreated + result.crossSellingsUpdated;
      if (args.dryRun) stats.dryRunFlagged += result.productsAdded;
      else stats.autoApplied += result.productsAdded;
      stats.errors += result.errors.length;
      for (const s of result.sources) {
        stats.skippedInOtherGroups += s.skippedInOtherGroups.length;
        stats.skippedForCap += s.skippedForCap.length;
      }
      args.onProgress?.(Math.min(i + CHUNK, operations.length), operations.length);
    }

    await storage.finishCrossSellRun(run.id, { status: "completed", stats: stats as unknown as Record<string, unknown> }, tenantId);
    moduleLog.info(
      { tenantId, dryRun: args.dryRun, sources: stats.sources, pairs: stats.pairs, applied: stats.autoApplied, flagged: stats.dryRunFlagged },
      "Cross-Selling-Namensregeln: Lauf abgeschlossen",
    );
    return { runId: run.id, stats };
  } catch (err: any) {
    await storage.finishCrossSellRun(
      run.id,
      { status: "failed", stats: stats as unknown as Record<string, unknown>, error: err?.message || String(err) },
      tenantId,
    );
    throw err;
  }
}
