import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Schleifenschutz: Waehrend Aktionen einer Regel laufen, ist dieser Kontext gesetzt.
 * Ereignisse, die dabei entstehen (z. B. eine Regel aendert ein Ticket), loesen keine
 * weiteren Regeln aus - sonst koennten sich Regeln gegenseitig endlos anstossen.
 */
const automationContext = new AsyncLocalStorage<{ ruleId: string }>();

export function isInsideAutomation(): boolean {
  return automationContext.getStore() !== undefined;
}

export function runInsideAutomation<T>(ruleId: string, fn: () => Promise<T>): Promise<T> {
  return automationContext.run({ ruleId }, fn);
}
