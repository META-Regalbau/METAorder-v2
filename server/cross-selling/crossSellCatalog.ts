// Produktidentitaeten aus dem Shopware-Spiegel fuer das Cross-Selling-Gedaechtnis:
// Shopware-ID <-> Artikelnummer und Variante -> Hauptprodukt ("Familie"). Paare werden
// je Familie gefuehrt (Ziel = Hauptprodukt), damit Ablehnungen fuer alle Groessen gelten.
import type { IStorage, ShopwareProductIdentity } from "../storage";

export type CrossSellCatalog = {
  byId: Map<string, ShopwareProductIdentity>;
  byNumber: Map<string, ShopwareProductIdentity>;
  /** Familien-Artikelnummer (Hauptprodukt) zu einer Artikelnummer; unbekannt = unveraendert. */
  canonicalNumber(productNumber: string): string;
  /** Familien-Artikelnummer zu einer Shopware-ID; unbekannt = null. */
  canonicalNumberForId(productId: string): string | null;
  numberForId(productId: string): string | null;
};

export function buildCrossSellCatalog(rows: ShopwareProductIdentity[]): CrossSellCatalog {
  const byId = new Map<string, ShopwareProductIdentity>();
  const byNumber = new Map<string, ShopwareProductIdentity>();
  for (const row of rows) {
    byId.set(row.id, row);
    if (row.productNumber) byNumber.set(row.productNumber.trim(), row);
  }
  const familyOf = (row: ShopwareProductIdentity): string => {
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    return (parent?.productNumber || row.productNumber).trim();
  };
  return {
    byId,
    byNumber,
    canonicalNumber(productNumber: string) {
      const pn = productNumber.trim();
      const row = byNumber.get(pn);
      return row ? familyOf(row) : pn;
    },
    canonicalNumberForId(productId: string) {
      const row = byId.get(productId);
      return row ? familyOf(row) : null;
    },
    numberForId(productId: string) {
      return byId.get(productId)?.productNumber?.trim() || null;
    },
  };
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { catalog: CrossSellCatalog; expiresAt: number }>();

/** Katalog je Mandant, 10 Minuten zwischengespeichert. */
export async function loadCrossSellCatalog(
  storage: Pick<IStorage, "getShopwareProductIdentities">,
  tenantId: string | null,
  opts?: { fresh?: boolean },
): Promise<CrossSellCatalog> {
  const key = tenantId ?? "";
  const hit = cache.get(key);
  if (!opts?.fresh && hit && hit.expiresAt > Date.now()) return hit.catalog;
  const catalog = buildCrossSellCatalog(await storage.getShopwareProductIdentities(tenantId));
  cache.set(key, { catalog, expiresAt: Date.now() + CACHE_TTL_MS });
  return catalog;
}

/** Nur fuer Tests. */
export function clearCrossSellCatalogCache(): void {
  cache.clear();
}
