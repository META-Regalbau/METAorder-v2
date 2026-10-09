/**
 * DB-Berechnung fuer ein einzelnes Angebot (B2Bsellers, Haendlerportal und Onlineshop).
 *
 * - Preise netto: bei Preisstatus "gross" (Brutto-Angebot) wird je Position der Steuersatz
 *   herausgerechnet; "net" und "tax-free" sind schon netto.
 * - Konfigurator-Positionen (payload.metaCalcConfigurationPayload) tragen den Preis der ganzen
 *   Stueckliste (Stueckpreis = totalPartnerPrice). Herstellkosten je Einheit = Summe der
 *   Stuecklistenteile (Menge x HK), mal Positionsmenge. Fehlt einem Teil der Herstellpreis, gilt
 *   die Position als ohne HK - DB1 wird nie aus einer unvollstaendigen Stueckliste geschaetzt.
 * - Rabatt-/Aktionszeilen gehen anteilig (nach Umsatzanteil) auf die Positionen mit HK.
 * - Optionale Positionen, Zwischensummen und Ueberschriften zaehlen nicht.
 */
import type { Offer } from "@shared/schema";
import type {
  OfferProfitabilityLine,
  OfferProfitabilityPart,
  OfferProfitabilityResult,
  OfferProfitabilitySummary,
} from "@shared/offerProfitability";
import {
  computeCrmProfitabilityVerdict,
  computeHerstellMarginPercent,
} from "../products/herstellpreisMargin";
import { summarizeOrderItems, type HerstellpreisRef } from "./orderProfitabilityAnalysis";

const HIDDEN_LINE_TYPES = new Set(["subtotal", "headline"]);
const DISCOUNT_LINE_TYPES = new Set(["discount", "promotion"]);

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function configurationPayload(item: any): { partsList?: any[]; accessoryList?: any[] } | null {
  const mcp = item?.payload?.metaCalcConfigurationPayload;
  return mcp && (Array.isArray(mcp.partsList) || Array.isArray(mcp.accessoryList)) ? mcp : null;
}

function configurationParts(item: any): any[] {
  const mcp = configurationPayload(item);
  return mcp ? [...(mcp.partsList ?? []), ...(mcp.accessoryList ?? [])] : [];
}

function itemProductNumber(item: any): string | null {
  return str(item?.payload?.productNumber) ?? str(item?.product?.productNumber);
}

function itemTaxRate(item: any): number {
  return (
    num(item?.price?.taxRules?.[0]?.taxRate) ??
    num(item?.priceDefinition?.taxRules?.[0]?.taxRate) ??
    num(item?.price?.calculatedTaxes?.[0]?.taxRate) ??
    0
  );
}

/** Alle Artikel-Bezuege eines Angebots (Positionen und Stuecklistenteile) fuer die HK-Suche. */
export function collectOfferHerstellpreisRefs(items: any[]): HerstellpreisRef[] {
  const refs: HerstellpreisRef[] = [];
  for (const item of items ?? []) {
    if (HIDDEN_LINE_TYPES.has(item?.type)) continue;
    if (configurationPayload(item)) {
      for (const part of configurationParts(item)) {
        refs.push({ productId: str(part.productId), productNumber: str(part.productNumber) });
      }
    } else if (item?.productId || itemProductNumber(item)) {
      refs.push({ productId: str(item.productId), productNumber: itemProductNumber(item) });
    }
  }
  return refs;
}

export function buildOfferProfitability(
  offer: Offer,
  opts: {
    taxStatus: string | null;
    herstellpreisOf: (ref: HerstellpreisRef) => number | null;
    minMarginPercent: number;
  },
): OfferProfitabilityResult {
  const gross = opts.taxStatus === "gross";
  const toNet = (value: number | null, item: any): number | null =>
    value == null ? null : gross ? value / (1 + itemTaxRate(item) / 100) : value;

  const lines: OfferProfitabilityLine[] = [];
  for (const item of offer.items ?? []) {
    const type = String(item?.type ?? "product");
    if (HIDDEN_LINE_TYPES.has(type)) continue;

    const quantity = num(item.quantity) ?? 0;
    const unitPriceNet = toNet(num(item.unitPrice), item);
    const totalNet = roundMoney(toNet(num(item.totalPrice), item) ?? (unitPriceNet ?? 0) * quantity);
    const optional = item.optional === true;
    const countsForDb = type === "product" && !optional;
    const isConfiguration = configurationPayload(item) != null;

    let parts: OfferProfitabilityPart[] | undefined;
    let herstellpreisNet: number | null;
    if (isConfiguration) {
      parts = configurationParts(item).map((part) => {
        const partQuantity = num(part.quantity) ?? 0;
        const partHk = opts.herstellpreisOf({
          productId: str(part.productId),
          productNumber: str(part.productNumber),
        });
        return {
          productNumber: str(part.productNumber) ?? str(part.ean),
          label: str(part.description) ?? str(part.productName) ?? str(part.productNumber) ?? "—",
          quantity: partQuantity,
          herstellpreisNet: partHk,
          herstellkostenTotal: partHk != null ? roundMoney(partHk * partQuantity) : null,
        };
      });
      const complete = parts.length > 0 && parts.every((p) => p.herstellkostenTotal != null);
      herstellpreisNet = complete
        ? roundMoney(parts.reduce((sum, p) => sum + (p.herstellkostenTotal ?? 0), 0))
        : null;
    } else {
      herstellpreisNet =
        type === "product" ? opts.herstellpreisOf({ productId: str(item.productId), productNumber: itemProductNumber(item) }) : null;
    }

    const hasHk = countsForDb && herstellpreisNet != null && herstellpreisNet > 0;
    const herstellkostenTotal = hasHk ? roundMoney(herstellpreisNet! * quantity) : null;
    const db1Abs = hasHk ? roundMoney(totalNet - herstellkostenTotal!) : null;
    const marginPercent = hasHk ? computeHerstellMarginPercent(unitPriceNet, herstellpreisNet) : null;
    const marginOnRevenuePercent =
      hasHk && unitPriceNet != null && unitPriceNet > 0
        ? roundPercent(((unitPriceNet - herstellpreisNet!) / unitPriceNet) * 100)
        : null;

    lines.push({
      id: String(item.id ?? item._uniqueIdentifier ?? lines.length),
      type,
      label: str(item.label) ?? str(item.description) ?? "—",
      productNumber: isConfiguration ? null : itemProductNumber(item),
      quantity,
      unitPriceNet: unitPriceNet != null ? roundMoney(unitPriceNet) : null,
      totalNet,
      optional,
      countsForDb,
      isConfiguration,
      ...(parts
        ? { parts, partsWithHerstellpreis: parts.filter((p) => p.herstellpreisNet != null).length }
        : {}),
      herstellpreisNet: hasHk ? herstellpreisNet : null,
      herstellkostenTotal,
      db1Abs,
      marginPercent,
      marginOnRevenuePercent,
      crmVerdict: hasHk ? computeCrmProfitabilityVerdict(marginPercent, opts.minMarginPercent) : "none",
    });
  }

  const dbLines = lines.filter((line) => line.countsForDb);
  const base = summarizeOrderItems(
    dbLines.map((line) => ({
      // jede Produktposition zaehlt fuer die Abdeckung, auch Konfigurationen ohne eigene Artikelnummer
      productNumber: line.productNumber ?? line.id,
      quantity: line.quantity,
      netTotal: line.totalNet,
      herstellpreisNet: line.herstellpreisNet,
      herstellkostenTotal: line.herstellkostenTotal,
    })),
    opts.minMarginPercent,
  );

  const discountTotal = roundMoney(
    lines
      .filter((line) => DISCOUNT_LINE_TYPES.has(line.type) && !line.optional)
      .reduce((sum, line) => sum + line.totalNet, 0),
  );
  const productRevenue = dbLines.reduce((sum, line) => sum + line.totalNet, 0);
  const revenueWithHkBefore = dbLines
    .filter((line) => line.herstellkostenTotal != null)
    .reduce((sum, line) => sum + line.totalNet, 0);

  let profitability: OfferProfitabilitySummary;
  if (base.db1Total == null || base.herstellkostenTotal == null) {
    profitability = {
      ...base,
      discountTotal,
      discountShareWithHk: null,
      db1BeforeDiscount: null,
      revenueWithHk: null,
    };
  } else {
    const discountShareWithHk =
      productRevenue > 0 ? roundMoney(discountTotal * (revenueWithHkBefore / productRevenue)) : 0;
    const revenueWithHk = roundMoney(revenueWithHkBefore + discountShareWithHk);
    const db1Total = roundMoney(base.db1Total + discountShareWithHk);
    const marginPercent =
      base.herstellkostenTotal > 0 ? roundPercent((db1Total / base.herstellkostenTotal) * 100) : null;
    profitability = {
      ...base,
      db1Total,
      marginPercent,
      marginOnRevenuePercent: revenueWithHk > 0 ? roundPercent((db1Total / revenueWithHk) * 100) : null,
      crmVerdict: computeCrmProfitabilityVerdict(marginPercent, opts.minMarginPercent),
      discountTotal,
      discountShareWithHk,
      db1BeforeDiscount: base.db1Total,
      revenueWithHk,
    };
  }

  return {
    id: offer.id,
    offerNumber: offer.offerNumber,
    customerName: offer.customerName ?? null,
    customerNumber: offer.customerNumber ?? null,
    createdAt: offer.createdAt ?? null,
    status: offer.status,
    statusLabel: offer.statusLabel ?? null,
    salesChannelId: offer.salesChannelId,
    salesChannelName: offer.salesChannelName ?? null,
    taxStatus: opts.taxStatus,
    netTotal: offer.netPrice,
    lines,
    profitability,
  };
}

/** Angebote zu genau einer Angebotsnummer (Gross-/Kleinschreibung und Leerzeichen egal). */
export function matchOffersByNumber<T extends { offerNumber: string }>(offers: T[], offerNumber: string): T[] {
  const wanted = offerNumber.trim().toLowerCase();
  if (!wanted) return [];
  return offers.filter((offer) => String(offer.offerNumber ?? "").trim().toLowerCase() === wanted);
}
