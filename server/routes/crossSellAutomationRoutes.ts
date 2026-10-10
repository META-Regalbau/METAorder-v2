// Cross-Selling-Teilautomatik: Pruefliste (freigeben, ablehnen), Kandidatenlauf von Hand,
// Rueckgaengig je Aenderung oder je Lauf.
import type { Express } from "express";
import { z } from "zod";
import { requireAuth, requireManageCrossSellingRules } from "../auth/auth";
import { storage } from "../storage";
import { ShopwareClient } from "../shopware/shopware";
import { getCrossSellAutomationSettings } from "../cross-selling/crossSellAutomationSettings";
import { loadCrossSellCatalog } from "../cross-selling/crossSellCatalog";
import { approveCrossSellPairs, approveCrossSellRemovals, keepCrossSellPairs, rejectQueuedCrossSellPairs, undoCrossSellChanges } from "../cross-selling/crossSellReview";
import { startCrossSellJob } from "../cross-selling/crossSellJobs";
import { runCandidatesForTenant, runMonthlyReviewForTenant, runBackfillForTenant } from "../cross-selling/crossSellScheduler";
import { getBackfillState, startBackfill, stopBackfill } from "../cross-selling/crossSellBackfill";
import type { CrossSellPairState } from "@shared/schema";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "routes/crossSellAutomationRoutes" });

const reasonCodeSchema = z.enum(["incompatible", "other_system", "alternative", "not_relevant", "other"]);

function reviewClient(client: ShopwareClient) {
  return {
    fetchProductCrossSelling: client.fetchProductCrossSelling.bind(client),
    fetchCrossSellingAssignments: client.fetchCrossSellingAssignments.bind(client),
    createProductCrossSelling: client.createProductCrossSelling.bind(client),
    syncCrossSellingAssignments: client.syncCrossSellingAssignments.bind(client),
  };
}

async function loadPairs(ids: string[], tenantId: string | null): Promise<CrossSellPairState[]> {
  const out: CrossSellPairState[] = [];
  for (const id of ids) {
    const pair = await storage.getCrossSellPairState(id, tenantId);
    if (pair) out.push(pair);
  }
  return out;
}

export function registerCrossSellAutomationRoutes(app: Express): void {
  /** Offene Vorschlaege (pending_action gesetzt), bestbewertete zuerst, mit Artikelnamen. */
  app.get("/api/cross-selling/review-queue", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const action = req.query.action === "add" || req.query.action === "remove" ? req.query.action : null;
      const all = (await storage.getCrossSellPairStates({ pendingOnly: true }, tenantId)).filter(
        (p) => !action || p.pendingAction === action,
      );
      // Entfernen zuerst (nach Dringlichkeit), danach Ergaenzungen nach Wert
      const removalRank = (r: string | null) => {
        const i = ["target_missing", "target_inactive", "target_hidden", "llm_no_fit", "ineffective"].indexOf(r ?? "");
        return i < 0 ? 99 : i;
      };
      all.sort((a, b) => {
        if (a.pendingAction !== b.pendingAction) return a.pendingAction === "remove" ? -1 : 1;
        if (a.pendingAction === "remove") return removalRank(a.proposalReason) - removalRank(b.proposalReason);
        return (b.score ?? 0) - (a.score ?? 0);
      });
      const counts = { add: 0, remove: 0 };
      for (const p of await storage.getCrossSellPairStates({ pendingOnly: true }, tenantId)) {
        if (p.pendingAction === "add") counts.add += 1;
        else if (p.pendingAction === "remove") counts.remove += 1;
      }
      const catalog = await loadCrossSellCatalog(storage, tenantId);
      const name = (pn: string) => catalog.byNumber.get(pn)?.name ?? null;
      res.json({
        total: all.length,
        counts,
        items: all.slice(offset, offset + limit).map((p) => ({
          ...p,
          sourceName: name(p.sourceProductNumber),
          targetName: name(p.targetProductNumber),
        })),
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-selling review queue:");
      res.status(500).json({ error: error.message || "Failed to fetch review queue" });
    }
  });

  /** Freigeben oder ablehnen, einzeln oder bis zu 100 auf einmal. */
  app.post("/api/cross-selling/review-queue/decide", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const userId = (req.user as any)?.id ?? null;
      const body = z
        .object({
          ids: z.array(z.string()).min(1).max(100),
          decision: z.enum(["approve", "reject"]),
          reasonCode: reasonCodeSchema.optional(),
          note: z.string().max(500).optional(),
          bothDirections: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      const pairs = await loadPairs(body.ids, tenantId);
      const adds = pairs.filter((p) => p.pendingAction === "add");
      const removals = pairs.filter((p) => p.pendingAction === "remove");
      const catalog = await loadCrossSellCatalog(storage, tenantId);

      if (body.decision === "reject") {
        const rejected = await rejectQueuedCrossSellPairs({ storage, catalog }, adds, {
          tenantId,
          userId,
          reasonCode: body.reasonCode ?? "other",
          note: body.note,
          bothDirections: body.bothDirections,
        });
        const kept = await keepCrossSellPairs(storage, removals, { tenantId, userId, note: body.note });
        return res.json({ rejected, kept });
      }

      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const client = reviewClient(new ShopwareClient(settings));
      const outcome = await approveCrossSellPairs(
        { storage, client, catalog, settings: await getCrossSellAutomationSettings(storage, tenantId) },
        adds,
        { tenantId, userId },
      );
      const removalOutcome = await approveCrossSellRemovals({ storage, client, catalog }, removals, { tenantId, userId });
      const outcomeAll = { ...outcome, ...removalOutcome, failed: [...outcome.failed, ...removalOutcome.failed] };
      res.json(outcomeAll);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid payload" });
      }
      moduleLog.error({ err: error }, "Error deciding cross-selling review items:");
      res.status(500).json({ error: error.message || "Failed to save decision" });
    }
  });

  /** Kandidatenlauf jetzt starten (202, Status per jobs/status?type=candidates). Bei ausgeschalteter Automatik nur Pruefliste. */
  app.post("/api/cross-selling/candidates/run", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const userId = (req.user as any)?.id ?? null;
      const { started, state } = startCrossSellJob(storage, tenantId, "candidates", async () =>
        runCandidatesForTenant(storage, settings, tenantId, "manual", userId),
      );
      res.status(202).json({ started, alreadyRunning: !started, status: state.status });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error starting cross-selling candidate run:");
      res.status(500).json({ error: error.message || "Failed to start candidate run" });
    }
  });

  /** Monatspruefung jetzt starten (202, Status per jobs/status?type=review); zaehlt nicht als Monatslauf. */
  app.post("/api/cross-selling/monthly-review/run", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const userId = (req.user as any)?.id ?? null;
      const { started, state } = startCrossSellJob(storage, tenantId, "review", async () =>
        runMonthlyReviewForTenant(storage, settings, tenantId, "manual", userId),
      );
      res.status(202).json({ started, alreadyRunning: !started, status: state.status });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error starting cross-selling monthly review:");
      res.status(500).json({ error: error.message || "Failed to start monthly review" });
    }
  });

  /** Erstbefuellung: Zustand und Budget. */
  app.get("/api/cross-selling/backfill", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const [state, settings] = await Promise.all([getBackfillState(storage, tenantId), getCrossSellAutomationSettings(storage, tenantId)]);
      res.json({ state, budget: settings.backfillLlmBudget, mode: settings.mode });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching cross-selling backfill state:");
      res.status(500).json({ error: error.message || "Failed to fetch backfill state" });
    }
  });

  /** Erstbefuellung starten: erster Schritt sofort (202), danach stuendlich im Hintergrund. */
  app.post("/api/cross-selling/backfill/start", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const userId = (req.user as any)?.id ?? null;
      const current = await getBackfillState(storage, tenantId);
      if (current.status !== "running") await startBackfill(storage, tenantId, userId);
      const { started, state } = startCrossSellJob(storage, tenantId, "backfill", async () =>
        runBackfillForTenant(storage, settings, tenantId, "manual", userId),
      );
      res.status(202).json({ started, alreadyRunning: !started, status: state.status });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error starting cross-selling backfill:");
      res.status(500).json({ error: error.message || "Failed to start backfill" });
    }
  });

  app.post("/api/cross-selling/backfill/stop", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      res.json({ state: await stopBackfill(storage, req.tenantId ?? null) });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error stopping cross-selling backfill:");
      res.status(500).json({ error: error.message || "Failed to stop backfill" });
    }
  });

  /** Einzelne Aenderung rueckgaengig machen. */
  app.post("/api/cross-selling/change-log/:id/undo", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const entry = await storage.getCrossSellChangeLogEntry(Number(req.params.id), tenantId);
      if (!entry) {
        return res.status(404).json({ error: "Change not found" });
      }
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const outcome = await undoCrossSellChanges(
        { storage, client: reviewClient(new ShopwareClient(settings)), catalog: await loadCrossSellCatalog(storage, tenantId) },
        [entry],
        { tenantId, userId: (req.user as any)?.id ?? null },
      );
      res.json(outcome);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error undoing cross-selling change:");
      res.status(500).json({ error: error.message || "Failed to undo change" });
    }
  });

  /** Alle automatischen Ergaenzungen eines Laufs rueckgaengig machen. */
  app.post("/api/cross-selling/runs/:id/undo", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const entries = (await storage.getCrossSellChangeLog({ runId: req.params.id, limit: 1000 }, tenantId)).filter(
        (e) => e.action === "add" && e.mode === "auto" && e.success && !e.undoneById,
      );
      if (entries.length === 0) {
        return res.json({ undone: [], skipped: [] });
      }
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const outcome = await undoCrossSellChanges(
        { storage, client: reviewClient(new ShopwareClient(settings)), catalog: await loadCrossSellCatalog(storage, tenantId) },
        entries,
        { tenantId, userId: (req.user as any)?.id ?? null },
      );
      res.json(outcome);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error undoing cross-selling run:");
      res.status(500).json({ error: error.message || "Failed to undo run" });
    }
  });
}
