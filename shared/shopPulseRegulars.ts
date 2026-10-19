/**
 * Shop-Puls Stufe 3, S3-4 Stammkunden-Wache (Konzept 19.10.2026, Abschnitt 3): Typen für Server
 * (server/shopPulse/regulars*.ts) und Oberfläche (/admin/shop-puls?tab=regulars).
 *
 * Je Kunde der übliche Bestellabstand aus Shop- und Portal-Bestellungen (ohne die durchgeschleusten
 * Bestellungen der Muster-Kunden). Nur Kunden mit mindestens 3 Bestelltagen und ab 2.000 € Netto-Umsatz in
 * den letzten 365 Tagen; überfällig ab dem Doppelten des üblichen Abstands. Höchstens eine Meldung je Kunde in
 * 90 Tagen, an den Außendienst laut Zuordnung, sonst an Oliver. Keine Mails an Kunden.
 */
import { z } from "zod";

/** Einstellungen (Settings-Key shop_pulse_regular_settings), auf der Seite einstellbar */
export type ShopPulseRegularSettings = {
  enabled: boolean;
  /** so viele Bestelltage mindestens */
  minOrders: number;
  /** Netto-Umsatz der letzten 365 Tage mindestens (Euro) */
  minAnnualRevenue: number;
  /** überfällig ab dem Vielfachen des üblichen Abstands */
  overdueFactor: number;
  /** und frühestens nach so vielen Tagen seit der letzten Bestellung (sonst melden sich wöchentliche Kunden nach 2 Wochen) */
  minDaysSinceLast: number;
};

export const DEFAULT_SHOP_PULSE_REGULAR_SETTINGS: ShopPulseRegularSettings = {
  enabled: true,
  minOrders: 3,
  minAnnualRevenue: 2000,
  overdueFactor: 2,
  minDaysSinceLast: 28,
};

export const shopPulseRegularSettingsSchema = z
  .object({
    enabled: z.boolean(),
    minOrders: z.number().int().min(2).max(50),
    minAnnualRevenue: z.number().min(0).max(10_000_000),
    overdueFactor: z.number().min(1.2).max(10),
    minDaysSinceLast: z.number().int().min(0).max(365),
  })
  .partial()
  .strict();

export function normalizeRegularSettings(raw: unknown): ShopPulseRegularSettings {
  const parsed = shopPulseRegularSettingsSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  return { ...DEFAULT_SHOP_PULSE_REGULAR_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

/** Höchstens eine Meldung je Kunde in so vielen Tagen („im Quartal“) */
export const SHOP_PULSE_REGULAR_ALERT_DAYS = 90;

export const SHOP_PULSE_REGULAR_STATES = ["ok", "overdue", "alerted", "won", "backlog"] as const;
/**
 * ok = im üblichen Takt, overdue = überfällig (noch nicht gemeldet), alerted = gemeldet, won = nach der
 * Meldung bestellt, backlog = beim ersten Lauf schon überfällig (Altbestand, nur per Knopf melden)
 */
export type ShopPulseRegularState = (typeof SHOP_PULSE_REGULAR_STATES)[number];

export const SHOP_PULSE_REGULAR_RECIPIENT_SOURCES = ["rep", "oliver"] as const;
export type ShopPulseRegularRecipientSource = (typeof SHOP_PULSE_REGULAR_RECIPIENT_SOURCES)[number];

export type ShopPulseRegularItem = { productNumber: string; name: string; quantity: number; netTotal: number };

/** Mögliche Ursache: Preis eines Stammartikels gestiegen bzw. Stammartikel nicht (schnell) lieferbar */
export type ShopPulseRegularCause =
  | { kind: "price"; productNumber: string; name: string; oldPrice: number; newPrice: number; percent: number; changedAt: string }
  | { kind: "delivery"; productNumber: string; name: string; detail: "notSellable" | "longRestock" | "longDelivery"; days: number | null };

export type ShopPulseRegularCustomer = {
  customerNumber: string;
  company: string;
  contactName: string;
  /** Bestelltage insgesamt (im Spiegel) */
  orders: number;
  /** üblicher Abstand (Median der Abstände zwischen Bestelltagen) in Tagen */
  usualGapDays: number;
  lastOrderAt: string;
  daysSinceLast: number;
  /** Netto-Umsatz der letzten 365 Tage */
  annualRevenue: number;
  overdue: boolean;
  /** Positionen der letzten Bestellung (größte zuerst, höchstens 5) */
  lastItems: ShopPulseRegularItem[];
  /** Artikel, die an mindestens 2 Bestelltagen gekauft wurden (höchstens 10) */
  regularItems: Array<{ productNumber: string; name: string; days: number }>;
  causes: ShopPulseRegularCause[];
  state: ShopPulseRegularState;
  recipient: { name: string; email: string | null; source: ShopPulseRegularRecipientSource } | null;
  alertedAt: string | null;
  wonAt: string | null;
  wonOrderNumber: string | null;
};

/** Antwort von GET /api/shop-pulse/regulars */
export type ShopPulseRegularsOverview = {
  settings: ShopPulseRegularSettings;
  customers: ShopPulseRegularCustomer[];
  lastRunAt: string | null;
};
