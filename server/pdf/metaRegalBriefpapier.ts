/**
 * Zentrales Briefpapier-Modul für alle META-Regalbau-PDFs.
 *
 * Exportiert Firmendaten, Layout-Konstanten, Formatierungshelfer,
 * Briefkopf (Logo + Adressblock + Absenderzeile) und 4-Spalten-Fußzeile.
 */

import PDFDocument from "pdfkit";
import { drawPdfHeaderLogo } from "./pdfLogo";
import {
  metaRegalA4ContentMargins,
  metaRegalFooterLayout,
  PDFKIT_A4_HEIGHT_PT,
} from "./metaRegalPdfLayout";

// ── Firmendaten ──────────────────────────────────────────────────

export const CO = {
  name: "META Regalbau GmbH & Co. KG",
  street: "Eichenkamp",
  zip: "59759",
  city: "Arnsberg",
  country: "Deutschland",
  phone: "029329573393",
  email: "shop@meta-online.com",
  web: "shop.meta-online.com",
  idNr: "009 342 60142",
  ustIdNr: "DE111797160",
  finanzamt: "Arnsberg",
  bank: "Deutsche Bank Arnsberg",
  iban: "DE83466700070554477000",
  bic: "BIC/SWIFT DEUTDEDW466",
  gerichtsstand: "Arnsberg HRA 1551",
  erfuellungsort: "Arnsberg",
  gf: "Dr. Klaus Vatter, Rainer Haupt",
  payee: "Mondu Capital Sàrl",
  payIban: "DE29502109007050318243",
  payBic: "CITIDEFFXXX",
} as const;

// ── Layout-Konstanten (A4, 50 pt Rand) ──────────────────────────

export const M = 50;
export const PW = 595;
export const PH = PDFKIT_A4_HEIGHT_PT;
export const CW = PW - 2 * M;
export const CONTENT_RIGHT = PW - M;
export const COL_R = 340;
export const HEADER_TEXT_W = CONTENT_RIGHT - COL_R;
export const LINE = 12;
export const LINE_SM = 11;

// ── Formatierungshelfer ──────────────────────────────────────────

export function eur(v: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(v);
}

export function dat(v: Date | string | null | undefined): string {
  if (v == null) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ── PDFDocument-Factory ──────────────────────────────────────────

export function createMetaPdfDocument(
  opts?: Record<string, unknown>,
): PDFKit.PDFDocument {
  return new PDFDocument({
    size: "A4",
    margins: metaRegalA4ContentMargins(M),
    bufferPages: true,
    ...opts,
  });
}

// ── Briefkopf (Logo + Firmenadresse rechts + Absenderzeile) ─────

/**
 * Zeichnet den kompletten Briefkopf und gibt die Y-Position
 * direkt unterhalb der Absenderzeile zurück (= Start Empfängeradresse).
 */
export function drawLetterHead(doc: PDFKit.PDFDocument, y: number): number {
  drawPdfHeaderLogo(doc, M, y);

  doc.fontSize(10).font("Helvetica-Bold");
  doc.text(CO.name, COL_R, y, { width: HEADER_TEXT_W, align: "right" });
  doc.font("Helvetica").fontSize(9);
  doc.text(CO.street, COL_R, y + LINE, { width: HEADER_TEXT_W, align: "right" });
  doc.text(`${CO.zip} ${CO.city}`, COL_R, y + LINE * 2, { width: HEADER_TEXT_W, align: "right" });
  doc.text(CO.country, COL_R, y + LINE * 3, { width: HEADER_TEXT_W, align: "right" });
  doc.text(`Telefon ${CO.phone}`, COL_R, y + LINE * 4, { width: HEADER_TEXT_W, align: "right" });
  doc.text(CO.email, COL_R, y + LINE * 5, { width: HEADER_TEXT_W, align: "right" });
  doc.text(CO.web, COL_R, y + LINE * 6, { width: HEADER_TEXT_W, align: "right" });

  y += LINE * 8;

  doc.fontSize(7).fillColor("#666");
  doc.text(
    `${CO.name} · ${CO.street} · ${CO.zip} ${CO.city} · ${CO.country}`,
    M,
    y,
    { width: CW },
  );
  doc.fillColor("#000");
  return doc.y + 2;
}

// ── Fußzeile (4-spaltig, lineBreak:false) ────────────────────────

function footerLine(
  doc: PDFKit.PDFDocument,
  str: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  let s = str;
  if (doc.widthOfString(s) > maxWidth) {
    while (s.length > 0) {
      s = s.slice(0, -1);
      const t = s.length ? s + "…" : "…";
      if (doc.widthOfString(t) <= maxWidth) {
        s = t;
        break;
      }
    }
  }
  doc.text(s, x, y, { lineBreak: false });
}

function footerLineRight(
  doc: PDFKit.PDFDocument,
  str: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  let s = str;
  if (doc.widthOfString(s) > maxWidth) {
    while (s.length > 0) {
      s = s.slice(0, -1);
      const t = s.length ? s + "…" : "…";
      if (doc.widthOfString(t) <= maxWidth) {
        s = t;
        break;
      }
    }
  }
  const w = doc.widthOfString(s);
  doc.text(s, x + maxWidth - w, y, { lineBreak: false });
}

export function drawFooterOnPage(
  doc: PDFKit.PDFDocument,
  page: number,
  totalPages: number,
): void {
  const { fy, footY } = metaRegalFooterLayout(PH);
  doc
    .moveTo(M, fy)
    .lineTo(PW - M, fy)
    .lineWidth(0.5)
    .strokeColor("#999")
    .stroke();
  doc.strokeColor("#000");
  const colW = CW / 4;
  doc.fontSize(6.5).font("Helvetica");

  let x = M;
  doc.font("Helvetica-Bold");
  footerLine(doc, CO.name, x, footY, colW);
  doc.font("Helvetica");
  footerLine(doc, `IdNr.: ${CO.idNr}`, x, footY + 9, colW);
  footerLine(doc, `USt-IdNr.: ${CO.ustIdNr}`, x, footY + 17, colW);
  footerLine(doc, `Finanzamt: ${CO.finanzamt}`, x, footY + 25, colW);

  x = M + colW;
  doc.font("Helvetica-Bold");
  footerLine(doc, "Bankverbindung", x, footY, colW);
  doc.font("Helvetica");
  footerLine(doc, CO.bank, x, footY + 9, colW);
  footerLine(doc, `IBAN: ${CO.iban}`, x, footY + 17, colW);
  footerLine(doc, `BIC: ${CO.bic}`, x, footY + 25, colW);

  x = M + colW * 2;
  doc.font("Helvetica-Bold");
  footerLine(doc, `Gerichtsstand: ${CO.gerichtsstand}`, x, footY, colW);
  footerLine(doc, `Erfüllungsort: ${CO.erfuellungsort}`, x, footY + 9, colW);

  x = M + colW * 3;
  doc.font("Helvetica-Bold");
  footerLine(doc, "Geschäftsführer", x, footY, colW);
  doc.font("Helvetica");
  footerLine(doc, CO.gf, x, footY + 9, colW);
  footerLine(doc, CO.phone, x, footY + 17, colW);
  footerLineRight(doc, `Seite ${page} / ${totalPages}`, x, footY + 25, colW);
}

/**
 * Convenience: Footer auf jede gepufferte Seite zeichnen.
 * Voraussetzung: `bufferPages: true` beim Erstellen des Dokuments.
 */
export function drawFooterOnAllPages(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooterOnPage(doc, i + 1, range.count);
  }
}
