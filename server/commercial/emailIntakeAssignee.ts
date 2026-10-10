/**
 * Wer bekommt ein Problem-Ticket aus dem E-Mail-Eingang? Kette (Entscheidung 10.10.2026):
 *
 *   1. Ein Kollege, der an der Mail beteiligt ist: hat sie intern weitergeleitet oder steht in An/CC.
 *   2. Wer zuletzt einen Entwurf dieses Shopware-Kunden in Shopware angelegt hat; sonst wer zuletzt
 *      ein Ticket zu dieser Kunden-Mail bearbeitet hat.
 *   3. Der Standard-Bearbeiter aus den Einstellungen.
 *
 * Es zählen nur Benutzer des Mandanten, die Tickets sehen dürfen. Das Eingangspostfach selbst und
 * der n8n-Benutzer sind nie „zuständig“.
 */
import type { IStorage } from "../storage";
import type { IngestMailEnvelope } from "./commercialEmailUploadIngest";
import { isOwnOperatorEmail } from "./draftCustomerEmailResolution";

export type IntakeUser = { id: string; username: string; email: string | null };

export type IntakeAssigneeSource = "involved_colleague" | "customer_drafts" | "customer_tickets" | "default" | "none";

export type IntakeAssignee = { user: IntakeUser | null; source: IntakeAssigneeSource };

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function emailOf(value: string): string | null {
  return value.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;
}

/** Stufe 1 (rein): Kollegen in der Reihenfolge Weiterleiter → An → CC. */
export function pickInvolvedColleague(
  envelope: Pick<IngestMailEnvelope, "headerFrom" | "toAddresses" | "ccAddresses">,
  users: IntakeUser[],
  excludeEmails: string[],
): IntakeUser | null {
  const exclude = new Set(excludeEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const byEmail = new Map<string, IntakeUser>();
  for (const user of users) {
    const email = user.email?.trim().toLowerCase();
    if (email && !exclude.has(email)) byEmail.set(email, user);
  }
  const headerEmail = emailOf(envelope.headerFrom);
  // Kopf-Absender nur, wenn er aus dem eigenen Haus kommt (interne Weiterleitung)
  const ordered = [
    ...(headerEmail && isOwnOperatorEmail(headerEmail) ? [headerEmail] : []),
    ...envelope.toAddresses,
    ...envelope.ccAddresses,
  ];
  for (const email of ordered) {
    const user = byEmail.get(email.trim().toLowerCase());
    if (user) return user;
  }
  return null;
}

type DraftLike = {
  tenantId?: string | null;
  shopwareCustomerId?: string | null;
  shopwareCreatedByUserId?: string | null;
  updatedAt: Date | string;
};

/** Stufe 2a (rein): letzter Sachbearbeiter, der einen Entwurf dieses Kunden angelegt hat. */
export function pickLastDraftCreator(
  drafts: DraftLike[],
  shopwareCustomerId: string,
  tenantId: string | null,
  eligible: Map<string, IntakeUser>,
): IntakeUser | null {
  const matching = drafts
    .filter(
      (d) =>
        (d.tenantId ?? null) === tenantId &&
        d.shopwareCustomerId === shopwareCustomerId &&
        d.shopwareCreatedByUserId &&
        eligible.has(d.shopwareCreatedByUserId),
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return matching[0] ? eligible.get(matching[0].shopwareCreatedByUserId!) ?? null : null;
}

type TicketLike = {
  tenantId?: string | null;
  customerEmail?: string | null;
  assignedToUserId?: string | null;
  updatedAt: Date | string;
};

/** Stufe 2b (rein): wer zuletzt ein Ticket zu dieser Kunden-Mail hatte. */
export function pickLastTicketAssignee(
  tickets: TicketLike[],
  customerEmail: string,
  tenantId: string | null,
  eligible: Map<string, IntakeUser>,
): IntakeUser | null {
  const email = customerEmail.trim().toLowerCase();
  const matching = tickets
    .filter(
      (t) =>
        (t.tenantId ?? null) === tenantId &&
        (t.customerEmail ?? "").trim().toLowerCase() === email &&
        t.assignedToUserId &&
        eligible.has(t.assignedToUserId),
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return matching[0] ? eligible.get(matching[0].assignedToUserId!) ?? null : null;
}

export async function resolveIntakeAssignee(
  storage: IStorage,
  params: {
    tenantId: string | null;
    envelope: Pick<IngestMailEnvelope, "headerFrom" | "toAddresses" | "ccAddresses">;
    /** Eingangspostfach und n8n-Benutzer: nie zuständig */
    excludeEmails: string[];
    excludeUserIds: string[];
    shopwareCustomerIds: string[];
    customerEmail: string | null;
    defaultAssigneeUserId: string | null;
  },
): Promise<IntakeAssignee> {
  const exclude = new Set(params.excludeUserIds);
  const users = (
    await storage.getUsersWithPermissionInTenant("viewTickets", params.tenantId, { includeAdministrators: true })
  ).filter((u) => !exclude.has(u.id));
  const eligible = new Map(users.map((u) => [u.id, u]));

  const colleague = pickInvolvedColleague(params.envelope, users, params.excludeEmails);
  if (colleague) return { user: colleague, source: "involved_colleague" };

  if (params.shopwareCustomerIds.length > 0) {
    const [orders, offers] = await Promise.all([
      storage.getAllOrderDrafts(params.tenantId),
      storage.getAllOfferDrafts(params.tenantId),
    ]);
    const drafts: DraftLike[] = [...orders, ...offers];
    for (const customerId of params.shopwareCustomerIds) {
      const creator = pickLastDraftCreator(drafts, customerId, params.tenantId, eligible);
      if (creator) return { user: creator, source: "customer_drafts" };
    }
  }

  if (params.customerEmail) {
    const tickets = await storage.getAllTickets(params.tenantId);
    const previous = pickLastTicketAssignee(tickets, params.customerEmail, params.tenantId, eligible);
    if (previous) return { user: previous, source: "customer_tickets" };
  }

  if (params.defaultAssigneeUserId) {
    const fallback = eligible.get(params.defaultAssigneeUserId);
    if (fallback) return { user: fallback, source: "default" };
  }
  return { user: null, source: "none" };
}
