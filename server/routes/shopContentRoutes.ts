// Shop-Inhalte (Branchenseiten, Startseiten-Abschnitte): Uebersicht, Detail, Vorschau, Uebernahme aus dem Code.
// Nur Administratoren. Schreibt nichts in den Shop (Veroeffentlichen folgt in einem eigenen Schritt).
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAdministrator, requireAuth } from "../auth/auth";
import { logger } from "../lib/logger";
import {
  ShopContentError,
  getShopContentDetail,
  importShopContentFromCode,
  listShopContent,
  renderShopContentPreview,
} from "../shopContent/shopContentService";

const moduleLog = logger.child({ component: "routes/shopContentRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;
const userOf = (req: Request) => {
  const user = (req as any).user;
  return { id: (user?.id as string | undefined) ?? null, name: (user?.username as string | undefined) ?? (user?.name as string | undefined) ?? null };
};

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof ShopContentError) {
    const status = error.code === "notFound" ? 404 : 400;
    return res.status(status).json({ error: error.message, code: error.code });
  }
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request" });
  moduleLog.error({ err: error }, `Shop-Inhalte: ${what} fehlgeschlagen`);
  res.status(500).json({ error: error instanceof Error ? error.message : "Shop content request failed" });
}

export function registerShopContentRoutes(app: Express): void {
  app.get("/api/shop-content", requireAuth, requireAdministrator, async (req, res) => {
    try {
      res.json({ items: await listShopContent(tenantOf(req)) });
    } catch (error) {
      fail(res, error, "Übersicht");
    }
  });

  app.get("/api/shop-content/:id", requireAuth, requireAdministrator, async (req, res) => {
    try {
      res.json(await getShopContentDetail(tenantOf(req), req.params.id));
    } catch (error) {
      fail(res, error, "Detail");
    }
  });

  /** HTML der Vorschau als JSON (der Client zeigt es per iframe srcdoc; X-Frame-Options verbietet eigene Seiten im Rahmen) */
  app.get("/api/shop-content/:id/preview", requireAuth, requireAdministrator, async (req, res) => {
    try {
      const q = z
        .object({ version: z.coerce.number().int().positive().optional(), notes: z.enum(["0", "1"]).optional() })
        .parse(req.query);
      res.json(await renderShopContentPreview(tenantOf(req), req.params.id, { versionNo: q.version, notes: q.notes !== "0" }));
    } catch (error) {
      fail(res, error, "Vorschau");
    }
  });

  app.post("/api/shop-content/import", requireAuth, requireAdministrator, async (req, res) => {
    try {
      res.json(await importShopContentFromCode(tenantOf(req), userOf(req)));
    } catch (error) {
      fail(res, error, "Übernahme aus dem Code");
    }
  });
}
