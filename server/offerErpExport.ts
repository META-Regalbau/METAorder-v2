/**
 * XML/CSV-Export für Angebote (ERP-Import als Anfrage/Auftrag).
 * Schema-Version 1.0 — stabile Elemente/Spalten für eigene Mapper.
 */

import type { ShopwareSettings } from "@shared/schema";
import { ShopwareClient } from "./shopware";

const EXPORT_VERSION = "1.0";
const XML_NS = "https://meta-online.com/ns/metaorder/erp-export/1";

export type OfferErpLineType = "product" | "shipping" | "bom";

export type OfferErpExportLine = {
  index: number;
  lineType: OfferErpLineType;
  parentLineIndex: number | null;
  productNumber: string | null;
  description: string;
  quantity: number;
  unitPriceNet: number;
  lineTotalNet: number;
  taxRatePercent: number;
  configurationName: string | null;
};

export type OfferErpExportModel = {
  meta: {
    exportVersion: string;
    exportedAt: string;
    currency: string;
    documentKind: "quotation";
  };
  offer: {
    id: string;
    offerNumber: string;
    status: string;
    statusLabel: string | null;
    createdAt: string | null;
    expirationDate: string | null;
    customerId: string | null;
    customerName: string | null;
    customerEmail: string | null;
    salesChannelId: string | null;
    salesChannelName: string | null;
    netAmount: number;
    totalAmount: number;
  };
  lines: OfferErpExportLine[];
};

function isShippingLineItem(item: any): boolean {
  const t = String(item?.type || "").toLowerCase();
  return t === "shipping" || t === "delivery" || t === "shipping_charge";
}

function stripHtmlToPlain(html: string | null | undefined): string {
  if (!html) return "";
  return String(html)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlEscapeTextContent(s: string): string {
  return xmlEscape(s).replace(/\r\n|\r|\n/g, "&#10;");
}

function csvEscape(field: string): string {
  if (/[;\r\n"]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function numCsv(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

/** Baut das Exportmodell inkl. aufgelöster Stücklisten-Zeilen. */
export async function buildOfferErpExportModel(
  settings: ShopwareSettings,
  mapped: {
    id: string;
    offerNumber: string;
    customerId?: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    totalPrice: number;
    netPrice: number;
    status: string;
    statusId?: string | null;
    statusLabel?: string | null;
    createdAt?: string | null;
    offerExpiration?: string | null;
    salesChannelId?: string | null;
    salesChannelName?: string | null;
    items?: any[];
  },
): Promise<OfferErpExportModel> {
  const allItems: any[] = mapped.items || [];

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

  const lines: OfferErpExportLine[] = [];
  let idx = 0;

  for (const item of allItems) {
    const mcp = item.payload?.metaCalcConfigurationPayload;
    const rawPartsList = mcp?.partsList || [];
    const rawAccessoryList = mcp?.accessoryList || [];
    const bomEntries = [...rawPartsList, ...rawAccessoryList];

    const shipping = isShippingLineItem(item);
    const label = item.label || item.name || item.productName || "Position";
    const qty = Number(item.quantity) || 0;
    const unitNet = Number(item.unitPrice ?? item.price ?? 0);
    const lineNet = Number(item.totalPrice ?? item.total ?? 0);
    const tax = Number(item.taxRate ?? item.price?.taxRules?.[0]?.taxRate ?? 0);
    const sku = item.productNumber || item.payload?.productNumber || null;
    const configName = item.payload?.metaCalcConfigurationName || mcp?.metaCalcConfigurationName || null;
    const descExtra = mcp?.description ? stripHtmlToPlain(String(mcp.description)) : "";
    const description = descExtra ? `${label}\n${descExtra}`.trim() : label;

    idx += 1;
    const mainIdx = idx;
    lines.push({
      index: mainIdx,
      lineType: shipping ? "shipping" : "product",
      parentLineIndex: null,
      productNumber: sku,
      description,
      quantity: qty,
      unitPriceNet: unitNet,
      lineTotalNet: lineNet,
      taxRatePercent: tax,
      configurationName: configName,
    });

    for (const part of bomEntries) {
      const resolved = part.productId ? productLookup.get(part.productId) : undefined;
      idx += 1;
      lines.push({
        index: idx,
        lineType: "bom",
        parentLineIndex: mainIdx,
        productNumber: resolved?.productNumber || null,
        description: resolved?.name || part.description || part.productId || "Stückliste",
        quantity: Number(part.quantity) || 0,
        unitPriceNet: 0,
        lineTotalNet: 0,
        taxRatePercent: tax,
        configurationName: null,
      });
    }
  }

  return {
    meta: {
      exportVersion: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      currency: "EUR",
      documentKind: "quotation",
    },
    offer: {
      id: mapped.id,
      offerNumber: mapped.offerNumber,
      status: mapped.status,
      statusLabel: mapped.statusLabel ?? null,
      createdAt: mapped.createdAt ?? null,
      expirationDate: mapped.offerExpiration ?? null,
      customerId: mapped.customerId ?? null,
      customerName: mapped.customerName ?? null,
      customerEmail: mapped.customerEmail ?? null,
      salesChannelId: mapped.salesChannelId ?? null,
      salesChannelName: mapped.salesChannelName ?? null,
      netAmount: mapped.netPrice,
      totalAmount: mapped.totalPrice,
    },
    lines,
  };
}

export function offerErpExportToXml(model: OfferErpExportModel): string {
  const { meta, offer, lines } = model;
  const linesXml = lines
    .map(
      (l) =>
        `    <Line index="${l.index}" type="${xmlEscape(l.lineType)}"` +
        `${l.parentLineIndex != null ? ` parentLineIndex="${l.parentLineIndex}"` : ""}` +
        ` productNumber="${xmlEscape(l.productNumber ?? "")}"` +
        ` quantity="${numCsv(l.quantity)}"` +
        ` unitPriceNet="${numCsv(l.unitPriceNet)}"` +
        ` lineTotalNet="${numCsv(l.lineTotalNet)}"` +
        ` taxRatePercent="${numCsv(l.taxRatePercent)}"` +
        ` configurationName="${xmlEscape(l.configurationName ?? "")}"` +
        `><Description>${xmlEscapeTextContent(l.description)}</Description></Line>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<METAorderOfferExport xmlns="${XML_NS}" version="${EXPORT_VERSION}">
  <Meta exportedAt="${xmlEscape(meta.exportedAt)}" currency="${xmlEscape(meta.currency)}" documentKind="${xmlEscape(meta.documentKind)}" importHint="Kunde mappt im ERP auf Anfrage, Auftrag oder Bestellung"/>
  <Offer id="${xmlEscape(offer.id)}" number="${xmlEscape(offer.offerNumber)}" status="${xmlEscape(offer.status)}" statusLabel="${xmlEscape(offer.statusLabel ?? "")}" createdAt="${xmlEscape(offer.createdAt ?? "")}" expirationDate="${xmlEscape(offer.expirationDate ?? "")}" netAmount="${numCsv(offer.netAmount)}" grossAmount="${numCsv(offer.totalAmount)}">
    <Customer id="${xmlEscape(offer.customerId ?? "")}" name="${xmlEscape(offer.customerName ?? "")}" email="${xmlEscape(offer.customerEmail ?? "")}"/>
    <SalesChannel id="${xmlEscape(offer.salesChannelId ?? "")}" name="${xmlEscape(offer.salesChannelName ?? "")}"/>
    <Lines>
${linesXml}
    </Lines>
  </Offer>
</METAorderOfferExport>
`;
}

/** Semikolon-getrennt, UTF-8 mit BOM — typisch für deutschsprachige ERP-CSV-Imports. */
export function offerErpExportToCsv(model: OfferErpExportModel): string {
  const sep = ";";
  const header = [
    "exportVersion",
    "exportedAt",
    "currency",
    "documentKind",
    "offerId",
    "offerNumber",
    "offerStatus",
    "offerStatusLabel",
    "offerCreatedAt",
    "offerExpirationDate",
    "customerId",
    "customerName",
    "customerEmail",
    "salesChannelId",
    "salesChannelName",
    "offerNetAmount",
    "offerGrossAmount",
    "lineIndex",
    "lineType",
    "parentLineIndex",
    "productNumber",
    "description",
    "quantity",
    "unitPriceNet",
    "lineTotalNet",
    "taxRatePercent",
    "configurationName",
  ].join(sep);

  const { meta, offer, lines } = model;
  const rows = lines.map((l) =>
    [
      meta.exportVersion,
      meta.exportedAt,
      meta.currency,
      meta.documentKind,
      offer.id,
      offer.offerNumber,
      offer.status,
      offer.statusLabel ?? "",
      offer.createdAt ?? "",
      offer.expirationDate ?? "",
      offer.customerId ?? "",
      offer.customerName ?? "",
      offer.customerEmail ?? "",
      offer.salesChannelId ?? "",
      offer.salesChannelName ?? "",
      numCsv(offer.netAmount),
      numCsv(offer.totalAmount),
      String(l.index),
      l.lineType,
      l.parentLineIndex != null ? String(l.parentLineIndex) : "",
      l.productNumber ?? "",
      l.description,
      numCsv(l.quantity),
      numCsv(l.unitPriceNet),
      numCsv(l.lineTotalNet),
      numCsv(l.taxRatePercent),
      l.configurationName ?? "",
    ]
      .map((c) => csvEscape(String(c)))
      .join(sep),
  );

  return `\uFEFF${header}\n${rows.join("\n")}\n`;
}
