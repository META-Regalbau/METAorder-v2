import type { IStorage } from "../../storage";
import type { ShopPulseDetection, ShopPulseSource, ShopPulseState } from "@shared/shopPulse";
import type { FetchLike } from "../../shopContent/shopWatch";
import type { ShopApi } from "../../shopContent/shopProducts";
import type { PulseOrder } from "../pulseOrders";
import type { BuyabilityProduct, PriceChange } from "../buyabilityData";
import type { Ga4Access } from "../ga4Client";
import type { OfferWatchSources } from "./offers";
import type { AdsSources } from "./ads";
import type { GscSources } from "./gsc";
import type { PaymentSources } from "./payments";
import type { SpeedSources } from "./speed";
import type { MerchantSources } from "./merchant";

/** Zahl- bzw. Versandart des Verkaufskanals */
export type ChannelMethod = { id: string; name: string; active: boolean };
export type ChannelMethods = { payment: ChannelMethod[]; shipping: ChannelMethod[] };

/** Datenquellen der Kaufbarkeits-Prüfung; je Lauf höchstens einmal geladen */
export type BuyabilitySources = {
  products: () => Promise<BuyabilityProduct[]>;
  /** Netto-Umsatz je Artikelnummer, Shop-Bestellungen der letzten 365 Tage */
  revenue: () => Promise<Map<string, number>>;
  priceChanges: (since: Date) => Promise<PriceChange[]>;
  /** Zahl- und Versandarten des Kanals META Regalbau DE (Admin-API) */
  channelMethods: () => Promise<ChannelMethods>;
};

/** Storefront des Kanals META Regalbau DE für die Prüfungen wie ein Kunde */
export type StorefrontShop = {
  /** Storefront-Adresse ohne Schrägstrich am Ende */
  storefront: string;
  channelId: string;
  /** Admin-API (Preis gegenprüfen, SEO-Adressen) */
  api: ShopApi;
  fetchImpl?: FetchLike;
  /** Pause zwischen zwei Abrufen (Live schonen); in Tests 0 */
  pauseMs: number;
};

export type StorefrontAccess = {
  /**
   * Shop unter der Sperre des Shop-Wächters abfragen (nie parallel zu dessen Läufen). Ist sie belegt,
   * wirft es ShopBusyError; der Lauf setzt die Prüfung dann aus.
   */
  withShop<T>(fn: (shop: StorefrontShop) => Promise<T>): Promise<T>;
};

export type ShopPulseDetectorState = NonNullable<ShopPulseState["detectors"]>[string];

export type ShopPulseDetectorContext = {
  storage: Pick<IStorage, "getShopwareSyncState" | "getSetting" | "saveSetting">;
  tenantId: string | null;
  now: Date;
  /** Shop-Bestellungen der letzten gut 13 Monate aus dem Spiegel; je Lauf nur einmal geladen */
  orders: () => Promise<PulseOrder[]>;
  buyability: BuyabilitySources;
  storefront: StorefrontAccess;
  /** GA4-Property des Mandanten; nicht eingerichtet → Ga4NotConfiguredError (die Prüfung setzt aus) */
  ga4: Ga4Access;
  /** B2B-Angebotsanfragen (B2Bsellers), Außendienst-Zuordnung und Standard-Bearbeiter */
  b2b: OfferWatchSources;
  /** Google Ads (S2-4); nicht eingerichtet → AdsNotConfiguredError (die Prüfung setzt aus) */
  ads: AdsSources;
  /** Search Console (S2-5); nicht eingerichtet → GscNotConfiguredError (die Prüfungen setzen aus) */
  gsc: GscSources;
  /** Zahlungsstatus der Shop-Bestellungen inkl. stornierter (S3-3) */
  payments: PaymentSources;
  /** PageSpeed-Insights (S3-5); nicht eingerichtet → SpeedNotConfiguredError (die Prüfung setzt aus) */
  speed: SpeedSources;
  /** Google Merchant Center (S3-6); nicht eingerichtet → MerchantNotConfiguredError (die Prüfung setzt aus) */
  merchant: MerchantSources;
  /** Zeitpunkt des vorigen Laufs dieser Prüfung (null = noch nie) */
  lastRunAt: string | null;
  /** Diese Prüfung lief noch nie (kein Stand), auch nicht fehlgeschlagen */
  firstRun: boolean;
};

/**
 * Eine Prüfung des Shop-Puls. run liefert die aktuellen Funde; wirft sie, gilt die Quelle in diesem Lauf
 * als unvollständig (ihre offenen Meldungen bleiben offen).
 */
export type ShopPulseDetector = {
  id: string;
  source: ShopPulseSource;
  /** Setzt aus, solange der Bestellabgleich hängt (Fund der Spiegel-Frische), sonst Fehlalarme */
  needsFreshMirror?: boolean;
  /** "nightly": einmal je Nacht (5–7 Uhr Berlin) statt in jedem Takt; „Jetzt prüfen“ läuft immer */
  cadence?: "nightly";
  /** Eigener Takt: nur laufen, wenn fällig (prev = Stand des vorigen Laufs); „Jetzt prüfen“ läuft immer */
  due?: (prev: ShopPulseDetectorState | undefined, now: Date) => boolean;
  /**
   * Schlüssel-Anfang der eigenen Funde. Damit darf die Prüfung ihre Meldungen auch dann erledigen, wenn
   * eine andere Prüfung derselben Quelle in diesem Lauf nicht lief (z. B. Nachtlauf noch nicht fällig).
   */
  keyPrefix?: string;
  run(ctx: ShopPulseDetectorContext): Promise<ShopPulseDetection[]>;
};
