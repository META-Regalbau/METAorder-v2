// E-Mail-Eingang über n8n: Einstellungen (Oberfläche), Konfiguration für den Workflow und
// Problem-Meldungen aus n8n (z. B. METAorder war nicht erreichbar oder Graph lieferte die Mail nicht).
import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  requireAuthOrIntegrationKey,
  requireCsrf,
  requireManageCommercialDraftUpload,
  requireManageSettings,
} from "../auth/auth";
import { storage } from "../storage";
import { getCommercialAgentSettings } from "../ai/aiConfig";
import {
  EMAIL_INTAKE_CATEGORIES,
  emailIntakeSettingsSchema,
  isValidIntakeEmail,
  type EmailIntakeResponse,
} from "@shared/emailIntake";
import { getEmailIntakeSettings, saveEmailIntakeSettings, workflowConfigFromSettings } from "../commercial/emailIntakeSettings";
import { createIntakeProblemTicket } from "../commercial/emailIntakeTickets";
import { unwrapInternalForward } from "../email/emailForwardUnwrap";
import { logger } from "../lib/logger";

const log = logger.child({ component: "routes/emailIntakeRoutes" });

function hasPermission(user: unknown, permission: string): boolean {
  const permissions = (user as { roleDetails?: { permissions?: unknown } } | undefined)?.roleDetails?.permissions;
  if (Array.isArray(permissions)) return permissions.includes(permission);
  return Boolean(permissions && (permissions as Record<string, unknown>)[permission]);
}

/** Kann der aufrufende (n8n-)Benutzer Mails verarbeiten? Sonst holt der Workflow nichts ab. */
async function readiness(user: unknown): Promise<{ ready: boolean; notReadyReason: string | null }> {
  const agent = await getCommercialAgentSettings(storage);
  if (!agent.enabled) return { ready: false, notReadyReason: "Die Entwurfs-Automatik (Commercial Agent) ist ausgeschaltet." };
  if (!hasPermission(user, "manageOrderDrafts") || !hasPermission(user, "manageOffers")) {
    return { ready: false, notReadyReason: "Der n8n-Benutzer braucht die Rechte Bestellentwürfe UND Angebote verwalten." };
  }
  return { ready: true, notReadyReason: null };
}

const problemSchema = z.object({
  /** Internet-Message-ID der Mail („<…@…>“), dieselbe Kennung wie beim Upload */
  internetMessageId: z.string().trim().max(998).optional().nullable(),
  /** Graph-ID, falls die Message-ID fehlt */
  graphMessageId: z.string().trim().max(512).optional().nullable(),
  subject: z.string().max(1000).optional().nullable(),
  fromName: z.string().max(300).optional().nullable(),
  fromAddress: z.string().max(320).optional().nullable(),
  toAddresses: z.array(z.string().max(320)).max(100).optional(),
  ccAddresses: z.array(z.string().max(320)).max(100).optional(),
  /** Schritt in n8n, z. B. mime (Mail holen) oder upload (an METAorder senden) */
  stage: z.string().trim().max(60),
  statusCode: z.number().int().optional().nullable(),
  error: z.string().max(4000).optional().nullable(),
});

export function registerEmailIntakeRoutes(app: Express): void {
  app.get("/api/settings/email-intake", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId ?? null;
      const [settings, users] = await Promise.all([
        getEmailIntakeSettings(storage, tenantId),
        storage.getUsersWithPermissionInTenant("viewTickets", tenantId, { includeAdministrators: true }),
      ]);
      res.json({
        settings,
        assignableUsers: users.map((u) => ({ id: u.id, username: u.username, email: u.email })).sort((a, b) => a.username.localeCompare(b.username)),
        categories: EMAIL_INTAKE_CATEGORIES,
      });
    } catch (error) {
      log.error({ err: error }, "E-Mail-Eingang: Einstellungen nicht geladen");
      res.status(500).json({ error: "Einstellungen konnten nicht geladen werden" });
    }
  });

  app.put("/api/settings/email-intake", requireAuth, requireManageSettings, requireCsrf, async (req: Request, res: Response) => {
    try {
      const parsed = emailIntakeSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Ungültige Einstellungen", details: parsed.error.flatten() });
      }
      const settings = parsed.data;
      if (settings.forwardOtherTo && !isValidIntakeEmail(settings.forwardOtherTo)) {
        return res.status(400).json({ error: "Ungültige Weiterleitungsadresse", code: "email_intake_forward_invalid" });
      }
      if (settings.mailbox && !isValidIntakeEmail(settings.mailbox)) {
        return res.status(400).json({ error: "Ungültige Postfach-Adresse", code: "email_intake_mailbox_invalid" });
      }
      const tenantId = req.tenantId ?? null;
      if (settings.defaultAssigneeUserId) {
        const users = await storage.getUsersWithPermissionInTenant("viewTickets", tenantId, { includeAdministrators: true });
        if (!users.some((u) => u.id === settings.defaultAssigneeUserId)) {
          return res.status(400).json({ error: "Der Standard-Bearbeiter darf keine Tickets sehen", code: "email_intake_assignee_invalid" });
        }
      }
      await saveEmailIntakeSettings(storage, settings, tenantId);
      res.json({ settings });
    } catch (error) {
      log.error({ err: error }, "E-Mail-Eingang: Einstellungen nicht gespeichert");
      res.status(500).json({ error: "Einstellungen konnten nicht gespeichert werden" });
    }
  });

  // n8n fragt das zu Beginn jedes Laufs ab: an/aus, Postfach, Zielordner, Menge
  app.get(
    "/api/email-intake/config",
    requireAuthOrIntegrationKey,
    requireManageCommercialDraftUpload,
    async (req: Request, res: Response) => {
      try {
        const settings = await getEmailIntakeSettings(storage, req.tenantId ?? null);
        const ready = await readiness(req.user);
        res.json({ ...workflowConfigFromSettings(settings), ...ready, categories: EMAIL_INTAKE_CATEGORIES });
      } catch (error) {
        log.error({ err: error }, "E-Mail-Eingang: Konfiguration nicht geladen");
        res.status(500).json({ error: "Konfiguration konnte nicht geladen werden" });
      }
    },
  );

  // n8n meldet einen Fehler, den METAorder nicht selbst gesehen hat → Ticket (einmal je Mail)
  app.post(
    "/api/email-intake/problem",
    requireAuthOrIntegrationKey,
    requireManageCommercialDraftUpload,
    requireCsrf,
    async (req: Request, res: Response) => {
      try {
        const parsed = problemSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Ungültige Problem-Meldung", details: parsed.error.flatten() });
        }
        const body = parsed.data;
        const rawId = (body.internetMessageId ?? "").replace(/^<|>$/g, "").trim();
        if (!rawId && !body.graphMessageId) {
          return res.status(400).json({ error: "internetMessageId oder graphMessageId fehlt" });
        }
        // Gleiche Kennung wie deriveUploadMessageId beim Upload → kein zweites Ticket für dieselbe Mail
        const messageId = rawId ? `mail:${rawId}` : `graph:${body.graphMessageId}`;
        const tenantId = req.tenantId ?? null;
        const settings = await getEmailIntakeSettings(storage, tenantId);
        const user = req.user as { id: string; email?: string | null };

        const headerFrom = body.fromAddress
          ? body.fromName ? `${body.fromName} <${body.fromAddress}>` : body.fromAddress
          : body.fromName ?? "";
        const unwrapped = unwrapInternalForward({ from: headerFrom, subject: body.subject ?? "", body: "" });
        const error = [body.statusCode ? `HTTP ${body.statusCode}` : null, body.error?.trim() || null].filter(Boolean).join(": ");

        const ticket = settings.ticketOnFailure
          ? await createIntakeProblemTicket(storage, {
              tenantId,
              integrationUserId: user.id,
              excludeEmails: [settings.mailbox, user.email ?? ""].filter(Boolean),
              defaultAssigneeUserId: settings.defaultAssigneeUserId,
              problem: {
                reason: "processing_failed",
                messageId,
                subject: unwrapped.subject,
                envelope: {
                  headerFrom,
                  customerFrom: unwrapped.from,
                  customerEmail: unwrapped.fromEmail,
                  toAddresses: (body.toAddresses ?? []).map((a) => a.toLowerCase()),
                  ccAddresses: (body.ccAddresses ?? []).map((a) => a.toLowerCase()),
                },
                error: error || "Unbekannter Fehler in n8n",
                stage: `n8n: ${body.stage}`,
              },
            })
          : null;
        const intake: EmailIntakeResponse = {
          outcome: "failed",
          categories: [EMAIL_INTAKE_CATEGORIES.failed, ...(ticket ? [EMAIL_INTAKE_CATEGORIES.ticket] : [])],
          forward: null,
          // Mit Ticket kümmert sich jemand → verschieben; ohne Ticket bleibt die Mail für den nächsten Versuch liegen
          move: Boolean(ticket),
          tickets: ticket ? [ticket] : [],
          other: null,
        };
        res.json({ intake });
      } catch (error) {
        log.error({ err: error }, "E-Mail-Eingang: Problem-Meldung nicht verarbeitet");
        res.status(500).json({ error: "Problem-Meldung konnte nicht verarbeitet werden" });
      }
    },
  );
}
