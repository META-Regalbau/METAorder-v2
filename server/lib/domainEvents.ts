import type { Order, Ticket } from "@shared/schema";
import { logger } from "./logger";

const log = logger.child({ component: "lib/domainEvents" });

/**
 * Fachliche Ereignisse (z. B. "Ticket angelegt", "Bestellstatus geaendert"), die Speicher bzw.
 * Shopware-Spiegel melden und andere Module abonnieren - aktuell die Automatisierungsregeln.
 * Handler laufen entkoppelt (setImmediate), die ausloesende Anfrage wartet also nicht;
 * AsyncLocalStorage-Kontext (requestId, Mandant) bleibt dabei erhalten. Fehler in Handlern
 * werden geloggt, nie an den Ausloeser weitergereicht.
 */
export type DomainEventMap = {
  "ticket.created": { ticket: Ticket };
  "ticket.statusChanged": { ticket: Ticket; previousStatus: string };
  // Gemeldet vom Shopware-Spiegel (server/shopware/orderChangeEvents.ts)
  "order.created": { order: Order; tenantId: string | null };
  "order.statusChanged": { order: Order; tenantId: string | null; previousStatus: string };
  "order.paymentStatusChanged": { order: Order; tenantId: string | null; previousPaymentStatus: string };
};

export type DomainEventName = keyof DomainEventMap;
type Handler<K extends DomainEventName> = (payload: DomainEventMap[K]) => void | Promise<void>;

const handlers: { [K in DomainEventName]?: Array<Handler<K>> } = {};

/** Abonniert ein Ereignis; liefert eine Funktion zum Abmelden. */
export function onDomainEvent<K extends DomainEventName>(name: K, handler: Handler<K>): () => void {
  const list = (handlers[name] ??= []) as Array<Handler<K>>;
  list.push(handler);
  return () => {
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  };
}

export function emitDomainEvent<K extends DomainEventName>(name: K, payload: DomainEventMap[K]): void {
  const list = handlers[name] as Array<Handler<K>> | undefined;
  if (!list?.length) return;
  for (const handler of [...list]) {
    setImmediate(() => {
      Promise.resolve()
        .then(() => handler(payload))
        .catch((err) => log.error({ err, event: name }, `Fehler im Handler fuer Ereignis ${name}`));
    });
  }
}
