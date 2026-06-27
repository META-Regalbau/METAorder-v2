/**
 * PDF: Angebot mit MetaCalc-Konfiguration (Stückliste, Konfigurationsbild).
 * Layout angelehnt an installmentInvoicePdf (META Regalbau).
 */

import type { OrderAddress } from "@shared/schema";
import {
  CO,
  M, PW, CW, CONTENT_RIGHT, COL_R, HEADER_TEXT_W, LINE, LINE_SM,
  eur, dat,
  createMetaPdfDocument,
  drawLetterHead,
  drawFooterOnPage,
} from "./metaRegalBriefpapier";
import { metaRegalPageContentMaxY } from "./metaRegalPdfLayout";
import { OFFER_GENERAL_TERMS_MARKDOWN_DE } from "./offerConfigPdfTermsDe";
import { drawGeneralOfferTermsMarkdown } from "./offerConfigPdfTermsMarkdown";

const BOM_TABLE_CHUNK_ROWS = 3;

/** Genug Platz für `needed` pt ab y; nutzt `page.maxY()` (Fußbereich wie PDFKit-Rand unten). */
function ensureContentY(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (needed <= 0) return y;
  const maxY = metaRegalPageContentMaxY(doc);
  if (y + needed <= maxY) return y;
  doc.addPage();
  return doc.page.margins.top;
}

/** Höhe eines Textblocks bei gegebener Breite (für Tabellenzeilen ohne Auto-Seitenumbruch). */
function measuredTextHeight(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  lineGap: number,
): number {
  const s = text.length ? text : "—";
  return Math.max(LINE_SM, doc.heightOfString(s, { width, lineGap }));
}

export type OfferConfigPdfLineItem = {
  label: string;
  productNumber: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxRate: number;
  config?: {
    name: string;
    description: string;
    imageBase64: string | null;
    installationTimeMinutes: number;
    partsList: Array<{
      productNumber: string | null;
      name: string;
      quantity: number;
    }>;
    accessoryList: Array<{
      productNumber: string | null;
      name: string;
      quantity: number;
    }>;
  };
};

export type OfferConfigPdfInput = {
  offerNumber: string;
  customerName: string;
  customerEmail?: string;
  /** Shopware-Kundennummer (rechts im Kopf neben Angebot Nr.) */
  customerNumber?: string;
  /** Vollständige Rechnungs-/Lieferanschrift unter der Absenderzeile */
  billingAddress?: OrderAddress;
  createdAt: string;
  expirationDate?: string;
  /** Summe Netto aller Produktpositionen (ohne Versand/Montage) */
  productsNetSubtotal: number;
  shippingCostsNet: number;
  shippingCostsGross: number;
  montageCostNet: number;
  montageCostGross: number;
  montageDescription: string;
  /** Umsatzsteuerbetrag auf (Produkte + Versand + Montage) Netto */
  vatAmount: number;
  /** Bruttosumme */
  grossTotal: number;
  /** Anzuwendender MwSt.-Satz in % (Anzeige) */
  displayTaxRate: number;
  lineItems: OfferConfigPdfLineItem[];
  /** gesetzt von enrichOfferConfigPdfInputWithTexts */
  offerIntroText?: string;
  offerSystemInfoTitle?: string;
  offerSystemInfoText?: string;
  offerStandardClosingTitle?: string;
  offerStandardClosingText?: string;
  shelvingSystemKey?: string;
  /** Druck- und Schnellübersichts-Optionen (Query-Parameter / Dialog) */
  layoutOptions?: OfferConfigPdfLayoutOptions;
};

/** Steuert Schnellübersicht und Folgeseiten (MetaCalc-Positionen). */
export type OfferConfigPdfLayoutOptions = {
  /** Montagezeile in der Summe; bei false: aus Summe/MwSt. herausgerechnet */
  showMontageLineInOverview: boolean;
  /** Versandzeile in der Summe; bei false: aus Summe/MwSt. herausgerechnet */
  showShippingLineInOverview: boolean;
  /** Einzelpreis-Spalte „Einzel (netto)“ in der Schnellübersicht; Gesamt netto pro Zeile und Netto-Summen bleiben sichtbar. */
  overviewShowUnitPrices: boolean;
  /** Zeilen „zzgl. USt.“ und „Gesamtbetrag (brutto)“ unter der Schnellübersicht */
  overviewShowVatAndGross: boolean;
  detailIncludeImage: boolean;
  detailIncludeDescription: boolean;
  detailIncludePartsList: boolean;
  detailIncludeAccessoryList: boolean;
};

export const DEFAULT_OFFER_CONFIG_PDF_LAYOUT: OfferConfigPdfLayoutOptions = {
  showMontageLineInOverview: true,
  showShippingLineInOverview: true,
  overviewShowUnitPrices: true,
  overviewShowVatAndGross: true,
  detailIncludeImage: true,
  detailIncludeDescription: true,
  detailIncludePartsList: true,
  detailIncludeAccessoryList: true,
};

function parseCfgQueryBool(v: unknown, defaultTrue: boolean): boolean {
  if (v === undefined || v === null || v === "") return defaultTrue;
  const s = String(v).toLowerCase();
  if (["0", "false", "no", "off"].includes(s)) return false;
  if (["1", "true", "yes", "on"].includes(s)) return true;
  return defaultTrue;
}

/**
 * Wendet cfgMontage, cfgShip, cfgUnitPrice, cfgVatGross, cfgImg, cfgDesc, cfgBom, cfgAcc aus der Request-Query an
 * und passt Netto/Brutto/MwSt. an, wenn Montage oder Versand ausgeblendet werden.
 */
export function applyOfferConfigPdfLayoutFromRequest(
  input: OfferConfigPdfInput,
  query: Record<string, unknown>,
): OfferConfigPdfInput {
  const layout: OfferConfigPdfLayoutOptions = {
    showMontageLineInOverview: parseCfgQueryBool(query.cfgMontage, true),
    showShippingLineInOverview: parseCfgQueryBool(query.cfgShip, true),
    overviewShowUnitPrices: parseCfgQueryBool(query.cfgUnitPrice, true),
    overviewShowVatAndGross: parseCfgQueryBool(query.cfgVatGross, true),
    detailIncludeImage: parseCfgQueryBool(query.cfgImg, true),
    detailIncludeDescription: parseCfgQueryBool(query.cfgDesc, true),
    detailIncludePartsList: parseCfgQueryBool(query.cfgBom, true),
    detailIncludeAccessoryList: parseCfgQueryBool(query.cfgAcc, true),
  };

  const rate = input.displayTaxRate / 100;
  const shipN = layout.showShippingLineInOverview ? input.shippingCostsNet : 0;
  const montN = layout.showMontageLineInOverview ? input.montageCostNet : 0;
  const netBefore = input.productsNetSubtotal + shipN + montN;
  const vatAmount = netBefore * rate;
  const grossTotal = netBefore + vatAmount;

  return {
    ...input,
    shippingCostsNet: shipN,
    montageCostNet: montN,
    shippingCostsGross: shipN * (1 + rate),
    montageCostGross: montN * (1 + rate),
    vatAmount,
    grossTotal,
    layoutOptions: layout,
  };
}

function resolvedLayout(input: OfferConfigPdfInput): OfferConfigPdfLayoutOptions {
  return { ...DEFAULT_OFFER_CONFIG_PDF_LAYOUT, ...input.layoutOptions };
}

function formatRecipientAddressLines(input: OfferConfigPdfInput): string[] {
  const lines: string[] = [];
  const a = input.billingAddress;
  if (a?.company?.trim()) lines.push(a.company.trim());
  const person = [a?.firstName, a?.lastName].filter((p) => p?.trim()).join(" ");
  if (person.trim()) lines.push(person.trim());
  if (a?.street?.trim()) lines.push(a.street.trim());
  const cityLine = [a?.zipCode, a?.city].filter((p) => p?.trim()).join(" ");
  if (cityLine.trim()) lines.push(cityLine.trim());
  if (a?.country?.trim()) lines.push(a.country.trim());
  if (a?.phoneNumber?.trim()) lines.push(`Tel. ${a.phoneNumber.trim()}`);
  if (!lines.length && input.customerName?.trim()) lines.push(input.customerName.trim());
  if (input.customerEmail?.trim()) lines.push(input.customerEmail.trim());
  return lines.length ? lines : ["—"];
}

function parseDataUrlImage(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/i);
  if (!match) return null;
  try {
    return Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
}

function drawHeaderBlock(doc: PDFKit.PDFDocument, input: OfferConfigPdfInput): number {
  let y = drawLetterHead(doc, M);

  const addrY = y;
  const leftAddrW = COL_R - M - 14;
  doc.fontSize(10).font("Helvetica");
  const addrBlock = formatRecipientAddressLines(input).join("\n");
  const hAddr = measuredTextHeight(doc, addrBlock, leftAddrW, 2);
  doc.text(addrBlock, M, addrY, { width: leftAddrW, lineGap: 2, height: hAddr });
  let yLeft = addrY + hAddr;

  let ry = addrY;
  doc.fontSize(9);
  const line1 = `Angebot Nr. ${input.offerNumber}`;
  const h1 = measuredTextHeight(doc, line1, HEADER_TEXT_W, 1);
  doc.text(line1, COL_R, ry, { width: HEADER_TEXT_W, align: "right", lineGap: 1, height: h1 });
  ry += h1 + 2;
  if (input.customerNumber?.trim()) {
    const lineCust = `Kunden-Nr. ${input.customerNumber.trim()}`;
    const hCustNr = measuredTextHeight(doc, lineCust, HEADER_TEXT_W, 1);
    doc.text(lineCust, COL_R, ry, { width: HEADER_TEXT_W, align: "right", lineGap: 1, height: hCustNr });
    ry += hCustNr + 2;
  }
  const line2 = `Datum ${dat(input.createdAt)}`;
  const h2 = measuredTextHeight(doc, line2, HEADER_TEXT_W, 1);
  doc.text(line2, COL_R, ry, { width: HEADER_TEXT_W, align: "right", lineGap: 1, height: h2 });
  ry += h2 + 2;
  if (input.expirationDate) {
    const line3 = `Gültig bis ${dat(input.expirationDate)}`;
    const h3 = measuredTextHeight(doc, line3, HEADER_TEXT_W, 1);
    doc.text(line3, COL_R, ry, { width: HEADER_TEXT_W, align: "right", lineGap: 1, height: h3 });
    ry += h3;
  }

  y = Math.max(yLeft, ry) + LINE * 2;

  doc.fontSize(16).font("Helvetica-Bold");
  const titleLine = `Angebot ${input.offerNumber}`;
  const titleH = measuredTextHeight(doc, titleLine, CW, 2);
  y = ensureContentY(doc, y, titleH + 8);
  doc.text(titleLine, M, y, { width: CW, lineGap: 2, height: titleH });
  y += titleH + 12;

  return y;
}

/** Jeder „/“ wird Zeilenumbruch; `://` in URLs bleibt erhalten. */
function descriptionSlashesToNewlines(text: string): string {
  const ph = "@@URLSCHEME@@";
  return text
    .replace(/:\/\//g, ph)
    .split("/")
    .map((part) => part.split(ph).join("://").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Beschreibung in logische Abschnitte teilen: Leerzeile im Quelltext, oder neue Abschnitte
 * vor „Abschnitt:“ / „Zubehör:“ (wie MetaCalc-Export).
 */
function splitConfigDescriptionIntoSections(raw: string): string[] {
  let t = descriptionSlashesToNewlines((raw || "").trim() || "—");
  t = t.replace(/\r\n/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");

  let parts = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

  if (parts.length <= 1) {
    const lines = t.split("\n");
    const sections: string[] = [];
    let buf: string[] = [];

    const isSectionStartLine = (line: string) => {
      const s = line.trim();
      if (/^Abschnitt\s*:/i.test(s)) return true;
      if (/^Zubehör\s*:?/i.test(s)) return true;
      if (/^konfiguriertes[\s_-]*zubehör/i.test(s)) return true;
      return false;
    };

    for (const line of lines) {
      if (isSectionStartLine(line) && buf.length > 0) {
        const joined = buf.join("\n").trim();
        if (joined) sections.push(joined);
        buf = [line];
      } else {
        buf.push(line);
      }
    }
    if (buf.length) {
      const joined = buf.join("\n").trim();
      if (joined) sections.push(joined);
    }
    if (sections.length > 1) parts = sections;
  }

  return parts.length ? parts : [t.trim()];
}

/** Tabellarisch: feste Label-Spalte, Werte bündig in der zweiten Spalte. */
const DESC_LABEL_COL_W = 218;
const DESC_TABLE_GAP = 12;

/**
 * Eine Beschreibungs-Sektion: Zeilen mit „:“ als zweispaltige Tabelle; sonst volle Breite.
 */
function drawConfigDescriptionInColumn(
  doc: PDFKit.PDFDocument,
  yStart: number,
  sectionBody: string,
  colX: number,
  colW: number,
  fontSize: number,
  lineGap: number,
): number {
  let y = yStart;

  const normalized = sectionBody.replace(/\r\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
  let lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) lines = [normalized || "—"];

  const lineTailGap = 2;
  const labelW = Math.min(DESC_LABEL_COL_W, Math.max(120, colW - 80 - DESC_TABLE_GAP));
  const valueX = colX + labelW + DESC_TABLE_GAP;
  const valueW = Math.max(80, colW - labelW - DESC_TABLE_GAP);

  for (const line of lines) {
    doc.fontSize(fontSize);
    const colonIdx = line.indexOf(":");

    if (colonIdx < 0) {
      const estH = Math.max(fontSize + lineGap, doc.heightOfString(line, { width: colW, lineGap }));
      y = ensureContentY(doc, y, estH);
      doc.font("Helvetica");
      const h = doc.heightOfString(line, { width: colW, lineGap });
      doc.text(line, colX, y, { width: colW, lineGap, height: h });
      y += h + lineTailGap;
      continue;
    }

    const beforeRaw = line.slice(0, colonIdx + 1);
    const after = line.slice(colonIdx + 1).trim();

    if (!after.length) {
      const estH = Math.max(fontSize + lineGap, doc.heightOfString(line, { width: colW, lineGap }));
      y = ensureContentY(doc, y, estH);
      doc.font("Helvetica");
      const h = doc.heightOfString(line, { width: colW, lineGap });
      doc.text(line, colX, y, { width: colW, lineGap, height: h });
      y += h + lineTailGap;
      continue;
    }

    doc.font("Helvetica");
    const hLabel = doc.heightOfString(beforeRaw, { width: labelW, lineGap });
    doc.font("Helvetica-Bold");
    const hVal = doc.heightOfString(after, { width: valueW, lineGap });
    doc.font("Helvetica");
    const rowH = Math.max(hLabel, hVal) + lineTailGap;
    y = ensureContentY(doc, y, rowH);

    doc.text(beforeRaw, colX, y, { width: labelW, lineGap, height: hLabel });
    doc.font("Helvetica-Bold");
    doc.text(after, valueX, y, { width: valueW, lineGap, height: hVal });
    doc.font("Helvetica");
    y += rowH;
  }

  return y;
}

function descriptionSectionFirstLine(section: string): string {
  return section.trim().split("\n")[0]?.trim() ?? "";
}

function isZubehoerDescriptionSection(section: string): boolean {
  const head = descriptionSectionFirstLine(section);
  return /^Zubehör\s*:?/i.test(head) || /^konfiguriertes[\s_-]*zubehör/i.test(head);
}

/** Volle Breite: mehrere Abschnitte, dazwischen ein Zeilenabstand; extra Abstand vor Zubehör. */
function drawConfigDescriptionSectioned(
  doc: PDFKit.PDFDocument,
  yStart: number,
  rawBody: string,
  fontSize: number,
  lineGap: number,
): number {
  const sections = splitConfigDescriptionIntoSections(rawBody);
  let y = yStart;
  const betweenSections = fontSize + lineGap;

  for (let i = 0; i < sections.length; i++) {
    if (i > 0) {
      y += betweenSections;
      if (isZubehoerDescriptionSection(sections[i])) {
        y += betweenSections;
      }
    }
    y = drawConfigDescriptionInColumn(doc, y, sections[i], M, CW, fontSize, lineGap);
  }
  return y;
}

/**
 * Ein Absatz mit manueller Seitenaufteilung (feste Höhe pro Teil) —
 * verhindert PDFKit-interne continueOnNewPage-Geisterseiten.
 */
function drawParagraphFitted(
  doc: PDFKit.PDFDocument,
  yStart: number,
  paragraph: string,
  fontSize: number,
  lineGap: number,
): number {
  return drawParagraphFittedInColumn(doc, yStart, paragraph, fontSize, lineGap, M, CW, false);
}

/**
 * Wie drawParagraphFitted, aber mit freier Spalte. Nach dem ersten Seitenumbruch optional volle Breite (Text unter/losgelöst vom Bild).
 */
function drawParagraphFittedInColumn(
  doc: PDFKit.PDFDocument,
  yStart: number,
  paragraph: string,
  fontSize: number,
  lineGap: number,
  colX: number,
  colW: number,
  useFullWidthAfterPageBreak: boolean,
): number {
  let x = colX;
  let w = colW;
  let y = yStart;
  let remaining = paragraph;
  if (!remaining.trim()) return y;
  doc.font("Helvetica").fontSize(fontSize);
  let brokePage = false;

  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (!remaining) break;
    y = ensureContentY(doc, y, LINE_SM);
    let room = metaRegalPageContentMaxY(doc) - y;
    if (room < LINE_SM + 2) {
      doc.addPage();
      y = doc.page.margins.top;
      room = metaRegalPageContentMaxY(doc) - y;
      if (useFullWidthAfterPageBreak && !brokePage) {
        brokePage = true;
        x = M;
        w = CW;
      }
    }

    let lo = 1;
    let hi = remaining.length;
    let best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const slice = remaining.slice(0, mid);
      const h = doc.heightOfString(slice, { width: w, lineGap });
      if (h <= room) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (best === 0) {
      doc.addPage();
      y = doc.page.margins.top;
      if (useFullWidthAfterPageBreak && !brokePage) {
        brokePage = true;
        x = M;
        w = CW;
      }
      continue;
    }

    const chunk = remaining.slice(0, best);
    const h = doc.heightOfString(chunk, { width: w, lineGap });
    doc.text(chunk, x, y, { width: w, lineGap, height: h });
    remaining = remaining.slice(best).trimStart();
    y = doc.y + lineGap + 2;
  }
  return y;
}

/** Fließtext mit Absätzen (Leerzeile = Abstand). */
function drawFlowingMultiparagraph(
  doc: PDFKit.PDFDocument,
  y: number,
  body: string,
  fontSize: number,
  lineGap: number,
): number {
  const text = (body || "").trim();
  if (!text) return y;
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim().replace(/\n/g, " ")).filter(Boolean);
  for (const para of paragraphs) {
    y = drawParagraphFitted(doc, y, para, fontSize, lineGap);
    y += lineGap + 2;
  }
  return y;
}

function drawOfferIntro(doc: PDFKit.PDFDocument, y: number, input: OfferConfigPdfInput): number {
  const intro = input.offerIntroText?.trim();
  if (!intro) return y;
  y = drawFlowingMultiparagraph(doc, y, intro, 10, 4);
  return y + 8;
}

function drawQuickOverviewHeading(doc: PDFKit.PDFDocument, y: number): number {
  doc.font("Helvetica-Bold").fontSize(10);
  const h = measuredTextHeight(doc, "Schnellübersicht", CW, 2);
  y = ensureContentY(doc, y, h + 10);
  doc.text("Schnellübersicht", M, y, { width: CW, lineGap: 2, height: h });
  return y + h + 10;
}

function drawClosingAppendix(
  doc: PDFKit.PDFDocument,
  input: OfferConfigPdfInput,
  startY: number,
): number {
  const sys = input.offerSystemInfoText?.trim();
  const std = input.offerStandardClosingText?.trim();
  if (!sys && !std) return startY;

  let y = startY + 14;

  const drawBlock = (title: string | undefined, body: string) => {
    if (!body) return;
    if (title) {
      doc.font("Helvetica-Bold").fontSize(12);
      const th = measuredTextHeight(doc, title, CW, 2);
      y = ensureContentY(doc, y, th + 8);
      doc.text(title, M, y, { width: CW, lineGap: 2, height: th });
      y += th + 10;
    }
    y = drawFlowingMultiparagraph(doc, y, body, 9, 3);
    y += 10;
  };

  drawBlock(input.offerSystemInfoTitle, sys || "");
  drawBlock(input.offerStandardClosingTitle, std || "");
  return y;
}

function drawOverviewTable(doc: PDFKit.PDFDocument, input: OfferConfigPdfInput, startY: number): number {
  const layout = resolvedLayout(input);
  const showUnitColumn = layout.overviewShowUnitPrices;
  const showVatAndGross = layout.overviewShowVatAndGross ?? true;
  let y = startY;
  /** Spalten enden bündig an {@link CONTENT_RIGHT}; keine Art.-Nr. in der Schnellübersicht. */
  const g = 3;
  const wPos = 28;
  const wMenge = 36;
  const wEinzel = 80;
  const wGesamt = 80;
  let colPos: number;
  let colBez: number;
  let wBez: number;
  let colMenge: number;
  let colEinzel: number;
  let colGesamt: number;
  if (showUnitColumn) {
    wBez = 259;
    let x = M;
    colPos = x;
    x += wPos + g;
    colBez = x;
    x += wBez + g;
    colMenge = x;
    x += wMenge + g;
    colEinzel = x;
    x += wEinzel + g;
    colGesamt = x;
    if (colGesamt + wGesamt !== CONTENT_RIGHT) {
      throw new Error("offerConfigPdf: overview columns must end at CONTENT_RIGHT");
    }
  } else {
    colGesamt = CONTENT_RIGHT - wGesamt;
    colMenge = colGesamt - g - wMenge;
    wBez = colMenge - g - (M + wPos + g);
    colPos = M;
    colBez = colPos + wPos + g;
    colEinzel = colMenge;
    if (wBez < 120) {
      throw new Error("offerConfigPdf: overview Bezeichnung column too narrow");
    }
  }
  const rowLineGap = 2;
  const rowPad = 4;

  doc.fontSize(8).font("Helvetica-Bold");
  const headHeights = [
    measuredTextHeight(doc, "Pos.", wPos, rowLineGap),
    measuredTextHeight(doc, "Bezeichnung", wBez, rowLineGap),
    measuredTextHeight(doc, "Menge", wMenge, rowLineGap),
  ];
  if (showUnitColumn) {
    headHeights.push(
      measuredTextHeight(doc, "Einzel (netto)", wEinzel, rowLineGap),
      measuredTextHeight(doc, "Gesamt (netto)", wGesamt, rowLineGap),
    );
  } else {
    headHeights.push(measuredTextHeight(doc, "Gesamt (netto)", wGesamt, rowLineGap));
  }
  const headH = Math.max(...headHeights);
  y = ensureContentY(doc, y, headH + 8);
  doc.text("Pos.", colPos, y, { width: wPos, lineGap: rowLineGap, height: headH });
  doc.text("Bezeichnung", colBez, y, { width: wBez, lineGap: rowLineGap, height: headH });
  doc.text("Menge", colMenge, y, { width: wMenge, align: "right", lineGap: rowLineGap, height: headH });
  if (showUnitColumn) {
    doc.text("Einzel (netto)", colEinzel, y, { width: wEinzel, align: "right", lineGap: rowLineGap, height: headH });
  }
  doc.text("Gesamt (netto)", colGesamt, y, { width: wGesamt, align: "right", lineGap: rowLineGap, height: headH });
  y += headH + 2;
  doc.moveTo(M, y).lineTo(PW - M, y).stroke();
  y += 4;

  doc.font("Helvetica").fontSize(8);
  let pos = 1;
  for (const row of input.lineItems) {
    const tPos = String(pos);
    const tLabel = row.label || "—";
    const tMenge = String(row.quantity);
    const tEinzel = eur(row.unitPrice);
    const tGesamt = eur(row.totalPrice);

    const h1 = measuredTextHeight(doc, tPos, wPos, rowLineGap);
    const h2 = measuredTextHeight(doc, tLabel, wBez, rowLineGap);
    const h4 = measuredTextHeight(doc, tMenge, wMenge, rowLineGap);
    const heights = [h1, h2, h4];
    let h5 = 0;
    let h6 = 0;
    if (showUnitColumn) {
      h5 = measuredTextHeight(doc, tEinzel, wEinzel, rowLineGap);
      heights.push(h5);
    }
    h6 = measuredTextHeight(doc, tGesamt, wGesamt, rowLineGap);
    heights.push(h6);
    const rowH = Math.max(...heights) + rowPad;

    y = ensureContentY(doc, y, rowH);
    const rowTop = y;
    doc.text(tPos, colPos, rowTop, { width: wPos, lineGap: rowLineGap, height: h1 });
    doc.text(tLabel, colBez, rowTop, { width: wBez, lineGap: rowLineGap, height: h2 });
    doc.text(tMenge, colMenge, rowTop, { width: wMenge, align: "right", lineGap: rowLineGap, height: h4 });
    if (showUnitColumn) {
      doc.text(tEinzel, colEinzel, rowTop, { width: wEinzel, align: "right", lineGap: rowLineGap, height: h5 });
    }
    doc.text(tGesamt, colGesamt, rowTop, { width: wGesamt, align: "right", lineGap: rowLineGap, height: h6 });
    y = rowTop + rowH;
    pos += 1;
  }

  y += 6;
  y = ensureContentY(doc, y, 12);
  const summaryLabelW = 130;
  const labelX = (showUnitColumn ? colEinzel : colGesamt) - summaryLabelW - 6;
  doc.moveTo(labelX, y).lineTo(CONTENT_RIGHT, y).stroke();
  y += 8;

  const labelW = summaryLabelW;
  const valX = colGesamt;
  doc.font("Helvetica").fontSize(9);

  const drawSummaryRow = (label: string, value: string, extraPad = 2) => {
    const hL = measuredTextHeight(doc, label, labelW, rowLineGap);
    const hV = measuredTextHeight(doc, value, 80, rowLineGap);
    const rh = Math.max(hL, hV) + extraPad;
    y = ensureContentY(doc, y, rh);
    const top = y;
    doc.text(label, labelX, top, { width: labelW, lineGap: rowLineGap, height: hL });
    doc.text(value, valX, top, { width: 80, align: "right", lineGap: rowLineGap, height: hV });
    y = top + rh;
  };

  drawSummaryRow("Zwischensumme Positionen (netto)", eur(input.productsNetSubtotal));
  if (input.shippingCostsNet > 0.001) {
    drawSummaryRow("Versandkosten (netto)", eur(input.shippingCostsNet));
  }
  if (input.montageCostNet > 0.001) {
    drawSummaryRow(`Montage (${input.montageDescription}) (netto)`, eur(input.montageCostNet), 4);
  }

  const netBeforeVat = input.productsNetSubtotal + input.shippingCostsNet + input.montageCostNet;
  drawSummaryRow("Summe netto", eur(netBeforeVat));

  if (showVatAndGross) {
    drawSummaryRow(`zzgl. USt. (${input.displayTaxRate} %)`, eur(input.vatAmount), 6);

    doc.font("Helvetica-Bold").fontSize(11);
    const grossLabel = "Gesamtbetrag (brutto)";
    const grossVal = eur(input.grossTotal);
    const hGL = measuredTextHeight(doc, grossLabel, labelW, rowLineGap);
    const hGV = measuredTextHeight(doc, grossVal, 80, rowLineGap);
    const gRow = Math.max(hGL, hGV) + 4;
    y = ensureContentY(doc, y, gRow);
    const gTop = y;
    doc.text(grossLabel, labelX, gTop, { width: labelW, lineGap: rowLineGap, height: hGL });
    doc.text(grossVal, valX, gTop, { width: 80, align: "right", lineGap: rowLineGap, height: hGV });
    y = gTop + gRow;
    doc.font("Helvetica").fontSize(9);
  }

  return y + LINE * 2;
}

function drawConfigSection(
  doc: PDFKit.PDFDocument,
  item: OfferConfigPdfLineItem,
  index: number,
  startY: number,
  layout: OfferConfigPdfLayoutOptions,
): number {
  let y = startY;
  const rowLineGap = 2;
  const rowPad = 3;

  doc.fontSize(14).font("Helvetica-Bold");
  const title = `Position ${index + 1}: ${item.label}`;
  const titleH = measuredTextHeight(doc, title, CW, rowLineGap);
  y = ensureContentY(doc, y, titleH + 6);
  doc.text(title, M, y, { width: CW, lineGap: rowLineGap, height: titleH });
  y += titleH + 10;

  if (layout.detailIncludeImage) {
    const imgMaxW = Math.min(CW, 468);
    const imgMaxH = 248;
    const imgBuf = parseDataUrlImage(item.config?.imageBase64 || null);
    let imgDrawH = 0;

    y = ensureContentY(doc, y, Math.min(imgMaxH, metaRegalPageContentMaxY(doc) - y) + 6);

    if (imgBuf) {
      try {
        const im = (doc as PDFKit.PDFDocument & { openImage: (b: Buffer) => { width: number; height: number } }).openImage(
          imgBuf,
        );
        const scale = Math.min(imgMaxW / im.width, imgMaxH / im.height, 1);
        const dw = im.width * scale;
        const dh = im.height * scale;
        doc.image(imgBuf, M, y, { width: dw, height: dh });
        imgDrawH = dh;
      } catch {
        doc.font("Helvetica").fontSize(9).fillColor("#999");
        const h = measuredTextHeight(doc, "(Bild konnte nicht geladen werden)", CW, rowLineGap);
        doc.text("(Bild konnte nicht geladen werden)", M, y, {
          width: CW,
          lineGap: rowLineGap,
          height: h,
        });
        doc.fillColor("#000");
        imgDrawH = h;
      }
    } else {
      doc.font("Helvetica").fontSize(9).fillColor("#999");
      const h = measuredTextHeight(doc, "(Kein Konfigurationsbild)", CW, rowLineGap);
      doc.text("(Kein Konfigurationsbild)", M, y, { width: CW, lineGap: rowLineGap, height: h });
      doc.fillColor("#000");
      imgDrawH = h;
    }

    y += imgDrawH + 14;
  } else {
    y += 4;
  }

  if (layout.detailIncludeDescription) {
    const rawDesc = (item.config?.description || "").trim() || "—";
    doc.font("Helvetica").fontSize(9);
    y = drawConfigDescriptionSectioned(doc, y, rawDesc, 9, 4);
    y += 12;
  }

  type BomRow = { productNumber: string | null; name: string; quantity: number };

  const bomHeaderBlockHeight = () =>
    Math.max(
      measuredTextHeight(doc, "Pos.", 24, rowLineGap),
      measuredTextHeight(doc, "Art.-Nr.", 100, rowLineGap),
      measuredTextHeight(doc, "Bezeichnung", 200, rowLineGap),
      measuredTextHeight(doc, "Menge", 50, rowLineGap),
    ) +
    2 +
    4;

  const bomRowHeights = (parts: BomRow[]) =>
    parts.map((part, idx) => {
      const t1 = String(idx + 1);
      const t2 = part.productNumber || "—";
      const t3 = part.name || "—";
      const t4 = String(part.quantity);
      const h1 = measuredTextHeight(doc, t1, 24, rowLineGap);
      const h2 = measuredTextHeight(doc, t2, 100, rowLineGap);
      const h3 = measuredTextHeight(doc, t3, 200, rowLineGap);
      const h4 = measuredTextHeight(doc, t4, 50, rowLineGap);
      return Math.max(h1, h2, h3, h4) + rowPad;
    });

  const drawBomHeaderAt = (yy: number) => {
    doc.fontSize(8).font("Helvetica-Bold");
    const hh = Math.max(
      measuredTextHeight(doc, "Pos.", 24, rowLineGap),
      measuredTextHeight(doc, "Art.-Nr.", 100, rowLineGap),
      measuredTextHeight(doc, "Bezeichnung", 200, rowLineGap),
      measuredTextHeight(doc, "Menge", 50, rowLineGap),
    );
    const c1 = M;
    const c2 = M + 28;
    const c3 = M + 200;
    const c4 = M + 420;
    doc.text("Pos.", c1, yy, { width: 24, lineGap: rowLineGap, height: hh });
    doc.text("Art.-Nr.", c2, yy, { width: 100, lineGap: rowLineGap, height: hh });
    doc.text("Bezeichnung", c3, yy, { width: 200, lineGap: rowLineGap, height: hh });
    doc.text("Menge", c4, yy, { width: 50, align: "right", lineGap: rowLineGap, height: hh });
    let yn = yy + hh + 2;
    doc.moveTo(M, yn).lineTo(PW - M, yn).stroke();
    yn += 4;
    doc.font("Helvetica");
    return { y: yn, c1, c2, c3, c4 };
  };

  const drawBomSection = (sectionTitle: string, parts: BomRow[]) => {
    doc.font("Helvetica-Bold").fontSize(10);
    const titleH = measuredTextHeight(doc, sectionTitle, CW, rowLineGap);
    const headBlock = bomHeaderBlockHeight();
    const heights = bomRowHeights(parts);
    const k0 = parts.length === 0 ? 0 : Math.min(BOM_TABLE_CHUNK_ROWS, parts.length);
    const sumFirst = k0 ? heights.slice(0, k0).reduce((a, b) => a + b, 0) : 0;
    y = ensureContentY(doc, y, titleH + 6 + headBlock + sumFirst);
    doc.text(sectionTitle, M, y, { width: CW, lineGap: rowLineGap, height: titleH });
    y += titleH + 6;
    let { y: yAfterHead, c1, c2, c3, c4 } = drawBomHeaderAt(y);
    y = yAfterHead;

    const sumHeightsFrom = (from: number, count: number) => {
      let s = 0;
      for (let j = 0; j < count; j++) s += heights[from + j];
      return s;
    };
    const minBodyY = M + headBlock + 4;

    let i = 0;
    while (i < parts.length) {
      let k = Math.min(BOM_TABLE_CHUNK_ROWS, parts.length - i);
      let chunkSum = sumHeightsFrom(i, k);
      while (k > 1 && y + chunkSum > metaRegalPageContentMaxY(doc)) {
        k -= 1;
        chunkSum = sumHeightsFrom(i, k);
      }
      if (y + chunkSum > metaRegalPageContentMaxY(doc)) {
        if (y > minBodyY) {
          doc.addPage();
          y = doc.page.margins.top;
          const again = drawBomHeaderAt(y);
          y = again.y;
          c1 = again.c1;
          c2 = again.c2;
          c3 = again.c3;
          c4 = again.c4;
          continue;
        }
        k = 1;
        chunkSum = heights[i];
      }
      for (let j = 0; j < k; j++) {
        const idx = i + j;
        const part = parts[idx];
        const t1 = String(idx + 1);
        const t2 = part.productNumber || "—";
        const t3 = part.name || "—";
        const t4 = String(part.quantity);
        const h1 = measuredTextHeight(doc, t1, 24, rowLineGap);
        const h2 = measuredTextHeight(doc, t2, 100, rowLineGap);
        const h3 = measuredTextHeight(doc, t3, 200, rowLineGap);
        const h4 = measuredTextHeight(doc, t4, 50, rowLineGap);
        const rowH = heights[idx];
        const top = y;
        doc.text(t1, c1, top, { width: 24, lineGap: rowLineGap, height: h1 });
        doc.text(t2, c2, top, { width: 100, lineGap: rowLineGap, height: h2 });
        doc.text(t3, c3, top, { width: 200, lineGap: rowLineGap, height: h3 });
        doc.text(t4, c4, top, { width: 50, align: "right", lineGap: rowLineGap, height: h4 });
        y = top + rowH;
      }
      i += k;
    }
  };

  const parts = (item.config?.partsList || []) as BomRow[];
  if (layout.detailIncludePartsList) {
    drawBomSection("Stückliste", parts);
  }

  const acc = (item.config?.accessoryList || []) as BomRow[];
  if (layout.detailIncludeAccessoryList && acc.length > 0) {
    y += 8;
    drawBomSection("Zubehör", acc);
  }

  return y + LINE * 2;
}

export function generateOfferConfigPdf(input: OfferConfigPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = createMetaPdfDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const layout = resolvedLayout(input);
      let y = drawHeaderBlock(doc, input);
      y = drawOfferIntro(doc, y, input);
      y = drawQuickOverviewHeading(doc, y);
      y = drawOverviewTable(doc, input, y);

      for (let idx = 0; idx < input.lineItems.length; idx++) {
        const li = input.lineItems[idx];
        if (!li.config) continue;
        doc.addPage();
        drawConfigSection(doc, li, idx, M, layout);
      }

      const hasClosingHints =
        Boolean(input.offerSystemInfoText?.trim()) || Boolean(input.offerStandardClosingText?.trim());
      if (hasClosingHints) {
        doc.addPage();
        drawClosingAppendix(doc, input, M);
      }
      doc.addPage();
      drawGeneralOfferTermsMarkdown(doc, M, OFFER_GENERAL_TERMS_MARKDOWN_DE);

      const range = doc.bufferedPageRange();
      const pageCount = range.count;

      for (let i = range.start; i < range.start + pageCount; i++) {
        doc.switchToPage(i);
        drawFooterOnPage(doc, i - range.start + 1, pageCount);
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
