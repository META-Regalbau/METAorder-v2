import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { createB2BAdminClient } from "./b2bSellersAdmin";
import { getEmailOutboundSettings, sendEmail } from "../email/emailOutbound";
import { runWithTenantContext } from "../lib/tenantContext";
import { logger } from "../lib/logger";
import { webhookService } from "../lib/webhookService";
import {
  processPortalPasswordRequest,
  type PortalPasswordOutgoingMail,
  rateLimitPortalPasswordAccount,
  rateLimitPortalPasswordIp,
} from "./portalPasswordRequest";

const log = logger.child({ component: "b2b/portalPasswordRequestRoutes" });

/** Mandant, dessen Shop und Mailversand die öffentliche Seite nutzt (Standard: „Live“). */
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

const PORTAL_PASSWORD_WEBHOOK = "b2b.portal_password_requested" as const;

async function smtpReady(): Promise<boolean> {
  const { settings: mail } = await getEmailOutboundSettings(storage);
  return Boolean(mail.enabled && (mail.m365ConnectionId || (mail.host && mail.fromAddress)));
}

/**
 * Versandweg: bevorzugt der n8n-Webhook „Händlerportal: Passwort angefordert“ (n8n verschickt
 * über Outlook), sonst der Mailversand aus den E-Mail-Einstellungen des Mandanten.
 */
async function sendPortalPasswordMail(mail: PortalPasswordOutgoingMail): Promise<void> {
  if (await webhookService.isEnabled(PORTAL_PASSWORD_WEBHOOK)) {
    const result = await webhookService.deliver(PORTAL_PASSWORD_WEBHOOK, {
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      customerNumber: mail.customerNumber,
      employeeId: mail.employeeId,
      customerId: mail.customerId,
      requestedAt: new Date().toISOString(),
    });
    if (result !== "delivered") {
      throw new Error(`n8n-Webhook nicht zugestellt (${result}) — Details unter Webhook-Logs`);
    }
    return;
  }
  await sendEmail(storage, { to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
}

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
      {
        client,
        sendMail: sendPortalPasswordMail,
        mailReady: async () => (await webhookService.isEnabled(PORTAL_PASSWORD_WEBHOOK)) || (await smtpReady()),
      },
      { customerNumber, email },
    );
    const fields = {
      outcome: result.outcome,
      customerNumber,
      employeeId: result.employeeId,
      customerId: result.customerId,
      error: result.error,
    };
    if (result.outcome === "mail_disabled") {
      log.error(fields, "[portal-password] Mailversand nicht eingerichtet — Passwort NICHT geändert");
    } else if (result.outcome === "mail_failed") {
      log.error(fields, "[portal-password] Passwort gesetzt, Mail fehlgeschlagen");
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
