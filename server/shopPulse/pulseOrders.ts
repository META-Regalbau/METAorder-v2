/**
 * Shop-Puls: Shop-Bestellungen aus dem Bestellspiegel für die Umsatz-Prüfungen (PR B).
 *
 * Nur MO-Bestellungen (Onlineshop; die durchgeschleusten Händlerportal-Bestellungen ohne MO verzerren
 * Umsätze massiv), ohne stornierte. Shopware vergibt Bestellnummern nicht eindeutig: je Nummer zählt die
 * zuletzt geänderte Zeile (wie Statistik und CRM). Zeitpunkt aus payload.createdAt – orderDate trägt nur
 * das Datum. Tag und Stunde in Berlin.
 */
import { and, isNull, eq, sql, type AnyColumn } from "drizzle-orm";
import { shopwareOrders } from "@shared/schema";
import { isMoOrderNumber } from "@shared/orderNumberFilter";
import { db } from "../db";

export type PulseOrder = {
  orderNumber: string;
  createdAt: Date;
  /** Kalendertag in Berlin, YYYY-MM-DD */
  day: string;
  /** Stunde in Berlin, 0–23 */
  hour: number;
  /** Bruttobetrag */
  total: number;
  paymentMethod: string | null;
};

const BERLIN = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Tag, Stunde und Wochentag (1 = Montag … 7 = Sonntag) in Berlin */
export function berlinTime(d: Date): { day: string; hour: number; weekday: number } {
  const p = Object.fromEntries(BERLIN.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: WEEKDAY[p.weekday] ?? 0 };
}

/** Kalendertag verschieben (reine Datumsrechnung, unabhängig von der Sommerzeit) */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Wochentag eines Kalendertags (1 = Montag … 7 = Sonntag) */
export function weekdayOfDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export type MirrorOrderRow = {
  orderNumber: string | null;
  swUpdatedAt: Date | null;
  createdAt: string | null;
  total: string | number | null;
  paymentMethod: string | null;
  status: string | null;
};

/** Spiegel-Zeilen → Shop-Bestellungen (MO, nicht storniert, je Nummer die zuletzt geänderte) */
export function toPulseOrders(rows: MirrorOrderRow[]): PulseOrder[] {
  const latest = new Map<string, MirrorOrderRow>();
  for (const r of rows) {
    const number = String(r.orderNumber ?? "").trim();
    if (!isMoOrderNumber(number)) continue;
    const prev = latest.get(number);
    if (!prev || (r.swUpdatedAt?.getTime() ?? 0) > (prev.swUpdatedAt?.getTime() ?? 0)) latest.set(number, r);
  }
  const out: PulseOrder[] = [];
  for (const [orderNumber, r] of Array.from(latest.entries())) {
    if (r.status === "cancelled") continue;
    const createdAt = r.createdAt ? new Date(r.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
    const total = Number(r.total ?? 0);
    const { day, hour } = berlinTime(createdAt);
    out.push({
      orderNumber,
      createdAt,
      day,
      hour,
      total: Number.isFinite(total) ? total : 0,
      paymentMethod: r.paymentMethod?.trim() || null,
    });
  }
  return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

/** Shop-Bestellungen ab einem Zeitpunkt aus dem Spiegel (Live 2026: rund 2.100 MO-Zeilen insgesamt) */
export async function loadPulseOrders(tenantId: string | null, since: Date): Promise<PulseOrder[]> {
  const p = shopwareOrders.payload;
  const rows = await db
    .select({
      orderNumber: shopwareOrders.orderNumber,
      swUpdatedAt: shopwareOrders.swUpdatedAt,
      createdAt: sql<string | null>`${p}->>'createdAt'`,
      total: sql<string | null>`${p}->>'totalAmount'`,
      paymentMethod: sql<string | null>`${p}->>'paymentMethod'`,
      status: sql<string | null>`${p}->>'status'`,
    })
    .from(shopwareOrders)
    .where(and(tenantIs(shopwareOrders.tenantId, tenantId), sql`upper(${shopwareOrders.orderNumber}) like 'MO%'`));
  return toPulseOrders(rows).filter((o) => o.createdAt.getTime() >= since.getTime());
}
