/**
 * Rechnungsnummer-Watcher: erkennt ueber den Bestell-Spiegel (Delta-Sync), wenn in
 * Shopware das Customfield custom_order_numbers_invoice neu gesetzt oder geaendert
 * wurde (z. B. direkt durch SAP), und erstellt dann die Rechnung – als E-Rechnung
 * und mit automatischem Versand gemaess den Rechnungs-Einstellungen des Mandanten.
 *
 * Bewusst nur bei einer Aenderung gegenueber dem letzten Spiegel-Stand: Bestellungen,
 * die beim ersten Sync bereits eine Nummer tragen, werden nicht angefasst.
 * Lieferscheine werden hier nicht erstellt (kommen meist vom Kunden).
 */
import type { Order } from "@shared/schema";
import type { IStorage } from "./storage";
import { type ShopwareClient, ZUGFERD_EMBEDDED_INVOICE_TYPE } from "./shopware";
import {
  getInvoiceAutomationSettings,
  markOrderInvoiceSentInCache,
  sendOrderInvoice,
} from "./invoiceSending";

export interface InvoiceNumberChange {
  order: Order;
  previousInvoiceNumber: string | null;
}

const normalize = (value: unknown): string | null => {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
};

/**
 * Aus den frisch synchronisierten Bestellungen die herausfiltern, deren
 * Rechnungsnummer sich gegenueber dem vorherigen Spiegel-Stand geaendert hat.
 */
export async function detectInvoiceNumberChanges(
  storage: IStorage,
  orders: Order[],
  tenantId: string | null,
): Promise<InvoiceNumberChange[]> {
  const changes: InvoiceNumberChange[] = [];
  for (const order of orders) {
    const current = normalize(order.invoiceNumber);
    if (!current) continue;
    const mirror = await storage.getShopwareOrderMirrorByShopwareId(order.id, tenantId);
    // Ohne vorherigen Stand (neue Bestellung / erster Sync) nichts automatisch anstossen.
    if (!mirror) {
      console.log(
        `[InvoiceWatcher] ${order.orderNumber ?? order.id}: Rechnungsnummer ${current} ohne vorherigen Spiegel-Stand – uebersprungen`,
      );
      continue;
    }
    const previous = normalize((mirror.payload as Partial<Order> | null)?.invoiceNumber);
    if (previous === current) {
      console.log(
        `[InvoiceWatcher] ${order.orderNumber ?? order.id}: Rechnungsnummer ${current} unveraendert – keine Aktion`,
      );
      continue;
    }
    changes.push({ order, previousInvoiceNumber: previous });
  }
  return changes;
}

/** Rechnungen fuer erkannte Nummern-Aenderungen erstellen und ggf. verschicken. */
export async function processInvoiceNumberChanges(
  storage: IStorage,
  client: ShopwareClient,
  tenantId: string | null,
  changes: InvoiceNumberChange[],
): Promise<{ created: number; sent: number; skipped: number; failed: number }> {
  const stats = { created: 0, sent: 0, skipped: 0, failed: 0 };
  if (changes.length === 0) return stats;

  const settings = await getInvoiceAutomationSettings(tenantId, storage as any);

  for (const { order, previousInvoiceNumber } of changes) {
    const invoiceNumber = normalize(order.invoiceNumber)!;
    const label = `${order.orderNumber ?? order.id} (${previousInvoiceNumber ?? "–"} → ${invoiceNumber})`;

    const logRun = async (
      status: "success" | "failed" | "skipped",
      extra: Record<string, unknown> = {},
    ) => {
      try {
        await storage.createErpAutomationRun(
          {
            orderId: order.id,
            orderNumber: order.orderNumber ?? null,
            trigger: "invoice_number",
            action: "create_invoice",
            status,
            errorMessage: typeof extra.errorMessage === "string" ? extra.errorMessage : undefined,
            metadata: { erpInvoiceNumber: invoiceNumber, previousInvoiceNumber, source: "shopware_mirror", ...extra },
          } as any,
          tenantId,
        );
      } catch (error) {
        console.warn("[InvoiceWatcher] Automations-Log konnte nicht geschrieben werden:", error);
      }
    };

    try {
      const check = await client.checkExistingDocument(order.id, "invoice", invoiceNumber);
      if (check.exists) {
        stats.skipped++;
        await logRun("skipped", { skippedReason: "Rechnung existiert bereits", shopwareInvoiceId: check.documentId });
        continue;
      }
      if (check.conflict) {
        stats.skipped++;
        const reason = `Bestellung hat bereits Rechnung ${check.documentNumber} – ${invoiceNumber} nicht erstellt`;
        console.warn(`[InvoiceWatcher] ⊘ ${label}: ${reason}`);
        await logRun("skipped", { skippedReason: reason });
        continue;
      }

      console.log(`[InvoiceWatcher] Erstelle Rechnung fuer ${label}`);
      const created = await client.createInvoice(
        order.id,
        invoiceNumber,
        order.erpNumber || undefined,
        undefined,
        // Bei Auto-Versand erst nach dem tatsaechlichen Versand als verschickt markieren.
        !settings.autoSend,
        { eInvoice: settings.eInvoice },
      );
      stats.created++;
      await logRun("success", {
        shopwareInvoiceId: created.documentId,
        eInvoice: created.documentType === ZUGFERD_EMBEDDED_INVOICE_TYPE,
        pdfReady: created.pdfReady,
      });

      if (!settings.autoSend) continue;

      if (!created.documentId || !created.pdfReady) {
        stats.failed++;
        console.warn(`[InvoiceWatcher] ! ${label}: PDF lag nicht vor – Versand uebersprungen`);
        await storage.createErpAutomationRun(
          {
            orderId: order.id,
            orderNumber: order.orderNumber ?? null,
            trigger: "invoice_number",
            action: "send_invoice",
            status: "failed",
            errorMessage: "Rechnung erstellt, aber das PDF lag noch nicht vor – bitte manuell verschicken.",
            metadata: { shopwareInvoiceId: created.documentId, source: "shopware_mirror" },
          } as any,
          tenantId,
        );
        continue;
      }

      const sendResult = await sendOrderInvoice(
        client,
        { id: order.id, orderNumber: order.orderNumber },
        { trigger: "invoice_number", tenantId, storage: storage as any, invoiceId: created.documentId },
      );
      if (sendResult.status === "sent") {
        stats.sent++;
        await markOrderInvoiceSentInCache(order.id, tenantId, storage as any);
        console.log(`[InvoiceWatcher] ✓ ${label}: Rechnung erstellt und verschickt`);
      } else if (sendResult.status === "failed") {
        stats.failed++;
        console.warn(`[InvoiceWatcher] ! ${label}: Versand fehlgeschlagen – ${sendResult.message}`);
      }
    } catch (error) {
      stats.failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[InvoiceWatcher] ✗ ${label}: ${message}`);
      await logRun("failed", { errorMessage: message });
    }
  }

  return stats;
}
