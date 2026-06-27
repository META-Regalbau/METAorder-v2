/**
 * Offer Draft PDF Generator - generates a simple PDF from offer draft data
 */

import PDFDocument from "pdfkit";
import { eur } from "./metaRegalBriefpapier";

type DraftCustomer = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
};

type DraftBillingAddress = {
  street?: string;
  zipCode?: string;
  city?: string;
  country?: string;
};

type MatchingItem = {
  extractedProductName?: string;
  quantity: number;
  matchedProduct?: {
    name?: string;
    productNumber?: string;
    catalogPrice?: number;
    suggestedPrice?: number;
    suggestedDiscount?: number;
  };
  bundle?: {
    name?: string;
    mockProductNumber?: string;
    components?: Array<{ productName?: string; productNumber?: string; quantity: number }>;
  };
};

type DraftExtractedData = {
  customer?: DraftCustomer;
  billingAddress?: DraftBillingAddress;
  validUntil?: string;
  offerNotes?: string;
};

type DraftMatchingResults = {
  items?: MatchingItem[];
  pricingRecommendations?: {
    totalCatalogValue: number;
    totalSuggestedValue: number;
    totalDiscountPercentage: number;
    reasoning?: string;
  };
};

type OfferDraftForPdf = {
  id: string;
  originalFileName?: string;
  extractedData?: DraftExtractedData;
  matchingResults?: DraftMatchingResults;
};

const formatCurrency = eur;

export async function generateOfferDraftPdf(draft: OfferDraftForPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { extractedData, matchingResults, originalFileName } = draft;

    // Header
    doc.fontSize(20).text("Angebotsentwurf", { align: "center" });
    doc.moveDown(0.5);
    if (originalFileName) {
      doc.fontSize(10).fillColor("#666").text(`Quelle: ${originalFileName}`, { align: "center" });
    }
    doc.moveDown(1);

    // Customer
    if (extractedData?.customer) {
      doc.fontSize(12).fillColor("#000").text("Kundeninformation", { underline: true });
      doc.fontSize(10);
      const c = extractedData.customer;
      doc.text([c.firstName, c.lastName].filter(Boolean).join(" ") || "-");
      if (c.company) doc.text(c.company);
      if (c.email) doc.text(c.email);
      if (c.phone) doc.text(c.phone);
      doc.moveDown(1);
    }

    // Billing Address
    if (extractedData?.billingAddress) {
      doc.fontSize(12).text("Rechnungsadresse", { underline: true });
      doc.fontSize(10);
      const a = extractedData.billingAddress;
      doc.text(a.street || "-");
      doc.text(`${[a.zipCode, a.city].filter(Boolean).join(" ")} ${a.country || ""}`.trim() || "-");
      doc.moveDown(1);
    }

    // Valid Until
    if (extractedData?.validUntil) {
      doc.fontSize(10).text(`Gültig bis: ${extractedData.validUntil}`);
      doc.moveDown(1);
    }

    // Products
    const items = matchingResults?.items ?? [];
    if (items.length > 0) {
      doc.fontSize(12).text("Positionen", { underline: true });
      doc.moveDown(0.5);

      for (const item of items) {
        const name = item.bundle?.name ?? item.matchedProduct?.name ?? item.extractedProductName ?? "-";
        const productNumber = item.bundle?.mockProductNumber ?? item.matchedProduct?.productNumber ?? "";
        const qty = item.quantity ?? 1;
        const catalogPrice = item.matchedProduct?.catalogPrice ?? 0;
        const suggestedPrice = item.matchedProduct?.suggestedPrice ?? catalogPrice;
        const discount = item.matchedProduct?.suggestedDiscount ?? 0;

        doc.fontSize(10);
        doc.text(`${name} ${productNumber ? `(${productNumber})` : ""}`);
        doc.fontSize(9).fillColor("#666");
        doc.text(`  Menge: ${qty} · Listenpreis: ${formatCurrency(catalogPrice)} · Angebotspreis: ${formatCurrency(suggestedPrice)} · Rabatt: ${discount.toFixed(1)}%`);
        doc.fillColor("#000");
        doc.moveDown(0.3);
      }

      doc.moveDown(0.5);

      // Totals
      const recs = matchingResults?.pricingRecommendations;
      if (recs) {
        doc.fontSize(10).font("Helvetica-Bold");
        doc.text(`Katalogwert gesamt: ${formatCurrency(recs.totalCatalogValue)}`);
        doc.text(`Angebotswert gesamt: ${formatCurrency(recs.totalSuggestedValue)}`);
        doc.text(`Rabatt gesamt: ${recs.totalDiscountPercentage.toFixed(1)}%`);
        doc.font("Helvetica");
        doc.moveDown(1);
      }
    }

    // Notes
    if (extractedData?.offerNotes) {
      doc.fontSize(10).text("Anmerkungen", { underline: true });
      doc.fontSize(9).text(extractedData.offerNotes, { width: 500 });
    }

    doc.end();
  });
}
