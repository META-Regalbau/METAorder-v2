import type { IStorage } from "./storage";
import { B2BSellersClient } from "./b2bSellersClient";
import { ShopwareClient } from "./shopware";
import { isOfferShippingLineItem, type CpqSourceSnapshot } from "./cpq/cpqMetaCalcPayload";

export type OfferDetailLineItemChild = {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  productNumber: string | null;
  /** Shopware-Produktbild (Cover), falls verfügbar */
  coverImageUrl?: string | null;
};

export type OfferDetailLineItem = {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxRate: number;
  productNumber: string | null;
  configurationName?: string | null;
  configurationDescription?: string | null;
  coverImageUrl?: string | null;
  children?: OfferDetailLineItemChild[];
};

export type OfferDetailJson = {
  id: string;
  offerNumber: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null | undefined;
  totalAmount: number;
  netAmount: number;
  status: string;
  statusId: string | null;
  statusLabel: string | null;
  createdAt: string | null;
  expirationDate: string | null;
  salesChannelId: string | null;
  salesChannelName: string | null;
  lineItems: OfferDetailLineItem[];
};

/**
 * Baut die Angebots-Detail-Antwort (wie GET /api/offers/:id) für einen Tenant.
 */
export async function buildOfferDetailJson(
  storage: IStorage,
  offerId: string,
  tenantId?: string | null
): Promise<OfferDetailJson> {
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) {
    throw new Error("Shopware settings not configured");
  }

  const statusMapping = await storage.getSetting("b2b.offerStatusMapping", tenantId);
  const client = new B2BSellersClient(settings, { statusMapping });
  const rawOffer = await client.fetchOfferById(offerId);
  const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);

  const allItems: any[] = mapped.items || [];

  const bomProductIds = new Set<string>();
  for (const item of allItems) {
    const linePid = item.productId || item.payload?.productId;
    if (linePid) bomProductIds.add(String(linePid));
    const mcp = item.payload?.metaCalcConfigurationPayload;
    for (const part of [...(mcp?.partsList || []), ...(mcp?.accessoryList || [])]) {
      if (part.productId) bomProductIds.add(String(part.productId));
    }
  }

  let productLookup = new Map<
    string,
    { id: string; productNumber: string; name: string; coverImageUrl?: string }
  >();
  if (bomProductIds.size > 0) {
    try {
      const shopwareClient = new ShopwareClient(settings);
      productLookup = await shopwareClient.fetchProductsByIds(Array.from(bomProductIds));
    } catch (err) {
      console.warn("[buildOfferDetailJson] Failed to resolve BOM product IDs:", err);
    }
  }

  const lineItems: OfferDetailLineItem[] = allItems.map((item: any) => {
    const mcp = item.payload?.metaCalcConfigurationPayload;
    const rawPartsList = mcp?.partsList || [];
    const rawAccessoryList = mcp?.accessoryList || [];
    const bomEntries = [...rawPartsList, ...rawAccessoryList];

    const children = bomEntries.map((part: any) => {
      const pid = part.productId ? String(part.productId) : "";
      const resolved = pid ? productLookup.get(pid) : undefined;
      return {
        id: part.productId || "part",
        label: resolved?.name || part.description || part.productId || "Position",
        quantity: part.quantity || 0,
        unitPrice: 0,
        totalPrice: 0,
        productNumber: resolved?.productNumber || null,
        coverImageUrl: resolved?.coverImageUrl || null,
      };
    });

    const configDescription = mcp?.description
      ? String(mcp.description).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
      : null;

    const linePid = item.productId || item.payload?.productId;
    const lineResolved = linePid ? productLookup.get(String(linePid)) : undefined;

    return {
      id: item.id || item.identifier || item.productId || "item",
      label: item.label || item.name || item.productName || "Position",
      quantity: item.quantity || 0,
      unitPrice: item.unitPrice || item.price || 0,
      totalPrice: item.totalPrice || item.total || 0,
      taxRate: item.taxRate || item.price?.taxRules?.[0]?.taxRate || 0,
      productNumber: item.productNumber || item.payload?.productNumber || lineResolved?.productNumber || null,
      configurationName: item.payload?.metaCalcConfigurationName || null,
      configurationDescription: configDescription,
      coverImageUrl: lineResolved?.coverImageUrl || null,
      children,
    };
  });

  const hasStructuredBom = lineItems.some((li) => (li.children?.length ?? 0) > 0);
  if (!hasStructuredBom) {
    const draft = await storage.getOfferDraftByShopwareOfferId(offerId, tenantId ?? null);
    const rawCpq = draft?.extractedData && (draft.extractedData as { cpqSource?: unknown }).cpqSource;
    const cpq =
      rawCpq && typeof rawCpq === "object"
        ? (rawCpq as CpqSourceSnapshot)
        : undefined;
    const bom = cpq?.billOfMaterials?.items;
    if (bom?.length) {
      let needFetch = false;
      for (const row of bom) {
        if (row.productId && !productLookup.has(String(row.productId))) {
          bomProductIds.add(String(row.productId));
          needFetch = true;
        }
      }
      if (needFetch && bomProductIds.size > 0) {
        try {
          const shopwareClient = new ShopwareClient(settings);
          const extra = await shopwareClient.fetchProductsByIds(Array.from(bomProductIds));
          for (const [k, v] of extra) productLookup.set(k, v);
        } catch (err) {
          console.warn("[buildOfferDetailJson] CPQ BOM product fetch failed:", err);
        }
      }

      const firstIdx = allItems.findIndex((item) => !isOfferShippingLineItem(item));
      if (firstIdx >= 0 && firstIdx < lineItems.length) {
        const children: OfferDetailLineItemChild[] = bom.map((row) => {
          const pid = String(row.productId);
          const resolved = productLookup.get(pid);
          return {
            id: pid,
            label: resolved?.name || row.name || row.productNumber || "Position",
            quantity: row.quantity || 0,
            unitPrice: 0,
            totalPrice: 0,
            productNumber: resolved?.productNumber ?? row.productNumber ?? null,
            coverImageUrl: resolved?.coverImageUrl ?? null,
          };
        });
        const prev = lineItems[firstIdx]!;
        lineItems[firstIdx] = {
          ...prev,
          configurationName: prev.configurationName || "CPQ Regalkonfiguration",
          configurationDescription:
            prev.configurationDescription || "Stückliste aus dem CPQ-Konfigurator.",
          children,
        };
      }
    }
  }

  return {
    id: mapped.id,
    offerNumber: mapped.offerNumber,
    customerId: mapped.customerId || null,
    customerName: mapped.customerName || null,
    customerEmail: mapped.customerEmail || null,
    customerPhone: undefined,
    totalAmount: mapped.totalPrice,
    netAmount: mapped.netPrice,
    status: mapped.status,
    statusId: mapped.statusId || null,
    statusLabel: mapped.statusLabel || null,
    createdAt: mapped.createdAt || null,
    expirationDate: mapped.offerExpiration || null,
    salesChannelId: mapped.salesChannelId || null,
    salesChannelName: mapped.salesChannelName || null,
    lineItems,
  };
}
