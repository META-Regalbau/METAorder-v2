// Shop-Puls Stufe 3 (S3-6), Google Merchant Center (nur Administratoren, nur lesend gegenüber Google):
// Einstellungen (Schalter, Händler-ID, Dienstkonto-JSON verschlüsselt). Das JSON wird nie zurückgegeben.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAdministrator, requireAuth, requireCsrf } from "../auth/auth";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import type { ShopPulseMerchantOverview } from "@shared/shopPulse";
import { checkMerchantSetup, getMerchantSettings, saveMerchantSettings } from "../shopPulse/merchantClient";

const moduleLog = logger.child({ component: "routes/shopPulseMerchantRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;

const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    merchantId: z.string().trim().max(30).optional(),
    serviceAccountJson: z.string().max(20_000).optional(),
  })
  .strict();

async function overview(tenantId: string | null): Promise<ShopPulseMerchantOverview> {
  const settings = await getMerchantSettings(storage, tenantId);
  const setup = checkMerchantSetup(settings);
  let email: string | null = null;
  try {
    email = settings.serviceAccountJson ? String(JSON.parse(settings.serviceAccountJson)?.client_email ?? "") || null : null;
  } catch {
    email = null;
  }
  return { enabled: settings.enabled, merchantId: settings.merchantId, hasServiceAccount: !!settings.serviceAccountJson, serviceAccountEmail: email, problem: setup.ok ? null : setup.reason };
}

export function registerShopPulseMerchantRoutes(app: Express): void {
  app.get("/api/shop-pulse/merchant-center", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      res.json(await overview(tenantOf(req)));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Merchant Center laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load Merchant Center settings" });
    }
  });

  /** Schalter, Händler-ID, Dienstkonto ("" = löschen, weglassen = behalten) */
  app.put("/api/shop-pulse/merchant-center/settings", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Merchant Center settings" });
    try {
      const tenantId = tenantOf(req);
      await saveMerchantSettings(storage, tenantId, parsed.data);
      moduleLog.info(
        { tenantId, enabled: parsed.data.enabled, merchantId: parsed.data.merchantId, serviceAccount: parsed.data.serviceAccountJson === undefined ? "unchanged" : parsed.data.serviceAccountJson ? "set" : "removed" },
        "Shop-Puls: Merchant-Center-Einstellungen gespeichert",
      );
      res.json(await overview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Merchant-Center-Einstellungen speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to save Merchant Center settings" });
    }
  });
}
