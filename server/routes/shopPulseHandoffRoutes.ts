// Shop-Puls Stufe 3 (S3-1), Vom Befund zur Umsetzung (nur Administratoren): Meldung für Agentur/Smarketer
// weitergeben (Text an Oliver), Ticket aus einer Meldung, Weitergabe erledigt, Jana-Liste jetzt senden,
// Suchwörter (prüfen, eintragen, rückgängig, verwerfen, automatisch ein/aus).
import type { Express, Request, Response } from "express";
import { requireAdministrator, requireAuth, requireCsrf } from "../auth/auth";
import { logger } from "../lib/logger";
import { notificationEvents } from "../lib/events";
import { storage } from "../storage";
import { publicAppBaseUrl } from "../commercial/emailIntakeTeams";
import { ShopBusyError } from "../shopContent/shopWatch";
import {
  shopPulseForwardSchema,
  shopPulseKeywordApplySchema,
  shopPulseKeywordSettingsSchema,
  shopPulseKeywordTermSchema,
  shopPulseTicketSchema,
  type ShopPulseKeywordsOverview,
} from "@shared/shopPulseHandoff";
import { createTicketFromSignal, forwardSignal, handoffDeps, HandoffError, markHandoffDone, sendJanaList } from "../shopPulse/handoffRun";
import { insertCandidates } from "../shopPulse/actionLogRepository";
import {
  applyKeyword,
  checkTerm,
  dismissKeyword,
  getKeywordSettings,
  KEYWORD_SETTINGS_KEY,
  KeywordError,
  keywordDeps,
  keywordLastRunAt,
  listKeywords,
  revertKeyword,
} from "../shopPulse/searchKeywordsRun";

const moduleLog = logger.child({ component: "routes/shopPulseHandoffRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;
const userOf = (req: Request) => ({ id: String((req as any).user?.id ?? ""), username: String((req as any).user?.username ?? "admin").slice(0, 120) });

const outbound = () => ({ onNotificationCreated: (n: any) => notificationEvents.emitNotificationCreated(n), baseUrl: publicAppBaseUrl(process.env.APP_URL?.trim() || null) });
const hDeps = () => {
  const o = outbound();
  return handoffDeps(storage, o.onNotificationCreated, o.baseUrl);
};
const kDeps = () => keywordDeps(storage, outbound(), insertCandidates);

async function keywordsOverview(tenantId: string | null): Promise<ShopPulseKeywordsOverview> {
  const [settings, items, lastRunAt] = await Promise.all([getKeywordSettings(storage, tenantId), listKeywords(tenantId), keywordLastRunAt(storage, tenantId)]);
  return { settings, items, lastRunAt };
}

function keywordFailure(res: Response, error: unknown, text: string) {
  if (error instanceof KeywordError) {
    if (error.reason === "notFound") return res.status(404).json({ error: "Search keyword not found" });
    if (error.reason === "notCandidate") return res.status(400).json({ error: "Product is not a suggestion for this search term" });
    return res.status(409).json({ error: "Search keyword is not applied" });
  }
  if (error instanceof ShopBusyError) return res.status(409).json({ error: "Shop is busy, please try again in a minute" });
  if (error instanceof Error && error.message === "Shopware settings not configured") return res.status(400).json({ error: "Shopware settings not configured" });
  moduleLog.error({ err: error }, text);
  return res.status(500).json({ error: "Failed to update search keyword" });
}

export function registerShopPulseHandoffRoutes(app: Express): void {
  /** Text für wirduzen bzw. Smarketer an Oliver (Teams-Direktnachricht, Glocke), Status „weitergegeben am …“ */
  app.post("/api/shop-pulse/signals/:id/forward", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = shopPulseForwardSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid shop pulse handoff" });
    try {
      const handoff = await forwardSignal(hDeps(), tenantOf(req), String(req.params.id), parsed.data.kind, userOf(req).username);
      res.json({ handoff });
    } catch (error) {
      if (error instanceof HandoffError) return res.status(404).json({ error: "Shop pulse signal not found" });
      moduleLog.error({ err: error }, "Shop-Puls: Weitergabe fehlgeschlagen");
      res.status(500).json({ error: "Failed to forward shop pulse signal" });
    }
  });

  /** METAorder-Ticket aus einer Meldung (mit Fälligkeit, optional zugewiesen) */
  app.post("/api/shop-pulse/signals/:id/ticket", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = shopPulseTicketSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid shop pulse ticket" });
    try {
      const tenantId = tenantOf(req);
      if (parsed.data.assignedToUserId) {
        const u = await storage.getUser(parsed.data.assignedToUserId);
        if (!u) return res.status(400).json({ error: "Assignee not found" });
      }
      const handoff = await createTicketFromSignal(hDeps(), tenantId, String(req.params.id), parsed.data, userOf(req));
      res.json({ handoff });
    } catch (error) {
      if (error instanceof HandoffError) return res.status(404).json({ error: "Shop pulse signal not found" });
      moduleLog.error({ err: error }, "Shop-Puls: Ticket anlegen fehlgeschlagen");
      res.status(500).json({ error: "Failed to create ticket from shop pulse signal" });
    }
  });

  app.post("/api/shop-pulse/handoffs/:id/done", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    try {
      const handoff = await markHandoffDone(tenantOf(req), String(req.params.id), userOf(req).username);
      if (!handoff) return res.status(404).json({ error: "Shop pulse handoff not found" });
      res.json({ handoff });
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Weitergabe erledigen fehlgeschlagen");
      res.status(500).json({ error: "Failed to update shop pulse handoff" });
    }
  });

  /** Jana-Liste jetzt senden (sonst montags von selbst) */
  app.post("/api/shop-pulse/jana-list/send", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    try {
      const state = await sendJanaList(hDeps(), tenantOf(req), new Date(), { force: true });
      if (!state) return res.status(404).json({ error: "No data gaps yet" });
      const { keys: _keys, ...rest } = state;
      res.json({ janaList: rest });
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Jana-Liste senden fehlgeschlagen");
      res.status(500).json({ error: "Failed to send Jana list" });
    }
  });

  app.get("/api/shop-pulse/keywords", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      res.json(await keywordsOverview(tenantOf(req)));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Suchwörter laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load search keywords" });
    }
  });

  /** Begriff von Hand prüfen: passende Artikel finden, nichts eintragen */
  app.post("/api/shop-pulse/keywords", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = shopPulseKeywordTermSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid search term" });
    try {
      const tenantId = tenantOf(req);
      const keyword = await checkTerm(kDeps(), tenantId, { term: parsed.data.term, source: "manual", searches: 0 }, new Date());
      res.json({ keyword, overview: await keywordsOverview(tenantId) });
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Suchbegriff prüfen fehlgeschlagen");
      res.status(500).json({ error: "Failed to check search term" });
    }
  });

  app.put("/api/shop-pulse/keywords/settings", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = shopPulseKeywordSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid search keyword settings" });
    try {
      const tenantId = tenantOf(req);
      await storage.saveSetting(KEYWORD_SETTINGS_KEY, parsed.data, tenantId);
      moduleLog.info({ tenantId, autoApply: parsed.data.autoApply }, "Shop-Puls: Suchwörter-Einstellung gespeichert");
      res.json(await keywordsOverview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Suchwörter-Einstellung speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to save search keyword settings" });
    }
  });

  /** Begriff an den gewählten Artikeln (aus den Vorschlägen) in Shopware eintragen */
  app.post("/api/shop-pulse/keywords/:id/apply", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = shopPulseKeywordApplySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid search keyword products" });
    try {
      const tenantId = tenantOf(req);
      await applyKeyword(kDeps(), tenantId, String(req.params.id), parsed.data.productNumbers, userOf(req).username);
      res.json(await keywordsOverview(tenantId));
    } catch (error) {
      keywordFailure(res, error, "Shop-Puls: Suchwort eintragen fehlgeschlagen");
    }
  });

  app.post("/api/shop-pulse/keywords/:id/revert", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      await revertKeyword(kDeps(), tenantId, String(req.params.id), userOf(req).username);
      res.json(await keywordsOverview(tenantId));
    } catch (error) {
      keywordFailure(res, error, "Shop-Puls: Suchwort zurücknehmen fehlgeschlagen");
    }
  });

  app.post("/api/shop-pulse/keywords/:id/dismiss", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const k = await dismissKeyword(tenantId, String(req.params.id));
      if (!k) return res.status(404).json({ error: "Search keyword not found" });
      res.json(await keywordsOverview(tenantId));
    } catch (error) {
      keywordFailure(res, error, "Shop-Puls: Suchwort verwerfen fehlgeschlagen");
    }
  });
}
