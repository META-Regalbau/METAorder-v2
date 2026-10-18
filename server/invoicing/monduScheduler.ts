/**
 * Mondu Sell, Abgleich (Entscheidungen 18.10.2026): alle 15 Minuten je Mandant mit Mondu-Schlüssel den Status
 * der offenen Mondu-Sell-Bestellungen nachlesen. Wartende (Prüfung/Käuferbestätigung) und vorgemerkte
 * Rechnungen bei jedem Takt, die übrigen alle 6 Stunden. Statuswechsel landen in der Glocke dessen, der die
 * Bestellung angelegt hat; nach der Bestätigung geht eine vorgemerkte Rechnung an Mondu.
 */
import type { MonduOrderRow } from "@shared/schema";
import { isMonduSellWaiting } from "@shared/mondu";
import type { IStorage } from "../storage";
import { runWithTenantContext } from "../lib/tenantContext";
import { notificationEvents } from "../lib/events";
import { logger } from "../lib/logger";
import * as repo from "./monduOrderRepository";
import { refreshMonduSellOrder } from "./monduSell";

const log = logger.child({ component: "invoicing/monduScheduler" });

export const MONDU_TICK_MS = 15 * 60 * 1000;
const SLOW_CHECK_MS = 6 * 60 * 60 * 1000;

/** Muss diese Zeile in diesem Takt abgefragt werden? */
export function isMonduCheckDue(row: Pick<MonduOrderRow, "state" | "invoicePending" | "lastCheckedAt">, now: Date): boolean {
  if (!row.state || isMonduSellWaiting(row.state) || row.invoicePending) return true;
  if (!row.lastCheckedAt) return true;
  return now.getTime() - row.lastCheckedAt.getTime() >= SLOW_CHECK_MS;
}

const STATE_TEXT: Record<string, string> = {
  pending: "wird von Mondu von Hand geprüft (bis zu 24 Stunden)",
  confirmed: "ist bestätigt – die Ware kann raus",
  declined: "wurde von Mondu abgelehnt",
  canceled: "wurde storniert",
  shipped: "ist bei Mondu vollständig abgerechnet",
  complete: "ist bezahlt",
};

/** Glockentext zum Statuswechsel, null = keine Meldung */
export function monduStateNotice(row: Pick<MonduOrderRow, "orderNumber" | "state" | "stateReason">): { title: string; message: string } | null {
  const text = row.state ? STATE_TEXT[row.state] : undefined;
  if (!text) return null;
  const reason = row.state === "declined" && row.stateReason ? ` (${row.stateReason})` : "";
  return {
    title: `Mondu Sell: ${row.orderNumber ?? "Bestellung"}`,
    message: `Die Mondu-Bestellung zu ${row.orderNumber ?? "der Bestellung"} ${text}${reason}.`,
  };
}

export async function runMonduTick(storage: IStorage, now = new Date()): Promise<void> {
  const tenants = await storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  for (const tenantId of tenantIds) {
    await runWithTenantContext(tenantId, async () => {
      try {
        const settings = await storage.getMonduSettings(tenantId);
        if (!settings?.apiKey) return;
        const rows = (await repo.listOpenSellOrders(tenantId)).filter((r) => isMonduCheckDue(r, now));
        for (const row of rows) {
          try {
            await refreshMonduSellOrder(tenantId, row.shopwareOrderId, {
              by: null,
              notify: async (saved) => {
                const notice = monduStateNotice(saved);
                if (!notice || !saved.createdBy) return;
                const created = await storage.createNotification(
                  {
                    userId: saved.createdBy,
                    type: "mondu",
                    title: notice.title,
                    message: notice.message,
                    link: saved.orderNumber ? `/orders?search=${encodeURIComponent(saved.orderNumber)}` : null,
                    read: 0,
                  },
                  tenantId,
                );
                notificationEvents.emitNotificationCreated(created);
              },
            });
          } catch (err) {
            log.warn({ err, tenantId, orderNumber: row.orderNumber }, "Mondu Sell: Status nicht abrufbar");
          }
        }
      } catch (err) {
        log.error({ err, tenantId }, "Mondu Sell: Abgleich fehlgeschlagen");
      }
    });
  }
}

/** Beim Serverstart: erster Takt nach 4 Minuten, danach alle 15 Minuten; Takte überlappen nie */
export function startMonduScheduler(storage: IStorage): () => void {
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runMonduTick(storage);
    } catch (err) {
      log.error({ err }, "Mondu Sell: Takt fehlgeschlagen");
    } finally {
      ticking = false;
    }
  };
  const first = setTimeout(tick, 4 * 60 * 1000);
  const timer = setInterval(tick, MONDU_TICK_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
