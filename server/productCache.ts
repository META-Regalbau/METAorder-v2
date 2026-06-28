import type { Product } from "@shared/schema";
import type { ShopwareClient } from "./shopware";
import { getTenantIdFromContext } from "./tenantContext";

/**
 * Product Cache System
 * 
 * In-memory cache for Shopware products to avoid hitting the 500 product API limit.
 * Features:
 * - Loads ALL products in batches at startup
 * - Auto-refresh every 6 hours (configurable)
 * - Manual refresh capability
 * - Cache status tracking
 *
 * Mandantentrennung: Jeder Mandant (tenantId) hat eine eigene Cache-Instanz.
 * Der exportierte `productCache` ist eine Facade, die pro Aufruf die
 * Instanz des aktuellen Tenants (aus dem AsyncLocalStorage-Kontext) auflöst,
 * sodass bestehende Aufrufstellen unverändert bleiben.
 */

interface CacheStatus {
  isPopulated: boolean;
  productCount: number;
  lastUpdate: Date | null;
  isLoading: boolean;
  error: string | null;
}

class ProductCache {
  private products: Product[] = [];
  private lastUpdate: Date | null = null;
  private isLoading: boolean = false;
  private error: string | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;
  private refreshPromise: Promise<void> | null = null;
  
  // Default TTL: 6 hours (in milliseconds)
  private readonly DEFAULT_TTL = 6 * 60 * 60 * 1000;
  
  /**
   * Get cache status
   */
  getStatus(): CacheStatus {
    return {
      isPopulated: this.products.length > 0,
      productCount: this.products.length,
      lastUpdate: this.lastUpdate,
      isLoading: this.isLoading,
      error: this.error
    };
  }
  
  /**
   * Get all cached products
   */
  getProducts(): Product[] {
    return this.products;
  }
  
  /**
   * Get a product by its ID
   */
  getProductById(productId: string): Product | undefined {
    return this.products.find(p => p.id === productId);
  }
  
  /**
   * Get a product by its product number (GTIN/EAN im Shop)
   */
  getProductByNumber(productNumber: string): Product | undefined {
    return this.products.find(p => p.productNumber === productNumber);
  }

  /**
   * Get a product by manufacturer number (eigentliche Artikelnummer)
   */
  getProductByManufacturerNumber(manufacturerNumber: string): Product | undefined {
    if (!manufacturerNumber) return undefined;
    return this.products.find(p => p.manufacturerNumber === manufacturerNumber);
  }

  /**
   * Get a product by any identifier: productNumber, manufacturerNumber, or ean
   * Mapping kann Produktnr (GTIN/EAN) oder ManufacturerNr speichern
   */
  getProductByIdentifier(identifier: string): Product | undefined {
    if (!identifier) return undefined;
    const t = identifier.trim();
    return (
      this.getProductByNumber(t) ||
      this.getProductByManufacturerNumber(t) ||
      this.products.find(p => p.ean === t)
    );
  }
  
  /**
   * Get product weights for a list of product IDs
   * Returns a map of productId -> weight
   */
  getProductWeights(productIds: string[]): Map<string, number | undefined> {
    const weightMap = new Map<string, number | undefined>();
    for (const productId of productIds) {
      const product = this.getProductById(productId);
      weightMap.set(productId, product?.weight);
    }
    return weightMap;
  }
  
  /**
   * Initialize cache and start auto-refresh
   */
  async initialize(client: ShopwareClient, ttl: number = this.DEFAULT_TTL): Promise<void> {
    console.log('[Product Cache] Initializing cache system...');
    
    // Load products initially
    await this.refresh(client);
    
    // Set up auto-refresh interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    this.refreshInterval = setInterval(async () => {
      console.log('[Product Cache] Auto-refresh triggered');
      await this.refresh(client);
    }, ttl);
    
    console.log(`[Product Cache] Auto-refresh scheduled every ${ttl / (60 * 60 * 1000)} hours`);
  }
  
  /**
   * Manually refresh the cache
   */
  async refresh(client: ShopwareClient): Promise<void> {
    // If refresh is already in progress, wait for it to complete
    if (this.refreshPromise) {
      console.log('[Product Cache] Refresh already in progress, waiting for completion...');
      return this.refreshPromise;
    }
    
    // Create and store the refresh promise for concurrent callers to await
    this.refreshPromise = this._performRefresh(client);
    
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
  
  /**
   * Internal method that performs the actual refresh
   */
  private async _performRefresh(client: ShopwareClient): Promise<void> {
    this.isLoading = true;
    this.error = null;
    
    try {
      console.log('[Product Cache] Starting product fetch...');
      const allProducts: Product[] = [];
      
      // Shopware has a max limit of 500 products per request
      const BATCH_SIZE = 500;
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        console.log(`[Product Cache] Fetching batch ${page} (limit: ${BATCH_SIZE})...`);
        
        const { products, total } = await client.fetchProducts(
          BATCH_SIZE,
          page,
          undefined, // no search
          undefined, // no category filter
          false      // only active products
        );
        
        allProducts.push(...products);
        
        console.log(`[Product Cache] Batch ${page}: ${products.length} products (total so far: ${allProducts.length}, API reported total: ${total})`);
        
        // Continue fetching until we get less than BATCH_SIZE products
        // This is more reliable than trusting the API's "total" count which can be wrong
        hasMore = products.length === BATCH_SIZE;
        page++;
      }
      
      // Update cache
      this.products = allProducts;
      this.lastUpdate = new Date();
      this.error = null;
      
      console.log(`[Product Cache] ✓ Successfully cached ${allProducts.length} products`);
      console.log(`[Product Cache] Last update: ${this.lastUpdate.toISOString()}`);
      
    } catch (error: any) {
      this.error = error.message || 'Unknown error during cache refresh';
      console.error('[Product Cache] ✗ Error refreshing cache:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }
  
  /**
   * Clear cache and stop auto-refresh
   */
  destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.products = [];
    this.lastUpdate = null;
    this.error = null;
    console.log('[Product Cache] Cache destroyed');
  }
}

/**
 * Registry hält pro Mandant genau eine ProductCache-Instanz.
 */
class ProductCacheRegistry {
  private caches = new Map<string, ProductCache>();

  private keyFor(tenantId?: string | null): string {
    const resolved = tenantId === undefined ? getTenantIdFromContext() : tenantId;
    return resolved ?? "__global__";
  }

  /** Cache-Instanz für den angegebenen oder aktuellen Mandanten. */
  for(tenantId?: string | null): ProductCache {
    const key = this.keyFor(tenantId);
    let cache = this.caches.get(key);
    if (!cache) {
      cache = new ProductCache();
      this.caches.set(key, cache);
    }
    return cache;
  }

  /** Alle Mandanten-Caches verwerfen (z.B. für Tests/Shutdown). */
  destroyAll(): void {
    for (const cache of this.caches.values()) {
      cache.destroy();
    }
    this.caches.clear();
  }
}

export const productCacheRegistry = new ProductCacheRegistry();

/**
 * Facade: leitet jeden Zugriff an die ProductCache-Instanz des aktuellen
 * Mandanten weiter. Dadurch funktionieren alle bestehenden `productCache.*`
 * Aufrufe automatisch mandantengetrennt.
 */
export const productCache: ProductCache = new Proxy({} as ProductCache, {
  get(_target, prop) {
    const instance = productCacheRegistry.for();
    const value = (instance as any)[prop];
    return typeof value === "function" ? value.bind(instance) : value;
  },
}) as ProductCache;
