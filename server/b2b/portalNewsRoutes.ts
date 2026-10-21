/**
 * Portal-Neuigkeiten: Einstellungen, n8n-Eingang (Ordner im Postfach), Beiträge und die Shop-Seite.
 * Ansehen mit „B2B ansehen“, alles Ändernde mit „B2B verwalten“.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireAuthOrIntegrationKey, requireCsrf, requireManageB2B, requireViewB2B } from "../auth/auth";
import { restoreTenantContext } from "../lib/tenantContext";
import { uploadRateLimiter } from "../routes/routeHelpers";
import type { User } from "@shared/schema";
import { portalNewsContentSchema, portalNewsSettingsSchema } from "@shared/portalNews";
import { portalNewsRepo } from "./portalNewsRepo";
import {
  PortalNewsError,
  createNewsFromText,
  deleteNews,
  getPortalNewsSettings,
  ingestNewsMail,
  portalNewsPageInfo,
  portalNewsWorkflowConfig,
  renderPortalNewsPage,
  rewriteNews,
  savePortalNewsSettings,
  setNewsStatus,
  toDetail,
  toPost,
  updateNewsContent,
  writePortalNewsPage,
  type ServiceContext,
} from "./portalNewsService";
import { logger } from "../lib/logger";

const log = logger.child({ component: "b2b/portalNewsRoutes" });

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const mailUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function contextFor(req: Request): Promise<ServiceContext> {
  const tenantId = req.tenantId ?? null;
  const user = req.user as User | undefined;
  return { tenantId, settings: await getPortalNewsSettings(undefined, tenantId), userName: user?.username ?? null };
}

function handleError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof PortalNewsError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Ungültige Eingabe", details: error.flatten() });
    return;
  }
  log.error({ err: error }, fallback);
  res.status(500).json({ error: fallback });
}

const idParam = (req: Request) => String(req.params.id);

export function registerPortalNewsRoutes(app: Express): void {
  // ---------- Einstellungen ----------
  app.get("/api/b2b/news-settings", requireAuth, requireViewB2B, async (req, res) => {
    try {
      res.json({ settings: await getPortalNewsSettings(undefined, req.tenantId ?? null) });
    } catch (error) {
      handleError(res, error, "Einstellungen konnten nicht geladen werden");
    }
  });

  app.put("/api/b2b/news-settings", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      const parsed = portalNewsSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Ungültige Einstellungen", details: parsed.error.flatten() });
      }
      const settings = parsed.data;
      if (settings.mailbox && !SIMPLE_EMAIL_RE.test(settings.mailbox)) {
        return res.status(400).json({ error: "Ungültige Postfach-Adresse", code: "portal_news_mailbox_invalid" });
      }
      const before = await getPortalNewsSettings(undefined, req.tenantId ?? null);
      await savePortalNewsSettings(settings, req.tenantId ?? null);
      log.info({ event: "portal_news.settings_saved", enabled: settings.enabled, autoPublish: settings.autoPublish }, "Einstellungen Portal-Neuigkeiten gespeichert");
      // Neue Überschrift/Einleitung gleich auf die Seite, sofern es sie schon gibt
      let pageError: string | null = null;
      if ((before.pageTitle !== settings.pageTitle || before.pageIntro !== settings.pageIntro) && (await portalNewsRepo.list(req.tenantId ?? null, "published")).length) {
        await writePortalNewsPage({ ...(await contextFor(req)), settings }).catch((err: unknown) => {
          pageError = err instanceof Error ? err.message : String(err);
        });
      }
      res.json({ settings, pageError });
    } catch (error) {
      handleError(res, error, "Einstellungen konnten nicht gespeichert werden");
    }
  });

  // ---------- n8n ----------
  app.get("/api/b2b/news/n8n/config", requireAuthOrIntegrationKey, requireManageB2B, async (req, res) => {
    try {
      res.json(portalNewsWorkflowConfig((await contextFor(req)).settings));
    } catch (error) {
      handleError(res, error, "Konfiguration konnte nicht geladen werden");
    }
  });

  app.post(
    "/api/b2b/news/n8n/intake",
    requireAuthOrIntegrationKey,
    requireManageB2B,
    requireCsrf,
    uploadRateLimiter,
    mailUpload.single("file"),
    restoreTenantContext,
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "Keine Datei hochgeladen" });
        const ctx = await contextFor(req);
        const receivedRaw = typeof req.body?.received_at === "string" ? req.body.received_at : null;
        const intake = await ingestNewsMail(ctx, {
          buffer: req.file.buffer,
          graphMessageId: typeof req.body?.graph_message_id === "string" ? req.body.graph_message_id.slice(0, 500) : null,
          mailbox: typeof req.body?.mailbox === "string" ? req.body.mailbox.slice(0, 254) : ctx.settings.mailbox || null,
          subjectHint: typeof req.body?.subject === "string" ? req.body.subject.slice(0, 500) : null,
          receivedAt: receivedRaw ? new Date(receivedRaw) : null,
        });
        res.json({ intake });
      } catch (error) {
        handleError(res, error, "Neuigkeit konnte nicht verarbeitet werden");
      }
    },
  );

  // ---------- Beiträge ----------
  app.get("/api/b2b/news", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const rows = await portalNewsRepo.list(req.tenantId ?? null);
      res.json({ posts: rows.map(toPost) });
    } catch (error) {
      handleError(res, error, "Neuigkeiten konnten nicht geladen werden");
    }
  });

  app.get("/api/b2b/news/page", requireAuth, requireViewB2B, async (req, res) => {
    try {
      res.json({ page: await portalNewsPageInfo(await contextFor(req)) });
    } catch (error) {
      handleError(res, error, "Seitenstand konnte nicht geladen werden");
    }
  });

  /** HTML der Seite wie im Shop (veröffentlichte Beiträge); der Client zeigt es per iframe srcdoc */
  app.get("/api/b2b/news/page/preview", requireAuth, requireViewB2B, async (req, res) => {
    try {
      res.json(await renderPortalNewsPage(await contextFor(req)));
    } catch (error) {
      handleError(res, error, "Vorschau konnte nicht erstellt werden");
    }
  });

  app.post("/api/b2b/news/page/write", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      res.json(await writePortalNewsPage(await contextFor(req)));
    } catch (error) {
      handleError(res, error, "Seite konnte nicht geschrieben werden");
    }
  });

  app.post("/api/b2b/news/from-text", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      const body = z.object({ subject: z.string().trim().max(500).default(""), text: z.string().trim().min(20).max(100_000) }).parse(req.body);
      const row = await createNewsFromText(await contextFor(req), body);
      res.json({ post: toDetail(row) });
    } catch (error) {
      handleError(res, error, "Beitrag konnte nicht erstellt werden");
    }
  });

  app.get("/api/b2b/news/:id", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const row = await portalNewsRepo.get(req.tenantId ?? null, idParam(req));
      if (!row) return res.status(404).json({ error: "Beitrag nicht gefunden" });
      res.json({ post: toDetail(row) });
    } catch (error) {
      handleError(res, error, "Beitrag konnte nicht geladen werden");
    }
  });

  app.put("/api/b2b/news/:id", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      const content = portalNewsContentSchema.parse(req.body);
      const row = await updateNewsContent(await contextFor(req), idParam(req), content);
      res.json({ post: toDetail(row) });
    } catch (error) {
      handleError(res, error, "Beitrag konnte nicht gespeichert werden");
    }
  });

  app.post("/api/b2b/news/:id/status", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      const { status } = z.object({ status: z.enum(["published", "hidden"]) }).parse(req.body);
      const row = await setNewsStatus(await contextFor(req), idParam(req), status);
      res.json({ post: toDetail(row) });
    } catch (error) {
      handleError(res, error, "Status konnte nicht geändert werden");
    }
  });

  app.post("/api/b2b/news/:id/rewrite", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      const row = await rewriteNews(await contextFor(req), idParam(req));
      res.json({ post: toDetail(row) });
    } catch (error) {
      handleError(res, error, "Beitrag konnte nicht neu geschrieben werden");
    }
  });

  app.delete("/api/b2b/news/:id", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      await deleteNews(await contextFor(req), idParam(req));
      res.json({ success: true });
    } catch (error) {
      handleError(res, error, "Beitrag konnte nicht gelöscht werden");
    }
  });
}
