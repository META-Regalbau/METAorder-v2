/**
 * Mondu an Bestellungen (Entscheidungen 18.10.2026, shared/mondu.ts):
 *
 * 1. Shop-Bestellung, Mondu-Zahlung abgebrochen: Das Shopware-Plugin führt die Zahlung. Shopware lässt die
 *    Zahlung bei offener/fehlgeschlagener Transaktion erneut starten (Mondu-Zahlarten haben „Zahlung nach
 *    Bestellung“ an). METAorder schickt dem Kunden nur den Link auf seine Bestellung im Shop, über Shopwares
 *    Mailversand; es entsteht keine Mondu-Bestellung neben dem Plugin.
 * 2. MonduSell: Knopf an der Bestellung legt die Mondu-Bestellung über die Async-Orders-API an
 *    (external_reference_id = Bestellnummer, nur der Gesamtbetrag wie bisher im Mondu-Portal). Mondu prüft und
 *    mailt dem Käufer den Bestätigungslink. Den Status holt der Abgleich (monduScheduler.ts) oder der Knopf
 *    „Status aktualisieren“; Webhooks braucht es dafür nicht.
 * 3. Rechnung: Nach dem Rechnungsversand geht das PDF an Mondu. Ist die Bestellung noch nicht bestätigt, merkt
 *    sich METAorder das (invoice_pending) und der Abgleich reicht sie nach der Bestätigung nach.
 */
import {
  MONDU_COUNTRIES,
  MONDU_DEFAULT_NET_TERM,
  MONDU_LEGAL_FORMS,
  isMonduSellClosed,
  isMonduSellInvoiceable,
  type MonduOrderOverview,
  type MonduResendBlockedReason,
  type MonduSellBlockedReason,
  type MonduSellCreateInput,
  type MonduShopPaymentInfo,
} from "@shared/mondu";
import type { MonduOrderRow, MonduSettings } from "@shared/schema";
import { ShopwareClient, getRealInvoiceDocument } from "../shopware/shopware";
import { storage as defaultStorage } from "../storage";
import { logger } from "../lib/logger";
import { MonduApiError, MonduClient, type MonduApiOrder } from "./mondu";
import * as repo from "./monduOrderRepository";

const log = logger.child({ component: "invoicing/monduSell" });

/** Fehler mit Code für die Oberfläche (apiErrors.codes.<code>) */
export class MonduSellError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "MonduSellError";
  }
}

/* ------------------------------------------------------------------ reine Hilfen (getestet) */

const MONDU_HANDLER_PREFIX = "Mondu\\MonduPayment\\";
/** In diesen Zuständen lässt Shopware die Zahlung erneut starten und das Plugin hat noch nicht bestätigt */
export const RESENDABLE_TRANSACTION_STATES = ["open", "failed", "reminded", "unconfirmed"] as const;

const technicalState = (entity: any): string | null =>
  entity?.stateMachineState?.technicalName ?? entity?.attributes?.stateMachineState?.technicalName ?? null;

/** Jüngste Transaktion der Bestellung (Zahlartwechsel legt neue an) */
export function latestTransaction(order: any): any | null {
  const list: any[] = Array.isArray(order?.transactions) ? [...order.transactions] : [];
  if (!list.length) return null;
  list.sort((a, b) => String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? "")));
  return list[list.length - 1];
}

export function isMonduPluginTransaction(tx: any): boolean {
  const handler = tx?.paymentMethod?.handlerIdentifier;
  return typeof handler === "string" && handler.startsWith(MONDU_HANDLER_PREFIX);
}

/** Storefront-Adresse des Bestell-Kanals: Domain in Bestellsprache, https bevorzugt */
export function storefrontBaseUrl(order: any): string | null {
  const domains: any[] = Array.isArray(order?.salesChannel?.domains) ? order.salesChannel.domains : [];
  const urls = domains.filter((d) => typeof d?.url === "string" && /^https?:\/\//.test(d.url));
  if (!urls.length) return null;
  const score = (d: any) => (d.languageId === order.languageId ? 2 : 0) + (d.url.startsWith("https://") ? 1 : 0);
  const best = [...urls].sort((a, b) => score(b) - score(a))[0];
  return String(best.url).replace(/\/$/, "");
}

/**
 * Link, über den der Kunde die Zahlung im Shop erneut startet. Angemeldete Kunden: Seite „Bestellung
 * bearbeiten“ (Shopware fragt die Anmeldung ab). Gäste können sich nicht anmelden; sie öffnen die Bestellung
 * über den Bestell-Link und bestätigen E-Mail-Adresse und Postleitzahl.
 */
export function monduRetryLink(baseUrl: string, order: { id: string; deepLinkCode?: string | null }, isGuest: boolean): string {
  if (isGuest && order.deepLinkCode) return `${baseUrl}/account/order/${order.deepLinkCode}`;
  return `${baseUrl}/account/order/edit/${order.id}`;
}

function formatAmount(amount: number, currency: string | null | undefined): string {
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency || "EUR" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/** Shopware rendert Mailtexte als Twig: geschweifte Klammern aus Fremdtexten entfernen */
const noTwig = (s: string) => s.replace(/[{}]/g, "");
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type PaymentLinkMailValues = {
  customerName: string;
  orderNumber: string;
  amount: string;
  paymentMethod: string;
  link: string;
  isGuest: boolean;
};

/** Mail „Zahlung noch offen“ (nur Deutsch; Mondu gibt es nur im DE-Shop) */
export function buildPaymentLinkMail(v: PaymentLinkMailValues): { subject: string; text: string; html: string } {
  const name = noTwig(v.customerName.trim());
  const values = {
    orderNumber: noTwig(v.orderNumber),
    amount: noTwig(v.amount),
    paymentMethod: noTwig(v.paymentMethod),
    link: noTwig(v.link),
  };
  const subject = `Ihre Bestellung ${values.orderNumber}: Zahlung noch offen`;
  const accessHint = v.isGuest
    ? "Zum Öffnen Ihrer Bestellung fragt der Shop Ihre E-Mail-Adresse und die Postleitzahl Ihrer Rechnungsadresse ab."
    : "Bitte melden Sie sich dazu mit Ihrem Kundenkonto an.";
  const paragraphs = [
    name ? `Guten Tag ${name},` : "Guten Tag,",
    `vielen Dank für Ihre Bestellung ${values.orderNumber} über ${values.amount}.`,
    `Sie haben als Zahlungsart „${values.paymentMethod}“ gewählt. Die Zahlung über unseren Partner Mondu ist noch nicht abgeschlossen.`,
    `Über diesen Link können Sie die Zahlung jetzt abschließen oder eine andere Zahlungsart wählen:`,
    values.link,
    accessHint,
    "Bei Fragen antworten Sie einfach auf diese E-Mail.",
    "Freundliche Grüße\nIhr Team von META",
  ];
  const text = paragraphs.join("\n\n");
  const html = paragraphs
    .map((p) =>
      p === values.link
        ? `<p><a href="${escapeHtml(values.link)}">${escapeHtml(values.link)}</a></p>`
        : `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n");
  return { subject, text, html };
}

/** Kann die Mondu-Zahlung dieser Shop-Bestellung erneut gesendet werden? */
export function shopPaymentRetryInfo(order: any): Omit<MonduShopPaymentInfo, "link" | "preview" | "history"> & { baseUrl: string | null } {
  const tx = latestTransaction(order);
  const isMonduPayment = isMonduPluginTransaction(tx);
  const transactionState = technicalState(tx);
  const oc = order?.orderCustomer ?? {};
  const recipientEmail: string | null = oc.email ?? null;
  const isGuest = oc.customer?.guest === true;
  const baseUrl = storefrontBaseUrl(order);
  let blockedReason: MonduResendBlockedReason | null = null;
  if (technicalState(order) === "cancelled") blockedReason = "order_cancelled";
  else if (!transactionState || !(RESENDABLE_TRANSACTION_STATES as readonly string[]).includes(transactionState)) blockedReason = "payment_state";
  else if (!recipientEmail) blockedReason = "no_recipient";
  else if (!baseUrl) blockedReason = "no_domain";
  return {
    isMonduPayment,
    paymentMethodName: tx?.paymentMethod?.translated?.name ?? tx?.paymentMethod?.name ?? null,
    transactionState,
    canResend: isMonduPayment && blockedReason === null,
    blockedReason: isMonduPayment ? blockedReason : null,
    recipientEmail,
    isGuest,
    baseUrl,
  };
}

/** Kann die Bestellung an Mondu Sell übergeben werden? */
export function sellBlockedReason(order: any, row: MonduOrderRow | null, configured: boolean): MonduSellBlockedReason | null {
  if (!configured) return "not_configured";
  if (row && !isMonduSellClosed(row.state)) return "active_exists";
  if (isMonduPluginTransaction(latestTransaction(order))) return "plugin_payment";
  if (technicalState(order) === "cancelled") return "order_cancelled";
  const txState = technicalState(latestTransaction(order));
  if (txState === "paid" || txState === "paid_partially") return "paid";
  if (!(Number(order?.amountTotal) > 0)) return "zero_amount";
  const currency = order?.currency?.isoCode;
  if (currency !== "EUR" && currency !== "GBP") return "currency";
  const country = order?.billingAddress?.country?.iso;
  if (!country || !(MONDU_COUNTRIES as readonly string[]).includes(country)) return "country";
  return null;
}

/** USt-IdNr. plausibel? Shopware-vatIds enthalten teils Handelsregisternummern („HRB22047“) */
export function isPlausibleVatId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.replace(/\s/g, "").toUpperCase();
  const prefix = v === "" ? "" : v.slice(0, 2) === "EL" ? "GR" : v.slice(0, 2);
  return (MONDU_COUNTRIES as readonly string[]).includes(prefix) && /^[A-Z]{2}[0-9A-Z]{8,12}$/.test(v) && /\d{6}/.test(v);
}

function monduAddress(address: any) {
  const out: Record<string, string> = {
    country_code: address?.country?.iso ?? "",
    city: String(address?.city ?? "").trim(),
    zip_code: String(address?.zipcode ?? "").trim(),
    address_line1: String(address?.street ?? "").trim(),
  };
  const line2 = [address?.additionalAddressLine1, address?.additionalAddressLine2].filter((s) => typeof s === "string" && s.trim()).join(", ");
  if (line2) out.address_line2 = line2;
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Anfrage für POST /orders/create_async aus der Shopware-Bestellung. Nur Gesamtbetrag ohne Positionen, wie
 * bisher bei MonduSell im Portal (Positionen müssten centgenau zum Betrag passen).
 */
export function buildMonduSellPayload(
  order: any,
  input: MonduSellCreateInput,
  externalReferenceId: string,
): Record<string, unknown> {
  const oc = order?.orderCustomer ?? {};
  const billing = order?.billingAddress ?? {};
  const shippingAddress = order?.deliveries?.[0]?.shippingOrderAddress ?? billing;
  const email = (input.buyerEmail ?? oc.email ?? "").trim();
  if (!EMAIL_RE.test(email)) throw new MonduSellError("mondu_sell_invalid_email", 400, "Ungültige E-Mail-Adresse des Käufers");
  const firstName = String(oc.firstName ?? billing.firstName ?? "").trim();
  const lastName = String(oc.lastName ?? billing.lastName ?? "").trim();
  if (!firstName || !lastName) throw new MonduSellError("mondu_sell_missing_name", 400, "Vor- und Nachname des Käufers fehlen");

  const buyer: Record<string, unknown> = { email, first_name: firstName, last_name: lastName };
  const company = String(billing.company ?? oc.company ?? "").trim();
  if (company) buyer.company_name = company;
  const phone = String(billing.phoneNumber ?? "").trim();
  if (phone) buyer.phone = phone;
  const vat = (Array.isArray(oc.vatIds) ? oc.vatIds : []).find(isPlausibleVatId);
  if (vat) buyer.vat_number = vat.replace(/\s/g, "").toUpperCase();
  if (oc.customerNumber) buyer.external_reference_id = String(oc.customerNumber);
  if (input.legalForm) {
    if (!(MONDU_LEGAL_FORMS as readonly string[]).includes(input.legalForm)) {
      throw new MonduSellError("mondu_sell_invalid_input", 400, "Ungültige Rechtsform");
    }
    buyer.legal_form_category = input.legalForm;
  }

  const payload: Record<string, unknown> = {
    currency: order?.currency?.isoCode ?? "EUR",
    external_reference_id: externalReferenceId,
    payment_method: "invoice",
    language: "de",
    gross_amount_cents: Math.round(Number(order.amountTotal) * 100),
    buyer,
    billing_address: monduAddress(billing),
    shipping_address: monduAddress(shippingAddress),
  };
  if (input.netTerm) payload.net_term = input.netTerm;
  if (input.legalForm === "einzelunternehmen") {
    const o = input.owner;
    if (!o?.firstName?.trim() || !o?.lastName?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(o?.birthDate ?? "")) {
      throw new MonduSellError("mondu_sell_owner_required", 400, "Bei Einzelunternehmen braucht Mondu Inhaber und Geburtsdatum");
    }
    payload.owners = [{ first_name: o.firstName.trim(), last_name: o.lastName.trim(), birth_date: o.birthDate, is_authorized: true }];
  }
  for (const [key, address] of [["billing_address", payload.billing_address], ["shipping_address", payload.shipping_address]] as const) {
    const a = address as Record<string, string>;
    if (!a.country_code || !a.city || !a.zip_code || !a.address_line1) {
      throw new MonduSellError("mondu_sell_incomplete_address", 400, `Adresse unvollständig (${key})`);
    }
  }
  return payload;
}

/** Lesbarer Grund aus der Mondu-Antwort (Ablehnung, Prüfung, fehlende Daten) */
export function monduStateReason(o: MonduApiOrder): string | null {
  return (
    o.decline_reason ||
    o.cancelation_reason ||
    o.data_required_reason ||
    o.pending_reason_description ||
    o.state_description ||
    null
  );
}

/* ------------------------------------------------------------------ Shopware und Mondu */

type Deps = {
  storage: Pick<typeof defaultStorage, "getShopwareSettings" | "getMonduSettings" | "getUser" | "createNotification">;
  repo: typeof repo;
  monduClient: (settings: MonduSettings) => Pick<MonduClient, "createAsyncOrder" | "getOrderState" | "cancelOrder" | "submitInvoice">;
  shopwareClient: (settings: Awaited<ReturnType<typeof defaultStorage.getShopwareSettings>> & object) => ShopwareClient;
};

const defaultDeps: Deps = {
  storage: defaultStorage,
  repo,
  monduClient: (s) => new MonduClient(s),
  shopwareClient: (s) => new ShopwareClient(s),
};

async function shopware(deps: Deps, tenantId: string | null): Promise<ShopwareClient> {
  const settings = await deps.storage.getShopwareSettings(tenantId);
  if (!settings) throw new MonduSellError("shopware_not_configured", 400, "Shopware ist nicht eingerichtet");
  return deps.shopwareClient(settings);
}

async function mondu(deps: Deps, tenantId: string | null) {
  const settings = await deps.storage.getMonduSettings(tenantId);
  if (!settings?.apiKey) throw new MonduSellError("mondu_not_configured", 400, "Mondu ist nicht eingerichtet");
  return deps.monduClient(settings);
}

/** Bestellung mit allem, was Mondu und die Mail brauchen */
export async function loadOrderForMondu(client: ShopwareClient, orderId: string): Promise<any | null> {
  const response = await client.makeAuthenticatedRequest(`${client.baseUrl}/api/search/order`, {
    method: "POST",
    body: JSON.stringify({
      ids: [orderId],
      limit: 1,
      associations: {
        stateMachineState: {},
        currency: {},
        orderCustomer: { associations: { customer: {} } },
        billingAddress: { associations: { country: {} } },
        deliveries: { associations: { shippingOrderAddress: { associations: { country: {} } } } },
        transactions: { associations: { paymentMethod: {}, stateMachineState: {} } },
        salesChannel: { associations: { domains: {} } },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Bestellung ${orderId} nicht lesbar: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const data = await response.json();
  return data?.data?.[0] ?? null;
}

async function requireOrder(client: ShopwareClient, orderId: string): Promise<any> {
  const order = await loadOrderForMondu(client, orderId);
  if (!order) throw new MonduSellError("mondu_order_not_found", 404, "Bestellung nicht gefunden");
  return order;
}

function mailValues(order: any, info: ReturnType<typeof shopPaymentRetryInfo>): PaymentLinkMailValues | null {
  if (!info.baseUrl) return null;
  const oc = order.orderCustomer ?? {};
  return {
    customerName: [oc.firstName, oc.lastName].filter(Boolean).join(" "),
    orderNumber: String(order.orderNumber ?? ""),
    amount: formatAmount(Number(order.amountTotal ?? 0), order.currency?.isoCode),
    paymentMethod: info.paymentMethodName ?? "Rechnungskauf",
    link: monduRetryLink(info.baseUrl, order, info.isGuest),
    isGuest: info.isGuest,
  };
}

/** Alles für den Mondu-Kasten an der Bestellung */
export async function getMonduOverview(tenantId: string | null, orderId: string, deps: Deps = defaultDeps): Promise<MonduOrderOverview> {
  const client = await shopware(deps, tenantId);
  const order = await requireOrder(client, orderId);
  const monduSettings = await deps.storage.getMonduSettings(tenantId);
  const configured = !!monduSettings?.apiKey;
  const [sellRow, shopRow] = await Promise.all([
    deps.repo.getMonduOrder(tenantId, orderId, "sell"),
    deps.repo.getMonduOrder(tenantId, orderId, "shop"),
  ]);

  const info = shopPaymentRetryInfo(order);
  const values = info.isMonduPayment ? mailValues(order, info) : null;
  const mail = values ? buildPaymentLinkMail(values) : null;
  const { baseUrl: _baseUrl, ...shopInfo } = info;
  const blocked = sellBlockedReason(order, sellRow, configured);
  const billing = order.billingAddress ?? {};

  return {
    configured,
    sandbox: !!monduSettings?.sandboxMode,
    shop: {
      ...shopInfo,
      link: values?.link ?? null,
      preview: mail ? { subject: mail.subject, text: mail.text } : null,
      history: repo.historyOf(shopRow),
    },
    sell: sellRow ? repo.rowToSellInfo(sellRow) : null,
    canCreateSell: blocked === null,
    sellBlockedReason: blocked,
    defaults: {
      buyerEmail: order.orderCustomer?.email ?? null,
      netTerm: sellRow?.netTerm ?? MONDU_DEFAULT_NET_TERM,
      companyName: billing.company ?? order.orderCustomer?.company ?? null,
      amountCents: Math.round(Number(order.amountTotal ?? 0) * 100),
      currency: order.currency?.isoCode ?? null,
    },
  };
}

/** Teil 1: Mail mit Link auf die Bestellung im Shop, dort startet der Kunde die Mondu-Zahlung erneut */
export async function resendMonduPaymentLink(
  tenantId: string | null,
  orderId: string,
  opts: { email?: string; userName: string | null },
  deps: Deps = defaultDeps,
): Promise<{ to: string; link: string }> {
  const client = await shopware(deps, tenantId);
  const order = await requireOrder(client, orderId);
  const info = shopPaymentRetryInfo(order);
  if (!info.isMonduPayment || !info.canResend) {
    throw new MonduSellError(
      "mondu_resend_not_possible",
      409,
      "Für diese Bestellung kann die Mondu-Zahlung nicht erneut gesendet werden",
      info.blockedReason ?? "no_mondu_payment",
    );
  }
  const to = (opts.email ?? "").trim() || info.recipientEmail!;
  if (!EMAIL_RE.test(to)) throw new MonduSellError("mondu_sell_invalid_email", 400, "Ungültige E-Mail-Adresse");
  const values = mailValues(order, info)!;
  const mail = buildPaymentLinkMail(values);

  // Absender wie bei Rechnungen: DE-Kanal und shop@meta-online.com (getInvoiceMailContext)
  const ctx = await client.getInvoiceMailContext(orderId);
  const extraHeaders: Record<string, string> = {};
  if (ctx.languageId) extraHeaders["sw-language-id"] = ctx.languageId;
  const response = await client.makeAuthenticatedRequest(`${client.baseUrl}/api/_action/mail-template/send`, {
    method: "POST",
    headers: extraHeaders,
    body: JSON.stringify({
      recipients: { [to]: values.customerName || to },
      senderEmail: process.env.SHOPWARE_INVOICE_SENDER_EMAIL?.trim() || "shop@meta-online.com",
      senderName: "{{ salesChannel.name }}",
      salesChannelId: ctx.salesChannelId,
      subject: mail.subject,
      contentHtml: mail.html,
      contentPlain: mail.text,
      mediaIds: [],
      mailTemplateData: { order: ctx.order, salesChannel: ctx.salesChannel },
    }),
  });
  if (!response.ok) {
    throw new MonduSellError("mondu_mail_failed", 502, "Mail konnte nicht gesendet werden", (await response.text()).slice(0, 300));
  }
  const result = (await response.json().catch(() => null)) as { size?: number } | null;
  if (result?.size === 0) {
    throw new MonduSellError("mondu_mail_failed", 502, "Mail konnte nicht gesendet werden", "Shopware hat keine Mail erzeugt (size=0)");
  }

  const row = await deps.repo.getMonduOrder(tenantId, orderId, "shop");
  await deps.repo.saveMonduOrder(tenantId, orderId, "shop", {
    orderNumber: order.orderNumber ?? null,
    state: info.transactionState,
    history: repo.withEvent(row, { at: new Date().toISOString(), type: "payment_link_sent", by: opts.userName, to }),
  });
  log.info({ orderNumber: order.orderNumber, to }, "Mondu-Zahlung erneut gesendet");
  return { to, link: values.link };
}

function monduFailure(err: unknown): MonduSellError {
  if (err instanceof MonduSellError) return err;
  if (err instanceof MonduApiError) {
    if (err.status === 401 || err.status === 403) {
      return new MonduSellError("mondu_forbidden", 502, "Mondu verweigert den Zugriff (API-Schlüssel oder Freischaltung prüfen)", err.detail);
    }
    return new MonduSellError("mondu_rejected", 502, "Mondu hat die Anfrage abgelehnt", err.detail);
  }
  return new MonduSellError("mondu_unreachable", 502, "Mondu ist nicht erreichbar", err instanceof Error ? err.message : String(err));
}

/** Teil 2: Mondu-Sell-Bestellung anlegen */
export async function createMonduSellOrder(
  tenantId: string | null,
  orderId: string,
  input: MonduSellCreateInput,
  user: { id: string | null; name: string | null },
  deps: Deps = defaultDeps,
): Promise<MonduOrderRow> {
  const client = await shopware(deps, tenantId);
  const monduApi = await mondu(deps, tenantId);
  const order = await requireOrder(client, orderId);
  const row = await deps.repo.getMonduOrder(tenantId, orderId, "sell");
  const blocked = sellBlockedReason(order, row, true);
  if (blocked) {
    throw new MonduSellError("mondu_sell_not_possible", 409, "Diese Bestellung kann nicht an Mondu Sell übergeben werden", blocked);
  }
  // Ein neuer Versuch nach Ablehnung/Storno bekommt eine eigene Referenz (Mondu kennt die alte schon)
  const attempt = row ? row.attempt + 1 : 1;
  const externalReferenceId = attempt > 1 ? `${order.orderNumber}-${attempt}` : String(order.orderNumber);
  const netTerm = input.netTerm ?? MONDU_DEFAULT_NET_TERM;
  const payload = buildMonduSellPayload(order, { ...input, netTerm }, externalReferenceId);

  let created: MonduApiOrder;
  try {
    created = await monduApi.createAsyncOrder(payload);
  } catch (err) {
    const failure = monduFailure(err);
    log.warn({ orderNumber: order.orderNumber, detail: failure.detail }, "Mondu Sell: Anlage abgelehnt");
    throw failure;
  }
  const now = new Date();
  const saved = await deps.repo.saveMonduOrder(tenantId, orderId, "sell", {
    orderNumber: order.orderNumber ?? null,
    monduOrderUuid: created.uuid,
    externalReferenceId,
    state: created.state ?? "processing",
    stateReason: monduStateReason(created),
    grossAmountCents: payload.gross_amount_cents as number,
    currency: payload.currency as string,
    buyerEmail: (payload.buyer as { email: string }).email,
    netTerm,
    attempt,
    invoicePending: false,
    invoiceUuid: null,
    invoiceNumber: null,
    invoiceState: null,
    lastError: null,
    createdBy: user.id,
    createdAt: now,
    lastCheckedAt: now,
    history: repo.withEvent(row, { at: now.toISOString(), type: "created", by: user.name, state: created.state, to: (payload.buyer as { email: string }).email }),
  });
  log.info({ orderNumber: order.orderNumber, uuid: created.uuid, state: created.state }, "Mondu Sell: Bestellung angelegt");
  return saved;
}

export type MonduSellInvoiceResult = {
  status: "submitted" | "waiting" | "failed" | "skipped";
  message: string;
};

/**
 * Rechnung an Mondu: aktuelle echte Rechnung der Bestellung als PDF. Ohne bestätigte Mondu-Bestellung wird
 * sie vorgemerkt (der Abgleich reicht sie nach). Dieselbe Rechnungsnummer geht nur einmal raus.
 */
export async function submitMonduSellInvoice(
  tenantId: string | null,
  orderId: string,
  opts: { by: string | null; invoiceId?: string; client?: ShopwareClient },
  deps: Deps = defaultDeps,
): Promise<MonduSellInvoiceResult> {
  const row = await deps.repo.getMonduOrder(tenantId, orderId, "sell");
  if (!row?.monduOrderUuid || isMonduSellClosed(row.state)) {
    return { status: "skipped", message: "Keine aktive Mondu-Sell-Bestellung" };
  }
  const at = new Date().toISOString();
  if (!isMonduSellInvoiceable(row.state)) {
    if (row.invoiceUuid) return { status: "skipped", message: "Rechnung liegt Mondu schon vor" };
    await deps.repo.saveMonduOrder(tenantId, orderId, "sell", {
      invoicePending: true,
      history: row.invoicePending ? repo.historyOf(row) : repo.withEvent(row, { at, type: "invoice_waiting", by: opts.by, state: row.state ?? undefined }),
    });
    return { status: "waiting", message: "Der Kunde hat bei Mondu noch nicht bestätigt – die Rechnung geht nach der Bestätigung an Mondu" };
  }

  const client = opts.client ?? (await shopware(deps, tenantId));
  const documents = await client.fetchOrderDocuments(orderId);
  const invoice = opts.invoiceId ? documents.find((d) => d.id === opts.invoiceId) : getRealInvoiceDocument(documents);
  if (!invoice?.id || !invoice.deepLinkCode || !invoice.number) {
    return { status: "skipped", message: "Keine Rechnung vorhanden" };
  }
  if (row.invoiceUuid && row.invoiceNumber === invoice.number) {
    if (row.invoicePending) await deps.repo.saveMonduOrder(tenantId, orderId, "sell", { invoicePending: false });
    return { status: "skipped", message: "Rechnung liegt Mondu schon vor" };
  }
  const amount = invoice.amountGross ?? null;
  const grossAmountCents = amount != null ? Math.round(amount * 100) : row.grossAmountCents;
  if (!grossAmountCents) return { status: "failed", message: "Rechnungsbetrag unbekannt" };

  try {
    const monduApi = await mondu(deps, tenantId);
    const pdf = await client.downloadDocumentPdfBuffer(invoice.id, invoice.deepLinkCode);
    const result = await monduApi.submitInvoice({
      orderUuid: row.monduOrderUuid,
      externalReferenceId: invoice.number,
      grossAmountCents,
      invoicePdf: pdf,
      invoiceFileName: `Rechnung-${invoice.number}.pdf`,
    });
    await deps.repo.saveMonduOrder(tenantId, orderId, "sell", {
      invoicePending: false,
      invoiceUuid: result.invoice?.uuid ?? null,
      invoiceNumber: invoice.number,
      invoiceState: result.invoice?.state ?? null,
      lastError: null,
      history: repo.withEvent(row, { at, type: "invoice_submitted", by: opts.by, detail: invoice.number }),
    });
    log.info({ orderNumber: row.orderNumber, invoice: invoice.number }, "Mondu Sell: Rechnung übergeben");
    return { status: "submitted", message: `Rechnung ${invoice.number} an Mondu übergeben` };
  } catch (err) {
    const failure = monduFailure(err);
    const detail = failure.detail ? `${failure.message}: ${failure.detail}` : failure.message;
    await deps.repo.saveMonduOrder(tenantId, orderId, "sell", {
      invoicePending: true,
      lastError: detail,
      history: repo.withEvent(row, { at, type: "invoice_failed", by: opts.by, detail }),
    });
    log.warn({ orderNumber: row.orderNumber, detail }, "Mondu Sell: Rechnung nicht übergeben");
    return { status: "failed", message: detail };
  }
}

/**
 * Status bei Mondu nachlesen. Bei Wechsel Verlauf und Glocke für den Anleger; bestätigt und Rechnung
 * vorgemerkt → Rechnung nachreichen.
 */
export async function refreshMonduSellOrder(
  tenantId: string | null,
  orderId: string,
  opts: { by: string | null; notify?: (row: MonduOrderRow, previousState: string | null) => Promise<void> },
  deps: Deps = defaultDeps,
): Promise<MonduOrderRow> {
  const row = await deps.repo.getMonduOrder(tenantId, orderId, "sell");
  if (!row?.monduOrderUuid) throw new MonduSellError("mondu_sell_not_found", 404, "Keine Mondu-Sell-Bestellung vorhanden");
  const monduApi = await mondu(deps, tenantId);
  let current: MonduApiOrder;
  try {
    current = await monduApi.getOrderState(row.monduOrderUuid);
  } catch (err) {
    throw monduFailure(err);
  }
  const now = new Date();
  const changed = current.state !== row.state;
  let saved = await deps.repo.saveMonduOrder(tenantId, orderId, "sell", {
    state: current.state,
    stateReason: monduStateReason(current),
    lastCheckedAt: now,
    history: changed ? repo.withEvent(row, { at: now.toISOString(), type: "state", by: opts.by, state: current.state }) : repo.historyOf(row),
  });
  if (changed && opts.notify) {
    await opts.notify(saved, row.state).catch((err) => log.warn({ err }, "Mondu Sell: Benachrichtigung fehlgeschlagen"));
  }
  if (saved.invoicePending && isMonduSellInvoiceable(saved.state)) {
    await submitMonduSellInvoice(tenantId, orderId, { by: opts.by }, deps);
    saved = (await deps.repo.getMonduOrder(tenantId, orderId, "sell")) ?? saved;
  }
  return saved;
}

/** Mondu-Sell-Bestellung stornieren (z. B. falsch angelegt); danach ist ein neuer Versuch möglich */
export async function cancelMonduSellOrder(
  tenantId: string | null,
  orderId: string,
  user: { name: string | null },
  deps: Deps = defaultDeps,
): Promise<MonduOrderRow> {
  const row = await deps.repo.getMonduOrder(tenantId, orderId, "sell");
  if (!row?.monduOrderUuid) throw new MonduSellError("mondu_sell_not_found", 404, "Keine Mondu-Sell-Bestellung vorhanden");
  if (isMonduSellClosed(row.state)) return row;
  if (row.invoiceUuid) {
    throw new MonduSellError("mondu_sell_has_invoice", 409, "Mondu hat schon eine Rechnung – bitte im Mondu-Portal stornieren");
  }
  const monduApi = await mondu(deps, tenantId);
  let canceled: MonduApiOrder | null;
  try {
    canceled = await monduApi.cancelOrder(row.monduOrderUuid);
  } catch (err) {
    throw monduFailure(err);
  }
  const now = new Date();
  return deps.repo.saveMonduOrder(tenantId, orderId, "sell", {
    state: canceled?.state ?? "canceled",
    invoicePending: false,
    lastCheckedAt: now,
    history: repo.withEvent(row, { at: now.toISOString(), type: "canceled", by: user.name }),
  });
}

/** Für den Rechnungsversand: hat die Bestellung eine aktive Mondu-Sell-Bestellung? */
export async function hasActiveMonduSell(tenantId: string | null, orderId: string, deps: Pick<Deps, "repo"> = defaultDeps): Promise<boolean> {
  const row = await deps.repo.getMonduOrder(tenantId, orderId, "sell");
  return !!row?.monduOrderUuid && !isMonduSellClosed(row.state);
}
