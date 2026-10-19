// Shop-Puls Stufe 3 (S3-5), Ladezeit (nur Administratoren): PageSpeed-Einstellungen (Schalter, API-Schlüssel
// verschlüsselt, Pfade je Seitentyp) und die Messungen der letzten Tage. Der Schlüssel wird nie zurückgegeben.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAdministrator, requireAuth, requireCsrf } from "../auth/auth";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { PAGE_SPEED_TYPES, type ShopPulseSpeedOverview } from "@shared/shopPulse";
import { getPageSpeedSettings, savePageSpeedSettings, speedSetupProblem } from "../shopPulse/pageSpeed";
import { speedSources } from "../shopPulse/shopPulseScheduler";

const moduleLog = logger.child({ component: "routes/shopPulseSpeedRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;
const DAYS_SHOWN = 14;

const pathSchema = z.string().trim().max(500).refine((v) => v === "" || (v.startsWith("/") && !/\s/.test(v)), "Pfad mit / am Anfang");
const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().trim().max(200).optional(),
    paths: z.object(Object.fromEntries(PAGE_SPEED_TYPES.map((t) => [t, pathSchema.optional()])) as Record<(typeof PAGE_SPEED_TYPES)[number], z.ZodOptional<typeof pathSchema>>).strict().optional(),
  })
  .strict();

async function overview(tenantId: string | null): Promise<ShopPulseSpeedOverview> {
  const settings = await getPageSpeedSettings(storage, tenantId);
  const history = await speedSources(storage, tenantId).history();
  return {
    enabled: settings.enabled,
    hasKey: !!settings.apiKey,
    problem: speedSetupProblem(settings),
    paths: settings.paths,
    days: [...history.days]
      .reverse()
      .slice(0, DAYS_SHOWN)
      .map((d) => ({
        day: d.day,
        at: d.at,
        results: d.results.map((r) => ({
          type: r.type,
          url: r.url,
          score: r.score,
          lcpMs: r.lcpMs,
          cls: r.cls,
          tbtMs: r.tbtMs,
          field: r.field ? { source: r.field.source, lcpMs: r.field.lcpMs, inpMs: r.field.inpMs, cls: r.field.cls } : null,
          ...(r.error ? { error: r.error } : {}),
        })),
      })),
  };
}

export function registerShopPulseSpeedRoutes(app: Express): void {
  app.get("/api/shop-pulse/speed", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      res.json(await overview(tenantOf(req)));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Ladezeit laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load page speed" });
    }
  });

  /** Schalter, Schlüssel ("" = löschen, weglassen = behalten), Pfade je Seitentyp */
  app.put("/api/shop-pulse/speed/settings", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid page speed settings" });
    try {
      const tenantId = tenantOf(req);
      await savePageSpeedSettings(storage, tenantId, parsed.data);
      moduleLog.info({ tenantId, enabled: parsed.data.enabled, key: parsed.data.apiKey === undefined ? "unchanged" : parsed.data.apiKey ? "set" : "removed" }, "Shop-Puls: PageSpeed-Einstellungen gespeichert");
      res.json(await overview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: PageSpeed-Einstellungen speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to save page speed settings" });
    }
  });
}
