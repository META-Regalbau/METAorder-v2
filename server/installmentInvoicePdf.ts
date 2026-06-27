/**
 * PDF: Anzahlungsrechnung / Teilrechnung für Ratenzahlungspläne.
 * Layout angelehnt an dunningPdf (META Regalbau Rechnungslayout).
 */

import {
  CO,
  M, PW, CW, COL_R, HEADER_TEXT_W, LINE, LINE_SM,
  eur, dat,
  createMetaPdfDocument,
  drawLetterHead,
  drawFooterOnAllPages,
} from "./metaRegalBriefpapier";

export type InstallmentInvoicePdfInput = {
  type: "deposit" | "installment";
  sequenceNumber: number;
  invoiceNumber: string;
  amount: number;
  dueDate: Date | string | null;
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
  totalAmount: number;
  depositAmount: number;
  depositPercent?: number | null;
  remainingAmount: number;
  numberOfInstallments: number;
  planId: string;
};

export function generateInstallmentInvoicePdf(
  input: InstallmentInvoicePdfInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = createMetaPdfDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const isDeposit = input.type === "deposit";
    const title = isDeposit
      ? "Anzahlungsrechnung"
      : `Teilrechnung Nr. ${input.sequenceNumber}`;
    const today = dat(new Date());

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
    if (!b) {
      if (input.customerEmail) {
        doc.text(input.customerEmail, M, y);
        y += LINE;
      }
    }

    doc.fontSize(9);
    let ry = addrY;
    doc.text(`Bestell-Nr. ${input.orderNumber}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
    ry += LINE_SM;
    doc.text(`Rechnungs-Nr. ${input.invoiceNumber}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
    ry += LINE_SM;
    doc.text(`Datum ${today}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
    ry += LINE_SM;
    if (input.dueDate) {
      doc.text(`Fällig am ${dat(input.dueDate)}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
      ry += LINE_SM;
    }

    y = Math.max(y, ry) + LINE * 2;

    doc.fontSize(16).font("Helvetica-Bold");
    doc.text(title, M, y);
    y += 22;
    doc.fontSize(11);
    doc.text(`Rechnungs-Nr. ${input.invoiceNumber}`, M, y);
    y += LINE + 4;
    doc.font("Helvetica").fontSize(10);
    y += 6;

    if (isDeposit) {
      const pctText =
        input.depositPercent != null
          ? ` (${input.depositPercent.toFixed(2).replace(".", ",")} % des Bestellwerts)`
          : "";
      doc.text(
        `Anzahlungsrechnung zur Bestellung ${input.orderNumber}. ` +
          `Der Gesamtbetrag der Bestellung beträgt ${eur(input.totalAmount)}. ` +
          `Die vereinbarte Anzahlung${pctText} wird hiermit in Rechnung gestellt.`,
        M,
        y,
        { width: CW },
      );
    } else {
      doc.text(
        `Teilrechnung ${input.sequenceNumber} von ${input.numberOfInstallments} ` +
          `zur Bestellung ${input.orderNumber}. ` +
          `Restbetrag ${eur(input.remainingAmount)} aufgeteilt in ${input.numberOfInstallments} Raten.`,
        M,
        y,
        { width: CW },
      );
    }
    y += LINE * 3 + 4;

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

    const description = isDeposit
      ? `Anzahlung zu Bestellung ${input.orderNumber}`
      : `Teilrechnung Rate ${input.sequenceNumber}/${input.numberOfInstallments} zu Bestellung ${input.orderNumber}`;
    const grossAmount = input.amount;
    const netAmount = Math.round((grossAmount / 1.19) * 100) / 100;
    const taxAmount = Math.round((grossAmount - netAmount) * 100) / 100;

    doc.font("Helvetica").fontSize(9);
    doc.text("1", colPos, y, { width: 35 });
    doc.text(description, colBeschreibung, y, { width: 260 });
    doc.text("1", colMenge, y, { width: 40, align: "right" });
    doc.text("19 %", colUSt, y, { width: 40, align: "right" });
    doc.text(eur(netAmount), colEinzel, y, { width: 50, align: "right" });
    doc.text(eur(netAmount), colGesamt, y, { width: 55, align: "right" });
    y += LINE * 2;

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
    doc.text(eur(netAmount), valX, y, { width: 70, align: "right" });
    y += LINE_SM;
    doc.text("zzgl. 19 % MwSt.:", sumX, y, { width: 130, align: "right" });
    doc.text(eur(taxAmount), valX, y, { width: 70, align: "right" });
    y += LINE_SM;
    doc.font("Helvetica-Bold");
    doc.text("Rechnungsbetrag:", sumX, y, { width: 130, align: "right" });
    doc.text(eur(grossAmount), valX, y, { width: 70, align: "right" });
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

    if (input.dueDate) {
      doc
        .fontSize(9)
        .text(
          `Bitte überweisen Sie den Rechnungsbetrag von ${eur(grossAmount)} bis zum ${dat(input.dueDate)} auf das folgende Konto:`,
          M,
          y,
          { width: CW },
        );
    } else {
      doc
        .fontSize(9)
        .text(
          `Bitte überweisen Sie den Rechnungsbetrag von ${eur(grossAmount)} auf das folgende Konto:`,
          M,
          y,
          { width: CW },
        );
    }
    y += LINE * 2;

    doc.fontSize(9);
    doc
      .font("Helvetica-Bold")
      .text("Kontoinhaber: ", M, y, { continued: true });
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
    doc
      .font("Helvetica-Bold")
      .text("Verwendungszweck: ", M, y, { continued: true });
    doc.font("Helvetica").text(input.invoiceNumber);
    y += LINE * 2;

    doc.fontSize(8).fillColor("#666");
    doc.text(
      `Diese Rechnung ist Teil eines Teilzahlungsplans (${input.numberOfInstallments} Raten) ` +
        `zur Bestellung ${input.orderNumber} über ${eur(input.totalAmount)}.`,
      M,
      y,
      { width: CW },
    );
    doc.fillColor("#000");

    drawFooterOnAllPages(doc);
    doc.end();
  });
}
