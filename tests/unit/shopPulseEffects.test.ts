/**
 * Shop-Puls Stufe 2 (S2-6), Wirkung messen: Vergleich einer Kennzahl gegen die Vergleichsgruppe, Teilen nach
 * Bereich, Einstufung (läuft noch / nicht messbar / unsicher / sicher) mit ihren Gründen, überlagernde
 * Maßnahmen, frühe GA4-Signale, gesicherte Wirkung im Wochenbericht und der Lauf mit simulierten Quellen.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  compareMetric,
  conversionSignal,
  earlySignal,
  evaluateAction,
  normPage,
  scopesOverlap,
  splitOrders,
  weeklyEffects,
  type EffectOrder,
} from "../../server/shopPulse/effects";
import { isEffectsDue, refreshEffects, type ShopPulseEffectsDeps } from "../../server/shopPulse/effectsRun";
import { Ga4NotConfiguredError, type Ga4Property, type Ga4ReportRequest } from "../../server/shopPulse/ga4Client";
import { weeklyEffectLine, buildShopPulseWeeklyCard } from "../../server/shopPulse/shopPulseNotify";
import { weeklyPayload, weeklyReportData } from "../../server/shopPulse/weeklyReport";
import { addDays, type PulseOrder } from "../../server/shopPulse/pulseOrders";
import type { ShopPulseActionEffect } from "../../shared/shopPulseEffects";
import type { ShopPulseAction, ShopPulseActionScope, ShopPulseWeeklyReport } from "../../shared/shopPulseWeekly";

const NOW = new Date("2026-10-18T10:00:00Z");

function action(id: string, day: string, scope: ShopPulseActionScope, title = `Maßnahme ${id}`): ShopPulseAction {
  return {
    id,
    occurredAt: `${day}T10:00:00.000Z`,
    kind: "manual",
    title,
    description: "",
    scope,
    source: "manual",
    sourceKey: null,
    actor: null,
    createdBy: "admin",
    createdAt: `${day}T10:00:00.000Z`,
    updatedAt: `${day}T10:00:00.000Z`,
  };
}

/** Bestellungen je Tag von from bis to; perDay liefert je Tag die Bestellungen (Artikel, Netto) */
function ordersBetween(from: string, to: string, perDay: (day: string, i: number) => Array<Array<[string, number]>>): EffectOrder[] {
  const out: EffectOrder[] = [];
  let i = 0;
  for (let d = from; d <= to; d = addDays(d, 1), i++) {
    for (const lines of perDay(d, i)) out.push({ day: d, channel: "META Regalbau DE", items: lines.map(([productNumber, net]) => ({ productNumber, quantity: 1, netTotal: net })) });
  }
  return out;
}

const repeat = <T,>(n: number, v: T): T[] => Array.from({ length: n }, () => v);
const HK = (pn: string) => (pn.startsWith("A") || pn.startsWith("B") ? 50 : null);

/** Artikel A1: vorher 0/2 Bestellungen im Wechsel, ab dem Tag nach START 2/4; übriger Shop (B1) 4/6 im Wechsel */
const START = "2026-08-01";
const strong = ordersBetween("2026-06-01", "2026-10-17", (day, i) => {
  const after = day > START;
  const a = after ? (i % 2 ? 4 : 2) : i % 2 ? 2 : 0;
  const b = i % 2 ? 6 : 4;
  return [...repeat(a, [["A1", 100]] as Array<[string, number]>), ...repeat(b, [["B1", 100]] as Array<[string, number]>)];
});
const dataFrom = (orders: EffectOrder[]) => orders.reduce((m, o) => (o.day < m ? o.day : m), orders[0].day);

describe("compareMetric", () => {
  it("rechnet ohne Vergleichsgruppe nachher gegen vorher", () => {
    const m = compareMetric([1, 1, 1, 1], [2, 2, 2, 2], null, null);
    expect(m).toMatchObject({ pre: 4, post: 8, expected: 4, effect: 4, effectPercent: 100, controlChangePercent: null, z: null });
  });

  it("rechnet die Entwicklung der Vergleichsgruppe heraus (Differenz der Differenzen)", () => {
    // Vergleichsgruppe wächst um 50 %, Bereich auch: keine Wirkung
    const m = compareMetric([1, 2, 1, 2], [2, 3, 1, 3], [10, 10, 10, 10], [15, 15, 15, 15]);
    expect(m.expected).toBe(9);
    expect(m.effect).toBe(0);
    expect(m.controlChangePercent).toBe(50);
  });

  it("nennt z und die kleinste sicher erkennbare Wirkung aus der Schwankung von Tag zu Tag", () => {
    const m = compareMetric([0, 2, 0, 2], [2, 4, 2, 4], [4, 6, 4, 6], [4, 6, 4, 6]);
    // Varianz je Summe = 4 × 4/3; ohne Wachstum der Vergleichsgruppe
    expect(m.effect).toBe(8);
    expect(m.z).toBeGreaterThan(2);
    expect(m.detectablePercent).toBeGreaterThan(0);
  });
});

describe("splitOrders", () => {
  const orders: EffectOrder[] = [
    { day: "2026-08-02", channel: "META Regalbau DE", items: [{ productNumber: "A1", quantity: 2, netTotal: 300 }, { productNumber: "B1", quantity: 1, netTotal: 100 }] },
    { day: "2026-08-02", channel: "Portal", items: [{ productNumber: "C1", quantity: 1, netTotal: 80 }] },
  ];

  it("teilt Artikel in Bereich und übrigen Shop (Positionen und Bestellungen)", () => {
    const split = splitOrders(orders, { type: "products", values: ["a1"] }, HK)!;
    const day = split.get("2026-08-02")!;
    expect(day.t).toEqual({ revenue: 300, db1: 200, covered: 300, orders: 1 });
    expect(day.c).toEqual({ revenue: 180, db1: 50, covered: 100, orders: 1 });
  });

  it("teilt nach Kanal ganze Bestellungen, der ganze Shop ist alles", () => {
    expect(splitOrders(orders, { type: "channel", values: ["portal"] }, null)!.get("2026-08-02")!.t.orders).toBe(1);
    expect(splitOrders(orders, { type: "shop", values: [] }, null)!.get("2026-08-02")!.t.orders).toBe(2);
  });

  it("Seiten lassen sich Bestellungen nicht zuordnen", () => {
    expect(splitOrders(orders, { type: "pages", values: ["/regal-lexikon"] }, null)).toBeNull();
  });
});

describe("evaluateAction", () => {
  const base = { orders: strong, hkOf: HK, now: NOW, dataFrom: dataFrom(strong) };

  it("große Wirkung auf Artikel mit übrigem Shop als Vergleich: sicher nach 28 Tagen", () => {
    const a = action("a", START, { type: "products", values: ["A1"] });
    const e = evaluateAction(a, { ...base, allActions: [a] });
    expect(e.verdict).toBe("sure");
    expect(e.headlineDays).toBe(28);
    const w28 = e.windows.find((w) => w.days === 28)!;
    expect(w28).toMatchObject({ pre: { from: "2026-07-04", to: "2026-07-31" }, post: { from: "2026-08-02", to: "2026-08-29" }, control: "rest", main: "db1", reasons: [] });
    expect(w28.metrics.db1!.effect).toBeGreaterThan(0);
    expect(w28.metrics.orders!.post).toBe(84);
    // 14 Tage: höchstens unsicher
    expect(e.windows.find((w) => w.days === 14)!.reasons).toContain("windowShort");
  });

  it("andere Maßnahme im selben Bereich: unsicher, mit Hinweis", () => {
    const a = action("a", START, { type: "products", values: ["A1"] });
    const other = action("b", "2026-08-10", { type: "products", values: ["A1", "X"] }, "Preis gesenkt");
    const e = evaluateAction(a, { ...base, allActions: [a, other] });
    expect(e.verdict).toBe("unsure");
    expect(e.windows[1].reasons).toContain("overlap");
    expect(e.overlaps).toEqual([{ id: "b", occurredAt: other.occurredAt, title: "Preis gesenkt", kind: "manual" }]);
  });

  it("ganzer Shop ohne Vorjahr im Spiegel: kein Vergleich, unsicher", () => {
    const a = action("a", START, { type: "shop", values: [] });
    const e = evaluateAction(a, { ...base, allActions: [a] });
    expect(e.windows[1].control).toBe("none");
    expect(e.windows[1].reasons).toContain("noControl");
    expect(e.verdict).toBe("unsure");
  });

  it("ganzer Shop mit Vorjahr: gleiche Tage 52 Wochen davor als Vergleich", () => {
    const lastYear = ordersBetween("2025-06-01", "2025-10-17", (_d, i) => repeat(i % 2 ? 6 : 4, [["B1", 100]] as Array<[string, number]>));
    const orders = [...lastYear, ...strong];
    const a = action("a", START, { type: "shop", values: [] });
    const e = evaluateAction(a, { orders, hkOf: HK, now: NOW, dataFrom: dataFrom(orders), allActions: [a] });
    expect(e.windows[1].control).toBe("yearAgo");
    expect(e.verdict).toBe("sure");
  });

  it("Seiten: nicht messbar, auch wenn die Tage noch laufen", () => {
    const a = action("a", "2026-10-15", { type: "pages", values: ["https://shop.meta-online.com/regal-lexikon/"] });
    const e = evaluateAction(a, { ...base, allActions: [a] });
    expect(e.verdict).toBe("notMeasurable");
    expect(e.windows[0].reasons).toEqual(["pagesNotAttributable"]);
  });

  it("läuft noch, solange die 14 Tage danach nicht vorbei sind; danach aus 14 Tagen höchstens unsicher", () => {
    const pending = evaluateAction(action("a", "2026-10-10", { type: "products", values: ["A1"] }), { ...base, allActions: [] });
    expect(pending.verdict).toBe("pending");
    expect(pending.headlineDays).toBeNull();
    const half = evaluateAction(action("b", "2026-09-25", { type: "products", values: ["A1"] }), { ...base, allActions: [] });
    expect(half.headlineDays).toBe(14);
    expect(half.verdict).toBe("unsure");
  });

  it("zu wenige Bestellungen im Bereich bzw. Spiegel reicht nicht zurück: nicht messbar", () => {
    const few = evaluateAction(action("a", START, { type: "products", values: ["NIE-BESTELLT"] }), { ...base, allActions: [] });
    expect(few.verdict).toBe("notMeasurable");
    expect(few.windows[1].reasons[0]).toBe("tooFewOrders");
    const early = evaluateAction(action("b", "2026-06-10", { type: "products", values: ["A1"] }), { ...base, allActions: [] });
    expect(early.windows[1].reasons).toEqual(["noHistory"]);
  });

  it("ohne Herstellpreise ist der Umsatz der Hauptwert", () => {
    const a = action("a", START, { type: "products", values: ["A1"] });
    const e = evaluateAction(a, { ...base, hkOf: null, allActions: [a] });
    expect(e.windows[1].main).toBe("revenue");
    expect(e.windows[1].metrics.db1).toBeNull();
    expect(e.windows[1].reasons).toEqual(["db1Coverage"]);
    expect(e.verdict).toBe("sure");
  });
});

describe("scopesOverlap und Seiten", () => {
  it("Shop nur mit Shop, Kanal auch mit Shop, sonst gemeinsame Werte", () => {
    expect(scopesOverlap({ type: "shop", values: [] }, { type: "products", values: ["A"] })).toBe(false);
    expect(scopesOverlap({ type: "channel", values: ["META Regalbau DE"] }, { type: "shop", values: [] })).toBe(true);
    expect(scopesOverlap({ type: "products", values: ["a1"] }, { type: "products", values: ["A1"] })).toBe(true);
    expect(scopesOverlap({ type: "pages", values: ["https://shop.meta-online.com/faq/"] }, { type: "pages", values: ["/FAQ"] })).toBe(true);
  });

  it("Seiten werden zum Pfad", () => {
    expect(normPage("https://shop.meta-online.com/Regal-Lexikon/?x=1")).toBe("/regal-lexikon");
    expect(normPage("/")).toBe("/");
  });
});

describe("frühe Signale", () => {
  it("Bereich gegen übrigen Shop (ganzer Shop − Bereich)", () => {
    const s = earlySignal("itemsViewed", 28, { pre: 100, post: 150 }, { pre: 1100, post: 1100 });
    expect(s).toMatchObject({ changePercent: 50, controlChangePercent: -5, relativePercent: 55 });
  });

  it("Conversion des ganzen Shops ohne Vergleich", () => {
    expect(conversionSignal(14, { pre: 1000, post: 1000 }, { pre: 10, post: 15 })).toMatchObject({ pre: 1, post: 1.5, changePercent: 50, relativePercent: null });
  });
});

describe("Wochenbericht", () => {
  const a = action("a", START, { type: "products", values: ["A1"] }, "Produktbilder ergänzt");
  const effect: ShopPulseActionEffect = { ...evaluateAction(a, { orders: strong, hkOf: HK, now: NOW, dataFrom: dataFrom(strong), allActions: [a] }), early: null };

  it("nennt gesicherte Wirkungen, deren 28 Tage in der Berichtswoche zu Ende gingen", () => {
    expect(weeklyEffects([effect], [a], "2026-08-24")).toHaveLength(1);
    expect(weeklyEffects([effect], [a], "2026-08-31")).toHaveLength(0);
    const [w] = weeklyEffects([effect], [a], "2026-08-24");
    expect(w).toMatchObject({ actionId: "a", title: "Produktbilder ergänzt", main: "db1", positive: true, postTo: "2026-08-29" });
    expect(weeklyEffectLine(w)).toMatch(/^01\.08\.2026 Produktbilder ergänzt: \+.*Deckungsbeitrag \(\+.* %\) in 28 Tagen$/);
  });

  it("steht in Bericht, KI-Eingabe und Teams-Karte", () => {
    const effects = weeklyEffects([effect], [a], "2026-08-24");
    const data = weeklyReportData({ numbers: null, signals: [], estimates: new Map(), actions: [], now: NOW, effects });
    expect(data.effects).toHaveLength(1);
    const payload = weeklyPayload(data, NOW) as Record<string, any>;
    expect(payload.wirkungGesichert[0].massnahme).toBe("Produktbilder ergänzt");
    const report: ShopPulseWeeklyReport = { id: "r", weekStart: "2026-08-24", weekEnd: "2026-08-30", isoWeek: 35, createdAt: NOW.toISOString(), sentAt: null, data, ai: null };
    expect(JSON.stringify(buildShopPulseWeeklyCard(report, null))).toContain("Gesicherte Wirkung");
    const none = weeklyReportData({ numbers: null, signals: [], estimates: new Map(), actions: [], now: NOW });
    expect(none.effects).toBeNull();
    expect((weeklyPayload(none, NOW) as Record<string, unknown>).wirkungGesichert).toBe("keine gesicherte Wirkung");
  });
});

describe("refreshEffects", () => {
  const toPulse = (o: EffectOrder): PulseOrder => ({ orderNumber: "MO", createdAt: new Date(`${o.day}T10:00:00Z`), day: o.day, hour: 12, total: 0, paymentMethod: null, items: o.items, channel: o.channel });
  function fakeDeps(over: Partial<ShopPulseEffectsDeps> = {}): ShopPulseEffectsDeps & { saved: ShopPulseActionEffect[][]; requests: Ga4ReportRequest[] } {
    const saved: ShopPulseActionEffect[][] = [];
    const requests: Ga4ReportRequest[] = [];
    const property: Ga4Property = {
      propertyId: "123456",
      report: async (req) => {
        requests.push(req);
        return [{ d: [], m: req.filter ? [100, 10] : [1000, 50] }];
      },
      realtime: async () => [],
    };
    return {
      saved,
      requests,
      loadOrders: async () => strong.map(toPulse),
      herstellpreise: async (_t, numbers) => new Map(numbers.filter((n) => HK(n) != null).map((n) => [n, 50])),
      listActions: async () => [action("a", START, { type: "products", values: ["A1"] }), action("p", "2026-10-15", { type: "products", values: ["A1"] })],
      ga4: async () => property,
      listEffects: async () => [],
      saveEffects: async (_t, effects) => {
        saved.push(effects);
      },
      ...over,
    };
  }

  it("rechnet und speichert; frühe GA4-Signale nur für abgeschlossene Zeiträume", async () => {
    const deps = fakeDeps();
    const r = await refreshEffects(deps, null, NOW);
    expect(r.effects.map((e) => [e.actionId, e.verdict])).toEqual([
      ["a", "sure"],
      ["p", "pending"],
    ]);
    expect(deps.saved).toHaveLength(1);
    expect(r.ga4Read).toBe(1);
    expect(deps.requests).toHaveLength(4);
    expect(deps.requests[0]).toMatchObject({ metrics: ["itemsViewed", "itemsAddedToCart"], startDate: "2026-07-04", endDate: "2026-07-31", filter: { field: "itemId", inList: ["A1"] } });
    expect(r.effects[0].early?.state).toBe("ok");
    expect(r.effects[1].early).toEqual({ state: "pending", signals: [] });
  });

  it("GA4 nicht eingerichtet: Hinweis statt Signale, Rechnung läuft trotzdem", async () => {
    const deps = fakeDeps({
      ga4: async () => {
        throw new Ga4NotConfiguredError("disabled");
      },
    });
    const r = await refreshEffects(deps, null, NOW);
    expect(r.effects[0]).toMatchObject({ verdict: "sure", early: { state: "notConfigured", signals: [] } });
  });

  it("schon gelesene Signale desselben Zeitraums werden nicht erneut abgefragt", async () => {
    const first = fakeDeps();
    const r1 = await refreshEffects(first, null, NOW);
    const second = fakeDeps({ listEffects: async () => r1.effects });
    const r2 = await refreshEffects(second, null, NOW);
    expect(second.requests).toHaveLength(0);
    expect(r2.effects[0].early?.state).toBe("ok");
  });

  it("ohne Maßnahmen nichts lesen", async () => {
    const deps = fakeDeps({ listActions: async () => [], loadOrders: async () => Promise.reject(new Error("darf nicht")) });
    expect((await refreshEffects(deps, null, NOW)).effects).toEqual([]);
  });

  it("einmal am Tag ab 5 Uhr (Berlin)", () => {
    expect(isEffectsDue(undefined, new Date("2026-10-18T02:30:00Z"))).toBe(false);
    expect(isEffectsDue(undefined, new Date("2026-10-18T03:30:00Z"))).toBe(true);
    expect(isEffectsDue("2026-10-18", new Date("2026-10-18T10:00:00Z"))).toBe(false);
  });
});
