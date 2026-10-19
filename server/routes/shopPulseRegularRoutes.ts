// Shop-Puls Stufe 3 (S3-4), Stammkunden-Wache (nur Administratoren): Übersicht der Stammkunden mit Stand,
// Schwellen einstellen, überfälligen Kunden jetzt melden (auch Altbestand; 90-Tage-Regel gilt weiter).
import type { Express, Request, Response } from "express";
import { requireAdministrator, requireAuth, requireCsrf } from "../auth/auth";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { shopPulseRegularSettingsSchema, type ShopPulseRegularsOverview } from "@shared/shopPulseRegulars";
import { regularDeps } from "../shopPulse/shopPulseScheduler";
import { alertRegularNow, getRegularSettings, getRegularState, loadRegularsContext, REGULAR_SETTINGS_KEY, RegularError, toCustomer } from "../shopPulse/regularsRun";

const moduleLog = logger.child({ component: "routes/shopPulseRegularRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;

async function overview(tenantId: string | null): Promise<ShopPulseRegularsOverview> {
  const deps = regularDeps(storage);
  const [ctx, state] = await Promise.all([loadRegularsContext(deps, tenantId, new Date()), getRegularState(storage, tenantId)]);
  return { settings: ctx.settings, customers: ctx.analyses.map((a) => toCustomer(a, ctx)), lastRunAt: state.lastRunAt ?? null };
}

export function registerShopPulseRegularRoutes(app: Express): void {
  app.get("/api/shop-pulse/regulars", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      res.json(await overview(tenantOf(req)));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Stammkunden laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load regular customers" });
    }
  });

  /** Schwellen und Schalter (Teil-Update) */
  app.put("/api/shop-pulse/regulars/settings", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = shopPulseRegularSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid regular customer settings" });
    try {
      const tenantId = tenantOf(req);
      const next = { ...(await getRegularSettings(storage, tenantId)), ...parsed.data };
      await storage.saveSetting(REGULAR_SETTINGS_KEY, next, tenantId);
      moduleLog.info({ tenantId, ...next }, "Shop-Puls: Stammkunden-Einstellungen gespeichert");
      res.json(await overview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error }, "Shop-Puls: Stammkunden-Einstellungen speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to save regular customer settings" });
    }
  });

  /** Überfälligen Kunden jetzt an den Außendienst bzw. Oliver melden */
  app.post("/api/shop-pulse/regulars/:customerNumber/alert", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const by = String((req as any).user?.username ?? "admin").slice(0, 120);
      await alertRegularNow(regularDeps(storage), tenantId, String(req.params.customerNumber), by);
      res.json(await overview(tenantId));
    } catch (error) {
      if (error instanceof RegularError) {
        if (error.reason === "notFound") return res.status(404).json({ error: "Regular customer not found" });
        if (error.reason === "notOverdue") return res.status(409).json({ error: "Customer is not overdue" });
        return res.status(409).json({ error: "Customer was already reported in the last 90 days" });
      }
      moduleLog.error({ err: error }, "Shop-Puls: Stammkunde melden fehlgeschlagen");
      res.status(500).json({ error: "Failed to report regular customer" });
    }
  });
}
