// Shop-Puls: Meldungen und Einstellungen (nur Administratoren), Prüfung von Hand starten, Testnachricht,
// Meldung erledigen oder ruhig stellen, Soll-Stand der Kaufbarkeit übernehmen, Datenlücken als CSV für die
// PIM-Sammlung; Teams-Warteschlange für n8n (auch per Integration-Key).
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { isAdministrator, requireAdministrator, requireAuth, requireAuthOrIntegrationKey, requireCsrf } from "../auth/auth";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { isAllowedTeamsWebhookUrl } from "@shared/emailIntake";
import { isLearning, type ShopPulseDataGaps, type ShopPulseOverview } from "@shared/shopPulse";
import { ackTeamsOutbox, enqueueTeamsMessage, getTeamsOutbox } from "../lib/teamsOutbox";
import { isChatLlmConfigured } from "../ai/llmChat";
import { getSignal, listSignalsForOverview, muteSignal, resolveSignalManually } from "../shopPulse/shopPulseRepository";
import { compareSignals } from "../shopPulse/shopPulseSignals";
import { buildShopPulseTestCard } from "../shopPulse/shopPulseNotify";
import { isShopPulseRunning, runShopPulseForTenant, shopPulseDeps } from "../shopPulse/shopPulseScheduler";
import { acceptBuyabilityBaseline, dataGapsCsv, DATA_GAPS_KEY, getBuyabilityBaseline } from "../shopPulse/detectors/buyability";
import {
  applyShopPulseSettingsUpdate,
  getShopPulseSettings,
  getShopPulseState,
  saveShopPulseSettings,
  SHOP_PULSE_TEAMS_OUTBOX_KEY,
} from "../shopPulse/shopPulseSettings";

const moduleLog = logger.child({ component: "routes/shopPulseRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;

const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    teamsWebhookUrl: z
      .union([z.literal(""), z.string().trim().max(2000).url().refine((v) => isAllowedTeamsWebhookUrl(v))])
      .optional(),
    shopWatchDirect: z.boolean().optional(),
    aiTexts: z.boolean().optional(),
    endLearning: z.literal(true).optional(),
  })
  .strict();
const muteSchema = z.object({ days: z.number().int().min(0).max(30) }).strict();
const ackSchema = z.object({ ids: z.array(z.string().min(1).max(64)).max(100) });

/** Warteschlange: n8n mit Integration-Key oder ein Administrator */
function requireIntegrationOrAdministrator(req: any, res: Response, next: () => void) {
  if (req.integrationKeyAuth === true || isAdministrator(req.user)) return next();
  res.status(403).json({ error: "Nur für Administratoren" });
}

async function overview(tenantId: string | null): Promise<ShopPulseOverview> {
  const [settings, state, signals, outbox, baseline, gaps, aiConfigured] = await Promise.all([
    getShopPulseSettings(storage, tenantId),
    getShopPulseState(storage, tenantId),
    listSignalsForOverview(tenantId),
    getTeamsOutbox(storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId),
    getBuyabilityBaseline(storage, tenantId),
    getDataGaps(tenantId),
    isChatLlmConfigured((key) => storage.getSetting(key, tenantId)),
  ]);
  const gapCounts: NonNullable<ShopPulseOverview["dataGaps"]>["counts"] = {};
  for (const g of gaps?.items ?? []) gapCounts[g.code] = (gapCounts[g.code] ?? 0) + 1;
  const { teamsWebhookUrl, ...rest } = settings;
  return {
    settings: { ...rest, teamsConfigured: !!teamsWebhookUrl },
    aiConfigured,
    learning: isLearning(settings, new Date()),
    state,
    signals: signals.sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || compareSignals(a, b)),
    teamsPending: teamsWebhookUrl ? outbox.length : 0,
    running: isShopPulseRunning(tenantId),
    buyabilityBaseline: baseline
      ? { takenAt: baseline.takenAt, products: baseline.products?.length ?? 0, paymentMethods: baseline.payment?.length ?? 0, shippingMethods: baseline.shipping?.length ?? 0 }
      : null,
    dataGaps: gaps ? { at: gaps.at, counts: gapCounts } : null,
  };
}

async function getDataGaps(tenantId: string | null): Promise<ShopPulseDataGaps | null> {
  const raw = await storage.getSetting(DATA_GAPS_KEY, tenantId);
  return raw && typeof raw === "object" && Array.isArray((raw as ShopPulseDataGaps).items) ? (raw as ShopPulseDataGaps) : null;
}

export function registerShopPulseRoutes(app: Express): void {
  app.get("/api/shop-pulse", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      res.json(await overview(tenantOf(req)));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Stand laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load shop pulse" });
    }
  });

  /** Ein-/Ausschalten, Teams-Direktnachricht, Wächter direkt, KI-Texte, Lernwoche beenden. Die Webhook-Adresse wird nie zurückgegeben. */
  app.put("/api/shop-pulse/settings", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid shop pulse settings" });
    try {
      const tenantId = tenantOf(req);
      const current = await getShopPulseSettings(storage, tenantId);
      const next = applyShopPulseSettingsUpdate(current, parsed.data, new Date());
      await saveShopPulseSettings(storage, tenantId, next);
      moduleLog.info(
        { tenantId, enabled: next.enabled, teams: !!next.teamsWebhookUrl, shopWatchDirect: next.shopWatchDirect, aiTexts: next.aiTexts, learningUntil: next.learningUntil },
        "Shop-Puls: Einstellungen gespeichert",
      );
      res.json(await overview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Einstellungen speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to save shop pulse settings" });
    }
  });

  /** Prüfung jetzt, auch die Nachtläufe (auch ausgeschaltet; Meldungen nur bei eingeschaltetem Shop-Puls) */
  app.post("/api/shop-pulse/run", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    if (isShopPulseRunning(tenantId)) return res.status(409).json({ error: "Shop pulse run already in progress" });
    try {
      await runShopPulseForTenant(shopPulseDeps(storage), tenantId, { force: true });
      res.json(await overview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Shop-Puls: Lauf fehlgeschlagen");
      res.status(500).json({ error: "Shop pulse run failed" });
    }
  });

  /**
   * Kaufbarkeit: jetzigen Stand als Soll übernehmen (kaufbare Artikel mit Umsatz, aktive Zahl- und
   * Versandarten). Danach meldet der nächste Lauf bewusst entfernte Artikel und Arten nicht mehr.
   */
  app.post("/api/shop-pulse/buyability/baseline", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    if (isShopPulseRunning(tenantId)) return res.status(409).json({ error: "Shop pulse run already in progress" });
    try {
      const deps = shopPulseDeps(storage);
      const now = new Date();
      const sources = deps.loadBuyability!(tenantId, now);
      const baseline = await acceptBuyabilityBaseline({ storage, tenantId, now, buyability: sources });
      moduleLog.info(
        { tenantId, products: baseline.products?.length, payment: baseline.payment?.length, shipping: baseline.shipping?.length },
        "Shop-Puls: Soll-Stand der Kaufbarkeit übernommen",
      );
      await runShopPulseForTenant(deps, tenantId, { force: true });
      res.json(await overview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Shop-Puls: Soll-Stand übernehmen fehlgeschlagen");
      res.status(500).json({ error: "Failed to save buyability baseline" });
    }
  });

  /** Datenlücken des letzten Nachtlaufs als CSV für die PIM-Sammlung (Format wie Datenfehler-PIM-Artikel.csv) */
  app.get("/api/shop-pulse/data-gaps.csv", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      const gaps = await getDataGaps(tenantOf(req));
      if (!gaps) return res.status(404).json({ error: "No data gaps yet" });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="Datenluecken-Shop-Puls-${gaps.at.slice(0, 10)}.csv"`);
      res.send(dataGapsCsv(gaps));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Datenlücken laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load data gaps" });
    }
  });

  /** Testnachricht an die Teams-Direktnachricht (über n8n, auch in der Lernwoche) */
  app.post("/api/shop-pulse/test-message", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const settings = await getShopPulseSettings(storage, tenantId);
      if (!settings.teamsWebhookUrl) return res.status(400).json({ error: "Teams webhook not configured" });
      const now = new Date();
      await enqueueTeamsMessage(storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId, buildShopPulseTestCard(shopPulseDeps(storage).baseUrl, now), now);
      moduleLog.info({ tenantId }, "Shop-Puls: Testnachricht in die Warteschlange gelegt");
      res.json(await overview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Testnachricht fehlgeschlagen");
      res.status(500).json({ error: "Failed to queue shop pulse test message" });
    }
  });

  /** Erledigt (von Hand); kommt der Fund wieder, öffnet der nächste Lauf die Meldung erneut */
  app.post("/api/shop-pulse/signals/:id/resolve", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const by = String((req as any).user?.username ?? "admin").slice(0, 120);
      const signal = await resolveSignalManually(tenantId, String(req.params.id), by);
      if (!signal) return res.status(404).json({ error: "Shop pulse signal not found" });
      moduleLog.info({ tenantId, key: signal.key, by }, "Shop-Puls: Meldung erledigt");
      res.json({ signal });
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Meldung erledigen fehlgeschlagen");
      res.status(500).json({ error: "Failed to update shop pulse signal" });
    }
  });

  /** Ruhig stellen für 1–30 Tage; 0 = wieder melden */
  app.post("/api/shop-pulse/signals/:id/mute", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = muteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid shop pulse mute" });
    try {
      const tenantId = tenantOf(req);
      const existing = await getSignal(tenantId, String(req.params.id));
      if (!existing) return res.status(404).json({ error: "Shop pulse signal not found" });
      const until = parsed.data.days > 0 ? new Date(Date.now() + parsed.data.days * 24 * 60 * 60 * 1000) : null;
      const signal = await muteSignal(tenantId, existing.id, until);
      moduleLog.info({ tenantId, key: existing.key, days: parsed.data.days }, "Shop-Puls: Meldung ruhig gestellt");
      res.json({ signal });
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Meldung ruhig stellen fehlgeschlagen");
      res.status(500).json({ error: "Failed to update shop pulse signal" });
    }
  });

  /**
   * n8n holt fertige Teams-Karten ab (Workflow n8n-workflows/shop-pulse-teams.json) und postet sie an die
   * Teams-Direktnachricht aus den Shop-Puls-Einstellungen; danach quittieren. Ohne Adresse leer.
   */
  app.get("/api/shop-pulse/teams-outbox", requireAuthOrIntegrationKey, requireIntegrationOrAdministrator, async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const webhookUrl = (await getShopPulseSettings(storage, tenantId)).teamsWebhookUrl;
      const items = webhookUrl ? await getTeamsOutbox(storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId) : [];
      res.json({ webhookUrl, items });
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Teams-Warteschlange laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load shop pulse Teams outbox" });
    }
  });

  app.post(
    "/api/shop-pulse/teams-outbox/ack",
    requireAuthOrIntegrationKey,
    requireIntegrationOrAdministrator,
    requireCsrf,
    async (req: Request, res: Response) => {
      const parsed = ackSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid shop pulse Teams acknowledgement" });
      try {
        const removed = await ackTeamsOutbox(storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantOf(req), parsed.data.ids);
        res.json({ removed });
      } catch (error) {
        moduleLog.error({ err: error }, "Shop-Puls: Teams-Warteschlange quittieren fehlgeschlagen");
        res.status(500).json({ error: "Failed to acknowledge shop pulse Teams outbox" });
      }
    },
  );
}
