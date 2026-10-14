/**
 * Angebotsentwürfe zeigen und rechnen mit matchedProduct.catalogPrice / suggestedPrice
 * (generateSmartPricing). Positionen, die erst nach der Preisberechnung einen Treffer bekommen
 * (KI-Vorschlag, Konfigurator, CLIP-Maße, „Nochmal prüfen“), haben nur price → Katalogpreis
 * nachtragen, damit Prüffenster und DB einen Preis haben. Ein Vorschlagspreis wird nicht erfunden.
 */
type Item = { matchedProduct?: { price?: number; catalogPrice?: number } | null };

export function fillMissingOfferCatalogPrices(items: Item[] | undefined | null): number {
  let filled = 0;
  for (const item of items ?? []) {
    const product = item.matchedProduct;
    if (!product || typeof product.catalogPrice === "number" || typeof product.price !== "number") continue;
    product.catalogPrice = product.price;
    filled++;
  }
  return filled;
}

type PricedItem = {
  matchedProduct?: {
    id?: string;
    productNumber?: string;
    price?: number;
    catalogPrice?: number;
    suggestedPrice?: number;
    manualUnitPriceNet?: number;
  } | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Bruttopreise in Angebotsentwürfen auf netto korrigieren (Fehler bis 14.10.2026, Version 586):
 * Katalogpreis deutlich über dem Netto-Listenpreis = Bruttopreis. Katalog- und Vorschlagspreis
 * werden im selben Verhältnis umgerechnet (der Rabatt bleibt). Von Hand gesetzte Preise bleiben.
 */
export function repairGrossOfferPrices(items: PricedItem[] | undefined | null, listNetOf: (item: PricedItem) => number | null): number {
  let repaired = 0;
  for (const item of items ?? []) {
    const product = item.matchedProduct;
    if (!product || typeof product.manualUnitPriceNet === "number") continue;
    const catalog = product.catalogPrice;
    const listNet = listNetOf(item);
    if (typeof catalog !== "number" || !listNet || listNet <= 0 || catalog <= listNet * 1.05) continue;
    const factor = listNet / catalog;
    product.catalogPrice = round2(listNet);
    if (typeof product.suggestedPrice === "number") product.suggestedPrice = round2(product.suggestedPrice * factor);
    if (typeof product.price === "number" && product.price > listNet * 1.05) product.price = round2(listNet);
    repaired++;
  }
  return repaired;
}

/**
 * Netto-Listenpreise der Positionen: Produkt-Cache des Mandanten, sonst Produktspiegel in der DB
 * (der Cache ist nach einem Neustart bis zum ersten Abgleich leer).
 */
export async function catalogListNetLookup(
  items: PricedItem[] | undefined | null,
  storage?: Pick<import("../storage").IStorage, "getShopwareProductMirrorsByNumbers"> | null,
  tenantId?: string | null,
): Promise<(item: PricedItem) => number | null> {
  const { productCache } = await import("../products/productCache");
  const { productNetPrice } = await import("../products/productNetPrice");
  const byNumber = new Map<string, number>();
  const missing: string[] = [];
  for (const item of items ?? []) {
    const mp = item.matchedProduct;
    if (!mp?.productNumber || byNumber.has(mp.productNumber)) continue;
    const product = (mp.id && productCache.getProductById?.(mp.id)) || productCache.getProductByNumber?.(mp.productNumber) || null;
    const net = product ? productNetPrice(product) : 0;
    if (net > 0) byNumber.set(mp.productNumber, net);
    else missing.push(mp.productNumber);
  }
  if (missing.length && storage) {
    try {
      const { mirrorRowsToProducts } = await import("../shopware/shopwareMirror");
      const rows = await storage.getShopwareProductMirrorsByNumbers([...new Set(missing)], tenantId ?? null);
      for (const product of mirrorRowsToProducts(rows)) {
        const net = productNetPrice(product);
        if (net > 0 && product.productNumber) byNumber.set(product.productNumber, net);
      }
    } catch {
      /* ohne Spiegel: Position bleibt unverändert */
    }
  }
  return (item) => byNumber.get(item.matchedProduct?.productNumber ?? "") ?? null;
}

const REPAIRABLE_STATUSES = new Set(["pending", "review_required", "approved"]);

/** Offenen Angebotsentwurf korrigieren und speichern; gibt den (ggf. neuen) Entwurf zurück. */
export async function repairOfferDraftPrices<D extends { id: string; status?: string | null; matchingResults?: unknown }>(
  storage: import("../storage").IStorage,
  draft: D,
  tenantId: string | null,
): Promise<D> {
  if (!REPAIRABLE_STATUSES.has(draft.status ?? "")) return draft;
  const matching = draft.matchingResults as { items?: PricedItem[] } | null | undefined;
  if (!matching?.items?.length) return draft;
  const copy = structuredClone(matching);
  const repaired = repairGrossOfferPrices(copy.items, await catalogListNetLookup(copy.items, storage, tenantId));
  if (!repaired) return draft;
  const updated = await storage.updateOfferDraft(draft.id, { matchingResults: copy as never }, tenantId);
  const { logger } = await import("../lib/logger");
  logger.child({ component: "commercial/offerDraftCatalogPrices" }).warn(
    { event: "offer_draft.gross_prices_repaired", draftId: draft.id, lines: repaired },
    `Angebotsentwurf: ${repaired} Bruttopreis(e) auf netto korrigiert`,
  );
  const result = ((updated as D | undefined) ?? { ...draft, matchingResults: copy }) as D;
  // DB-Ampel mit den korrigierten Preisen neu rechnen (im Hintergrund)
  const { refreshDraftProfitability } = await import("./draftProfitability");
  void Promise.resolve()
    .then(() => refreshDraftProfitability({ storage, tenantId, kind: "offer", draftId: draft.id, draft: result as never }))
    .catch(() => undefined);
  return result;
}
