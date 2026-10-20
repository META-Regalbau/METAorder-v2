/**
 * Kundenmails B2 „Stammkunden-Brief“ (Konzept 19./20.10.2026): reine Regeln ohne Datenbank
 * (Tests in tests/unit/customerMailsRegularLetter.test.ts).
 *
 * - Kandidaten: Kunden (je E-Mail) mit mindestens REGULAR_LETTER_MIN_ORDER_DAYS Bestelltagen in den letzten
 *   REGULAR_LETTER_LOOKBACK_DAYS Tagen (MO, ohne Storno und durchgeschleuste Bestellungen).
 * - Stammartikel: an mindestens 2 Bestelltagen gekauft (häufigste zuerst, dann Umsatz); reicht das nicht, die
 *   umsatzstärksten Artikel. Höchstens 3, nur kaufbare Artikel mit Preis, ohne Service-/Technik-Artikel (SW…).
 * - Zubehör: im Shop aktive Crossselling-Paare („Das passt dazu“) der Stammartikel, ohne schon gekaufte, höchstens 3.
 * - Ausschlüsse: offene Reklamation, überfällige Zahlung.
 * Rechtsgrundlage, Brevo-Sperre, Kanal und Kontaktbremse prüft danach planRecipients (legalBasis.ts).
 */
import type { CustomerMailSkipReason } from "@shared/customerMails";
import { normalizeEmail } from "./legalBasis";

export const REGULAR_LETTER_MIN_ORDER_DAYS = 2;
export const REGULAR_LETTER_LOOKBACK_DAYS = 730;
export const REGULAR_LETTER_MAX_ITEMS = 3;
export const REGULAR_LETTER_MAX_ACCESSORIES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LetterOrder = {
  orderNumber: string;
  email: string;
  customerNumber: string;
  salesChannelId: string | null;
  status: string | null;
  createdAt: Date;
  paymentOverdue: boolean;
  passthrough: boolean;
  items: Array<{ productNumber: string; name: string; netTotal: number }>;
};

export type LetterCustomer = {
  email: string;
  customerNumber: string | null;
  salesChannelId: string | null;
  orderDays: number;
  lastOrderAt: Date;
  /** Kandidaten für Stammartikel in Reihenfolge (mehr als nötig, weil unverkäufliche später wegfallen) */
  itemNumbers: string[];
  /** alle je gekauften Artikelnummern (für Zubehör: nichts vorschlagen, was schon gekauft wurde) */
  bought: Set<string>;
  paymentOverdue: boolean;
};

/** Service- und Technik-Artikel (Konfigurator SW…, Mindermengenzuschlag usw.) gehören nicht in den Brief */
export function isLetterItem(productNumber: string, netTotal: number): boolean {
  return !!productNumber && !/^SW\d/i.test(productNumber) && netTotal > 0;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function letterCandidates(orders: LetterOrder[], now: Date): LetterCustomer[] {
  const since = now.getTime() - REGULAR_LETTER_LOOKBACK_DAYS * DAY_MS;
  const byEmail = new Map<string, LetterOrder[]>();
  for (const o of orders) {
    if (!/^MO/i.test(o.orderNumber) || o.status === "cancelled" || o.passthrough || o.createdAt.getTime() < since) continue;
    const email = normalizeEmail(o.email);
    if (!email) continue;
    byEmail.set(email, [...(byEmail.get(email) ?? []), o]);
  }
  const out: LetterCustomer[] = [];
  for (const [email, list] of Array.from(byEmail.entries())) {
    const days = new Set(list.map((o) => dayKey(o.createdAt)));
    if (days.size < REGULAR_LETTER_MIN_ORDER_DAYS) continue;
    const latest = list.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const stats = new Map<string, { days: Set<string>; net: number }>();
    for (const o of list)
      for (const i of o.items) {
        if (!isLetterItem(i.productNumber, i.netTotal)) continue;
        const s = stats.get(i.productNumber) ?? { days: new Set<string>(), net: 0 };
        s.days.add(dayKey(o.createdAt));
        s.net += i.netTotal;
        stats.set(i.productNumber, s);
      }
    const ranked = Array.from(stats.entries()).sort((a, b) => b[1].days.size - a[1].days.size || b[1].net - a[1].net);
    out.push({
      email,
      customerNumber: latest.customerNumber.trim() || null,
      salesChannelId: latest.salesChannelId,
      orderDays: days.size,
      lastOrderAt: latest.createdAt,
      itemNumbers: ranked.slice(0, REGULAR_LETTER_MAX_ITEMS * 3).map(([n]) => n),
      bought: new Set(stats.keys()),
      paymentOverdue: list.some((o) => o.paymentOverdue),
    });
  }
  return out.sort((a, b) => b.orderDays - a.orderDays || b.lastOrderAt.getTime() - a.lastOrderAt.getTime());
}

export type LetterProduct = { name: string; priceNet: number | null; deliveryTime: string | null; url: string; sellable: boolean };

/** Preis wie im Shop für Firmenkunden: netto mit Hinweis */
export function formatNetPrice(net: number): string {
  return `${net.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € zzgl. MwSt.`;
}

export type LetterContent = {
  items: Array<{ productNumber: string } & LetterProduct>;
  accessories: Array<{ productNumber: string } & LetterProduct>;
  attributes: Record<string, string | number | null>;
};

/**
 * Inhalt eines Briefs: Stammartikel und Zubehör mit aktuellem Preis/Lieferzeit/Link. null = kein kaufbarer
 * Stammartikel (dann kein Brief).
 */
export function letterContent(
  customer: Pick<LetterCustomer, "itemNumbers" | "bought">,
  products: Map<string, LetterProduct>,
  accessoriesBySource: Map<string, string[]>,
): LetterContent | null {
  const usable = (n: string) => {
    const p = products.get(n);
    return p && p.sellable && p.url && typeof p.priceNet === "number" && p.priceNet > 0 ? { productNumber: n, ...p } : null;
  };
  const items = customer.itemNumbers.map(usable).filter((x): x is NonNullable<typeof x> => !!x).slice(0, REGULAR_LETTER_MAX_ITEMS);
  if (!items.length) return null;
  const seen = new Set<string>([...Array.from(customer.bought), ...items.map((i) => i.productNumber)]);
  const accessories: LetterContent["accessories"] = [];
  for (const item of items)
    for (const target of accessoriesBySource.get(item.productNumber) ?? []) {
      if (accessories.length >= REGULAR_LETTER_MAX_ACCESSORIES || seen.has(target)) continue;
      const p = usable(target);
      if (!p) continue;
      seen.add(target);
      accessories.push(p);
    }
  const attributes: Record<string, string | number | null> = { MO_STAMM_ANZAHL: items.length, MO_ZUB_ANZAHL: accessories.length };
  for (let i = 0; i < REGULAR_LETTER_MAX_ITEMS; i += 1) {
    const it = items[i];
    attributes[`MO_STAMM_${i + 1}_NAME`] = it?.name ?? "";
    attributes[`MO_STAMM_${i + 1}_NR`] = it?.productNumber ?? "";
    attributes[`MO_STAMM_${i + 1}_PREIS`] = it ? formatNetPrice(it.priceNet as number) : "";
    attributes[`MO_STAMM_${i + 1}_LIEFERZEIT`] = it?.deliveryTime ?? "";
    attributes[`MO_STAMM_${i + 1}_URL`] = it?.url ?? "";
  }
  for (let i = 0; i < REGULAR_LETTER_MAX_ACCESSORIES; i += 1) {
    const a = accessories[i];
    attributes[`MO_ZUB_${i + 1}_NAME`] = a?.name ?? "";
    attributes[`MO_ZUB_${i + 1}_PREIS`] = a ? formatNetPrice(a.priceNet as number) : "";
    attributes[`MO_ZUB_${i + 1}_URL`] = a?.url ?? "";
  }
  return { items, accessories, attributes };
}

/** Grund, einen Kunden nicht anzuschreiben, bevor die Rechtsgrundlage geprüft wird */
export function letterExclusion(c: Pick<LetterCustomer, "email" | "paymentOverdue">, openComplaints: Set<string>): CustomerMailSkipReason | null {
  if (openComplaints.has(c.email)) return "complaint";
  if (c.paymentOverdue) return "paymentOverdue";
  return null;
}

/** Brevo-Feldtypen der Brief-Felder (alles Text bis auf die Anzahlen) */
export function letterAttributeTypes(): Record<string, "text" | "float"> {
  const t: Record<string, "text" | "float"> = { MO_STAMM_ANZAHL: "float", MO_ZUB_ANZAHL: "float" };
  for (let i = 1; i <= REGULAR_LETTER_MAX_ITEMS; i += 1) for (const f of ["NAME", "NR", "PREIS", "LIEFERZEIT", "URL"]) t[`MO_STAMM_${i}_${f}`] = "text";
  for (let i = 1; i <= REGULAR_LETTER_MAX_ACCESSORIES; i += 1) for (const f of ["NAME", "PREIS", "URL"]) t[`MO_ZUB_${i}_${f}`] = "text";
  return t;
}
