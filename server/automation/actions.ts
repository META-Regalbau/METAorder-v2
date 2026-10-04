import type { InsertTicket, Notification, Order, Ticket, TicketCategory, TicketPriority } from "@shared/schema";
import {
  AUTOMATION_ACTIONS,
  interpolate,
  type AutomationActionInput,
  type AutomationActionTypeId,
  type AutomationFacts,
} from "@shared/automation";
import type { IStorage } from "../storage";
import type { TicketAiResult } from "../tickets/ticketAi";

/** Abhaengigkeiten der Aktionen - in Tests ersetzbar. */
export type AutomationDeps = {
  storage: IStorage;
  classifyTicket: (ticket: Ticket) => Promise<TicketAiResult>;
  sendEmail: (params: { to: string; subject: string; text: string }) => Promise<unknown>;
  onNotificationCreated: (notification: Notification) => void;
};

export type ActionEnv = {
  deps: AutomationDeps;
  tenantId: string | null;
  ticket?: Ticket;
  /** Bei zeitgesteuerten Regeln die gepruefte Bestellung */
  order?: Order;
  facts: AutomationFacts;
};

type ActionImpl = (params: Record<string, unknown>, env: ActionEnv) => Promise<string>;

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function requireTicket(env: ActionEnv): Ticket {
  if (!env.ticket) throw new Error("Kein Ticket im Auslöser");
  return env.ticket;
}

/** Benutzer muss existieren und - bei Mandanten - diesem Mandanten zugeordnet sein. */
async function requireUserInTenant(env: ActionEnv, userId: string): Promise<{ id: string; username: string }> {
  const user = await env.deps.storage.getUser(userId);
  if (!user) throw new Error(`Benutzer ${userId} nicht gefunden`);
  if (env.tenantId) {
    const tenants = await env.deps.storage.getTenantsForUser(userId);
    if (!tenants.some((t) => t.id === env.tenantId)) throw new Error(`Benutzer ${user.username} gehört nicht zu diesem Mandanten`);
  }
  return user;
}

const ACTIONS: Record<Exclude<AutomationActionTypeId, "update_order_status">, ActionImpl> = {
  async assign_ticket(params, env) {
    const ticket = requireTicket(env);
    const user = await requireUserInTenant(env, str(params.userId));
    await env.deps.storage.updateTicket(ticket.id, { assignedToUserId: user.id });
    return `Ticket ${ticket.ticketNumber} an ${user.username} zugewiesen`;
  },

  async update_ticket_priority(params, env) {
    const ticket = requireTicket(env);
    const priority = str(params.priority);
    await env.deps.storage.updateTicket(ticket.id, { priority: priority as TicketPriority });
    return `Priorität von ${ticket.ticketNumber} auf ${priority} gesetzt`;
  },

  async send_notification(params, env) {
    const user = await requireUserInTenant(env, str(params.userId));
    const notification = await env.deps.storage.createNotification({
      userId: user.id,
      type: "ticket_updated",
      title: interpolate(str(params.title), env.facts),
      message: interpolate(str(params.message), env.facts),
      ticketId: env.ticket?.id ?? null,
      ticketNumber: env.ticket?.ticketNumber ?? null,
      read: 0,
    });
    env.deps.onNotificationCreated(notification);
    return `Benachrichtigung an ${user.username}`;
  },

  async send_email(params, env) {
    const to = interpolate(str(params.to), env.facts).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error(`Keine gültige Empfängeradresse: "${to}"`);
    await env.deps.sendEmail({
      to,
      subject: interpolate(str(params.subject), env.facts),
      text: interpolate(str(params.body), env.facts),
    });
    return `E-Mail an ${to} gesendet`;
  },

  async run_ai_analysis(params, env) {
    const ticket = requireTicket(env);
    const result = await env.deps.classifyTicket(ticket);
    const updates: Partial<Pick<InsertTicket, "category" | "priority">> = {};
    // Kategorie nur setzen, wenn noch keine fachliche vergeben ist
    if (params.applyCategory && ticket.category === "general" && result.category !== "general") updates.category = result.category;
    // Negative Stimmung: niedrige/normale Prioritaet auf hoch anheben
    if (params.escalateNegative && result.sentiment === "negative" && (ticket.priority === "low" || ticket.priority === "normal")) updates.priority = "high";
    if (Object.keys(updates).length > 0) await env.deps.storage.updateTicket(ticket.id, updates);
    const changes = Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(", ");
    return `KI (${result.source}): Kategorie ${result.category}, Stimmung ${result.sentiment}${changes ? `; gesetzt: ${changes}` : "; keine Änderung"}`;
  },

  async create_ticket(params, env) {
    const created = await env.deps.storage.createTicket({
      title: interpolate(str(params.title), env.facts),
      description: interpolate(str(params.description), env.facts),
      status: "open",
      priority: (str(params.priority) || "normal") as TicketPriority,
      category: (str(params.category) || "general") as TicketCategory,
      // Mit der Bestellung bzw. dem ausloesenden Ticket verknuepfen
      orderId: env.order?.id ?? env.ticket?.orderId ?? null,
      orderNumber: env.order?.orderNumber ?? env.ticket?.orderNumber ?? null,
      customerEmail: env.order?.customerEmail ?? env.ticket?.customerEmail ?? null,
      customerName: env.order?.customerName ?? env.ticket?.customerName ?? null,
      createdByUserId: null,
      assignedToUserId: null,
    });
    return `Ticket ${created.ticketNumber} angelegt`;
  },
};

export async function executeAction(action: AutomationActionInput, env: ActionEnv): Promise<string> {
  const def = AUTOMATION_ACTIONS[action.type as AutomationActionTypeId];
  if (!def?.available || action.type === "update_order_status") throw new Error(`Aktion "${action.type}" ist nicht verfügbar`);
  return ACTIONS[action.type as keyof typeof ACTIONS](action.params ?? {}, env);
}
