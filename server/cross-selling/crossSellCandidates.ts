// Taeglicher Kandidatenlauf der Cross-Selling-Teilautomatik:
// Kaufstatistik (Spiegel) -> Filter (Gedaechtnis) -> KI-Fachpruefung (Budget) -> Bewertung ->
// je nach Modus Pruefliste, Testlauf-Markierung oder automatisches Setzen sicherer Ergaenzungen.
// Entfernt wird hier nie etwas. Speichersparsam: Produktdetails nur fuer bewertete Familien.
import type { CrossSellPairOrigin, CrossSellPairState, Order, ShopwareProductMirror } from "@shared/schema";
import type { IStorage, CrossSellPairStateUpdateColumn } from "../storage";
import type { ShopwareClient } from "../shopware/shopware";
import { getCrossSellAutomationSettings, crossSellAutomationGloballyEnabled, type CrossSellAutomationSettings } from "./crossSellAutomationSettings";
import { loadCrossSellCatalog, type CrossSellCatalog } from "./crossSellCatalog";
import { buildCrossSellPairFilter } from "./crossSellMemory";
import { createCrossSellChangeRecorder } from "./crossSellMemory";
import {
  buildOrderBasketStats,
  candidatePairsFromBasket,
  evaluateAutoGates,
  pairStatsFor,
  scorePair,
  selectWithinCaps,
  statScore,
  patternStrength,
  type GateFailure,
  type LlmVerdict,
  type PairStats,
} from "./crossSellScoring";
import { checkCrossSellFit, fitInputHash, LLM_FIT_MAX_TARGETS, type FitProduct } from "./crossSellLlmFit";
import { applyCrossSellPlan, type CrossSellApplyOperation } from "./crossSellApply";
import { getRulePairKey } from "./crossSellService";
import { productSignature, buildCrossSellPatterns, applyCrossSellPatterns, type ProductSignature } from "./crossSellPatterns";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellCandidates" });
const DAY_MS = 24 * 60 * 60 * 1000;
const STATS_WINDOW_DAYS = 730;
const MIN_QUEUE_PAIR_ORDERS = 2;
const MIN_QUEUE_POINT_LIFT = 1.2;
const LLM_NO_FIT_HIDE_CONFIDENCE = 0.7;

/** Stunde (00-23) in Europe/Berlin, Schluessel fuer die stuendlichen Laeufe der Erstbefuellung. */
export function berlinHour(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(now);
}

/** Kalendertag in Europe/Berlin (YYYY-MM-DD), Schluessel fuer den taeglichen Lauf. */
export function berlinDateKey(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(now);
}

export type CandidateRunStats = {
  mode: CrossSellAutomationSettings["mode"];
  ordersInWindow: number;
  candidatePairs: number;
  evaluated: number;
  queued: number;
  autoEligible: number;
  autoApplied: number;
  dryRunFlagged: number;
  llmCalls: number;
  llmErrors: number;
  llmChecked: number;
  llmSkippedBudget: number;
  llmNotConfigured: boolean;
  applyErrors: number;
  gateFailures: Partial<Record<GateFailure, number>>;
  /** Kandidaten aus Mustern (aehnliche Produkte) */
  patternCandidates: number;
  /** nach dem Lauf noch ohne KI-Pruefung (Erstbefuellung: Fortschritt) */
  remainingUnchecked: number;
};

type CandidateClient = Pick<
  ShopwareClient,
  "fetchProductCrossSelling" | "fetchCrossSellingAssignments" | "createProductCrossSelling" | "syncCrossSellingAssignments"
>;

export type CandidateRunDeps = {
  storage: IStorage;
  client: { [K in keyof CandidateClient]: OmitThisParameter<CandidateClient[K]> };
  loadOrders: () => Promise<Order[]>;
  getSetting: (key: string) => Promise<any>;
  now?: () => Date;
  /** Fuer Tests austauschbar. */
  checkFit?: typeof checkCrossSellFit;
};

type MirrorInfo = {
  id: string;
  productNumber: string;
  name: string | null;
  active: boolean;
  categories: string[];
  properties: Array<{ groupName: string; optionName: string }>;
  visibleChannels: Set<string>;
};

function mirrorInfo(row: ShopwareProductMirror): MirrorInfo {
  const p = (row.payload ?? {}) as any;
  const visible = new Set<string>();
  for (const v of Array.isArray(p.salesChannelVisibilities) ? p.salesChannelVisibilities : []) {
    if (v && typeof v.salesChannelId === "string" && Number(v.visibility) >= 10) visible.add(v.salesChannelId);
  }
  return {
    id: row.shopwareId,
    productNumber: row.productNumber,
    name: row.name ?? p.name ?? null,
    active: row.active !== false && p.active !== false,
    categories: Array.isArray(p.categories) ? p.categories.filter((c: unknown) => typeof c === "string") : [],
    properties: Array.isArray(p.properties) ? p.properties : [],
    visibleChannels: visible,
  };
}

/** Ziel darf angeboten werden: aktiv und in mindestens einem Kanal der Quelle sichtbar. */
export function isTargetEligible(source: MirrorInfo | undefined, target: MirrorInfo | undefined): boolean {
  if (!target || !target.active) return false;
  if (!source || source.visibleChannels.size === 0) return true;
  for (const ch of source.visibleChannels) if (target.visibleChannels.has(ch)) return true;
  return false;
}

type Candidate = {
  source: string;
  target: string;
  origin: CrossSellPairOrigin;
  stats: PairStats;
  statScore: number;
  /** Sortierwert vor der KI-Pruefung (Kaufstatistik bzw. Musterstaerke) */
  preScore: number;
  pattern?: { sources: number; orders: number; key: string };
  existing?: CrossSellPairState;
};

/** Hoechstens so viele Kandidaten je Ausgangsartikel (vor der KI-Pruefung). */
const MAX_CANDIDATES_PER_SOURCE = 10;

const pk = (s: string, t: string) => `${s}\u0000${t}`;

/** Exakte Handregeln (Artikelnummer -> Artikelnummer) als zusaetzliche Kandidaten. */
function manualRulePairs(rules: Awaited<ReturnType<IStorage["getAllCrossSellingRules"]>>, catalog: CrossSellCatalog) {
  const out: Array<{ source: string; target: string }> = [];
  for (const rule of rules) {
    if (rule.active !== 1) continue;
    const key = getRulePairKey(rule);
    if (!key) continue;
    const [s, t] = key.split("::");
    out.push({ source: catalog.canonicalNumber(s), target: catalog.canonicalNumber(t) });
  }
  return out;
}

export async function runCrossSellCandidates(
  deps: CandidateRunDeps,
  args: {
    tenantId: string | null;
    userId?: string | null;
    trigger: "scheduled" | "manual";
    /** "backfill": Erstbefuellung ueber den ganzen Katalog mit eigenem KI-Budget */
    kind?: "daily" | "backfill";
    /** Erstbefuellung: bisher verbrauchte KI-Anfragen */
    backfillLlmUsed?: number;
  },
): Promise<{ runId: string | null; skipped?: string; stats?: CandidateRunStats }> {
  const backfill = args.kind === "backfill";
  const { storage, tenantId } = { storage: deps.storage, tenantId: args.tenantId };
  const now = deps.now?.() ?? new Date();
  const settings = await getCrossSellAutomationSettings(storage, tenantId);
  if (!crossSellAutomationGloballyEnabled()) return { runId: null, skipped: "globally_disabled" };
  if (args.trigger === "scheduled" && settings.mode === "off") return { runId: null, skipped: "mode_off" };
  // Manueller Lauf bei ausgeschalteter Automatik: nur Pruefliste, nichts setzen.
  const mode = settings.mode === "off" ? "review" : settings.mode;

  const run = await storage.acquireCrossSellRun(
    {
      kind: backfill ? "backfill" : "candidates",
      periodKey:
        args.trigger === "scheduled"
          ? backfill
            ? `${berlinDateKey(now)}T${berlinHour(now)}`
            : berlinDateKey(now)
          : `manual:${now.toISOString()}`,
      userId: args.userId ?? null,
    },
    tenantId,
  );
  if (!run) return { runId: null, skipped: "already_ran" };

  const stats: CandidateRunStats = {
    mode,
    ordersInWindow: 0,
    candidatePairs: 0,
    evaluated: 0,
    queued: 0,
    autoEligible: 0,
    autoApplied: 0,
    dryRunFlagged: 0,
    llmCalls: 0,
    llmErrors: 0,
    llmChecked: 0,
    llmSkippedBudget: 0,
    llmNotConfigured: false,
    applyErrors: 0,
    gateFailures: {},
    patternCandidates: 0,
    remainingUnchecked: 0,
  };

  try {
    const catalog = await loadCrossSellCatalog(storage, tenantId, { fresh: true });
    const basket = buildOrderBasketStats(await deps.loadOrders(), catalog.canonicalNumber, new Date(now.getTime() - STATS_WINDOW_DAYS * DAY_MS));
    stats.ordersInWindow = basket.totalOrders;

    const states = await storage.getCrossSellPairStates({}, tenantId);
    const stateByKey = new Map(states.map((s) => [pk(s.sourceProductNumber, s.targetProductNumber), s]));
    const filter = buildCrossSellPairFilter(states, catalog, now);

    // Kandidaten: haeufige Paare aus Bestellungen + exakte Handregeln
    const raw = new Map<string, { source: string; target: string; origin: CrossSellPairOrigin }>();
    for (const p of candidatePairsFromBasket(basket, MIN_QUEUE_PAIR_ORDERS)) raw.set(pk(p.source, p.target), { ...p, origin: "ai" });
    for (const p of manualRulePairs(await storage.getAllCrossSellingRules(tenantId), catalog)) {
      raw.set(pk(p.source, p.target), { ...p, origin: "manual_rule" });
    }

    // Produkte aus dem Spiegel (einmal laden): Signaturen fuer Muster, Details fuer Pruefungen
    const mirrorRows = (await storage.getShopwareProductMirrors({ includeInactive: true }, tenantId)).rows;
    const info = new Map<string, MirrorInfo>();
    const signatures = new Map<string, ProductSignature>();
    for (const row of mirrorRows) {
      info.set(row.productNumber, mirrorInfo(row));
      if (!(row.payload as { parentId?: string | null } | null)?.parentId) signatures.set(row.productNumber, productSignature(row));
    }
    // Muster: was bei aehnlichen Produkten zusammen gekauft wird (fuer Produkte ohne eigene Bestellungen)
    const patternInfo = new Map<string, { sources: number; orders: number; key: string }>();
    for (const c of applyCrossSellPatterns(buildCrossSellPatterns(basket, signatures), signatures, { minSources: settings.patternMinSources })) {
      const key = pk(c.source, c.target);
      if (raw.has(key)) continue;
      raw.set(key, { source: c.source, target: c.target, origin: "pattern" });
      patternInfo.set(key, { sources: c.patternSources, orders: c.patternOrders, key: c.patternKey });
    }
    stats.patternCandidates = patternInfo.size;
    stats.candidatePairs = raw.size;

    const candidates: Candidate[] = [];
    for (const [key, c] of raw) {
      if (c.source === c.target || filter.isBlocked(c.source, c.target)) continue;
      const existing = stateByKey.get(key);
      // Nur neue oder bereits vorgeschlagene Paare; im Shop, abgelehnt, entfernt usw. nicht anfassen.
      if (existing && existing.status !== "suggested") continue;
      const st = pairStatsFor(basket, c.source, c.target);
      if (c.origin === "ai") {
        const pointConf = st.sourceOrders > 0 ? st.pairOrders / st.sourceOrders : 0;
        const baseRate = st.totalOrders > 0 ? st.targetOrders / st.totalOrders : 0;
        if (baseRate <= 0 || pointConf / baseRate < MIN_QUEUE_POINT_LIFT) continue;
      }
      const pattern = patternInfo.get(key);
      const ss = statScore(st);
      candidates.push({
        ...c,
        stats: st,
        statScore: ss,
        preScore: pattern ? 0.6 * patternStrength(pattern.sources) : ss,
        pattern,
        existing,
      });
    }
    // Je Ausgangsartikel die staerksten Kandidaten; taeglich nur die besten insgesamt,
    // bei der Erstbefuellung alle (KI-Budget begrenzt die Menge je Lauf)
    candidates.sort((a, b) => b.preScore - a.preScore);
    const perSourceCount = new Map<string, number>();
    const capped = candidates.filter((c) => {
      const n = perSourceCount.get(c.source) ?? 0;
      if (n >= MAX_CANDIDATES_PER_SOURCE) return false;
      perSourceCount.set(c.source, n + 1);
      return true;
    });
    const evaluated = backfill ? capped : capped.slice(0, Math.max(50, Math.min(600, settings.maxNewQueueItemsPerRun * 3)));
    stats.evaluated = evaluated.length;

    // Reaktionen (90 Tage) und Freigabequote je Ziel
    const signals = new Map<string, { impressions: number; clicks: number; adds: number }>();
    try {
      for (const e of await storage.getCrossSellEventStats(tenantId, new Date(now.getTime() - 90 * DAY_MS))) {
        const key = pk(catalog.canonicalNumber(e.sourceProductNumber), catalog.canonicalNumber(e.targetProductNumber));
        const prev = signals.get(key) ?? { impressions: 0, clicks: 0, adds: 0 };
        signals.set(key, { impressions: prev.impressions + e.impressions, clicks: prev.clicks + e.clicks, adds: prev.adds + e.adds });
      }
    } catch (err) {
      moduleLog.warn({ err }, "Reaktionen nicht geladen");
    }
    const feedback = new Map<string, { approved: number; rejected: number }>();
    for (const s of states) {
      if (s.decisionSource !== "user") continue;
      const f = feedback.get(s.targetProductNumber) ?? { approved: 0, rejected: 0 };
      if (s.status === "rejected") f.rejected += 1;
      else if (s.status === "applied" || s.status === "approved") f.approved += 1;
      feedback.set(s.targetProductNumber, f);
    }

    // KI-Fachpruefung im Budget (je Lauf und je Kalendermonat)
    const monthPrefix = berlinDateKey(now).slice(0, 7);
    let usedThisMonth = 0;
    for (const r of await storage.getCrossSellRuns({ limit: 200 }, tenantId)) {
      if (r.id === run.id) continue;
      if (berlinDateKey(new Date(r.startedAt)).slice(0, 7) !== monthPrefix) continue;
      usedThisMonth += Number((r.stats as any)?.llmCalls) || 0;
    }
    let llmBudget = backfill
      ? Math.max(0, Math.min(settings.backfillLlmPerRun, settings.backfillLlmBudget - (args.backfillLlmUsed ?? 0)))
      : Math.max(0, Math.min(settings.llmMaxCallsPerRun, settings.llmMaxCallsPerMonth - usedThisMonth));
    const llmByKey = new Map<string, { verdict: LlmVerdict; reason: string; model: string; hash: string; checkedAt: Date }>();
    const fitProduct = (n: string): FitProduct => {
      const m = info.get(n);
      return { productNumber: n, name: m?.name ?? null, categories: m?.categories, properties: m?.properties };
    };
    const needsCheck = (c: Candidate): boolean => {
      const e = c.existing;
      if (!e?.llmVerdict || !e.llmCheckedAt) return true;
      if (e.llmInputHash !== fitInputHash(fitProduct(c.source), fitProduct(c.target))) return true;
      return now.getTime() - new Date(e.llmCheckedAt).getTime() > settings.llmRecheckDays * DAY_MS;
    };
    const bySource = new Map<string, Candidate[]>();
    for (const c of evaluated) {
      if (!needsCheck(c)) continue;
      const list = bySource.get(c.source) ?? [];
      list.push(c);
      bySource.set(c.source, list);
    }
    const rejectedExamples = states
      .filter((s) => s.status === "rejected" && s.decisionSource === "user")
      .sort((a, b) => new Date(b.decidedAt ?? 0).getTime() - new Date(a.decidedAt ?? 0).getTime())
      .slice(0, 10)
      .map((s) => ({
        source: `${s.sourceProductNumber} ${info.get(s.sourceProductNumber)?.name ?? ""}`.trim(),
        target: `${s.targetProductNumber} ${info.get(s.targetProductNumber)?.name ?? ""}`.trim(),
        reason: [s.decisionReasonCode, s.decisionNote].filter(Boolean).join(": "),
      }));
    const checkFit = deps.checkFit ?? checkCrossSellFit;
    // Quellen mit den staerksten Kandidaten zuerst
    const sourceOrder = Array.from(bySource.entries()).sort(
      (a, b) => Math.max(...b[1].map((c) => c.preScore)) - Math.max(...a[1].map((c) => c.preScore)),
    );
    for (const [source, list] of sourceOrder) {
      for (let i = 0; i < list.length; i += LLM_FIT_MAX_TARGETS) {
        const chunk = list.slice(i, i + LLM_FIT_MAX_TARGETS);
        if (llmBudget <= 0) {
          stats.llmSkippedBudget += chunk.length;
          continue;
        }
        llmBudget -= 1;
        stats.llmCalls += 1;
        if (stats.llmCalls % 10 === 0) await storage.heartbeatCrossSellRun(run.id, { llmCalls: stats.llmCalls }, tenantId);
        const outcome = await checkFit({
          getSetting: deps.getSetting,
          source: fitProduct(source),
          targets: chunk.map((c) => fitProduct(c.target)),
          rejectedExamples,
        });
        if (!outcome.ok) {
          if (outcome.reason === "not_configured") {
            stats.llmCalls -= 1;
            stats.llmNotConfigured = true;
            llmBudget = 0;
          } else {
            stats.llmErrors += 1;
          }
          continue;
        }
        for (const c of chunk) {
          const r = outcome.results.get(c.target);
          if (!r) continue;
          stats.llmChecked += 1;
          llmByKey.set(pk(c.source, c.target), {
            verdict: { verdict: r.verdict, relation: r.relation, confidence: r.confidence },
            reason: r.reason,
            model: outcome.model,
            hash: fitInputHash(fitProduct(c.source), fitProduct(c.target)),
            checkedAt: now,
          });
        }
      }
    }

    // Bewerten und Freigabe-Bedingungen pruefen
    type Scored = Candidate & {
      score: number;
      components: Record<string, number>;
      llm: { verdict: LlmVerdict; reason: string; model: string; hash: string; checkedAt: Date } | null;
      fails: GateFailure[];
      queue: boolean;
    };
    const scored: Scored[] = [];
    for (const c of evaluated) {
      const key = pk(c.source, c.target);
      const fresh = llmByKey.get(key);
      const e = c.existing;
      const llm =
        fresh ??
        (e?.llmVerdict && e.llmCheckedAt
          ? {
              verdict: { verdict: e.llmVerdict, relation: e.llmRelation ?? null, confidence: e.llmConfidence ?? 0 },
              reason: e.llmReason ?? "",
              model: e.llmModel ?? "",
              hash: e.llmInputHash ?? "",
              checkedAt: new Date(e.llmCheckedAt),
            }
          : null);
      const llmCurrent = !!llm && !needsCheckAfter(llm, c, fresh !== undefined);
      const signal = signals.get(key) ?? null;
      const { score, components } = scorePair({
        stats: c.stats,
        statOverride: c.pattern ? patternStrength(c.pattern.sources) : undefined,
        llm: llm?.verdict ?? null,
        signal,
        feedback: feedback.get(c.target) ?? null,
      });
      const fails = evaluateAutoGates(
        {
          stats: c.stats,
          llm: llm ? { ...llm.verdict, current: llmCurrent } : null,
          signal,
          targetEligible: isTargetEligible(info.get(c.source), info.get(c.target)),
          blocked: false,
          alreadyInShop: false,
          sameFamily: c.source === c.target,
          heuristicOnly: c.origin === "manual_rule" && c.stats.pairOrders === 0,
          pattern: c.pattern ? { sources: c.pattern.sources } : null,
        },
        settings,
      );
      for (const f of fails) stats.gateFailures[f] = (stats.gateFailures[f] ?? 0) + 1;
      const hiddenByLlm = llm?.verdict.verdict === "no_fit" && llm.verdict.confidence >= LLM_NO_FIT_HIDE_CONFIDENCE;
      // Muster-Kandidaten und Erstbefuellung: nur KI-geprueft in die Pruefliste (sonst zu viele)
      const needsLlmForQueue = backfill || !!c.pattern;
      const queue =
        !hiddenByLlm &&
        (!needsLlmForQueue || (!!llm && llm.verdict.verdict !== "no_fit")) &&
        score >= settings.queueMinScore &&
        isTargetEligible(info.get(c.source), info.get(c.target));
      scored.push({ ...c, score, components: components as Record<string, number>, llm, fails, queue });
    }
    function needsCheckAfter(llm: { hash: string; checkedAt: Date }, c: Candidate, isFresh: boolean): boolean {
      if (isFresh) return false;
      if (llm.hash !== fitInputHash(fitProduct(c.source), fitProduct(c.target))) return true;
      return now.getTime() - llm.checkedAt.getTime() > settings.llmRecheckDays * DAY_MS;
    }

    const eligible = scored.filter((s) => s.fails.length === 0);
    stats.autoEligible = eligible.length;
    const selected =
      mode === "review"
        ? []
        : selectWithinCaps(eligible, {
            perRun: backfill ? settings.backfillMaxAutoPerRun : settings.maxAutoApplyPerRun,
            perSource: backfill ? settings.backfillMaxAutoPerSource : settings.maxAutoApplyPerSource,
          });
    const selectedKeys = new Set(selected.map((s) => pk(s.source, s.target)));

    // Automatisch setzen (auto) bzw. nur durchspielen (auto_dry_run)
    const appliedKeys = new Set<string>();
    if (selected.length > 0) {
      const opsBySource = new Map<string, CrossSellApplyOperation>();
      for (const s of selected) {
        const sourceId = catalog.byNumber.get(s.source)?.id;
        const targetId = catalog.byNumber.get(s.target)?.id;
        if (!sourceId || !targetId) continue;
        const op = opsBySource.get(s.source) ?? { sourceProductId: sourceId, sourceProductNumber: s.source, targetProductIds: [] };
        op.targetProductIds.push(targetId);
        opsBySource.set(s.source, op);
      }
      const dryRun = mode !== "auto";
      const result = await applyCrossSellPlan(deps.client, Array.from(opsBySource.values()), {
        mode: "auto",
        groupName: settings.managedGroupName,
        maxTargets: settings.maxTargetsPerManagedGroup,
        replace: false,
        dryRun,
        onChange: createCrossSellChangeRecorder(storage, catalog, { tenantId, userId: null, runId: run.id, origin: "ai", now: () => now }),
      });
      stats.applyErrors = result.errors.length;
      for (const src of result.sources) {
        const sourceFamily = catalog.canonicalNumberForId(src.sourceProductId);
        for (const tid of src.added) {
          const t = catalog.canonicalNumberForId(tid);
          if (sourceFamily && t) appliedKeys.add(pk(sourceFamily, t));
        }
      }
      if (dryRun) stats.dryRunFlagged = appliedKeys.size;
      else stats.autoApplied = appliedKeys.size;
    }

    // Gedaechtnis nachfuehren: Pruefliste, KI-Urteile, Kennzahlen
    const queueLimit = backfill ? settings.backfillMaxQueuePerRun : settings.maxNewQueueItemsPerRun;
    let newQueued = 0;
    const rows: Parameters<IStorage["upsertCrossSellPairStates"]>[0] = [];
    for (const s of scored.sort((a, b) => b.score - a.score)) {
      const key = pk(s.source, s.target);
      if (mode === "auto" && appliedKeys.has(key)) continue; // vom Protokoll-Haken als "im Shop" gefuehrt
      const alreadyQueued = s.existing?.pendingAction === "add";
      let pending: "add" | null = null;
      if (s.queue && (alreadyQueued || newQueued < queueLimit)) {
        pending = "add";
        if (!alreadyQueued) newQueued += 1;
      }
      if (!pending && !s.existing && !llmByKey.has(key)) continue; // nichts Neues zu merken
      if (pending) stats.queued += 1;
      rows.push({
        sourceProductNumber: s.source,
        targetProductNumber: s.target,
        sourceProductId: catalog.byNumber.get(s.source)?.id ?? null,
        targetProductId: catalog.byNumber.get(s.target)?.id ?? null,
        status: "suggested",
        origin: s.origin,
        pendingAction: pending,
        proposalReason: pending ? (s.origin === "manual_rule" ? "manual_rule" : "stats") : null,
        autoEligible: s.fails.length === 0 && selectedKeys.has(key),
        score: s.score,
        scoreComponents: Object.fromEntries(Object.entries(s.components).filter(([, v]) => typeof v === "number")),
        stats: {
          ...s.stats,
          gateFailures: s.fails,
          windowDays: STATS_WINDOW_DAYS,
          ...(s.pattern ? { patternSources: s.pattern.sources, patternOrders: s.pattern.orders, patternKey: s.pattern.key } : {}),
        },
        llmVerdict: s.llm?.verdict.verdict ?? null,
        llmRelation: s.llm?.verdict.relation ?? null,
        llmConfidence: s.llm?.verdict.confidence ?? null,
        llmReason: s.llm?.reason ?? null,
        llmModel: s.llm?.model ?? null,
        llmInputHash: s.llm?.hash ?? null,
        llmCheckedAt: s.llm?.checkedAt ?? null,
        lastReviewedAt: now,
        lastRunId: run.id,
      });
    }
    const cols: CrossSellPairStateUpdateColumn[] = [
      "sourceProductId", "targetProductId", "pendingAction", "proposalReason", "autoEligible", "score", "scoreComponents", "stats",
      "llmVerdict", "llmRelation", "llmConfidence", "llmReason", "llmModel", "llmInputHash", "llmCheckedAt", "lastReviewedAt", "lastRunId",
    ];
    await storage.upsertCrossSellPairStates(rows, cols, tenantId);

    // Ausgangswert fuer die spaetere Wirkungsmessung bei automatisch gesetzten Paaren
    if (mode === "auto" && appliedKeys.size > 0) {
      const baselineRows = scored
        .filter((s) => appliedKeys.has(pk(s.source, s.target)))
        .map((s) => ({
          sourceProductNumber: s.source,
          targetProductNumber: s.target,
          status: "applied" as const,
          origin: s.origin,
          baseline: { ...s.stats, at: now.toISOString() },
          score: s.score,
          stats: { ...s.stats, windowDays: STATS_WINDOW_DAYS },
          llmVerdict: s.llm?.verdict.verdict ?? null,
          llmRelation: s.llm?.verdict.relation ?? null,
          llmConfidence: s.llm?.verdict.confidence ?? null,
          llmReason: s.llm?.reason ?? null,
          llmInputHash: s.llm?.hash ?? null,
          llmCheckedAt: s.llm?.checkedAt ?? null,
          lastRunId: run.id,
        }));
      await storage.upsertCrossSellPairStates(
        baselineRows,
        ["baseline", "score", "stats", "llmVerdict", "llmRelation", "llmConfidence", "llmReason", "llmInputHash", "llmCheckedAt", "lastRunId"],
        tenantId,
      );
    }

    stats.remainingUnchecked = evaluated.filter((c) => !llmByKey.has(pk(c.source, c.target)) && needsCheck(c)).length;
    await storage.finishCrossSellRun(run.id, { status: "completed", stats: stats as unknown as Record<string, unknown> }, tenantId);
    moduleLog.info({ tenantId, ...stats, gateFailures: undefined }, "Cross-Selling-Kandidatenlauf abgeschlossen");
    return { runId: run.id, stats };
  } catch (err: any) {
    await storage.finishCrossSellRun(run.id, { status: "failed", stats: stats as unknown as Record<string, unknown>, error: err?.message || String(err) }, tenantId);
    throw err;
  }
}
