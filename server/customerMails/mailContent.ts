/**
 * Kundenmails B2b–B5: reine Inhaltsregeln der übrigen Mailarten (Tests in tests/unit/customerMailsTypes.test.ts).
 *
 * - Überfällig-Erinnerung (B2b): nur gemeldete Stammkunden ohne mögliche Ursache (Preis/Lieferzeit), Meldung
 *   mindestens OVERDUE_WAIT_DAYS alt, kein CRM-Anruf seit der Meldung, höchstens einmal in OVERDUE_REPEAT_DAYS.
 * - Newsletter (B4): ein Block „Neu im Shop“ für alle (neueste kaufbare Artikel); den übrigen Inhalt pflegt die
 *   Vorlage in Brevo.
 * - After-Sales (B3): Service-Mail SERVICE_MIN..MAX Tage nach dem Versand (ohne Werbung, Transaktionsweg),
 *   Zubehör-Mail ACCESSORY_MIN..MAX Tage nach dem Versand; je Bestellung höchstens einmal.
 * - Reaktivierung (B5): Einmalkäufer mit letzter Bestellung vor 6–12 Monaten, je Adresse einmal, feste
 *   Kontrollgruppe (Anteil CONTROL_GROUP_PERCENT) für die Wirkungsmessung.
 */
import { createHash } from "crypto";
import { formatNetPrice, isLetterItem, type LetterOrder, type LetterProduct } from "./regularLetter";

const DAY_MS = 24 * 60 * 60 * 1000;

export const OVERDUE_WAIT_DAYS = 7;
export const OVERDUE_REPEAT_DAYS = 90;
export const NEW_PRODUCT_DAYS = 45;
export const NEW_PRODUCT_MAX = 4;
export const SERVICE_MIN_DAYS = 3;
export const SERVICE_MAX_DAYS = 10;
export const ACCESSORY_MIN_DAYS = 30;
export const ACCESSORY_MAX_DAYS = 45;
export const REACTIVATION_MIN_DAYS = 180;
export const REACTIVATION_MAX_DAYS = 365;
export const CONTROL_GROUP_PERCENT = 20;
export const SERVICE_MAX_POSITIONS = 5;

/** Feste Kontrollgruppe je Adresse und Mailart (gleiches Ergebnis bei jedem Lauf) */
export function inControlGroup(email: string, salt: string, percent = CONTROL_GROUP_PERCENT): boolean {
  const h = createHash("sha256").update(`${salt}:${email.trim().toLowerCase()}`).digest();
  return h.readUInt32BE(0) % 100 < percent;
}

export type OverdueInput = {
  state: string;
  alertedAt: Date | null;
  causes: number;
  lastCallAt: Date | null;
  lastReminderAt: Date | null;
};

/** null = Erinnerung fällig, sonst Grund */
export function overdueBlocker(i: OverdueInput, now: Date): "notAlerted" | "tooEarly" | "cause" | "called" | "recentlyReminded" | null {
  if (i.state !== "alerted" || !i.alertedAt) return "notAlerted";
  if (now.getTime() - i.alertedAt.getTime() < OVERDUE_WAIT_DAYS * DAY_MS) return "tooEarly";
  if (i.causes > 0) return "cause";
  if (i.lastCallAt && i.lastCallAt.getTime() >= i.alertedAt.getTime()) return "called";
  if (i.lastReminderAt && now.getTime() - i.lastReminderAt.getTime() < OVERDUE_REPEAT_DAYS * DAY_MS) return "recentlyReminded";
  return null;
}

export type NewProduct = { productNumber: string; createdAt: Date };

/** Neueste Artikel (angelegt in den letzten NEW_PRODUCT_DAYS Tagen), nur kaufbar mit Preis und Link */
export function newProductAttributes(candidates: NewProduct[], products: Map<string, LetterProduct>, now: Date): Record<string, string | number | null> {
  const fresh = candidates
    .filter((c) => now.getTime() - c.createdAt.getTime() <= NEW_PRODUCT_DAYS * DAY_MS && isLetterItem(c.productNumber, 1))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((c) => ({ c, p: products.get(c.productNumber) }))
    .filter((x) => x.p && x.p.sellable && x.p.url && typeof x.p.priceNet === "number" && x.p.priceNet > 0)
    .slice(0, NEW_PRODUCT_MAX);
  const attrs: Record<string, string | number | null> = { MO_NEU_ANZAHL: fresh.length };
  for (let i = 0; i < NEW_PRODUCT_MAX; i += 1) {
    const x = fresh[i];
    attrs[`MO_NEU_${i + 1}_NAME`] = x?.p?.name ?? "";
    attrs[`MO_NEU_${i + 1}_PREIS`] = x?.p ? formatNetPrice(x.p.priceNet as number) : "";
    attrs[`MO_NEU_${i + 1}_URL`] = x?.p?.url ?? "";
    attrs[`MO_NEU_${i + 1}_BILD`] = x?.p?.image ?? "";
  }
  return attrs;
}

const ageDays = (from: Date, now: Date) => (now.getTime() - from.getTime()) / DAY_MS;
const dateDe = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });

/** Bestellungen im Fenster nach dem Versand (MO, nicht storniert, nicht durchgeschleust, mit Versanddatum) */
export function ordersShippedBetween(orders: LetterOrder[], now: Date, minDays: number, maxDays: number): LetterOrder[] {
  return orders.filter((o) => {
    if (!/^MO/i.test(o.orderNumber) || o.status === "cancelled" || o.passthrough || !o.shippedAt) return false;
    const age = ageDays(o.shippedAt, now);
    return age >= minDays && age <= maxDays;
  });
}

/** Service-Mail nach dem Versand: Bestellnummer, Positionen mit Link, Sendungsverfolgung. Keine Werbung. */
export function serviceMailAttributes(order: LetterOrder, products: Map<string, LetterProduct>): Record<string, string | number | null> {
  const positions = order.items.filter((i) => isLetterItem(i.productNumber, i.netTotal)).slice(0, SERVICE_MAX_POSITIONS);
  const attrs: Record<string, string | number | null> = {
    MO_BESTELLNR: order.orderNumber,
    MO_BESTELLDATUM: dateDe(order.createdAt),
    MO_VERSANDDATUM: order.shippedAt ? dateDe(order.shippedAt) : "",
    MO_SENDUNG_URL: order.trackingUrl ?? "",
    MO_POS_ANZAHL: positions.length,
  };
  for (let i = 0; i < SERVICE_MAX_POSITIONS; i += 1) {
    const it = positions[i];
    const p = it ? products.get(it.productNumber) : undefined;
    attrs[`MO_POS_${i + 1}_NAME`] = it ? p?.name || it.name : "";
    // Link nur zu Artikeln, die es im Shop noch gibt
    attrs[`MO_POS_${i + 1}_URL`] = it && p?.sellable && p.url ? p.url : "";
    attrs[`MO_POS_${i + 1}_BILD`] = it ? (p?.image ?? "") : "";
  }
  return attrs;
}

/** Zubehör zu einer Bestellung: aktive Crossselling-Paare der bestellten Artikel, ohne Bestelltes; null = nichts */
export function accessoryMailAttributes(
  order: LetterOrder,
  boughtEver: Set<string>,
  products: Map<string, LetterProduct>,
  accessoriesBySource: Map<string, string[]>,
  max = 3,
): Record<string, string | number | null> | null {
  const seen = new Set<string>([...Array.from(boughtEver), ...order.items.map((i) => i.productNumber)]);
  const picked: Array<{ productNumber: string } & LetterProduct> = [];
  for (const it of order.items)
    for (const target of accessoriesBySource.get(it.productNumber) ?? []) {
      if (picked.length >= max || seen.has(target)) continue;
      const p = products.get(target);
      if (!p || !p.sellable || !p.url || typeof p.priceNet !== "number" || p.priceNet <= 0) continue;
      seen.add(target);
      picked.push({ productNumber: target, ...p });
    }
  if (!picked.length) return null;
  const attrs: Record<string, string | number | null> = { MO_BESTELLNR: order.orderNumber, MO_BESTELLDATUM: dateDe(order.createdAt), MO_ZUB_ANZAHL: picked.length };
  for (let i = 0; i < max; i += 1) {
    const a = picked[i];
    attrs[`MO_ZUB_${i + 1}_NAME`] = a?.name ?? "";
    attrs[`MO_ZUB_${i + 1}_PREIS`] = a ? formatNetPrice(a.priceNet as number) : "";
    attrs[`MO_ZUB_${i + 1}_URL`] = a?.url ?? "";
    attrs[`MO_ZUB_${i + 1}_BILD`] = a?.image ?? "";
  }
  return attrs;
}
