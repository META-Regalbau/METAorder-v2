// Shopware: Produkte - Listen/Uebersicht/Aenderungen, Suche, Datenqualitaet, Aktiv/Bestand/Preise, Kategorien, Verkaufskanaele, 3D-Modell.
import type { ShopwareClient } from "../shopware";
import type { Product, ProductPriceRule } from "@shared/schema";
import { mapShopwareOptionsForVariant, extractSapProductNumberFromCustomFields, parseDimensionsFromProductName, resolveShopwareChildProducts, mapChildToProductVariant, toShopwareUuid, parseProductDeliveryTime, shopwareEntityName, parseProductVisibilities, parseProductAdvancedPrices, mapShopwarePropertiesForLabel, parseProductRestockTime } from "./mapping";
import type { ShopwareProductOverview, ProductPriceResetRow, ShopwarePriceEntry } from "./types";
import { parseShopwarePriceCollectionNet, firstShopwarePriceEntry } from "../../products/pricingUtils";
import { getWduIfsProductNumber, addHerstellpreisCatalogKeys } from "../../products/productIdentifiers";
import { randomUUID } from "crypto";

/** Fingerprint für aktive Produkte (entspricht Product-Cache-Refresh). */
export async function fetchActiveProductCatalogFingerprint(this: ShopwareClient): Promise<string | null> {
  const filter = [{ type: "equals", field: "active", value: true }];
  const fp = await this.fetchEntitySearchFingerprint("product", { filter, sortField: "updatedAt" });
  if (!fp) return null;

  const { stableFingerprint } = await import("../../lib/contentHashCache");
  return stableFingerprint({
    scope: "active_products",
    total: fp.total,
    latestUpdatedAt: fp.latestUpdatedAt,
    latestId: fp.latestId,
  });
}

export async function fetchProducts(
  this: ShopwareClient,
  limit: number = 100, 
  page: number = 1, 
  search?: string, 
  categoryId?: string,
  showInactive: boolean = false,
  width?: number,
  height?: number,
  depth?: number,
  includeInactive: boolean = false,
  salesChannelIds?: string[],
  onlyWithVariants: boolean = false,
  includeVariantChildren: boolean = false,
  /** When set, load exactly this product UUID (cross-selling / rule engine). */
  productId?: string
): Promise<{ products: Product[], total: number }> {
  try {
    const requestBody: any = {
      limit,
      page,
      sort: [
        {
          field: 'productNumber',
          order: 'ASC',
        },
      ],
    };

    // Build filter array
    const filters: any[] = [];

    if (productId && String(productId).trim()) {
      filters.push({
        type: "equals",
        field: "id",
        value: String(productId).trim(),
      });
    }

    // Filter by active status
    if (showInactive) {
      // Admin only: Show only inactive products
      filters.push({
        type: 'equals',
        field: 'active',
        value: false,
      });
    } else if (includeInactive) {
      // Admin tools: Include both active and inactive products
      filters.push({
        type: 'multi',
        operator: 'OR',
        queries: [
          {
            type: 'equals',
            field: 'active',
            value: true,
          },
          {
            type: 'equals',
            field: 'active',
            value: false,
          },
        ],
      });
    } else {
      // Default: Show only active products
      filters.push({
        type: 'equals',
        field: 'active',
        value: true,
      });
    }

    // Filter by category if provided
    if (categoryId) {
      filters.push({
        type: 'equals',
        field: 'categoryIds',
        value: categoryId,
      });
    }

    // Filter by dimensions if provided
    if (width) {
      filters.push({
        type: 'equals',
        field: 'width',
        value: width,
      });
    }

    if (height) {
      filters.push({
        type: 'equals',
        field: 'height',
        value: height,
      });
    }

    if (depth) {
      filters.push({
        type: 'equals',
        field: 'length', // Shopware uses 'length' for depth
        value: depth,
      });
    }

    if (onlyWithVariants) {
      filters.push({
        type: "range",
        field: "childCount",
        parameters: {
          gte: 1,
        },
      });
    }

    if (salesChannelIds && salesChannelIds.length > 0) {
      filters.push({
        type: 'equalsAny',
        field: 'visibilities.salesChannelId',
        value: salesChannelIds,
      });
      requestBody.associations = {
        ...(requestBody.associations || {}),
        visibilities: {},
      };
    }

    // Set the filters array
    requestBody.filter = filters;

    // Add search term if provided
    if (search && search.trim()) {
      requestBody.term = search.trim();
    }

    const productIncludesList = [
      "id",
      "productNumber",
      "name",
      "description",
      "price",
      "stock",
      "available",
      "manufacturerNumber",
      "ean",
      "weight",
      "width",
      "height",
      "length",
      "packagingUnit",
      "minPurchase",
      "maxPurchase",
      "purchaseUnit",
      "deliveryTimeId",
      "customFields",
      "createdAt",
      "updatedAt",
      "active",
      "manufacturer",
      "categories",
      "cover",
      "tax",
      "prices",
      "properties",
      "parentId",
      "childCount",
    ];

    const fetchAssociations: Record<string, unknown> = {
      manufacturer: {},
      categories: {},
      cover: {
        associations: {
          media: {},
        },
      },
      media: {
        associations: {
          media: {},
        },
      },
      visibilities: {},
      deliveryTime: {},
      tax: {},
      prices: {},
      properties: {
        associations: {
          group: {},
        },
      },
      options: {
        associations: {
          group: {},
        },
      },
    };
    if (includeVariantChildren) {
      fetchAssociations.children = {
        associations: {
          options: { associations: { group: {} } },
          tax: {},
          prices: {},
        },
      };
    }

    console.log(
      `[fetchProducts] Requesting products - page: ${page}, limit: ${limit}, search: ${search || "none"}, category: ${categoryId || "all"}, showInactive: ${showInactive}, width: ${width || "any"}, height: ${height || "any"}, depth: ${depth || "any"}, onlyWithVariants: ${onlyWithVariants}, includeVariantChildren: ${includeVariantChildren}`
    );
    console.log(`[fetchProducts] Request body filter:`, JSON.stringify(requestBody.filter, null, 2));

    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...requestBody,
        includes: {
          product: productIncludesList,
          product_manufacturer: ["name"],
          category: ["name"],
          product_media: ["media"],
          media: ["url"],
          tax: ["taxRate"],
          product_price: ["quantityStart", "quantityEnd", "price"],
          property_group_option: ["name", "group"],
          property_group: ["name"],
          product_visibility: ["id", "salesChannelId"],
        },
        associations: fetchAssociations,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch products: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const shopwareProducts = data.data || [];
    const total = data.total ?? data.meta?.total ?? shopwareProducts.length;
    
    console.log(`[fetchProducts] Shopware API response - returned: ${shopwareProducts.length}, total in DB: ${total}`);
    console.log(`[fetchProducts] Meta object:`, JSON.stringify(data.meta, null, 2));

    // Build a map of included entities
    const includedMap = new Map<string, any>();
    if (data.included) {
      data.included.forEach((item: any) => {
        const key = `${item.type}-${item.id}`;
        includedMap.set(key, item);
        if (item.type === "product" && item.id) {
          const compactId = String(item.id).replace(/-/g, "");
          if (compactId !== item.id) {
            includedMap.set(`product-${compactId}`, item);
          }
        }
      });
    }

    const products: Product[] = shopwareProducts.map((sp: any, index: number) => {
      // Get manufacturer name
      let manufacturerName = '';
      if (sp.manufacturer?.name) {
        manufacturerName = sp.manufacturer.name;
      } else if (sp.relationships?.manufacturer?.data?.id) {
        const manufacturer = includedMap.get(`product_manufacturer-${sp.relationships.manufacturer.data.id}`);
        manufacturerName = manufacturer?.attributes?.name || '';
      }

      // Get categories
      const categoryNames: string[] = [];
      if (sp.categories) {
        categoryNames.push(...sp.categories.map((cat: any) => cat.name || '').filter(Boolean));
      } else if (sp.relationships?.categories?.data) {
        sp.relationships.categories.data.forEach((catRef: any) => {
          const category = includedMap.get(`category-${catRef.id}`);
          if (category?.attributes?.name) {
            categoryNames.push(category.attributes.name);
          }
        });
      }

      // Get cover image
      let imageUrl = '';
      if (sp.cover?.media?.url) {
        imageUrl = this.resolveMediaUrl(sp.cover.media.url);
      } else if (sp.relationships?.cover?.data?.id) {
        const coverMedia = includedMap.get(`product_media-${sp.relationships.cover.data.id}`);
        if (coverMedia?.relationships?.media?.data?.id) {
          const media = includedMap.get(`media-${coverMedia.relationships.media.data.id}`);
          imageUrl = this.resolveMediaUrl(media?.attributes?.url || '');
        }
      }

      // Get properties (Eigenschaften)
      const properties: Array<{ groupName: string; optionName: string }> = [];
      if (sp.properties && Array.isArray(sp.properties)) {
        sp.properties.forEach((prop: any) => {
          const groupName = prop.group?.name || prop.groupName || '';
          const optionName = prop.name || prop.optionName || '';
          if (groupName && optionName) {
            properties.push({ groupName, optionName });
          }
        });
      } else if (sp.relationships?.properties?.data) {
        sp.relationships.properties.data.forEach((propRef: any) => {
          const prop = includedMap.get(`property_group_option-${propRef.id}`);
          if (prop) {
            const optionName = prop.attributes?.name || prop.name || '';
            let groupName = '';
            if (prop.group?.name) {
              groupName = prop.group.name;
            } else if (prop.relationships?.group?.data?.id) {
              const group = includedMap.get(`property_group-${prop.relationships.group.data.id}`);
              groupName = group?.attributes?.name || group?.name || '';
            }
            if (groupName && optionName) {
              properties.push({ groupName, optionName });
            }
          }
        });
      }

      // Varianten-Optionen (Größe/Farbe) ebenfalls in properties spiegeln
      for (const opt of mapShopwareOptionsForVariant(sp, includedMap)) {
        if (!properties.some((p) => p.groupName === opt.group && p.optionName === opt.option)) {
          properties.push({ groupName: opt.group, optionName: opt.option });
        }
      }

      // Get tax rate
      let taxRate = 19; // Default
      if (sp.tax?.taxRate) {
        taxRate = sp.tax.taxRate;
      } else if (sp.relationships?.tax?.data?.id) {
        const tax = includedMap.get(`tax-${sp.relationships.tax.data.id}`);
        taxRate = tax?.attributes?.taxRate || 19;
      }

      // Get price - Shopware stores prices in a complex structure with both gross and net
      let price = 0; // Gross price
      let netPrice = 0;
      if (sp.price && Array.isArray(sp.price)) {
        // Price is an array with currency-specific prices
        const eurPrice = sp.price.find((p: any) => p.currencyId || true); // Take first price
        if (eurPrice) {
          price = eurPrice.gross || 0;
          netPrice = eurPrice.net || 0;
          // Fallback calculation if net price is missing
          if (!netPrice && price) {
            netPrice = price / (1 + taxRate / 100);
          }
        }
      } else if (sp.attributes?.price && Array.isArray(sp.attributes.price)) {
        const eurPrice = sp.attributes.price.find((p: any) => p.currencyId || true);
        if (eurPrice) {
          price = eurPrice.gross || 0;
          netPrice = eurPrice.net || 0;
          if (!netPrice && price) {
            netPrice = price / (1 + taxRate / 100);
          }
        }
      }

      // Get graduated prices for CPQ
      const priceRules: ProductPriceRule[] = [];
      if (sp.prices && Array.isArray(sp.prices)) {
        sp.prices.forEach((priceRule: any) => {
          const quantityStart = priceRule.quantityStart || 1;
          const priceObj = priceRule.price?.[0];
          const rulePrice = priceObj?.gross || 0;
          const ruleNetPrice = priceObj?.net || rulePrice / (1 + taxRate / 100);
          priceRules.push({
            quantity: quantityStart,
            price: rulePrice,
            netPrice: ruleNetPrice,
          });
        });
      } else if (sp.relationships?.prices?.data) {
        sp.relationships.prices.data.forEach((priceRef: any) => {
          const priceRule = includedMap.get(`product_price-${priceRef.id}`);
          if (priceRule) {
            const quantityStart = priceRule.attributes?.quantityStart || 1;
            const priceObj = priceRule.attributes?.price?.[0];
            const rulePrice = priceObj?.gross || 0;
            const ruleNetPrice = priceObj?.net || rulePrice / (1 + taxRate / 100);
            priceRules.push({
              quantity: quantityStart,
              price: rulePrice,
              netPrice: ruleNetPrice,
            });
          }
        });
      }

      const visibilityCount = Array.isArray(sp.relationships?.visibilities?.data)
        ? sp.relationships.visibilities.data.length
        : Array.isArray(sp.visibilities)
          ? sp.visibilities.length
          : 0;
      const hasDeliveryTime = Boolean(
        sp.deliveryTimeId ||
          sp.attributes?.deliveryTimeId ||
          sp.relationships?.deliveryTime?.data?.id
      );
      const mediaCount = Array.isArray(sp.relationships?.media?.data)
        ? sp.relationships.media.data.length
        : Array.isArray(sp.media)
          ? sp.media.length
          : 0;
      const imageCount = (imageUrl ? 1 : 0) + mediaCount;
      const criteriaCount = 13;
      let points = 0;
      if (sp.productNumber || sp.attributes?.productNumber) points += 1;
      if (sp.manufacturerNumber || sp.attributes?.manufacturerNumber) points += 1;
      if (sp.ean || sp.attributes?.ean) points += 1;
      if (sp.description || sp.attributes?.description) points += 1;
      if (properties.length > 2) points += 1;
      if (hasDeliveryTime) points += 1;
      if (visibilityCount > 0) points += 1;
      if (categoryNames.length > 0) points += 1;
      if (imageCount > 0) points += 1;
      if (sp.width || sp.attributes?.width) points += 1;
      if (sp.height || sp.attributes?.height) points += 1;
      if (sp.length || sp.attributes?.length) points += 1;
      if (sp.weight || sp.attributes?.weight) points += 1;
      const dataQualityScore = Math.round((points / criteriaCount) * 100);

      const childCountRaw = sp.childCount ?? sp.attributes?.childCount;
      const parentIdRaw = sp.parentId ?? sp.attributes?.parentId;

      const customFields = (sp.customFields || sp.attributes?.customFields) as Record<string, unknown> | undefined;
      const sapProductNumber = extractSapProductNumberFromCustomFields(customFields);

      const product: Product = {
        id: sp.id,
        productNumber: sp.productNumber || sp.attributes?.productNumber || '',
        name: sp.name || sp.attributes?.name || 'Unknown Product',
        description: sp.description || sp.attributes?.description,
        price,
        netPrice,
        currency: 'EUR',
        taxRate,
        stock: sp.stock || sp.attributes?.stock || 0,
        available: sp.available !== undefined ? sp.available : (sp.attributes?.available || false),
      active: sp.active !== undefined ? sp.active : (sp.attributes?.active ?? undefined),
        manufacturerName,
        manufacturerNumber: sp.manufacturerNumber || sp.attributes?.manufacturerNumber,
        sapProductNumber: sapProductNumber || undefined,
        categoryNames: categoryNames.length > 0 ? categoryNames : undefined,
        imageUrl: imageUrl || undefined,
        ean: sp.ean || sp.attributes?.ean,
        weight: sp.weight || sp.attributes?.weight,
        dataQualityScore,
        packagingUnit: sp.packagingUnit || sp.attributes?.packagingUnit || sp.purchaseUnit || sp.attributes?.purchaseUnit,
        minOrderQuantity: sp.minPurchase || sp.attributes?.minPurchase,
        maxOrderQuantity: sp.maxPurchase || sp.attributes?.maxPurchase,
        priceRules: priceRules.length > 0 ? priceRules : undefined,
        customFields,
        properties: properties.length > 0 ? properties : undefined,
        createdAt: sp.createdAt || sp.attributes?.createdAt,
        updatedAt: sp.updatedAt || sp.attributes?.updatedAt,
      };

      // Add dimensions if available (Shopware 6.7: Felder können unter attributes liegen)
      const width = sp.width ?? sp.attributes?.width;
      const height = sp.height ?? sp.attributes?.height;
      const length = sp.length ?? sp.attributes?.length;
      if (width != null || height != null || length != null) {
        product.dimensions = {
          width,
          height,
          length,
          unit: 'mm',
        };
      } else {
        // Fallback: Maße aus Produktname parsen (z.B. "Steckrahmen 2000 x 600", "Boden 1000 x 600")
        const parsed = parseDimensionsFromProductName(product.name);
        if (parsed) {
          product.dimensions = parsed;
        }
      }

      if (childCountRaw != null && childCountRaw !== "" && !Number.isNaN(Number(childCountRaw))) {
        product.childCount = Number(childCountRaw);
      }
      if (parentIdRaw !== undefined) {
        product.parentId =
          parentIdRaw == null || parentIdRaw === "" ? null : String(parentIdRaw);
      }

      if (includeVariantChildren) {
        const rawChildren = resolveShopwareChildProducts(sp, includedMap);
        if (rawChildren.length > 0) {
          product.variants = rawChildren.map((raw) =>
            mapChildToProductVariant(raw, includedMap, taxRate)
          );
        }
      }

      return product;
    });

    return { products, total };
  } catch (error) {
    console.error('Error fetching products from Shopware:', error);
    throw error;
  }
}

/**
 * Lädt eine Seite Produkte mit allen für die Produkt-Übersicht relevanten Infos:
 * Verkaufskanal-Zuordnungen (visibilities), erweiterte/Staffel-Preise (prices),
 * Kategorien, Customfields, Eigenschaften, Steuer, Lagerbestand u. v. m.
 * Die salesChannelIds werden zurückgegeben; die Namensauflösung erfolgt im Aufrufer.
 */
export async function fetchProductsOverviewPage(
  this: ShopwareClient,
  limit: number,
  page: number,
  options?: { includeInactive?: boolean; salesChannelIds?: string[]; productId?: string },
): Promise<{ products: ShopwareProductOverview[]; total: number }> {
  const includeInactive = options?.includeInactive ?? true;

  const requestBody: any = {
    limit,
    page,
    "total-count-mode": 1,
    sort: [{ field: "productNumber", order: "ASC" }],
    filter: [],
    includes: {
      product: [
        "id",
        "productNumber",
        "name",
        "translated",
        "active",
        "stock",
        "available",
        "ean",
        "manufacturerNumber",
        "manufacturer",
        "price",
        "purchasePrices",
        "customFields",
        "tax",
        "categories",
        "tags",
        "prices",
        "visibilities",
        "properties",
        "options",
        "parentId",
        "childCount",
        "createdAt",
        "updatedAt",
        "deliveryTimeId",
        "restockTime",
      ],
      product_manufacturer: ["name", "translated"],
      category: ["id", "name", "translated"],
      tag: ["id", "name", "translated"],
      delivery_time: ["id", "name", "min", "max", "unit", "translated"],
      product_delivery_time: ["id", "name", "min", "max", "unit", "translated"],
      tax: ["taxRate"],
      product_price: ["quantityStart", "quantityEnd", "price", "ruleId", "versionId", "updatedAt", "createdAt", "rule"],
      product_visibility: ["id", "salesChannelId", "visibility"],
      property_group_option: ["id", "name", "translated", "group"],
      property_group: ["id", "name", "translated"],
      rule: ["id", "name", "translated"],
    },
    associations: {
      manufacturer: {},
      categories: {},
      tags: {},
      tax: {},
      prices: {
        associations: {
          rule: {},
        },
      },
      visibilities: {},
      properties: {
        associations: {
          group: {},
        },
      },
      options: {
        associations: {
          group: {},
        },
      },
      deliveryTime: {},
    },
  };

  if (!includeInactive) {
    requestBody.filter.push({ type: "equals", field: "active", value: true });
  }

  if (options?.productId) {
    requestBody.filter.push({ type: "equals", field: "id", value: toShopwareUuid(options.productId) });
  }

  if (options?.salesChannelIds && options.salesChannelIds.length > 0) {
    requestBody.filter.push({
      type: "equalsAny",
      field: "visibilities.salesChannelId",
      value: options.salesChannelIds,
    });
  }

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch products overview: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const total = data.total ?? data.meta?.total ?? (data.data || []).length;

  const includedMap = new Map<string, any>();
  if (Array.isArray(data.included)) {
    data.included.forEach((item: any) => includedMap.set(`${item.type}-${item.id}`, item));
  }

  const products: ShopwareProductOverview[] = (data.data || []).map((sp: any) => {
    const attributes = sp.attributes || sp;
    const deliveryTime = parseProductDeliveryTime(sp, includedMap);

    // Steuer
    let taxRate = 19;
    if (sp.tax?.taxRate != null) {
      taxRate = sp.tax.taxRate;
    } else if (sp.relationships?.tax?.data?.id) {
      const tax = includedMap.get(`tax-${sp.relationships.tax.data.id}`);
      taxRate = tax?.attributes?.taxRate ?? 19;
    }

    // Grundpreis (brutto/netto)
    let priceGross = 0;
    let priceNet = 0;
    const priceArray = Array.isArray(sp.price) ? sp.price : Array.isArray(attributes?.price) ? attributes.price : null;
    if (priceArray && priceArray.length > 0) {
      const first = priceArray[0];
      priceGross = first?.gross ?? 0;
      priceNet = first?.net ?? (priceGross && taxRate ? priceGross / (1 + taxRate / 100) : priceGross);
    }

    // Einkaufspreis / Listenpreis netto (purchasePrices)
    let purchasePriceNet: number | null = null;
    let purchasePriceGross: number | null = null;
    const purchaseRaw = sp.purchasePrices ?? attributes?.purchasePrices;
    const purchaseEntryNet = parseShopwarePriceCollectionNet(purchaseRaw, taxRate);
    if (purchaseEntryNet != null) {
      purchasePriceNet = purchaseEntryNet;
      const purchaseEntry = firstShopwarePriceEntry(purchaseRaw);
      purchasePriceGross =
        typeof purchaseEntry?.gross === "number" ? (purchaseEntry.gross as number) : null;
    }

    // Hersteller
    let manufacturerName: string | undefined;
    if (sp.manufacturer) {
      manufacturerName = shopwareEntityName(sp.manufacturer) || undefined;
    } else if (sp.relationships?.manufacturer?.data?.id) {
      manufacturerName =
        shopwareEntityName(
          includedMap.get(`product_manufacturer-${sp.relationships.manufacturer.data.id}`),
        ) || undefined;
    }

    // Kategorien (Namen / Übersetzungen)
    const categories: string[] = [];
    if (Array.isArray(sp.categories)) {
      sp.categories.forEach((c: any) => {
        const name = shopwareEntityName(c);
        if (name) categories.push(name);
      });
    } else if (Array.isArray(sp.relationships?.categories?.data)) {
      sp.relationships.categories.data.forEach((ref: any) => {
        const name = shopwareEntityName(includedMap.get(`category-${ref.id}`));
        if (name) categories.push(name);
      });
    }

    // Tags (Namen / Übersetzungen)
    const tags: string[] = [];
    if (Array.isArray(sp.tags)) {
      sp.tags.forEach((tg: any) => {
        const name = shopwareEntityName(tg);
        if (name) tags.push(name);
      });
    } else if (Array.isArray(sp.relationships?.tags?.data)) {
      sp.relationships.tags.data.forEach((ref: any) => {
        const name = shopwareEntityName(includedMap.get(`tag-${ref.id}`));
        if (name) tags.push(name);
      });
    }

    // Verkaufskanäle inkl. Sichtbarkeitsstufe (aus visibilities)
    const { salesChannelIds, salesChannelVisibilities } = parseProductVisibilities(sp, includedMap);

    // Erweiterte Preise / Staffelpreise (product.prices)
    const dedupedAdvancedPrices = parseProductAdvancedPrices(sp, includedMap);

    // Eigenschaften zählen
    const propertyOptionIds = new Set<string>();
    if (Array.isArray(sp.properties)) {
      sp.properties.forEach((p: any) => p?.id && propertyOptionIds.add(p.id));
    } else if (Array.isArray(sp.relationships?.properties?.data)) {
      sp.relationships.properties.data.forEach((ref: any) => ref?.id && propertyOptionIds.add(ref.id));
    }

    const customFields = (sp.customFields || attributes?.customFields) as Record<string, unknown> | undefined;
    const childCountRaw = sp.childCount ?? attributes?.childCount;
    const parentIdRaw = sp.parentId ?? attributes?.parentId;
    const variantOptions = mapShopwareOptionsForVariant(sp, includedMap);
    const propertyLabels = mapShopwarePropertiesForLabel(sp, includedMap);

    return {
      id: sp.id,
      productNumber: sp.productNumber || attributes?.productNumber || "",
      name:
        shopwareEntityName(sp) ||
        shopwareEntityName(attributes) ||
        String(sp.name || attributes?.name || "").trim(),
      active: sp.active !== undefined ? sp.active : attributes?.active ?? null,
      stock: sp.stock ?? attributes?.stock ?? null,
      ean: sp.ean || attributes?.ean || undefined,
      manufacturerNumber: sp.manufacturerNumber || attributes?.manufacturerNumber || undefined,
      manufacturerName,
      priceGross,
      priceNet,
      purchasePriceNet,
      purchasePriceGross,
      taxRate,
      currency: "EUR",
      salesChannelIds,
      salesChannelVisibilities,
      advancedPrices: dedupedAdvancedPrices,
      categories,
      tags,
      ...deliveryTime,
      restockTime: parseProductRestockTime(sp),
      options: variantOptions.length ? variantOptions : undefined,
      properties: propertyLabels.length ? propertyLabels : undefined,
      customFields: customFields && typeof customFields === "object" ? customFields : undefined,
      propertyCount: propertyOptionIds.size,
      parentId: parentIdRaw == null || parentIdRaw === "" ? null : String(parentIdRaw),
      childCount: childCountRaw != null && !Number.isNaN(Number(childCountRaw)) ? Number(childCountRaw) : null,
      createdAt: sp.createdAt || attributes?.createdAt || undefined,
      updatedAt: sp.updatedAt || attributes?.updatedAt || undefined,
    } satisfies ShopwareProductOverview;
  });

  return { products, total };
}

/**
 * Produkte mit updatedAt >= since (ASC), fuer Delta-Sync in den lokalen Spiegel.
 * Nutzt dieselbe Payload-Struktur wie fetchProductsOverviewPage.
 */
export async function fetchProductsChangedSince(
  this: ShopwareClient,
  since: string | Date | null,
  limit: number = 500,
  page: number = 1,
  options?: { includeInactive?: boolean },
): Promise<{ products: ShopwareProductOverview[]; total: number }> {
  const includeInactive = options?.includeInactive ?? true;
  const sinceIso =
    since == null
      ? null
      : typeof since === "string"
        ? since
        : since.toISOString();

  const requestBody: any = {
    limit,
    page,
    "total-count-mode": 1,
    sort: [{ field: "updatedAt", order: "ASC" }],
    filter: [] as any[],
    includes: {
      product: [
        "id",
        "productNumber",
        "name",
        "translated",
        "active",
        "stock",
        "available",
        "ean",
        "manufacturerNumber",
        "manufacturer",
        "price",
        "purchasePrices",
        "customFields",
        "tax",
        "categories",
        "tags",
        "prices",
        "visibilities",
        "properties",
        "options",
        "parentId",
        "childCount",
        "createdAt",
        "updatedAt",
        "deliveryTimeId",
        "restockTime",
      ],
      product_manufacturer: ["name", "translated"],
      category: ["id", "name", "translated"],
      tag: ["id", "name", "translated"],
      delivery_time: ["id", "name", "min", "max", "unit", "translated"],
      product_delivery_time: ["id", "name", "min", "max", "unit", "translated"],
      tax: ["taxRate"],
      product_price: ["quantityStart", "quantityEnd", "price", "ruleId", "versionId", "updatedAt", "createdAt", "rule"],
      product_visibility: ["id", "salesChannelId", "visibility"],
      property_group_option: ["id", "name", "translated", "group"],
      property_group: ["id", "name", "translated"],
      rule: ["id", "name", "translated"],
    },
    associations: {
      manufacturer: {},
      categories: {},
      tags: {},
      tax: {},
      prices: { associations: { rule: {} } },
      visibilities: {},
      properties: {
        associations: {
          group: {},
        },
      },
      options: {
        associations: {
          group: {},
        },
      },
      deliveryTime: {},
    },
  };

  if (!includeInactive) {
    requestBody.filter.push({ type: "equals", field: "active", value: true });
  }
  if (sinceIso) {
    requestBody.filter.push({
      type: "range",
      field: "updatedAt",
      parameters: { gte: sinceIso },
    });
  }

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch products changed since: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const total = data.total ?? data.meta?.total ?? (data.data || []).length;
  const includedMap = new Map<string, any>();
  if (Array.isArray(data.included)) {
    data.included.forEach((item: any) => includedMap.set(`${item.type}-${item.id}`, item));
  }

  const products: ShopwareProductOverview[] = (data.data || []).map((sp: any) => {
    const attributes = sp.attributes || sp;
    const deliveryTime = parseProductDeliveryTime(sp, includedMap);

    let taxRate = 19;
    if (sp.tax?.taxRate != null) {
      taxRate = sp.tax.taxRate;
    } else if (sp.relationships?.tax?.data?.id) {
      const tax = includedMap.get(`tax-${sp.relationships.tax.data.id}`);
      taxRate = tax?.attributes?.taxRate ?? 19;
    }

    let priceGross = 0;
    let priceNet = 0;
    const priceArray = Array.isArray(sp.price)
      ? sp.price
      : Array.isArray(attributes?.price)
        ? attributes.price
        : null;
    if (priceArray && priceArray.length > 0) {
      const first = priceArray[0];
      priceGross = first?.gross ?? 0;
      priceNet = first?.net ?? (priceGross && taxRate ? priceGross / (1 + taxRate / 100) : priceGross);
    }

    let purchasePriceNet: number | null = null;
    let purchasePriceGross: number | null = null;
    const purchaseRaw = sp.purchasePrices ?? attributes?.purchasePrices;
    const purchaseEntryNet = parseShopwarePriceCollectionNet(purchaseRaw, taxRate);
    if (purchaseEntryNet != null) {
      purchasePriceNet = purchaseEntryNet;
      const purchaseEntry = firstShopwarePriceEntry(purchaseRaw);
      purchasePriceGross =
        typeof purchaseEntry?.gross === "number" ? (purchaseEntry.gross as number) : null;
    }

    let manufacturerName: string | undefined;
    if (sp.manufacturer) {
      manufacturerName = shopwareEntityName(sp.manufacturer) || undefined;
    } else if (sp.relationships?.manufacturer?.data?.id) {
      manufacturerName =
        shopwareEntityName(
          includedMap.get(`product_manufacturer-${sp.relationships.manufacturer.data.id}`),
        ) || undefined;
    }

    const categories: string[] = [];
    if (Array.isArray(sp.categories)) {
      sp.categories.forEach((c: any) => {
        const name = shopwareEntityName(c);
        if (name) categories.push(name);
      });
    } else if (Array.isArray(sp.relationships?.categories?.data)) {
      sp.relationships.categories.data.forEach((ref: any) => {
        const name = shopwareEntityName(includedMap.get(`category-${ref.id}`));
        if (name) categories.push(name);
      });
    }

    const tags: string[] = [];
    if (Array.isArray(sp.tags)) {
      sp.tags.forEach((tg: any) => {
        const name = shopwareEntityName(tg);
        if (name) tags.push(name);
      });
    } else if (Array.isArray(sp.relationships?.tags?.data)) {
      sp.relationships.tags.data.forEach((ref: any) => {
        const name = shopwareEntityName(includedMap.get(`tag-${ref.id}`));
        if (name) tags.push(name);
      });
    }

    const { salesChannelIds, salesChannelVisibilities } = parseProductVisibilities(sp, includedMap);

    const dedupedAdvancedPrices = parseProductAdvancedPrices(sp, includedMap);
    const propertyOptionIds = new Set<string>();
    if (Array.isArray(sp.properties)) {
      sp.properties.forEach((p: any) => p?.id && propertyOptionIds.add(p.id));
    } else if (Array.isArray(sp.relationships?.properties?.data)) {
      sp.relationships.properties.data.forEach(
        (ref: any) => ref?.id && propertyOptionIds.add(ref.id),
      );
    }

    const customFields = (sp.customFields || attributes?.customFields) as
      | Record<string, unknown>
      | undefined;
    const childCountRaw = sp.childCount ?? attributes?.childCount;
    const parentIdRaw = sp.parentId ?? attributes?.parentId;
    const variantOptions = mapShopwareOptionsForVariant(sp, includedMap);
    const propertyLabels = mapShopwarePropertiesForLabel(sp, includedMap);

    return {
      id: sp.id,
      productNumber: sp.productNumber || attributes?.productNumber || "",
      name:
        shopwareEntityName(sp) ||
        shopwareEntityName(attributes) ||
        String(sp.name || attributes?.name || "").trim(),
      active: sp.active !== undefined ? sp.active : attributes?.active ?? null,
      stock: sp.stock ?? attributes?.stock ?? null,
      ean: sp.ean || attributes?.ean || undefined,
      manufacturerNumber: sp.manufacturerNumber || attributes?.manufacturerNumber || undefined,
      manufacturerName,
      priceGross,
      priceNet,
      purchasePriceNet,
      purchasePriceGross,
      taxRate,
      currency: "EUR",
      salesChannelIds,
      salesChannelVisibilities,
      advancedPrices: dedupedAdvancedPrices,
      categories,
      tags,
      ...deliveryTime,
      restockTime: parseProductRestockTime(sp),
      options: variantOptions.length ? variantOptions : undefined,
      properties: propertyLabels.length ? propertyLabels : undefined,
      customFields: customFields && typeof customFields === "object" ? customFields : undefined,
      propertyCount: propertyOptionIds.size,
      parentId: parentIdRaw == null || parentIdRaw === "" ? null : String(parentIdRaw),
      childCount:
        childCountRaw != null && !Number.isNaN(Number(childCountRaw))
          ? Number(childCountRaw)
          : null,
      createdAt: sp.createdAt || attributes?.createdAt || undefined,
      updatedAt: sp.updatedAt || attributes?.updatedAt || undefined,
    } satisfies ShopwareProductOverview;
  });

  return { products, total };
}

/** Leichter ID-Sweep aller Produkt-IDs (fuer Deletion-Reconcile). */
export async function fetchAllProductIds(this: ShopwareClient, options?: {
  includeInactive?: boolean;
}): Promise<{ ids: string[]; total: number }> {
  const includeInactive = options?.includeInactive ?? true;
  const ids: string[] = [];
  const BATCH = 500;
  let page = 1;
  let total = 0;

  while (true) {
    const body: any = {
      limit: BATCH,
      page,
      "total-count-mode": 1,
      includes: { product: ["id"] },
      filter: includeInactive ? [] : [{ type: "equals", field: "active", value: true }],
    };
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch product ids: ${response.statusText} - ${errorText}`);
    }
    const data = await response.json();
    total = Number(data?.meta?.total ?? data?.total ?? total);
    const list = data.data || [];
    for (const row of list) {
      if (row?.id) ids.push(String(row.id));
    }
    if (list.length < BATCH) break;
    page += 1;
  }
  return { ids, total: total || ids.length };
}

/**
 * Einmaliger Abgleich gegen EAN, productNumber und manufacturerNumber — inkl. inaktiver Produkte.
 * Für Commercial-Drafts, wenn der aktive Katalog-Cache keinen Treffer liefert.
 */
export async function searchProductsByIdentifiersIncludeInactive(this: ShopwareClient, identifiers: string[]): Promise<Product[]> {
  const uniq = [...new Set(identifiers.map((s) => String(s).trim()).filter(Boolean))].slice(0, 12);
  if (uniq.length === 0) return [];

  const idQueries = uniq.flatMap((id) => [
    { type: "equals", field: "ean", value: id },
    { type: "equals", field: "productNumber", value: id },
    { type: "equals", field: "manufacturerNumber", value: id },
  ]);
  const queries = idQueries.slice(0, 36);

  const requestBody: any = {
    limit: 25,
    page: 1,
    filter: [
      {
        type: "multi",
        operator: "OR",
        queries,
      },
      {
        type: "multi",
        operator: "OR",
        queries: [
          { type: "equals", field: "active", value: true },
          { type: "equals", field: "active", value: false },
        ],
      },
    ],
  };

  try {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        includes: {
          product: [
            "id",
            "productNumber",
            "name",
            "price",
            "manufacturerNumber",
            "ean",
            "customFields",
            "active",
            "tax",
          ],
          tax: ["taxRate"],
        },
        associations: {
          tax: {},
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`searchProductsByIdentifiersIncludeInactive: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const shopwareProducts = data.data || [];
    const includedMap = new Map<string, any>();
    if (data.included) {
      data.included.forEach((item: any) => {
        includedMap.set(`${item.type}-${item.id}`, item);
      });
    }

    return shopwareProducts.map((sp: any) => {
      let taxRate = 19;
      if (sp.tax?.taxRate) {
        taxRate = sp.tax.taxRate;
      } else if (sp.relationships?.tax?.data?.id) {
        const tax = includedMap.get(`tax-${sp.relationships.tax.data.id}`);
        taxRate = tax?.attributes?.taxRate || 19;
      }
      let price = 0;
      if (sp.price && Array.isArray(sp.price)) {
        const eurPrice = sp.price.find((p: any) => p.currencyId || true);
        if (eurPrice) price = eurPrice.gross || 0;
      } else if (sp.attributes?.price && Array.isArray(sp.attributes.price)) {
        const eurPrice = sp.attributes.price.find((p: any) => p.currencyId || true);
        if (eurPrice) price = eurPrice.gross || 0;
      }

      const netPrice = taxRate > 0 ? price / (1 + taxRate / 100) : price;
      const customFields = (sp.customFields || sp.attributes?.customFields) as Record<string, unknown> | undefined;
      const sapProductNumber = extractSapProductNumberFromCustomFields(customFields);
      return {
        id: sp.id,
        productNumber: sp.productNumber || sp.attributes?.productNumber || "",
        name: sp.name || sp.attributes?.name || "Unknown Product",
        description: sp.description || sp.attributes?.description,
        price,
        netPrice,
        currency: "EUR" as const,
        taxRate,
        stock: sp.stock || sp.attributes?.stock || 0,
        available: sp.available !== undefined ? sp.available : (sp.attributes?.available || false),
        active: sp.active !== undefined ? sp.active : (sp.attributes?.active ?? undefined),
        manufacturerNumber: sp.manufacturerNumber || sp.attributes?.manufacturerNumber,
        ean: sp.ean || sp.attributes?.ean,
        sapProductNumber: sapProductNumber || undefined,
        customFields,
      } satisfies Product;
    });
  } catch (e) {
    console.warn("[Shopware] searchProductsByIdentifiersIncludeInactive failed:", e);
    return [];
  }
}

export async function fetchProductsForDataQuality(
  this: ShopwareClient,
  limit: number = 200,
  page: number = 1,
  salesChannelIds?: string[],
  includeInactive: boolean = true
): Promise<{
  products: Array<{
    id: string;
    productNumber?: string;
    manufacturerNumber?: string;
    ean?: string;
    description?: string;
    propertyCount: number;
    hasDeliveryTime: boolean;
    categoryCount: number;
    visibilityCount: number;
    imageCount: number;
    width?: number;
    height?: number;
    length?: number;
    weight?: number;
  }>;
  total: number;
}> {
  const requestBody: any = {
    limit,
    page,
    // Gesamtzahl nur auf der ersten Seite ermitteln (teuer); Folgeseiten kennen sie schon
    "total-count-mode": page === 1 ? 1 : 0,
    sort: [
      {
        field: "productNumber",
        order: "ASC",
      },
    ],
    filter: [],
    // Nur was gezaehlt wird. categories/visibilities/media/coverId muessen in der product-Liste
    // stehen - sonst laesst Shopware sie weg und Kategorie, Sichtbarkeit und Bilder zaehlten nie.
    includes: {
      product: [
        "id",
        "productNumber",
        "manufacturerNumber",
        "ean",
        "description",
        "properties",
        "options",
        "width",
        "height",
        "length",
        "weight",
        "deliveryTimeId",
        "categories",
        "visibilities",
        "media",
        "coverId",
      ],
      property_group_option: ["id"],
      product_visibility: ["id", "salesChannelId"],
      product_media: ["id"],
      category: ["id"],
    },
    associations: {
      categories: {},
      properties: {},
      options: {},
      visibilities: {},
      media: {},
    },
  };

  if (includeInactive) {
    requestBody.filter.push({
      type: "multi",
      operator: "OR",
      queries: [
        {
          type: "equals",
          field: "active",
          value: true,
        },
        {
          type: "equals",
          field: "active",
          value: false,
        },
      ],
    });
  } else {
    requestBody.filter.push({
      type: "equals",
      field: "active",
      value: true,
    });
  }

  if (salesChannelIds && salesChannelIds.length > 0) {
    requestBody.filter.push({
      type: "equalsAny",
      field: "visibilities.salesChannelId",
      value: salesChannelIds,
    });
  }

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch products for data quality: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const total = data.total ?? data.meta?.total ?? (data.data || []).length;

  const products = (data.data || []).map((sp: any) => {
    const attributes = sp.attributes || sp;
    const propertyOptionIds = new Set<string>();
    if (Array.isArray(sp.properties)) {
      sp.properties.forEach((prop: any) => prop?.id && propertyOptionIds.add(prop.id));
    }
    if (Array.isArray(sp.relationships?.properties?.data)) {
      sp.relationships.properties.data.forEach((entry: any) => entry?.id && propertyOptionIds.add(entry.id));
    }
    if (Array.isArray(sp.options)) {
      sp.options.forEach((opt: any) => opt?.id && propertyOptionIds.add(opt.id));
    }
    if (Array.isArray(sp.relationships?.options?.data)) {
      sp.relationships.options.data.forEach((entry: any) => entry?.id && propertyOptionIds.add(entry.id));
    }
    const propertiesCount = propertyOptionIds.size;
    const categoryCount = Array.isArray(sp.categories)
      ? sp.categories.length
      : Array.isArray(sp.relationships?.categories?.data)
        ? sp.relationships.categories.data.length
        : 0;
    const visibilityCount = Array.isArray(sp.visibilities)
      ? sp.visibilities.length
      : Array.isArray(sp.relationships?.visibilities?.data)
        ? sp.relationships.visibilities.data.length
        : 0;
    const mediaCount = Array.isArray(sp.media)
      ? sp.media.length
      : Array.isArray(sp.relationships?.media?.data)
        ? sp.relationships.media.data.length
        : 0;
    const hasCover = Boolean(sp.cover || sp.coverId || sp.relationships?.cover?.data?.id);
    const imageCount = (hasCover ? 1 : 0) + mediaCount;
    const hasDeliveryTime = Boolean(
      sp.deliveryTime ||
        sp.deliveryTimeId ||
        attributes?.deliveryTimeId ||
        sp.relationships?.deliveryTime?.data?.id
    );

    return {
      id: sp.id,
      productNumber: sp.productNumber || attributes?.productNumber,
      manufacturerNumber: sp.manufacturerNumber || attributes?.manufacturerNumber,
      ean: sp.ean || attributes?.ean,
      description: sp.description || attributes?.description,
      propertyCount: propertiesCount,
      hasDeliveryTime,
      categoryCount,
      visibilityCount,
      imageCount,
      width: sp.width ?? attributes?.width,
      height: sp.height ?? attributes?.height,
      length: sp.length ?? attributes?.length,
      weight: sp.weight ?? attributes?.weight,
    };
  });

  return { products, total };
}

export async function fetchProductDataQuality(this: ShopwareClient, productId: string): Promise<{
  id: string;
  productNumber?: string;
  manufacturerNumber?: string;
  ean?: string;
  description?: string;
  propertyCount: number;
  hasDeliveryTime: boolean;
  categoryCount: number;
  visibilityCount: number;
  imageCount: number;
  width?: number;
  height?: number;
  length?: number;
  weight?: number;
}> {
  const response = await this.searchEntity("product", {
    limit: 1,
    filter: [
      {
        type: "equals",
        field: "id",
        value: productId,
      },
    ],
    includes: {
      product: [
        "id",
        "productNumber",
        "manufacturerNumber",
        "ean",
        "description",
        "properties",
        "options",
        "width",
        "height",
        "length",
        "weight",
        "deliveryTimeId",
        "coverId",
        // ohne diese Eintraege laesst Shopware die Zuordnungen weg (Kategorie/Sichtbarkeit/Bilder = 0)
        "categories",
        "visibilities",
        "media",
      ],
      property_group_option: ["id", "name", "group"],
      property_group: ["id", "name"],
      product_visibility: ["id", "salesChannelId"],
      product_media: ["id"],
      delivery_time: ["id", "name", "min", "max", "unit", "translated"],
      product_delivery_time: ["id", "name", "min", "max", "unit", "translated"],
      category: ["id"],
    },
    associations: {
      categories: {},
      properties: {
        associations: {
          group: {},
        },
      },
      options: {
        associations: {
          group: {},
        },
      },
      visibilities: {},
      deliveryTime: {},
      cover: {
        associations: {
          media: {},
        },
      },
      media: {
        associations: {
          media: {},
        },
      },
    },
  });

  const sp = response?.data?.[0];
  if (!sp) {
    throw new Error("Product not found");
  }

  const attributes = sp.attributes || sp;
  const propertyOptionIds = new Set<string>();
  if (Array.isArray(sp.properties)) {
    sp.properties.forEach((prop: any) => prop?.id && propertyOptionIds.add(prop.id));
  }
  if (Array.isArray(sp.relationships?.properties?.data)) {
    sp.relationships.properties.data.forEach((entry: any) => entry?.id && propertyOptionIds.add(entry.id));
  }
  if (Array.isArray(sp.options)) {
    sp.options.forEach((opt: any) => opt?.id && propertyOptionIds.add(opt.id));
  }
  if (Array.isArray(sp.relationships?.options?.data)) {
    sp.relationships.options.data.forEach((entry: any) => entry?.id && propertyOptionIds.add(entry.id));
  }
  if (Array.isArray(response?.included)) {
    response.included.forEach((item: any) => {
      if (item.type === "property_group_option" && item.id) {
        propertyOptionIds.add(item.id);
      }
    });
  }
  const propertiesCount = propertyOptionIds.size;
  const categoryCount = Array.isArray(sp.categories)
    ? sp.categories.length
    : Array.isArray(sp.relationships?.categories?.data)
      ? sp.relationships.categories.data.length
      : 0;
  const visibilityCount = Array.isArray(sp.visibilities)
    ? sp.visibilities.length
    : Array.isArray(sp.relationships?.visibilities?.data)
      ? sp.relationships.visibilities.data.length
      : 0;
  const mediaCount = Array.isArray(sp.media)
    ? sp.media.length
    : Array.isArray(sp.relationships?.media?.data)
      ? sp.relationships.media.data.length
      : 0;
  const hasCover = Boolean(sp.cover || sp.coverId || sp.relationships?.cover?.data?.id);
  const imageCount = (hasCover ? 1 : 0) + mediaCount;
  const hasDeliveryTime = Boolean(
    sp.deliveryTime ||
      sp.deliveryTimeId ||
      attributes?.deliveryTimeId ||
      sp.relationships?.deliveryTime?.data?.id
  );

  return {
    id: sp.id,
    productNumber: sp.productNumber || attributes?.productNumber,
    manufacturerNumber: sp.manufacturerNumber || attributes?.manufacturerNumber,
    ean: sp.ean || attributes?.ean,
    description: sp.description || attributes?.description,
    propertyCount: propertiesCount,
    hasDeliveryTime,
    categoryCount,
    visibilityCount,
    imageCount,
    width: sp.width ?? attributes?.width,
    height: sp.height ?? attributes?.height,
    length: sp.length ?? attributes?.length,
    weight: sp.weight ?? attributes?.weight,
  };
}

export async function setProductActive(this: ShopwareClient, productId: string, active: boolean): Promise<void> {
  const syncResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
    method: "POST",
    body: JSON.stringify({
      "write-product": {
        entity: "product",
        action: "upsert",
        payload: [
          {
            id: productId,
            active,
          },
        ],
      },
    }),
  });

  if (syncResponse.ok) {
    return;
  }

  const syncError = await syncResponse.text();

  const jsonApiResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify({
      data: {
        id: productId,
        type: "product",
        attributes: {
          active,
        },
      },
    }),
  });

  if (jsonApiResponse.ok) {
    return;
  }

  const jsonApiError = await jsonApiResponse.text();

  // Fallback for older Shopware API behavior
  const legacyResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });

  if (!legacyResponse.ok) {
    const legacyError = await legacyResponse.text();
    throw new Error(
      `Failed to update product status: Sync: ${syncResponse.statusText} - ${syncError} | JSON:API: ${jsonApiResponse.statusText} - ${jsonApiError} | Legacy: ${legacyResponse.statusText} - ${legacyError}`
    );
  }
}

/** Setzt den Shopware-Produktbestand (absolute Menge). */
export async function setProductStock(this: ShopwareClient, productId: string, stock: number): Promise<void> {
  const qty = Math.max(0, Math.floor(Number(stock) || 0));
  const syncResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
    method: "POST",
    body: JSON.stringify({
      "write-product-stock": {
        entity: "product",
        action: "upsert",
        payload: [{ id: productId, stock: qty }],
      },
    }),
  });

  if (syncResponse.ok) return;

  const syncError = await syncResponse.text();

  const jsonApiResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/vnd.api+json" },
    body: JSON.stringify({
      data: {
        id: productId,
        type: "product",
        attributes: { stock: qty },
      },
    }),
  });

  if (jsonApiResponse.ok) return;

  const jsonApiError = await jsonApiResponse.text();

  const legacyResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
    method: "PATCH",
    body: JSON.stringify({ stock: qty }),
  });

  if (!legacyResponse.ok) {
    const legacyError = await legacyResponse.text();
    throw new Error(
      `Failed to update product stock: Sync: ${syncResponse.statusText} - ${syncError} | JSON:API: ${jsonApiResponse.statusText} - ${jsonApiError} | Legacy: ${legacyResponse.statusText} - ${legacyError}`,
    );
  }
}

/**
 * Paginiert alle Produkte (aktiv + inaktiv, inkl. Varianten) mit minimalem Payload fuer regulationPrice-Reset.
 */
export async function* iterateAllProductsForPriceReset(
  this: ShopwareClient,
  pageSize = 500
): AsyncGenerator<ProductPriceResetRow, void, unknown> {
  let page = 1;

  while (true) {
    const data = await this.searchEntity("product", {
      limit: pageSize,
      page,
      "total-count-mode": "exact",
      includes: {
        product: ["id", "price"],
      },
    });

    const rows: any[] = data.data || [];
    for (const sp of rows) {
      const id = sp.id ?? sp.attributes?.id;
      if (!id) continue;
      const priceRaw = sp.price ?? sp.attributes?.price;
      const price = Array.isArray(priceRaw) ? (priceRaw as ShopwarePriceEntry[]) : [];
      yield { id: String(id), price };
    }

    if (rows.length < pageSize) {
      break;
    }

    const total = data.total ?? data.meta?.total;
    if (typeof total === "number" && page * pageSize >= total) {
      break;
    }

    page += 1;
  }
}

/** Setzt nur `price` per Sync-Upsert (z. B. regulationPrice auf null). */
export async function bulkPatchProductPrices(this: ShopwareClient, payload: Array<{ id: string; price: ShopwarePriceEntry[] }>): Promise<void> {
  if (payload.length === 0) {
    return;
  }

  const syncPayload = payload.map((row) => ({
    id: toShopwareUuid(row.id),
    price: row.price,
  }));

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
    method: "POST",
    body: JSON.stringify({
      "write-product-regulation-price-reset": {
        entity: "product",
        action: "upsert",
        payload: syncPayload,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to bulk patch product prices: ${response.status} ${response.statusText} - ${errorText}`
    );
  }
}

/** Setzt `purchasePrices` (Einkaufspreis / Listenpreis netto) per Sync-Upsert. */
export async function bulkPatchProductPurchasePrices(
  this: ShopwareClient,
  payload: Array<{ id: string; purchasePrices: ShopwarePriceEntry[] }>,
): Promise<void> {
  if (payload.length === 0) {
    return;
  }

  const syncPayload = payload.map((row) => ({
    id: toShopwareUuid(row.id),
    purchasePrices: row.purchasePrices,
  }));

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
    method: "POST",
    body: JSON.stringify({
      "write-product-purchase-prices": {
        entity: "product",
        action: "upsert",
        payload: syncPayload,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to bulk patch product purchase prices: ${response.status} ${response.statusText} - ${errorText}`
    );
  }
}

/** Lädt alle wdu_ifs_productnumber aus dem Katalog (wie OBX-Suche, ohne Custom-Field-API-Filter). */
export async function loadIfsProductNumberCatalog(this: ShopwareClient, options?: { includeInactive?: boolean }): Promise<Set<string>> {
  const catalog = new Set<string>();
  const includeInactive = options?.includeInactive ?? true;
  const BATCH = 500;
  let page = 1;

  while (true) {
    const { products } = await this.fetchProducts(
      BATCH,
      page,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      includeInactive,
    );

    for (const product of products) {
      const ifs = getWduIfsProductNumber(product.customFields as Record<string, unknown> | undefined);
      if (ifs) addHerstellpreisCatalogKeys(catalog, ifs);
    }

    if (products.length < BATCH) break;
    page += 1;
  }

  console.log(`[Shopware] loadIfsProductNumberCatalog: ${catalog.size} IFS-Schlüssel geladen`);
  return catalog;
}

/** @deprecated Shopware filtert customFields oft nicht per Search — loadIfsProductNumberCatalog nutzen. */
export async function searchProductsByIfsProductNumbers(this: ShopwareClient, ifsProductNumbers: string[]): Promise<
  Array<{
    id: string;
    productNumber: string;
    ifsProductNumber: string;
  }>
> {
  const uniqueNumbers = [...new Set(ifsProductNumbers.map((n) => String(n).trim()).filter(Boolean))];
  if (uniqueNumbers.length === 0) return [];

  const result: Array<{ id: string; productNumber: string; ifsProductNumber: string }> = [];
  const CHUNK = 50;

  for (let i = 0; i < uniqueNumbers.length; i += CHUNK) {
    const chunk = uniqueNumbers.slice(i, i + CHUNK);
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: "POST",
        body: JSON.stringify({
          limit: Math.max(chunk.length, 25),
          filter: {
            type: "multi",
            operator: "or",
            queries: chunk.map((ifsNumber) => ({
              type: "equals",
              field: "customFields.wdu_ifs_productnumber",
              value: ifsNumber,
            })),
          },
          includes: {
            product: ["id", "productNumber", "customFields"],
          },
        }),
      });
      if (!response.ok) continue;
      const data = await response.json();
      for (const sp of data.data || []) {
        const attrs = sp.attributes ?? sp;
        const customFields = (sp.customFields ?? attrs?.customFields) as Record<string, unknown> | undefined;
        let ifsValue: string | undefined;
        const direct = customFields?.["wdu_ifs_productnumber"];
        if (typeof direct === "string" && direct.trim()) ifsValue = direct.trim();
        else if (typeof direct === "number" && Number.isFinite(direct)) ifsValue = String(direct);

        if (!ifsValue) continue;

        result.push({
          id: String(sp.id),
          productNumber: String(sp.productNumber ?? attrs?.productNumber ?? ""),
          ifsProductNumber: ifsValue,
        });
      }
    } catch (error: any) {
      console.warn("[Shopware] searchProductsByIfsProductNumbers:", error?.message || error);
    }
  }

  return result;
}

/** Sucht Produkte anhand der Artikelnummer (Batch). */
export async function searchProductsByProductNumbers(this: ShopwareClient, productNumbers: string[]): Promise<
  Array<{
    id: string;
    productNumber: string;
    taxRate: number;
    purchasePrices: ShopwarePriceEntry[] | null;
  }>
> {
  const uniqueNumbers = [...new Set(productNumbers.map((n) => String(n).trim()).filter(Boolean))];
  if (uniqueNumbers.length === 0) return [];

  const result: Array<{
    id: string;
    productNumber: string;
    taxRate: number;
    purchasePrices: ShopwarePriceEntry[] | null;
  }> = [];

  const CHUNK = 50;
  for (let i = 0; i < uniqueNumbers.length; i += CHUNK) {
    const chunk = uniqueNumbers.slice(i, i + CHUNK);
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: "POST",
        body: JSON.stringify({
          limit: chunk.length,
          filter: {
            type: "multi",
            operator: "or",
            queries: chunk.map((productNumber) => ({
              type: "equals",
              field: "productNumber",
              value: productNumber,
            })),
          },
          includes: {
            product: ["id", "productNumber", "purchasePrices"],
            tax: ["taxRate"],
          },
          associations: { tax: {} },
        }),
      });
      if (!response.ok) continue;
      const data = await response.json();
      for (const sp of data.data || []) {
        const attrs = sp.attributes ?? sp;
        let taxRate = 19;
        if (sp.tax?.taxRate != null) taxRate = sp.tax.taxRate;
        else if (attrs?.tax?.taxRate != null) taxRate = attrs.tax.taxRate;

        const purchaseRaw = sp.purchasePrices ?? attrs?.purchasePrices;
        const purchasePrices = Array.isArray(purchaseRaw)
          ? purchaseRaw
          : purchaseRaw && typeof purchaseRaw === "object"
            ? Object.values(purchaseRaw)
            : null;

        result.push({
          id: String(sp.id),
          productNumber: String(sp.productNumber ?? attrs?.productNumber ?? ""),
          taxRate,
          purchasePrices: purchasePrices as ShopwarePriceEntry[] | null,
        });
      }
    } catch (error: any) {
      console.warn("[Shopware] searchProductsByProductNumbers:", error?.message || error);
    }
  }

  return result;
}

/** GLB-Datei in Shopware Medien hochladen und dem Produkt zuordnen */
export async function uploadProductGlbMedia(this: ShopwareClient, productId: string, glbBuffer: Buffer, filename: string): Promise<{ mediaId: string }> {
  const mediaId = toShopwareUuid(randomUUID());
  const productIdNorm = toShopwareUuid(productId);
  const baseFilename = filename.replace(/\.glb$/i, "").replace(/\?.*$/, "");

  const createRes = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/media`, {
    method: "POST",
    body: JSON.stringify({ id: mediaId }),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Media-Entity konnte nicht erstellt werden (${createRes.status}): ${err}`);
  }

  const token = await this.authenticate();
  const uploadUrl = `${this.baseUrl}/api/_action/media/${mediaId}/upload?extension=glb&fileName=${encodeURIComponent(baseFilename)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "model/gltf-binary",
    },
    body: glbBuffer,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`GLB-Upload fehlgeschlagen (${uploadRes.status}): ${err}`);
  }

  const productMediaId = toShopwareUuid(randomUUID());
  const linkRes = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product-media`, {
    method: "POST",
    body: JSON.stringify({
      id: productMediaId,
      productId: productIdNorm,
      mediaId,
    }),
  });
  if (!linkRes.ok) {
    const err = await linkRes.text();
    const patchRes = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productIdNorm}`, {
      method: "PATCH",
      body: JSON.stringify({ coverId: mediaId }),
    });
    if (!patchRes.ok) {
      const patchErr = await patchRes.text();
      throw new Error(`Produkt-Medien-Verknüpfung fehlgeschlagen (${linkRes.status}): ${err}. Cover-Fallback (${patchRes.status}): ${patchErr}`);
    }
  }

  return { mediaId };
}

export async function fetchProductActiveStatus(this: ShopwareClient, productId: string): Promise<boolean | null> {
  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch product: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  if (typeof data?.data?.attributes?.active === "boolean") {
    return data.data.attributes.active;
  }
  if (typeof data?.active === "boolean") {
    return data.active;
  }
  return null;
}

export async function fetchProductCategoryIds(this: ShopwareClient, productId: string): Promise<{ categoryIds: string[]; categoryNames: string[] }> {
  const response = await this.searchEntity("product", {
    limit: 1,
    filter: [
      {
        type: "equals",
        field: "id",
        value: productId,
      },
    ],
    associations: {
      categories: {},
    },
    includes: {
      product: ["id"],
      category: ["id", "name"],
    },
  });

  const product = response?.data?.[0];
  const relationshipIds = (product?.relationships?.categories?.data || []).map((entry: any) => entry.id);
  const includedCategories = (response?.included || []).filter((item: any) => item.type === "category");
  const categoryNames = includedCategories
    .filter((item: any) => relationshipIds.includes(item.id))
    .map((item: any) => item.attributes?.name || item.name)
    .filter(Boolean);

  return {
    categoryIds: relationshipIds,
    categoryNames,
  };
}

export async function setProductCategories(this: ShopwareClient, productId: string, categoryIds: string[]): Promise<void> {
  const syncResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
    method: "POST",
    body: JSON.stringify({
      "write-product-categories": {
        entity: "product",
        action: "upsert",
        payload: [
          {
            id: productId,
            categories: categoryIds.map((id) => ({ id })),
          },
        ],
      },
    }),
  });

  if (syncResponse.ok) {
    return;
  }

  const syncError = await syncResponse.text();

  const jsonApiResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify({
      data: {
        id: productId,
        type: "product",
        relationships: {
          categories: {
            data: categoryIds.map((id) => ({ type: "category", id })),
          },
        },
      },
    }),
  });

  if (jsonApiResponse.ok) {
    return;
  }

  const jsonApiError = await jsonApiResponse.text();

  const legacyResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
    method: "PATCH",
    body: JSON.stringify({
      categories: categoryIds.map((id) => ({ id })),
      categoryIds,
    }),
  });

  if (!legacyResponse.ok) {
    const legacyError = await legacyResponse.text();
    throw new Error(
      `Failed to update product categories: Sync: ${syncResponse.statusText} - ${syncError} | JSON:API: ${jsonApiResponse.statusText} - ${jsonApiError} | Legacy: ${legacyResponse.statusText} - ${legacyError}`
    );
  }
}

export async function fetchProductSalesChannelIds(this: ShopwareClient, productId: string): Promise<{ salesChannelIds: string[] }> {
  try {
    const response = await this.searchEntity("product-visibility", {
      limit: 500,
      filter: [
        {
          type: "equals",
          field: "productId",
          value: productId,
        },
      ],
      includes: {
        product_visibility: ["id", "salesChannelId", "visibility"],
      },
    });

    const entries = response?.data || [];
    const salesChannelIds = entries
      .map((entry: any) => entry?.salesChannelId || entry?.attributes?.salesChannelId)
      .filter(Boolean);

    return { salesChannelIds };
  } catch (error) {
    console.warn("Failed to fetch product visibilities via product_visibility. Falling back:", error);
  }

  const productResponse = await this.searchEntity("product", {
    limit: 1,
    filter: [
      {
        type: "equals",
        field: "id",
        value: productId,
      },
    ],
    associations: {
      visibilities: {},
    },
    includes: {
      product: ["id"],
      product_visibility: ["id", "salesChannelId", "visibility"],
    },
  });

  const product = productResponse?.data?.[0];
  const visibilityIds = (product?.relationships?.visibilities?.data || []).map((entry: any) => entry.id);
  const includedVisibilities = (productResponse?.included || []).filter(
    (item: any) => item.type === "product_visibility"
  );
  const salesChannelIds = includedVisibilities
    .filter((item: any) => visibilityIds.includes(item.id))
    .map((item: any) => item.attributes?.salesChannelId || item.salesChannelId)
    .filter(Boolean);

  return { salesChannelIds };
}

export async function setProductSalesChannels(this: ShopwareClient, productId: string, salesChannelIds: string[]): Promise<void> {
  const desiredIds = Array.from(new Set(salesChannelIds));
  const visibility = 30;
  let currentEntries: Array<{ id?: string; salesChannelId?: string }> = [];

  try {
    const current = await this.searchEntity("product-visibility", {
      limit: 500,
      filter: [
        {
          type: "equals",
          field: "productId",
          value: productId,
        },
      ],
      includes: {
        product_visibility: ["id", "salesChannelId"],
      },
    });
    currentEntries = (current?.data || []).map((entry: any) => ({
      id: entry?.id,
      salesChannelId: entry?.salesChannelId || entry?.attributes?.salesChannelId,
    }));
  } catch (error) {
    console.warn("Failed to fetch existing product visibilities, continuing with upsert:", error);
  }

  const currentByChannel = new Map(
    currentEntries
      .filter((entry) => entry.salesChannelId)
      .map((entry) => [entry.salesChannelId as string, entry])
  );

  const upsertPayload = desiredIds.map((salesChannelId) => {
    const existing = currentByChannel.get(salesChannelId);
    const id = existing?.id || randomUUID().replace(/-/g, "");
    return {
      id,
      productId,
      salesChannelId,
      visibility,
    };
  });

  const deletePayload = currentEntries
    .filter((entry) => entry.salesChannelId && !desiredIds.includes(entry.salesChannelId))
    .filter((entry) => entry.id)
    .map((entry) => ({ id: entry.id }));

  const syncPayload: Record<string, any> = {};
  if (upsertPayload.length > 0) {
    syncPayload["upsert-product-visibility"] = {
      entity: "product_visibility",
      action: "upsert",
      payload: upsertPayload,
    };
  }
  if (deletePayload.length > 0) {
    syncPayload["delete-product-visibility"] = {
      entity: "product_visibility",
      action: "delete",
      payload: deletePayload,
    };
  }

  if (Object.keys(syncPayload).length > 0) {
    const syncResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
      method: "POST",
      body: JSON.stringify(syncPayload),
    });

    if (syncResponse.ok) {
      return;
    }

    const syncError = await syncResponse.text();
    // Fallback to product PATCH with visibilities
    const patchResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/vnd.api+json",
      },
      body: JSON.stringify({
        data: {
          id: productId,
          type: "product",
          attributes: {
            visibilities: desiredIds.map((salesChannelId) => ({
              salesChannelId,
              visibility,
            })),
          },
        },
      }),
    });

    if (patchResponse.ok) {
      return;
    }

    const patchError = await patchResponse.text();
    throw new Error(
      `Failed to update product sales channels: Sync: ${syncResponse.statusText} - ${syncError} | JSON:API: ${patchResponse.statusText} - ${patchError}`
    );
  }
}

/**
 * Setzt/ändert die Sichtbarkeit je Verkaufskanal selektiv.
 * - upsert: visibility 10 | 20 | 30 (bestehende id wiederverwenden)
 * - remove: product_visibility-Eintrag löschen
 * - Kanäle ohne Eintrag in `changes` bleiben unverändert
 */
export async function applyProductVisibilityChanges(
  this: ShopwareClient,
  productId: string,
  changes: Array<{ salesChannelId: string; visibility: 10 | 20 | 30 } | { salesChannelId: string; remove: true }>,
): Promise<{ previous: Array<{ salesChannelId: string; visibility: number | null }> }> {
  if (!changes.length) {
    return { previous: [] };
  }

  let currentEntries: Array<{ id?: string; salesChannelId?: string; visibility?: number | null }> = [];
  try {
    const current = await this.searchEntity("product-visibility", {
      limit: 500,
      filter: [
        {
          type: "equals",
          field: "productId",
          value: productId,
        },
      ],
      includes: {
        product_visibility: ["id", "salesChannelId", "visibility"],
      },
    });
    currentEntries = (current?.data || []).map((entry: any) => ({
      id: entry?.id,
      salesChannelId: entry?.salesChannelId || entry?.attributes?.salesChannelId,
      visibility:
        entry?.visibility ??
        entry?.attributes?.visibility ??
        null,
    }));
  } catch (error) {
    console.warn("Failed to fetch existing product visibilities for applyProductVisibilityChanges:", error);
  }

  const currentByChannel = new Map(
    currentEntries
      .filter((entry) => entry.salesChannelId)
      .map((entry) => [entry.salesChannelId as string, entry]),
  );

  const previous = changes.map((change) => {
    const existing = currentByChannel.get(change.salesChannelId);
    return {
      salesChannelId: change.salesChannelId,
      visibility: existing?.visibility ?? null,
    };
  });

  const upsertPayload: Array<{
    id: string;
    productId: string;
    salesChannelId: string;
    visibility: number;
  }> = [];
  const deletePayload: Array<{ id: string }> = [];

  for (const change of changes) {
    const existing = currentByChannel.get(change.salesChannelId);
    if ("remove" in change && change.remove) {
      if (existing?.id) {
        deletePayload.push({ id: existing.id });
      }
      continue;
    }
    const visibility = (change as { visibility: 10 | 20 | 30 }).visibility;
    upsertPayload.push({
      id: existing?.id || randomUUID().replace(/-/g, ""),
      productId,
      salesChannelId: change.salesChannelId,
      visibility,
    });
  }

  const syncPayload: Record<string, any> = {};
  if (upsertPayload.length > 0) {
    syncPayload["upsert-product-visibility"] = {
      entity: "product_visibility",
      action: "upsert",
      payload: upsertPayload,
    };
  }
  if (deletePayload.length > 0) {
    syncPayload["delete-product-visibility"] = {
      entity: "product_visibility",
      action: "delete",
      payload: deletePayload,
    };
  }

  if (Object.keys(syncPayload).length === 0) {
    return { previous };
  }

  const syncResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
    method: "POST",
    body: JSON.stringify(syncPayload),
  });

  if (syncResponse.ok) {
    return { previous };
  }

  const syncError = await syncResponse.text();

  // Fallback: nur Upserts über Produkt-PATCH (Deletes nicht abgedeckt)
  if (upsertPayload.length > 0 && deletePayload.length === 0) {
    const patchResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/vnd.api+json",
      },
      body: JSON.stringify({
        data: {
          id: productId,
          type: "product",
          attributes: {
            visibilities: upsertPayload.map(({ salesChannelId, visibility }) => ({
              salesChannelId,
              visibility,
            })),
          },
        },
      }),
    });
    if (patchResponse.ok) {
      return { previous };
    }
    const patchError = await patchResponse.text();
    throw new Error(
      `Failed to apply product visibility changes: Sync: ${syncResponse.statusText} - ${syncError} | JSON:API: ${patchResponse.statusText} - ${patchError}`,
    );
  }

  throw new Error(
    `Failed to apply product visibility changes: Sync: ${syncResponse.statusText} - ${syncError}`,
  );
}

// Fetch catalog prices for multiple products in batch requests (chunked for API limits)
export async function fetchProductPricesBatch(this: ShopwareClient, productIds: string[]): Promise<Map<string, { grossPrice: number; netPrice: number }>> {
  try {
    if (productIds.length === 0) {
      return new Map();
    }

    console.log(`[fetchProductPricesBatch] Fetching catalog prices for ${productIds.length} unique products...`);

    // Chunk product IDs to avoid Shopware API limits (max 100 per request)
    const CHUNK_SIZE = 100;
    const chunks: string[][] = [];
    for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
      chunks.push(productIds.slice(i, i + CHUNK_SIZE));
    }

    const priceMap = new Map<string, { grossPrice: number; netPrice: number }>();

    // Process each chunk
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      console.log(`[fetchProductPricesBatch] Processing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} products)...`);

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: chunk.length,
          filter: [
            {
              type: 'equalsAny',
              field: 'id',
              value: chunk,
            },
          ],
          includes: {
            product: ['id', 'productNumber', 'price', 'tax', 'parentId'],
            tax: ['taxRate'],
          },
          associations: {
            tax: {},
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[fetchProductPricesBatch] Failed to fetch chunk ${chunkIndex + 1}: ${response.statusText} - ${errorText}`);
        continue; // Skip this chunk but continue with others
      }

      const data = await response.json();
      const products = data.data || [];
      const included = data.included || [];

      // Create a map of included entities for tax lookup
      const includedMap = new Map<string, any>();
      included.forEach((item: any) => {
        const key = `${item.type}-${item.id}`;
        includedMap.set(key, item);
      });

      products.forEach((product: any) => {
        // Extract tax rate
        let taxRate = 19; // Default VAT rate
        const taxId = product.taxId || product.attributes?.taxId;
        if (taxId) {
          const taxEntity = includedMap.get(`tax-${taxId}`);
          if (taxEntity) {
            taxRate = taxEntity.taxRate || taxEntity.attributes?.taxRate || 19;
          }
        }

        // Extract catalog price (gross)
        let grossPrice = 0;
        let netPrice = 0;

        if (product.price && Array.isArray(product.price)) {
          const eurPrice = product.price.find((p: any) => p.currencyId || true);
          if (eurPrice) {
            grossPrice = eurPrice.gross || 0;
            netPrice = eurPrice.net || 0;
            if (!netPrice && grossPrice) {
              netPrice = grossPrice / (1 + taxRate / 100);
            }
          }
        } else if (product.attributes?.price && Array.isArray(product.attributes.price)) {
          const eurPrice = product.attributes.price.find((p: any) => p.currencyId || true);
          if (eurPrice) {
            grossPrice = eurPrice.gross || 0;
            netPrice = eurPrice.net || 0;
            if (!netPrice && grossPrice) {
              netPrice = grossPrice / (1 + taxRate / 100);
            }
          }
        }

        if (grossPrice > 0) {
          priceMap.set(product.id, { grossPrice, netPrice });
          console.log(`[fetchProductPricesBatch] Product ${product.productNumber || product.id}: Catalog gross €${grossPrice.toFixed(2)}, net €${netPrice.toFixed(2)}`);
        } else {
          console.log(`[fetchProductPricesBatch] Product ${product.productNumber || product.id}: NO PRICE FOUND`);
        }
      });
    }

    console.log(`[fetchProductPricesBatch] ✓ Retrieved catalog prices for ${priceMap.size}/${productIds.length} products`);
    if (priceMap.size < productIds.length) {
      console.log(`[fetchProductPricesBatch] ⚠ Missing prices for ${productIds.length - priceMap.size} products`);
    }
    
    return priceMap;
  } catch (error) {
    console.error('[fetchProductPricesBatch] Error fetching product prices batch:', error);
    return new Map();
  }
}

/**
 * Fetch products by their product numbers for enrichment
 */
export async function fetchProductsByNumbers(this: ShopwareClient, productNumbers: string[]): Promise<Map<string, any>> {
  try {
    if (productNumbers.length === 0) {
      return new Map();
    }

    console.log(`[fetchProductsByNumbers] Fetching ${productNumbers.length} products...`);

    // Chunk product numbers to avoid API limits (25 per request)
    const CHUNK_SIZE = 25;
    const chunks: string[][] = [];
    for (let i = 0; i < productNumbers.length; i += CHUNK_SIZE) {
      chunks.push(productNumbers.slice(i, i + CHUNK_SIZE));
    }

    const productMap = new Map<string, any>();

    // Process each chunk
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      console.log(`[fetchProductsByNumbers] Processing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} products)...`);

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: chunk.length,
          filter: [
            {
              type: 'equalsAny',
              field: 'productNumber',
              value: chunk,
            },
          ],
          includes: {
            product: ['id', 'productNumber', 'name', 'manufacturerId', 'coverId', 'parentId'],
            media: ['id', 'url'],
            product_manufacturer: ['id', 'name'],
            property_group_option: ['name', 'group'],
            property_group: ['name'],
          },
          associations: {
            cover: {
              associations: {
                media: {},
              },
            },
            manufacturer: {},
            options: {
              associations: {
                group: {},
              },
            },
            properties: {
              associations: {
                group: {},
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[fetchProductsByNumbers] Failed to fetch chunk ${chunkIndex + 1}: ${response.statusText} - ${errorText}`);
        continue;
      }

      const data = await response.json();
      const products = data.data || [];

      const includedMap = new Map<string, any>();
      if (data.included) {
        data.included.forEach((item: any) => {
          includedMap.set(`${item.type}-${item.id}`, item);
        });
      }

      products.forEach((product: any) => {
        if (product.productNumber) {
          const options = mapShopwareOptionsForVariant(product, includedMap);
          const properties: Array<{ groupName: string; optionName: string }> = [];
          if (Array.isArray(product.properties)) {
            for (const prop of product.properties) {
              const groupName = prop.group?.name || prop.groupName || "";
              const optionName = prop.name || prop.optionName || "";
              if (groupName && optionName) properties.push({ groupName, optionName });
            }
          } else if (product.relationships?.properties?.data) {
            for (const propRef of product.relationships.properties.data) {
              const prop = includedMap.get(`property_group_option-${propRef.id}`);
              if (!prop) continue;
              const optionName = prop.attributes?.name || prop.name || "";
              let groupName = "";
              if (prop.group?.name) groupName = prop.group.name;
              else if (prop.relationships?.group?.data?.id) {
                const group = includedMap.get(`property_group-${prop.relationships.group.data.id}`);
                groupName = group?.attributes?.name || group?.name || "";
              }
              if (groupName && optionName) properties.push({ groupName, optionName });
            }
          }
          for (const opt of options) {
            if (!properties.some((p) => p.groupName === opt.group && p.optionName === opt.option)) {
              properties.push({ groupName: opt.group, optionName: opt.option });
            }
          }
          productMap.set(product.productNumber, {
            id: product.id,
            productNumber: product.productNumber,
            name: product.name || product.translated?.name,
            manufacturer: {
              name: product.manufacturer?.name || product.manufacturer?.translated?.name,
            },
            cover: {
              url: product.cover?.media?.url,
            },
            options,
            properties,
            parentId: product.parentId ?? null,
          });
        }
      });
    }

    console.log(`[fetchProductsByNumbers] ✓ Retrieved ${productMap.size}/${productNumbers.length} products`);
    if (productMap.size < productNumbers.length) {
      console.log(`[fetchProductsByNumbers] ⚠ Missing ${productNumbers.length - productMap.size} products`);
    }
    
    return productMap;
  } catch (error) {
    console.error('[fetchProductsByNumbers] Error fetching products by numbers:', error);
    return new Map();
  }
}

export async function fetchProductsByIds(
  this: ShopwareClient,
  productIds: string[],
): Promise<Map<string, { id: string; productNumber: string; name: string; coverImageUrl?: string }>> {
  try {
    if (productIds.length === 0) return new Map();

    const CHUNK_SIZE = 25;
    const chunks: string[][] = [];
    for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
      chunks.push(productIds.slice(i, i + CHUNK_SIZE));
    }

    const result = new Map<string, { id: string; productNumber: string; name: string; coverImageUrl?: string }>();

    for (const chunk of chunks) {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: chunk.length,
          ids: chunk,
          includes: {
            product: ["id", "productNumber", "name", "translated", "coverId"],
            media: ["id", "url"],
          },
          associations: {
            cover: {
              associations: {
                media: {},
              },
            },
          },
        }),
      });

      if (!response.ok) continue;

      const data = await response.json();
      for (const p of data.data || []) {
        const coverUrl = p.cover?.media?.url;
        result.set(p.id, {
          id: p.id,
          productNumber: p.productNumber || "",
          name: p.name || p.translated?.name || "",
          coverImageUrl: this.resolveMediaUrl(coverUrl || undefined) || undefined,
        });
      }
    }

    return result;
  } catch (error) {
    console.error("[fetchProductsByIds] Error:", error);
    return new Map();
  }
}
