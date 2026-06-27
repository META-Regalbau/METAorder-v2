/**
 * Gemeinsame Layout-Konstanten für META-Regalbau-PDFs (Angebot, Rechnung, Mahnung).
 */

const MM_TO_PT = 72 / 25.4;

/** PDFKit `SIZES.A4` Hochformat — Footer/Pagination müssen dieselbe Höhe nutzen. */
export const PDFKIT_A4_HEIGHT_PT = 841.89;

/**
 * Ränder für Konfigurations-PDF: unten so groß, dass `page.maxY()` mit Fußzeilen-Layout übereinstimmt
 * (verhindert „Geister“-Umbrüche bei `doc.text` mit `continued`).
 */
export function metaRegalA4ContentMargins(sideMarginPt: number): {
  top: number;
  left: number;
  right: number;
  bottom: number;
} {
  const h = PDFKIT_A4_HEIGHT_PT;
  const { contentMaxY } = metaRegalFooterLayout(h);
  return {
    top: sideMarginPt,
    left: sideMarginPt,
    right: sideMarginPt,
    bottom: Math.max(0, h - contentMaxY),
  };
}

/** Aktuelle Seite: untere Grenze für Fließtext (PDFKit, nach Fußbereich-Reserve). */
export function metaRegalPageContentMaxY(doc: PDFKit.PDFDocument): number {
  return doc.page.maxY();
}

/** Unterer Seitenrand bis zur untersten Fußzeile (ca. 8 mm). */
export const META_PDF_FOOTER_BOTTOM_MARGIN_PT = 8 * MM_TO_PT;

/**
 * Fußzeile von unten nach oben: ca. 8 mm bis unterste Textzeile, 4×6,5-pt-Zeilen (footY…+25),
 * Trennlinie fy darüber. Seitenzahl oberhalb der Linie (kein Überlagern der Spalten).
 */
export function metaRegalFooterLayout(pageHeightPt: number): {
  fy: number;
  footY: number;
  contentMaxY: number;
  pageNumberY: number;
} {
  const ph = pageHeightPt;
  const m = META_PDF_FOOTER_BOTTOM_MARGIN_PT;
  /** Platz unter footY bis Seitenende: letzte Zeile + Abstieg (~8 pt). */
  const stackBelowFootY = 33;
  const footY = ph - m - stackBelowFootY;
  const fy = footY - 6;
  /** Etwas Luft zwischen Fließtext und Trennlinie (Footer wirkt sauber, nicht gequetscht). */
  const contentMaxY = fy - 18;
  /** Oberhalb von fy, damit „Seite x/y“ nicht in die 4 Fußspalten ragt. */
  const pageNumberY = fy - 11;
  return { fy, footY, contentMaxY, pageNumberY };
}
