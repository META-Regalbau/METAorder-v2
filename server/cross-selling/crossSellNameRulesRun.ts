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
import { buildNameRulePairs, NAME_RULE_TAB, type NameRuleKind, type NameRuleTab } from "./crossSellNameRules";
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
  /** Aus einem eigenen Tab in einen anderen verschoben (dort entfernt) */
  moved: number;
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
    /** Nur diese Ausgangsartikel schreiben (z. B. Test oder einzelner Artikel) */
    onlySourceNumbers?: string[];
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
    byKind: Object.fromEntries(Object.keys(NAME_RULE_TAB).map((k) => [k, 0])) as Record<NameRuleKind, number>,
    skippedRejected: 0,
    sourcesWritten: 0,
    autoApplied: 0,
    dryRunFlagged: 0,
    skippedInOtherGroups: 0,
    skippedForCap: 0,
    moved: 0,
    errors: 0,
    examples: [],
  };
  try {
    const products = (await deps.client.fetchProductMetaSources()).filter((p) => p.active && p.visible && p.name);
    stats.products = products.length;
    const byNumber = new Map(products.map((p) => [p.productNumber, p]));
    const allPairs = buildNameRulePairs(products, {
      maxPerTab: {
        accessories: settings.maxTargetsPerManagedGroup,
        extend: settings.maxTargetsExtendGroup,
        parts: settings.maxTargetsPartsGroup,
        variants: settings.maxTargetsVariantsGroup,
      },
      systemAccessories: settings.nameRuleSystemAccessories,
    });

    // Abgelehnt oder rueckgaengig gemacht (rejected) bzw. entfernt mit laufender Sperre: nicht erneut setzen
    const blocked = new Set<string>();
    for (const s of await storage.getCrossSellPairStates({ statuses: ["rejected", "removed"] }, tenantId)) {
      const coolingDown = s.status === "removed" && s.cooldownUntil && new Date(s.cooldownUntil).getTime() > now.getTime();
      if (s.status === "rejected" || coolingDown) blocked.add(`${s.sourceProductNumber}>${s.targetProductNumber}`);
    }
    const only = args.onlySourceNumbers?.length ? new Set(args.onlySourceNumbers) : null;
    const pairs = allPairs.filter((p) => {
      if (only && !only.has(p.source)) return false;
      if (blocked.has(`${p.source}>${p.target}`)) {
        stats.skippedRejected += 1;
        return false;
      }
      return true;
    });
    stats.pairs = pairs.length;
    for (const p of pairs) stats.byKind[p.kind] += 1;

    // Je Tab eine eigene Liste im Shop; Ziele, die jetzt in einen anderen eigenen Tab gehoeren
    // (z. B. Partnerregal von "Das passt dazu" nach "Regal erweitern"), wandern dorthin.
    // "Auch erhältlich in" zeigt der Shop oben als Auswahl; dort zaehlen alle Ausfuehrungen, auch wenn
    // ein alter Tab sie schon listet.
    const tabs: Array<{ tab: NameRuleTab; groupName: string; maxTargets: number; skipTargetsInOtherGroups: boolean }> = [
      { tab: "accessories", groupName: settings.managedGroupName, maxTargets: settings.maxTargetsPerManagedGroup, skipTargetsInOtherGroups: true },
      { tab: "extend", groupName: settings.extendGroupName, maxTargets: settings.maxTargetsExtendGroup, skipTargetsInOtherGroups: true },
      { tab: "parts", groupName: settings.partsGroupName, maxTargets: settings.maxTargetsPartsGroup, skipTargetsInOtherGroups: true },
      { tab: "variants", groupName: settings.variantsGroupName, maxTargets: settings.maxTargetsVariantsGroup, skipTargetsInOtherGroups: false },
    ];
    const ownGroupNames = tabs.map((t) => t.groupName);
    const bySource = new Map<string, typeof pairs>();
    for (const p of pairs) bySource.set(p.source, [...(bySource.get(p.source) ?? []), p]);
    const operationsByTab = new Map<NameRuleTab, CrossSellApplyOperation[]>(tabs.map((t) => [t.tab, []]));
    for (const [source, list] of bySource) {
      const src = byNumber.get(source);
      if (!src) continue;
      const idOf = (pn: string) => byNumber.get(pn)?.id;
      for (const { tab } of tabs) {
        const targetProductIds = list.filter((p) => p.tab === tab).map((p) => idOf(p.target)).filter((id): id is string => Boolean(id));
        const removeTargetProductIds = list.filter((p) => p.tab !== tab).map((p) => idOf(p.target)).filter((id): id is string => Boolean(id));
        if (targetProductIds.length > 0 || removeTargetProductIds.length > 0) {
          operationsByTab.get(tab)!.push({ sourceProductId: src.id, sourceProductNumber: source, targetProductIds, removeTargetProductIds });
        }
      }
      if (stats.examples.length < EXAMPLES) {
        stats.examples.push({
          source,
          sourceName: src.name,
          targets: list.map((p) => ({ number: p.target, name: byNumber.get(p.target)?.name ?? "", kind: p.kind })),
        });
      }
    }
    stats.sources = bySource.size;

    const catalog = await deps.loadCatalog();
    const recorder = createCrossSellChangeRecorder(storage, catalog, {
      tenantId,
      userId: args.userId ?? null,
      runId: run.id,
      origin: "heuristic",
      now: () => now,
    });
    const total = tabs.reduce((n, t) => n + operationsByTab.get(t.tab)!.length, 0);
    let done = 0;
    // Reihenfolge der Tabs im Shop: "Das passt dazu", "Regal erweitern", "Einzelteile", "Auch erhältlich in"
    for (const { tab, groupName, maxTargets, skipTargetsInOtherGroups } of tabs) {
      const operations = operationsByTab.get(tab)!;
      for (let i = 0; i < operations.length; i += CHUNK) {
        const result = await applyCrossSellPlan(deps.client, operations.slice(i, i + CHUNK), {
          mode: "auto",
          groupName,
          maxTargets,
          replace: false,
          dryRun: args.dryRun,
          skipTargetsInOtherGroups,
          ownGroupNames,
          onChange: recorder,
        });
        stats.sourcesWritten += result.crossSellingsCreated + result.crossSellingsUpdated;
        if (args.dryRun) stats.dryRunFlagged += result.productsAdded;
        else stats.autoApplied += result.productsAdded;
        stats.moved += result.productsRemoved;
        stats.errors += result.errors.length;
        for (const s of result.sources) {
          stats.skippedInOtherGroups += s.skippedInOtherGroups.length;
          stats.skippedForCap += s.skippedForCap.length;
        }
        done += Math.min(CHUNK, operations.length - i);
        args.onProgress?.(done, total);
      }
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
