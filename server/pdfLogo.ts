/**
 * Firmenlogo für PDFs (Angebots-Konfiguration, Teilzahlungsrechnung, …).
 *
 * Auflösung: mehrere Kandidaten, erste lesbare PNG-/JPEG-Datei (Magic-Bytes).
 * App-Root über `process.argv[1]` (z. B. …/dist/index.js → …/), damit der Pfad auch bei
 * abweichendem cwd (nicht nur Docker) stimmt.
 *
 * Priorität:
 * 1. METAORDER_PDF_LOGO_PATH
 * 2. META-Logo-landing.png — aus attached_assets/META-Logo.svg (Landingpage); erzeugen mit `npm run pdf:landing-logo`
 * 3. META_at_all_levels_RGB.png (Projektwurzel cwd, dann server/pdfAssets, App-Root, __dirname)
 * 4. meta-logo.png (Legacy-Fallback in server/pdfAssets)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Max. Breite/Höhe fürs Logo (pt); Bild wird proportional skaliert, ohne großen Leerkasten. */
export const PDF_HEADER_LOGO_MAX: { w: number; h: number } = { w: 200, h: 56 };

function resolveApplicationRoot(): string {
  try {
    const main = process.argv[1];
    if (main) {
      const mainDir = path.dirname(path.resolve(main));
      const base = path.basename(mainDir);
      if (base === "dist") {
        return path.normalize(path.join(mainDir, ".."));
      }
      if (base === "server") {
        return path.normalize(path.join(mainDir, ".."));
      }
    }
  } catch {
    /* ignore */
  }
  return process.cwd();
}

function uniqueResolvedPaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!p) continue;
    const n = path.normalize(path.resolve(p));
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function isReadableImageBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 24) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return true;
  return false;
}

function tryReadLogoAt(filePath: string): Buffer | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size < 24) return null;
    const buf = fs.readFileSync(filePath);
    if (!isReadableImageBuffer(buf)) return null;
    return buf;
  } catch {
    return null;
  }
}

function collectLogoCandidatePaths(): string[] {
  const cwd = process.cwd();
  const appRoot = resolveApplicationRoot();
  const env = process.env.METAORDER_PDF_LOGO_PATH?.trim();

  return uniqueResolvedPaths([
    env || null,
    path.join(appRoot, "dist", "pdfAssets", "META-Logo-landing.png"),
    path.join(appRoot, "server", "pdfAssets", "META-Logo-landing.png"),
    path.resolve(cwd, "server", "pdfAssets", "META-Logo-landing.png"),
    path.join(__dirname, "pdfAssets", "META-Logo-landing.png"),
    path.join(__dirname, "..", "server", "pdfAssets", "META-Logo-landing.png"),
    path.join(appRoot, "dist", "pdfAssets", "META_at_all_levels_RGB.png"),
    path.join(appRoot, "server", "pdfAssets", "META_at_all_levels_RGB.png"),
    path.join(__dirname, "pdfAssets", "META_at_all_levels_RGB.png"),
    path.resolve(cwd, "server", "pdfAssets", "META_at_all_levels_RGB.png"),
    path.resolve(cwd, "META_at_all_levels_RGB.png"),
    path.join(__dirname, "..", "server", "pdfAssets", "META_at_all_levels_RGB.png"),
    path.join(appRoot, "META_at_all_levels_RGB.png"),
    path.join(appRoot, "dist", "pdfAssets", "meta-logo.png"),
    path.join(appRoot, "server", "pdfAssets", "meta-logo.png"),
    path.resolve(cwd, "server", "pdfAssets", "meta-logo.png"),
    path.join(__dirname, "pdfAssets", "meta-logo.png"),
    path.join(__dirname, "..", "server", "pdfAssets", "meta-logo.png"),
  ]);
}

export function resolveMetaRegalbauLogoPath(): string | null {
  for (const p of collectLogoCandidatePaths()) {
    const buf = tryReadLogoAt(p);
    if (buf) return p;
  }
  return null;
}

export function readMetaRegalbauLogo(): Buffer | null {
  for (const p of collectLogoCandidatePaths()) {
    const buf = tryReadLogoAt(p);
    if (buf) return buf;
  }
  return null;
}

type PdfKitOpenImage = PDFKit.PDFDocument & {
  openImage: (src: Buffer | string) => { width: number; height: number };
};

/**
 * Logo oben links: natürliche Größe begrenzt durch {@link PDF_HEADER_LOGO_MAX} (kein breiter Leerkasten).
 */
export function drawPdfHeaderLogo(doc: PDFKit.PDFDocument, x: number, y: number): void {
  const { w: maxW, h: maxH } = PDF_HEADER_LOGO_MAX;
  const buf = readMetaRegalbauLogo();
  if (buf?.length) {
    try {
      const im = (doc as PdfKitOpenImage).openImage(buf);
      const scale = Math.min(maxW / im.width, maxH / im.height, 2);
      const dw = Math.max(1, im.width * scale);
      const dh = Math.max(1, im.height * scale);
      doc.image(buf, x, y, { width: dw, height: dh });
      return;
    } catch {
      try {
        doc.image(buf, x, y, { width: maxW, height: maxH });
        return;
      } catch {
        /* PNG/JPEG nicht einbettbar → Schriftzug */
      }
    }
  }
  doc.fontSize(11).font("Helvetica-Bold").fillColor("#222");
  doc.text("META Regalbau", x, y, { width: maxW });
  doc.font("Helvetica").fontSize(8).fillColor("#555");
  doc.text("GmbH & Co. KG", x, y + 13, { width: maxW });
  doc.fillColor("#000");
}
