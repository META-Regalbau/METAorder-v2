// Meta-Title/-Description der Artikel im Shop: Einstellungen, letzter Lauf, Lauf starten.
import type { Express } from "express";
import { z } from "zod";
import { requireAuth, requireManageSettings } from "../auth/auth";
import { storage } from "../storage";
import {
  getProductMetaTextsSettings,
  getProductMetaTextsState,
  saveProductMetaTextsSettings,
} from "../products/productMetaTexts";
import { productMetaTextsProgress, runProductMetaTextsForTenant } from "../products/productMetaTextsJobs";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "routes/productMetaTextRoutes" });

export function registerProductMetaTextRoutes(app: Express): void {
  app.get("/api/settings/product-meta-texts", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const [settings, state] = await Promise.all([
        getProductMetaTextsSettings(storage, tenantId),
        getProductMetaTextsState(storage, tenantId),
      ]);
      const progress = productMetaTextsProgress(tenantId);
      res.json({ settings, lastRun: state.lastRun ?? null, running: progress !== null, progress });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading product meta text settings:");
      res.status(500).json({ error: error.message || "Failed to load product meta text settings" });
    }
  });

  app.put("/api/settings/product-meta-texts", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const body = z
        .object({
          enabled: z.boolean().optional(),
          hourLocal: z.number().int().min(0).max(23).optional(),
          maxPerRun: z.number().int().min(1).max(10000).optional(),
        })
        .parse(req.body ?? {});
      const settings = await saveProductMetaTextsSettings(storage, body, req.tenantId ?? null);
      res.json({ settings });
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid settings" });
      moduleLog.error({ err: error }, "Error saving product meta text settings:");
      res.status(500).json({ error: error.message || "Failed to save product meta text settings" });
    }
  });

  /** Startet einen Lauf im Hintergrund (Testlauf mit wenigen Artikeln oder Schreiben). */
  app.post("/api/settings/product-meta-texts/run", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const { apply } = z.object({ apply: z.boolean() }).parse(req.body ?? {});
      if (productMetaTextsProgress(tenantId)) {
        return res.status(409).json({ error: "Product meta text run already in progress" });
      }
      if (!(await storage.getShopwareSettings(tenantId))) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      void runProductMetaTextsForTenant(storage, tenantId, { dryRun: !apply, trigger: "manual" });
      res.status(202).json({ started: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request" });
      moduleLog.error({ err: error }, "Error starting product meta text run:");
      res.status(500).json({ error: error.message || "Failed to start product meta text run" });
    }
  });
}
