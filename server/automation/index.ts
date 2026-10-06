import type { IStorage } from "../storage";
import { onDomainEvent } from "../lib/domainEvents";
import { notificationEvents } from "../lib/events";
import { sendEmail } from "../email/emailOutbound";
import { classifyTicketForRules } from "../tickets/ticketAi";
import type { AutomationDeps } from "./actions";
import { isInsideAutomation } from "./context";
import { runAutomationEvent } from "./engine";
import { runScheduledAutomations } from "./scheduler";
import { logger } from "../lib/logger";
import { SCHEDULED_DEFAULT_INTERVAL_MINUTES } from "@shared/automation";

const log = logger.child({ component: "automation/index" });

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
  // Bestell-Ereignisse kommen gebuendelt aus einem Spiegel-Abgleich: nacheinander abarbeiten,
  // statt alle gleichzeitig auf die Datenbank loszulassen.
  let orderQueue: Promise<unknown> = Promise.resolve();
  const inOrderQueue = (fn: () => Promise<unknown>) => {
    const next = orderQueue.then(fn);
    orderQueue = next.catch(() => {});
    return next;
  };
  const offs = [
    onDomainEvent("ticket.created", async ({ ticket }) => {
      if (isInsideAutomation()) return;
      await runAutomationEvent(deps, { trigger: "ticket_created", tenantId: ticket.tenantId ?? null, ticket });
    }),
    onDomainEvent("ticket.statusChanged", async ({ ticket, previousStatus }) => {
      if (isInsideAutomation()) return;
      await runAutomationEvent(deps, { trigger: "ticket_status_changed", tenantId: ticket.tenantId ?? null, ticket, previousStatus });
    }),
    onDomainEvent("order.created", async ({ order, tenantId }) => {
      if (isInsideAutomation()) return;
      await inOrderQueue(() => runAutomationEvent(deps, { trigger: "order_created", tenantId, order }));
    }),
    onDomainEvent("order.statusChanged", async ({ order, tenantId, previousStatus }) => {
      if (isInsideAutomation()) return;
      await inOrderQueue(() => runAutomationEvent(deps, { trigger: "order_status_changed", tenantId, order, previousStatus }));
    }),
    onDomainEvent("order.paymentStatusChanged", async ({ order, tenantId, previousPaymentStatus }) => {
      if (isInsideAutomation()) return;
      await inOrderQueue(() => runAutomationEvent(deps, { trigger: "order_payment_changed", tenantId, order, previousPaymentStatus }));
    }),
  ];
  return () => offs.forEach((off) => off());
}

/** Intervall aus AUTOMATION_SCHEDULE_INTERVAL_MINUTES (mind. 5 Minuten, sonst Standard). */
export function resolveScheduleIntervalMinutes(raw: string | undefined = process.env.AUTOMATION_SCHEDULE_INTERVAL_MINUTES): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 5 ? parsed : SCHEDULED_DEFAULT_INTERVAL_MINUTES;
}

/**
 * Startet die zeitgesteuerten Regeln (beim Serverstart). Abschaltbar per
 * AUTOMATION_SCHEDULER_ENABLED=false. Laeufe ueberlappen nie; der erste Lauf startet nach
 * 3 Minuten, damit der Shopware-Spiegel vorher aktualisiert ist.
 */
export function startAutomationScheduler(storage: IStorage): () => void {
  if (process.env.AUTOMATION_SCHEDULER_ENABLED === "false") {
    log.info("Zeitgesteuerte Automatisierung deaktiviert (AUTOMATION_SCHEDULER_ENABLED=false)");
    return () => {};
  }
  const minutes = resolveScheduleIntervalMinutes();
  const deps = createAutomationDeps(storage);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduledAutomations(deps);
    } catch (err) {
      log.error({ err }, "Zeitgesteuerte Automatisierung fehlgeschlagen");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 3 * 60 * 1000);
  const timer = setInterval(run, minutes * 60 * 1000);
  log.info({ intervalMinutes: minutes }, "Zeitgesteuerte Automatisierung geplant");
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
