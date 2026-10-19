// Kundenantworten aus dem E-Mail-Eingang: Antwortentwurf eines Tickets lesen und neu erstellen
// (server/commercial/emailIntakeReplies.ts). Sichtbar wie das Ticket selbst.
import type { Express, Request, Response } from "express";
import { requireAuth, requireCsrf, requireViewTickets } from "../auth/auth";
import { storage } from "../storage";
import { replyPlaceholders, type EmailIntakeReplyKind } from "@shared/emailIntake";
import type { EmailIntakeReplyRow } from "@shared/schema";
import { getReplyByTicket, regenerateReply } from "../commercial/emailIntakeReplies";
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
}
