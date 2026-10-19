/**
 * Kundenantworten aus dem E-Mail-Eingang (Entscheidung 19.10.2026): Für Lieferstatus-Rückfragen,
 * Reklamationen, Kundenfragen und Angebotsanfragen entsteht ein Ticket „Kundenanfrage“ mit einem
 * KI-Antwortentwurf. Der Entwurf wird im Ticket angepasst und freigegeben; verschickt wird über n8n aus
 * dem Postfach der Mail (Postausgang, folgt). Läuft nach der Antwort an n8n im Hintergrund: Fehler hier
 * berühren den Eingang nicht.
 */
import crypto from "crypto";
import { and, eq, inArray, isNull, type AnyColumn } from "drizzle-orm";
import { emailIntakeReplies, shopwareOrders, type EmailIntakeReplyRow, type Order, type TicketCategory } from "@shared/schema";
import {
  EMAIL_INTAKE_REPLY_KIND_LABELS,
  internalDomainsFor,
  type EmailIntakeOtherType,
  type EmailIntakeOutcome,
  type EmailIntakeReplyKind,
  type EmailIntakeSettings,
} from "@shared/emailIntake";
import type { IStorage } from "../storage";
import { db } from "../db";
import { logger } from "../lib/logger";
import { notificationEvents } from "../lib/events";
import { chatCompletion, isChatLlmConfigured } from "../ai/llmChat";
import { getCommercialAgentSettings } from "../ai/aiConfig";
import { parseEmailBufferAutodetect } from "../email/emailParser";
import { unwrapInternalForward } from "../email/emailForwardUnwrap";
import { isOwnOperatorEmail } from "./draftCustomerEmailResolution";
import { resolveIntakeAssignee } from "./emailIntakeAssignee";
import { intakeMailboxAddresses } from "./emailIntakeSettings";
import { attachRawEmail, draftLink, EMAIL_INTAKE_TICKET_TAG } from "./emailIntakeTickets";
import type { IngestMailEnvelope } from "./commercialEmailUploadIngest";
import {
  REPLY_SYSTEM,
  buildReplyPrompt,
  findOrderNumbers,
  interpretReplyResponse,
  orderFactsFor,
  pickOrderForSender,
  replyKindFor,
  withSignature,
  type ReplyFacts,
} from "./emailIntakeReplyDraft";

const log = logger.child({ component: "commercial/emailIntakeReplies" });

export const EMAIL_INTAKE_REPLY_TAG = "kundenanfrage";

const KIND_CATEGORY: Record<EmailIntakeReplyKind, TicketCategory> = {
  order_status: "order_issue",
  complaint: "complaint",
  general: "product_inquiry",
  offer_request: "product_inquiry",
};

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

export type ReplyLlm = (system: string, user: string) => Promise<string>;

/** Message-ID-Kopfzeile aus der Eingangs-Kennung (mail:<id>); bei Inhalts-Hash unbekannt */
export function internetMessageIdOf(messageKey: string): string | null {
  if (!messageKey.startsWith("mail:")) return null;
  const id = messageKey.slice(5).trim().replace(/^<|>$/g, "");
  return id ? `<${id}>` : null;
}

function replyKeyTag(messageKey: string): string {
  return `reply:${crypto.createHash("sha256").update(messageKey).digest("hex").slice(0, 16)}`;
}

function isInternalAddress(email: string, settings: EmailIntakeSettings): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return Boolean(domain) && internalDomainsFor(settings).some((d) => domain === d || domain.endsWith(`.${d}`));
}

// ---------- Datenbank ----------

export async function getReplyByTicket(ticketId: string): Promise<EmailIntakeReplyRow | null> {
  const [row] = await db.select().from(emailIntakeReplies).where(eq(emailIntakeReplies.ticketId, ticketId)).limit(1);
  return row ?? null;
}

async function updateReply(id: string, patch: Partial<EmailIntakeReplyRow>): Promise<EmailIntakeReplyRow | null> {
  const [row] = await db
    .update(emailIntakeReplies)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(emailIntakeReplies.id, id))
    .returning();
  return row ?? null;
}

/** Bestellungen mit diesen Nummern aus dem Spiegel (Nummern sind in Shopware nicht eindeutig) */
async function loadOrdersByNumber(tenantId: string | null, numbers: string[]): Promise<Order[]> {
  if (numbers.length === 0) return [];
  const rows = await db
    .select({ payload: shopwareOrders.payload })
    .from(shopwareOrders)
    .where(and(tenantIs(shopwareOrders.tenantId, tenantId), inArray(shopwareOrders.orderNumber, numbers)));
  return rows.map((r) => r.payload as Order).filter((o) => o && typeof o === "object" && o.orderNumber);
}

// ---------- Entwurf ----------

async function orderFacts(
  tenantId: string | null,
  kind: EmailIntakeReplyKind,
  numbers: string[],
  senderEmail: string,
): Promise<Pick<ReplyFacts, "order" | "orderNote">> {
  if (kind === "offer_request" || kind === "general" || numbers.length === 0) return { order: null, orderNote: null };
  const picked = pickOrderForSender(await loadOrdersByNumber(tenantId, numbers), senderEmail);
  return { order: picked.order ? orderFactsFor(picked.order) : null, orderNote: picked.note };
}

function defaultLlm(storage: IStorage): ReplyLlm | null {
  const getSetting = storage.getSetting.bind(storage);
  return (system, user) =>
    chatCompletion(getSetting, {
      tier: "smart",
      temperature: 0.2,
      response_json: true,
      max_tokens: 16000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
}

export type GeneratedReply = { needsReply: boolean; draft: string | null; reason: string | null; error: string | null };

export async function generateReplyDraft(
  storage: IStorage,
  input: { kind: EmailIntakeReplyKind; facts: ReplyFacts; signature: string },
  llm?: ReplyLlm,
): Promise<GeneratedReply> {
  const ask = llm ?? ((await isChatLlmConfigured(storage.getSetting.bind(storage))) ? defaultLlm(storage) : null);
  if (!ask) return { needsReply: true, draft: null, reason: null, error: "KI nicht eingerichtet" };
  try {
    const result = interpretReplyResponse(await ask(REPLY_SYSTEM, buildReplyPrompt(input)));
    if (!result) return { needsReply: true, draft: null, reason: null, error: "KI-Antwort unbrauchbar" };
    if (!result.needsReply) return { needsReply: false, draft: null, reason: result.reason || null, error: null };
    return { needsReply: true, draft: withSignature(result.reply, input.signature), reason: result.reason || null, error: null };
  } catch (err) {
    log.warn({ err }, "[EmailIntakeReply] Entwurf fehlgeschlagen");
    return { needsReply: true, draft: null, reason: null, error: err instanceof Error ? err.message.slice(0, 300) : "Fehler" };
  }
}

// ---------- Ablauf je Mail ----------

export type StartIntakeReplyParams = {
  storage: IStorage;
  tenantId: string | null;
  settings: EmailIntakeSettings;
  outcome: EmailIntakeOutcome;
  otherType: EmailIntakeOtherType | null;
  messageKey: string;
  subject: string;
  envelope: Pick<IngestMailEnvelope, "headerFrom" | "customerFrom" | "customerEmail" | "toAddresses" | "ccAddresses">;
  offerDraftId: string | null;
  /** Postfach aus dem Upload (intake_mailbox); null = älterer Workflow */
  mailbox: string | null;
  rawEmail: { buffer: Buffer; fileName: string };
  integrationUser: { id: string; email?: string | null };
  llm?: ReplyLlm;
};

/** Ob und welche Antwort entstehen soll (rein): null = keine. */
export function replyPlanFor(
  params: Pick<StartIntakeReplyParams, "settings" | "outcome" | "otherType" | "envelope">,
): { kind: EmailIntakeReplyKind; customerEmail: string } | null {
  const kind = replyKindFor({ outcome: params.outcome, otherType: params.otherType });
  if (!kind || !params.settings.replyDrafts[kind]) return null;
  const customerEmail = (params.envelope.customerEmail ?? "").trim().toLowerCase();
  if (!customerEmail || isOwnOperatorEmail(customerEmail) || isInternalAddress(customerEmail, params.settings)) return null;
  return { kind, customerEmail };
}

/** Nach der Antwort an n8n starten; wirft nie. */
export function startIntakeReply(params: StartIntakeReplyParams): void {
  void runIntakeReply(params).catch((err) => log.error({ err, messageKey: params.messageKey }, "[EmailIntakeReply] abgebrochen"));
}

export async function runIntakeReply(params: StartIntakeReplyParams): Promise<EmailIntakeReplyRow | null> {
  const { storage, tenantId, settings } = params;
  const plan = replyPlanFor(params);
  if (!plan) return null;

  // Eingangsbestätigung der Entwurfs-Automatik geht schon raus: keine zweite Antwort auf Angebotsanfragen
  if (plan.kind === "offer_request" && (await getCommercialAgentSettings(storage)).inboundAcknowledgementEnabled === true) {
    log.info({ messageKey: params.messageKey }, "[EmailIntakeReply] Angebotsanfrage: Eingangsbestätigung ist aktiv, kein Entwurf");
    return null;
  }

  // Eine Zeile je Mail: Wiederholungen von n8n legen nichts doppelt an
  const [claimed] = await db
    .insert(emailIntakeReplies)
    .values({
      tenantId,
      messageKey: params.messageKey,
      internetMessageId: internetMessageIdOf(params.messageKey),
      mailbox: params.mailbox,
      kind: plan.kind,
      customerEmail: plan.customerEmail,
      subject: params.subject.slice(0, 500),
      status: "draft",
    })
    .onConflictDoNothing()
    .returning();
  if (!claimed) return null;

  const parsed = await parseEmailBufferAutodetect(params.rawEmail.buffer).catch(() => null);
  const unwrapped = unwrapInternalForward({
    from: parsed?.from ?? params.envelope.customerFrom,
    subject: parsed?.subject || params.subject,
    body: parsed?.body ?? "",
  });
  const mailText = unwrapped.body.trim().slice(0, 8000);
  const orderNumbers = findOrderNumbers(params.subject, mailText);
  const facts: ReplyFacts = {
    orderNumbers,
    ...(await orderFacts(tenantId, plan.kind, orderNumbers, plan.customerEmail)),
    offerDraftId: params.offerDraftId,
    mail: { subject: params.subject, from: params.envelope.customerFrom || plan.customerEmail, text: mailText },
  };

  const generated = await generateReplyDraft(storage, { kind: plan.kind, facts, signature: settings.replySignature }, params.llm);
  if (!generated.needsReply) {
    log.info({ messageKey: params.messageKey, reason: generated.reason }, "[EmailIntakeReply] keine Antwort nötig");
    return updateReply(claimed.id, { status: "skipped", facts: { ...facts, reason: generated.reason } });
  }

  const ticket = await createReplyTicket(params, plan, facts, generated);
  const row = await updateReply(claimed.id, {
    ticketId: ticket.id,
    draft: generated.draft,
    draftError: generated.error,
    facts: { ...facts, reason: generated.reason },
  });
  log.info(
    {
      event: "email_intake.reply_draft",
      messageKey: params.messageKey,
      kind: plan.kind,
      ticketNumber: ticket.ticketNumber,
      orderNumber: facts.order?.orderNumber ?? null,
      draftError: generated.error,
    },
    `[EmailIntakeReply] Ticket ${ticket.ticketNumber} mit Antwortentwurf (${plan.kind})`,
  );
  return row;
}

async function createReplyTicket(
  params: StartIntakeReplyParams,
  plan: { kind: EmailIntakeReplyKind; customerEmail: string },
  facts: ReplyFacts,
  generated: GeneratedReply,
) {
  const { storage, tenantId, settings } = params;
  const assignee = await resolveIntakeAssignee(storage, {
    tenantId,
    envelope: params.envelope,
    excludeEmails: [...intakeMailboxAddresses(settings), params.integrationUser.email ?? ""].filter(Boolean),
    excludeUserIds: [params.integrationUser.id],
    shopwareCustomerIds: [],
    customerEmail: plan.customerEmail,
    defaultAssigneeUserId: settings.defaultAssigneeUserId,
  });
  const subject = params.subject.trim() || "(ohne Betreff)";
  const lines = [
    `${EMAIL_INTAKE_REPLY_KIND_LABELS[plan.kind]} aus dem E-Mail-Eingang. Der Antwortentwurf steht im Antwortfeld; bitte prüfen, Platzhalter in [eckigen Klammern] ausfüllen und freigeben.`,
    "",
    `Betreff: ${subject}`,
    `Absender: ${params.envelope.customerFrom || plan.customerEmail}`,
  ];
  if (params.mailbox !== null) lines.push(`Postfach: ${params.mailbox || "Konto des n8n-Zugangs"}`);
  if (facts.order) lines.push(`Bestellung: ${facts.order.orderNumber} (${facts.order.status})`);
  else if (facts.orderNumbers.length) lines.push(`Bestellnummer: ${facts.orderNumbers.join(", ")} – ${facts.orderNote ?? "keine Daten"}`);
  if (params.offerDraftId) lines.push(`Angebotsentwurf: ${draftLink("offer", params.offerDraftId)}`);
  if (generated.error) lines.push(`Entwurf nicht erstellt: ${generated.error} (im Ticket „Neu erstellen“)`);
  lines.push(`Mail-Kennung: ${params.messageKey}`, "", "— Kundenmail —", facts.mail.text.slice(0, 4000));

  const customerName = (params.envelope.customerFrom || "").replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  const ticket = await storage.createTicket(
    {
      title: `Kundenanfrage (${EMAIL_INTAKE_REPLY_KIND_LABELS[plan.kind]}): ${subject}`.slice(0, 200),
      description: lines.join("\n"),
      priority: plan.kind === "complaint" ? "high" : "normal",
      category: KIND_CATEGORY[plan.kind],
      tags: [EMAIL_INTAKE_TICKET_TAG, EMAIL_INTAKE_REPLY_TAG, replyKeyTag(params.messageKey)],
      customerEmail: plan.customerEmail,
      customerName: customerName && customerName.toLowerCase() !== plan.customerEmail ? customerName : null,
      emailSubject: subject.slice(0, 500),
      emailFrom: (params.envelope.customerFrom || plan.customerEmail).slice(0, 300),
      orderNumber: facts.order?.orderNumber ?? facts.orderNumbers[0] ?? null,
      status: "open",
      createdByUserId: params.integrationUser.id,
      assignedToUserId: assignee.user?.id ?? null,
    },
    tenantId,
  );
  await attachRawEmail(storage, ticket.id, tenantId, params.integrationUser.id, params.rawEmail).catch((err) =>
    log.warn({ err, ticketId: ticket.id }, "[EmailIntakeReply] Originalmail nicht am Ticket abgelegt"),
  );
  if (assignee.user) {
    try {
      notificationEvents.emitNotificationCreated(
        await storage.createNotification(
          {
            userId: assignee.user.id,
            type: "ticket_assigned",
            title: `Kundenanfrage ${ticket.ticketNumber}`,
            message: ticket.title,
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            read: 0,
          },
          tenantId,
        ),
      );
    } catch (err) {
      log.warn({ err, ticketId: ticket.id }, "[EmailIntakeReply] Benachrichtigung nicht erstellt");
    }
  }
  return ticket;
}

/** „Neu erstellen“ im Ticket: Bestelldaten neu lesen, Entwurf neu schreiben. */
export async function regenerateReply(
  storage: IStorage,
  row: EmailIntakeReplyRow,
  settings: EmailIntakeSettings,
  llm?: ReplyLlm,
): Promise<EmailIntakeReplyRow | null> {
  const stored = (row.facts ?? {}) as Partial<ReplyFacts>;
  const mail = stored.mail ?? { subject: row.subject ?? "", from: row.customerEmail, text: "" };
  const kind = row.kind as EmailIntakeReplyKind;
  const orderNumbers = findOrderNumbers(mail.subject, mail.text);
  const facts: ReplyFacts = {
    orderNumbers,
    ...(await orderFacts(row.tenantId ?? null, kind, orderNumbers, row.customerEmail)),
    offerDraftId: stored.offerDraftId ?? null,
    mail,
  };
  const generated = await generateReplyDraft(storage, { kind, facts, signature: settings.replySignature }, llm);
  return updateReply(row.id, {
    // Auch wenn die KI meint, es brauche keine Antwort: wer „Neu erstellen“ drückt, will einen Text
    draft: generated.draft ?? row.draft,
    draftError: generated.needsReply ? generated.error : `KI hält keine Antwort für nötig: ${generated.reason ?? ""}`.trim(),
    facts: { ...facts, reason: generated.reason },
  });
}
