import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { createB2BAdminClient } from "./b2bSellersAdmin";
import { runWithTenantContext } from "../lib/tenantContext";
import { logger } from "../lib/logger";
import {
  processPortalPasswordRequest,
  rateLimitPortalPasswordAccount,
  rateLimitPortalPasswordIp,
} from "./portalPasswordRequest";

const log = logger.child({ component: "b2b/portalPasswordRequestRoutes" });

/** Mandant, dessen Shop die öffentliche Seite nutzt (Standard: „Live“). */
export const PORTAL_PASSWORD_TENANT_DEFAULT = "Live";

async function resolvePortalTenantId(): Promise<string | null> {
  const name = (process.env.B2B_PORTAL_PASSWORD_TENANT || PORTAL_PASSWORD_TENANT_DEFAULT).trim();
  const tenant = await storage.getTenantByName(name);
  return tenant?.id ?? null;
}

function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress || "unknown";
}

const requestSchema = z.object({
  customerNumber: z.string().trim().min(1).max(64),
  email: z.string().trim().email().max(255),
  // Honigtopf: für Menschen unsichtbares Feld, Bots füllen es aus.
  website: z.string().optional(),
});

type RequestResult = Awaited<ReturnType<typeof processPortalPasswordRequest>>;

async function runRequest(customerNumber: string, email: string): Promise<RequestResult | null> {
  const tenantId = await resolvePortalTenantId();
  return runWithTenantContext(tenantId, async () => {
    const settings = await storage.getShopwareSettings(tenantId);
    if (!settings) {
      log.error({ tenantId }, "[portal-password] Shopware-Einstellungen fehlen");
      return null;
    }
    const client = await createB2BAdminClient(settings);
    const result = await processPortalPasswordRequest({ client }, { customerNumber, email });
    const fields = {
      outcome: result.outcome,
      customerNumber,
      employeeId: result.employeeId,
      customerId: result.customerId,
      error: result.error,
    };
    if (result.outcome === "mail_failed" || result.outcome === "no_sales_channel") {
      log.error(fields, "[portal-password] Wiederherstellungsmail nicht ausgelöst");
    } else {
      log.info(fields, "[portal-password] Anforderung verarbeitet");
    }
    return result;
  });
}

export function registerPortalPasswordRequestRoutes(app: Express): void {
  // Öffentlich (ohne Anmeldung, ohne CSRF — /api/public/ ist in server/index.ts ausgenommen).
  // Die Antwort sagt, ob es zu Kundennummer + E-Mail einen Zugang gibt (Wunsch des Fachbereichs);
  // Ausprobieren bremsen die Grenzen je IP und je Zugang.
  app.post("/api/public/portal-password-request", async (req: Request, res: Response) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Bitte Kundennummer und eine gültige E-Mail-Adresse angeben." });
    }
    if (!rateLimitPortalPasswordIp(clientIp(req))) {
      return res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
    }

    const { customerNumber, email, website } = parsed.data;
    if (website) {
      log.warn({ customerNumber }, "[portal-password] Honigtopf ausgefüllt, ignoriert");
      return res.json({ success: true });
    }
    if (!rateLimitPortalPasswordAccount(customerNumber, email)) {
      log.info({ customerNumber }, "[portal-password] Zugang innerhalb der Sperrfrist erneut angefordert");
      return res
        .status(429)
        .json({ error: "Für diesen Zugang wurde gerade schon ein Link angefordert.", code: "already_requested" });
    }

    try {
      const result = await runRequest(customerNumber, email);
      switch (result?.outcome) {
        case "sent":
          return res.json({ success: true });
        case "customer_not_found":
        case "employee_not_found":
        case "not_linked":
        case "excluded":
          return res.status(404).json({
            error: "Zu dieser Kundennummer gibt es keinen Portalzugang mit dieser E-Mail-Adresse.",
            code: "not_found",
          });
        case "link_inactive":
          return res.status(403).json({ error: "Dieser Portalzugang ist deaktiviert.", code: "inactive" });
        default:
          return res.status(502).json({
            error: "Der Link konnte nicht versendet werden. Bitte später erneut versuchen.",
            code: "send_failed",
          });
      }
    } catch (err) {
      log.error({ err, customerNumber }, "[portal-password] Anforderung fehlgeschlagen");
      return res.status(502).json({
        error: "Der Link konnte nicht versendet werden. Bitte später erneut versuchen.",
        code: "send_failed",
      });
    }
  });
}
