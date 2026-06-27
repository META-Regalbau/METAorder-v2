/**
 * Rendert den Markdown-Anhang „Allgemeine Angebotsbedingungen“ im Konfigurations-PDF.
 * Unterstützt: # / ##, ---, Tabellen (|…|), Aufzählungen (-), **fett**, [text](url).
 */

import { metaRegalPageContentMaxY } from "./metaRegalPdfLayout";

const M = 50;
const CW = 595 - 2 * M;
const PW = 595;

/** Gleiche untere Grenze wie `page.maxY()` nach `metaRegalA4ContentMargins` im Konfig-PDF. */
function ensureY(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (needed <= 0) return y;
  const maxY = metaRegalPageContentMaxY(doc);
  if (y + needed <= maxY) return y;
  doc.addPage();
  return doc.page.margins.top;
}

function normalizeMarkdownLinks(s: string): string {
  return s.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_, label, url) =>
    label.trim() === url.trim() ? url : `${label} (${url})`,
  );
}

function stripBoldMarkersForMeasure(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1");
}

/**
 * Fließtext mit **fett**; gibt End-y zurück (nach letztem Text).
 */
function drawFormattedParagraph(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  raw: string,
  fontSize: number,
  lineGap: number,
): number {
  let t = normalizeMarkdownLinks(raw).replace(/\s+/g, " ").trim();
  if (!t) return y;

  const chunks: { bold: boolean; text: string }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    if (m.index > pos) chunks.push({ bold: false, text: t.slice(pos, m.index) });
    chunks.push({ bold: true, text: m[1] });
    pos = re.lastIndex;
  }
  if (pos < t.length) chunks.push({ bold: false, text: t.slice(pos) });
  if (!chunks.length) chunks.push({ bold: false, text: t });

  const est = Math.max(
    fontSize + lineGap,
    doc.heightOfString(stripBoldMarkersForMeasure(t), { width: w, lineGap }),
  );
  let cy = ensureY(doc, y, est);

  let isFirst = true;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (!c.text) continue;
    doc.font(c.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    const last = i === chunks.length - 1;
    if (isFirst) {
      doc.text(c.text, x, cy, { width: w, lineGap, continued: !last });
      isFirst = false;
    } else {
      doc.text(c.text, { width: w, lineGap, continued: !last });
    }
  }
  return doc.y + 4;
}

function isTableSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^[\s\-:|]+$/i.test(c));
}

function parseTableRow(line: string): string[] {
  const t = line.trim();
  if (!t.startsWith("|")) return [];
  const inner = t.replace(/^\|/, "").replace(/\|\s*$/, "");
  return inner.split("|").map((c) => c.trim());
}

function drawTable(
  doc: PDFKit.PDFDocument,
  y: number,
  rowLines: string[],
): number {
  const rows: string[][] = [];
  for (const ln of rowLines) {
    const cells = parseTableRow(ln);
    if (!cells.length) continue;
    if (isTableSeparatorRow(cells)) continue;
    rows.push(cells);
  }
  if (!rows.length) return y;

  const nCols = Math.max(...rows.map((r) => r.length));
  const colW = CW / nCols;
  const fs = 7;
  const lg = 1;
  let cy = y;

  for (const row of rows) {
    while (row.length < nCols) row.push("");
    const heights = row.map((cell) =>
      Math.max(
        fs + lg,
        doc.heightOfString(stripBoldMarkersForMeasure(normalizeMarkdownLinks(cell)), {
          width: colW - 4,
          lineGap: lg,
        }),
      ),
    );
    const rowH = Math.max(...heights) + 3;
    cy = ensureY(doc, cy, rowH);

    let cx = M;
    for (let i = 0; i < nCols; i++) {
      const cell = normalizeMarkdownLinks(row[i] || "");
      doc.font("Helvetica").fontSize(fs).fillColor("#000");
      doc.text(cell.replace(/\*\*/g, ""), cx + 2, cy, {
        width: colW - 4,
        lineGap: lg,
        height: heights[i],
      });
      cx += colW;
    }
    cy += rowH;
  }

  doc.font("Helvetica").fontSize(9).fillColor("#000");
  return cy + 6;
}

/**
 * Markdown-Anhang ab yStart; liefert neue y-Position.
 */
export function drawGeneralOfferTermsMarkdown(
  doc: PDFKit.PDFDocument,
  yStart: number,
  markdown: string,
): number {
  let y = yStart;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const para: string[] = [];

  const flushParagraph = () => {
    if (!para.length) return;
    const text = para.join(" ").replace(/\s+/g, " ").trim();
    para.length = 0;
    if (!text) return;
    y = drawFormattedParagraph(doc, M, y, CW, text, 9, 3);
  };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (t === "") {
      flushParagraph();
      i++;
      y += 2;
      continue;
    }

    if (t === "---") {
      flushParagraph();
      y = ensureY(doc, y, 12);
      doc.moveTo(M, y).lineTo(PW - M, y).lineWidth(0.4).strokeColor("#999").stroke();
      doc.strokeColor("#000");
      y += 14;
      i++;
      continue;
    }

    if (t.startsWith("## ")) {
      flushParagraph();
      const h = t.slice(3).trim();
      doc.font("Helvetica-Bold").fontSize(11);
      const hh = doc.heightOfString(h, { width: CW, lineGap: 2 });
      y = ensureY(doc, y, hh + 8);
      doc.text(h, M, y, { width: CW, lineGap: 2, height: hh });
      y += hh + 8;
      doc.font("Helvetica").fontSize(9);
      i++;
      continue;
    }

    if (t.startsWith("# ")) {
      flushParagraph();
      const h = t.slice(2).trim();
      doc.font("Helvetica-Bold").fontSize(14);
      const hh = doc.heightOfString(h, { width: CW, lineGap: 2 });
      y = ensureY(doc, y, hh + 10);
      doc.text(h, M, y, { width: CW, lineGap: 2, height: hh });
      y += hh + 12;
      doc.font("Helvetica").fontSize(9);
      i++;
      continue;
    }

    if (t.startsWith("|")) {
      flushParagraph();
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      y = drawTable(doc, y, tableLines);
      continue;
    }

    if (/^\s*-\s+/.test(line)) {
      flushParagraph();
      const item = line.replace(/^\s*-\s+/, "").trim();
      y = drawFormattedParagraph(doc, M + 12, y, CW - 12, `• ${normalizeMarkdownLinks(item)}`, 9, 3);
      i++;
      continue;
    }

    para.push(t);
    i++;
  }

  flushParagraph();
  return y;
}
