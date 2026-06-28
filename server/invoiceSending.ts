/**
 * Gemeinsame Logik zum Verschicken der Rechnung ueber die Shopware-Funktion
 * (Dokument per Mail an den Kunden senden + document.sent = true).
 *
 * Wird genutzt von:
 *  - Manueller Klick in der Bestelluebersicht (POST /api/orders/:orderId/send-invoice)
 *  - Vorbereitung fuer Automatisierung (Import / API-Eintrag der Rechnungsnummer):
 *    einfach sendOrderInvoice(...) aufrufen.
 */
import { ShopwareClient, getRealInvoiceDocument } from "./shopware";
import { storage as defaultStorage } from "./storage";

export type SendInvoiceStatus =
  | "sent"
  | "already_sent"
  | "no_invoice"
  | "failed";

export interface SendInvoiceResult {
  status: SendInvoiceStatus;
  invoiceId?: string;
  invoiceNumber?: string;
  message?: string;
  /**
   * true, wenn der Versand ueber den Mondu-Weg (Lieferstatus -> versandt mit
   * angehaengter Rechnung) gelaufen ist und die Rechnung damit an Mondu uebergeben
   * wurde.
   */
  mondu?: boolean;
}

export interface SendOrderInvoiceOptions {
  /** Welcher Ausloeser den Versand angestossen hat (fuer das Automations-Log). */
  trigger?: "invoice_number" | "delivery_note" | "order_number" | "manual";
  /** Auch dann senden, wenn das Dokument schon als verschickt markiert ist. */
  force?: boolean;
  /** Tenant fuer das Automations-Log. */
  tenantId?: string | null;
  /** Storage-Implementierung (Default: globaler Storage). */
  storage?: typeof defaultStorage;
  /** Automations-Lauf protokollieren (Default: true). */
  log?: boolean;
}

/**
 * Verschickt die "echte" Rechnung einer Bestellung ueber Shopware und markiert
 * sie als verschickt. Idempotent: ist sie bereits verschickt, wird ohne force
 * nicht erneut gesendet.
 */
export async function sendOrderInvoice(
  client: ShopwareClient,
  order: { id: string; orderNumber?: string | null },
  options: SendOrderInvoiceOptions = {},
): Promise<SendInvoiceResult> {
  const storage = options.storage ?? defaultStorage;
  const trigger = options.trigger ?? "manual";
  const shouldLog = options.log !== false;
  const orderNumber = order.orderNumber ?? undefined;

  const logRun = async (
    status: "success" | "failed" | "skipped",
    extra: { errorMessage?: string; invoiceId?: string; emailSent?: boolean; skippedReason?: string } = {},
  ) => {
    if (!shouldLog) return;
    try {
      await storage.createErpAutomationRun(
        {
          orderId: order.id,
          orderNumber: orderNumber ?? null,
          trigger,
          action: "send_invoice",
          status,
          errorMessage: extra.errorMessage,
          metadata: {
            shopwareInvoiceId: extra.invoiceId,
            emailSent: extra.emailSent,
            skippedReason: extra.skippedReason,
          },
        } as any,
        options.tenantId ?? null,
      );
    } catch (logError) {
      console.warn("[sendOrderInvoice] Failed to write automation log:", logError);
    }
  };

  try {
    const documents = await client.fetchOrderDocuments(order.id);
    const invoice = getRealInvoiceDocument(documents);

    if (!invoice || !invoice.id) {
      await logRun("skipped", { skippedReason: "Keine Rechnung vorhanden" });
      return { status: "no_invoice", message: "Keine Rechnung vorhanden" };
    }

    if (invoice.sent && !options.force) {
      await logRun("skipped", {
        invoiceId: invoice.id,
        skippedReason: "Rechnung bereits verschickt",
      });
      return {
        status: "already_sent",
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        message: "Rechnung wurde bereits verschickt",
      };
    }

    // Mondu-Bestellungen: Die Rechnung wird ueber den Lieferstatus-Uebergang
    // "versandt" mit angehaengter Rechnung an Mondu uebergeben (entspricht dem
    // Shopware-Haken "Rechnung anhaengen"). Der Uebergang loest zusaetzlich den
    // Shopware-Flow aus (Versandmail an den Kunden + Bestellung -> abgeschlossen).
    // Einen reinen Mailversand-Hook fuer Mondu gibt es nicht.
    const monduInfo = await client.getMonduShipInfo(order.id);
    if (monduInfo.isMondu) {
      const alreadyShipped =
        monduInfo.deliveryState === "shipped" ||
        monduInfo.deliveryState === "shipped_partially";

      if (alreadyShipped && !options.force) {
        // Bereits versandt -> Mondu hat die Rechnung bereits erhalten.
        try {
          await client.setDocumentSent(invoice.id, true);
        } catch {
          // sent-Flag ist nur fuer das Badge relevant.
        }
        await logRun("skipped", {
          invoiceId: invoice.id,
          skippedReason: "Mondu-Bestellung bereits versandt",
        });
        return {
          status: "already_sent",
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          mondu: true,
          message:
            "Bestellung ist bereits versandt – die Rechnung wurde bereits an Mondu uebergeben.",
        };
      }

      if (!monduInfo.deliveryId) {
        const historyHint = monduInfo.hasHistoricalMonduTransaction
          ? " (Hinweis: aeltere Mondu-Transaktionen in der Bestellhistorie — aktuelle Zahlart pruefen.)"
          : "";
        const message =
          `Mondu-Bestellung ohne Lieferung in Shopware – Versand an Mondu nicht moeglich.${historyHint}`;
        await logRun("failed", { invoiceId: invoice.id, errorMessage: message });
        return {
          status: "failed",
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          mondu: true,
          message,
        };
      }

      // Lieferung auf "versandt" setzen + Rechnung anhaengen -> Mondu-Uebergabe.
      // Wirft das Mondu-Plugin einen Fehler (z. B. Mondu-Status nicht bestaetigt),
      // schlaegt der Uebergang fehl und wir landen im catch.
      await client.shipDeliveryWithDocuments(monduInfo.deliveryId, [invoice.id]);

      // Dokument als verschickt markieren (fuer das Badge in der Uebersicht).
      try {
        await client.setDocumentSent(invoice.id, true);
      } catch (err) {
        console.warn(
          `[sendOrderInvoice] Mondu-Versand ok, aber sent-Flag nicht gesetzt (${invoice.id}):`,
          err,
        );
      }

      await logRun("success", { invoiceId: invoice.id, emailSent: true });
      return {
        status: "sent",
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        mondu: true,
        message:
          "Bestellung als versandt markiert, Rechnung an den Kunden verschickt und an Mondu uebergeben.",
      };
    }

    // Shopware-Funktion: Dokument per Mail an den Kunden senden.
    await client.sendInvoiceEmail(order.id, invoice.id);

    // Sicherstellen, dass der sent-Status gesetzt ist (Shopware markiert das beim
    // Mailversand nicht zuverlaessig selbst).
    let markError: unknown = null;
    try {
      await client.setDocumentSent(invoice.id, true);
    } catch (err) {
      markError = err;
      console.warn(
        `[sendOrderInvoice] Mail gesendet, aber sent-Flag konnte nicht gesetzt werden (${invoice.id}):`,
        err,
      );
    }

    // Verifikation: tatsaechlichen sent-Status direkt aus Shopware nachlesen.
    const verifiedSent = await client.getDocumentSentStatus(invoice.id);

    if (verifiedSent !== true) {
      const reason =
        verifiedSent === false
          ? "Shopware meldet die Rechnung weiterhin als nicht verschickt (sent=false)."
          : "Versandstatus konnte in Shopware nicht verifiziert werden.";
      const markMsg =
        markError instanceof Error ? ` (${markError.message})` : "";
      const message = `Rechnung-Mail ausgeloest, aber Verifikation fehlgeschlagen: ${reason}${markMsg}`;
      await logRun("failed", {
        invoiceId: invoice.id,
        emailSent: true,
        errorMessage: message,
      });
      return {
        status: "failed",
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        message,
      };
    }

    await logRun("success", { invoiceId: invoice.id, emailSent: true });

    return {
      status: "sent",
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      message: "Rechnung verschickt und in Shopware als verschickt verifiziert",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logRun("failed", { errorMessage: message });
    return { status: "failed", message };
  }
}
