/**
 * PDF: Teilzahlungsvereinbarung zur Unterschrift durch den Kunden.
 * Vereinfachter Header (kein Logo/Footer), aber CO/eur/dat aus dem Briefpapier-Master.
 */

import PDFDocument from "pdfkit";
import { CO, M, PW, CW, PH, eur, dat } from "./metaRegalBriefpapier";

export type InstallmentAgreementLine = {
  kind: "deposit" | "installment";
  sequenceNumber: number;
  invoiceNumber: string;
  amount: number;
  dueDate: Date | string | null | undefined;
};

export type InstallmentAgreementPdfInput = {
  orderNumber: string;
  customerName: string;
  customerEmail?: string | null;
  totalAmount: number;
  depositAmount: number;
  remainingAmount: number;
  numberOfInstallments: number;
  lines: InstallmentAgreementLine[];
};

const LEGAL_HINT =
  "Die vereinbarte Teilzahlung bezieht sich auf die genannte Bestellung. " +
  "Mit Zahlung der jeweiligen Teilbeträge werden keine Eigentumsrechte an der Ware vor vollständiger Begleichung aller Teilbeträge begründet, soweit nicht gesetzlich anders geregelt. " +
  "Es gelten unsere Allgemeinen Geschäftsbedingungen.";

export function generateInstallmentAgreementPdf(input: InstallmentAgreementPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: M, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = M;

    doc.fontSize(10).font("Helvetica-Bold").text(CO.name, M, y);
    y += 14;
    doc.font("Helvetica").fontSize(9);
    doc.text(`${CO.street} · ${CO.zip} ${CO.city}`, M, y);
    y += 12;
    doc.text(`Tel. ${CO.phone} · ${CO.email} · ${CO.web}`, M, y);
    y += 28;

    doc.fontSize(16).font("Helvetica-Bold").text("Teilzahlungsvereinbarung", M, y);
    y += 24;

    doc.fontSize(10).font("Helvetica");
    doc.text(`Datum: ${dat(new Date())}`, M, y);
    y += 16;
    doc.text(`Bestellnummer: ${input.orderNumber}`, M, y);
    y += 18;

    doc.font("Helvetica-Bold").text("Kunde", M, y);
    y += 12;
    doc.font("Helvetica");
    doc.text(input.customerName, M, y);
    y += 12;
    if (input.customerEmail) {
      doc.text(input.customerEmail, M, y);
      y += 12;
    }
    y += 8;

    doc.font("Helvetica-Bold").text("Gesamtbetrag der Bestellung (brutto)", M, y);
    y += 12;
    doc.font("Helvetica").text(eur(input.totalAmount), M, y);
    y += 16;

    doc.font("Helvetica-Bold").text("Anzahlung", M, y);
    y += 12;
    doc
      .font("Helvetica")
      .text(`${eur(input.depositAmount)} — Rechnungs-Nr. ${input.lines.find((l) => l.kind === "deposit")?.invoiceNumber ?? "—"}`, M, y);
    y += 16;

    doc.font("Helvetica-Bold").text("Restbetrag", M, y);
    y += 12;
    doc.font("Helvetica").text(eur(input.remainingAmount), M, y);
    y += 8;
    doc.text(`Aufteilung in ${input.numberOfInstallments} gleichwertige Teilrechnungen (siehe Tabelle).`, M, y, {
      width: CW,
    });
    y += 28;

    doc.font("Helvetica-Bold").text("Übersicht Rechnungen", M, y);
    y += 14;

    const colArt = M;
    const colNr = M + 80;
    const colInv = M + 130;
    const colBetrag = M + 300;
    const colFaellig = M + 380;

    doc.fontSize(8).font("Helvetica-Bold");
    doc.text("Art", colArt, y);
    doc.text("Nr.", colNr, y);
    doc.text("Rechnungs-Nr.", colInv, y);
    doc.text("Betrag", colBetrag, y);
    doc.text("Fällig", colFaellig, y);
    y += 12;
    doc.moveTo(M, y).lineTo(PW - M, y).strokeColor("#999").lineWidth(0.5).stroke();
    doc.strokeColor("#000");
    y += 6;

    doc.font("Helvetica").fontSize(9);
    for (const line of input.lines.sort((a, b) => a.sequenceNumber - b.sequenceNumber)) {
      const art = line.kind === "deposit" ? "Anzahlung" : `Rate ${line.sequenceNumber}`;
      doc.text(art, colArt, y, { width: 70 });
      doc.text(String(line.sequenceNumber), colNr, y, { width: 40 });
      doc.text(line.invoiceNumber, colInv, y, { width: 160 });
      doc.text(eur(line.amount), colBetrag, y, { width: 70 });
      doc.text(dat(line.dueDate), colFaellig, y, { width: 100 });
      y += 14;
      if (y > PH - 200) {
        doc.addPage();
        y = M;
      }
    }

    y += 16;
    doc.fontSize(8).font("Helvetica-Oblique").text(LEGAL_HINT, M, y, { width: CW, align: "justify" });
    y += 48;

    doc.fontSize(10).font("Helvetica-Bold").text("Erklärung des Kunden", M, y);
    y += 14;
    doc.font("Helvetica").fontSize(9);
    doc.text(
      "Hiermit bestätige ich die oben beschriebene Teilzahlungsvereinbarung und die aufgeführten Beträge sowie Fälligkeitstermine.",
      M,
      y,
      { width: CW }
    );
    y += 36;

    doc.text("Ort, Datum: _______________________________", M, y);
    y += 36;
    doc.text("Unterschrift Kunde: _______________________________", M, y);
    y += 36;
    doc.text("(Name in Druckbuchstaben): _______________________________", M, y);

    doc.end();
  });
}
