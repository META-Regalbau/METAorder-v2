/**
 * Mondu an Bestellungen (Entscheidungen 18.10.2026):
 * - Shop-Bestellungen mit Mondu-Zahlart führt das Shopware-Plugin. Bricht der Kunde die Mondu-Zahlung ab,
 *   kann METAorder ihm per Knopf einen Link schicken, über den er die Zahlung im Shop erneut startet.
 * - MonduSell: METAorder legt die Mondu-Bestellung per Knopf über die Async-Orders-API an; Mondu prüft und
 *   schickt dem Käufer den Bestätigungslink. Bis zur Bestätigung gibt es nur einen Hinweis, keine Sperre.
 *   Die Rechnung geht beim Rechnungsversand automatisch an Mondu.
 */

/** Zustände einer Mondu-Bestellung (Async-Orders-API) */
export const MONDU_ORDER_STATES = [
  "processing",
  "pending",
  "authorized",
  "confirmed",
  "partially_shipped",
  "shipped",
  "partially_complete",
  "complete",
  "declined",
  "canceled",
] as const;

/** Mondu prüft noch oder der Käufer hat noch nicht bestätigt */
export const MONDU_SELL_WAITING_STATES = ["processing", "pending", "authorized"] as const;
/** Nach Ablehnung oder Storno darf eine neue Mondu-Sell-Bestellung angelegt werden */
export const MONDU_SELL_CLOSED_STATES = ["declined", "canceled"] as const;
/** Rechnungen nimmt Mondu nur in diesen Zuständen an */
export const MONDU_SELL_INVOICEABLE_STATES = ["confirmed", "partially_shipped"] as const;

export function isMonduSellWaiting(state: string | null | undefined): boolean {
  return !!state && (MONDU_SELL_WAITING_STATES as readonly string[]).includes(state);
}

export function isMonduSellClosed(state: string | null | undefined): boolean {
  return !!state && (MONDU_SELL_CLOSED_STATES as readonly string[]).includes(state);
}

export function isMonduSellInvoiceable(state: string | null | undefined): boolean {
  return !!state && (MONDU_SELL_INVOICEABLE_STATES as readonly string[]).includes(state);
}

/** Rechtsformen laut Mondu (legal_form_category); Einzelunternehmen brauchen Inhaber mit Geburtsdatum */
export const MONDU_LEGAL_FORMS = [
  "kapital_und_personen_gesellschaft",
  "einzelunternehmen",
  "offentliche_auftraggeber_einrichtung",
  "andere_gesellschaftsform",
] as const;
export type MonduLegalForm = (typeof MONDU_LEGAL_FORMS)[number];

/** Länder, die Mondu bei Adressen annimmt (ISO 3166 alpha-2) */
export const MONDU_COUNTRIES = [
  "DE", "AT", "NL", "FR", "BE", "GB", "CH", "DK", "ES", "GR", "HU", "IE", "IT", "LT", "NO", "PL",
  "PT", "RO", "SE", "CY", "CZ", "EE", "FI", "IS", "LV", "LU", "MT", "SK", "SI", "BG", "HR",
] as const;

export const MONDU_DEFAULT_NET_TERM = 30;

export type MonduHistoryEvent = {
  at: string;
  type: "created" | "state" | "invoice_submitted" | "invoice_waiting" | "invoice_failed" | "payment_link_sent" | "canceled" | "error";
  by?: string | null;
  state?: string;
  detail?: string;
  to?: string;
};

/** Warum keine Mondu-Sell-Bestellung angelegt werden kann */
export type MonduSellBlockedReason =
  | "not_configured"
  | "plugin_payment"
  | "order_cancelled"
  | "paid"
  | "zero_amount"
  | "currency"
  | "country"
  | "active_exists";

/** Warum die Mondu-Zahlung einer Shop-Bestellung nicht erneut gesendet werden kann */
export type MonduResendBlockedReason = "order_cancelled" | "payment_state" | "no_recipient" | "no_domain";

export type MonduSellInfo = {
  monduOrderUuid: string | null;
  externalReferenceId: string | null;
  state: string | null;
  stateReason: string | null;
  grossAmountCents: number | null;
  currency: string | null;
  buyerEmail: string | null;
  netTerm: number | null;
  attempt: number;
  invoicePending: boolean;
  invoiceUuid: string | null;
  invoiceNumber: string | null;
  invoiceState: string | null;
  lastError: string | null;
  history: MonduHistoryEvent[];
  createdBy: string | null;
  createdAt: string;
  lastCheckedAt: string | null;
};

export type MonduShopPaymentInfo = {
  /** Letzte Transaktion läuft über eine Mondu-Zahlart des Plugins */
  isMonduPayment: boolean;
  paymentMethodName: string | null;
  transactionState: string | null;
  canResend: boolean;
  blockedReason: MonduResendBlockedReason | null;
  recipientEmail: string | null;
  isGuest: boolean;
  link: string | null;
  preview: { subject: string; text: string } | null;
  history: MonduHistoryEvent[];
};

export type MonduOrderOverview = {
  configured: boolean;
  sandbox: boolean;
  shop: MonduShopPaymentInfo;
  sell: MonduSellInfo | null;
  canCreateSell: boolean;
  sellBlockedReason: MonduSellBlockedReason | null;
  defaults: {
    buyerEmail: string | null;
    netTerm: number;
    companyName: string | null;
    amountCents: number;
    currency: string | null;
  };
};

export type MonduSellCreateInput = {
  buyerEmail?: string;
  netTerm?: number | null;
  legalForm?: MonduLegalForm | null;
  owner?: { firstName: string; lastName: string; birthDate: string } | null;
};
