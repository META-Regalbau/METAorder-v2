// Bildtexte (ALT/TITLE) der Produktbilder im Shop: Einstellungen, letzter Lauf, Lauf starten.
import type { Express } from "express";
import { z } from "zod";
import { requireAuth, requireManageSettings } from "../auth/auth";
import { storage } from "../storage";
import {
  getProductImageTextsSettings,
  getProductImageTextsState,
  saveProductImageTextsSettings,
} from "../products/productImageTexts";
import { isProductImageTextsRunning, runProductImageTextsForTenant } from "../products/productImageTextsJobs";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "routes/productImageTextRoutes" });

export function registerProductImageTextRoutes(app: Express): void {
  app.get("/api/settings/product-image-texts", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const [settings, state] = await Promise.all([
        getProductImageTextsSettings(storage, tenantId),
        getProductImageTextsState(storage, tenantId),
      ]);
      res.json({ settings, lastRun: state.lastRun ?? null, running: isProductImageTextsRunning(tenantId) });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading product image text settings:");
      res.status(500).json({ error: error.message || "Failed to load product image text settings" });
    }
  });

  app.put("/api/settings/product-image-texts", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const body = z
        .object({ enabled: z.boolean().optional(), hourLocal: z.number().int().min(0).max(23).optional() })
        .parse(req.body ?? {});
      const settings = await saveProductImageTextsSettings(storage, body, req.tenantId ?? null);
      res.json({ settings });
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid settings" });
      moduleLog.error({ err: error }, "Error saving product image text settings:");
      res.status(500).json({ error: error.message || "Failed to save product image text settings" });
    }
  });

  /** Startet einen Lauf im Hintergrund (Test oder Schreiben); Ergebnis per GET abholen. */
  app.post("/api/settings/product-image-texts/run", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const { apply } = z.object({ apply: z.boolean() }).parse(req.body ?? {});
      if (isProductImageTextsRunning(tenantId)) {
        return res.status(409).json({ error: "Product image text run already in progress" });
      }
      if (!(await storage.getShopwareSettings(tenantId))) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      void runProductImageTextsForTenant(storage, tenantId, { dryRun: !apply, trigger: "manual" });
      res.status(202).json({ started: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request" });
      moduleLog.error({ err: error }, "Error starting product image text run:");
      res.status(500).json({ error: error.message || "Failed to start product image text run" });
    }
  });
}
