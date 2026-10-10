/**
 * E-Mail-Eingang über n8n: nach der Verarbeitung Tickets anlegen und den `intake`-Block der
 * Upload-Antwort bauen. Außerdem eine Sperre je Mail, falls zwei n8n-Läufe überlappen.
 */
import type { IStorage } from "../storage";
import {
  EMAIL_INTAKE_CATEGORIES,
  type EmailIntakeResponse,
  type EmailIntakeSettings,
  type EmailIntakeTicketRef,
} from "@shared/emailIntake";
import type { IngestCommercialEmailUploadResult, IngestMailEnvelope } from "./commercialEmailUploadIngest";
import { planEmailIntake } from "./emailIntakeOutcome";
import { createIntakeProblemTicket } from "./emailIntakeTickets";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/emailIntakeUpload" });

const inFlight = new Map<string, number>();
/** Länger als jede Verarbeitung; danach gilt eine Sperre als verwaist */
const IN_FLIGHT_MAX_MS = 15 * 60 * 1000;

/** true: Sperre erhalten. false: dieselbe Mail wird gerade schon verarbeitet. */
export function acquireIntakeLock(key: string, now = Date.now()): boolean {
  const since = inFlight.get(key);
  if (since !== undefined && now - since < IN_FLIGHT_MAX_MS) return false;
  inFlight.set(key, now);
  return true;
}

export function releaseIntakeLock(key: string): void {
  inFlight.delete(key);
}

type DraftInfo = { shopwareCustomerId: string | null; fileName: string | null };

export async function finalizeEmailIntake(params: {
  storage: IStorage;
  tenantId: string | null;
  settings: EmailIntakeSettings;
  ingest: IngestCommercialEmailUploadResult;
  existingDraftKind: "order" | "offer" | null;
  rawEmail: { buffer: Buffer; fileName: string };
  integrationUser: { id: string; email?: string | null };
}): Promise<EmailIntakeResponse> {
  const { storage, tenantId, settings, ingest } = params;
  const plan = planEmailIntake({
    skippedAsOther: ingest.skippedAsOther,
    triage: ingest.triage,
    outcomes: ingest.outcomes,
    existingDraftKind: params.existingDraftKind,
    settings,
  });

  const tickets: EmailIntakeTicketRef[] = [];
  for (const problem of plan.problems) {
    let draft: DraftInfo | null = null;
    if (problem.draft) {
      const row =
        problem.draft.kind === "order"
          ? await storage.getOrderDraft(problem.draft.id, tenantId)
          : await storage.getOfferDraft(problem.draft.id, tenantId);
      draft = { shopwareCustomerId: row?.shopwareCustomerId ?? null, fileName: row?.originalFileName ?? null };
    }
    const ref = await createIntakeProblemTicket(storage, {
      tenantId,
      integrationUserId: params.integrationUser.id,
      excludeEmails: [settings.mailbox, params.integrationUser.email ?? ""].filter(Boolean),
      defaultAssigneeUserId: settings.defaultAssigneeUserId,
      problem: {
        reason: problem.reason,
        messageId: ingest.messageId,
        subject: ingest.subject,
        envelope: ingest.envelope,
        draft: problem.draft ? { ...problem.draft, ...draft } : null,
        error: problem.error,
        // Ohne Entwurf hat niemand sonst die Mail: als Anhang ans Ticket
        rawEmail: problem.reason === "processing_failed" ? params.rawEmail : null,
      },
    });
    if (ref) tickets.push(ref);
  }

  const categories = [...plan.categories];
  if (tickets.length > 0) categories.push(EMAIL_INTAKE_CATEGORIES.ticket);

  log.info(
    {
      event: "email_intake.processed",
      messageId: ingest.messageId,
      outcome: plan.outcome,
      drafts: ingest.results.map((r) => `${r.draftKind}:${r.draftId}`),
      tickets: tickets.map((t) => t.ticketNumber),
      forwarded: Boolean(plan.forward),
    },
    `[EmailIntake] ${plan.outcome}: ${ingest.subject}`,
  );

  return {
    outcome: plan.outcome,
    categories,
    forward: plan.forward,
    move: true,
    tickets,
    other: plan.other,
  };
}

/** Ganze Verarbeitung abgestürzt: Ticket mit der Originalmail, n8n verschiebt die Mail trotzdem. */
export async function failEmailIntake(params: {
  storage: IStorage;
  tenantId: string | null;
  settings: EmailIntakeSettings;
  messageId: string;
  subject: string;
  envelope: Pick<IngestMailEnvelope, "headerFrom" | "customerFrom" | "customerEmail" | "toAddresses" | "ccAddresses">;
  error: string;
  rawEmail: { buffer: Buffer; fileName: string };
  integrationUser: { id: string; email?: string | null };
}): Promise<EmailIntakeResponse> {
  const tickets: EmailIntakeTicketRef[] = [];
  if (params.settings.ticketOnFailure) {
    const ref = await createIntakeProblemTicket(params.storage, {
      tenantId: params.tenantId,
      integrationUserId: params.integrationUser.id,
      excludeEmails: [params.settings.mailbox, params.integrationUser.email ?? ""].filter(Boolean),
      defaultAssigneeUserId: params.settings.defaultAssigneeUserId,
      problem: {
        reason: "processing_failed",
        messageId: params.messageId,
        subject: params.subject,
        envelope: params.envelope,
        error: params.error,
        stage: "Verarbeitung in METAorder",
        rawEmail: params.rawEmail,
      },
    });
    if (ref) tickets.push(ref);
  }
  return {
    outcome: "failed",
    categories: [EMAIL_INTAKE_CATEGORIES.failed, ...(tickets.length ? [EMAIL_INTAKE_CATEGORIES.ticket] : [])],
    forward: null,
    // Auch ohne Ticket verschieben: sonst liefe dieselbe kaputte Mail alle zwei Minuten erneut durch die KI
    move: true,
    tickets,
    other: null,
  };
}
