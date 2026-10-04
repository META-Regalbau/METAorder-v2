import type { IStorage } from "../storage";
import { onDomainEvent } from "../lib/domainEvents";
import { notificationEvents } from "../lib/events";
import { sendEmail } from "../email/emailOutbound";
import { classifyTicketForRules } from "../tickets/ticketAi";
import type { AutomationDeps } from "./actions";
import { isInsideAutomation } from "./context";
import { runAutomationEvent } from "./engine";

export function createAutomationDeps(storage: IStorage): AutomationDeps {
  return {
    storage,
    classifyTicket: (ticket) => classifyTicketForRules(storage, ticket),
    sendEmail: (params) => sendEmail(storage, params),
    onNotificationCreated: (notification) => notificationEvents.emitNotificationCreated(notification),
  };
}

/**
 * Bindet die Automatisierungsregeln an die fachlichen Ereignisse (beim Serverstart).
 * Ereignisse, die eine Regel selbst ausloest, werden ignoriert (Schleifenschutz).
 */
export function registerAutomationTriggers(storage: IStorage): () => void {
  const deps = createAutomationDeps(storage);
  const offs = [
    onDomainEvent("ticket.created", async ({ ticket }) => {
      if (isInsideAutomation()) return;
      await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: ticket.tenantId ?? null, ticket });
    }),
    onDomainEvent("ticket.statusChanged", async ({ ticket, previousStatus }) => {
      if (isInsideAutomation()) return;
      await runAutomationEvent(deps, { trigger: "ticket_status_changed", tenantId: ticket.tenantId ?? null, ticket, previousStatus });
    }),
  ];
  return () => offs.forEach((off) => off());
}
