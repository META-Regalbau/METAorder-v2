import type { IStorage } from "./storage";
import { B2BSellersClient } from "./b2bSellersClient";
import { ShopwareClient } from "./shopware";
import type { CpqSourceSnapshot } from "./cpq/cpqMetaCalcPayload";
import { extractRoomPlannableConfigurations, type CpqRoomRotationDeg, type RoomFootprintMm } from "./cpq/cpqRoomPlanner";
import { productCacheRegistry } from "./productCache";
import { isServiceProductId } from "./offerServiceProducts";
import { resolveOfferCustomerDetails } from "./offerConfigPdfBuilder";
import type { CpqRoomWallFeature, OrderAddress } from "@shared/schema";

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

/** Raumplanung fürs Angebotsdetail (Admin + interaktive öffentliche Angebotsseite). */
export type OfferDetailRoomPlan = {
  name: string | null;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  placements: Array<{ configKey: string; xMm: number; yMm: number; rotationDeg: CpqRoomRotationDeg }>;
  configurations: Array<{ configKey: string; footprint: RoomFootprintMm; cpqConfig: Record<string, unknown> }>;
  wallFeatures: CpqRoomWallFeature[];
};

export type OfferDetailJson = {
  id: string;
  offerNumber: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null | undefined;
  /** Shopware-Kundennummer, falls aus Angebot/Kunde ermittelbar */
  customerNumber: string | null;
  /** Vollständige Rechnungs-/Standardadresse für die Detailansicht */
  billingAddress: OrderAddress | null;
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
  /** Raumplanung, falls für dieses Angebot ein Raum-Layout mit Platzierungen existiert. */
  roomPlan?: OfferDetailRoomPlan | null;
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

  // Zusatzleistungen (Montage, Gabelstapler, Fixtermin, ...) sollen immer als letzte
  // Positionen erscheinen — Erkennung über den Produktkatalog-Cache (Customfield
  // wdu_service_type), optional: schlägt die Cache-Befüllung fehl, bleibt die
  // Shopware-Ursprungsreihenfolge unverändert statt das Angebotsdetail zu blockieren.
  const productCache = productCacheRegistry.for(tenantId ?? null);
  try {
    await productCache.ensurePopulated(new ShopwareClient(settings));
  } catch {
    /* nicht kritisch, siehe Kommentar oben */
  }

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

  // Mehrfachvorkommen je Produkt-ID zulassen (dasselbe Produkt kann in mehreren
  // Konfigurationen desselben Angebots als jeweils eigene Top-Level-Position stehen).
  const indicesByProductId = new Map<string, number[]>();
  allItems.forEach((item, idx) => {
    const linePid = item.productId || item.payload?.productId;
    if (linePid) {
      const key = String(linePid);
      const arr = indicesByProductId.get(key) ?? [];
      arr.push(idx);
      indicesByProductId.set(key, arr);
    }
  });

  // Eigene Konfigurations-"Köpfe" (Positionen mit eigener metaCalcConfigurationPayload)
  // dürfen nie als "Kind" einer ANDEREN Konfiguration eingesammelt werden — sonst
  // verschwindet deren gesamte Gruppe (Kopf gilt dann fälschlich als "bereits gefaltet").
  const headIndices = new Set<number>();
  allItems.forEach((item, idx) => {
    if (item.payload?.metaCalcConfigurationPayload) headIndices.add(idx);
  });

  // Positionen, die bereits als eigene, separat bepreiste Top-Level-Position im Angebot
  // stehen (typischer CPQ-Fall, jede Stücklisten-Zeile ist ein echtes Shopware-Lineitem)
  // werden ihrer Konfigurationsgruppe zugeordnet ("geclaimt") statt zusätzlich als
  // unbepreiste "children" zu erscheinen — sonst doppelt (einmal echt, einmal informativ).
  // Ein Claim ist pro Index einmalig, damit gleiche Produkte über mehrere Konfigurationen
  // hinweg korrekt getrennt bleiben (nicht alle derselben Gruppe zugeschlagen werden).
  const claimedIndices = new Set<number>();
  const claimRealIndexForProduct = (productId: string, headIdx: number): number | undefined => {
    const candidates = indicesByProductId.get(productId);
    if (!candidates) return undefined;
    for (const idx of candidates) {
      if (idx === headIdx || claimedIndices.has(idx) || headIndices.has(idx)) continue;
      claimedIndices.add(idx);
      return idx;
    }
    return undefined;
  };

  const lineItems: OfferDetailLineItem[] = allItems.map((item: any, itemIdx: number) => {
    const mcp = item.payload?.metaCalcConfigurationPayload;
    const rawPartsList = mcp?.partsList || [];
    const rawAccessoryList = mcp?.accessoryList || [];
    const ownProductId = item.productId || item.payload?.productId;
    // Die Kopf-Position selbst taucht i. d. R. auch als eigene Zeile in ihrer eigenen
    // Stückliste auf — deren echter Preis kommt schon über "selfChild" weiter unten,
    // hier ausfiltern statt einer doppelten 0€-Zeile.
    const bomEntries = [...rawPartsList, ...rawAccessoryList].filter(
      (part: any) => !ownProductId || !part.productId || String(part.productId) !== String(ownProductId)
    );

    const children = bomEntries.map((part: any) => {
      const pid = part.productId ? String(part.productId) : "";
      if (pid) {
        const realIdx = claimRealIndexForProduct(pid, itemIdx);
        if (realIdx !== undefined) {
          const real = allItems[realIdx];
          const resolved = productLookup.get(pid);
          return {
            id: real.id || real.identifier || pid,
            label: real.label || real.name || real.productName || resolved?.name || part.description || "Position",
            quantity: real.quantity || part.quantity || 0,
            unitPrice: real.unitPrice || real.price || 0,
            totalPrice: real.totalPrice || real.total || 0,
            productNumber: real.productNumber || resolved?.productNumber || null,
            coverImageUrl: resolved?.coverImageUrl || null,
          };
        }
      }
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
    const embeddedCpqConfig =
      item.payload?.metaCalcCpqConfig && typeof item.payload.metaCalcCpqConfig === "object"
        ? (item.payload.metaCalcCpqConfig as Record<string, unknown>)
        : null;

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
      cpqConfig: embeddedCpqConfig,
      children,
    };
  });

  const indicesFoldedIntoConfig = claimedIndices;

  // Legacy-Fallback: Angebote, die vor der direkten Payload-Einbettung der ConfigContext
  // (metaCalcCpqConfig) erstellt wurden, haben diese nur im (einmaligen) Angebotsentwurf
  // gespeichert. Nur als 3D+AR-Viewer-Datenquelle nachrüsten — Stückliste/Preise werden
  // oben bereits vollständig aus den echten Positionen aufgelöst, unabhängig davon.
  //
  // Wichtig: an der ERSTEN Konfigurations-Kopfposition OHNE eigenes cpqConfig ansetzen —
  // nicht erst, wenn GAR KEINE Position eins hat. Sonst verschwindet die 3D-Ansicht einer
  // alten (legacy) Konfiguration wieder, sobald diesem Angebot eine neuere, bereits mit
  // eingebettetem cpqConfig angelegte Konfiguration hinzugefügt wird (deren cpqConfig lässt
  // die alte "es hat ja schon jemand eins"-Bedingung fälschlich greifen). Der Angebotsentwurf
  // speichert aber nur EINE cpqSource pro Angebot — bei mehreren alten Konfigurationen im
  // selben Angebot kann nur die erste davon auf diesem Weg wiederhergestellt werden; für
  // weitere alte Konfigurationen fehlen die Maße unwiederbringlich.
  const missingCpqConfigIdx = lineItems.findIndex(
    (li) => !li.cpqConfig && (li.configurationName || li.configurationDescription || (li.children && li.children.length > 0)),
  );
  if (missingCpqConfigIdx >= 0) {
    const draft = await storage.getOfferDraftByShopwareOfferId(offerId, tenantId ?? null);
    const rawCpq = draft?.extractedData && (draft.extractedData as { cpqSource?: unknown }).cpqSource;
    const cpq = rawCpq && typeof rawCpq === "object" ? (rawCpq as CpqSourceSnapshot) : undefined;
    if (cpq?.config) {
      lineItems[missingCpqConfigIdx] = { ...lineItems[missingCpqConfigIdx]!, cpqConfig: cpq.config };
    }
  }

  // Jede Position, die eine "Konfiguration" trägt (Name/Beschreibung/3D-Config/
  // Stückliste), wird zu einem Überpunkt: die Trägerposition selbst wird zur
  // ersten Stückliste-Zeile (mit ihrem echten Preis), der Überpunkt zeigt nur
  // noch Name + Beschreibung + Gesamtsumme der Stückliste.
  const finalEntries: Array<{ item: OfferDetailLineItem; isService: boolean }> = [];
  lineItems.forEach((li, idx) => {
    if (indicesFoldedIntoConfig.has(idx)) return; // bereits in eine Stückliste gefaltet
    const isConfiguration = !!(
      li.configurationName ||
      li.configurationDescription ||
      li.cpqConfig ||
      (li.children && li.children.length > 0)
    );
    if (!isConfiguration) {
      const rawItem = allItems[idx];
      const rawProductId = rawItem?.productId || rawItem?.payload?.productId;
      finalEntries.push({ item: li, isService: isServiceProductId(productCache, rawProductId) });
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
    finalEntries.push({
      item: {
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
      },
      isService: false, // eine CPQ-Konfigurationsgruppe ist nie selbst eine Zusatzleistung
    });
  });

  // Zusatzleistungen (Montage, Gabelstapler, Fixtermin, ...) immer als letzte Positionen —
  // stabile Sortierung, damit die sonstige (Shopware-Ursprungs-)Reihenfolge erhalten bleibt.
  finalEntries.sort((a, b) => Number(a.isService) - Number(b.isService));
  const finalLineItems: OfferDetailLineItem[] = finalEntries.map((e) => e.item);

  let roomPlan: OfferDetailRoomPlan | null = null;
  try {
    const roomLayout = await storage.getCpqRoomLayoutByOfferId(offerId, tenantId ?? null);
    if (roomLayout && roomLayout.placements.length > 0) {
      const plannable = extractRoomPlannableConfigurations(finalLineItems);
      const plannableByKey = new Map(plannable.map((c) => [c.configKey, c]));
      const placements = roomLayout.placements.filter((p) => plannableByKey.has(p.configKey));
      if (placements.length > 0) {
        roomPlan = {
          name: roomLayout.name,
          lengthMm: roomLayout.lengthMm,
          widthMm: roomLayout.widthMm,
          heightMm: roomLayout.heightMm,
          placements,
          configurations: placements.map((p) => {
            const c = plannableByKey.get(p.configKey)!;
            return { configKey: c.configKey, footprint: c.footprint, cpqConfig: c.cpqConfig };
          }),
          wallFeatures: roomLayout.wallFeatures ?? [],
        };
      }
    }
  } catch {
    /* Raumplanung ist optional fürs Angebotsdetail — darf die Antwort nicht blockieren. */
  }

  // Vollständige Kundeninformationen (Adresse + Kundennummer) — dieselbe Auflösung wie im
  // Angebots-PDF: bevorzugt die im Angebot eingebettete Snapshot-Adresse, sonst live aus
  // Shopware nachgeladen.
  let customerNumber: string | null = null;
  let billingAddress: OrderAddress | null = null;
  try {
    const resolved = await resolveOfferCustomerDetails(rawOffer.data, mapped, settings);
    customerNumber = resolved.customerNumber ?? null;
    billingAddress = resolved.billingAddress ?? null;
  } catch {
    /* optional, blockiert das Angebotsdetail nicht */
  }

  return {
    id: mapped.id,
    offerNumber: mapped.offerNumber,
    customerId: mapped.customerId || null,
    customerName: mapped.customerName || null,
    customerEmail: mapped.customerEmail || null,
    customerPhone: billingAddress?.phoneNumber || mapped.customerPhone || null,
    customerNumber,
    billingAddress,
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
    roomPlan,
  };
}
