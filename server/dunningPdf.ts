/**
 * Dunning (Mahnung) PDF Generator – Layout exakt wie META-Rechnung (PRE_…).
 *
 * Aufbau Seite 1 (wie Vorlage):
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ [Logo-Platz]                 META Regalbau GmbH & Co. KG    │
 *   │                              Eichenkamp · 59759 Arnsberg    │
 *   │                              Telefon · E-Mail · Website     │
 *   │                                                              │
 *   │ META Regalbau … - Eichenkamp - 59759 Arnsberg - Deutschland │
 *   │                                                              │
 *   │ Kundenadresse                Kunden-Nr. / Bestell-Nr. /     │
 *   │                              Bestelldatum / Datum            │
 *   │                                                              │
 *   │ Zahlungserinnerung (Rechnungs-Nr. …)   ← großer Titel      │
 *   │                                                              │
 *   │ [Mahntext]                                                   │
 *   │ [Positionen-Tabelle]                                         │
 *   │                              Netto / MwSt / Gesamtsumme     │
 *   │ ─────────────────────────────────────────────────────────── │
 *   │ [Abtretungstext + Zahlungsblock]                             │
 *   │                                                              │
 *   ├── FOOTER ────────────────────────────────────────────────────┤
 *   │ IdNr/USt/Finanzamt │ Bank/IBAN/BIC │ Gericht/Ort │ GF/Tel  │
 *   └──────────────────────────────────────────────────────────────┘
 */

import type { Order } from "@shared/schema";
import {
  CO,
  M, PW, CW, CONTENT_RIGHT, COL_R, HEADER_TEXT_W, LINE, LINE_SM,
  eur, dat,
  createMetaPdfDocument,
  drawLetterHead,
  drawFooterOnAllPages,
} from "./metaRegalBriefpapier";

const STAGE_LABELS: Record<number, string> = { 1: "Zahlungserinnerung", 2: "1. Mahnung", 3: "2. Mahnung" };

export async function generateDunningPdf(
  order: Order,
  stage: number,
  dueDate: Date,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = createMetaPdfDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const label = STAGE_LABELS[stage] ?? `Mahnstufe ${stage}`;
    const title = stage === 1 ? "Zahlungserinnerung" : label;
    const today = dat(new Date());
    const dueStr = dat(dueDate);
    const refNr = order.invoiceNumber || order.orderNumber || order.id;

    let y = drawLetterHead(doc, M);

    const addrY = y;

    doc.fontSize(10);
    const b = order.billingAddress;
    if (b?.company) { doc.text(b.company, M, y); y += LINE; }
    const custName =
      order.customerName ||
      (b ? `${(b.firstName || "").trim()} ${(b.lastName || "").trim()}`.trim() : "") || "-";
    doc.text(custName, M, y); y += LINE;
    if (b?.street) { doc.text(b.street, M, y); y += LINE; }
    const cl = [b?.zipCode, b?.city].filter(Boolean).join(" ");
    if (cl) { doc.text(cl, M, y); y += LINE; }
    if (b?.country) { doc.text(b.country, M, y); y += LINE; }

    doc.fontSize(9);
    let ry = addrY;
    const custNr = (order as any).customerNumber ?? "";
    if (custNr) {
      doc.text(`Kunden-Nr. ${custNr}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
      ry += LINE_SM;
    }
    doc.text(`Bestell-Nr. ${order.orderNumber || order.id}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
    ry += LINE_SM;
    doc.text(`Bestelldatum ${dat(order.orderDate)}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });
    ry += LINE_SM;
    doc.text(`Datum ${today}`, COL_R, ry, { width: HEADER_TEXT_W, align: "right" });

    y = Math.max(y, ry) + LINE * 2;

    doc.fontSize(16).font("Helvetica-Bold");
    doc.text(`${title}`, M, y);
    y += 22;
    doc.fontSize(11);
    doc.text(`Rechnungs-Nr. ${order.invoiceNumber || order.orderNumber || order.id}`, M, y);
    y += LINE + 4;
    doc.font("Helvetica").fontSize(10);
    y += 6;

    if (stage === 1) {
      doc.text(
        "Wir weisen Sie darauf hin, dass die folgende Rechnung noch offen ist. " +
        "Bitte überweisen Sie den Betrag zeitnah auf das unten angegebene Konto.",
        M, y, { width: CW },
      );
    } else {
      doc.text(
        `Dies ist unsere ${label}. Bitte begleichen Sie den offenen Betrag umgehend ` +
        "auf das unten angegebene Konto, um weitere Maßnahmen zu vermeiden.",
        M, y, { width: CW },
      );
    }
    y += LINE * 3;

    doc.font("Helvetica-Bold").text(`Fällig seit: ${dueStr}`, M, y);
    doc.font("Helvetica");
    y += LINE * 2;

    if (order.items && order.items.length > 0) {
      const colProd = M;
      const colName = M + 110;
      const colAnz = M + 310;
      const colUst = M + 350;
      const colPreis = M + 390;
      const colGes = M + 440;

      doc.fontSize(8).font("Helvetica-Bold");
      doc.text("Prod.-Nr.", colProd, y, { width: 110 });
      doc.text("Produkt / Dienst", colName, y, { width: 200 });
      doc.text("Anzahl", colAnz, y, { width: 40, align: "right" });
      doc.text("USt.", colUst, y, { width: 40, align: "right" });
      doc.text("Stückpreis", colPreis, y, { width: 50, align: "right" });
      doc.text("Gesamt", colGes, y, { width: 55, align: "right" });
      y += LINE_SM;

      doc.fontSize(7).fillColor("#999");
      doc.text("", colPreis, y, { width: 50, align: "right" });
      doc.text("Exkl. MwSt.", colPreis, y, { width: 50, align: "right" });
      doc.text("Exkl. MwSt.", colGes, y, { width: 55, align: "right" });
      doc.fillColor("#000");
      y += LINE_SM;

      doc.font("Helvetica").fontSize(9);
      for (const item of order.items.slice(0, 12)) {
        const nameText = item.name || "";
        const nameHeight = doc.heightOfString(nameText, { width: 200 });
        const rowHeight = Math.max(LINE, nameHeight + 2);

        doc.text(item.productNumber || "", colProd, y, { width: 110 });
        doc.text(nameText, colName, y, { width: 200 });
        doc.text(String(item.quantity), colAnz, y, { width: 40, align: "right" });
        doc.text(`${item.taxRate ?? 19} %`, colUst, y, { width: 40, align: "right" });
        doc.text(eur(item.netPrice ?? item.price), colPreis, y, { width: 50, align: "right" });
        doc.text(eur(item.netTotal ?? item.total), colGes, y, { width: 55, align: "right" });
        y += rowHeight;
      }
      if (order.items.length > 12) {
        doc.fontSize(8).text(`… und ${order.items.length - 12} weitere Positionen`, M, y);
        y += LINE;
      }
    }

    y += 4;

    const net = order.netTotalAmount ?? order.totalAmount / 1.19;
    const tax = (order.totalAmount ?? 0) - net;
    const sumX = COL_R;
    const valX = CONTENT_RIGHT - 70;
    doc.fontSize(9);
    doc.text("Gesamtsumme (Netto):", sumX, y, { width: 130, align: "right" });
    doc.text(eur(net), valX, y, { width: 70, align: "right" });
    y += LINE_SM;
    doc.text("zzgl. 19% MwSt.:", sumX, y, { width: 130, align: "right" });
    doc.text(eur(tax), valX, y, { width: 70, align: "right" });
    y += LINE_SM;
    doc.font("Helvetica-Bold");
    doc.text("Gesamtsumme:", sumX, y, { width: 130, align: "right" });
    doc.text(eur(order.totalAmount ?? 0), valX, y, { width: 70, align: "right" });
    doc.font("Helvetica");
    y += LINE * 2;

    doc.moveTo(M, y).lineTo(PW - M, y).lineWidth(0.5).strokeColor("#ccc").stroke();
    doc.strokeColor("#000");
    y += LINE;

    const payDeadline = new Date();
    payDeadline.setDate(payDeadline.getDate() + 7);
    const payDeadlineStr = dat(payDeadline);

    doc.fontSize(9);
    doc.text(
      `Wir bitten Sie, den offenen Betrag von ${eur(order.totalAmount ?? 0)} bis spätestens ` +
      `zum ${payDeadlineStr} auf das folgende Konto zu überweisen:`,
      M, y, { width: CW },
    );
    y += LINE * 2;

    doc.fontSize(9);
    doc.font("Helvetica-Bold").text("Kontoinhaber: ", M, y, { continued: true });
    doc.font("Helvetica").text(CO.name); y += LINE_SM;
    doc.font("Helvetica-Bold").text("IBAN: ", M, y, { continued: true });
    doc.font("Helvetica").text(CO.iban); y += LINE_SM;
    doc.font("Helvetica-Bold").text("BIC: ", M, y, { continued: true });
    doc.font("Helvetica").text(CO.bic); y += LINE_SM;
    doc.font("Helvetica-Bold").text("Bank: ", M, y, { continued: true });
    doc.font("Helvetica").text(CO.bank); y += LINE_SM;
    doc.font("Helvetica-Bold").text("Verwendungszweck: ", M, y, { continued: true });
    doc.font("Helvetica").text(refNr);

    drawFooterOnAllPages(doc);
    doc.end();
  });
}
