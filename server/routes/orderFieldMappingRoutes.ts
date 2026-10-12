import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireCsrf, requireManageSettings } from "../auth/auth";
import { storage } from "../storage";
import { ORDER_FIELD_SOURCES } from "@shared/orderFieldMapping";
import { getOrderFieldMapping, resolveDraftOrderFieldValues, saveOrderFieldMapping } from "../shopware/orderFieldMappingService";
import { logger } from "../lib/logger";

const log = logger.child({ component: "routes/orderFieldMappingRoutes" });

const targetSchema = z.object({ field: z.string().min(1).max(100), type: z.string().min(1).max(40) });
const bodySchema = z.object({
  enabled: z.boolean(),
  targets: z.object(Object.fromEntries(ORDER_FIELD_SOURCES.map((s) => [s, z.array(targetSchema).max(5)])) as Record<
    (typeof ORDER_FIELD_SOURCES)[number],
    z.ZodArray<typeof targetSchema>
  >),
});

/**
 * Übergabe von Entwurfsdaten in die Zusatzfelder der Shopware-Bestellung (Einstellungen).
 *   GET  /api/settings/order-field-mapping
 *   PUT  /api/settings/order-field-mapping
 *   GET  /api/settings/order-field-mapping/preview?draftId=…  (nur lesend: was ginge in die Bestellung)
 */
export function registerOrderFieldMappingRoutes(app: Express): void {
  app.get("/api/settings/order-field-mapping", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      res.json(await getOrderFieldMapping(storage, req.tenantId ?? null));
    } catch (error) {
      log.error({ err: error }, "Übergabe-Einstellung nicht gelesen");
      res.status(500).json({ error: "Einstellung für die Übergabe in die Bestellung konnte nicht gelesen werden" });
    }
  });

  app.put("/api/settings/order-field-mapping", requireAuth, requireManageSettings, requireCsrf, async (req: Request, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Ungültige Einstellung für die Übergabe in die Bestellung" });
    try {
      res.json(await saveOrderFieldMapping(storage, parsed.data, req.tenantId ?? null));
    } catch (error) {
      log.error({ err: error }, "Übergabe-Einstellung nicht gespeichert");
      res.status(500).json({ error: "Einstellung für die Übergabe in die Bestellung konnte nicht gespeichert werden" });
    }
  });

  app.get("/api/settings/order-field-mapping/preview", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    const draftId = typeof req.query.draftId === "string" ? req.query.draftId.trim() : "";
    if (!/^[\w-]{8,64}$/.test(draftId)) return res.status(400).json({ error: "Entwurf fehlt oder ist ungültig" });
    try {
      const tenantId = req.tenantId ?? null;
      const draft = await storage.getOrderDraft(draftId, tenantId);
      if (!draft) return res.status(404).json({ error: "Order draft not found" });
      if (!draft.shopwareCustomerId) return res.status(400).json({ error: "Entwurf hat keinen Shopware-Kunden" });
      const shopwareSettings = await storage.getShopwareSettings(tenantId);
      if (!shopwareSettings) return res.status(400).json({ error: "Shopware ist nicht eingerichtet" });
      const result = await resolveDraftOrderFieldValues({
        mapping: await getOrderFieldMapping(storage, tenantId),
        shopwareSettings,
        customerId: draft.shopwareCustomerId,
        draft,
      });
      res.json({
        order: result.order,
        lineItems: Object.fromEntries(result.lineItems),
        delivery: result.delivery,
        applied: result.applied,
        people: result.people,
      });
    } catch (error) {
      log.error({ err: error }, "Vorschau der Übergabe fehlgeschlagen");
      res.status(500).json({ error: "Vorschau der Übergabe in die Bestellung fehlgeschlagen" });
    }
  });
}
