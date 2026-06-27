/**
 * Baut OfferConfigPdfInput aus Shopware/B2B-Rohdaten (MetaCalc, Versand, Montage).
 */

import type { OrderAddress, ShopwareSettings } from "@shared/schema";
import { ShopwareClient } from "./shopware";
import type { OfferConfigPdfInput, OfferConfigPdfLineItem } from "./offerConfigPdf";

function mergeOfferBillingAddress(
  primary: OrderAddress | undefined,
  fill: OrderAddress,
): OrderAddress {
  const p = primary;
  return {
    firstName: (p?.firstName || fill.firstName || "").trim(),
    lastName: (p?.lastName || fill.lastName || "").trim(),
    street: (p?.street || fill.street || "").trim(),
    zipCode: (p?.zipCode || fill.zipCode || "").trim(),
    city: (p?.city || fill.city || "").trim(),
    country: (p?.country || fill.country || "").trim(),
    company: (p?.company || fill.company)?.trim() || undefined,
    phoneNumber: (p?.phoneNumber || fill.phoneNumber)?.trim() || undefined,
  };
}

function isShippingLineItem(item: any): boolean {
  const t = String(item?.type || "").toLowerCase();
  return t === "shipping" || t === "delivery" || t === "shipping_charge";
}

/** Versand: zuerst LineItems, sonst price.shippingCosts o.ä. */
export function extractShippingCosts(raw: any, lineItems: any[]): { net: number; gross: number } {
  const shippingLines = lineItems.filter(isShippingLineItem);
  let net = 0;
  if (shippingLines.length > 0) {
    for (const s of shippingLines) {
      net += Number(s.totalPrice ?? s.price?.totalPrice ?? 0);
    }
    return { net, gross: net };
  }

  const price = raw?.price ?? raw?.attributes?.price;
  const sc = price?.shippingCosts;
  if (Array.isArray(sc)) {
    for (const el of sc) {
      net += Number(
        el?.calculatedPrice?.totalPrice ?? el?.totalPrice ?? el?.price?.totalPrice ?? el?.price ?? 0,
      );
    }
  } else if (sc && typeof sc === "object") {
    net = Number(sc.totalPrice ?? sc.price ?? sc.calculatedPrice?.totalPrice ?? 0);
  }
  if (net === 0 && price?.shippingTotal != null) {
    net = Number(price.shippingTotal);
  }
  if (net === 0 && price?.shippingPrice != null) {
    net = Number(price.shippingPrice);
  }
  return { net, gross: net };
}

export function sumMetaCalcInstallationMinutes(items: any[]): number {
  let sum = 0;
  for (const item of items) {
    const mcp = item.payload?.metaCalcConfigurationPayload;
    if (!mcp) continue;
    const fromPayload = Number(
      item.payload?.metaCalcInstallationTime ?? mcp.installationTime ?? mcp.installationTimeMinutes ?? 0,
    );
    if (Number.isFinite(fromPayload) && fromPayload > 0) sum += fromPayload;
  }
  return sum;
}

/** Minimum 1 Tag = 2×3h-Blöcke, je Block 725 EUR netto (auch bei 0 min reiner Montagezeit: An-/Abfahrt). */
export function computeMontageNet(installationMinutes: number): { net: number; description: string } {
  const installationHours = Math.max(0, installationMinutes) / 60;
  const totalHours = installationHours + 2;
  let blocks = Math.ceil(totalHours / 3);
  blocks = Math.max(blocks, 2);
  const net = blocks * 725;
  const dayParts = blocks / 2;
  const minsLabel = installationMinutes > 0 ? `, ${Math.round(installationMinutes)} min Montage` : "";
  const description = `${dayParts} Tag(e) (${blocks}×3h inkl. An-/Abfahrt${minsLabel})`;
  return { net, description };
}

function stripHtmlToText(html: string): string {
  return String(html)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function hasMetaCalcConfig(item: any): boolean {
  return !!item.payload?.metaCalcConfigurationPayload;
}

/** Eingebettete b2bsellers_offer_address (raw.attributes.billingAddress) → OrderAddress. */
function mapEmbeddedOfferAddress(addr: any): OrderAddress | undefined {
  if (!addr || typeof addr !== "object") return undefined;
  const street = String(addr.street ?? "").trim();
  const zip = String(addr.zipcode ?? addr.zipCode ?? "").trim();
  const city = String(addr.city ?? "").trim();
  if (!street && !zip && !city) return undefined;
  const country =
    String(addr.country?.iso ?? addr.country?.name ?? addr.countryName ?? "").trim() || "";
  return {
    firstName: String(addr.firstName ?? "").trim(),
    lastName: String(addr.lastName ?? "").trim(),
    street,
    zipCode: zip,
    city,
    country,
    company: String(addr.company ?? "").trim() || undefined,
    phoneNumber: String(addr.phoneNumber ?? "").trim() || undefined,
  };
}

/** Kundennummer + Rechnungsadresse aus Shopware nachladen, falls im gemappten Angebot unvollständig. */
async function enrichCustomerForPdf(
  mappedOffer: {
    customerId?: string;
    customerNumber?: string;
    billingAddress?: OrderAddress;
  },
  settings: ShopwareSettings,
): Promise<{ customerNumber?: string; billingAddress?: OrderAddress }> {
  let customerNumber = mappedOffer.customerNumber?.trim() || undefined;
  let billingAddress = mappedOffer.billingAddress;
  const cid = (mappedOffer.customerId || "").trim();
  const needsShopware =
    !!cid &&
    (!customerNumber ||
      !billingAddress ||
      !String(billingAddress.street || "").trim() ||
      (!String(billingAddress.zipCode || "").trim() && !String(billingAddress.city || "").trim()));
  if (needsShopware) {
    try {
      const shopwareClient = new ShopwareClient(settings);
      const snap = await shopwareClient.fetchCustomerBillingForPdf(cid);
      if (snap) {
        if (!customerNumber && snap.customerNumber) customerNumber = snap.customerNumber;
        if (snap.billingAddress) {
          billingAddress = billingAddress
            ? mergeOfferBillingAddress(billingAddress, snap.billingAddress)
            : snap.billingAddress;
        }
      }
    } catch {
      /* optional enrichment */
    }
  }
  return { customerNumber, billingAddress };
}

/**
 * Baut OfferConfigPdfInput für ein normales B2B-Angebot (ohne MetaCalc-Konfiguration).
 * Rendert Kopf, Empfängeradresse, Positionsübersicht und Summen (Netto/USt./Brutto).
 * Versand wird aus dem Angebot übernommen; Montage entfällt (0).
 */
export async function buildPlainOfferPdfInput(
  rawOfferData: any,
  mappedOffer: {
    offerNumber: string;
    customerId?: string;
    customerName?: string;
    customerEmail?: string;
    customerNumber?: string;
    billingAddress?: OrderAddress;
    totalPrice: number;
    netPrice: number;
    createdAt: string;
    offerExpiration: string;
    items?: any[];
  },
  settings: ShopwareSettings,
): Promise<OfferConfigPdfInput> {
  const allItems: any[] = mappedOffer.items || [];
  const productLines = allItems.filter((it) => !isShippingLineItem(it));

  // Steuersatz: zuerst gespeicherte Angebotspreise, dann Positions-Satz, sonst aus Netto/Brutto ableiten.
  const offerPrice = rawOfferData?.price ?? rawOfferData?.attributes?.price;
  const offerStoredRate = Number(
    offerPrice?.calculatedTaxes?.[0]?.taxRate ?? offerPrice?.taxRules?.[0]?.taxRate ?? 0,
  );
  const itemRate =
    Number(productLines.find((it) => Number(it.taxRate) > 0)?.taxRate) ||
    Number(allItems.find((it) => Number(it.taxRate) > 0)?.taxRate) ||
    0;
  const net = Number(mappedOffer.netPrice ?? 0);
  const gross = Number(mappedOffer.totalPrice ?? 0);
  const derivedRate =
    net > 0 && gross > net ? Math.round(((gross - net) / net) * 1000) / 10 : 0;
  const displayTaxRate = offerStoredRate || itemRate || derivedRate || 19;
  const rate = displayTaxRate / 100;

  const { net: shippingNet } = extractShippingCosts(rawOfferData, allItems);
  const shippingGross = shippingNet * (1 + rate);

  const productsNetSubtotal = productLines.reduce(
    (s, it) => s + Number(it.totalPrice ?? it.price?.totalPrice ?? 0),
    0,
  );

  const netBeforeVat = productsNetSubtotal + shippingNet;
  const vatAmount = netBeforeVat * rate;
  const grossTotal = netBeforeVat + vatAmount;

  const lineItems: OfferConfigPdfLineItem[] = productLines.map((item: any) => ({
    label: item.label || item.name || item.productName || "Position",
    productNumber: item.productNumber || item.payload?.productNumber || null,
    quantity: item.quantity || 0,
    unitPrice: Number(item.unitPrice ?? item.price ?? 0),
    totalPrice: Number(item.totalPrice ?? item.total ?? 0),
    taxRate: Number(item.taxRate ?? item.price?.taxRules?.[0]?.taxRate ?? 0) || displayTaxRate,
  }));

  // Echte Shopware-Kunden-ID (Snapshot-offerCustomer), nicht die offerCustomerId.
  const rawAttrs = rawOfferData?.attributes ?? rawOfferData ?? {};
  const realCustomerId =
    String(rawAttrs?.offerCustomer?.customerId ?? "").trim() || mappedOffer.customerId;
  // Eigene Angebotsadresse bevorzugen (enthält Straße/PLZ/Ort), sonst gemappte Adresse.
  const embeddedBilling = mapEmbeddedOfferAddress(rawAttrs?.billingAddress);

  let customerNumber: string | undefined;
  let billingAddress: OrderAddress | undefined;
  if (embeddedBilling) {
    customerNumber = mappedOffer.customerNumber?.trim() || undefined;
    billingAddress = embeddedBilling;
  } else {
    const enriched = await enrichCustomerForPdf(
      { ...mappedOffer, customerId: realCustomerId },
      settings,
    );
    customerNumber = enriched.customerNumber;
    billingAddress = enriched.billingAddress;
  }

  return {
    offerNumber: mappedOffer.offerNumber,
    customerName: mappedOffer.customerName || "—",
    customerEmail: mappedOffer.customerEmail,
    customerNumber,
    billingAddress,
    createdAt: mappedOffer.createdAt,
    expirationDate: mappedOffer.offerExpiration || undefined,
    productsNetSubtotal,
    shippingCostsNet: shippingNet,
    shippingCostsGross: shippingGross,
    montageCostNet: 0,
    montageCostGross: 0,
    montageDescription: "",
    vatAmount,
    grossTotal,
    displayTaxRate,
    lineItems,
  };
}

export async function buildOfferConfigPdfInput(
  rawOfferData: any,
  mappedOffer: {
    offerNumber: string;
    customerId?: string;
    customerName?: string;
    customerEmail?: string;
    customerNumber?: string;
    billingAddress?: OrderAddress;
    totalPrice: number;
    netPrice: number;
    createdAt: string;
    offerExpiration: string;
    items?: any[];
  },
  settings: ShopwareSettings,
): Promise<OfferConfigPdfInput | null> {
  const allItems: any[] = mappedOffer.items || [];
  const hasAnyConfig = allItems.some(hasMetaCalcConfig);
  if (!hasAnyConfig) return null;

  const bomProductIds = new Set<string>();
  for (const item of allItems) {
    const mcp = item.payload?.metaCalcConfigurationPayload;
    for (const part of [...(mcp?.partsList || []), ...(mcp?.accessoryList || [])]) {
      if (part.productId) bomProductIds.add(part.productId);
    }
  }

  let productLookup = new Map<string, { id: string; productNumber: string; name: string }>();
  if (bomProductIds.size > 0) {
    try {
      const shopwareClient = new ShopwareClient(settings);
      productLookup = await shopwareClient.fetchProductsByIds(Array.from(bomProductIds));
    } catch {
      /* leer */
    }
  }

  const productLines = allItems.filter((it) => !isShippingLineItem(it));
  const displayTaxRate =
    Number(productLines.find((it) => Number(it.taxRate) > 0)?.taxRate) ||
    Number(allItems.find((it) => Number(it.taxRate) > 0)?.taxRate) ||
    19;

  const rate = displayTaxRate / 100;
  const netToGross = (net: number) => net * (1 + rate);

  const { net: shippingNet } = extractShippingCosts(rawOfferData, allItems);
  const shippingGross = netToGross(shippingNet);

  const installMins = sumMetaCalcInstallationMinutes(allItems);
  const { net: montageNet, description: montageDescription } = computeMontageNet(installMins);
  const montageGross = netToGross(montageNet);

  const productsNetSubtotal = productLines.reduce(
    (s, it) => s + Number(it.totalPrice ?? it.price?.totalPrice ?? 0),
    0,
  );

  const netBeforeVat = productsNetSubtotal + shippingNet + montageNet;
  const vatAmount = netBeforeVat * rate;
  const grossTotal = netBeforeVat + vatAmount;

  const lineItems: OfferConfigPdfLineItem[] = productLines.map((item: any) => {
    const mcp = item.payload?.metaCalcConfigurationPayload;
    const rawPartsList = mcp?.partsList || [];
    const rawAccessoryList = mcp?.accessoryList || [];

    const mapPart = (part: any) => {
      const resolved = part.productId ? productLookup.get(part.productId) : undefined;
      return {
        productNumber: resolved?.productNumber || null,
        name: resolved?.name || part.description || part.productId || "Position",
        quantity: part.quantity || 0,
      };
    };

    const config = mcp
      ? {
          name: String(item.payload?.metaCalcConfigurationName || mcp.metaCalcConfigurationName || ""),
          description: mcp.description ? stripHtmlToText(String(mcp.description)) : "",
          imageBase64: typeof mcp.image === "string" ? mcp.image : null,
          installationTimeMinutes: Number(
            item.payload?.metaCalcInstallationTime ?? mcp.installationTime ?? mcp.installationTimeMinutes ?? 0,
          ),
          partsList: rawPartsList.map(mapPart),
          accessoryList: rawAccessoryList.map(mapPart),
        }
      : undefined;

    return {
      label: item.label || item.name || item.productName || "Position",
      productNumber: item.productNumber || item.payload?.productNumber || null,
      quantity: item.quantity || 0,
      unitPrice: Number(item.unitPrice ?? item.price ?? 0),
      totalPrice: Number(item.totalPrice ?? item.total ?? 0),
      taxRate: Number(item.taxRate ?? item.price?.taxRules?.[0]?.taxRate ?? displayTaxRate),
      config,
    };
  });

  const { customerNumber, billingAddress } = await enrichCustomerForPdf(mappedOffer, settings);

  return {
    offerNumber: mappedOffer.offerNumber,
    customerName: mappedOffer.customerName || "—",
    customerEmail: mappedOffer.customerEmail,
    customerNumber,
    billingAddress,
    createdAt: mappedOffer.createdAt,
    expirationDate: mappedOffer.offerExpiration || undefined,
    productsNetSubtotal,
    shippingCostsNet: shippingNet,
    shippingCostsGross: shippingGross,
    montageCostNet: montageNet,
    montageCostGross: montageGross,
    montageDescription,
    vatAmount,
    grossTotal,
    displayTaxRate,
    lineItems,
  };
}
