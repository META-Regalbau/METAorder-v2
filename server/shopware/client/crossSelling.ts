// Shopware: Produkt-Cross-Selling (Gruppen lesen/anlegen, Produkte zuordnen/entfernen).
import type { ShopwareClient } from "../shopware";
import type { CrossSellingGroup, CrossSellingProduct } from "@shared/schema";

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
    
    // Debug: Log the full response to understand Shopware's structure
    console.log('Shopware Cross-Selling Response:', JSON.stringify(data, null, 2));
    
    const crossSellings = data.data || data || [];

    const result = crossSellings.map((cs: any) => ({
      id: cs.id,
      name: cs.name || cs.attributes?.name || 'Unnamed Group',
      type: cs.type || cs.attributes?.type || 'productList',
      active: cs.active !== undefined ? cs.active : (cs.attributes?.active || false),
      products: [], // Will be populated separately if needed
    }));
    
    console.log(`Found ${result.length} cross-selling groups (productList + productStream) for product ${productId}`);
    
    return result;
  } catch (error) {
    console.error('Error fetching cross-selling from Shopware:', error);
    throw error;
  }
}

export async function fetchCrossSellingProducts(this: ShopwareClient, productId: string, crossSellingId: string): Promise<CrossSellingProduct[]> {
  try {
    console.log(`Fetching products for cross-selling group ${crossSellingId}...`);
    
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
      console.log(`No products assigned to cross-selling group ${crossSellingId}`);
      return [];
    }

    // Step 2: Extract product IDs
    const productIds = assignments.map((a: any) => a.productId);
    console.log(`Found ${productIds.length} assigned product IDs:`, productIds);

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
    const products = productsData.data || [];
    
    console.log(`Fetched ${products.length} product details`);

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
    
    console.log(`Found ${result.length} products in cross-selling group ${crossSellingId}`);
    
    return result;
  } catch (error) {
    console.error('Error fetching cross-selling products from Shopware:', error);
    throw error;
  }
}

export async function createProductCrossSelling(this: ShopwareClient, productId: string, name: string, type: 'productList' | 'productStream' = 'productList'): Promise<string> {
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
          position: 1,
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
        console.log('Response body is not valid JSON, checking headers...');
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
      console.error('Response headers:', Object.fromEntries(response.headers.entries()));
      throw new Error('Failed to get cross-selling ID from response (checked body and Location header)');
    }

    return createdId;
  } catch (error) {
    console.error('Error creating cross-selling in Shopware:', error);
    throw error;
  }
}

export async function assignProductsToCrossSelling(this: ShopwareClient, crossSellingId: string, productIds: string[]): Promise<void> {
  try {
    console.log(`assignProductsToCrossSelling called with crossSellingId=${crossSellingId}, productIds=${JSON.stringify(productIds)}`);
    
    // Shopware expects assigned products to be created individually
    const assignments = productIds.map((productId, index) => ({
      crossSellingId: crossSellingId, // Shopware expects 'crossSellingId', not 'productCrossSellingId'
      productId,
      position: index + 1,
    }));

    console.log('Assignments to send to Shopware:', JSON.stringify(assignments, null, 2));

    const requestBody = {
      'write-product-cross-selling-assigned-products': {
        entity: 'product_cross_selling_assigned_products',
        action: 'upsert',
        payload: assignments,
      },
    };
    
    console.log('Full request body:', JSON.stringify(requestBody, null, 2));

    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/sync`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Shopware sync error response:', errorText);
      throw new Error(`Failed to assign products to cross-selling: ${response.statusText} - ${errorText}`);
    }
    
    console.log('Products assigned successfully');
  } catch (error) {
    console.error('Error assigning products to cross-selling in Shopware:', error);
    throw error;
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
              field: 'productCrossSellingId',
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
    console.error('Error removing products from cross-selling in Shopware:', error);
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
    console.error('Error deleting cross-selling from Shopware:', error);
    throw error;
  }
}
