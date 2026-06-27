/**
 * PDF: Abschlussrechnung nach Teil-/Komplettstornierung (Ausgleich Ursprungs- vs. Stornobetrag).
 * Layout angelehnt an installmentInvoicePdf (META Regalbau).
 */

import {
  CO,
  M, PW, CW, COL_R, HEADER_TEXT_W, LINE, LINE_SM,
  eur, dat,
  createMetaPdfDocument,
  drawLetterHead,
  drawFooterOnAllPages,
} from "./metaRegalBriefpapier";

export type SettlementInvoicePdfInput = {
  settlementInvoiceNumber: string;
  originalInvoiceNumber: string;
  originalAmountGross: number;
  stornoInvoiceNumber: string;
  stornoAmountGross: number;
  balanceGross: number;
  invoiceDate: Date;
  orderNumber: string;
  customerName: string;
  customerEmail?: string | null;
  billingAddress?: {
    company?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    street?: string | null;
    zipCode?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
};

export function generateSettlementInvoicePdf(
  input: SettlementInvoicePdfInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = createMetaPdfDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const titleDate = dat(input.invoiceDate);
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
    doc.text(`Rechnungs-Nr. ${input.settlementInvoiceNumber}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
    ry += LINE_SM;
    doc.text(`Datum ${titleDate}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });

    y = Math.max(y, ry) + LINE * 2;

    doc.fontSize(16).font("Helvetica-Bold");
    doc.text("Abschlussrechnung", M, y);
    y += 22;
    doc.fontSize(11);
    doc.text(`Rechnungs-Nr. ${input.settlementInvoiceNumber}`, M, y);
    y += LINE + 4;
    doc.font("Helvetica").fontSize(10);
    y += 6;

    doc.text(
      "Nach Teil- oder Komplettstornierung stellen wir hiermit die Abschlussrechnung zur Ausgleichszahlung. " +
        "Es werden der Bruttobetrag der ursprünglichen Rechnung und der Abzug laut Stornorechnung ausgewiesen.",
      M,
      y,
      { width: CW },
    );
    y = doc.y + 8;

    const colBeschreibung = M;
    const colBetrag = PW - M - 95;

    doc.fontSize(8).font("Helvetica-Bold");
    doc.text("Beschreibung", colBeschreibung, y, { width: 360 });
    doc.text("Betrag (brutto)", colBetrag, y, { width: 90, align: "right" });
    y += LINE_SM;

    doc
      .moveTo(M, y)
      .lineTo(PW - M, y)
      .lineWidth(0.5)
      .strokeColor("#ccc")
      .stroke();
    doc.strokeColor("#000");
    y += 6;

    doc.font("Helvetica").fontSize(9);
    doc.text(
      `Ursprungsrechnung ${input.originalInvoiceNumber}`,
      colBeschreibung,
      y,
      { width: 360 },
    );
    doc.text(eur(input.originalAmountGross), colBetrag, y, { width: 90, align: "right" });
    y += LINE * 2;

    doc.text(
      `Abzug laut Stornorechnung ${input.stornoInvoiceNumber}`,
      colBeschreibung,
      y,
      { width: 360 },
    );
    const stornoNeg = -Math.abs(input.stornoAmountGross);
    doc.text(eur(stornoNeg), colBetrag, y, { width: 90, align: "right" });
    y += LINE * 2;

    doc
      .moveTo(M, y)
      .lineTo(PW - M, y)
      .lineWidth(0.5)
      .strokeColor("#ccc")
      .stroke();
    doc.strokeColor("#000");
    y += 8;

    const grossAmount = input.balanceGross;
    const netAmount = Math.round((grossAmount / 1.19) * 100) / 100;
    const taxAmount = Math.round((grossAmount - netAmount) * 100) / 100;

    const sumX = COL_R;
    const valX = PW - M - 70;
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Zahlungsbetrag (brutto):", sumX, y, { width: 130, align: "right" });
    doc.text(eur(grossAmount), valX, y, { width: 70, align: "right" });
    doc.font("Helvetica");
    y += LINE_SM;

    if (grossAmount > 0) {
      doc.text("davon Nettobetrag:", sumX, y, { width: 130, align: "right" });
      doc.text(eur(netAmount), valX, y, { width: 70, align: "right" });
      y += LINE_SM;
      doc.text("zzgl. 19 % MwSt.:", sumX, y, { width: 130, align: "right" });
      doc.text(eur(taxAmount), valX, y, { width: 70, align: "right" });
      y += LINE_SM;
    }

    y += LINE;

    doc
      .moveTo(M, y)
      .lineTo(PW - M, y)
      .lineWidth(0.5)
      .strokeColor("#ccc")
      .stroke();
    doc.strokeColor("#000");
    y += LINE;

    if (grossAmount > 0) {
      doc.fontSize(9).text(
        `Bitte überweisen Sie den Zahlungsbetrag von ${eur(grossAmount)} auf das folgende Konto:`,
        M,
        y,
        { width: CW },
      );
      y = doc.y + LINE_SM;

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
      doc.font("Helvetica").text(input.settlementInvoiceNumber);
      y += LINE * 2;
    } else {
      doc
        .fontSize(9)
        .text(
          "Der ausgewiesene Zahlungsbetrag beträgt 0,00 €; es ist kein weiterer Zahlungsausgleich erforderlich.",
          M,
          y,
          { width: CW },
        );
      y = doc.y + LINE_SM;
    }

    doc.fontSize(8).fillColor("#666");
    doc.text(
      `Belegreferenzen: Ursprungsrechnung ${input.originalInvoiceNumber} (${eur(input.originalAmountGross)}), ` +
        `Stornorechnung ${input.stornoInvoiceNumber} (${eur(-Math.abs(input.stornoAmountGross))}).`,
      M,
      y,
      { width: CW },
    );
    doc.fillColor("#000");

    drawFooterOnAllPages(doc);
    doc.end();
  });
}
