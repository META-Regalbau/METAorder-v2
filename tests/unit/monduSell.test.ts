/**
 * Mondu an Bestellungen (Entscheidungen 18.10.2026): Zahlungslink für abgebrochene Shop-Zahlungen,
 * MonduSell-Anlage über die Async-Orders-API, Rechnungsübergabe und Abgleich.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import type { MonduOrderRow } from "@shared/schema";
import {
  MonduSellError,
  buildMonduSellPayload,
  buildPaymentLinkMail,
  isPlausibleVatId,
  latestTransaction,
  monduRetryLink,
  sellBlockedReason,
  shopPaymentRetryInfo,
  storefrontBaseUrl,
  submitMonduSellInvoice,
} from "../../server/invoicing/monduSell";
import { monduErrorDetail } from "../../server/invoicing/mondu";
import { isMonduCheckDue, monduStateNotice } from "../../server/invoicing/monduScheduler";
import { historyOf, withEvent } from "../../server/invoicing/monduOrderRepository";

const MONDU = "Mondu\\MonduPayment\\Components\\PaymentMethod\\PaymentHandler\\MonduHandler";
const INVOICE = "Shopware\\Core\\Checkout\\Payment\\Cart\\PaymentHandler\\InvoicePayment";

function tx(handler: string, state: string, createdAt: string, name = "Rechnungskauf (30 Tage)") {
  return { createdAt, paymentMethod: { handlerIdentifier: handler, name }, stateMachineState: { technicalName: state } };
}

function order(overrides: Record<string, any> = {}) {
  return {
    id: "o1",
    orderNumber: "MO102983",
    deepLinkCode: "abcDEF123",
    languageId: "lang-de",
    amountTotal: 149.94,
    stateMachineState: { technicalName: "open" },
    currency: { isoCode: "EUR" },
    orderCustomer: {
      email: "einkauf@kunde.de",
      firstName: "Erika",
      lastName: "Muster",
      customerNumber: "12345",
      vatIds: ["HRB22047"],
      customer: { guest: false },
    },
    billingAddress: {
      company: "Muster GmbH",
      street: "Hauptstr. 1",
      zipcode: "57299",
      city: "Burbach",
      phoneNumber: "02736 123",
      country: { iso: "DE" },
    },
    deliveries: [],
    transactions: [tx(MONDU, "open", "2026-10-14T10:00:00Z")],
    salesChannel: {
      domains: [
        { url: "http://shop.example.de", languageId: "lang-de" },
        { url: "https://shop.example.com/en", languageId: "lang-en" },
        { url: "https://shop.example.de", languageId: "lang-de" },
      ],
    },
    ...overrides,
  };
}

describe("Shop-Bestellung: Mondu-Zahlung erneut senden", () => {
  it("jüngste Transaktion zählt (Zahlartwechsel legt neue an)", () => {
    const o = order({ transactions: [tx(MONDU, "cancelled", "2026-10-14T10:00:00Z"), tx(INVOICE, "open", "2026-10-15T10:00:00Z")] });
    expect(latestTransaction(o).paymentMethod.handlerIdentifier).toBe(INVOICE);
    expect(shopPaymentRetryInfo(o).isMonduPayment).toBe(false);
  });

  it("offen und fehlgeschlagen dürfen erneut gesendet werden, bezahlt/autorisiert nicht", () => {
    expect(shopPaymentRetryInfo(order()).canResend).toBe(true);
    expect(shopPaymentRetryInfo(order({ transactions: [tx(MONDU, "failed", "x")] })).canResend).toBe(true);
    for (const state of ["paid", "authorized", "cancelled"]) {
      const info = shopPaymentRetryInfo(order({ transactions: [tx(MONDU, state, "x")] }));
      expect(info.canResend).toBe(false);
      expect(info.blockedReason).toBe("payment_state");
    }
    expect(shopPaymentRetryInfo(order({ stateMachineState: { technicalName: "cancelled" } })).blockedReason).toBe("order_cancelled");
  });

  it("Shop-Adresse in Bestellsprache mit https", () => {
    expect(storefrontBaseUrl(order())).toBe("https://shop.example.de");
    expect(storefrontBaseUrl(order({ salesChannel: { domains: [] } }))).toBeNull();
  });

  it("Link: angemeldete Kunden auf „Bestellung bearbeiten“, Gäste über den Bestell-Link", () => {
    expect(monduRetryLink("https://shop.example.de", order(), false)).toBe("https://shop.example.de/account/order/edit/o1");
    expect(monduRetryLink("https://shop.example.de", order(), true)).toBe("https://shop.example.de/account/order/abcDEF123");
  });

  it("Mail ohne Twig-Klammern aus Fremdtexten, Hinweis je nach Gast/Konto", () => {
    const mail = buildPaymentLinkMail({
      customerName: "Erika {{ dump() }} Muster",
      orderNumber: "MO102983",
      amount: "149,94 €",
      paymentMethod: "Rechnungskauf (30 Tage)",
      link: "https://shop.example.de/account/order/abc",
      isGuest: true,
    });
    expect(mail.subject).toBe("Ihre Bestellung MO102983: Zahlung noch offen");
    expect(mail.html).not.toMatch(/[{}]/);
    expect(mail.text).toContain("Postleitzahl");
    expect(mail.html).toContain('<a href="https://shop.example.de/account/order/abc">');
    const member = buildPaymentLinkMail({ customerName: "", orderNumber: "MO1", amount: "1 €", paymentMethod: "X", link: "https://x", isGuest: false });
    expect(member.text.startsWith("Guten Tag,")).toBe(true);
    expect(member.text).toContain("Kundenkonto");
  });
});

describe("MonduSell: Anlage", () => {
  const sellRow = (state: string | null) => ({ state }) as MonduOrderRow;

  it("Sperrgründe", () => {
    const invoiceOrder = order({ transactions: [tx(INVOICE, "open", "x", "Rechnung (30 Tage netto/Mondu Sell)")] });
    expect(sellBlockedReason(invoiceOrder, null, true)).toBeNull();
    expect(sellBlockedReason(invoiceOrder, null, false)).toBe("not_configured");
    expect(sellBlockedReason(order(), null, true)).toBe("plugin_payment");
    expect(sellBlockedReason(invoiceOrder, sellRow("authorized"), true)).toBe("active_exists");
    expect(sellBlockedReason(invoiceOrder, sellRow("declined"), true)).toBeNull();
    expect(sellBlockedReason({ ...invoiceOrder, transactions: [tx(INVOICE, "paid", "x")] }, null, true)).toBe("paid");
    expect(sellBlockedReason({ ...invoiceOrder, currency: { isoCode: "CHF" } }, null, true)).toBe("currency");
    expect(sellBlockedReason({ ...invoiceOrder, billingAddress: { country: { iso: "US" } } }, null, true)).toBe("country");
  });

  it("USt-IdNr.: Handelsregisternummern fallen raus", () => {
    expect(isPlausibleVatId("DE123456789")).toBe(true);
    expect(isPlausibleVatId("ATU12345678")).toBe(true);
    expect(isPlausibleVatId("HRB22047")).toBe(false);
    expect(isPlausibleVatId("")).toBe(false);
  });

  it("Anfrage: Gesamtbetrag in Cent, Käufer, Adressen, Bestellnummer als Referenz", () => {
    const payload = buildMonduSellPayload(
      order({ deliveries: [{ shippingOrderAddress: { street: "Lager 2", zipcode: "10115", city: "Berlin", country: { iso: "DE" } } }] }),
      { netTerm: 30 },
      "MO102983",
    );
    expect(payload).toMatchObject({
      currency: "EUR",
      external_reference_id: "MO102983",
      payment_method: "invoice",
      language: "de",
      gross_amount_cents: 14994,
      net_term: 30,
      buyer: {
        email: "einkauf@kunde.de",
        first_name: "Erika",
        last_name: "Muster",
        company_name: "Muster GmbH",
        phone: "02736 123",
        external_reference_id: "12345",
      },
      billing_address: { country_code: "DE", city: "Burbach", zip_code: "57299", address_line1: "Hauptstr. 1" },
      shipping_address: { city: "Berlin", address_line1: "Lager 2" },
    });
    expect((payload.buyer as any).vat_number).toBeUndefined();
    expect(payload.lines).toBeUndefined();
  });

  it("Anfrage: Einzelunternehmen brauchen Inhaber mit Geburtsdatum, E-Mail wird geprüft", () => {
    expect(() => buildMonduSellPayload(order(), { legalForm: "einzelunternehmen" }, "X")).toThrow(MonduSellError);
    const ok = buildMonduSellPayload(
      order(),
      { legalForm: "einzelunternehmen", owner: { firstName: "Erika", lastName: "Muster", birthDate: "1970-01-31" } },
      "X",
    );
    expect(ok.owners).toEqual([{ first_name: "Erika", last_name: "Muster", birth_date: "1970-01-31", is_authorized: true }]);
    expect(() => buildMonduSellPayload(order(), { buyerEmail: "kein-mail" }, "X")).toThrow(/E-Mail/);
  });

  it("Fehlertext aus der Mondu-Antwort", () => {
    expect(monduErrorDetail('{"errors":[{"name":"buyer.email","details":"is invalid"}]}')).toBe("buyer.email: is invalid");
    expect(monduErrorDetail('{"message":"Forbidden"}')).toBe("Forbidden");
    expect(monduErrorDetail("")).toBe("keine Angabe");
  });
});

describe("MonduSell: Rechnung und Abgleich", () => {
  function fakeDeps(row: Partial<MonduOrderRow> | null) {
    let current = row ? ({ history: [], attempt: 1, ...row } as MonduOrderRow) : null;
    const saves: any[] = [];
    const submitInvoice = vi.fn(async () => ({ invoice: { uuid: "inv-1", state: "created", external_reference_id: "RE-1" } }));
    const client = {
      fetchOrderDocuments: vi.fn(async () => [
        { id: "d1", type: "invoice", number: "RE-1001", deepLinkCode: "dl", amountGross: 149.94 },
      ]),
      downloadDocumentPdfBuffer: vi.fn(async () => Buffer.from("%PDF")),
    };
    const deps = {
      storage: { getMonduSettings: async () => ({ apiKey: "k", sandboxMode: true }) } as any,
      repo: {
        getMonduOrder: async () => current,
        saveMonduOrder: async (_t: any, _o: any, _k: any, patch: any) => {
          saves.push(patch);
          current = { ...(current as MonduOrderRow), ...patch };
          return current;
        },
        historyOf,
        withEvent,
      } as any,
      monduClient: () => ({ submitInvoice }) as any,
      shopwareClient: () => client as any,
    };
    return { deps, saves, submitInvoice, client, get row() { return current; } };
  }

  it("noch nicht bestätigt: Rechnung vormerken, nichts an Mondu", async () => {
    const f = fakeDeps({ monduOrderUuid: "u1", state: "authorized" });
    const result = await submitMonduSellInvoice(null, "o1", { by: "test", client: f.client as any }, f.deps as any);
    expect(result.status).toBe("waiting");
    expect(f.submitInvoice).not.toHaveBeenCalled();
    expect(f.row?.invoicePending).toBe(true);
  });

  it("bestätigt: PDF mit Rechnungsnummer und Betrag in Cent an Mondu, danach nicht doppelt", async () => {
    const f = fakeDeps({ monduOrderUuid: "u1", state: "confirmed", invoicePending: true, grossAmountCents: 14994 });
    const result = await submitMonduSellInvoice(null, "o1", { by: "test", client: f.client as any }, f.deps as any);
    expect(result.status).toBe("submitted");
    expect(f.submitInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ orderUuid: "u1", externalReferenceId: "RE-1001", grossAmountCents: 14994 }),
    );
    expect(f.row).toMatchObject({ invoicePending: false, invoiceUuid: "inv-1", invoiceNumber: "RE-1001" });
    const again = await submitMonduSellInvoice(null, "o1", { by: "test", client: f.client as any }, f.deps as any);
    expect(again.status).toBe("skipped");
    expect(f.submitInvoice).toHaveBeenCalledTimes(1);
  });

  it("ohne Mondu-Sell-Bestellung oder nach Ablehnung: nichts zu tun", async () => {
    expect((await submitMonduSellInvoice(null, "o1", { by: null }, fakeDeps(null).deps as any)).status).toBe("skipped");
    const declined = fakeDeps({ monduOrderUuid: "u1", state: "declined" });
    expect((await submitMonduSellInvoice(null, "o1", { by: null }, declined.deps as any)).status).toBe("skipped");
  });

  it("Takt: Wartende und vorgemerkte Rechnungen jedes Mal, sonst alle 6 Stunden", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
    expect(isMonduCheckDue({ state: "pending", invoicePending: false, lastCheckedAt: hoursAgo(0.1) }, now)).toBe(true);
    expect(isMonduCheckDue({ state: "confirmed", invoicePending: true, lastCheckedAt: hoursAgo(0.1) }, now)).toBe(true);
    expect(isMonduCheckDue({ state: "confirmed", invoicePending: false, lastCheckedAt: hoursAgo(1) }, now)).toBe(false);
    expect(isMonduCheckDue({ state: "shipped", invoicePending: false, lastCheckedAt: hoursAgo(7) }, now)).toBe(true);
  });

  it("Glocke bei bestätigt und abgelehnt (mit Grund), nicht bei „in Prüfung“", () => {
    expect(monduStateNotice({ orderNumber: "MO1", state: "confirmed", stateReason: null })?.message).toContain("bestätigt");
    expect(monduStateNotice({ orderNumber: "MO1", state: "declined", stateReason: "buyer_limit" })?.message).toContain("(buyer_limit)");
    expect(monduStateNotice({ orderNumber: "MO1", state: "processing", stateReason: null })).toBeNull();
  });
});
