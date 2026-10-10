/**
 * DB-Berechnung für Bestell- und Angebotsentwürfe, bevor es den Beleg in Shopware gibt.
 *
 * Verkaufspreis je Position wie bei der Anlage:
 *   - manueller Netto-Stückpreis aus dem Review (beide Arten),
 *   - beim Angebot der Smart-Pricing-Vorschlag,
 *   - sonst Kundenpreis → Kundenrabatt auf Liste → Listenpreis (resolveCustomerUnitPrices),
 *   - ohne zugeordneten Kunden der Listenpreis des Kanals.
 * Herstellkosten wie bei Bestellungen (WDU-IFS-Nummer, sonst Artikelnummer); Sets über ihre
 * Bestandteile, ein fehlender Bestandteil = Set ohne Herstellkosten.
 */
import type { IStorage } from "../storage";
import type { OrderProfitabilityVerdict } from "@shared/schema";
import type {
  DraftPriceSource,
  DraftProfitability,
  DraftProfitabilityLine,
} from "@shared/draftProfitability";
import {
  createHerstellpreisResolver,
  summarizeOrderItems,
  type HerstellpreisRef,
  type ProfitabilityThresholds,
} from "../analytics/orderProfitabilityAnalysis";
import { loadCrmProfitabilitySettings } from "../analytics/crmProfitabilitySettings";
import { computeCrmProfitabilityVerdict, computeHerstellMarginPercent } from "../products/herstellpreisMargin";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/draftProfitability" });

export type DraftKind = "order" | "offer";

/** Ein Artikel einer Position (bei Sets mehrere) mit Menge je Stück/Set. */
export type DraftLinePart = {
  ref: HerstellpreisRef;
  quantityPerUnit: number;
  unitPriceNet: number | null;
};

export type PricedDraftLine = {
  index: number;
  quantity: number;
  isBundle: boolean;
  priceSource: DraftPriceSource;
  parts: DraftLinePart[];
};

/** Minimale Entwurfsform, die Bestell- und Angebotsentwürfe gemeinsam haben. */
export type DraftForProfitability = {
  shopwareCustomerId?: string | null;
  matchingResults?: {
    items: Array<{
      quantity: number;
      matchedProduct?: {
        id: string;
        productNumber?: string | null;
        manualUnitPriceNet?: number;
        suggestedPrice?: number;
      } | null;
      bundle?: {
        components: Array<{ productId?: string | null; productNumber: string; quantity: number }>;
      } | null;
    }>;
  } | null;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function validPrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Summe Teil × Menge; null, sobald ein Teil fehlt. */
function sumParts(parts: DraftLinePart[], valueOf: (part: DraftLinePart) => number | null): number | null {
  let total = 0;
  for (const part of parts) {
    const value = valueOf(part);
    if (value == null) return null;
    total += value * part.quantityPerUnit;
  }
  return parts.length > 0 ? total : null;
}

/**
 * Reine Berechnung aus bepreisten Positionen (testbar ohne Shopware).
 * Positionen ohne Verkaufspreis zählen nicht in die DB, nur in unpricedLineCount.
 */
export function buildDraftProfitability(
  lines: PricedDraftLine[],
  herstellpreisOf: (ref: HerstellpreisRef) => number | null,
  thresholds: Required<ProfitabilityThresholds>,
  options: { frozen?: boolean; now?: Date } = {},
): DraftProfitability {
  const verdictOf = (marginPercent: number | null): OrderProfitabilityVerdict =>
    computeCrmProfitabilityVerdict(marginPercent, thresholds.minMarginPercent, thresholds.warnMarginPercent);

  const resultLines: DraftProfitabilityLine[] = lines.map((line) => {
    const unitPriceRaw = sumParts(line.parts, (part) => part.unitPriceNet);
    const unitPriceNet = unitPriceRaw != null ? round2(unitPriceRaw) : null;
    const hkRaw = sumParts(line.parts, (part) => herstellpreisOf(part.ref));
    const herstellpreisNet = hkRaw != null && hkRaw > 0 ? round2(hkRaw) : null;
    const base = {
      index: line.index,
      quantity: line.quantity,
      unitPriceNet,
      priceSource: unitPriceNet == null ? ("unresolved" as const) : line.priceSource,
      isBundle: line.isBundle,
    };
    if (unitPriceNet == null || herstellpreisNet == null) {
      return {
        ...base,
        herstellpreisNet,
        herstellkostenTotal: herstellpreisNet != null ? round2(herstellpreisNet * line.quantity) : null,
        db1Abs: null,
        marginPercent: null,
        marginOnRevenuePercent: null,
        crmVerdict: "none" as const,
      };
    }
    const herstellkostenTotal = round2(herstellpreisNet * line.quantity);
    const marginPercent = computeHerstellMarginPercent(unitPriceNet, herstellpreisNet);
    return {
      ...base,
      herstellpreisNet,
      herstellkostenTotal,
      db1Abs: round2(unitPriceNet * line.quantity - herstellkostenTotal),
      marginPercent,
      marginOnRevenuePercent: unitPriceNet > 0 ? round1(((unitPriceNet - herstellpreisNet) / unitPriceNet) * 100) : null,
      crmVerdict: verdictOf(marginPercent),
    };
  });

  const priced = resultLines.filter((line) => line.unitPriceNet != null);
  const summary = summarizeOrderItems(
    priced.map((line) => ({
      // jede bepreiste Position zählt für die Abdeckung, auch Sets ohne eigene Artikelnummer
      productNumber: `line-${line.index}`,
      quantity: line.quantity,
      netTotal: round2(line.unitPriceNet! * line.quantity),
      herstellpreisNet: line.herstellpreisNet,
      herstellkostenTotal: line.unitPriceNet != null ? line.herstellkostenTotal : null,
    })),
    thresholds,
  );

  return {
    computedAt: (options.now ?? new Date()).toISOString(),
    frozen: options.frozen ?? false,
    thresholds: { ...thresholds },
    summary,
    lines: resultLines,
    unpricedLineCount: resultLines.length - priced.length,
  };
}

/** Positionen mit Artikelbezug aus dem Entwurf lesen (ohne Preise). */
export function collectDraftLines(
  draft: DraftForProfitability,
  kind: DraftKind,
  productIdByNumber: (productNumber: string) => string | undefined,
): PricedDraftLine[] {
  const items = draft.matchingResults?.items ?? [];
  const lines: PricedDraftLine[] = [];
  items.forEach((item, index) => {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    if (item.bundle?.components?.length) {
      lines.push({
        index,
        quantity,
        isBundle: true,
        priceSource: "unresolved",
        parts: item.bundle.components.map((component) => ({
          ref: {
            productId: component.productId || productIdByNumber(component.productNumber) || null,
            productNumber: component.productNumber,
          },
          quantityPerUnit: component.quantity,
          unitPriceNet: null,
        })),
      });
      return;
    }

    const matched = item.matchedProduct;
    if (!matched?.id) return;
    const manual = validPrice(matched.manualUnitPriceNet);
    const suggested = kind === "offer" ? validPrice(matched.suggestedPrice) : null;
    lines.push({
      index,
      quantity,
      isBundle: false,
      priceSource: manual != null ? "manual" : suggested != null ? "suggested" : "unresolved",
      parts: [
        {
          ref: { productId: matched.id, productNumber: matched.productNumber ?? null },
          quantityPerUnit: 1,
          unitPriceNet: manual ?? suggested,
        },
      ],
    });
  });
  return lines;
}

const PRICE_SOURCE_RANK: Record<DraftPriceSource, number> = {
  manual: 0,
  suggested: 0,
  customer_specific: 1,
  customer_discount: 2,
  list: 3,
  unresolved: 4,
};

function normalizeId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

/**
 * Fehlende Preise aus Shopware holen (Kundenpreis/Rabatt/Liste bzw. Listenpreis ohne Kunde).
 * Fehler führen zu „unresolved“, nie zu einem Abbruch.
 */
async function fillMissingPrices(
  storage: IStorage,
  tenantId: string | null,
  customerId: string | null,
  lines: PricedDraftLine[],
): Promise<void> {
  const missing = lines.flatMap((line) =>
    line.parts.filter((part) => part.unitPriceNet == null && part.ref.productId).map((part) => ({ line, part })),
  );
  if (missing.length === 0) return;

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) return;

  const { ShopwareClient } = await import("../shopware/shopware");
  const { fetchSalesChannelOfferDefaults, fetchProductPricing, toShopwareUuid } = await import(
    "../b2b/b2bOfferCreateContext"
  );
  const { fetchCustomerBoundSalesChannelId, resolveOfferSalesChannelId } = await import(
    "../offers/offerSalesChannelResolver"
  );
  const { resolveCustomerUnitPrices } = await import("./commercialCustomerPricing");

  const client = new ShopwareClient(settings);
  const channel = await resolveOfferSalesChannelId(storage, {
    tenantId,
    customerChannelId: await fetchCustomerBoundSalesChannelId(storage, tenantId, customerId),
    allowedChannelIds: null,
  });
  if (!channel.ok) return;
  const { currencyId } = await fetchSalesChannelOfferDefaults(client, channel.salesChannelId);

  // Gleiche Artikel mit derselben Gesamtmenge abfragen (Mengenstaffel der Kundenpreise)
  const quantityById = new Map<string, { productId: string; productNumber: string | null; quantity: number }>();
  for (const { line, part } of missing) {
    const productId = toShopwareUuid(part.ref.productId!);
    const entry = quantityById.get(productId) ?? {
      productId,
      productNumber: part.ref.productNumber ?? null,
      quantity: 0,
    };
    entry.quantity += line.quantity * part.quantityPerUnit;
    quantityById.set(productId, entry);
  }

  const priceById = new Map<string, { net: number; source: DraftPriceSource }>();
  if (customerId) {
    const resolved = await resolveCustomerUnitPrices(client, {
      customerId,
      currencyId,
      items: [...quantityById.values()],
    });
    for (const [id, price] of resolved.prices) {
      if (price.net > 0) priceById.set(normalizeId(id), { net: price.net, source: price.source });
    }
  } else {
    const list = await fetchProductPricing(client, [...quantityById.keys()], currencyId);
    for (const [id, price] of list) {
      if (price.net > 0) priceById.set(normalizeId(id), { net: round2(price.net), source: "list" });
    }
  }

  for (const line of lines) {
    let source: DraftPriceSource | null = null;
    for (const part of line.parts) {
      if (part.unitPriceNet != null || !part.ref.productId) continue;
      const hit = priceById.get(normalizeId(part.ref.productId));
      if (!hit) continue;
      part.unitPriceNet = hit.net;
      // Set: die unsicherste Quelle der Bestandteile zählt (Liste vor Rabatt vor Kundenpreis)
      if (source == null || PRICE_SOURCE_RANK[hit.source] > PRICE_SOURCE_RANK[source]) source = hit.source;
    }
    if (line.priceSource === "unresolved" && source) line.priceSource = source;
  }
}

/** DB eines Entwurfs berechnen (Preise und Herstellkosten frisch aus Shopware/DB). */
export async function computeDraftProfitability(params: {
  storage: IStorage;
  tenantId: string | null;
  kind: DraftKind;
  draft: DraftForProfitability;
  frozen?: boolean;
}): Promise<DraftProfitability> {
  const { storage, tenantId, kind, draft } = params;
  const settings = await loadCrmProfitabilitySettings(storage, tenantId);
  const thresholds = {
    minMarginPercent: settings.minMarginPercent,
    warnMarginPercent: settings.warnMarginPercent,
  };

  const { productCache } = await import("../products/productCache");
  const lines = collectDraftLines(draft, kind, (productNumber) => productCache.getProductByNumber(productNumber)?.id);

  try {
    await fillMissingPrices(storage, tenantId, draft.shopwareCustomerId ?? null, lines);
  } catch (error) {
    log.warn({ err: error }, "[DraftProfitability] Preise konnten nicht ermittelt werden:");
  }

  let herstellpreisOf: (ref: HerstellpreisRef) => number | null = () => null;
  const shopwareSettings = await storage.getShopwareSettings(tenantId);
  if (shopwareSettings) {
    const { ShopwareClient } = await import("../shopware/shopware");
    herstellpreisOf = await createHerstellpreisResolver(
      lines.flatMap((line) => line.parts.map((part) => part.ref)),
      { storage, client: new ShopwareClient(shopwareSettings), tenantId },
    );
  }

  return buildDraftProfitability(lines, herstellpreisOf, thresholds, { frozen: params.frozen });
}

/** Ohne Recht „DB-Werte sehen“: nur Ampeln, Abdeckung und Preisquelle bleiben. */
export function hideDraftProfitabilityDetails(profitability: DraftProfitability): DraftProfitability {
  return {
    ...profitability,
    detailsHidden: true,
    summary: {
      ...profitability.summary,
      herstellkostenTotal: null,
      db1Total: null,
      marginPercent: null,
      marginOnRevenuePercent: null,
    },
    lines: profitability.lines.map((line) => ({
      ...line,
      herstellpreisNet: null,
      herstellkostenTotal: null,
      db1Abs: null,
      marginPercent: null,
      marginOnRevenuePercent: null,
    })),
  };
}

/**
 * Berechnen und speichern; Fehler werden protokolliert und liefern null (die DB-Anzeige ist
 * nie Voraussetzung für Entwurf oder Anlage).
 */
export async function refreshDraftProfitability(params: {
  storage: IStorage;
  tenantId: string | null;
  kind: DraftKind;
  draftId: string;
  draft: DraftForProfitability;
  frozen?: boolean;
}): Promise<DraftProfitability | null> {
  try {
    const snapshot = await computeDraftProfitability(params);
    await params.storage.saveDraftProfitability(params.kind, params.draftId, snapshot, params.tenantId);
    return snapshot;
  } catch (error) {
    log.warn({ err: error, draftId: params.draftId, kind: params.kind }, "[DraftProfitability] Berechnung fehlgeschlagen:");
    return null;
  }
}

/** Kurzform für Entwurfslisten; ohne Recht nur die Ampel. */
export function toDraftProfitabilityBadge(
  row: { snapshot: DraftProfitability; frozen: boolean } | undefined,
  canViewDetails: boolean,
): import("@shared/draftProfitability").DraftProfitabilityBadge | null {
  if (!row) return null;
  const summary = row.snapshot.summary;
  return {
    crmVerdict: summary.crmVerdict,
    marginPercent: canViewDetails ? summary.marginPercent : null,
    db1Total: canViewDetails ? summary.db1Total : null,
    frozen: row.frozen,
  };
}

/**
 * Aktuelle DB eines Entwurfs für die Anzeige: eingefrorener Stand bzw. bei angelegten Entwürfen
 * der letzte gespeicherte, sonst frisch berechnet. Ohne Recht nur Ampeln.
 */
export async function loadDraftProfitabilityForView(params: {
  storage: IStorage;
  tenantId: string | null;
  kind: DraftKind;
  draftId: string;
  draft: DraftForProfitability & { status?: string | null };
  canViewDetails: boolean;
}): Promise<DraftProfitability | null> {
  const { storage, tenantId, kind, draftId, draft, canViewDetails } = params;
  const stored = await storage.getDraftProfitability(kind, draftId, tenantId);
  const keepStored = stored && (stored.frozen || draft.status === "created" || draft.status === "creating");
  const snapshot = keepStored
    ? stored.snapshot
    : await refreshDraftProfitability({ storage, tenantId, kind, draftId, draft });
  if (!snapshot) return null;
  return canViewDetails ? snapshot : hideDraftProfitabilityDetails(snapshot);
}

const OPEN_DRAFT_STATUSES = new Set(["pending", "review_required", "approved"]);
const backfillInFlight = new Set<string>();

/**
 * Offene Entwürfe ohne gespeicherte DB (z. B. älter als diese Funktion) im Hintergrund
 * nachrechnen — höchstens `limit` je Aufruf, damit eine Liste nie Shopware flutet.
 */
export function scheduleDraftProfitabilityBackfill(params: {
  storage: IStorage;
  tenantId: string | null;
  kind: DraftKind;
  drafts: Array<DraftForProfitability & { id: string; status?: string | null }>;
  existingDraftIds: Set<string>;
  limit?: number;
}): number {
  const { storage, tenantId, kind } = params;
  const candidates = params.drafts
    .filter(
      (draft) =>
        !params.existingDraftIds.has(draft.id) &&
        OPEN_DRAFT_STATUSES.has(draft.status ?? "") &&
        (draft.matchingResults?.items?.length ?? 0) > 0 &&
        !backfillInFlight.has(`${kind}:${draft.id}`),
    )
    .slice(0, params.limit ?? 10);
  if (candidates.length === 0) return 0;
  for (const draft of candidates) backfillInFlight.add(`${kind}:${draft.id}`);
  void (async () => {
    for (const draft of candidates) {
      try {
        await refreshDraftProfitability({ storage, tenantId, kind, draftId: draft.id, draft });
      } finally {
        backfillInFlight.delete(`${kind}:${draft.id}`);
      }
    }
  })();
  return candidates.length;
}
