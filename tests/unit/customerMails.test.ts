import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  basisOf,
  brevoAttributes,
  cutoffDate,
  eventEffect,
  frequencyOk,
  mergeContacts,
  normalizeEmail,
  parseBrevoEvents,
  planRecipients,
  summarizeMirrorOrders,
  type ContactRowState,
  type MirrorOrder,
} from "../../server/customerMails/legalBasis";
import { brevoClient, BrevoApiError } from "../../server/customerMails/brevoClient";
import { webhookTokenOk } from "../../server/customerMails/customerMailsRun";
import { DEFAULT_CUSTOMER_MAIL_SETTINGS, customerMailSettingsSchema, normalizeCustomerMailSettings } from "@shared/customerMails";

const d = (s: string) => new Date(s);
const contact = (over: Partial<{ email: string; lastOrderAt: Date | null; consentAt: Date | null; objectionAt: Date | null; bouncedAt: Date | null; salesChannelId: string | null }> = {}) => ({
  email: "kunde@firma.de",
  lastOrderAt: null,
  consentAt: null,
  objectionAt: null,
  bouncedAt: null,
  salesChannelId: null,
  ...over,
});

describe("Kundenmails: Rechtsgrundlage", () => {
  it("Widerspruch schlägt Einwilligung, Bestandskunde nur ab Stichtag", () => {
    expect(basisOf(contact({ consentAt: d("2026-01-01"), objectionAt: d("2026-02-01") }), "2026-10-20")).toBe("objected");
    expect(basisOf(contact({ consentAt: d("2026-01-01") }), null)).toBe("consent");
    expect(basisOf(contact({ lastOrderAt: d("2026-10-19T21:30:00Z") }), "2026-10-20")).toBe("none");
    expect(basisOf(contact({ lastOrderAt: d("2026-10-20T08:00:00Z") }), "2026-10-20")).toBe("existingCustomer");
    expect(basisOf(contact({ lastOrderAt: d("2026-10-20T08:00:00Z") }), null)).toBe("none");
  });

  it("Stichtag nur im Format JJJJ-MM-TT", () => {
    expect(cutoffDate("2026-10-20")?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(cutoffDate("20.10.2026")).toBeNull();
    expect(cutoffDate(null)).toBeNull();
  });

  it("E-Mail klein und geprüft", () => {
    expect(normalizeEmail("  Max.Muster@Firma.DE ")).toBe("max.muster@firma.de");
    expect(normalizeEmail("kein-at.de")).toBeNull();
    expect(normalizeEmail("a b@c.de")).toBeNull();
  });
});

describe("Kundenmails: Kontaktbremse und Empfänger", () => {
  const now = d("2026-10-20T10:00:00Z");
  it("zählt Werbemails der letzten 7 und 30 Tage", () => {
    expect(frequencyOk([], now, 1, 4)).toBe(true);
    expect(frequencyOk([d("2026-10-16T10:00:00Z")], now, 1, 4)).toBe(false);
    expect(frequencyOk([d("2026-10-12T10:00:00Z")], now, 1, 4)).toBe(true);
    const four = ["2026-09-25", "2026-10-01", "2026-10-06", "2026-10-11"].map((x) => d(`${x}T10:00:00Z`));
    expect(frequencyOk(four, now, 1, 4)).toBe(false);
  });

  const settings = { ...DEFAULT_CUSTOMER_MAIL_SETTINGS, existingCustomerSince: "2026-10-20", testRecipients: ["test@meta-online.com"] };

  it("plant nur Empfänger mit passender Grundlage und nennt den Grund", () => {
    const contacts = new Map([
      ["einwilligung@x.de", contact({ email: "einwilligung@x.de", consentAt: d("2026-05-01") })],
      ["bestand@x.de", contact({ email: "bestand@x.de", lastOrderAt: d("2026-10-20T09:00:00Z") })],
      ["alt@x.de", contact({ email: "alt@x.de", lastOrderAt: d("2026-03-01") })],
      ["widerspruch@x.de", contact({ email: "widerspruch@x.de", consentAt: d("2026-05-01"), objectionAt: d("2026-06-01") })],
      ["bounce@x.de", contact({ email: "bounce@x.de", consentAt: d("2026-05-01"), bouncedAt: d("2026-06-01") })],
      ["oft@x.de", contact({ email: "oft@x.de", consentAt: d("2026-05-01") })],
    ]);
    const sent = new Map([["oft@x.de", [d("2026-10-18T10:00:00Z")]]]);
    const candidates = ["einwilligung@x.de", "BESTAND@x.de", "alt@x.de", "widerspruch@x.de", "bounce@x.de", "oft@x.de", "unbekannt@x.de", "kaputt", "einwilligung@x.de"].map((email) => ({ email }));
    const letter = planRecipients("regularLetter", candidates, contacts, sent, settings, now);
    expect(letter.map((p) => [p.email, p.status, p.skipReason ?? p.basis])).toEqual([
      ["einwilligung@x.de", "planned", "consent"],
      ["bestand@x.de", "planned", "existingCustomer"],
      ["alt@x.de", "skipped", "noBasis"],
      ["widerspruch@x.de", "skipped", "objected"],
      ["bounce@x.de", "skipped", "bounced"],
      ["oft@x.de", "skipped", "frequency"],
      ["unbekannt@x.de", "skipped", "noBasis"],
      ["kaputt", "skipped", "invalidEmail"],
      ["einwilligung@x.de", "skipped", "duplicate"],
    ]);
    // Newsletter nur mit Einwilligung
    const news = planRecipients("newsletter", [{ email: "bestand@x.de" }, { email: "einwilligung@x.de" }], contacts, new Map(), settings, now);
    expect(news.map((p) => p.status)).toEqual(["skipped", "planned"]);
  });

  it("Testaussendung nur an Testadressen, Widerspruch gilt trotzdem", () => {
    const contacts = new Map([["test@meta-online.com", contact({ email: "test@meta-online.com", objectionAt: d("2026-01-01") })]]);
    expect(planRecipients("test", [{ email: "test@meta-online.com" }], new Map(), new Map(), settings, now)[0]).toMatchObject({ status: "planned", basis: "test" });
    expect(planRecipients("test", [{ email: "test@meta-online.com" }], contacts, new Map(), settings, now)[0]).toMatchObject({ status: "skipped", skipReason: "objected" });
    expect(planRecipients("test", [{ email: "kunde@firma.de" }], new Map(), new Map(), settings, now)[0]).toMatchObject({ status: "skipped", skipReason: "noBasis" });
  });

  it("ausgeschalteter Kanal wird ausgelassen", () => {
    const contacts = new Map([["a@x.de", contact({ email: "a@x.de", consentAt: d("2026-05-01"), salesChannelId: "portal" })]]);
    const s = { ...settings, channels: [{ salesChannelId: "portal", name: "META Portal", kind: "portal" as const, language: "de", enabled: false, senderId: null }] };
    expect(planRecipients("regularLetter", [{ email: "a@x.de" }], contacts, new Map(), s, now)[0].skipReason).toBe("channelOff");
  });
});

describe("Kundenmails: Abgleich", () => {
  const order = (over: Partial<MirrorOrder>): MirrorOrder => ({
    orderNumber: "MO100001",
    email: "Kunde@Firma.de",
    customerNumber: "12000",
    company: "Firma GmbH",
    contactName: "Max Kunde",
    salesChannelId: "shop",
    salesChannelName: "META Regalbau DE",
    status: "completed",
    createdAt: d("2026-05-01T10:00:00Z"),
    ...over,
  });

  it("fasst MO-Bestellungen je E-Mail zusammen, ohne Storno und durchgeschleuste", () => {
    const map = summarizeMirrorOrders(
      [
        order({}),
        order({ orderNumber: "MO100002", createdAt: d("2026-09-01T10:00:00Z"), salesChannelId: "portal", salesChannelName: "META Portal" }),
        order({ orderNumber: "MO100003", status: "cancelled", createdAt: d("2026-10-01T10:00:00Z") }),
        order({ orderNumber: "4711", createdAt: d("2026-10-02T10:00:00Z") }),
        order({ orderNumber: "MO100004", email: "musterkunde-de@meta-online.com", contactName: "Max Mustermann" }),
      ],
      (o) => /mustermann/i.test(o.contactName),
    );
    expect(Array.from(map.keys())).toEqual(["kunde@firma.de"]);
    expect(map.get("kunde@firma.de")).toMatchObject({ orderCount: 2, lastOrderNumber: "MO100002", salesChannelId: "portal", firstOrderAt: d("2026-05-01T10:00:00Z") });
  });

  const empty = (email: string): ContactRowState => ({
    email,
    customerNumber: null,
    company: null,
    contactName: null,
    salesChannelId: null,
    salesChannelName: null,
    orderCount: 0,
    firstOrderAt: null,
    lastOrderAt: null,
    lastOrderNumber: null,
    consentAt: null,
    consentSource: null,
    consentNote: null,
    objectionAt: null,
    objectionSource: null,
    objectionNote: null,
    newsletterRecipientId: null,
    newsletterStatus: null,
    shopOptOutPending: false,
    brevoBlocklisted: false,
  });
  const now = d("2026-10-20T10:00:00Z");

  it("bestätigte Anmeldung = Einwilligung, Abmeldung und Brevo-Sperre = Widerspruch, „direct“ nicht", () => {
    const { changed, newObjections } = mergeContacts(
      new Map(),
      new Map(),
      [
        { id: "n1", email: "ja@x.de", status: "optIn", confirmedAt: d("2026-04-01"), updatedAt: d("2026-04-01") },
        { id: "n2", email: "direkt@x.de", status: "direct", confirmedAt: null, updatedAt: d("2026-04-01") },
        { id: "n3", email: "ab@x.de", status: "optOut", confirmedAt: d("2026-01-01"), updatedAt: d("2026-06-01") },
      ],
      new Map([["gesperrt@x.de", d("2026-07-01")]]),
      now,
    );
    const by = new Map(changed.map((c) => [c.email, c]));
    expect(by.get("ja@x.de")).toMatchObject({ consentSource: "shopNewsletter", objectionAt: null });
    expect(by.get("direkt@x.de")).toMatchObject({ consentAt: null, newsletterStatus: "direct" });
    expect(by.get("ab@x.de")).toMatchObject({ objectionSource: "shopNewsletterOptOut", objectionAt: d("2026-06-01") });
    expect(by.get("gesperrt@x.de")).toMatchObject({ objectionSource: "brevoBlocklist", brevoBlocklisted: true });
    expect(newObjections.sort()).toEqual(["ab@x.de", "gesperrt@x.de"]);
  });

  it("erfasste Einwilligung und Widerspruch bleiben; unveränderte Kontakte werden nicht geschrieben", () => {
    const crm = { ...empty("crm@x.de"), consentAt: d("2026-03-01"), consentSource: "crm" as const, consentNote: "Messe" };
    const obj = { ...empty("obj@x.de"), objectionAt: d("2026-02-01"), objectionSource: "manual" as const, brevoBlocklisted: true };
    const { changed } = mergeContacts(
      new Map([
        ["crm@x.de", crm],
        ["obj@x.de", obj],
      ]),
      new Map(),
      [{ id: "n9", email: "obj@x.de", status: "optIn", confirmedAt: d("2026-09-01"), updatedAt: d("2026-09-01") }],
      new Map(),
      now,
    );
    expect(changed.map((c) => c.email)).toEqual(["obj@x.de"]);
    expect(changed[0]).toMatchObject({ objectionSource: "manual", consentSource: "shopNewsletter" });
    expect(basisOf({ ...changed[0], bouncedAt: null }, null)).toBe("objected");
  });
});

describe("Kundenmails: Brevo-Webhook und Kontaktfelder", () => {
  const now = d("2026-10-20T10:00:00Z");
  it("liest einzelne und gebündelte Ereignisse", () => {
    const single = parseBrevoEvents({ event: "unsubscribe", email: "A@x.de", camp_id: 12, ts_event: 1792483200 }, now);
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ email: "a@x.de", event: "unsubscribe", campaignId: 12 });
    expect(single[0].occurredAt.toISOString()).toBe(new Date(1792483200 * 1000).toISOString());
    const batch = parseBrevoEvents([{ event: "click", email: "b@x.de", URL: "https://shop.meta-online.com/" }, { event: "spam" }, "kaputt"], now);
    expect(batch).toEqual([expect.objectContaining({ email: "b@x.de", event: "click", url: "https://shop.meta-online.com/", occurredAt: now })]);
    expect(parseBrevoEvents(null, now)).toEqual([]);
  });

  it("ordnet Ereignisse Widerspruch bzw. Bounce zu", () => {
    expect(eventEffect("unsubscribe")).toBe("objection:brevoUnsubscribe");
    expect(eventEffect("unsubscribed")).toBe("objection:brevoUnsubscribe");
    expect(eventEffect("spam")).toBe("objection:brevoSpam");
    expect(eventEffect("hard_bounce")).toBe("bounce");
    expect(eventEffect("click")).toBeNull();
    expect(eventEffect("soft_bounce")).toBeNull();
  });

  it("Kontaktfelder nur mit Präfix MO_, Grundlage für die Fußzeile", () => {
    const attrs = brevoAttributes(
      { company: "Firma", contactName: "Max", customerNumber: "12000", salesChannelName: "META Regalbau DE", lastOrderAt: d("2026-10-01T10:00:00Z") },
      "existingCustomer",
      { MO_STAMM_1: "Fachboden", evil: "x", MO_bad: "y" },
    );
    expect(attrs).toEqual({
      MO_FIRMA: "Firma",
      MO_NAME: "Max",
      MO_KUNDENNR: "12000",
      MO_KANAL: "META Regalbau DE",
      MO_GRUNDLAGE: "bestandskunde",
      MO_LETZTE_BESTELLUNG: "2026-10-01",
      MO_STAMM_1: "Fachboden",
    });
  });

  it("Token-Prüfung zeitkonstant und streng", () => {
    expect(webhookTokenOk("abc", "abc")).toBe(true);
    expect(webhookTokenOk("abc", " abc ")).toBe(true);
    expect(webhookTokenOk("abc", "abd")).toBe(false);
    expect(webhookTokenOk("abc", "abcd")).toBe(false);
    expect(webhookTokenOk(null, "abc")).toBe(false);
    expect(webhookTokenOk("abc", undefined)).toBe(false);
  });
});

describe("Kundenmails: Einstellungen", () => {
  it("Standard aus, ungültige Werte fallen auf den Standard zurück", () => {
    expect(normalizeCustomerMailSettings(null)).toEqual(DEFAULT_CUSTOMER_MAIL_SETTINGS);
    expect(normalizeCustomerMailSettings({ enabled: true, maxPerWeek: 2, apiKey: "geheim" })).toMatchObject({ enabled: true, maxPerWeek: 2 });
    expect(normalizeCustomerMailSettings({ apiKey: "geheim" })).not.toHaveProperty("apiKey");
    expect(customerMailSettingsSchema.safeParse({ existingCustomerSince: "20.10.2026" }).success).toBe(false);
    expect(customerMailSettingsSchema.safeParse({ testRecipients: ["Test@Meta-Online.com"] }).data?.testRecipients).toEqual(["test@meta-online.com"]);
    expect(customerMailSettingsSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});

describe("Kundenmails: Brevo-Client", () => {
  it("schickt den Schlüssel im Kopf und meldet Fehler mit Status", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = brevoClient("KEY", async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/account")) return new Response(JSON.stringify({ email: "o@meta-online.com", companyName: "META", plan: [{ type: "starter", credits: 20000, creditsType: "sendLimit" }] }));
      return new Response(JSON.stringify({ code: "unauthorized", message: "Key not found" }), { status: 401 });
    });
    expect(await client.account()).toEqual({ email: "o@meta-online.com", companyName: "META", plans: ["starter 20000 sendLimit"] });
    expect((calls[0].init?.headers as Record<string, string>)["api-key"]).toBe("KEY");
    await expect(client.senders()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    await expect(client.senders()).rejects.toBeInstanceOf(BrevoApiError);
  });

  it("Sperrliste: legt fehlenden Kontakt an", async () => {
    const calls: string[] = [];
    const client = brevoClient("KEY", async (url, init) => {
      calls.push(`${init?.method} ${url.replace("https://api.brevo.com/v3", "")}`);
      if (init?.method === "PUT") return new Response(JSON.stringify({ code: "document_not_found", message: "Contact does not exist" }), { status: 404 });
      return new Response(JSON.stringify({ id: 5 }), { status: 201 });
    });
    await client.blocklist("a@x.de");
    expect(calls).toEqual(["PUT /contacts/a%40x.de?identifierType=email_id", "POST /contacts"]);
  });

  it("Webhook mit eigenen Kopfzeilen, Kampagne mit Vorlage und Liste", async () => {
    const bodies: any[] = [];
    const client = brevoClient("KEY", async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? "null")));
      return new Response(JSON.stringify({ id: 77 }), { status: 201 });
    });
    expect(await client.createWebhook("https://app/api/public/customer-mails/brevo", { "X-Meta-Tenant": "t1", "X-Meta-Token": "tok" }, ["unsubscribed"])).toBe(77);
    expect(bodies[0]).toMatchObject({ type: "marketing", events: ["unsubscribed"], headers: [{ key: "X-Meta-Tenant", value: "t1" }, { key: "X-Meta-Token", value: "tok" }] });
    expect(await client.createCampaign({ name: "n", subject: "s", senderId: 3, templateId: 9, listId: 4, utmCampaign: "u" })).toBe(77);
    // kein Tag: kleinere Brevo-Tarife lehnen Kampagnen-Tags ab
    expect(bodies[1]).toEqual({ name: "n", subject: "s", sender: { id: 3 }, templateId: 9, recipients: { listIds: [4] }, utmCampaign: "u" });
  });

  it("Kampagne: lehnt Brevo die UTM-Kennung ab, zweiter Versuch ohne", async () => {
    const bodies: any[] = [];
    const client = brevoClient("KEY", async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "null"));
      bodies.push(body);
      if (body.utmCampaign) return new Response(JSON.stringify({ code: "method_not_allowed", message: "You are not allowed to avail utm option for your campaign" }), { status: 405 });
      return new Response(JSON.stringify({ id: 88 }), { status: 201 });
    });
    expect(await client.createCampaign({ name: "n", subject: "s", senderId: 3, templateId: 9, listId: 4, utmCampaign: "u" })).toBe(88);
    expect(bodies.map((b) => "utmCampaign" in b)).toEqual([true, false]);
    // andere Fehler werden nicht verschluckt
    const failing = brevoClient("KEY", async () => new Response(JSON.stringify({ message: "Template not found" }), { status: 400 }));
    await expect(failing.createCampaign({ name: "n", subject: "s", senderId: 3, templateId: 9, listId: 4, utmCampaign: "u" })).rejects.toMatchObject({ status: 400 });
  });
});
