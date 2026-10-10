/**
 * Problem-Tickets aus dem E-Mail-Eingang (n8n). Ein Ticket je Mail, Grund und Entwurf: n8n darf
 * dieselbe Mail erneut schicken (Wiederholung nach Fehler), ohne dass ein zweites Ticket entsteht.
 *
 * Gründe (Entscheidung 10.10.2026): Verarbeitung gescheitert, Shopware-Anlage gescheitert,
 * DB rot / Freigabe nötig. Ein normaler Entwurf zur Prüfung bekommt kein Ticket.
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import type { IStorage } from "../storage";
import type { InsertTicket, TicketCategory, TicketPriority } from "@shared/schema";
import type { EmailIntakeProblemReason, EmailIntakeTicketRef } from "@shared/emailIntake";
import { resolveIntakeAssignee, type IntakeAssigneeSource } from "./emailIntakeAssignee";
import { isOwnOperatorEmail } from "./draftCustomerEmailResolution";
import type { IngestMailEnvelope } from "./commercialEmailUploadIngest";
import { notificationEvents } from "../lib/events";
import { objectStorageService } from "../lib/objectStorage";
import { getUploadsRoot } from "../uploadsRoot";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/emailIntakeTickets" });

export const EMAIL_INTAKE_TICKET_TAG = "email-intake";

export type IntakeProblem = {
  reason: EmailIntakeProblemReason;
  /** Kennung der Mail (Message-ID aus dem Kopf oder Inhalts-Hash) */
  messageId: string;
  subject: string;
  envelope: Pick<IngestMailEnvelope, "headerFrom" | "customerFrom" | "customerEmail" | "toAddresses" | "ccAddresses">;
  draft?: { kind: "order" | "offer"; id: string; fileName?: string | null; shopwareCustomerId?: string | null } | null;
  /** Fehlertext (Verarbeitung/Shopware) */
  error?: string | null;
  /** Wo es scheiterte (n8n meldet z. B. „mime“ oder „upload“) */
  stage?: string | null;
  /** Originalmail als Anhang (nur wenn kein Entwurf sie schon hat) */
  rawEmail?: { buffer: Buffer; fileName: string } | null;
};

/** Stabiler Schlüssel je Mail/Grund/Entwurf; steht als Tag am Ticket. */
export function intakeProblemKey(problem: Pick<IntakeProblem, "reason" | "messageId" | "draft">): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${problem.messageId}\0${problem.reason}\0${problem.draft?.id ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return `intake:${hash}`;
}

export function draftLink(kind: "order" | "offer", draftId: string): string {
  return kind === "order" ? `/order-drafts?draftId=${draftId}` : `/offers?draftId=${draftId}`;
}

const REASON_TITLES: Record<EmailIntakeProblemReason, string> = {
  processing_failed: "E-Mail konnte nicht verarbeitet werden",
  shopware_failed: "Automatische Anlage in Shopware fehlgeschlagen",
  margin_red: "DB zu niedrig – Freigabe nötig",
};

const REASON_HINTS: Record<EmailIntakeProblemReason, string> = {
  processing_failed:
    "Aus der Mail ist kein Entwurf entstanden. Bitte die Mail (Anhang) prüfen und den Vorgang von Hand anlegen oder die Mail erneut hochladen.",
  shopware_failed:
    "Der Entwurf erfüllte alle Bedingungen der Automatik, Shopware hat die Anlage aber abgelehnt. Bitte den Entwurf öffnen, den Fehler beheben und neu anlegen.",
  margin_red:
    "Die DB-Ampel des Entwurfs ist rot, die Automatik hat gestoppt. Bitte den Entwurf prüfen und bei Bedarf mit Begründung eine Freigabe anfordern.",
};

const REASON_CATEGORY: Record<EmailIntakeProblemReason, TicketCategory> = {
  processing_failed: "technical_support",
  shopware_failed: "order_issue",
  margin_red: "order_issue",
};

const REASON_PRIORITY: Record<EmailIntakeProblemReason, TicketPriority> = {
  processing_failed: "high",
  shopware_failed: "high",
  margin_red: "normal",
};

const ASSIGNEE_SOURCE_TEXT: Record<IntakeAssigneeSource, string> = {
  involved_colleague: "an der Mail beteiligt (Weiterleitung oder An/CC)",
  customer_drafts: "hat zuletzt einen Entwurf dieses Kunden angelegt",
  customer_tickets: "hatte zuletzt ein Ticket zu dieser Kunden-Mail",
  default: "Standard-Bearbeiter aus den Einstellungen",
  none: "niemand gefunden",
};

/** Ticket-Inhalt (rein, testbar). */
export function buildIntakeTicket(
  problem: IntakeProblem,
  assignee: { id: string; username: string } | null,
  assigneeSource: IntakeAssigneeSource,
): Pick<InsertTicket, "title" | "description" | "priority" | "category" | "tags" | "customerEmail" | "customerName" | "emailSubject" | "emailFrom"> {
  const subject = problem.subject.trim() || "(ohne Betreff)";
  const lines = [
    REASON_HINTS[problem.reason],
    "",
    `Betreff: ${subject}`,
    `Absender: ${problem.envelope.customerFrom || problem.envelope.headerFrom || "unbekannt"}`,
  ];
  if (problem.envelope.customerFrom && problem.envelope.headerFrom && problem.envelope.customerFrom !== problem.envelope.headerFrom) {
    lines.push(`Weitergeleitet von: ${problem.envelope.headerFrom}`);
  }
  if (problem.draft) {
    lines.push(`Entwurf: ${draftLink(problem.draft.kind, problem.draft.id)}`);
  }
  if (problem.stage) lines.push(`Schritt: ${problem.stage}`);
  if (problem.error) lines.push(`Fehler: ${problem.error.slice(0, 800)}`);
  lines.push(`Zuständig: ${assignee ? `${assignee.username} (${ASSIGNEE_SOURCE_TEXT[assigneeSource]})` : ASSIGNEE_SOURCE_TEXT.none}`);
  lines.push(`Mail-Kennung: ${problem.messageId}`);

  // Interne Adresse (Weiterleitung ohne erkennbare Kundenmail) ist kein Kunde
  const customerEmail =
    problem.envelope.customerEmail && !isOwnOperatorEmail(problem.envelope.customerEmail) ? problem.envelope.customerEmail : null;
  const customerName = customerEmail
    ? (problem.envelope.customerFrom || "").replace(/<[^>]*>/g, "").replace(/"/g, "").trim()
    : "";
  return {
    title: `${REASON_TITLES[problem.reason]}: ${subject}`.slice(0, 200),
    description: lines.join("\n"),
    priority: REASON_PRIORITY[problem.reason],
    category: REASON_CATEGORY[problem.reason],
    tags: [EMAIL_INTAKE_TICKET_TAG, intakeProblemKey(problem)],
    customerEmail,
    customerName: customerName && customerName !== customerEmail ? customerName : null,
    emailSubject: subject.slice(0, 500),
    emailFrom: (problem.envelope.customerFrom || problem.envelope.headerFrom || "").slice(0, 300) || null,
  };
}

async function attachRawEmail(
  storage: IStorage,
  ticketId: string,
  tenantId: string | null,
  uploadedByUserId: string,
  raw: { buffer: Buffer; fileName: string },
): Promise<void> {
  const fileName = raw.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "mail.eml";
  let filePath: string;
  if (objectStorageService.isConfigured()) {
    const result = await objectStorageService.uploadFromBuffer(raw.buffer, fileName, "message/rfc822");
    filePath = `obj:${result.objectKey}`;
  } else {
    const dir = path.join(getUploadsRoot(), "ticket-attachments");
    await fs.mkdir(dir, { recursive: true });
    filePath = path.join(dir, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${fileName}`);
    await fs.writeFile(filePath, raw.buffer);
  }
  await storage.createTicketAttachment(
    { ticketId, fileName, fileSize: raw.buffer.length, mimeType: "message/rfc822", filePath, uploadedByUserId },
    tenantId,
  );
}

/**
 * Legt das Ticket an (oder findet das vorhandene) und benachrichtigt den Zuständigen.
 * Fehler hier dürfen die Mail-Verarbeitung nicht kippen: dann null.
 */
export async function createIntakeProblemTicket(
  storage: IStorage,
  params: {
    tenantId: string | null;
    problem: IntakeProblem;
    /** n8n-Benutzer: legt an, ist aber nie zuständig */
    integrationUserId: string;
    excludeEmails: string[];
    defaultAssigneeUserId: string | null;
  },
): Promise<EmailIntakeTicketRef | null> {
  const { tenantId, problem } = params;
  try {
    const key = intakeProblemKey(problem);
    const existing = (await storage.getAllTickets(tenantId)).find((t) => (t.tags ?? []).includes(key));
    if (existing) {
      const assignee = existing.assignedToUserId ? await storage.getUser(existing.assignedToUserId) : undefined;
      return { ticketNumber: existing.ticketNumber, reason: problem.reason, assignedTo: assignee?.username ?? null };
    }

    const assignee = await resolveIntakeAssignee(storage, {
      tenantId,
      envelope: problem.envelope,
      excludeEmails: params.excludeEmails,
      excludeUserIds: [params.integrationUserId],
      shopwareCustomerIds: problem.draft?.shopwareCustomerId ? [problem.draft.shopwareCustomerId] : [],
      customerEmail: problem.envelope.customerEmail,
      defaultAssigneeUserId: params.defaultAssigneeUserId,
    });

    const ticket = await storage.createTicket(
      {
        ...buildIntakeTicket(problem, assignee.user, assignee.source),
        status: "open",
        createdByUserId: params.integrationUserId,
        assignedToUserId: assignee.user?.id ?? null,
      },
      tenantId,
    );

    if (problem.rawEmail) {
      await attachRawEmail(storage, ticket.id, tenantId, params.integrationUserId, problem.rawEmail).catch((err) =>
        log.warn({ err, ticketId: ticket.id }, "[EmailIntake] Originalmail nicht am Ticket abgelegt"),
      );
    }

    if (assignee.user) {
      try {
        notificationEvents.emitNotificationCreated(
          await storage.createNotification(
            {
              userId: assignee.user.id,
              type: "ticket_assigned",
              title: `Ticket ${ticket.ticketNumber} zugewiesen`,
              message: ticket.title,
              ticketId: ticket.id,
              ticketNumber: ticket.ticketNumber,
              read: 0,
            },
            tenantId,
          ),
        );
      } catch (err) {
        log.warn({ err, ticketId: ticket.id }, "[EmailIntake] Benachrichtigung nicht erstellt");
      }
    }

    log.info(
      {
        event: "email_intake.ticket_created",
        reason: problem.reason,
        ticketNumber: ticket.ticketNumber,
        assigneeSource: assignee.source,
        assignedTo: assignee.user?.username ?? null,
        draftId: problem.draft?.id ?? null,
        messageId: problem.messageId,
      },
      `[EmailIntake] Ticket ${ticket.ticketNumber} (${problem.reason}) angelegt`,
    );
    return { ticketNumber: ticket.ticketNumber, reason: problem.reason, assignedTo: assignee.user?.username ?? null };
  } catch (err) {
    log.error({ err, reason: problem.reason, messageId: problem.messageId }, "[EmailIntake] Problem-Ticket nicht angelegt");
    return null;
  }
}
