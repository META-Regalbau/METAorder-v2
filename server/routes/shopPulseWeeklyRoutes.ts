// Shop-Puls Stufe 2 (S2-1, nur Administratoren): Maßnahmen-Protokoll ansehen, von Hand eintragen, bearbeiten
// und löschen, Live-Protokolle hochladen (einmaliger Import), Archiv der Wochenberichte und „Jetzt erstellen“
// (ohne Senden). Stufe 2 (S2-6): Wirkung je Maßnahme ansehen und neu berechnen.
import type { Express, Request, Response } from "express";
import { requireAdministrator, requireAuth, requireCsrf } from "../auth/auth";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import {
  shopPulseActionImportSchema,
  shopPulseActionInputSchema,
  type ShopPulseActionsOverview,
  type ShopPulseImportResult,
  type ShopPulseWeeklyOverview,
} from "@shared/shopPulseWeekly";
import { createManualAction, deleteAction, existingSourceKeys, getAction, insertCandidates, listActions, listWeeklyReports, updateAction } from "../shopPulse/actionLogRepository";
import { parseLiveProtocol } from "../shopPulse/actionImport";
import type { ActionCandidate } from "../shopPulse/actionLog";
import { syncActionLog } from "../shopPulse/actionSync";
import { buildAndSaveWeeklyReport, isShopPulseRunning, shopPulseDeps } from "../shopPulse/shopPulseScheduler";
import { getShopPulseSettings } from "../shopPulse/shopPulseSettings";
import { MIRROR_SIGNAL_KEY } from "../shopPulse/detectors/mirrorFreshness";
import { loadProductRevenue } from "../shopPulse/buyabilityData";
import type { ShopPulseEffectsOverview } from "@shared/shopPulseEffects";
import { listEffects, refreshEffects, shopPulseEffectsDeps } from "../shopPulse/effectsRun";

const moduleLog = logger.child({ component: "routes/shopPulseWeeklyRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;
const userName = (req: Request) => String((req as any).user?.username ?? "admin").slice(0, 120);
const DAY_MS = 24 * 60 * 60 * 1000;
/** So viele Einträge zeigt die Seite (neueste zuerst) */
const ACTIONS_LIMIT = 500;

async function actionsOverview(tenantId: string | null): Promise<ShopPulseActionsOverview> {
  return { actions: await listActions(tenantId, { limit: ACTIONS_LIMIT }) };
}

/** Wirkungen der Maßnahmen, die die Seite zeigt (gelöschte und ältere fallen weg) */
async function effectsOverview(tenantId: string | null): Promise<ShopPulseEffectsOverview> {
  const listed = new Set((await listActions(tenantId, { limit: ACTIONS_LIMIT })).map((a) => a.id));
  const shown = (await listEffects(tenantId)).filter((e) => listed.has(e.actionId));
  const computedAt = shown.reduce<string | null>((m, e) => (!m || e.computedAt > m ? e.computedAt : m), null);
  return { effects: shown, computedAt };
}

export function registerShopPulseWeeklyRoutes(app: Express): void {
  /** Zuletzt berechnete Wirkung je Maßnahme (S2-6) */
  app.get("/api/shop-pulse/effects", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    try {
      res.json(await effectsOverview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Wirkung: Laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load shop pulse effects" });
    }
  });

  /** Wirkung jetzt neu berechnen (Bestellspiegel, Herstellpreise; GA4 nur, wenn eingerichtet) */
  app.post("/api/shop-pulse/effects/refresh", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    if (isShopPulseRunning(tenantId)) return res.status(409).json({ error: "Shop pulse run already in progress" });
    try {
      await syncActionLog(storage, tenantId, new Date()).catch((err) => moduleLog.warn({ err, tenantId }, "Wirkung: Maßnahmen-Protokoll nicht abgeglichen"));
      const run = await refreshEffects(shopPulseEffectsDeps(storage), tenantId, new Date());
      moduleLog.info({ tenantId, effects: run.effects.length, ga4: run.ga4Read, by: userName(req) }, "Wirkung: von Hand neu berechnet");
      res.json(await effectsOverview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Wirkung: Berechnen fehlgeschlagen");
      res.status(500).json({ error: "Failed to compute shop pulse effects" });
    }
  });

  /** Maßnahmen-Protokoll; zieht vorher die automatischen Quellen nach (Fehler dabei halten die Liste nicht auf) */
  app.get("/api/shop-pulse/actions", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    try {
      await syncActionLog(storage, tenantId, new Date()).catch((err) => moduleLog.warn({ err, tenantId }, "Maßnahmen-Protokoll: Abgleich fehlgeschlagen"));
      res.json(await actionsOverview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Maßnahmen-Protokoll: Laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load shop pulse actions" });
    }
  });

  /** Von Hand eintragen, z. B. „Kampagne pausiert“, „Preis gesenkt“, „Newsletter verschickt“ */
  app.post("/api/shop-pulse/actions", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = shopPulseActionInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid shop pulse action" });
    const tenantId = tenantOf(req);
    try {
      const action = await createManualAction(tenantId, parsed.data, userName(req));
      moduleLog.info({ tenantId, id: action.id, scope: action.scope.type }, "Maßnahmen-Protokoll: Eintrag angelegt");
      res.json(await actionsOverview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Maßnahmen-Protokoll: Anlegen fehlgeschlagen");
      res.status(500).json({ error: "Failed to save shop pulse action" });
    }
  });

  app.put("/api/shop-pulse/actions/:id", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = shopPulseActionInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid shop pulse action" });
    const tenantId = tenantOf(req);
    try {
      const action = await updateAction(tenantId, String(req.params.id), parsed.data);
      if (!action) return res.status(404).json({ error: "Shop pulse action not found" });
      moduleLog.info({ tenantId, id: action.id, by: userName(req) }, "Maßnahmen-Protokoll: Eintrag geändert");
      res.json(await actionsOverview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Maßnahmen-Protokoll: Ändern fehlgeschlagen");
      res.status(500).json({ error: "Failed to save shop pulse action" });
    }
  });

  /** Löschen; automatische Einträge bleiben ausgeblendet gespeichert, damit der Abgleich sie nicht neu anlegt */
  app.delete("/api/shop-pulse/actions/:id", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    try {
      const existing = await getAction(tenantId, String(req.params.id));
      if (!existing || !(await deleteAction(tenantId, existing.id))) return res.status(404).json({ error: "Shop pulse action not found" });
      moduleLog.info({ tenantId, id: existing.id, kind: existing.kind, by: userName(req) }, "Maßnahmen-Protokoll: Eintrag gelöscht");
      res.json(await actionsOverview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Maßnahmen-Protokoll: Löschen fehlgeschlagen");
      res.status(500).json({ error: "Failed to delete shop pulse action" });
    }
  });

  /**
   * Einmaliger Import der Live-Protokolle (`*-Protokoll-Live-*.json`). Idempotent: je Datei ein fester
   * Schlüssel, ein zweiter Upload legt nichts doppelt an. Nur Live-Protokolle des eigenen Mandanten.
   */
  app.post("/api/shop-pulse/actions/import", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = shopPulseActionImportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid shop pulse protocol upload" });
    const tenantId = tenantOf(req);
    try {
      const result: ShopPulseImportResult = { imported: 0, skipped: [] };
      const candidates: Array<{ name: string; candidate: ActionCandidate }> = [];
      for (const file of parsed.data.files) {
        const r = parseLiveProtocol(file, tenantId);
        if ("skip" in r) result.skipped.push({ name: file.name, reason: r.skip });
        else candidates.push({ name: file.name, candidate: r.candidate });
      }
      const existing = await existingSourceKeys(tenantId, candidates.map((c) => c.candidate.sourceKey));
      const fresh = candidates.filter((c) => !existing.has(c.candidate.sourceKey));
      for (const c of candidates) if (existing.has(c.candidate.sourceKey)) result.skipped.push({ name: c.name, reason: "duplicate" });
      const inserted = new Set(await insertCandidates(tenantId, fresh.map((c) => c.candidate)));
      for (const c of fresh) {
        if (inserted.has(c.candidate.sourceKey)) result.imported += 1;
        else result.skipped.push({ name: c.name, reason: "duplicate" });
      }
      moduleLog.info({ tenantId, files: parsed.data.files.length, imported: result.imported, skipped: result.skipped.length, by: userName(req) }, "Maßnahmen-Protokoll: Live-Protokolle importiert");
      res.json({ ...result, ...(await actionsOverview(tenantId)) });
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Maßnahmen-Protokoll: Import fehlgeschlagen");
      res.status(500).json({ error: "Failed to import shop pulse protocols" });
    }
  });

  app.get("/api/shop-pulse/weekly-reports", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      const overview: ShopPulseWeeklyOverview = { reports: await listWeeklyReports(tenantOf(req)) };
      res.json(overview);
    } catch (error) {
      moduleLog.error({ err: error }, "Wochenbericht: Archiv laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load shop pulse weekly reports" });
    }
  });

  /**
   * Wochenbericht der abgeschlossenen Woche jetzt erstellen bzw. neu erstellen, ohne zu senden (auch
   * ausgeschaltet). KI-Text nur mit Schalter „KI-Texte“ und eingerichtetem Anbieter.
   */
  app.post("/api/shop-pulse/weekly-reports/build", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    if (isShopPulseRunning(tenantId)) return res.status(409).json({ error: "Shop pulse run already in progress" });
    try {
      const deps = shopPulseDeps(storage);
      const now = new Date();
      const settings = await getShopPulseSettings(storage, tenantId);
      const aiOn = !!deps.ai && settings.aiTexts && (await deps.ai.configured(tenantId).catch(() => false));
      const open = await deps.repo.listOpenSignals(tenantId);
      const report = await buildAndSaveWeeklyReport(deps, deps.weekly!, {
        tenantId,
        now,
        mirrorStale: open.some((s) => s.key === MIRROR_SIGNAL_KEY),
        send: false,
        ai: aiOn ? deps.ai! : null,
        aiRun: {
          now,
          orders: () => deps.loadOrders(tenantId, new Date(now.getTime() - 400 * DAY_MS)),
          productRevenue: () => loadProductRevenue(tenantId, new Date(now.getTime() - 365 * DAY_MS)),
        },
      });
      moduleLog.info({ tenantId, weekStart: report.weekStart, levers: report.data.levers.length, by: userName(req) }, "Wochenbericht: von Hand erstellt");
      const overview: ShopPulseWeeklyOverview = { reports: await listWeeklyReports(tenantId) };
      res.json(overview);
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Wochenbericht: Erstellen fehlgeschlagen");
      res.status(500).json({ error: "Failed to build shop pulse weekly report" });
    }
  });
}
