// Kundenantworten aus dem E-Mail-Eingang (server/commercial/emailIntakeReplies.ts): Antwortentwurf eines
// Tickets lesen, neu erstellen und freigeben (sichtbar wie das Ticket selbst) sowie der Postausgang, den
// n8n abholt und quittiert (n8n-workflows/m365-customer-replies.json).
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireAuthOrIntegrationKey, requireCsrf, requireManageTickets, requireViewTickets } from "../auth/auth";
import { storage } from "../storage";
import { replyPlaceholders, type EmailIntakeReplyKind } from "@shared/emailIntake";
import type { EmailIntakeReplyRow } from "@shared/schema";
import {
  ReplySendError,
  ackReplyOutbox,
  claimReplyOutbox,
  getReplyByTicket,
  queueReply,
  regenerateReply,
} from "../commercial/emailIntakeReplies";
import { getEmailIntakeSettings } from "../commercial/emailIntakeSettings";
import { getSalesChannelFilter } from "./routeHelpers";
import { logger } from "../lib/logger";

const log = logger.child({ component: "routes/emailIntakeReplyRoutes" });

/** Wie GET /api/tickets/:id: Admins alles, sonst nur Ersteller oder Zuständiger (Ticket ohne Bestell-ID) */
async function loadAccessibleReply(req: Request, res: Response): Promise<EmailIntakeReplyRow | null> {
  const ticket = await storage.getTicket(req.params.ticketId);
  if (!ticket || (ticket.tenantId ?? null) !== (req.tenantId ?? null)) {
    res.status(404).json({ error: "Ticket not found" });
    return null;
  }
  const allowed = await getSalesChannelFilter(req);
  const userId = (req.user as { id?: string } | undefined)?.id;
  if (allowed !== null && ticket.createdByUserId !== userId && ticket.assignedToUserId !== userId) {
    res.status(403).json({ error: "You don't have access to this ticket" });
    return null;
  }
  const reply = await getReplyByTicket(ticket.id);
  if (!reply) {
    res.status(404).json({ error: "Kein Antwortentwurf zu diesem Ticket", code: "email_intake_reply_not_found" });
    return null;
  }
  return reply;
}

function toResponse(row: EmailIntakeReplyRow) {
  const facts = (row.facts ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    kind: row.kind as EmailIntakeReplyKind,
    status: row.status,
    mailbox: row.mailbox,
    customerEmail: row.customerEmail,
    subject: row.subject,
    draft: row.draft,
    draftError: row.draftError,
    sentText: row.sentText,
    attempts: row.attempts,
    placeholders: replyPlaceholders(row.draft ?? ""),
    order: facts.order ?? null,
    orderNumbers: Array.isArray(facts.orderNumbers) ? facts.orderNumbers : [],
    orderNote: typeof facts.orderNote === "string" ? facts.orderNote : null,
    offerDraftId: typeof facts.offerDraftId === "string" ? facts.offerDraftId : null,
    reason: typeof facts.reason === "string" ? facts.reason : null,
    sentAt: row.sentAt,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

export function registerEmailIntakeReplyRoutes(app: Express) {
  app.get("/api/tickets/:ticketId/reply-draft", requireAuth, requireViewTickets, async (req: Request, res: Response) => {
    try {
      const reply = await loadAccessibleReply(req, res);
      if (reply) res.json(toResponse(reply));
    } catch (error) {
      log.error({ err: error }, "Antwortentwurf nicht geladen");
      res.status(500).json({ error: "Antwortentwurf konnte nicht geladen werden" });
    }
  });

  app.post(
    "/api/tickets/:ticketId/reply-draft/regenerate",
    requireAuth,
    requireViewTickets,
    requireCsrf,
    async (req: Request, res: Response) => {
      try {
        const reply = await loadAccessibleReply(req, res);
        if (!reply) return;
        if (reply.status !== "draft") {
          return res.status(409).json({ error: "Die Antwort ist schon verschickt", code: "email_intake_reply_already_sent" });
        }
        const settings = await getEmailIntakeSettings(storage, req.tenantId ?? null);
        const updated = await regenerateReply(storage, reply, settings);
        res.json(toResponse(updated ?? reply));
      } catch (error) {
        log.error({ err: error }, "Antwortentwurf nicht neu erstellt");
        res.status(500).json({ error: "Antwortentwurf konnte nicht neu erstellt werden" });
      }
    },
  );

  // Freigeben & senden: öffentliche Antwort im Ticket, n8n verschickt aus dem Postfach der Mail
  app.post("/api/tickets/:ticketId/reply-draft/send", requireAuth, requireViewTickets, requireCsrf, async (req: Request, res: Response) => {
    try {
      const body = z.object({ text: z.string().max(20000) }).safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: "Ungültige Antwort", code: "email_intake_reply_invalid" });
      const reply = await loadAccessibleReply(req, res);
      if (!reply) return;
      const userId = (req.user as { id: string }).id;
      res.json(toResponse(await queueReply(storage, reply, { text: body.data.text, userId })));
    } catch (error) {
      if (error instanceof ReplySendError) return res.status(error.status).json({ error: error.message, code: error.code });
      log.error({ err: error }, "Antwort nicht freigegeben");
      res.status(500).json({ error: "Antwort konnte nicht freigegeben werden" });
    }
  });

  // ---------- n8n ----------
  app.get("/api/email-intake/replies/outbox", requireAuthOrIntegrationKey, requireManageTickets, async (req: Request, res: Response) => {
    try {
      res.json({ replies: await claimReplyOutbox(req.tenantId ?? null) });
    } catch (error) {
      log.error({ err: error }, "Postausgang Kundenantworten nicht geladen");
      res.status(500).json({ error: "Postausgang konnte nicht geladen werden" });
    }
  });

  app.post(
    "/api/email-intake/replies/outbox/:id/ack",
    requireAuthOrIntegrationKey,
    requireManageTickets,
    requireCsrf,
    async (req: Request, res: Response) => {
      try {
        const body = z
          .object({
            ok: z.boolean(),
            statusCode: z.number().int().optional().nullable(),
            error: z.string().max(4000).optional().nullable(),
            mode: z.enum(["reply", "new_mail"]).optional().nullable(),
          })
          .safeParse(req.body);
        if (!body.success) return res.status(400).json({ error: "Ungültige Rückmeldung", code: "email_intake_reply_ack_invalid" });
        const { ok, statusCode, error, mode } = body.data;
        const row = await ackReplyOutbox(storage, req.tenantId ?? null, req.params.id, {
          ok,
          mode: mode ?? null,
          error: error ?? (statusCode ? `HTTP ${statusCode}` : null),
        });
        if (!row) return res.status(404).json({ error: "Antwort nicht gefunden", code: "email_intake_reply_not_found" });
        res.json({ success: true, status: row.status });
      } catch (error) {
        log.error({ err: error }, "Rückmeldung Kundenantwort nicht gespeichert");
        res.status(500).json({ error: "Rückmeldung konnte nicht gespeichert werden" });
      }
    },
  );
}
