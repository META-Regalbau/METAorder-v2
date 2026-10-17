// Shop-Wächter: letzter Lauf, Verlauf, Soll-Stand; Prüfung starten, aktuellen Stand als Soll übernehmen;
// Zeitplan an/aus; Teams-Warteschlange für n8n. Nur Administratoren (Warteschlange auch per
// Integration-Key), nur lesend gegenüber dem Shop. Vor registerShopContentRoutes registrieren
// (dort fängt /api/shop-content/:id sonst /api/shop-content/watch ab).
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { isAdministrator, requireAdministrator, requireAuth, requireAuthOrIntegrationKey, requireCsrf } from "../auth/auth";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import {
  getShopWatchBaseline,
  getShopWatchState,
  isShopWatchRunning,
  saveShopWatchBaselineFromLastRun,
} from "../shopContent/shopWatch";
import {
  getShopWatchScheduleState,
  getShopWatchSettings,
  runShopWatchWithNotices,
  SHOP_WATCH_SETTINGS_KEY,
  shopWatchDeps,
} from "../shopContent/shopWatchScheduler";
import { ackShopWatchTeamsOutbox, getShopWatchTeamsOutbox } from "../shopContent/shopWatchNotify";
import { shopWatchTeamsWebhookUrl } from "../shopPulse/shopPulseSettings";

const moduleLog = logger.child({ component: "routes/shopWatchRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;

const settingsSchema = z.object({ enabled: z.boolean() }).strict();
const ackSchema = z.object({ ids: z.array(z.string().min(1).max(64)).max(100) });

/** Warteschlange: n8n mit Integration-Key oder ein Administrator */
function requireIntegrationOrAdministrator(req: any, res: Response, next: () => void) {
  if (req.integrationKeyAuth === true || isAdministrator(req.user)) return next();
  res.status(403).json({ error: "Nur für Administratoren" });
}

export function registerShopWatchRoutes(app: Express): void {
  app.get("/api/shop-content/watch", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const [state, baseline, settings, schedule, teamsWebhook, outbox] = await Promise.all([
        getShopWatchState(storage, tenantId),
        getShopWatchBaseline(storage, tenantId),
        getShopWatchSettings(storage, tenantId),
        getShopWatchScheduleState(storage, tenantId),
        shopWatchTeamsWebhookUrl(storage, tenantId),
        getShopWatchTeamsOutbox(storage, tenantId),
      ]);
      const { categoryFields: _fields, ...lastRun } = state.lastRun ?? ({} as NonNullable<typeof state.lastRun>);
      res.json({
        lastRun: state.lastRun ? lastRun : null,
        history: state.history ?? [],
        baseline: baseline ? { takenAt: baseline.takenAt, counts: baseline.counts, categories: Object.keys(baseline.categoryFields).length } : null,
        running: isShopWatchRunning(tenantId),
        settings,
        schedule: {
          lastFingerprintAt: schedule.lastFingerprintAt ?? null,
          lastFullRunAt: schedule.lastFullRunAt ?? null,
          lastNotice: schedule.lastNotice ?? null,
          teamsConfigured: !!teamsWebhook,
          teamsPending: outbox.length,
        },
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
    void runShopWatchWithNotices(shopWatchDeps(storage), tenantId, { trigger: "manual", cadence: "all" }).catch((err) => moduleLog.error({ err, tenantId }, "Shop-Wächter: Lauf fehlgeschlagen"));
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

  /** Zeitplan und Meldungen an/aus (Standard aus) */
  app.put("/api/shop-content/watch/settings", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid shop watch settings" });
    try {
      const tenantId = tenantOf(req);
      await storage.saveSetting(SHOP_WATCH_SETTINGS_KEY, parsed.data, tenantId);
      moduleLog.info({ tenantId, enabled: parsed.data.enabled }, "Shop-Wächter: Zeitplan umgestellt");
      res.json({ settings: parsed.data });
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Wächter: Einstellungen speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to save shop watch settings" });
    }
  });

  /**
   * n8n holt fertige Teams-Karten ab (Workflow n8n-workflows/shop-watch-teams.json) und postet sie an
   * den Webhook aus den E-Mail-Eingang-Einstellungen (oder an die Direktnachricht des Shop-Puls, wenn dort
   * eingestellt); danach quittieren. Ohne Webhook leer.
   */
  app.get("/api/shop-content/watch/teams-outbox", requireAuthOrIntegrationKey, requireIntegrationOrAdministrator, async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const webhookUrl = await shopWatchTeamsWebhookUrl(storage, tenantId);
      const items = webhookUrl ? await getShopWatchTeamsOutbox(storage, tenantId) : [];
      res.json({ webhookUrl, items });
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Wächter: Teams-Warteschlange laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load shop watch Teams outbox" });
    }
  });

  app.post(
    "/api/shop-content/watch/teams-outbox/ack",
    requireAuthOrIntegrationKey,
    requireIntegrationOrAdministrator,
    requireCsrf,
    async (req: Request, res: Response) => {
      const parsed = ackSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid shop watch Teams acknowledgement" });
      try {
        const removed = await ackShopWatchTeamsOutbox(storage, tenantOf(req), parsed.data.ids);
        res.json({ removed });
      } catch (error) {
        moduleLog.error({ err: error }, "Shop-Wächter: Teams-Warteschlange quittieren fehlgeschlagen");
        res.status(500).json({ error: "Failed to acknowledge shop watch Teams outbox" });
      }
    },
  );
}
