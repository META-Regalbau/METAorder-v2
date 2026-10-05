// Shopware: Versand (Lieferstatus, Versandmeldung) und Mondu-Transaktionen.
import type { ShopwareClient } from "../shopware";
import { parseTrackingCodes } from "@shared/tracking";
import { getLatestDelivery, isMonduPluginShipError } from "./mapping";

/**
 * Update order shipping information and set status to "shipped"
 * This combines setting tracking codes and transitioning the delivery state
 *
 * Sendungsnummern: "A, B" (Komma, Semikolon oder Zeilenumbruch) sind mehrere Nummern - frueher
 * landete die ganze Eingabe als eine Nummer in Shopware. Geschrieben wird an die neueste Lieferung
 * (wie die Anzeige), ohne Nummern, die schon an einer anderen Lieferung haengen.
 * trackingMode "replace" (Sammel-Eingabe): die Eingabe ist die vollstaendige Liste der neuesten Lieferung.
 * "add" (Sendcloud, je Paket ein Aufruf): Nummer zu den vorhandenen hinzufuegen statt sie zu ersetzen.
 * "all" (Formular im Bestelldetail, zeigt die Nummern aller Lieferungen): die Eingabe ist die
 *   vollstaendige Liste der Bestellung - entfernte Nummern verschwinden auch an aelteren Lieferungen,
 *   ein leeres Feld leert alle (vorher blieb eine Nummer an einer aelteren Lieferung stehen, und
 *   leeren ging gar nicht).
 */
export async function updateOrderShipping(
  this: ShopwareClient,
  orderId: string,
  shippingInfo: {
    carrier?: string;
    trackingNumber?: string;
    shippedDate?: string;
  },
  options: { trackingMode?: "replace" | "add" | "all" } = {}
): Promise<void> {
  try {
    // Step 1: Fetch order to get delivery ID
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/order/${orderId}?associations[deliveries][]`,
      {
        method: 'GET',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch order: ${response.statusText} - ${errorText}`);
    }

    const orderData = await response.json();
    const deliveries = orderData.data?.deliveries || [];

    if (deliveries.length === 0) {
      throw new Error('Order has no deliveries');
    }

    // Neueste Lieferung (die Reihenfolge in der Antwort ist nicht festgelegt)
    const delivery = getLatestDelivery(deliveries);
    const deliveryId = delivery.id;
    const codesOf = (d: any): string[] => (Array.isArray(d?.trackingCodes) ? d.trackingCodes.map((c: unknown) => String(c ?? "").trim()).filter(Boolean) : []);

    // Step 2: Update tracking codes if provided
    const enteredCodes = parseTrackingCodes(shippingInfo.trackingNumber);
    const ownCodes = codesOf(delivery);
    const allCodes = options.trackingMode === "add" ? parseTrackingCodes([...ownCodes, ...enteredCodes].join("\n")) : enteredCodes;
    const patchCodes = async (id: string, trackingCodes: string[]) => {
      const updateResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/order-delivery/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ trackingCodes }),
      });
      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.warn(`Warning: Failed to update tracking codes: ${updateResponse.statusText} - ${errorText}`);
        // Continue anyway - tracking codes are optional
      }
    };
    const sameCodes = (a: string[], b: string[]) => a.length === b.length && a.every((code, i) => code === b[i]);

    if (options.trackingMode === "all") {
      // Aeltere Lieferungen: nur Nummern behalten, die noch in der Eingabe stehen
      const entered = new Set(enteredCodes);
      const kept = new Set<string>();
      for (const other of deliveries.filter((d: any) => d.id !== deliveryId)) {
        const before = codesOf(other);
        const after = before.filter((code) => entered.has(code));
        after.forEach((code) => kept.add(code));
        if (!sameCodes(before, after)) await patchCodes(other.id, after);
      }
      // Neueste Lieferung: der Rest der Eingabe
      const target = enteredCodes.filter((code) => !kept.has(code));
      if (!sameCodes(ownCodes, target)) await patchCodes(deliveryId, target);
    } else if (enteredCodes.length > 0) {
      const elsewhere = new Set(deliveries.filter((d: any) => d.id !== deliveryId).flatMap(codesOf));
      await patchCodes(deliveryId, allCodes.filter((code) => !elsewhere.has(code)));
    }

    // Step 3: Transition delivery state to "shipped"
    await this.transitionOrderDeliveryToShipped(orderId, deliveryId);

    // Step 4: Persist shipping info in order customFields (for analytics / Versandzeiten)
    const customFields: Record<string, string> = {};
    if (shippingInfo.shippedDate) customFields.meta_shipped_date = shippingInfo.shippedDate;
    if (shippingInfo.carrier) customFields.meta_shipped_carrier = shippingInfo.carrier;
    // Kopie fuer Anzeige/Statistik; "all" auch leer, sonst zeigte die Bestellung die geloeschten Nummern weiter
    if (enteredCodes.length > 0 || options.trackingMode === "all") customFields.meta_shipped_tracking = allCodes.join(", ");
    if (Object.keys(customFields).length > 0) {
      const orderPatchResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/order/${orderId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customFields }),
        }
      );
      if (!orderPatchResponse.ok) {
        const errorText = await orderPatchResponse.text();
        console.warn(`Warning: Failed to persist shipping customFields on order: ${orderPatchResponse.statusText} - ${errorText}`);
      }
    }

    console.log(`Order ${orderId} marked as shipped in Shopware`);
  } catch (error) {
    console.error('Error updating order shipping:', error);
    throw error;
  }
}

/**
 * Set order status to shipped
 */
export async function setOrderShipped(this: ShopwareClient, orderId: string): Promise<void> {
  try {
    console.log(`[Shopware API] Setting order ${orderId} to shipped status`);

    // First get the "shipped" state machine state ID
    const stateResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/state-machine-state`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equals',
              field: 'technicalName',
              value: 'shipped',
            },
            {
              type: 'equals',
              field: 'stateMachine.technicalName',
              value: 'order_delivery.state',
            },
          ],
        }),
      }
    );

    if (!stateResponse.ok) {
      const errorText = await stateResponse.text();
      throw new Error(`Failed to get shipped state: ${stateResponse.statusText} - ${errorText}`);
    }

    const stateData = await stateResponse.json();
    const shippedState = stateData.data?.[0];

    if (!shippedState) {
      throw new Error('Shipped state not found in Shopware');
    }

    // Get order deliveries
    const orderResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/order`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equals',
              field: 'id',
              value: orderId,
            },
          ],
          associations: {
            deliveries: {},
          },
        }),
      }
    );

    if (!orderResponse.ok) {
      const errorText = await orderResponse.text();
      throw new Error(`Failed to get order deliveries: ${orderResponse.statusText} - ${errorText}`);
    }

    const orderData = await orderResponse.json();
    const order = orderData.data?.[0];
    const delivery = order?.deliveries?.data?.[0] || order?.deliveries?.[0];

    if (!delivery) {
      throw new Error('No delivery found for order');
    }

    await this.transitionOrderDeliveryToShipped(orderId, delivery.id);

    console.log(`[Shopware API] Order ${orderId} set to shipped status successfully`);
  } catch (error) {
    console.error('Error setting order to shipped:', error);
    throw error;
  }
}

export function isMonduPaymentHandler(this: ShopwareClient, transaction: any): boolean {
  const handler =
    transaction?.paymentMethod?.handlerIdentifier ??
    transaction?.attributes?.paymentMethod?.handlerIdentifier;
  return typeof handler === "string" && handler.startsWith("Mondu\\MonduPayment\\");
}

export function getTransactionStateTechnicalName(this: ShopwareClient, transaction: any): string | null {
  return (
    transaction?.stateMachineState?.technicalName ??
    transaction?.attributes?.stateMachineState?.technicalName ??
    null
  );
}

/**
 * Storniert aeltere Mondu-Transaktionen, wenn im Checkout die Zahlart gewechselt
 * wurde (z. B. Mondu → PayPal). Das Mondu-Plugin wertet sonst oft noch die
 * Historie und blockiert den Lieferstatus "versandt" mit "Corrupt order".
 */
export async function cancelSupersededMonduTransactions(this: ShopwareClient, orderId: string): Promise<number> {
  const response = await this.makeAuthenticatedRequest(
    `${this.baseUrl}/api/search/order`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: [{ type: "equals", field: "id", value: orderId }],
        associations: {
          transactions: {
            associations: { paymentMethod: {}, stateMachineState: {} },
            sort: [{ field: "createdAt", order: "DESC" }],
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to load order transactions for Mondu cleanup: ${response.statusText} - ${errorText}`,
    );
  }

  const data = await response.json();
  const transactions: any[] = data.data?.[0]?.transactions ?? [];
  if (transactions.length <= 1) return 0;

  const sorted = [...transactions].sort((a, b) => {
    const ta = new Date(a?.createdAt ?? a?.attributes?.createdAt ?? 0).getTime();
    const tb = new Date(b?.createdAt ?? b?.attributes?.createdAt ?? 0).getTime();
    return tb - ta;
  });

  const latestId = sorted[0]?.id;
  let cancelled = 0;

  for (const transaction of sorted) {
    if (!transaction?.id || transaction.id === latestId) continue;
    if (!this.isMonduPaymentHandler(transaction)) continue;

    const state = this.getTransactionStateTechnicalName(transaction);
    if (state === "cancelled" || state === "failed") continue;

    const cancelResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/order_transaction/${transaction.id}/state/cancel`,
      { method: "POST", body: JSON.stringify({}) },
    );

    if (cancelResponse.ok) {
      cancelled += 1;
      console.log(
        `[Shopware] Cancelled superseded Mondu transaction ${transaction.id} on order ${orderId}`,
      );
    } else {
      const errorText = await cancelResponse.text();
      console.warn(
        `[Shopware] Could not cancel Mondu transaction ${transaction.id} on order ${orderId}: ${cancelResponse.statusText} - ${errorText}`,
      );
    }
  }

  return cancelled;
}

/**
 * Lieferung auf "versandt" setzen. Bei Zahlartwechsel (historische Mondu-Transaktion,
 * aktive Zahlart nicht Mondu) wird bei Mondu-Plugin-Fehler zuerst aufgeraeumt und
 * erneut versucht.
 */
export async function transitionOrderDeliveryToShipped(this: ShopwareClient, orderId: string, deliveryId: string): Promise<void> {
  const monduInfo = await this.getMonduShipInfo(orderId);
  if (
    monduInfo.deliveryState === "shipped" ||
    monduInfo.deliveryState === "shipped_partially"
  ) {
    return;
  }

  const shipOnce = async () => {
    const stateResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/order_delivery/${deliveryId}/state/ship`,
      { method: "POST", body: JSON.stringify({}) },
    );
    if (!stateResponse.ok) {
      const errorText = await stateResponse.text();
      throw new Error(
        `Failed to set order to shipped: ${stateResponse.statusText} - ${errorText}`,
      );
    }
  };

  try {
    await shipOnce();
    return;
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    if (
      !monduInfo.isMondu &&
      monduInfo.hasHistoricalMonduTransaction &&
      isMonduPluginShipError(message)
    ) {
      console.log(
        `[Shopware] Mondu plugin blocked ship for order ${orderId} ` +
          `(active payment: ${monduInfo.activePaymentMethod ?? "?"}), cleaning stale Mondu transactions…`,
      );
      const cancelled = await this.cancelSupersededMonduTransactions(orderId);
      if (cancelled > 0) {
        try {
          await shipOnce();
          console.log(
            `[Shopware] Ship succeeded for order ${orderId} after cancelling ${cancelled} stale Mondu transaction(s)`,
          );
          return;
        } catch (retryError) {
          const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
          throw new Error(`MONDU_SHIP_BLOCKED_AFTER_PAYMENT_SWITCH: ${retryMsg}`);
        }
      }
      throw new Error(`MONDU_SHIP_BLOCKED_AFTER_PAYMENT_SWITCH: ${message}`);
    }
    throw firstError;
  }
}

/**
 * Ermittelt, ob es sich um eine Mondu-Bestellung handelt (Zahlart-Handler aus
 * dem offiziellen Mondu-Plugin, z. B. Mondu\MonduPayment\...\MonduHandler) und
 * liefert die erste Lieferung samt aktuellem Lieferstatus.
 *
 * Hintergrund: Das Mondu-Plugin uebergibt die Rechnung NUR beim Lieferstatus-
 * Uebergang auf "versandt" mit genau einem angehaengten Rechnungsdokument an
 * Mondu (entspricht dem Haken "Rechnung anhaengen"). Reine Mailversand-Hooks
 * gibt es nicht.
 */
export async function getMonduShipInfo(this: ShopwareClient, orderId: string): Promise<{
  isMondu: boolean;
  deliveryId: string | null;
  deliveryState: string | null;
  /** Name der aktuell gueltigen Zahlart (juengste Transaktion). */
  activePaymentMethod?: string | null;
  /** true, wenn aeltere Transaktionen noch Mondu waren (Checkout-Zahlart gewechselt). */
  hasHistoricalMonduTransaction?: boolean;
}> {
  const response = await this.makeAuthenticatedRequest(
    `${this.baseUrl}/api/search/order`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: [{ type: 'equals', field: 'id', value: orderId }],
        associations: {
          transactions: {
            associations: { paymentMethod: {} },
            sort: [{ field: 'createdAt', order: 'DESC' }],
          },
          deliveries: { associations: { stateMachineState: {} } },
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to load order for Mondu check: ${response.statusText} - ${errorText}`
    );
  }

  const data = await response.json();
  const order = data.data?.[0];

  const transactions: any[] = order?.transactions ?? [];
  const sortedTransactions = [...transactions].sort((a, b) => {
    const ta = new Date(a?.createdAt ?? a?.attributes?.createdAt ?? 0).getTime();
    const tb = new Date(b?.createdAt ?? b?.attributes?.createdAt ?? 0).getTime();
    return tb - ta;
  });

  const isMonduHandler = (t: any): boolean => this.isMonduPaymentHandler(t);

  const latestTransaction = sortedTransactions[0];
  const isMondu = latestTransaction ? isMonduHandler(latestTransaction) : false;
  const hasHistoricalMonduTransaction =
    !isMondu && sortedTransactions.some((t) => isMonduHandler(t));

  const activePaymentMethod =
    latestTransaction?.paymentMethod?.translated?.name ??
    latestTransaction?.paymentMethod?.name ??
    null;

  const delivery = order?.deliveries?.[0];
  const deliveryState =
    delivery?.stateMachineState?.technicalName ?? null;

  if (hasHistoricalMonduTransaction) {
    console.log(
      `[Mondu] Order ${orderId}: aktive Zahlart "${activePaymentMethod ?? "?"}" ist nicht Mondu, ` +
        `aber aeltere Mondu-Transaktion(en) vorhanden — Rechnungsversand per E-Mail.`,
    );
  }

  return {
    isMondu,
    deliveryId: delivery?.id ?? null,
    deliveryState,
    activePaymentMethod,
    hasHistoricalMonduTransaction,
  };
}

/**
 * Setzt eine Lieferung auf "versandt" und haengt die uebergebenen Dokumente an
 * (documentIds). Shopware legt daraus die Context-Extension "mail-attachments"
 * an; das Mondu-Plugin liest daraus genau ein Rechnungsdokument und uebertraegt
 * die Rechnung an Mondu (Aequivalent zum Haken "Rechnung anhaengen"). Zusaetzlich
 * loest der Uebergang den konfigurierten Shopware-Flow aus (Versandmail an den
 * Kunden, ggf. Bestellung -> abgeschlossen).
 */
export async function shipDeliveryWithDocuments(this: ShopwareClient, deliveryId: string, documentIds: string[]): Promise<void> {
  const response = await this.makeAuthenticatedRequest(
    `${this.baseUrl}/api/_action/order_delivery/${deliveryId}/state/ship`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentIds, mediaIds: [] }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to ship delivery ${deliveryId}: ${response.statusText} - ${errorText}`
    );
  }
}

/**
 * Versanddatum je Lieferung aus der Status-Historie: Zeitpunkt des letzten Uebergangs nach
 * "versendet" (Shopware speichert an der Lieferung selbst kein Versanddatum). Gebatcht, nur lesend.
 */
export async function fetchDeliveryShippedDates(this: ShopwareClient, deliveryIds: string[]): Promise<Map<string, string>> {
  const shippedAt = new Map<string, string>();
  const ids = Array.from(new Set(deliveryIds.filter(Boolean)));
  const CHUNK = 200;
  const LIMIT = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    for (let page = 1; ; page++) {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/state-machine-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page,
          limit: LIMIT,
          includes: { state_machine_history: ['referencedId', 'createdAt'] },
          filter: [
            { type: 'equals', field: 'entityName', value: 'order_delivery' },
            { type: 'equals', field: 'toStateMachineState.technicalName', value: 'shipped' },
            { type: 'equalsAny', field: 'referencedId', value: chunk },
          ],
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch delivery state history: ${response.statusText} - ${errorText}`);
      }
      const data = await response.json();
      const entries: any[] = data?.data ?? [];
      for (const e of entries) {
        const id = e?.referencedId ?? e?.attributes?.referencedId;
        const at = e?.createdAt ?? e?.attributes?.createdAt;
        if (!id || !at) continue;
        const current = shippedAt.get(id);
        if (!current || at > current) shippedAt.set(id, at);
      }
      if (entries.length < LIMIT) break;
    }
  }
  return shippedAt;
}
