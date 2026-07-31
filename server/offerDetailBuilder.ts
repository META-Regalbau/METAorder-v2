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
  /** Rohe CPQ ConfigContext (field_count/height/depth/width/level_count/...) fürs
   *  interaktive 3D+AR-Modell auf der öffentlichen Angebotsseite — nicht die
   *  Stückliste (die kommt über `children`), sondern die Maße zum Nachbauen. */
  cpqConfig?: Record<string, unknown> | null;
  /** true = synthetischer Gruppen-Kopf ("Überpunkt") einer Konfiguration; kein
   *  echtes Shopware-Lineitem, sondern Name/Beschreibung + `children` als
   *  vollständige Stückliste (inkl. der Position, die die Konfiguration trug). */
  isConfigurationGroup?: boolean;
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

  // Komponenten, die bereits als eigene, separat bepreiste Top-Level-Position im
  // Angebot stehen (z.B. bei CPQ-Angeboten, wo jede Stücklisten-Zeile ein echtes
  // Shopware-Lineitem ist) sollen nicht zusätzlich als (unbepreiste) "children"
  // unter der eingebetteten metaCalcConfigurationPayload auftauchen — sonst
  // erscheint jede Position doppelt (einmal echt, einmal informativ verschachtelt).
  const lineItemIndexByProductId = new Map<string, number>();
  allItems.forEach((item, idx) => {
    const linePid = item.productId || item.payload?.productId;
    if (linePid) lineItemIndexByProductId.set(String(linePid), idx);
  });
  const topLevelProductIds = new Set(lineItemIndexByProductId.keys());

  const lineItems: OfferDetailLineItem[] = allItems.map((item: any) => {
    const mcp = item.payload?.metaCalcConfigurationPayload;
    const rawPartsList = mcp?.partsList || [];
    const rawAccessoryList = mcp?.accessoryList || [];
    const bomEntries = [...rawPartsList, ...rawAccessoryList].filter(
      (part: any) => !part.productId || !topLevelProductIds.has(String(part.productId))
    );

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

  const draft = await storage.getOfferDraftByShopwareOfferId(offerId, tenantId ?? null);
  const rawCpq = draft?.extractedData && (draft.extractedData as { cpqSource?: unknown }).cpqSource;
  const cpq =
    rawCpq && typeof rawCpq === "object" ? (rawCpq as CpqSourceSnapshot) : undefined;

  const firstIdx = allItems.findIndex((item) => !isOfferShippingLineItem(item));
  const carrierProductId =
    firstIdx >= 0 ? String(allItems[firstIdx].productId || allItems[firstIdx].payload?.productId || "") : "";
  // Indizes real existierender Top-Level-Positionen, die weiter unten in die
  // Stückliste der Konfiguration gefaltet werden und daher aus der flachen
  // Liste entfernt werden (sonst erscheinen sie doppelt: einmal echt bepreist,
  // einmal informativ verschachtelt).
  const indicesFoldedIntoConfig = new Set<number>();

  const bomForFallback = cpq?.billOfMaterials?.items;
  // Zeilen der Stückliste ohne die "Trägerposition" selbst (die wird weiter unten
  // beim Umbau zum Konfigurations-Kopf automatisch zur ersten Stückliste-Zeile).
  const bomOthers = (bomForFallback || []).filter(
    (row) => !row.productId || String(row.productId) !== carrierProductId
  );
  // Wenn jede übrige Stücklisten-Zeile aus dem CPQ-Snapshot bereits eine eigene,
  // echte Top-Level-Position im Angebot ist (typischer CPQ-Fall: jede Komponente
  // wurde separat bepreist ins Angebot übernommen), werden diese Positionen mit
  // ihren echten Preisen in die Stückliste gefaltet statt informativ dupliziert.
  const bomAlreadyTopLevel =
    bomOthers.length > 0 && bomOthers.every((row) => !row.productId || topLevelProductIds.has(String(row.productId)));

  if (firstIdx >= 0 && firstIdx < lineItems.length && bomForFallback?.length) {
    if (bomAlreadyTopLevel) {
      const children: OfferDetailLineItemChild[] = [];
      for (const row of bomOthers) {
        const pid = row.productId ? String(row.productId) : "";
        const idx = pid ? lineItemIndexByProductId.get(pid) : undefined;
        if (idx === undefined) continue;
        const li = lineItems[idx]!;
        children.push({
          id: li.id,
          label: li.label,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          totalPrice: li.totalPrice,
          productNumber: li.productNumber,
          coverImageUrl: li.coverImageUrl,
        });
        indicesFoldedIntoConfig.add(idx);
      }
      const prev = lineItems[firstIdx]!;
      lineItems[firstIdx] = {
        ...prev,
        configurationName: prev.configurationName || "CPQ Regalkonfiguration",
        configurationDescription:
          prev.configurationDescription || "Stückliste aus dem CPQ-Konfigurator.",
        children,
        cpqConfig: cpq?.config ?? null,
      };
    } else {
      let needFetch = false;
      for (const row of bomOthers) {
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

      const children: OfferDetailLineItemChild[] = bomOthers.map((row) => {
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
        cpqConfig: cpq?.config ?? null,
      };
    }
  } else if (firstIdx >= 0 && firstIdx < lineItems.length && cpq?.config) {
    // Bereits konvertiertes Angebot ohne (neue) Stücklisten-Info: Shopware liefert
    // die Stückliste ggf. schon selbst über metaCalcConfigurationPayload, aber
    // nicht die rohe ConfigContext für den 3D+AR-Viewer — die kommt nur aus dem
    // Draft-Snapshot.
    lineItems[firstIdx] = { ...lineItems[firstIdx]!, cpqConfig: cpq.config };
  }

  // Jede Position, die eine "Konfiguration" trägt (Name/Beschreibung/3D-Config/
  // Stückliste), wird zu einem Überpunkt: die Trägerposition selbst wird zur
  // ersten Stückliste-Zeile (mit ihrem echten Preis), der Überpunkt zeigt nur
  // noch Name + Beschreibung + Gesamtsumme der Stückliste.
  const finalLineItems: OfferDetailLineItem[] = [];
  lineItems.forEach((li, idx) => {
    if (indicesFoldedIntoConfig.has(idx)) return; // bereits in eine Stückliste gefaltet
    const isConfiguration = !!(
      li.configurationName ||
      li.configurationDescription ||
      li.cpqConfig ||
      (li.children && li.children.length > 0)
    );
    if (!isConfiguration) {
      finalLineItems.push(li);
      return;
    }
    const selfChild: OfferDetailLineItemChild = {
      id: li.id,
      label: li.label,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      totalPrice: li.totalPrice,
      productNumber: li.productNumber,
      coverImageUrl: li.coverImageUrl,
    };
    const children = [selfChild, ...(li.children || [])];
    const totalPrice = children.reduce((sum, c) => sum + (c.totalPrice || 0), 0);
    finalLineItems.push({
      id: `${li.id}__config`,
      label: li.configurationName || "Konfiguration",
      quantity: 1,
      unitPrice: totalPrice,
      totalPrice,
      taxRate: li.taxRate,
      productNumber: null,
      configurationName: li.configurationName || null,
      configurationDescription: li.configurationDescription || null,
      coverImageUrl: li.coverImageUrl,
      cpqConfig: li.cpqConfig,
      isConfigurationGroup: true,
      children,
    });
  });

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
    lineItems: finalLineItems,
  };
}
