export type ProfitabilityVerdict = "green" | "red" | "none";

export type ProfitabilityProductInput = {
  id: string;
  productNumber: string;
  name: string;
  active: boolean | null;
  priceNet: number;
  herstellpreisNet: number | null;
  purchasePriceNet?: number | null;
};

export type AnalyzedProduct = ProfitabilityProductInput & {
  listPriceNet: number;
  effectivePriceNet: number;
  marginPercent: number | null;
  catalogMarginPercent: number | null;
  marginAbs: number | null;
  crmVerdict: ProfitabilityVerdict;
  priceCheckVerdict: ProfitabilityVerdict;
  catalogCrmVerdict: ProfitabilityVerdict;
};

export type MarginBucket = {
  key: string;
  labelKey: string;
  count: number;
  min: number;
  max: number | null;
};

export type ProfitabilitySummary = {
  total: number;
  active: number;
  withHerstellpreis: number;
  coveragePercent: number;
  crmGreen: number;
  crmRed: number;
  crmNone: number;
  priceCheckGreen: number;
  priceCheckRed: number;
  priceCheckNone: number;
  lossCount: number;
  belowCrmThresholdCount: number;
  avgMarginPercent: number | null;
  medianMarginPercent: number | null;
  minMarginPercent: number | null;
  maxMarginPercent: number | null;
  /** Nur bei Handlerrabatt > 0: vorher grün, nach Rabatt rot. */
  flippedToRedCount: number;
};

export type ProfitabilityAnalysis = {
  products: AnalyzedProduct[];
  summary: ProfitabilitySummary;
  buckets: MarginBucket[];
  crmThreshold: number;
  priceCheckThreshold: number;
  dealerDiscountPercent: number;
};

export const DEFAULT_PRICE_CHECK_THRESHOLD = 7;
export const DEFAULT_CRM_THRESHOLD = 20;

export function applyDealerDiscount(
  listPriceNet: number,
  dealerDiscountPercent: number,
): number {
  if (!Number.isFinite(dealerDiscountPercent) || dealerDiscountPercent <= 0) {
    return listPriceNet;
  }
  const clamped = Math.min(Math.max(dealerDiscountPercent, 0), 100);
  return Math.round(listPriceNet * (1 - clamped / 100) * 100) / 100;
}

export function computeMarginPercent(
  priceNet: number | null | undefined,
  herstellpreisNet: number | null | undefined,
): number | null {
  if (priceNet == null || herstellpreisNet == null || herstellpreisNet <= 0) return null;
  return Math.round(((priceNet - herstellpreisNet) / herstellpreisNet) * 1000) / 10;
}

export function computeVerdict(
  marginPercent: number | null,
  threshold: number,
): ProfitabilityVerdict {
  if (marginPercent == null) return "none";
  return marginPercent >= threshold ? "green" : "red";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10;
  }
  return sorted[mid]!;
}

function assignBucket(marginPercent: number): MarginBucket["key"] {
  if (marginPercent < 0) return "loss";
  if (marginPercent < 7) return "0_7";
  if (marginPercent < 20) return "7_20";
  if (marginPercent < 40) return "20_40";
  return "40_plus";
}

const BUCKET_DEFS: Array<Omit<MarginBucket, "count">> = [
  { key: "loss", labelKey: "profitabilityAnalysis.buckets.loss", min: Number.NEGATIVE_INFINITY, max: 0 },
  { key: "0_7", labelKey: "profitabilityAnalysis.buckets.0_7", min: 0, max: 7 },
  { key: "7_20", labelKey: "profitabilityAnalysis.buckets.7_20", min: 7, max: 20 },
  { key: "20_40", labelKey: "profitabilityAnalysis.buckets.20_40", min: 20, max: 40 },
  { key: "40_plus", labelKey: "profitabilityAnalysis.buckets.40_plus", min: 40, max: null },
];

export function buildProfitabilityAnalysis(
  products: ProfitabilityProductInput[],
  opts?: {
    crmThreshold?: number;
    priceCheckThreshold?: number;
    activeOnly?: boolean;
    dealerDiscountPercent?: number;
  },
): ProfitabilityAnalysis {
  const crmThreshold = opts?.crmThreshold ?? DEFAULT_CRM_THRESHOLD;
  const priceCheckThreshold = opts?.priceCheckThreshold ?? DEFAULT_PRICE_CHECK_THRESHOLD;
  const dealerDiscountPercent = Math.min(
    Math.max(opts?.dealerDiscountPercent ?? 0, 0),
    100,
  );
  const filtered = opts?.activeOnly ? products.filter((p) => p.active !== false) : products;

  const bucketCounts = new Map<string, number>(BUCKET_DEFS.map((b) => [b.key, 0]));
  const margins: number[] = [];

  let withHerstellpreis = 0;
  let crmGreen = 0;
  let crmRed = 0;
  let crmNone = 0;
  let priceCheckGreen = 0;
  let priceCheckRed = 0;
  let priceCheckNone = 0;
  let lossCount = 0;
  let belowCrmThresholdCount = 0;
  let flippedToRedCount = 0;
  let active = 0;

  const analyzed: AnalyzedProduct[] = filtered.map((p) => {
    if (p.active !== false) active += 1;

    const listPriceNet = p.priceNet;
    const effectivePriceNet = applyDealerDiscount(listPriceNet, dealerDiscountPercent);
    const catalogMarginPercent = computeMarginPercent(listPriceNet, p.herstellpreisNet);
    const marginPercent = computeMarginPercent(effectivePriceNet, p.herstellpreisNet);
    const marginAbs =
      p.herstellpreisNet != null && p.herstellpreisNet > 0
        ? effectivePriceNet - p.herstellpreisNet
        : null;
    const crmVerdict = computeVerdict(marginPercent, crmThreshold);
    const catalogCrmVerdict = computeVerdict(catalogMarginPercent, crmThreshold);
    const priceCheckVerdict = computeVerdict(marginPercent, priceCheckThreshold);

    if (marginPercent != null) {
      withHerstellpreis += 1;
      margins.push(marginPercent);
      bucketCounts.set(assignBucket(marginPercent), (bucketCounts.get(assignBucket(marginPercent)) ?? 0) + 1);
      if (marginPercent < 0) lossCount += 1;
      if (marginPercent < crmThreshold) belowCrmThresholdCount += 1;
      if (
        dealerDiscountPercent > 0 &&
        catalogCrmVerdict === "green" &&
        crmVerdict === "red"
      ) {
        flippedToRedCount += 1;
      }
    }

    if (crmVerdict === "green") crmGreen += 1;
    else if (crmVerdict === "red") crmRed += 1;
    else crmNone += 1;

    if (priceCheckVerdict === "green") priceCheckGreen += 1;
    else if (priceCheckVerdict === "red") priceCheckRed += 1;
    else priceCheckNone += 1;

    return {
      ...p,
      listPriceNet,
      effectivePriceNet,
      marginPercent,
      catalogMarginPercent,
      marginAbs,
      crmVerdict,
      priceCheckVerdict,
      catalogCrmVerdict,
    };
  });

  const avgMarginPercent =
    margins.length > 0
      ? Math.round((margins.reduce((sum, v) => sum + v, 0) / margins.length) * 10) / 10
      : null;

  const summary: ProfitabilitySummary = {
    total: filtered.length,
    active,
    withHerstellpreis,
    coveragePercent:
      filtered.length > 0 ? Math.round((withHerstellpreis / filtered.length) * 1000) / 10 : 0,
    crmGreen,
    crmRed,
    crmNone,
    priceCheckGreen,
    priceCheckRed,
    priceCheckNone,
    lossCount,
    belowCrmThresholdCount,
    avgMarginPercent,
    medianMarginPercent: median(margins),
    minMarginPercent: margins.length > 0 ? Math.min(...margins) : null,
    maxMarginPercent: margins.length > 0 ? Math.max(...margins) : null,
    flippedToRedCount,
  };

  const buckets = BUCKET_DEFS.map((def) => ({
    ...def,
    count: bucketCounts.get(def.key) ?? 0,
  }));

  return {
    products: analyzed,
    summary,
    buckets,
    crmThreshold,
    priceCheckThreshold,
    dealerDiscountPercent,
  };
}

export function sortByMargin(
  products: AnalyzedProduct[],
  direction: "asc" | "desc",
  limit = 20,
): AnalyzedProduct[] {
  return products
    .filter((p) => p.marginPercent != null)
    .toSorted((a, b) =>
      direction === "asc"
        ? (a.marginPercent ?? 0) - (b.marginPercent ?? 0)
        : (b.marginPercent ?? 0) - (a.marginPercent ?? 0),
    )
    .slice(0, limit);
}
