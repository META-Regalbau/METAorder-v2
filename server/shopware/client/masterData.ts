// Shopware: Stammdaten und Standardwerte - Verkaufskanaele, Kategorien, Felder, Lieferzeiten, Anrede, Kundengruppe, Zahlart, Land.
import type { ShopwareClient } from "../shopware";
import type { SalesChannel } from "@shared/schema";
import { isShopwareEntityId, normalizeShopwareEntityId, shopwareEntityName, toShopwareUuid } from "./mapping";
import { logger } from "../../lib/logger";

const moduleLog = logger.child({ component: "shopware/client/masterData" });

export async function fetchSalesChannels(this: ShopwareClient): Promise<SalesChannel[]> {
  try {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/sales-channel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: 100,
        filter: [
          {
            type: 'equals',
            field: 'active',
            value: true,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch sales channels: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const channels = data.data || [];

    return channels.map((channel: any) => ({
      id: channel.id,
      name: channel.name || channel.attributes?.name || 'Unknown Channel',
      active: channel.active !== undefined ? channel.active : (channel.attributes?.active || true),
    }));
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching sales channels from Shopware:");
    throw error;
  }
}

/**
 * Liefert eine Map salesChannelId -> Name (inkl. inaktiver Kanäle), damit
 * kundenindividuelle Preise pro Verkaufskanal beschriftet werden können.
 */
export async function fetchSalesChannelNameMap(this: ShopwareClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/sales-channel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 200, includes: { sales_channel: ['id', 'name', 'translated'] } }),
    });
    if (!response.ok) return map;
    const data = await response.json();
    for (const channel of data.data || []) {
      const attrs = channel.attributes || channel;
      const id = String(channel.id ?? attrs.id ?? '');
      const name =
        attrs.translated?.name || attrs.name || channel.name || null;
      if (id) map.set(id, name ? String(name) : id);
    }
  } catch (error: any) {
    moduleLog.warn({ err: error }, "[Shopware] fetchSalesChannelNameMap:");
  }
  return map;
}

/**
 * Shopware-Entity-IDs (z. B. Customfields) → Anzeigenamen (translated.name).
 * Versucht property_group_option, danach media (fileName).
 */
export async function resolveEntityDisplayNames(this: ShopwareClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(
    new Set(
      ids
        .map((id) => String(id || "").trim())
        .filter((id) => isShopwareEntityId(id))
        .map((id) => normalizeShopwareEntityId(id)),
    ),
  );
  if (!unique.length) return out;

  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const data = await this.searchEntity("property_group_option", {
        limit: chunk.length,
        filter: [{ type: "equalsAny", field: "id", value: chunk }],
        includes: {
          property_group_option: ["id", "name", "translated"],
        },
      });
      for (const row of data.data || []) {
        const id = normalizeShopwareEntityId(String(row.id || row.attributes?.id || ""));
        const name = shopwareEntityName(row);
        if (id && name) out.set(id, name);
      }
    } catch (err) {
      moduleLog.warn({ err }, "[shopware] resolve property_group_option names failed:");
    }
  }

  const missing = unique.filter((id) => !out.has(id));
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    try {
      const data = await this.searchEntity("media", {
        limit: chunk.length,
        filter: [{ type: "equalsAny", field: "id", value: chunk }],
        includes: {
          media: ["id", "fileName", "fileExtension", "translated"],
        },
      });
      for (const row of data.data || []) {
        const id = normalizeShopwareEntityId(String(row.id || row.attributes?.id || ""));
        const attrs = row.attributes || row;
        const fileName = String(
          attrs.translated?.fileName || attrs.fileName || row.fileName || "",
        ).trim();
        const ext = String(attrs.fileExtension || "").trim();
        const label = fileName ? (ext ? `${fileName}.${ext}` : fileName) : "";
        if (id && label) out.set(id, label);
      }
    } catch (err) {
      moduleLog.warn({ err }, "[shopware] resolve media names failed:");
    }
  }

  return out;
}

/**
 * Lieferzeiten (delivery_time) per ID laden – für Spiegel-Payloads ohne Namen.
 * Lädt bei Bedarf den kompletten (kleinen) Lieferzeiten-Katalog.
 */
export async function resolveDeliveryTimes(
  this: ShopwareClient,
  ids: string[],
): Promise<
  Map<
    string,
    {
      name: string | null;
      min: number | null;
      max: number | null;
      unit: string | null;
    }
  >
> {
  type DeliveryResolved = {
    name: string | null;
    min: number | null;
    max: number | null;
    unit: string | null;
  };
  const out = new Map<string, DeliveryResolved>();

  const putRow = (row: any) => {
    const id = normalizeShopwareEntityId(String(row?.id || row?.attributes?.id || ""));
    if (!id) return;
    const attrs = row?.attributes || row || {};
    const name = shopwareEntityName(row) || null;
    const minRaw = attrs.min ?? row?.min;
    const maxRaw = attrs.max ?? row?.max;
    const unit = attrs.unit ?? row?.unit ?? null;
    out.set(id, {
      name: name ? String(name) : null,
      min: minRaw != null && !Number.isNaN(Number(minRaw)) ? Number(minRaw) : null,
      max: maxRaw != null && !Number.isNaN(Number(maxRaw)) ? Number(maxRaw) : null,
      unit: unit != null ? String(unit) : null,
    });
  };

  const wanted = Array.from(
    new Set(
      ids
        .map((id) => String(id || "").trim())
        .filter((id) => isShopwareEntityId(id))
        .map((id) => normalizeShopwareEntityId(id)),
    ),
  );

  // Katalog ist klein (meist < 50) – einmal laden und nach ID mappen
  try {
    let page = 1;
    while (page <= 5) {
      const data = await this.searchEntity("delivery-time", {
        limit: 100,
        page,
        includes: {
          delivery_time: ["id", "name", "min", "max", "unit", "translated"],
        },
      });
      const rows = data.data || [];
      for (const row of rows) putRow(row);
      if (rows.length < 100) break;
      page += 1;
    }
  } catch (err) {
    moduleLog.warn({ err }, "[shopware] list delivery_time catalog failed:");
  }

  const missing = wanted.filter((id) => !out.has(id) || !out.get(id)?.name);
  if (missing.length > 0) {
    const CHUNK = 50;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      try {
        const data = await this.searchEntity("delivery-time", {
          limit: chunk.length,
          filter: [{ type: "equalsAny", field: "id", value: chunk }],
          includes: {
            delivery_time: ["id", "name", "min", "max", "unit", "translated"],
          },
        });
        for (const row of data.data || []) putRow(row);
      } catch (err) {
        moduleLog.warn({ err }, "[shopware] resolve delivery_time by id failed:");
      }
    }
  }

  if (wanted.length > 0) {
    const filtered = new Map<string, DeliveryResolved>();
    for (const id of wanted) {
      const row = out.get(id);
      if (row) filtered.set(id, row);
    }
    return filtered;
  }

  return out;
}

// Fetch categories that have products by extracting them from actual products
export async function fetchCategories(this: ShopwareClient): Promise<Array<{ id: string; name: string; parentId: string | null }>> {
  try {
    moduleLog.info("[fetchCategories] Fetching categories with products from Shopware...");
    
    // Step 1: Fetch products with their category information
    const productsResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: 500, // Get a large sample of products
        includes: {
          product: ['categories'],
          category: ['id', 'name', 'parentId']
        },
        associations: {
          categories: {}
        }
      }),
    });

    if (!productsResponse.ok) {
      throw new Error(`Failed to fetch products: ${productsResponse.statusText}`);
    }

    const productsData = await productsResponse.json();
    const products = productsData.data || [];

    // Step 2: Extract unique categories from products
    const categoryMap = new Map<string, { id: string; name: string; parentId: string | null }>();
    
    products.forEach((product: any) => {
      const categories = product.categories || product.attributes?.categories || [];
      categories.forEach((cat: any) => {
        if (cat.id && !categoryMap.has(cat.id)) {
          categoryMap.set(cat.id, {
            id: cat.id,
            name: cat.name || cat.attributes?.name || 'Unnamed Category',
            parentId: cat.parentId || cat.attributes?.parentId || null,
          });
        }
      });
    });

    // Convert map to array and sort by name
    const categories = Array.from(categoryMap.values()).sort((a, b) => 
      a.name.localeCompare(b.name)
    );

    moduleLog.info(`[fetchCategories] Found ${categories.length} categories with products (from ${products.length} products)`);
    return categories;
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching categories from Shopware:");
    throw error;
  }
}

export async function fetchAvailableFields(this: ShopwareClient): Promise<{
  standardFields: Array<{ field: string; label: string; description: string }>;
  customFields: Array<{ field: string; label: string; type: string }>;
}> {
  try {
    // Standard product fields that are commonly used in rules
    const standardFields = [
      { field: 'name', label: 'Product Name', description: 'The product name' },
      { field: 'productNumber', label: 'Product Number', description: 'The unique product number/SKU' },
      { field: 'manufacturerNumber', label: 'Manufacturer Number', description: 'Manufacturer\'s product number' },
      { field: 'ean', label: 'EAN', description: 'European Article Number / Barcode' },
      { field: 'stock', label: 'Stock', description: 'Current stock level' },
      { field: 'available', label: 'Available', description: 'Product availability status' },
      { field: 'price', label: 'Price', description: 'Product price' },
      { field: 'weight', label: 'Weight', description: 'Product weight' },
      { field: 'dimensions.width', label: 'Width', description: 'Product width dimension' },
      { field: 'dimensions.height', label: 'Height', description: 'Product height dimension' },
      { field: 'dimensions.length', label: 'Length', description: 'Product length/depth dimension' },
      { field: 'categoryNames', label: 'Categories', description: 'Product categories (array)' },
      { field: 'manufacturer.name', label: 'Manufacturer Name', description: 'Name of the manufacturer' },
    ];

    // Fetch custom fields from Shopware
    const customFields: Array<{ field: string; label: string; type: string }> = [];
    
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/custom-field`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            limit: 500, // Get many custom fields
            filter: [
              {
                type: 'equals',
                field: 'active',
                value: true,
              },
            ],
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const fields = data.data || [];

        fields.forEach((cf: any) => {
          const fieldName = cf.name || cf.attributes?.name;
          const fieldLabel = cf.config?.label?.['en-GB'] || cf.config?.label?.['de-DE'] || cf.attributes?.config?.label?.['en-GB'] || cf.attributes?.config?.label?.['de-DE'] || fieldName;
          const fieldType = cf.type || cf.attributes?.type || 'text';

          if (fieldName) {
            customFields.push({
              field: `customFields.${fieldName}`,
              label: fieldLabel || fieldName,
              type: fieldType,
            });
          }
        });

        moduleLog.info(`Fetched ${customFields.length} custom fields from Shopware`);
      }
    } catch (customFieldError) {
      moduleLog.warn({ err: customFieldError }, "Could not fetch custom fields from Shopware:");
      // Continue with empty custom fields array
    }

    return {
      standardFields,
      customFields,
    };
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching available fields:");
    throw error;
  }
}

export async function fetchCustomerGroups(this: ShopwareClient): Promise<Array<{ id: string; name: string }>> {
  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer-group`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: 500,
      sort: [{ field: "name", order: "ASC" }],
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch customer groups: ${response.statusText} - ${errorText}`);
  }
  const data = await response.json();
  return (data.data || []).map((row: any) => {
    const attrs = row.attributes || row;
    return {
      id: String(row.id || attrs.id),
      name: String(attrs.name || attrs.translated?.name || ""),
    };
  }).filter((group: { id: string; name: string }) => group.id && group.name);
}

export async function getDefaultLanguageId(this: ShopwareClient): Promise<string> {
  const salesChannelId = await this.getDefaultSalesChannelId();
  if (salesChannelId) {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/sales-channel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limit: 1,
        filter: [{ type: "equals", field: "id", value: salesChannelId }],
      }),
    });
    if (response.ok) {
      const data = await response.json();
      const row = data.data?.[0];
      const languageId = row?.attributes?.languageId || row?.languageId;
      if (languageId) return String(languageId);
    }
  }

  const languageResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/language`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 1 }),
  });
  const languageData = await languageResponse.json();
  return String(languageData.data?.[0]?.id || "");
}

export async function getSalesChannelAccessKey(this: ShopwareClient, salesChannelId: string): Promise<string | null> {
  const id = toShopwareUuid(salesChannelId.trim());
  if (!id) return null;

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/sales-channel/${id}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) return null;

  const raw = await response.json();
  const row = raw.data || raw;
  const attrs = row.attributes || row;
  const accessKey = attrs.accessKey || row.accessKey;
  return accessKey ? String(accessKey) : null;
}

/**
 * Helper: Get default salutation ID (required for customer creation)
 */
export async function getDefaultSalutationId(this: ShopwareClient): Promise<string> {
  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/salutation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1 }),
  });
  const data = await response.json();
  return data.data?.[0]?.id || 'not_specified';
}

/**
 * Helper: Get default customer group ID
 */
export async function getDefaultCustomerGroupId(this: ShopwareClient): Promise<string> {
  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer-group`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1 }),
  });
  const data = await response.json();
  return data.data?.[0]?.id || '';
}

/**
 * Helper: Get default payment method ID
 */
export async function getDefaultPaymentMethodId(this: ShopwareClient): Promise<string> {
  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/payment-method`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      limit: 1,
      filter: [{
        type: 'equals',
        field: 'active',
        value: true,
      }],
    }),
  });
  const data = await response.json();
  return data.data?.[0]?.id || '';
}

/**
 * Helper: Get default sales channel ID
 */
export async function getDefaultSalesChannelId(this: ShopwareClient): Promise<string> {
  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/sales-channel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1 }),
  });
  const data = await response.json();
  return data.data?.[0]?.id || '';
}

/**
 * Helper: Get country ID by name (e.g., "Deutschland" → country ID)
 */
export async function getCountryIdByName(this: ShopwareClient, countryName: string): Promise<string> {
  const raw = (countryName || '').trim();
  if (!raw) return '';

  // Map common country names to ISO codes
  const countryMap: Record<string, string> = {
    deutschland: 'DE',
    germany: 'DE',
    österreich: 'AT',
    oesterreich: 'AT',
    austria: 'AT',
    schweiz: 'CH',
    switzerland: 'CH',
    frankreich: 'FR',
    france: 'FR',
    italien: 'IT',
    italy: 'IT',
    spanien: 'ES',
    spain: 'ES',
    niederlande: 'NL',
    netherlands: 'NL',
    belgien: 'BE',
    belgium: 'BE',
    polen: 'PL',
    poland: 'PL',
    'vereinigte staaten': 'US',
    'united states': 'US',
    usa: 'US',
  };

  const lower = raw.toLowerCase();
  let isoCode: string;
  if (/^[a-z]{2}$/i.test(raw)) {
    isoCode = raw.toUpperCase();
  } else {
    isoCode = countryMap[lower] || 'DE';
  }

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/country`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      limit: 1,
      filter: [{
        type: 'equals',
        field: 'iso',
        value: isoCode,
      }],
    }),
  });
  const data = await response.json();
  const id = data.data?.[0]?.id || '';
  if (!id) {
    moduleLog.warn(`[Shopware] No country entity for iso=${isoCode} (input="${countryName}")`);
  }
  return id;
}
