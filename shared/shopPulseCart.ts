/**
 * Shop-Puls Stufe 2, Baustein S2-3 (Konzept 18.10.2026, Abschnitt 3): B2B-Warenkorb-Alarm. Typen für Server
 * (server/shopPulse/cart*.ts, server/routes/shopPulseCartRoutes.ts) und Oberfläche (/admin/shop-puls, Reiter
 * Warenkorb-Alarm).
 *
 * Das Shopware-Plugin MetaCartSignal (shopware/custom/plugins/MetaCartSignal, Installation über die Agentur
 * wirduzen) meldet gespeicherte Warenkörbe angemeldeter Geschäftskunden signiert an
 * POST /api/public/shop-pulse/cart-signal. METAorder hält je Kunde nur den letzten Warenkorb (Kennzahlen und
 * Ansprechpartner, höchstens 30 Tage). Liegt ein Warenkorb ab der Schwelle seit der Wartezeit unverändert und
 * hat der Kunde seitdem nicht bestellt, geht ein Alarm an den Außendienst laut Zuordnung (sales_rep_assignments),
 * sonst an den Ersatz-Empfänger bzw. Oliver. Je Kunde höchstens ein Alarm pro Woche; eine Bestellung binnen 14
 * Tagen nach dem Alarm zählt als Erfolg und landet im Maßnahmen-Protokoll.
 *
 * Standard AUS: erst nach Freigabe durch den Datenschutzbeauftragten einschalten. Solange aus, nimmt METAorder
 * Meldungen an, speichert aber nichts.
 */
import { z } from "zod";

/** Meldung des Plugins (Version 1) */
const customerSchema = z.object({
  id: z.string().max(64),
  customerNumber: z.string().trim().min(1).max(64),
  company: z.string().max(200).default(""),
  contactName: z.string().max(200).default(""),
  email: z.string().max(200).default(""),
  phone: z.string().max(60).nullable().default(null),
});

const positionSchema = z.object({
  productNumber: z.string().max(64),
  label: z.string().max(200).default(""),
  quantity: z.number().int().min(0).max(1_000_000),
  netTotal: z.number().finite(),
});

export const cartSignalSchema = z.discriminatedUnion("event", [
  z.object({
    version: z.literal(1),
    event: z.literal("cart.saved"),
    occurredAt: z.string().datetime({ offset: true }),
    salesChannelId: z.string().max(64).default(""),
    customer: customerSchema,
    cart: z.object({
      netTotal: z.number().finite().min(0),
      currency: z.string().max(8).default("EUR"),
      positionCount: z.number().int().min(0).max(100_000),
      positions: z.array(positionSchema).max(50),
    }),
  }),
  z.object({
    version: z.literal(1),
    event: z.literal("order.placed"),
    occurredAt: z.string().datetime({ offset: true }),
    salesChannelId: z.string().max(64).default(""),
    customer: customerSchema,
    order: z.object({ orderNumber: z.string().max(64) }),
  }),
]);
export type CartSignal = z.infer<typeof cartSignalSchema>;

export type ShopPulseCartPosition = { productNumber: string; label: string; quantity: number; netTotal: number };

/** Stand eines Warenkorbs: wartet, Alarm gesendet, bestellt (ohne bzw. nach Alarm), zu klein */
export const SHOP_PULSE_CART_STATES = ["waiting", "alarmed", "ordered", "won", "below"] as const;
export type ShopPulseCartState = (typeof SHOP_PULSE_CART_STATES)[number];

/** Empfänger eines Alarms: Außendienst laut Zuordnung, Ersatz-Empfänger aus den Einstellungen, Oliver */
export const SHOP_PULSE_CART_RECIPIENTS = ["rep", "fallback", "oliver"] as const;
export type ShopPulseCartRecipientSource = (typeof SHOP_PULSE_CART_RECIPIENTS)[number];

export type ShopPulseCart = {
  id: string;
  customerNumber: string;
  company: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  netTotal: number;
  currency: string;
  positionCount: number;
  positions: ShopPulseCartPosition[];
  /** letzte Änderung laut Shop */
  cartUpdatedAt: string;
  receivedAt: string;
  alarmedAt: string | null;
  alarmRecipient: string | null;
  alarmRecipientSource: ShopPulseCartRecipientSource | null;
  /** E-Mail an den Empfänger ging raus (sonst nur Teams/Glocke) */
  alarmMailed: boolean;
  orderedAt: string | null;
  orderNumber: string | null;
  state: ShopPulseCartState;
};

/** Einstellungen (Settings-Key shop_pulse_cart_alarm, Schlüssel verschlüsselt) */
export type ShopPulseCartSettings = {
  /** Schalter „Warenkorb-Alarm“; Standard aus (Freigabe Datenschutzbeauftragter) */
  enabled: boolean;
  /** Schwelle netto in € */
  thresholdNet: number;
  /** so lange unverändert, bevor der Alarm geht */
  waitHours: number;
  /** E-Mail des Ersatz-Empfängers ohne Zuordnung; "" = Oliver (Teams-Direktnachricht und Glocke) */
  fallbackEmail: string;
  fallbackName: string;
};

export const DEFAULT_SHOP_PULSE_CART_SETTINGS: ShopPulseCartSettings = {
  enabled: false,
  thresholdNet: 1000,
  waitHours: 24,
  fallbackEmail: "",
  fallbackName: "",
};

/** Feste Regeln */
export const SHOP_PULSE_CART_RULES = {
  /** Aufbewahrung der Warenkörbe in Tagen */
  retentionDays: 30,
  /** je Kunde höchstens ein Alarm in so vielen Tagen */
  alarmEveryDays: 7,
  /** Bestellung binnen so vieler Tage nach dem Alarm = Erfolg */
  successDays: 14,
  /** ältere Warenkörbe lösen keinen Alarm mehr aus (z. B. nach dem Einschalten) */
  maxCartAgeDays: 7,
  /** Zeitstempel der Meldung darf so weit abweichen */
  maxClockSkewSeconds: 300,
  /** Meldungen je Mandant und Minute */
  ratePerMinute: 120,
} as const;

export const shopPulseCartSettingsSchema = z
  .object({
    enabled: z.boolean(),
    thresholdNet: z.number().min(0).max(1_000_000),
    waitHours: z.number().min(1).max(24 * 14),
    fallbackEmail: z.union([z.literal(""), z.string().trim().email().max(200)]),
    fallbackName: z.string().trim().max(120),
  })
  .partial()
  .strict();
export type ShopPulseCartSettingsUpdate = z.infer<typeof shopPulseCartSettingsSchema>;

export function normalizeShopPulseCartSettings(raw: unknown): ShopPulseCartSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, d: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
  return {
    enabled: r.enabled === true,
    thresholdNet: num(r.thresholdNet, DEFAULT_SHOP_PULSE_CART_SETTINGS.thresholdNet, 0, 1_000_000),
    waitHours: num(r.waitHours, DEFAULT_SHOP_PULSE_CART_SETTINGS.waitHours, 1, 24 * 14),
    fallbackEmail: typeof r.fallbackEmail === "string" ? r.fallbackEmail.trim() : "",
    fallbackName: typeof r.fallbackName === "string" ? r.fallbackName.trim() : "",
  };
}

/** Antwort von GET /api/shop-pulse/cart-alarm */
export type ShopPulseCartOverview = {
  settings: ShopPulseCartSettings;
  /** Mandanten-ID und Adresse für die Plugin-Konfiguration */
  tenantId: string | null;
  endpointUrl: string | null;
  /** geheimer Schlüssel erzeugt (der Schlüssel selbst nur direkt nach dem Erzeugen) */
  hasSecret: boolean;
  /** interne E-Mail eingerichtet (sonst nur Teams/Glocke) */
  mailConfigured: boolean;
  /** letzte angenommene Meldung */
  lastSignalAt: string | null;
  carts: ShopPulseCart[];
};
