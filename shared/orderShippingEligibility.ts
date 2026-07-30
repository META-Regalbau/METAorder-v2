import type { OrderStatus, PaymentStatus } from "./schema";

/** Zahlung bereit für Versand / Pickliste (Shopware: paid oder authorized). */
export function isPaymentReadyForShipping(paymentStatus: PaymentStatus | string | undefined): boolean {
  return paymentStatus === "paid" || paymentStatus === "authorized";
}

/**
 * Bestellstatus, aus dem noch gepickt/versendet werden kann.
 * Shopware lässt bezahlte Aufträge oft auf `open`, bis jemand „In Bearbeitung“ setzt —
 * Picklisten sollen diese trotzdem anbieten.
 */
export function isOrderStatusReadyForShipping(status: OrderStatus | string | undefined): boolean {
  return status === "open" || status === "in_progress";
}

export function isOrderEligibleForShippingPick(order: {
  status?: OrderStatus | string;
  paymentStatus?: PaymentStatus | string;
}): boolean {
  return isPaymentReadyForShipping(order.paymentStatus) && isOrderStatusReadyForShipping(order.status);
}
