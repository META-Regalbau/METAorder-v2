import type { IStorage } from "../../storage";
import type { ShopPulseDetection, ShopPulseSource } from "@shared/shopPulse";
import type { PulseOrder } from "../pulseOrders";
import type { BuyabilityProduct, PriceChange } from "../buyabilityData";

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

export type ShopPulseDetectorContext = {
  storage: Pick<IStorage, "getShopwareSyncState" | "getSetting" | "saveSetting">;
  tenantId: string | null;
  now: Date;
  /** Shop-Bestellungen der letzten gut 13 Monate aus dem Spiegel; je Lauf nur einmal geladen */
  orders: () => Promise<PulseOrder[]>;
  buyability: BuyabilitySources;
  /** Zeitpunkt des vorigen Laufs dieser Prüfung (null = noch nie) */
  lastRunAt: string | null;
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
  /**
   * Schlüssel-Anfang der eigenen Funde. Damit darf die Prüfung ihre Meldungen auch dann erledigen, wenn
   * eine andere Prüfung derselben Quelle in diesem Lauf nicht lief (z. B. Nachtlauf noch nicht fällig).
   */
  keyPrefix?: string;
  run(ctx: ShopPulseDetectorContext): Promise<ShopPulseDetection[]>;
};
