import type { OrderProfitabilitySummary, OrderProfitabilityVerdict } from "./schema";

/** Stuecklistenteil einer Konfigurator-Position (Menge je Konfiguration). */
export type OfferProfitabilityPart = {
  productNumber: string | null;
  label: string;
  quantity: number;
  herstellpreisNet: number | null;
  herstellkostenTotal: number | null;
};

export type OfferProfitabilityLine = {
  id: string;
  /** B2Bsellers-Positionsart: product, custom, discount, promotion, ... */
  type: string;
  label: string;
  productNumber: string | null;
  quantity: number;
  unitPriceNet: number | null;
  totalNet: number;
  /** Optionale Positionen zaehlen nicht zur Angebotssumme und nicht zum DB1. */
  optional: boolean;
  /** Zaehlt als Produktposition fuer HK-Abdeckung und DB1. */
  countsForDb: boolean;
  /** Konfigurator-Position: Herstellkosten aus der Stueckliste. */
  isConfiguration: boolean;
  parts?: OfferProfitabilityPart[];
  partsWithHerstellpreis?: number;
  /** Herstellkosten je Einheit (bei Konfigurationen: Summe der Stueckliste). */
  herstellpreisNet: number | null;
  herstellkostenTotal: number | null;
  db1Abs: number | null;
  marginPercent: number | null;
  marginOnRevenuePercent: number | null;
  crmVerdict: OrderProfitabilityVerdict;
};

export type OfferProfitabilitySummary = OrderProfitabilitySummary & {
  /** Summe der Rabatt-/Aktionszeilen des Angebots (negativ). */
  discountTotal: number;
  /** Anteil der Rabatte auf die Positionen mit HK (nach Umsatzanteil verteilt, negativ). */
  discountShareWithHk: number | null;
  /** DB1 der Positionen mit HK vor Angebotsrabatt. */
  db1BeforeDiscount: number | null;
  /** Umsatz der Positionen mit HK nach anteiligem Rabatt. */
  revenueWithHk: number | null;
};

export type OfferProfitabilityResult = {
  id: string;
  offerNumber: string;
  customerName: string | null;
  customerNumber: string | null;
  createdAt: string | null;
  status: string;
  statusLabel: string | null;
  salesChannelId: string;
  salesChannelName: string | null;
  /** net, gross oder tax-free (Shopware-Preisstatus des Angebots) */
  taxStatus: string | null;
  netTotal: number;
  lines: OfferProfitabilityLine[];
  profitability: OfferProfitabilitySummary;
};
