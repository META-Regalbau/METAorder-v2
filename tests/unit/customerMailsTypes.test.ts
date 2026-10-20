import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  accessoryMailAttributes,
  inControlGroup,
  newProductAttributes,
  ordersShippedBetween,
  overdueBlocker,
  serviceMailAttributes,
} from "../../server/customerMails/mailContent";
import { letterCandidates, type LetterOrder, type LetterProduct } from "../../server/customerMails/regularLetter";
import { ordersAfter } from "../../server/customerMails/runEffect";
import { splitName } from "../../server/customerMails/consentDoi";
import { MAIL_TEMPLATES, TEMPLATE_TODO_MARK } from "../../server/customerMails/mailTemplates";
import { brevoClient } from "../../server/customerMails/brevoClient";
import { CUSTOMER_MAIL_BUILD_TYPES, CUSTOMER_MAIL_TYPE_RULES, customerMailTypedRunSchema } from "@shared/customerMails";

const now = new Date("2026-10-20T10:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
const order = (over: Partial<LetterOrder>): LetterOrder => ({
  orderNumber: "MO1",
  email: "kunde@firma.de",
  customerNumber: "12000",
  salesChannelId: "shop",
  status: "completed",
  createdAt: daysAgo(20),
  paymentOverdue: false,
  passthrough: false,
  net: 100,
  shippedAt: daysAgo(5),
  trackingUrl: "https://track/1",
  items: [{ productNumber: "A", name: "Fachboden alt", netTotal: 100 }],
  ...over,
});
const p = (name: string, priceNet: number | null, sellable = true): LetterProduct => ({ name, priceNet, deliveryTime: "1-3 Tage", url: `https://shop/${name}`, sellable });

describe("Überfällig-Erinnerung", () => {
  const base = { state: "alerted", alertedAt: daysAgo(8), causes: 0, lastCallAt: null, lastReminderAt: null };
  it("frühestens 7 Tage nach der Meldung, ohne Anruf, ohne Ursache, höchstens alle 90 Tage", () => {
    expect(overdueBlocker(base, now)).toBeNull();
    expect(overdueBlocker({ ...base, state: "won" }, now)).toBe("notAlerted");
    expect(overdueBlocker({ ...base, alertedAt: daysAgo(3) }, now)).toBe("tooEarly");
    expect(overdueBlocker({ ...base, causes: 1 }, now)).toBe("cause");
    expect(overdueBlocker({ ...base, lastCallAt: daysAgo(2) }, now)).toBe("called");
    expect(overdueBlocker({ ...base, lastCallAt: daysAgo(30) }, now)).toBeNull();
    expect(overdueBlocker({ ...base, lastReminderAt: daysAgo(60) }, now)).toBe("recentlyReminded");
    expect(overdueBlocker({ ...base, lastReminderAt: daysAgo(100) }, now)).toBeNull();
  });
});

describe("Newsletter: Neu im Shop", () => {
  it("neueste kaufbare Artikel der letzten 45 Tage, höchstens 4, ohne Service-Artikel", () => {
    const products = new Map([
      ["N1", p("Neu 1", 10)],
      ["N2", p("Neu 2", 20)],
      ["N3", p("Ohne Preis", null)],
      ["N4", p("Inaktiv", 5, false)],
      ["N5", p("Neu 5", 5)],
      ["N6", p("Neu 6", 6)],
      ["N7", p("Neu 7", 7)],
      ["ALT", p("Alt", 7)],
    ]);
    const attrs = newProductAttributes(
      [
        { productNumber: "N1", createdAt: daysAgo(1) },
        { productNumber: "N2", createdAt: daysAgo(2) },
        { productNumber: "N3", createdAt: daysAgo(3) },
        { productNumber: "N4", createdAt: daysAgo(4) },
        { productNumber: "N5", createdAt: daysAgo(5) },
        { productNumber: "N6", createdAt: daysAgo(6) },
        { productNumber: "N7", createdAt: daysAgo(7) },
        { productNumber: "ALT", createdAt: daysAgo(60) },
        { productNumber: "SW10001", createdAt: daysAgo(1) },
      ],
      products,
      now,
    );
    expect(attrs.MO_NEU_ANZAHL).toBe(4);
    expect([attrs.MO_NEU_1_NAME, attrs.MO_NEU_2_NAME, attrs.MO_NEU_3_NAME, attrs.MO_NEU_4_NAME]).toEqual(["Neu 1", "Neu 2", "Neu 5", "Neu 6"]);
    expect(attrs.MO_NEU_1_PREIS).toBe("10,00 € zzgl. MwSt.");
  });
});

describe("After-Sales", () => {
  it("Fenster nach dem Versand, ohne Storno, ohne Unversandtes", () => {
    const orders = [
      order({ orderNumber: "MO1", shippedAt: daysAgo(5) }),
      order({ orderNumber: "MO2", shippedAt: daysAgo(12) }),
      order({ orderNumber: "MO3", shippedAt: null }),
      order({ orderNumber: "MO4", status: "cancelled" }),
      order({ orderNumber: "4711" }),
    ];
    expect(ordersShippedBetween(orders, now, 3, 10).map((o) => o.orderNumber)).toEqual(["MO1"]);
  });

  it("Service-Mail: Bestellung, Positionen, Link nur zu kaufbaren Artikeln", () => {
    const attrs = serviceMailAttributes(
      order({ items: [{ productNumber: "A", name: "Fachboden alt", netTotal: 100 }, { productNumber: "B", name: "Weg", netTotal: 50 }, { productNumber: "SW10007", name: "Zuschlag", netTotal: 25 }] }),
      new Map([
        ["A", p("Fachboden", 10)],
        ["B", p("Nicht mehr", 10, false)],
      ]),
    );
    expect(attrs).toMatchObject({ MO_BESTELLNR: "MO1", MO_SENDUNG_URL: "https://track/1", MO_POS_ANZAHL: 2, MO_POS_1_NAME: "Fachboden", MO_POS_1_URL: "https://shop/Fachboden", MO_POS_2_NAME: "Nicht mehr", MO_POS_2_URL: "" });
    expect(attrs.MO_BESTELLDATUM).toMatch(/^\d{2}\.\d{2}\.2026$/);
  });

  it("Zubehör: ohne Bestelltes und schon Gekauftes; ohne Zubehör keine Mail", () => {
    const products = new Map([
      ["X", p("Kantenschutz", 3)],
      ["Y", p("Schon gekauft", 5)],
    ]);
    const attrs = accessoryMailAttributes(order({}), new Set(["Y"]), products, new Map([["A", ["Y", "X"]]]));
    expect(attrs).toMatchObject({ MO_BESTELLNR: "MO1", MO_ZUB_ANZAHL: 1, MO_ZUB_1_NAME: "Kantenschutz" });
    expect(accessoryMailAttributes(order({}), new Set(["Y", "X"]), products, new Map([["A", ["Y", "X"]]]))).toBeNull();
  });
});

describe("Reaktivierung und Wirkung", () => {
  it("Einmalkäufer im Fenster 6–12 Monate", () => {
    const list = letterCandidates(
      [
        order({ orderNumber: "MO1", email: "einmal@x.de", createdAt: daysAgo(200) }),
        order({ orderNumber: "MO2", email: "zuneu@x.de", createdAt: daysAgo(100) }),
        order({ orderNumber: "MO3", email: "zweimal@x.de", createdAt: daysAgo(200) }),
        order({ orderNumber: "MO4", email: "zweimal@x.de", createdAt: daysAgo(300) }),
      ],
      now,
      { minDays: 1, maxDays: 1, lookbackDays: 730, lastOrderMinAgeDays: 180, lastOrderMaxAgeDays: 365 },
    );
    expect(list.map((c) => c.email)).toEqual(["einmal@x.de"]);
  });

  it("Kontrollgruppe ist fest und etwa 20 %", () => {
    const emails = Array.from({ length: 2000 }, (_, i) => `k${i}@x.de`);
    const inGroup = emails.filter((e) => inControlGroup(e, "reactivation")).length;
    expect(inGroup).toBeGreaterThan(330);
    expect(inGroup).toBeLessThan(470);
    expect(inControlGroup("a@x.de", "reactivation")).toBe(inControlGroup("A@X.de ", "reactivation"));
  });

  it("Bestellungen im Fenster nach dem Versand", () => {
    const sentAt = daysAgo(20);
    const orders = [
      order({ orderNumber: "MO1", email: "a@x.de", createdAt: daysAgo(15), net: 200 }),
      order({ orderNumber: "MO2", email: "a@x.de", createdAt: daysAgo(10), net: 50.5 }),
      order({ orderNumber: "MO3", email: "b@x.de", createdAt: daysAgo(25), net: 999 }),
      order({ orderNumber: "MO4", email: "b@x.de", createdAt: daysAgo(1), net: 999 }),
      order({ orderNumber: "MO5", email: "c@x.de", createdAt: daysAgo(12), net: 999, status: "cancelled" }),
    ];
    expect(ordersAfter(orders, new Set(["a@x.de", "b@x.de", "c@x.de"]), sentAt)).toEqual({ customers: 1, orders: 2, net: 250.5 });
  });
});

describe("Vorlagen, Regeln und Brevo-Transaktionsweg", () => {
  it("jede Mailart hat eine Startvorlage; nur die Service-Mail nutzt params und hat keinen Abmeldelink", () => {
    for (const type of CUSTOMER_MAIL_BUILD_TYPES) {
      const html = MAIL_TEMPLATES[type].html();
      const transactional = CUSTOMER_MAIL_TYPE_RULES[type].transactional;
      expect(html.includes("{{ params.")).toBe(transactional);
      expect(html.includes("{{ unsubscribe }}")).toBe(!transactional);
      expect(CUSTOMER_MAIL_TYPE_RULES[type].available).toBe(true);
    }
    // nur der Newsletter braucht eigenen Text in Brevo
    expect(CUSTOMER_MAIL_BUILD_TYPES.filter((t) => MAIL_TEMPLATES[t].html().includes(TEMPLATE_TODO_MARK))).toEqual(["newsletter"]);
    expect(customerMailTypedRunSchema.safeParse({ mailType: "test", templateId: 1, senderId: 1, subject: "s", mode: "preview" }).success).toBe(false);
  });

  it("Transaktionsmail mit Parametern, Statistik und Vorlagen-HTML", async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const client = brevoClient("KEY", async (url, init) => {
      const path = url.replace("https://api.brevo.com/v3", "");
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === "/smtp/email") return new Response(JSON.stringify({ messageId: "<m1>" }), { status: 201 });
      if (path.startsWith("/emailCampaigns/5")) return new Response(JSON.stringify({ statistics: { globalStats: { delivered: 9, uniqueViews: 4, uniqueClicks: 2, unsubscriptions: 1, hardBounces: 0 } } }));
      return new Response(JSON.stringify({ htmlContent: "<p>⟦x⟧</p>" }));
    });
    expect(await client.sendTransactional({ templateId: 3, senderId: 2, to: "a@x.de", subject: "S", params: { MO_BESTELLNR: "MO1" }, replyTo: "shop@x.de" })).toBe("<m1>");
    expect(calls[0].body).toEqual({ templateId: 3, sender: { id: 2 }, to: [{ email: "a@x.de" }], subject: "S", params: { MO_BESTELLNR: "MO1" }, replyTo: { email: "shop@x.de" } });
    expect(await client.campaignStats(5)).toEqual({ delivered: 9, uniqueViews: 4, uniqueClicks: 2, unsubscriptions: 1, hardBounces: 0 });
    expect(await client.templateHtml(7)).toContain(TEMPLATE_TODO_MARK);
  });

  it("Name für die Shop-Anmeldung", () => {
    expect(splitName("Max Peter Muster")).toEqual({ firstName: "Max Peter", lastName: "Muster" });
    expect(splitName("Muster")).toEqual({});
    expect(splitName(null)).toEqual({});
  });
});
