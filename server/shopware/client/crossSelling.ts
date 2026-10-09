// Shopware: Produkt-Cross-Selling (Gruppen lesen/anlegen, Produkte zuordnen/entfernen).
import type { ShopwareClient } from "../shopware";
import type { CrossSellingGroup, CrossSellingProduct } from "@shared/schema";
import { createHash } from "node:crypto";
import { logger } from "../../lib/logger";

const moduleLog = logger.child({ component: "shopware/client/crossSelling" });

// Cross-Selling Methods
export async function fetchProductCrossSelling(this: ShopwareClient, productId: string): Promise<CrossSellingGroup[]> {
  try {
    // Use search endpoint to get ALL cross-selling groups (both productList and productStream)
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/product-cross-selling`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equals',
              field: 'productId',
              value: productId,
            },
          ],
          // No type filter - load both productList AND productStream
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch cross-selling: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const crossSellings = data.data || data || [];

    const result = crossSellings.map((cs: any) => ({
      id: cs.id,
      name: cs.name || cs.attributes?.name || 'Unnamed Group',
      type: cs.type || cs.attributes?.type || 'productList',
      active: cs.active !== undefined ? cs.active : (cs.attributes?.active || false),
      position: typeof (cs.position ?? cs.attributes?.position) === 'number' ? (cs.position ?? cs.attributes?.position) : undefined,
      products: [], // Will be populated separately if needed
    }));
    
    moduleLog.debug(`Found ${result.length} cross-selling groups (productList + productStream) for product ${productId}`);
    
    return result;
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching cross-selling from Shopware:");
    throw error;
  }
}

export async function fetchCrossSellingProducts(this: ShopwareClient, productId: string, crossSellingId: string): Promise<CrossSellingProduct[]> {
  try {
    // Step 1: Get assigned product IDs
    const assignmentsResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/product-cross-selling-assigned-products`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equals',
              field: 'crossSellingId',
              value: crossSellingId,
            },
          ],
        }),
      }
    );

    if (!assignmentsResponse.ok) {
      const errorText = await assignmentsResponse.text();
      throw new Error(`Failed to fetch cross-selling assignments: ${assignmentsResponse.statusText} - ${errorText}`);
    }

    const assignmentsData = await assignmentsResponse.json();
    const assignments = assignmentsData.data || [];
    
    if (assignments.length === 0) {
      return [];
    }

    // Step 2: Extract product IDs (in Shopware-Reihenfolge)
    const sortedAssignments = [...assignments].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
    const productIds = sortedAssignments.map((a: any) => a.productId);

    // Step 3: Fetch full product details
    const productsResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/product`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equalsAny',
              field: 'id',
              value: productIds,
            },
          ],
          associations: {
            cover: {
              associations: {
                media: {},
              },
            },
            tax: {},
          },
        }),
      }
    );

    if (!productsResponse.ok) {
      const errorText = await productsResponse.text();
      throw new Error(`Failed to fetch product details: ${productsResponse.statusText} - ${errorText}`);
    }

    const productsData = await productsResponse.json();
    const rank = new Map<string, number>(productIds.map((id: string, i: number) => [id, i]));
    const products = [...(productsData.data || [])].sort(
      (a: any, b: any) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
    );

    // Step 4: Map to CrossSellingProduct format
    const result = products.map((p: any) => {
      const priceObj = p.price?.[0];
      const grossPrice = priceObj?.gross || 0;
      const taxRate = p.tax?.taxRate || 19;
      const netPrice = priceObj?.net || grossPrice / (1 + taxRate / 100);
      return {
        id: p.id,
        productNumber: p.productNumber || '',
        name: p.name || 'Unknown Product',
        price: grossPrice,
        netPrice: netPrice,
        taxRate: taxRate,
        imageUrl: this.resolveMediaUrl(p.cover?.media?.url || undefined) || undefined,
        stock: p.stock || 0,
        available: p.available || false,
      };
    });

    return result;
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching cross-selling products from Shopware:");
    throw error;
  }
}

export async function createProductCrossSelling(
  this: ShopwareClient,
  productId: string,
  name: string,
  type: 'productList' | 'productStream' = 'productList',
  position: number = 1,
): Promise<string> {
  try {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/product-cross-selling`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productId,
          name,
          type,
          active: true,
          position,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create cross-selling: ${response.statusText} - ${errorText}`);
    }

    // Check if response has content
    const contentLength = response.headers.get('content-length');
    let createdId: string | null = null;

    // Try to get ID from response body if there is content
    if (contentLength && parseInt(contentLength) > 0) {
      try {
        const data = await response.json();
        // Shopware returns the created ID in different formats depending on API version
        // Try data first (direct response), then data.data (wrapped response)
        createdId = data?.id || data?.data?.id;
      } catch (jsonError) {
        moduleLog.info("Response body is not valid JSON, checking headers...");
      }
    }

    // If no ID from body, try to extract from Location header
    if (!createdId) {
      const locationHeader = response.headers.get('location');
      if (locationHeader) {
        // Location header format: /api/product-cross-selling/{id}
        const matches = locationHeader.match(/\/api\/product-cross-selling\/([a-f0-9]+)/i);
        if (matches && matches[1]) {
          createdId = matches[1];
        }
      }
    }

    if (!createdId) {
      moduleLog.error({ details: Object.fromEntries(response.headers.entries()) }, "Response headers:");
      throw new Error('Failed to get cross-selling ID from response (checked body and Location header)');
    }

    return createdId;
  } catch (error) {
    moduleLog.error({ err: error }, "Error creating cross-selling in Shopware:");
    throw error;
  }
}

/**
 * Haengt Produkte an eine Gruppe an. Ohne startPosition beginnen die Positionen bei 1
 * (frische Gruppe); beim Ergaenzen einer bestehenden Gruppe max(Position)+1 uebergeben.
 */
export async function assignProductsToCrossSelling(
  this: ShopwareClient,
  crossSellingId: string,
  productIds: string[],
  startPosition: number = 1,
): Promise<void> {
  if (productIds.length === 0) return;
  await syncCrossSellingAssignments.call(this, crossSellingId, {
    upsert: productIds.map((productId, index) => ({
      id: crossSellingAssignmentId(crossSellingId, productId),
      productId,
      position: startPosition + index,
    })),
    deleteIds: [],
  });
}

export type CrossSellingAssignment = {
  id: string;
  productId: string;
  position: number;
  createdAt?: string | null;
};

/** Zuordnungen einer Gruppe (ID, Produkt, Position), sortiert nach Position. */
export async function fetchCrossSellingAssignments(this: ShopwareClient, crossSellingId: string): Promise<CrossSellingAssignment[]> {
  const response = await this.makeAuthenticatedRequest(
    `${this.baseUrl}/api/search/product-cross-selling-assigned-products`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: 500,
        filter: [{ type: 'equals', field: 'crossSellingId', value: crossSellingId }],
        sort: [{ field: 'position', order: 'ASC' }],
      }),
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch cross-selling assignments: ${response.statusText} - ${errorText}`);
  }
  const data = await response.json();
  return ((data.data || []) as any[])
    .map((a) => ({
      id: String(a.id),
      productId: String(a.productId),
      position: typeof a.position === 'number' ? a.position : 0,
      createdAt: a.createdAt ?? null,
    }))
    .sort((a, b) => a.position - b.position);
}

/**
 * Deterministische Zuordnungs-ID (32 hex) je Gruppe+Produkt: ein wiederholter Upsert nach
 * Abbruch legt keine Dublette an.
 */
function crossSellingAssignmentId(crossSellingId: string, productId: string): string {
  return createHash('md5').update(`${crossSellingId}|${productId}`).digest('hex');
}

/**
 * Ein einziger Sync-Aufruf: erst Upsert (neue Produkte, Positionen), dann Delete. So ist die
 * Gruppe im Shop nie leer, auch wenn Shopware die Operationen nicht atomar ausfuehrt.
 */
export async function syncCrossSellingAssignments(
  this: ShopwareClient,
  crossSellingId: string,
  ops: { upsert: Array<{ id?: string; productId: string; position: number }>; deleteIds: string[] },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (ops.upsert.length > 0) {
    body['upsert-assigned-products'] = {
      entity: 'product_cross_selling_assigned_products',
      action: 'upsert',
      payload: ops.upsert.map((u) => ({
        id: u.id ?? crossSellingAssignmentId(crossSellingId, u.productId),
        crossSellingId,
        productId: u.productId,
        position: u.position,
      })),
    };
  }
  if (ops.deleteIds.length > 0) {
    body['delete-assigned-products'] = {
      entity: 'product_cross_selling_assigned_products',
      action: 'delete',
      payload: ops.deleteIds.map((id) => ({ id })),
    };
  }
  if (Object.keys(body).length === 0) return;

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    moduleLog.error(`Shopware sync error response: ${errorText}`);
    throw new Error(`Failed to sync cross-selling assignments: ${response.statusText} - ${errorText}`);
  }
}

export async function removeProductsFromCrossSelling(this: ShopwareClient, crossSellingId: string, productIds: string[]): Promise<void> {
  try {
    // First, fetch existing assignments to get their IDs
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/product-cross-selling-assigned-products`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equals',
              field: 'crossSellingId',
              value: crossSellingId,
            },
            {
              type: 'equalsAny',
              field: 'productId',
              value: productIds,
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch assignments for removal');
    }

    const data = await response.json();
    const assignmentIds = (data.data || []).map((a: any) => a.id);

    if (assignmentIds.length === 0) {
      return; // Nothing to delete
    }

    // Delete assignments
    const deleteResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/sync`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          'delete-assignments': {
            entity: 'product_cross_selling_assigned_products',
            action: 'delete',
            payload: assignmentIds.map((id: string) => ({ id })),
          },
        }),
      }
    );

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      throw new Error(`Failed to remove products from cross-selling: ${deleteResponse.statusText} - ${errorText}`);
    }
  } catch (error) {
    moduleLog.error({ err: error }, "Error removing products from cross-selling in Shopware:");
    throw error;
  }
}

export async function deleteProductCrossSelling(this: ShopwareClient, crossSellingId: string): Promise<void> {
  try {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/product-cross-selling/${crossSellingId}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete cross-selling: ${response.statusText} - ${errorText}`);
    }
  } catch (error) {
    moduleLog.error({ err: error }, "Error deleting cross-selling from Shopware:");
    throw error;
  }
}

export type CrossSellingGroupWithAssignments = {
  id: string;
  name: string;
  type: 'productList' | 'productStream';
  active: boolean;
  position: number;
  productId: string;
  assignedProducts: CrossSellingAssignment[];
};

/**
 * Alle Cross-Selling-Gruppen des Shops seitenweise (inkl. Zuordnungen), z. B. fuer den Import
 * ins Gedaechtnis und die Monatspruefung. Nur lesend.
 */
export async function searchCrossSellingGroups(
  this: ShopwareClient,
  page: number,
  limit: number = 250,
): Promise<{ groups: CrossSellingGroupWithAssignments[]; hasMore: boolean }> {
  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product-cross-selling`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page,
      limit,
      sort: [{ field: 'id', order: 'ASC' }],
      associations: { assignedProducts: { limit: 500 } },
      includes: {
        product_cross_selling: ['id', 'name', 'type', 'active', 'position', 'productId', 'assignedProducts'],
        product_cross_selling_assigned_products: ['id', 'productId', 'position', 'createdAt'],
      },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to search cross-selling groups: ${response.statusText} - ${errorText}`);
  }
  const data = await response.json();
  const rows = (data.data || []) as any[];
  const groups = rows.map((g) => ({
    id: String(g.id),
    name: String(g.name ?? ''),
    type: g.type === 'productStream' ? 'productStream' as const : 'productList' as const,
    active: g.active !== false,
    position: typeof g.position === 'number' ? g.position : 0,
    productId: String(g.productId),
    assignedProducts: ((g.assignedProducts || []) as any[])
      .map((a) => ({
        id: String(a.id),
        productId: String(a.productId),
        position: typeof a.position === 'number' ? a.position : 0,
        createdAt: a.createdAt ?? null,
      }))
      .sort((a, b) => a.position - b.position),
  }));
  return { groups, hasMore: rows.length >= limit };
}
