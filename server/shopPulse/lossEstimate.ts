/**
 * Shop-Puls, geschätzter Verlust pro Stunde für Meldungen, deren Prüfung keinen liefert (PR F, Konzept
 * Stufe 1 Abschnitt 5). Rein, ohne Datenbank; Tests in tests/unit/shopPulseAi.test.ts.
 *
 * Reihenfolge:
 * 1. detector: die Prüfung hat selbst geschätzt (lossPerHour am Fund) – bleibt immer vorn.
 * 2. products: Sammelmeldungen „nicht kaufbar“ (nicht kaufbar, Preis 0 €, ausverkauft) mit Artikelliste in
 *    den Belegen: Netto-Umsatz dieser Artikel der letzten 365 Tage, brutto je Geschäftsstunde
 *    (gleiche Formel wie die Topseller-Funde, lossPerHourOf).
 * 3. paymentShare: Zahlart fehlt bzw. ohne Bestellungen: Anteil der Zahlart an den Shop-Bestellungen der
 *    8 Wochen davor × üblicher Umsatz dieser Tageszeit.
 * 4. hourOfDay: Shop nimmt gar nichts an (Bestell-Lücke, Warenkorb-Probe, Live-Trichter ohne Käufe):
 *    üblicher Umsatz dieser Tageszeit.
 * Alles andere (Wochenvergleiche, Messprobleme, Lieferzeiten, Preissprung, Spiegel) bekommt keine
 * Schätzung: ein Verlust ist daraus nicht seriös ableitbar.
 *
 * „Üblicher Umsatz dieser Tageszeit“: Shop-Umsatz (MO, brutto) derselben Stunde ±1 an den letzten 8
 * gleichen Wochentagen, geteilt durch 3 × 8 Stunden. Drei Stunden statt einer, weil der Shop nur rund
 * 4–5 Bestellungen pro Werktag hat.
 */
import type { ShopPulseCode, ShopPulseLossEstimate, ShopPulseSignal } from "@shared/shopPulse";
import { addDays, berlinTime, type PulseOrder } from "./pulseOrders";
import { lossPerHourOf } from "./detectors/buyability";

const HOUR_WEEKS = 8;
const HOUR_SPAN = 1;
const PAYMENT_WEEKS = 8;

/** Sammelmeldungen mit Artikelliste (evidence.products), bei denen die Artikel nicht kaufbar sind */
const PRODUCT_CODES: readonly ShopPulseCode[] = ["productsUnavailable", "productsPriceZero", "productsSoldOut"];
const PAYMENT_CODES: readonly ShopPulseCode[] = ["paymentGone", "paymentMethodGone"];
/** Funde, bei denen der Shop insgesamt nichts verkauft */
const SHOP_WIDE_CODES: readonly ShopPulseCode[] = [
  "orderGap",
  "orderGapConfirmed",
  "orderGapCheckout",
  "orderGapVisitors",
  "cartProbeHome",
  "cartProbeSearch",
  "cartProbeAdd",
  "cartProbeCart",
  "cartProbeCheckout",
  "ga4LiveNoAddToCart",
  "ga4LiveNoCheckout",
];

/** Braucht die Schätzung die Shop-Bestellungen? (sonst gar nicht erst laden) */
export const needsOrders = (s: Pick<ShopPulseSignal, "code" | "lossPerHour">) =>
  !(s.lossPerHour && s.lossPerHour > 0) && (PAYMENT_CODES.includes(s.code) || SHOP_WIDE_CODES.includes(s.code));

export const needsProductRevenue = (s: Pick<ShopPulseSignal, "code" | "lossPerHour">) => !(s.lossPerHour && s.lossPerHour > 0) && PRODUCT_CODES.includes(s.code);

/** Üblicher Shop-Umsatz pro Stunde zu dieser Tageszeit (Stunde ±1, letzte 8 gleiche Wochentage), brutto */
export function usualRevenueAt(orders: PulseOrder[], now: Date): number | null {
  const { day, hour } = berlinTime(now);
  const days = new Set(Array.from({ length: HOUR_WEEKS }, (_, k) => addDays(day, -7 * (k + 1))));
  const total = orders.filter((o) => days.has(o.day) && Math.abs(o.hour - hour) <= HOUR_SPAN).reduce((s, o) => s + o.total, 0);
  const perHour = Math.round(total / ((2 * HOUR_SPAN + 1) * HOUR_WEEKS));
  return perHour > 0 ? perHour : null;
}

/** Anteil einer Zahlart an den Shop-Bestellungen der 8 Wochen vor heute (Name ohne Groß-/Kleinschreibung) */
export function paymentShare(orders: PulseOrder[], method: string, now: Date): number | null {
  const today = berlinTime(now).day;
  const from = addDays(today, -7 * PAYMENT_WEEKS);
  const window = orders.filter((o) => o.day >= from && o.day < today);
  if (!window.length) return null;
  const name = method.trim().toLowerCase();
  const hits = window.filter((o) => (o.paymentMethod ?? "").trim().toLowerCase() === name).length;
  return hits ? hits / window.length : null;
}

/** Artikelnummern aus den Belegen (Liste von Nummern oder von { number }) */
export function productNumbersOf(evidence: Record<string, unknown>): string[] {
  const list = Array.isArray(evidence.products) ? evidence.products : [];
  return list
    .map((p) => (typeof p === "string" ? p : p && typeof p === "object" && typeof (p as any).number === "string" ? (p as any).number : ""))
    .filter((pn): pn is string => !!pn);
}

export type LossEstimateData = {
  /** Shop-Bestellungen aus dem Spiegel; null = nicht gelesen */
  orders: PulseOrder[] | null;
  /** Netto-Umsatz je Artikelnummer (365 Tage); null = nicht gelesen */
  productRevenue: Map<string, number> | null;
  now: Date;
};

export function estimateLoss(signal: Pick<ShopPulseSignal, "code" | "params" | "evidence" | "lossPerHour">, data: LossEstimateData): ShopPulseLossEstimate | null {
  if (signal.lossPerHour && signal.lossPerHour > 0) return { perHour: Math.round(signal.lossPerHour), basis: "detector" };

  if (PRODUCT_CODES.includes(signal.code)) {
    if (!data.productRevenue) return null;
    const net = productNumbersOf(signal.evidence).reduce((s, pn) => s + (data.productRevenue!.get(pn) ?? 0), 0);
    const perHour = lossPerHourOf(net);
    return perHour ? { perHour, basis: "products" } : null;
  }

  if (!data.orders) return null;
  const usual = usualRevenueAt(data.orders, data.now);
  if (!usual) return null;

  if (PAYMENT_CODES.includes(signal.code)) {
    const method = String(signal.params.method ?? signal.params.name ?? "");
    const share = method ? paymentShare(data.orders, method, data.now) : null;
    const perHour = share ? Math.round(usual * share) : 0;
    return perHour > 0 ? { perHour, basis: "paymentShare" } : null;
  }

  if (SHOP_WIDE_CODES.includes(signal.code)) return { perHour: usual, basis: "hourOfDay" };
  return null;
}
