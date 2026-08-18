/**
 * Gemeinsame Typen und Formatierer der Produkt-Übersicht — genutzt von der Tabelle
 * (ProductOverviewPage) und vom Produkt-Modal (ProductInsightsModal).
 */

export interface OverviewAdvancedPrice {
  quantityStart: number;
  quantityEnd: number | null;
  gross: number | null;
  net: number | null;
  ruleId: string | null;
  ruleName: string | null;
}

export interface OverviewProduct {
  id: string;
  productNumber: string;
  name: string;
  active: boolean | null;
  stock: number | null;
  ean?: string;
  manufacturerNumber?: string;
  manufacturerName?: string;
  priceGross: number;
  priceNet: number;
  purchasePriceNet?: number | null;
  /** Importierte Herstellkosten netto (META Order, nicht Shopware). */
  herstellpreisNet?: number | null;
  taxRate: number;
  currency: string;
  salesChannelIds: string[];
  salesChannels: Array<{ id: string; name: string }>;
  advancedPrices: OverviewAdvancedPrice[];
  hasAdvancedPrices: boolean;
  advancedPriceCount: number;
  categories: string[];
  tags: string[];
  deliveryTimeId: string | null;
  deliveryTimeName: string | null;
  deliveryTimeMin: number | null;
  deliveryTimeMax: number | null;
  deliveryTimeUnit: string | null;
  hasDeliveryTime: boolean;
  restockTime: number | null;
  customFields?: Record<string, unknown>;
  /** Aufgelöste Labels für Customfield-Werte, die Shopware-Entity-IDs sind */
  customFieldsDisplay?: Record<string, string>;
  customFieldKeys: string[];
  propertyCount: number;
  parentId: string | null;
  childCount: number | null;
  options?: Array<{ group: string; option: string }>;
  inheritedFields?: string[];
  createdAt?: string;
  updatedAt?: string;
  lastPriceChangeAt?: string | null;
}

export interface PriceHistoryEntry {
  id: string;
  oldPriceGross: number | null;
  newPriceGross: number;
  oldPriceNet: number | null;
  newPriceNet: number;
  changedAt: string;
}

export interface OverviewResponse {
  products: OverviewProduct[];
  salesChannels: Array<{ id: string; name: string }>;
  total: number;
  /** Mindest-Deckungsbeitrag aus den CRM-Einstellungen (Schwelle für die Margen-Ampel). */
  profitabilityMinMarginPercent?: number;
  fromMirror?: boolean;
}

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

export const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatCustomFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatCustomFieldDisplay(
  product: Pick<OverviewProduct, "customFields" | "customFieldsDisplay">,
  key: string,
): string {
  const resolved = product.customFieldsDisplay?.[key];
  if (resolved) return resolved;
  return formatCustomFieldValue(product.customFields?.[key]);
}

export function formatDeliveryTimeLabel(
  product: Pick<
    OverviewProduct,
    | "deliveryTimeId"
    | "deliveryTimeName"
    | "deliveryTimeMin"
    | "deliveryTimeMax"
    | "deliveryTimeUnit"
    | "hasDeliveryTime"
  >,
  t: TranslateFn,
): string | null {
  const name = product.deliveryTimeName?.trim();
  if (name) return name;

  const hasDeliveryTime =
    product.hasDeliveryTime ||
    Boolean(product.deliveryTimeId) ||
    product.deliveryTimeMin != null ||
    product.deliveryTimeMax != null;
  if (!hasDeliveryTime) return null;

  const unitKey = product.deliveryTimeUnit ?? "day";
  const unitLabel = t(`productOverview.deliveryTimeUnits.${unitKey}`, { defaultValue: unitKey });
  const { deliveryTimeMin: min, deliveryTimeMax: max } = product;
  if (min != null && max != null && min !== max) {
    return t("productOverview.deliveryTimeRange", { min, max, unit: unitLabel });
  }
  if (min != null && max != null && min === max) {
    return t("productOverview.deliveryTimeSingle", { value: min, unit: unitLabel });
  }
  if (min != null) {
    return t("productOverview.deliveryTimeSingle", { value: min, unit: unitLabel });
  }
  if (max != null) {
    return t("productOverview.deliveryTimeSingle", { value: max, unit: unitLabel });
  }
  return null;
}

export function formatRestockTimeLabel(
  restockTime: number | null | undefined,
  t: TranslateFn,
): string | null {
  if (restockTime == null) return null;
  return t("productOverview.restockTimeDays", { value: restockTime });
}

/** Parent products with variants are not printable SKUs. */
export function isPrintableSku(product: Pick<OverviewProduct, "childCount">): boolean {
  return (product.childCount ?? 0) <= 0;
}
