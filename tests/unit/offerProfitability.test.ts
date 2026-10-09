/**
 * DB-Berechnung fuer ein Angebot (Bestell-DB-Analyse, Angebote aus Haendlerportal und Onlineshop):
 * Konfigurator-Positionen ueber die Stueckliste, Rabattzeilen anteilig, Brutto-Angebote netto,
 * optionale Positionen/Zwischensummen ohne Einfluss, exakte Angebotsnummer.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import type { Offer } from "../../shared/schema";
import {
  buildOfferProfitability,
  collectOfferHerstellpreisRefs,
  matchOffersByNumber,
} from "../../server/analytics/offerProfitability";

const HK: Record<string, number> = { A: 60, P1: 10, P2: 5, P3: 2 };
const herstellpreisOf = (ref: { productNumber?: string | null }) => HK[ref.productNumber ?? ""] ?? null;

function offer(items: any[]): Offer {
  return {
    id: "o1",
    offerNumber: "1619",
    customerId: "c",
    customerName: "Kunde",
    salesChannelId: "shop",
    totalPrice: 0,
    netPrice: 0,
    taxStatus: "",
    status: "sent",
    offered: true,
    accepted: false,
    declined: false,
    offerExpiration: "",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    items,
  };
}

const product = (id: string, pn: string, qty: number, unit: number, extra: any = {}) => ({
  id, type: "product", label: pn, quantity: qty, unitPrice: unit, totalPrice: unit * qty,
  productId: `pid-${pn}`, payload: { productNumber: pn }, ...extra,
});

const configuration = (id: string, qty: number, unit: number, parts: Array<[string, number]>) => ({
  id, type: "product", label: "META CLIP Steckregal", quantity: qty, unitPrice: unit, totalPrice: unit * qty,
  productId: "pid-config",
  payload: {
    productNumber: "SW10001",
    metaCalcConfigurationPayload: {
      partsList: parts.map(([pn, q]) => ({ productId: `pid-${pn}`, productNumber: pn, description: pn, quantity: q })),
      accessoryList: [],
    },
  },
});

const opts = { taxStatus: "net", herstellpreisOf, minMarginPercent: 20 };

describe("buildOfferProfitability", () => {
  it("rechnet Konfigurationen ueber die Stueckliste mal Positionsmenge", () => {
    // Stueckliste je Konfiguration: 4 x 10 + 6 x 5 = 70 HK; 2 Konfigurationen a 100
    const r = buildOfferProfitability(offer([configuration("k", 2, 100, [["P1", 4], ["P2", 6]])]), opts);
    const line = r.lines[0];
    expect(line.isConfiguration).toBe(true);
    expect(line.herstellpreisNet).toBe(70);
    expect(line.herstellkostenTotal).toBe(140);
    expect(line.db1Abs).toBe(60);
    expect(line.partsWithHerstellpreis).toBe(2);
    expect(r.profitability).toMatchObject({ db1Total: 60, herstellkostenTotal: 140, linesWithHerstellpreis: 1 });
  });

  it("Stueckliste mit fehlendem Herstellpreis zaehlt nicht als Position mit HK", () => {
    const r = buildOfferProfitability(offer([configuration("k", 1, 100, [["P1", 4], ["X", 1]])]), opts);
    expect(r.lines[0].herstellpreisNet).toBeNull();
    expect(r.lines[0].partsWithHerstellpreis).toBe(1);
    expect(r.profitability).toMatchObject({ db1Total: null, linesWithHerstellpreis: 0, productLineCount: 1 });
  });

  it("verteilt Rabattzeilen nach Umsatzanteil, ignoriert optionale Zeilen und Zwischensummen", () => {
    const r = buildOfferProfitability(
      offer([
        product("a", "A", 2, 100), // 200 Umsatz, 120 HK
        product("s", "SERVICE", 1, 200), // ohne HK
        product("opt", "A", 5, 100, { optional: true }),
        { id: "sub", type: "subtotal", label: "Raum", quantity: 1, totalPrice: 400 },
        { id: "d", type: "discount", label: "Rabatt", quantity: 1, unitPrice: -40, totalPrice: -40 },
      ]),
      opts,
    );
    expect(r.lines.map((l) => l.id)).toEqual(["a", "s", "opt", "d"]);
    expect(r.lines.find((l) => l.id === "opt")).toMatchObject({ countsForDb: false, db1Abs: null });
    // Rabatt -40 auf 400 Produktumsatz, davon 200 mit HK -> -20
    expect(r.profitability).toMatchObject({
      productLineCount: 2,
      linesWithHerstellpreis: 1,
      discountTotal: -40,
      discountShareWithHk: -20,
      db1BeforeDiscount: 80,
      db1Total: 60,
      revenueWithHk: 180,
      marginPercent: 50, // 60 / 120
      marginOnRevenuePercent: 33.3, // 60 / 180
      crmVerdict: "green",
    });
  });

  it("rechnet Brutto-Angebote je Position auf netto", () => {
    const r = buildOfferProfitability(
      offer([product("a", "A", 1, 119, { price: { taxRules: [{ taxRate: 19 }] } })]),
      { ...opts, taxStatus: "gross" },
    );
    expect(r.lines[0]).toMatchObject({ unitPriceNet: 100, totalNet: 100, db1Abs: 40 });
  });

  it("sammelt Artikel-Bezuege aus Positionen und Stuecklisten", () => {
    const refs = collectOfferHerstellpreisRefs([
      product("a", "A", 1, 1),
      configuration("k", 1, 1, [["P1", 1], ["P3", 2]]),
      { id: "h", type: "headline", label: "x" },
    ]);
    expect(refs.map((r) => r.productNumber)).toEqual(["A", "P1", "P3"]);
  });
});

describe("matchOffersByNumber", () => {
  it("nur exakte Treffer", () => {
    const offers = [{ offerNumber: "1619" }, { offerNumber: "16190" }, { offerNumber: " 1619 " }];
    expect(matchOffersByNumber(offers, "1619")).toHaveLength(2);
    expect(matchOffersByNumber(offers, "161")).toHaveLength(0);
  });
});
