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
  type EmailIntakeMailboxMode,
} from "@shared/emailIntake";
import type { IngestCommercialEmailUploadResult, IngestMailEnvelope } from "./commercialEmailUploadIngest";
import { planEmailIntake } from "./emailIntakeOutcome";
import { createIntakeProblemTicket } from "./emailIntakeTickets";
import { buildIntakeTeamsBlock } from "./emailIntakeTeams";
import { logger } from "../lib/logger";
import { intakeMailboxAddresses } from "./emailIntakeSettings";

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

// ---------------------------------------------------------------------------------------------
// Gleichzeitigkeit und Absturzschutz (Vorfall 20.10.2026: ein Stapel aus 5 Mails mit Anhängen ließ den
// Container wiederholt über die Speichergrenze laufen; n8n schickte die unerledigten Mails alle 2 Minuten neu)

/** Höchstens so viele Mails aus dem E-Mail-Eingang gleichzeitig in Verarbeitung */
export const INTAKE_MAX_PARALLEL = 2;
let intakeActive = 0;
const intakeWaiting: Array<() => void> = [];

/** Platz in der Verarbeitung belegen; die zurückgegebene Funktion gibt ihn genau einmal wieder frei */
export async function acquireIntakeSlot(max = INTAKE_MAX_PARALLEL): Promise<() => void> {
  if (intakeActive >= max) await new Promise<void>((resolve) => intakeWaiting.push(resolve));
  else intakeActive += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = intakeWaiting.shift();
    if (next) next(); // Platz geht direkt an den Nächsten, intakeActive bleibt gleich
    else intakeActive -= 1;
  };
}

/** Settings-Schlüssel je Mandant: begonnene, noch nicht abgeschlossene Verarbeitungen je Mail */
export const INTAKE_ATTEMPTS_KEY = "email_intake_attempts";
/** So oft darf die Verarbeitung einer Mail ohne Abschluss abbrechen; danach Problem-Ticket statt neuem Versuch */
export const INTAKE_MAX_ATTEMPTS = 2;
const ATTEMPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_MAX_ENTRIES = 500;

export type IntakeAttempts = Record<string, { count: number; at: string }>;

/** Alte Einträge (älter als 24 h) und Überschuss (höchstens 500, die neuesten) entfernen */
export function pruneIntakeAttempts(attempts: IntakeAttempts, now: Date): IntakeAttempts {
  const fresh = Object.entries(attempts).filter(([, v]) => v && typeof v.count === "number" && now.getTime() - new Date(v.at).getTime() < ATTEMPT_MAX_AGE_MS);
  fresh.sort((a, b) => b[1].at.localeCompare(a[1].at));
  return Object.fromEntries(fresh.slice(0, ATTEMPT_MAX_ENTRIES));
}

type AttemptStore = Pick<IStorage, "getSetting" | "saveSetting">;
let attemptChain: Promise<unknown> = Promise.resolve();
/** Lesen-Ändern-Schreiben nacheinander, damit parallele Mails sich nicht überschreiben */
function withAttempts<T>(store: AttemptStore, tenantId: string | null, fn: (a: IntakeAttempts) => { next: IntakeAttempts; result: T }, now: Date): Promise<T> {
  const run = attemptChain.then(async () => {
    const raw = await store.getSetting(INTAKE_ATTEMPTS_KEY, tenantId);
    const current = pruneIntakeAttempts(raw && typeof raw === "object" ? (raw as IntakeAttempts) : {}, now);
    const { next, result } = fn(current);
    await store.saveSetting(INTAKE_ATTEMPTS_KEY, next, tenantId);
    return result;
  });
  attemptChain = run.catch(() => undefined);
  return run;
}

/**
 * Verarbeitung einer Mail beginnt: Zähler erhöhen (in der Datenbank, übersteht den Absturz) und die Zahl der
 * bisherigen, nicht abgeschlossenen Versuche liefern.
 */
export function startIntakeAttempt(store: AttemptStore, tenantId: string | null, messageKey: string, now = new Date()): Promise<number> {
  return withAttempts(
    store,
    tenantId,
    (a) => {
      const previous = a[messageKey]?.count ?? 0;
      return { next: { ...a, [messageKey]: { count: previous + 1, at: now.toISOString() } }, result: previous };
    },
    now,
  );
}

/** Verarbeitung abgeschlossen (auch mit Fehler-Ticket): Zähler löschen */
export function finishIntakeAttempt(store: AttemptStore, tenantId: string | null, messageKey: string, now = new Date()): Promise<void> {
  return withAttempts(
    store,
    tenantId,
    (a) => {
      const { [messageKey]: _done, ...rest } = a;
      return { next: rest, result: undefined };
    },
    now,
  );
}

type DraftInfo = { shopwareCustomerId: string | null; fileName: string | null; company: string | null };

export async function finalizeEmailIntake(params: {
  storage: IStorage;
  tenantId: string | null;
  settings: EmailIntakeSettings;
  ingest: IngestCommercialEmailUploadResult;
  existingDraftKind: "order" | "offer" | null;
  rawEmail: { buffer: Buffer; fileName: string };
  integrationUser: { id: string; email?: string | null };
  /** Basisadresse für Links in der Teams-Info */
  appBaseUrl?: string | null;
  /** Art des Postfachs, aus dem die Mail kommt */
  mailboxMode?: EmailIntakeMailboxMode;
}): Promise<EmailIntakeResponse> {
  const { storage, tenantId, settings, ingest } = params;
  const plan = planEmailIntake({
    mailboxMode: params.mailboxMode,
    ignoredByFilter: ingest.ignoredByFilter,
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
      const extracted = (row?.extractedData ?? null) as { billingAddress?: { company?: string }; customer?: { company?: string } } | null;
      draft = {
        shopwareCustomerId: row?.shopwareCustomerId ?? null,
        fileName: row?.originalFileName ?? null,
        company: extracted?.billingAddress?.company ?? extracted?.customer?.company ?? null,
      };
    }
    const ref = await createIntakeProblemTicket(storage, {
      tenantId,
      integrationUserId: params.integrationUser.id,
      excludeEmails: [...intakeMailboxAddresses(settings), params.integrationUser.email ?? ""].filter(Boolean),
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
      moved: plan.move,
      mailboxMode: params.mailboxMode ?? "order",
      filterRule: plan.filter?.rule ?? null,
    },
    `[EmailIntake] ${plan.outcome}: ${ingest.subject}`,
  );

  return {
    outcome: plan.outcome,
    categories,
    forward: plan.forward,
    move: plan.move,
    tickets,
    other: plan.other,
    teams: buildIntakeTeamsBlock(settings.teamsWebhookUrl, tickets, params.appBaseUrl ?? null),
    filter: plan.filter,
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
  appBaseUrl?: string | null;
  mailboxMode?: EmailIntakeMailboxMode;
}): Promise<EmailIntakeResponse> {
  const tickets: EmailIntakeTicketRef[] = [];
  if (params.settings.ticketOnFailure) {
    const ref = await createIntakeProblemTicket(params.storage, {
      tenantId: params.tenantId,
      integrationUserId: params.integrationUser.id,
      excludeEmails: [...intakeMailboxAddresses(params.settings), params.integrationUser.email ?? ""].filter(Boolean),
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
    // persönliches Postfach: nur Kategorie „Fehler“, Mail bleibt im Posteingang
    move: params.mailboxMode !== "personal",
    tickets,
    other: null,
    teams: buildIntakeTeamsBlock(params.settings.teamsWebhookUrl, tickets, params.appBaseUrl ?? null),
  };
}
