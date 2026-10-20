/**
 * Kundenmails B1: stündlicher Kontaktabgleich je Mandant (nur mit eingeschaltetem Schalter und Brevo-Schlüssel).
 * Versand gibt es in B1 nur per Knopf; Automatik je Mailart kommt mit B2–B5.
 */
import { logger } from "../lib/logger";
import { runWithTenantContext } from "../lib/tenantContext";
import type { IStorage } from "../storage";
import { customerMailDeps, getBrevoApiKey, getCustomerMailSettings, syncCustomerMailContacts, type CustomerMailDeps } from "./customerMailsRun";

const log = logger.child({ component: "customerMails/customerMailsScheduler" });

export const CUSTOMER_MAIL_TICK_MS = 60 * 60 * 1000;

const running = new Set<string>();
const lockKey = (tenantId: string | null) => tenantId ?? "__default__";

/** Abgleich für einen Mandanten; null, wenn gerade schon einer läuft */
export async function runCustomerMailSync(deps: CustomerMailDeps, tenantId: string | null) {
  const key = lockKey(tenantId);
  if (running.has(key)) return null;
  running.add(key);
  try {
    return await syncCustomerMailContacts(deps, tenantId);
  } finally {
    running.delete(key);
  }
}

export async function runCustomerMailTick(deps: CustomerMailDeps, storage: Pick<IStorage, "getAllTenants">): Promise<void> {
  const tenants = await storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  for (const tenantId of tenantIds) {
    await runWithTenantContext(tenantId, async () => {
      try {
        if (!(await getCustomerMailSettings(deps.storage, tenantId)).settings.enabled) return;
        if (!(await getBrevoApiKey(deps.storage, tenantId))) return;
        await runCustomerMailSync(deps, tenantId);
      } catch (err) {
        log.error({ err, tenantId }, "Kundenmails: Takt fehlgeschlagen");
      }
    });
  }
}

export function startCustomerMailScheduler(storage: IStorage): () => void {
  const deps = customerMailDeps(storage);
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runCustomerMailTick(deps, storage);
    } catch (err) {
      log.error({ err }, "Kundenmails: Takt fehlgeschlagen");
    } finally {
      ticking = false;
    }
  };
  const first = setTimeout(tick, 5 * 60 * 1000);
  const timer = setInterval(tick, CUSTOMER_MAIL_TICK_MS);
  first.unref?.();
  timer.unref?.();
  log.info({ intervalMinutes: CUSTOMER_MAIL_TICK_MS / 60000 }, "Kundenmails-Abgleich geplant");
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
