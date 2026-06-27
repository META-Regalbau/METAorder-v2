/**
 * PDF: Nachberechnungs-Rechnung (freie Positionen, z. B. Versandkosten).
 * Layout angelehnt an installmentInvoicePdf (META Regalbau Rechnungslayout).
 */

import type { AdditionalInvoicePdfInput } from "@shared/schema";
import {
  CO,
  M,
  PW,
  CW,
  COL_R,
  HEADER_TEXT_W,
  LINE,
  LINE_SM,
  eur,
  dat,
  createMetaPdfDocument,
  drawLetterHead,
  drawFooterOnAllPages,
} from "./metaRegalBriefpapier";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function vatLabel(rate: 0 | 7 | 19): string {
  if (rate === 0) return "0 %";
  return `${rate} %`;
}

export function generateAdditionalInvoicePdf(
  input: AdditionalInvoicePdfInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = createMetaPdfDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const today = dat(input.invoiceDate);
    let y = drawLetterHead(doc, M);

    const addrY = y;
    doc.fontSize(10).font("Helvetica");
    const b = input.billingAddress;
    if (b?.company) {
      doc.text(b.company, M, y);
      y += LINE;
    }
    const custName =
      input.customerName ||
      (b
        ? `${(b.firstName || "").trim()} ${(b.lastName || "").trim()}`.trim()
        : "") ||
      "—";
    doc.text(custName, M, y);
    y += LINE;
    if (b?.street) {
      doc.text(b.street, M, y);
      y += LINE;
    }
    const cl = [b?.zipCode, b?.city].filter(Boolean).join(" ");
    if (cl) {
      doc.text(cl, M, y);
      y += LINE;
    }
    if (b?.country) {
      doc.text(b.country, M, y);
      y += LINE;
    }
    if (!b && input.customerEmail) {
      doc.text(input.customerEmail, M, y);
      y += LINE;
    }

    doc.fontSize(9);
    let ry = addrY;
    doc.text(`Bestell-Nr. ${input.orderNumber}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
    ry += LINE_SM;
    doc.text(`Rechnungs-Nr. ${input.invoiceNumber}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
    ry += LINE_SM;
    doc.text(`Datum ${today}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
    ry += LINE_SM;
    if (input.referenceInvoiceNumber?.trim()) {
      doc.text(`Bezug: Rechnung ${input.referenceInvoiceNumber.trim()}`, COL_R, ry, {
        width: HEADER_TEXT_W,
        align: "right",
      });
      ry += LINE_SM;
    }

    y = Math.max(y, ry) + LINE * 2;

    doc.fontSize(16).font("Helvetica-Bold");
    doc.text("Rechnung – Nachberechnung", M, y);
    y += 22;
    doc.fontSize(11);
    doc.text(`Rechnungs-Nr. ${input.invoiceNumber}`, M, y);
    y += LINE + 4;
    doc.font("Helvetica").fontSize(10);
    y += 6;

    let intro =
      `Nachberechnung zur Bestellung ${input.orderNumber}. ` +
      "Die folgenden Positionen werden hiermit in Rechnung gestellt.";
    if (input.referenceInvoiceNumber?.trim()) {
      intro += ` Bezug: Rechnung ${input.referenceInvoiceNumber.trim()}.`;
    }
    doc.text(intro, M, y, { width: CW });
    y += LINE * 2;
    if (input.note?.trim()) {
      doc.text(input.note.trim(), M, y, { width: CW });
      y += LINE * 2;
    }

    const colPos = M;
    const colBeschreibung = M + 40;
    const colMenge = M + 310;
    const colUSt = M + 350;
    const colEinzel = M + 390;
    const colGesamt = M + 440;

    doc.fontSize(8).font("Helvetica-Bold");
    doc.text("Pos.", colPos, y, { width: 35 });
    doc.text("Beschreibung", colBeschreibung, y, { width: 260 });
    doc.text("Menge", colMenge, y, { width: 40, align: "right" });
    doc.text("USt.", colUSt, y, { width: 40, align: "right" });
    doc.text("Einzelpreis", colEinzel, y, { width: 50, align: "right" });
    doc.text("Gesamt", colGesamt, y, { width: 55, align: "right" });
    y += LINE_SM;

    doc
      .moveTo(M, y)
      .lineTo(PW - M, y)
      .lineWidth(0.5)
      .strokeColor("#ccc")
      .stroke();
    doc.strokeColor("#000");
    y += 6;

    const vatTotals = new Map<0 | 7 | 19, { net: number; tax: number }>();
    let totalNet = 0;
    let totalGross = 0;

    doc.font("Helvetica").fontSize(9);
    input.items.forEach((item, index) => {
      const lineNet = roundMoney(item.quantity * item.unitNetPrice);
      const lineTax = roundMoney(lineNet * (item.vatRate / 100));
      const lineGross = roundMoney(lineNet + lineTax);
      totalNet = roundMoney(totalNet + lineNet);
      totalGross = roundMoney(totalGross + lineGross);

      const bucket = vatTotals.get(item.vatRate) ?? { net: 0, tax: 0 };
      bucket.net = roundMoney(bucket.net + lineNet);
      bucket.tax = roundMoney(bucket.tax + lineTax);
      vatTotals.set(item.vatRate, bucket);

      doc.text(String(index + 1), colPos, y, { width: 35 });
      doc.text(item.description, colBeschreibung, y, { width: 260 });
      doc.text(String(item.quantity), colMenge, y, { width: 40, align: "right" });
      doc.text(vatLabel(item.vatRate), colUSt, y, { width: 40, align: "right" });
      doc.text(eur(item.unitNetPrice), colEinzel, y, { width: 50, align: "right" });
      doc.text(eur(lineNet), colGesamt, y, { width: 55, align: "right" });
      y += LINE * 1.5;
    });

    y += LINE_SM;
    doc
      .moveTo(M, y)
      .lineTo(PW - M, y)
      .lineWidth(0.5)
      .strokeColor("#ccc")
      .stroke();
    doc.strokeColor("#000");
    y += 8;

    const sumX = COL_R;
    const valX = PW - M - 70;
    doc.fontSize(9);
    doc.text("Nettobetrag:", sumX, y, { width: 130, align: "right" });
    doc.text(eur(totalNet), valX, y, { width: 70, align: "right" });
    y += LINE_SM;

    for (const rate of [0, 7, 19] as const) {
      const bucket = vatTotals.get(rate);
      if (!bucket || bucket.tax <= 0) continue;
      doc.text(`zzgl. ${rate} % MwSt.:`, sumX, y, { width: 130, align: "right" });
      doc.text(eur(bucket.tax), valX, y, { width: 70, align: "right" });
      y += LINE_SM;
    }

    doc.font("Helvetica-Bold");
    doc.text("Rechnungsbetrag:", sumX, y, { width: 130, align: "right" });
    doc.text(eur(totalGross), valX, y, { width: 70, align: "right" });
    doc.font("Helvetica");
    y += LINE * 2;

    doc
      .moveTo(M, y)
      .lineTo(PW - M, y)
      .lineWidth(0.5)
      .strokeColor("#ccc")
      .stroke();
    doc.strokeColor("#000");
    y += LINE;

    doc
      .fontSize(9)
      .text(
        `Bitte überweisen Sie den Rechnungsbetrag von ${eur(totalGross)} auf das folgende Konto:`,
        M,
        y,
        { width: CW },
      );
    y += LINE * 2;

    doc.fontSize(9);
    doc.font("Helvetica-Bold").text("Kontoinhaber: ", M, y, { continued: true });
    doc.font("Helvetica").text(CO.name);
    y += LINE_SM;
    doc.font("Helvetica-Bold").text("IBAN: ", M, y, { continued: true });
    doc.font("Helvetica").text(CO.iban);
    y += LINE_SM;
    doc.font("Helvetica-Bold").text("BIC: ", M, y, { continued: true });
    doc.font("Helvetica").text(CO.bic);
    y += LINE_SM;
    doc.font("Helvetica-Bold").text("Bank: ", M, y, { continued: true });
    doc.font("Helvetica").text(CO.bank);
    y += LINE_SM;
    doc.font("Helvetica-Bold").text("Verwendungszweck: ", M, y, { continued: true });
    doc.font("Helvetica").text(input.invoiceNumber);
    y += LINE * 2;

    doc.fontSize(8).fillColor("#666");
    doc.text(
      `Diese Nachberechnung bezieht sich auf die Bestellung ${input.orderNumber}.`,
      M,
      y,
      { width: CW },
    );
    doc.fillColor("#000");

    drawFooterOnAllPages(doc);
    doc.end();
  });
}
