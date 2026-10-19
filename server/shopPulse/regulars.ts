/**
 * Shop-Puls Stufe 3 (S3-4), Stammkunden-Wache (rein, ohne Datenbank; Tests in
 * tests/unit/shopPulseRegulars.test.ts). Regeln siehe shared/shopPulseRegulars.ts.
 *
 * - Bestellungen: Shop und Portal, nicht storniert, ohne die durchgeschleusten Bestellungen (Muster-Kunden
 *   „Max Mustermann“, musterkunde-de@…), je Nummer die zuletzt geänderte Zeile.
 * - Je Kunde zählen Bestelltage (mehrere Bestellungen am selben Tag = ein Tag); üblicher Abstand = Median der
 *   Abstände zwischen den Bestelltagen.
 * - Mögliche Ursache: Preis eines Stammartikels seit der letzten Bestellung um mindestens 5 % gestiegen, oder
 *   ein Stammartikel ist nicht mehr kaufbar bzw. hat eine lange Lieferzeit (Wiederauffüllzeit über 20 Tage
 *   oder Lieferzeit bis über 14 Tage). Das sind Hinweise, keine Gewissheit.
 */
import type {
  ShopPulseRegularCause,
  ShopPulseRegularCustomer,
  ShopPulseRegularItem,
  ShopPulseRegularSettings,
} from "@shared/shopPulseRegulars";
import { berlinTime } from "./pulseOrders";

export type RegularOrder = {
  orderNumber: string;
  customerNumber: string;
  company: string;
  contactName: string;
  customerEmail: string;
  createdAt: Date;
  status: string | null;
  net: number;
  items: ShopPulseRegularItem[];
};

export type RegularProductInfo = { name: string; sellable: boolean; restockTime: number | null; deliveryTimeMaxDays: number | null };
export type RegularPriceChange = { productNumber: string; oldPriceGross: number | null; newPriceGross: number; changedAt: Date };

export const PRICE_CAUSE_MIN_PERCENT = 5;
export const LONG_RESTOCK_DAYS = 20;
export const LONG_DELIVERY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Durchgeschleuste Bestellung (Muster-Kunden im Händlerportal) */
export function isPassthroughOrder(o: Pick<RegularOrder, "contactName" | "customerEmail" | "company">): boolean {
  return /^musterkunde/i.test(o.customerEmail.trim()) || /mustermann/i.test(o.contactName) || /mustermann/i.test(o.company);
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const dayNumber = (d: Date) => {
  const [y, m, dd] = berlinTime(d).day.split("-").map(Number);
  return Date.UTC(y, m - 1, dd) / DAY_MS;
};

export type RegularAnalysis = Omit<ShopPulseRegularCustomer, "state" | "recipient" | "alertedAt" | "wonAt" | "wonOrderNumber"> & {
  /** Stammartikel-Nummern (für Ursachen) */
  regularNumbers: string[];
};

/** Kunden mit Kennzahlen; nur die, die die Schwellen erfüllen */
export function analyzeRegulars(orders: RegularOrder[], now: Date, settings: Pick<ShopPulseRegularSettings, "minOrders" | "minAnnualRevenue" | "overdueFactor" | "minDaysSinceLast">): RegularAnalysis[] {
  const byCustomer = new Map<string, RegularOrder[]>();
  for (const o of orders) {
    if (!o.customerNumber || o.status === "cancelled" || isPassthroughOrder(o) || o.createdAt.getTime() > now.getTime()) continue;
    const list = byCustomer.get(o.customerNumber) ?? [];
    list.push(o);
    byCustomer.set(o.customerNumber, list);
  }
  const today = dayNumber(now);
  const yearAgo = now.getTime() - 365 * DAY_MS;
  const out: RegularAnalysis[] = [];
  for (const [customerNumber, list] of Array.from(byCustomer.entries())) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const days = Array.from(new Set(list.map((o) => dayNumber(o.createdAt)))).sort((a, b) => a - b);
    if (days.length < settings.minOrders) continue;
    const annualRevenue = list.filter((o) => o.createdAt.getTime() >= yearAgo).reduce((s, o) => s + o.net, 0);
    if (annualRevenue < settings.minAnnualRevenue) continue;
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    const usualGapDays = median(gaps);
    const last = list[list.length - 1];
    const daysSinceLast = today - days[days.length - 1];
    const overdue = usualGapDays > 0 && daysSinceLast > settings.overdueFactor * usualGapDays && daysSinceLast >= settings.minDaysSinceLast;
    const lastDay = days[days.length - 1];
    const lastItems = list
      .filter((o) => dayNumber(o.createdAt) === lastDay)
      .flatMap((o) => o.items)
      .sort((a, b) => b.netTotal - a.netTotal)
      .slice(0, 5);
    const productDays = new Map<string, { name: string; days: Set<number> }>();
    for (const o of list) {
      for (const i of o.items) {
        const e = productDays.get(i.productNumber) ?? { name: i.name, days: new Set<number>() };
        e.days.add(dayNumber(o.createdAt));
        productDays.set(i.productNumber, e);
      }
    }
    const regularItems = Array.from(productDays.entries())
      .filter(([, e]) => e.days.size >= 2)
      .map(([productNumber, e]) => ({ productNumber, name: e.name, days: e.days.size }))
      .sort((a, b) => b.days - a.days || a.productNumber.localeCompare(b.productNumber))
      .slice(0, 10);
    out.push({
      customerNumber,
      company: last.company,
      contactName: last.contactName,
      orders: days.length,
      usualGapDays: Math.round(usualGapDays * 10) / 10,
      lastOrderAt: last.createdAt.toISOString(),
      daysSinceLast,
      annualRevenue: Math.round(annualRevenue),
      overdue,
      lastItems,
      regularItems,
      causes: [],
      regularNumbers: Array.from(new Set([...regularItems.map((r) => r.productNumber), ...lastItems.map((i) => i.productNumber)])),
    });
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.annualRevenue - a.annualRevenue);
}

/** Mögliche Ursachen für einen Kunden: Preisanstieg seit der letzten Bestellung, Lieferbarkeit der Stammartikel */
export function regularCauses(
  c: Pick<RegularAnalysis, "regularNumbers" | "lastOrderAt">,
  priceChanges: RegularPriceChange[],
  products: Map<string, RegularProductInfo>,
): ShopPulseRegularCause[] {
  const since = Date.parse(c.lastOrderAt);
  const wanted = new Set(c.regularNumbers);
  const causes: ShopPulseRegularCause[] = [];
  // Preis: erste Änderung nach der letzten Bestellung bis zur letzten (Netto-Effekt)
  const changes = new Map<string, RegularPriceChange[]>();
  for (const ch of priceChanges) {
    if (!wanted.has(ch.productNumber) || ch.changedAt.getTime() <= since) continue;
    const list = changes.get(ch.productNumber) ?? [];
    list.push(ch);
    changes.set(ch.productNumber, list);
  }
  for (const [pn, list] of Array.from(changes.entries())) {
    list.sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
    const oldPrice = list[0].oldPriceGross;
    const newPrice = list[list.length - 1].newPriceGross;
    if (!oldPrice || oldPrice <= 0) continue;
    const percent = Math.round((newPrice / oldPrice - 1) * 1000) / 10;
    if (percent < PRICE_CAUSE_MIN_PERCENT) continue;
    causes.push({ kind: "price", productNumber: pn, name: products.get(pn)?.name ?? pn, oldPrice, newPrice, percent, changedAt: list[list.length - 1].changedAt.toISOString() });
  }
  for (const pn of c.regularNumbers) {
    const p = products.get(pn);
    if (!p) continue;
    if (!p.sellable) causes.push({ kind: "delivery", productNumber: pn, name: p.name, detail: "notSellable", days: null });
    else if ((p.restockTime ?? 0) > LONG_RESTOCK_DAYS) causes.push({ kind: "delivery", productNumber: pn, name: p.name, detail: "longRestock", days: p.restockTime });
    else if ((p.deliveryTimeMaxDays ?? 0) > LONG_DELIVERY_DAYS) causes.push({ kind: "delivery", productNumber: pn, name: p.name, detail: "longDelivery", days: p.deliveryTimeMaxDays });
  }
  return causes.slice(0, 8);
}

/** Lieferzeit-Obergrenze in Tagen aus dem Produktspiegel (Einheit day/week/month) */
export function deliveryMaxDays(max: unknown, unit: unknown): number | null {
  const n = Number(max);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = String(unit ?? "day").toLowerCase();
  return u.startsWith("week") ? n * 7 : u.startsWith("month") ? n * 30 : n;
}

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const EURO2 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
const NUM = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** Text der Meldung an den Außendienst (deutsch), je Zeile ein Absatz; ohne Kundenansprache-Automatik */
export function regularAlertLines(c: Omit<ShopPulseRegularCustomer, "state" | "recipient" | "alertedAt" | "wonAt" | "wonOrderNumber">): string[] {
  const lines = [
    `${c.company || c.contactName || c.customerNumber} (Kd.-Nr. ${c.customerNumber}) bestellt sonst etwa alle ${NUM.format(c.usualGapDays)} Tage, zuletzt am ${DATE.format(new Date(c.lastOrderAt))} – seit ${c.daysSinceLast} Tagen nichts mehr.`,
    `${c.orders} Bestelltage, Umsatz der letzten 12 Monate ${EURO.format(c.annualRevenue)} netto.`,
  ];
  if (c.lastItems.length) lines.push(`Zuletzt gekauft: ${c.lastItems.map((i) => `${i.quantity}× ${i.name} (${i.productNumber})`).join("; ")}`);
  if (c.regularItems.length) lines.push(`Kauft regelmäßig: ${c.regularItems.slice(0, 5).map((r) => `${r.name} (${r.days}×)`).join("; ")}`);
  if (c.causes.length) {
    const causes = c.causes.map((x) =>
      x.kind === "price"
        ? `Preis ${x.name} seit der letzten Bestellung ${EURO2.format(x.oldPrice)} → ${EURO2.format(x.newPrice)} (+${NUM.format(x.percent)} %)`
        : x.detail === "notSellable"
          ? `${x.name} ist nicht mehr aktiv`
          : `${x.name}: ${x.detail === "longRestock" ? "Wiederauffüllzeit" : "Lieferzeit bis"} ${x.days} Tage`,
    );
    lines.push(`Mögliche Ursache: ${causes.join("; ")}`);
  } else {
    lines.push("Keine Preiserhöhung und keine lange Lieferzeit bei den Stammartikeln erkennbar.");
  }
  lines.push("Bitte bei Gelegenheit nachfragen. Es geht keine automatische Mail an den Kunden.");
  return lines;
}
