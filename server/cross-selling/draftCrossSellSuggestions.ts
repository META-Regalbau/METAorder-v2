/**
 * Crossselling-Vorschläge im Entwurfs-Prüffenster (Bestellung und Angebot).
 *
 * Früher rechnete jedes Öffnen eines Entwurfs für jede erkannte Position die Regeln neu – mit
 * Shopware-Suchen über 100–200 Produkte je Regel. Live 11.10.2026 dauerte ein Bestellentwurf
 * 6–16 s; viele Entwürfe kurz hintereinander geöffnet brachten den Server zum Neustart.
 * Jetzt: Produkt aus dem Cache, Ergebnis je Artikel 10 Minuten gemerkt, gleichzeitige Anfragen
 * zum selben Artikel teilen eine Berechnung, höchstens drei Berechnungen je Entwurf parallel.
 */
import type { ShopwareSettings } from "@shared/schema";
import { ShopwareClient } from "../shopware/shopware";
import { productCache } from "../products/productCache";
import { RuleEngine } from "./ruleEngine";
import { crossSellSuggestOptions, dedupeAndLimitSuggestions, getCombinedCrossSellingRules, loadCrossSellRankingBundle } from "./crossSellService";
import { logger } from "../lib/logger";

const log = logger.child({ component: "cross-selling/draftCrossSellSuggestions" });

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_PARALLEL = 3;
const MAX_CACHE_ENTRIES = 2000;

export type DraftSuggestion = {
  id: string;
  productNumber: string;
  name: string;
  price: number;
  netPrice?: number;
  imageUrl?: string;
  stock?: number;
  available?: boolean;
  crossSellReason?: string;
  hybridScore?: number;
};

export type DraftSuggestionGroup = {
  forProduct: { id: string; name: string; productNumber: string };
  suggestions: DraftSuggestion[];
};

type MatchedItem = { status?: string; matchedProduct?: { id: string; name: string; productNumber?: string } };

const cache = new Map<string, { at: number; value: Promise<DraftSuggestion[] | null> }>();

/** Für Tests */
export function clearDraftCrossSellCache(): void {
  cache.clear();
}

/** Ergebnis je Schlüssel merken; laufende Berechnung wird geteilt, Fehler werden nicht gemerkt. */
export function cachedSuggestions(
  key: string,
  compute: () => Promise<DraftSuggestion[] | null>,
  now = Date.now(),
): Promise<DraftSuggestion[] | null> {
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  const value = compute().catch((err) => {
    cache.delete(key);
    throw err;
  });
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, value });
  return value;
}

/** Aufgaben mit begrenzter Parallelität, Reihenfolge bleibt erhalten. */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function buildDraftCrossSellSuggestions(params: {
  tenantId: string | null;
  shopwareSettings: ShopwareSettings;
  items: MatchedItem[];
}): Promise<DraftSuggestionGroup[]> {
  const matched = params.items.filter(
    (item): item is MatchedItem & { matchedProduct: { id: string; name: string; productNumber: string } } =>
      item.status === "matched" && Boolean(item.matchedProduct?.productNumber),
  );
  // gleicher Artikel mehrfach im Entwurf: einmal rechnen
  const unique = [...new Map(matched.map((i) => [i.matchedProduct.productNumber, i])).values()];
  if (!unique.length) return [];

  let context: Promise<{
    client: ShopwareClient;
    rules: Awaited<ReturnType<typeof getCombinedCrossSellingRules>>;
    options: ReturnType<typeof crossSellSuggestOptions>;
  }> | null = null;
  const loadContext = () =>
    (context ??= (async () => ({
      client: new ShopwareClient(params.shopwareSettings),
      rules: await getCombinedCrossSellingRules(params.tenantId),
      options: crossSellSuggestOptions(params.tenantId, await loadCrossSellRankingBundle(params.tenantId), "full"),
    }))());

  const engine = new RuleEngine();
  const groups = await mapLimited(unique, MAX_PARALLEL, async (item) => {
    const productNumber = item.matchedProduct.productNumber;
    try {
      const suggestions = await cachedSuggestions(`${params.tenantId ?? "-"}:${productNumber}`, async () => {
        const { client, rules, options } = await loadContext();
        let fullProduct = productCache.getProductByNumber(productNumber);
        if (!fullProduct) {
          const { products } = await client.fetchProducts(25, 1, productNumber, undefined, false, undefined, undefined, undefined, true);
          fullProduct = products.find((p) => p.productNumber === productNumber) || products[0];
        }
        if (!fullProduct) return null;
        const raw = await engine.suggestCrossSelling(fullProduct, rules, client, options);
        return dedupeAndLimitSuggestions(raw, 10).map((s) => ({
          id: s.id,
          productNumber: s.productNumber,
          name: s.name,
          price: s.price,
          netPrice: s.netPrice,
          imageUrl: s.imageUrl,
          stock: s.stock,
          available: s.available,
          crossSellReason: (s as { crossSellReason?: string }).crossSellReason,
          hybridScore: (s as { hybridScore?: number }).hybridScore,
        }));
      });
      if (!suggestions) return null;
      return {
        forProduct: { id: item.matchedProduct.id, name: item.matchedProduct.name, productNumber },
        suggestions,
      };
    } catch (err) {
      log.warn({ err, productNumber }, "[Cross-Selling] Vorschläge für Artikel nicht ermittelt");
      return null;
    }
  });
  return groups.filter((g): g is DraftSuggestionGroup => g !== null);
}
