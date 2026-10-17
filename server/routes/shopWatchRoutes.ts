// Shop-Wächter: letzter Lauf, Verlauf, Soll-Stand; Prüfung starten, aktuellen Stand als Soll übernehmen.
// Nur Administratoren, nur lesend gegenüber dem Shop. Vor registerShopContentRoutes registrieren
// (dort fängt /api/shop-content/:id sonst /api/shop-content/watch ab).
import type { Express, Request, Response } from "express";
import { requireAdministrator, requireAuth } from "../auth/auth";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import {
  getShopWatchBaseline,
  getShopWatchState,
  isShopWatchRunning,
  runShopWatch,
  saveShopWatchBaselineFromLastRun,
} from "../shopContent/shopWatch";

const moduleLog = logger.child({ component: "routes/shopWatchRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;

export function registerShopWatchRoutes(app: Express): void {
  app.get("/api/shop-content/watch", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const [state, baseline] = await Promise.all([getShopWatchState(storage, tenantId), getShopWatchBaseline(storage, tenantId)]);
      const { categoryFields: _fields, ...lastRun } = state.lastRun ?? ({} as NonNullable<typeof state.lastRun>);
      res.json({
        lastRun: state.lastRun ? lastRun : null,
        history: state.history ?? [],
        baseline: baseline ? { takenAt: baseline.takenAt, counts: baseline.counts, categories: Object.keys(baseline.categoryFields).length } : null,
        running: isShopWatchRunning(tenantId),
      });
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Wächter: Stand laden fehlgeschlagen");
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load shop watch state" });
    }
  });

  /** Startet eine Vollprüfung im Hintergrund; Ergebnis per GET abholen */
  app.post("/api/shop-content/watch/run", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    if (isShopWatchRunning(tenantId)) return res.status(409).json({ error: "Shop watch run already in progress" });
    if (!(await storage.getShopwareSettings(tenantId))) return res.status(400).json({ error: "Shopware settings not configured" });
    void runShopWatch(storage, tenantId, { trigger: "manual" }).catch((err) => moduleLog.error({ err, tenantId }, "Shop-Wächter: Lauf fehlgeschlagen"));
    res.status(202).json({ started: true });
  });

  /** Ergebnis des letzten Laufs als Soll-Stand übernehmen (nach gewollten Änderungen) */
  app.post("/api/shop-content/watch/baseline", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      const baseline = await saveShopWatchBaselineFromLastRun(storage, tenantOf(req));
      moduleLog.info({ tenantId: tenantOf(req), counts: baseline.counts }, "Shop-Wächter: Soll-Stand übernommen");
      res.json({ baseline: { takenAt: baseline.takenAt, counts: baseline.counts, categories: Object.keys(baseline.categoryFields).length } });
    } catch (error) {
      if (error instanceof Error && error.message === "No shop watch run yet") return res.status(400).json({ error: "No shop watch run yet" });
      moduleLog.error({ err: error }, "Shop-Wächter: Soll-Stand speichern fehlgeschlagen");
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save shop watch baseline" });
    }
  });
}
