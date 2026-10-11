import type { Express, Request, Response } from "express";
import { requireAdministrator, requireAuth } from "../auth/auth";
import { storage } from "../storage";
import { ShopwareClient } from "../shopware/shopware";
import { buildPricingDiagnostics } from "../crm/pricingDiagnostics";
import { logger } from "../lib/logger";

const log = logger.child({ component: "routes/pricingDiagnosticsRoutes" });

/**
 * Preis-Diagnose je Händler (nur lesend, nur Admins): Händlerrabatt, Zusatzrabatt-Staffel,
 * Rabattregeln, Lieferbedingungs-Tags mit Versandkosten-Staffeln, Mindermengenzuschlag und je
 * Artikel Katalog-, erweiterte und Kundenpreise neben dem, was METAorder rechnet.
 *   GET /api/crm/pricing-diagnostics?customerNumber=20000014257&products=4026212182811,4026212182873
 */
export function registerPricingDiagnosticsRoutes(app: Express): void {
  app.get("/api/crm/pricing-diagnostics", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      const customerNumber = typeof req.query.customerNumber === "string" ? req.query.customerNumber.trim() : "";
      if (!/^[\w.-]{2,40}$/.test(customerNumber)) {
        return res.status(400).json({ error: "Kundennummer fehlt oder ist ungültig" });
      }
      const productNumbers = (typeof req.query.products === "string" ? req.query.products : "")
        .split(",")
        .map((p) => p.trim())
        .filter((p) => /^[\w.-]{2,40}$/.test(p))
        .slice(0, 30);
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) return res.status(400).json({ error: "Shopware ist nicht eingerichtet" });
      res.json(await buildPricingDiagnostics(new ShopwareClient(settings), { customerNumber, productNumbers }));
    } catch (error) {
      log.error({ err: error }, "Preis-Diagnose fehlgeschlagen");
      res.status(500).json({ error: "Preis-Diagnose fehlgeschlagen" });
    }
  });
}
