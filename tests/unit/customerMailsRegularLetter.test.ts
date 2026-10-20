import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { formatNetPrice, isLetterItem, letterAttributeTypes, letterCandidates, letterContent, letterExclusion, type LetterOrder, type LetterProduct } from "../../server/customerMails/regularLetter";
import { planRecipients } from "../../server/customerMails/legalBasis";
import { regularLetterTemplateHtml } from "../../server/customerMails/regularLetterTemplate";
import { DEFAULT_CUSTOMER_MAIL_SETTINGS, customerMailSettingsSchema } from "@shared/customerMails";

const now = new Date("2026-10-20T10:00:00Z");
const order = (over: Partial<LetterOrder>): LetterOrder => ({
  orderNumber: "MO1",
  email: "Kunde@Firma.de",
  customerNumber: "12000",
  salesChannelId: "shop",
  status: "completed",
  createdAt: new Date("2026-05-01T10:00:00Z"),
  paymentOverdue: false,
  passthrough: false,
  items: [],
  ...over,
});
const item = (productNumber: string, netTotal = 100) => ({ productNumber, name: `Artikel ${productNumber}`, netTotal });

describe("Stammkunden-Brief: Kandidaten", () => {
  it("braucht mindestens 2 Bestelltage; Stammartikel nach Tagen, dann Umsatz; ohne Service-Artikel", () => {
    const list = letterCandidates(
      [
        order({ orderNumber: "MO1", createdAt: new Date("2026-03-01T10:00:00Z"), items: [item("A", 50), item("B", 500), item("SW10007", 25)] }),
        order({ orderNumber: "MO2", createdAt: new Date("2026-03-01T15:00:00Z"), items: [item("C", 900)] }), // gleicher Tag
        order({ orderNumber: "MO3", createdAt: new Date("2026-06-01T10:00:00Z"), items: [item("A", 50), item("D", 0)] }),
        order({ orderNumber: "MO4", email: "einmal@x.de", items: [item("A")] }),
        order({ orderNumber: "MO5", email: "storno@x.de", status: "cancelled", items: [item("A")] }),
        order({ orderNumber: "MO6", email: "storno@x.de", createdAt: new Date("2026-07-01T10:00:00Z"), items: [item("A")] }),
        order({ orderNumber: "4711", email: "obx@x.de", items: [item("A")] }),
        order({ orderNumber: "MO7", email: "alt@x.de", createdAt: new Date("2023-01-01T10:00:00Z"), items: [item("A")] }),
        order({ orderNumber: "MO8", email: "alt@x.de", createdAt: new Date("2023-02-01T10:00:00Z"), items: [item("A")] }),
      ],
      now,
    );
    expect(list.map((c) => c.email)).toEqual(["kunde@firma.de"]);
    expect(list[0]).toMatchObject({ orderDays: 2, customerNumber: "12000", itemNumbers: ["A", "C", "B"] });
    expect(list[0].bought.has("SW10007")).toBe(false);
  });

  it("überfällige Zahlung und offene Reklamation schließen aus", () => {
    const [c] = letterCandidates(
      [order({ orderNumber: "MO1", items: [item("A")] }), order({ orderNumber: "MO2", createdAt: new Date("2026-06-01T10:00:00Z"), paymentOverdue: true, items: [item("A")] })],
      now,
    );
    expect(letterExclusion(c, new Set())).toBe("paymentOverdue");
    expect(letterExclusion({ ...c, paymentOverdue: false }, new Set(["kunde@firma.de"]))).toBe("complaint");
    expect(letterExclusion({ ...c, paymentOverdue: false }, new Set())).toBeNull();
    expect(isLetterItem("SW10001", 10)).toBe(false);
    expect(isLetterItem("4026212138719", 0)).toBe(false);
  });
});

describe("Stammkunden-Brief: Inhalt", () => {
  const p = (name: string, priceNet: number | null, sellable = true, url = `https://shop/${name}`): LetterProduct => ({ name, priceNet, deliveryTime: "1-3 Tage", url, sellable });
  const products = new Map<string, LetterProduct>([
    ["A", p("Fachboden", 12.5)],
    ["B", p("Alt", 10, false)],
    ["C", p("Ohne Preis", null)],
    ["D", p("Stütze", 1234.5)],
    ["X", p("Kantenschutz", 3.9)],
    ["Y", p("Schon gekauft", 5)],
    ["Z", p("Nicht kaufbar", 5, false)],
  ]);

  it("nur kaufbare Artikel mit Preis; Zubehör ohne Gekauftes; Felder für Brevo", () => {
    const content = letterContent({ itemNumbers: ["B", "A", "C", "D"], bought: new Set(["A", "B", "C", "D", "Y"]) }, products, new Map([["A", ["Y", "Z", "X", "D"]]]));
    expect(content?.items.map((i) => i.productNumber)).toEqual(["A", "D"]);
    expect(content?.accessories.map((i) => i.productNumber)).toEqual(["X"]);
    expect(content?.attributes).toMatchObject({
      MO_STAMM_ANZAHL: 2,
      MO_ZUB_ANZAHL: 1,
      MO_STAMM_1_NAME: "Fachboden",
      MO_STAMM_1_PREIS: "12,50 € zzgl. MwSt.",
      MO_STAMM_2_PREIS: "1.234,50 € zzgl. MwSt.",
      MO_STAMM_3_NAME: "",
      MO_ZUB_1_URL: "https://shop/Kantenschutz",
      MO_ZUB_2_NAME: "",
    });
    expect(Object.keys(content!.attributes).sort()).toEqual(Object.keys(letterAttributeTypes()).sort());
  });

  it("kein kaufbarer Stammartikel = kein Brief", () => {
    expect(letterContent({ itemNumbers: ["B", "C"], bought: new Set() }, products, new Map())).toBeNull();
    expect(formatNetPrice(1000)).toBe("1.000,00 € zzgl. MwSt.");
  });
});

describe("Stammkunden-Brief: Planung und Vorlage", () => {
  it("Ausschluss der Mailart steht vor Rechtsgrundlage, Widerspruch bleibt vorn", () => {
    const contacts = new Map([
      ["a@x.de", { email: "a@x.de", consentAt: new Date("2026-01-01"), lastOrderAt: null, objectionAt: null, bouncedAt: null }],
      ["b@x.de", { email: "b@x.de", consentAt: new Date("2026-01-01"), lastOrderAt: null, objectionAt: new Date("2026-02-01"), bouncedAt: null }],
    ]);
    const planned = planRecipients(
      "regularLetter",
      [
        { email: "a@x.de", skipReason: "complaint" },
        { email: "b@x.de", skipReason: "paymentOverdue" },
      ],
      contacts,
      new Map(),
      DEFAULT_CUSTOMER_MAIL_SETTINGS,
      now,
    );
    expect(planned.map((p) => p.skipReason)).toEqual(["complaint", "objected"]);
  });

  it("Kundenversand ab Werk aus; „test“ kann nicht freigeschaltet werden", () => {
    expect(DEFAULT_CUSTOMER_MAIL_SETTINGS.liveTypes).toEqual([]);
    expect(customerMailSettingsSchema.safeParse({ liveTypes: ["regularLetter"] }).success).toBe(true);
    expect(customerMailSettingsSchema.safeParse({ liveTypes: ["test"] }).success).toBe(false);
  });

  it("Vorlage nutzt alle Felder, Abmeldelink und beide Fußzeilen", () => {
    const html = regularLetterTemplateHtml();
    for (const name of Object.keys(letterAttributeTypes()).filter((n) => !n.endsWith("ANZAHL"))) expect(html).toContain(`contact.${name}`);
    expect(html).toContain("{{ unsubscribe }}");
    expect(html).toContain('contact.MO_GRUNDLAGE == "bestandskunde"');
    expect(html).toContain("contact.MO_ZUB_ANZAHL > 0");
  });
});
