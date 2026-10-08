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

async function runRequest(customerNumber: string, email: string): Promise<void> {
  const tenantId = await resolvePortalTenantId();
  await runWithTenantContext(tenantId, async () => {
    const settings = await storage.getShopwareSettings(tenantId);
    if (!settings) {
      log.error({ tenantId }, "[portal-password] Shopware-Einstellungen fehlen");
      return;
    }
    const client = await createB2BAdminClient(settings);
    const result = await processPortalPasswordRequest(
      { client },
      { customerNumber, email },
    );
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
  });
}

export function registerPortalPasswordRequestRoutes(app: Express): void {
  // Öffentlich (ohne Anmeldung, ohne CSRF — /api/public/ ist in server/index.ts ausgenommen).
  app.post("/api/public/portal-password-request", async (req: Request, res: Response) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Bitte Kundennummer und eine gültige E-Mail-Adresse angeben." });
    }
    if (!rateLimitPortalPasswordIp(clientIp(req))) {
      return res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
    }

    const { customerNumber, email, website } = parsed.data;
    // Immer dieselbe Antwort, egal ob der Zugang existiert — die Verarbeitung läuft
    // danach im Hintergrund, damit auch die Antwortzeit nichts verrät.
    res.json({ success: true });

    if (website) {
      log.warn({ customerNumber }, "[portal-password] Honigtopf ausgefüllt, ignoriert");
      return;
    }
    if (!rateLimitPortalPasswordAccount(customerNumber, email)) {
      log.info({ customerNumber }, "[portal-password] Zugang innerhalb der Sperrfrist erneut angefordert, ignoriert");
      return;
    }
    runRequest(customerNumber, email).catch((err) => {
      log.error({ err, customerNumber }, "[portal-password] Anforderung fehlgeschlagen");
    });
  });
}
