import type { OrderProfitabilitySummary, OrderProfitabilityVerdict } from "./schema";

/** Woher der Netto-Stückpreis einer Entwurfsposition für die DB-Berechnung stammt. */
export type DraftPriceSource =
  | "manual"
  | "suggested"
  | "customer_specific"
  | "customer_discount"
  | "list"
  | "unresolved";

/** DB je Entwurfsposition (Index = Position in matchingResults.items). */
export type DraftProfitabilityLine = {
  index: number;
  quantity: number;
  /** Netto-Stückpreis (bei Sets: Summe der Bestandteile je Set). */
  unitPriceNet: number | null;
  priceSource: DraftPriceSource;
  /** Herstellkosten je Stück bzw. Set (null = fehlt). */
  herstellpreisNet: number | null;
  herstellkostenTotal: number | null;
  db1Abs: number | null;
  /** Aufschlag auf Herstellkosten in % (Grundlage der Ampel). */
  marginPercent: number | null;
  marginOnRevenuePercent: number | null;
  crmVerdict: OrderProfitabilityVerdict;
  isBundle: boolean;
};

export type DraftProfitability = {
  computedAt: string;
  /** true = Stand bei der Anlage in Shopware, wird nicht mehr neu berechnet. */
  frozen: boolean;
  thresholds: { minMarginPercent: number; warnMarginPercent: number };
  summary: OrderProfitabilitySummary;
  lines: DraftProfitabilityLine[];
  /** Positionen ohne ermittelbaren Verkaufspreis (zählen nicht in die DB). */
  unpricedLineCount: number;
  /** Ohne Recht „DB-Werte sehen“ fehlen alle Beträge und Prozente; nur die Ampel bleibt. */
  detailsHidden?: boolean;
};

/** Kurzform für Entwurfslisten. */
export type DraftProfitabilityBadge = {
  crmVerdict: OrderProfitabilityVerdict;
  marginPercent: number | null;
  db1Total: number | null;
  frozen: boolean;
  /** Freigabe bei Rot (siehe DraftMarginApprovalView.state) */
  approvalState?: import("./draftMarginApproval").DraftMarginApprovalState;
};
