// Monatspruefung der Cross-Selling-Zuordnungen im Shop: passt noch alles?
// 1. Shop-Stand ins Gedaechtnis (wie "Shop-Zuordnungen einlesen")
// 2. jede Zuordnung pruefen: Ziel fehlt/inaktiv/unsichtbar, KI "passt nicht", Wirkung, veraltet
// 3. Entfernen nur VORSCHLAGEN (Pruefliste), nie selbst entfernen
// 4. Bericht speichern, In-App-Benachrichtigung + E-Mail
import type { CrossSellPairState, Order, ShopwareProductMirror, InsertNotification, Notification } from "@shared/schema";
import type { IStorage, CrossSellPairStateUpdateColumn } from "../storage";
import type { ShopwareClient } from "../shopware/shopware";
import { getCrossSellAutomationSettings, crossSellAutomationGloballyEnabled, type CrossSellAutomationSettings } from "./crossSellAutomationSettings";
import { syncShopAssignmentsIntoMemory } from "./crossSellImport";
import { buildOrderBasketStats, pairStatsFor } from "./crossSellScoring";
import { computeCrossSellEffect, prepareEffectOrders, EFFECT_MIN_SOURCE_ORDERS, type EffectResult } from "./crossSellEffect";
import { checkCrossSellFit, fitInputHash, LLM_FIT_MAX_TARGETS, type FitProduct } from "./crossSellLlmFit";
import { isTargetEligible } from "./crossSellCandidates";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellMonthlyReview" });
const DAY_MS = 24 * 60 * 60 * 1000;
const LLM_NO_FIT_PROPOSE_CONFIDENCE = 0.7;
const STALE_MIN_SOURCE_ORDERS = 30;
const REPORT_ROWS_PER_REASON = 50;

export type ReviewReason =
  | "target_missing"
  | "target_inactive"
  | "target_hidden"
  | "llm_no_fit"
  | "ineffective"
  | "source_inactive"
  | "stale"
  | "positive";

/** Gruende, die einen Entfernen-Vorschlag ausloesen (in dieser Rangfolge). */
export const REMOVAL_REASONS: ReviewReason[] = ["target_missing", "target_inactive", "target_hidden", "llm_no_fit", "ineffective"];

const berlinParts = (now: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
};

/** Monatsschluessel YYYY-MM in Europe/Berlin. */
export function berlinMonthKey(now: Date): string {
  const p = berlinParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/**
 * Faellig, sobald in Europe/Berlin Tag und Stunde der Einstellung erreicht sind. Ob der Monat
 * schon gelaufen ist, entscheidet die Lauf-Sperre (cross_sell_runs, ein Lauf je Monat);
 * ein verpasster Termin wird damit beim naechsten Takt nachgeholt.
 */
export function isMonthlyReviewDue(now: Date, settings: Pick<CrossSellAutomationSettings, "monthlyReviewEnabled" | "reviewDayOfMonth" | "reviewHourLocal">): boolean {
  if (!settings.monthlyReviewEnabled) return false;
  const p = berlinParts(now);
  if (p.day > settings.reviewDayOfMonth) return true;
  return p.day === settings.reviewDayOfMonth && p.hour >= settings.reviewHourLocal;
}

export type ReviewFinding = {
  pairId: string;
  source: string;
  sourceName: string | null;
  target: string;
  targetName: string | null;
  groups: string[];
  origin: string;
  detail?: string;
};

export type MonthlyReviewReport = {
  month: string;
  pairsChecked: number;
  proposals: number;
  counts: Partial<Record<ReviewReason, number>>;
  findings: Partial<Record<ReviewReason, ReviewFinding[]>>;
  shop: { productListGroups: number; productStreamGroups: number; pairsLive: number; pairsRemovedExternally: number };
  llm: { calls: number; checked: number; errors: number; skippedBudget: number; notConfigured: boolean };
  notified: { users: number; email: "sent" | "skipped" | "failed" | "none" };
};

type ReviewClient = {
  searchCrossSellingGroups: OmitThisParameter<ShopwareClient["searchCrossSellingGroups"]>;
};

export type MonthlyReviewDeps = {
  storage: IStorage;
  client: ReviewClient;
  loadOrders: () => Promise<Order[]>;
  getSetting: (key: string) => Promise<any>;
  sendEmail: (params: { to: string; subject: string; text: string; html?: string }) => Promise<unknown>;
  onNotificationCreated: (n: Notification) => void;
  appUrl?: string | null;
  now?: () => Date;
  checkFit?: typeof checkCrossSellFit;
};

type MirrorInfo = {
  active: boolean;
  name: string | null;
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
    active: row.active !== false && p.active !== false,
    name: row.name ?? p.name ?? null,
    categories: Array.isArray(p.categories) ? p.categories : [],
    properties: Array.isArray(p.properties) ? p.properties : [],
    visibleChannels: visible,
  };
}

/** Pruefergebnis fuer ein Paar im Shop (reine Funktion). */
export function classifyLivePair(input: {
  targetKnown: boolean;
  target?: MirrorInfo;
  source?: MirrorInfo;
  llm: { verdict: string | null; confidence: number | null } | null;
  effect: EffectResult | null;
  stale: boolean;
}): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (!input.targetKnown) reasons.push("target_missing");
  else if (input.target && !input.target.active) reasons.push("target_inactive");
  else if (input.target && !isTargetEligible(input.source ? { ...input.source, id: "", productNumber: "" } : undefined, { ...input.target, id: "", productNumber: "" })) reasons.push("target_hidden");
  if (input.llm?.verdict === "no_fit" && (input.llm.confidence ?? 0) >= LLM_NO_FIT_PROPOSE_CONFIDENCE) reasons.push("llm_no_fit");
  if (input.effect?.verdict === "ineffective") reasons.push("ineffective");
  if (input.effect?.verdict === "positive") reasons.push("positive");
  if (input.source && !input.source.active) reasons.push("source_inactive");
  if (input.stale) reasons.push("stale");
  return reasons;
}

const isLive = (s: CrossSellPairState) => Array.isArray(s.shopRefs) && s.shopRefs.length > 0;

export async function runCrossSellMonthlyReview(
  deps: MonthlyReviewDeps,
  args: { tenantId: string | null; userId?: string | null; trigger: "scheduled" | "manual" },
): Promise<{ runId: string | null; skipped?: string; report?: MonthlyReviewReport }> {
  const { storage } = deps;
  const tenantId = args.tenantId;
  const now = deps.now?.() ?? new Date();
  const settings = await getCrossSellAutomationSettings(storage, tenantId);
  if (!crossSellAutomationGloballyEnabled()) return { runId: null, skipped: "globally_disabled" };
  if (args.trigger === "scheduled" && !isMonthlyReviewDue(now, settings)) return { runId: null, skipped: "not_due" };

  const month = berlinMonthKey(now);
  const run = await storage.acquireCrossSellRun(
    {
      kind: "monthly_review",
      periodKey: args.trigger === "scheduled" ? month : `manual:${now.toISOString()}`,
      userId: args.userId ?? null,
      staleAfterMinutes: 120,
      maxAttempts: 3,
    },
    tenantId,
  );
  if (!run) return { runId: null, skipped: "already_ran" };

  const report: MonthlyReviewReport = {
    month,
    pairsChecked: 0,
    proposals: 0,
    counts: {},
    findings: {},
    shop: { productListGroups: 0, productStreamGroups: 0, pairsLive: 0, pairsRemovedExternally: 0 },
    llm: { calls: 0, checked: 0, errors: 0, skippedBudget: 0, notConfigured: false },
    notified: { users: 0, email: "none" },
  };

  try {
    // 1. Shop-Stand
    const { stats: shopStats, catalog } = await syncShopAssignmentsIntoMemory(storage, deps.client, { tenantId, now });
    report.shop = {
      productListGroups: shopStats.productListGroups,
      productStreamGroups: shopStats.productStreamGroups,
      pairsLive: shopStats.pairsLive,
      pairsRemovedExternally: shopStats.pairsRemovedExternally,
    };
    await storage.heartbeatCrossSellRun(run.id, { phase: "shop" }, tenantId);

    // 2. Paare im Shop und ihre Produkte
    const live = (await storage.getCrossSellPairStates({ statuses: ["applied", "removal_proposed"] }, tenantId)).filter(isLive);
    report.pairsChecked = live.length;
    const families = new Set<string>();
    for (const s of live) families.add(s.sourceProductNumber).add(s.targetProductNumber);
    const info = new Map<string, MirrorInfo>();
    for (const row of await storage.getShopwareProductMirrorsByNumbers(Array.from(families), tenantId)) {
      info.set(row.productNumber, mirrorInfo(row));
    }

    // Bestellungen: Wirkung (nur MO) und "veraltet" (alle, 12 Monate)
    const orders = await deps.loadOrders();
    const effectOrders = prepareEffectOrders(orders, catalog.canonicalNumber);
    const lastYear = buildOrderBasketStats(orders, catalog.canonicalNumber, new Date(now.getTime() - 365 * DAY_MS));

    // 3. KI-Fachpruefung fuer Paare ohne aktuelles Urteil (Budget Monatslauf + Monat)
    const fitProduct = (n: string): FitProduct => {
      const m = info.get(n);
      return { productNumber: n, name: m?.name ?? null, categories: m?.categories, properties: m?.properties };
    };
    const needsCheck = (s: CrossSellPairState) =>
      !s.llmVerdict ||
      !s.llmCheckedAt ||
      s.llmInputHash !== fitInputHash(fitProduct(s.sourceProductNumber), fitProduct(s.targetProductNumber)) ||
      now.getTime() - new Date(s.llmCheckedAt).getTime() > settings.llmRecheckDays * DAY_MS;
    let usedThisMonth = 0;
    for (const r of await storage.getCrossSellRuns({ limit: 200 }, tenantId)) {
      if (r.id === run.id || berlinMonthKey(new Date(r.startedAt)) !== month) continue;
      usedThisMonth += Number((r.stats as any)?.llmCalls) || 0;
    }
    let budget = Math.max(0, Math.min(settings.llmMaxCallsMonthlyRun, settings.llmMaxCallsPerMonth - usedThisMonth));
    const llmFresh = new Map<string, { verdict: string; relation: string; confidence: number; reason: string; model: string; hash: string }>();
    const bySource = new Map<string, CrossSellPairState[]>();
    for (const s of live) {
      if (!info.has(s.targetProductNumber) || !needsCheck(s)) continue;
      const list = bySource.get(s.sourceProductNumber) ?? [];
      list.push(s);
      bySource.set(s.sourceProductNumber, list);
    }
    const checkFit = deps.checkFit ?? checkCrossSellFit;
    for (const [source, list] of bySource) {
      for (let i = 0; i < list.length; i += LLM_FIT_MAX_TARGETS) {
        const chunk = list.slice(i, i + LLM_FIT_MAX_TARGETS);
        if (budget <= 0) {
          report.llm.skippedBudget += chunk.length;
          continue;
        }
        budget -= 1;
        report.llm.calls += 1;
        const outcome = await checkFit({ getSetting: deps.getSetting, source: fitProduct(source), targets: chunk.map((s) => fitProduct(s.targetProductNumber)) });
        if (!outcome.ok) {
          if (outcome.reason === "not_configured") {
            report.llm.calls -= 1;
            report.llm.notConfigured = true;
            budget = 0;
          } else report.llm.errors += 1;
          continue;
        }
        for (const s of chunk) {
          const r = outcome.results.get(s.targetProductNumber);
          if (!r) continue;
          report.llm.checked += 1;
          llmFresh.set(s.id, { ...r, model: outcome.model, hash: fitInputHash(fitProduct(s.sourceProductNumber), fitProduct(s.targetProductNumber)) });
        }
      }
      await storage.heartbeatCrossSellRun(run.id, { phase: "llm", llmCalls: report.llm.calls }, tenantId);
    }

    // 4. Pruefen und vorschlagen
    const rows: Parameters<IStorage["upsertCrossSellPairStates"]>[0] = [];
    const proposalRows: typeof rows = [];
    for (const s of live) {
      const fresh = llmFresh.get(s.id);
      const llm = fresh ? { verdict: fresh.verdict, confidence: fresh.confidence } : s.llmVerdict ? { verdict: s.llmVerdict, confidence: s.llmConfidence } : null;
      const appliedAt = s.appliedAt ? new Date(s.appliedAt) : null;
      const effect = appliedAt
        ? computeCrossSellEffect(effectOrders, s.sourceProductNumber, s.targetProductNumber, appliedAt, now, {
            minSourceOrders: s.origin === "shopware_manual" ? Math.ceil(EFFECT_MIN_SOURCE_ORDERS * 1.5) : EFFECT_MIN_SOURCE_ORDERS,
          })
        : null;
      const ly = pairStatsFor(lastYear, s.sourceProductNumber, s.targetProductNumber);
      const stale = ly.sourceOrders >= STALE_MIN_SOURCE_ORDERS && ly.pairOrders === 0;
      const reasons = classifyLivePair({
        targetKnown: catalog.byNumber.has(s.targetProductNumber),
        target: info.get(s.targetProductNumber),
        source: info.get(s.sourceProductNumber),
        llm,
        effect,
        stale,
      });
      for (const r of reasons) {
        report.counts[r] = (report.counts[r] ?? 0) + 1;
        const list = (report.findings[r] ??= []);
        if (list.length < REPORT_ROWS_PER_REASON) {
          list.push({
            pairId: s.id,
            source: s.sourceProductNumber,
            sourceName: info.get(s.sourceProductNumber)?.name ?? catalog.byNumber.get(s.sourceProductNumber)?.name ?? null,
            target: s.targetProductNumber,
            targetName: info.get(s.targetProductNumber)?.name ?? catalog.byNumber.get(s.targetProductNumber)?.name ?? null,
            groups: Array.from(new Set((s.shopRefs ?? []).map((g) => g.groupName))),
            origin: s.origin,
            detail:
              r === "llm_no_fit"
                ? (fresh?.reason ?? s.llmReason ?? undefined)
                : r === "ineffective" || r === "positive"
                  ? `${effect?.baseline.pairOrders}/${effect?.baseline.sourceOrders} → ${effect?.post.pairOrders}/${effect?.post.sourceOrders}`
                  : undefined,
          });
        }
      }
      const removalReason = REMOVAL_REASONS.find((r) => reasons.includes(r)) ?? null;
      const base = {
        sourceProductNumber: s.sourceProductNumber,
        targetProductNumber: s.targetProductNumber,
        status: s.status,
        origin: s.origin,
        effect: effect ? (effect as unknown as Record<string, unknown>) : null,
        llmVerdict: (fresh?.verdict ?? s.llmVerdict ?? null) as CrossSellPairState["llmVerdict"],
        llmRelation: fresh?.relation ?? s.llmRelation ?? null,
        llmConfidence: fresh?.confidence ?? s.llmConfidence ?? null,
        llmReason: fresh?.reason ?? s.llmReason ?? null,
        llmModel: fresh?.model ?? s.llmModel ?? null,
        llmInputHash: fresh?.hash ?? s.llmInputHash ?? null,
        llmCheckedAt: fresh ? now : s.llmCheckedAt ?? null,
        lastReviewedAt: now,
        lastRunId: run.id,
      };
      if (removalReason && !s.protected && s.status === "applied") {
        report.proposals += 1;
        proposalRows.push({ ...base, status: "removal_proposed", pendingAction: "remove", proposalReason: removalReason });
      } else if (!removalReason && s.status === "removal_proposed") {
        // Grund entfallen (z. B. Ziel wieder aktiv): Vorschlag zuruecknehmen
        proposalRows.push({ ...base, status: "applied", pendingAction: null, proposalReason: null });
      } else {
        rows.push(base);
      }
    }
    const cols: CrossSellPairStateUpdateColumn[] = ["effect", "llmVerdict", "llmRelation", "llmConfidence", "llmReason", "llmModel", "llmInputHash", "llmCheckedAt", "lastReviewedAt", "lastRunId"];
    await storage.upsertCrossSellPairStates(rows, cols, tenantId);
    await storage.upsertCrossSellPairStates(proposalRows, [...cols, "status", "pendingAction", "proposalReason"], tenantId);

    // 5. Benachrichtigen
    await notifyMonthlyReview(deps, settings, report, tenantId);

    await storage.finishCrossSellRun(
      run.id,
      { status: "completed", stats: { llmCalls: report.llm.calls, proposals: report.proposals, pairsChecked: report.pairsChecked }, report: report as unknown as Record<string, unknown>, notifiedAt: now },
      tenantId,
    );
    moduleLog.info({ tenantId, month, pairsChecked: report.pairsChecked, proposals: report.proposals, counts: report.counts }, "Cross-Selling-Monatspruefung abgeschlossen");
    return { runId: run.id, report };
  } catch (err: any) {
    await storage.finishCrossSellRun(run.id, { status: "failed", stats: { llmCalls: report.llm.calls }, error: err?.message || String(err) }, tenantId);
    throw err;
  }
}

const REASON_LABEL_DE: Record<ReviewReason, string> = {
  target_missing: "Ziel nicht mehr im Katalog",
  target_inactive: "Ziel inaktiv",
  target_hidden: "Ziel im Verkaufskanal nicht sichtbar",
  llm_no_fit: "KI: passt fachlich nicht",
  ineffective: "ohne messbare Wirkung",
  source_inactive: "Ausgangsartikel inaktiv",
  stale: "seit 12 Monaten nicht zusammen gekauft",
  positive: "wirkt (häufiger zusammen gekauft)",
};

/** Text der Benachrichtigung bzw. E-Mail (deutsch, wie die uebrigen Systemmails). */
export function buildMonthlyReviewMessage(report: MonthlyReviewReport, link: string | null): { title: string; message: string; text: string; html: string } {
  const title = `Cross-Selling-Monatsprüfung ${report.month}`;
  const message =
    report.proposals > 0
      ? `${report.proposals} Zuordnungen zum Entfernen vorgeschlagen (${report.pairsChecked} geprüft). Bitte in der Prüfliste entscheiden.`
      : `${report.pairsChecked} Zuordnungen geprüft, nichts zu entfernen.`;
  const lines = [
    title,
    "",
    message,
    "",
    `Shop: ${report.shop.pairsLive} Paare in ${report.shop.productListGroups} Listen; ${report.shop.pairsRemovedExternally} von Hand entfernt.`,
    `KI-Prüfung: ${report.llm.checked} Paare (${report.llm.calls} Anfragen)${report.llm.skippedBudget ? `, ${report.llm.skippedBudget} wegen Budget offen` : ""}.`,
    "",
    "Befunde:",
    ...(Object.entries(report.counts) as Array<[ReviewReason, number]>).map(([r, n]) => `- ${REASON_LABEL_DE[r]}: ${n}`),
  ];
  for (const r of REMOVAL_REASONS) {
    const list = report.findings[r];
    if (!list?.length) continue;
    lines.push("", `${REASON_LABEL_DE[r]} (Auswahl):`);
    for (const f of list.slice(0, 10)) lines.push(`- ${f.source} ${f.sourceName ?? ""} → ${f.target} ${f.targetName ?? ""}`.trim());
  }
  if (link) lines.push("", `Prüfliste: ${link}`);
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:sans-serif;font-size:14px">${lines
    .map((l) => (l === "" ? "<br>" : `<div>${esc(l)}</div>`))
    .join("")}${link ? `<p><a href="${esc(link)}">Prüfliste öffnen</a></p>` : ""}</div>`;
  return { title, message, text: lines.join("\n"), html };
}

async function notifyMonthlyReview(
  deps: MonthlyReviewDeps,
  settings: CrossSellAutomationSettings,
  report: MonthlyReviewReport,
  tenantId: string | null,
): Promise<void> {
  const link = deps.appUrl ? `${deps.appUrl.replace(/\/$/, "")}/cross-selling-rules?tab=review` : null;
  const msg = buildMonthlyReviewMessage(report, link);
  try {
    const recipients = await deps.storage.getUsersWithPermissionInTenant("manageCrossSellingRules", tenantId);
    for (const u of recipients) {
      const n: InsertNotification = { userId: u.id, type: "cross_selling_review", title: msg.title, message: msg.message, ticketId: null, ticketNumber: null, read: 0 };
      deps.onNotificationCreated(await deps.storage.createNotification(n, tenantId));
    }
    report.notified.users = recipients.length;
  } catch (err) {
    moduleLog.warn({ err, tenantId }, "Benachrichtigungen der Monatspruefung nicht erstellt");
  }
  const to = settings.reportEmail.trim();
  if (!to) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    report.notified.email = "skipped";
    return;
  }
  try {
    await deps.sendEmail({ to, subject: msg.title, text: msg.text, html: msg.html });
    report.notified.email = "sent";
  } catch (err) {
    report.notified.email = "failed";
    moduleLog.warn({ err, tenantId }, "E-Mail der Monatspruefung nicht gesendet");
  }
}
