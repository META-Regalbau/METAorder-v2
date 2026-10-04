import fs from "fs";
import path from "path";

/** Feste Datei im Ordner `cpq-models` (Khronos Box o. Ä.) – nur Präsentation, kein Produkt-Match. */
export const METAORDER_PRESENTATION_PLACEHOLDER_GLB = "_metaorder-presentation-placeholder.glb";

export type CpqGlbResolveResult = {
  filename: string | null;
  url: string | null;
  mtime: number | null;
  /** true, wenn das Präsentations-Placeholder-Modell genutzt wurde (kein produktspezifisches GLB) */
  isPresentationPlaceholder?: boolean;
};

/** GLB-Ordner: Compose/Prod nutzt gebaute SPA unter `dist/public/cpq-models`, lokal `client/public/cpq-models`. */
export function getCpqGlbDirectory(): string {
  if (process.env.CPQ_GLB_PATH) {
    return process.env.CPQ_GLB_PATH;
  }
  const distPath = path.resolve(process.cwd(), "dist", "public", "cpq-models");
  if (fs.existsSync(distPath)) {
    return distPath;
  }
  return path.resolve(process.cwd(), "client", "public", "cpq-models");
}

function getCpqGlbPath(): string {
  return getCpqGlbDirectory();
}

function placeholderFilename(): string {
  return (process.env.CPQ_PRESENTATION_PLACEHOLDER_GLB || METAORDER_PRESENTATION_PLACEHOLDER_GLB).replace(
    /^[/\\]+/,
    "",
  );
}

function statPlaceholderGlb(cpqGlbPath: string, filename: string): CpqGlbResolveResult {
  const fullPath = path.join(cpqGlbPath, filename);
  if (!fs.existsSync(fullPath)) {
    return { filename: null, url: null, mtime: null };
  }
  let mtime: number | null = null;
  try {
    mtime = Math.floor(fs.statSync(fullPath).mtimeMs / 1000);
  } catch {
    mtime = null;
  }
  return { filename, url: `/cpq-models/${filename}`, mtime, isPresentationPlaceholder: true };
}

function statProductGlb(cpqGlbPath: string, filename: string): CpqGlbResolveResult {
  const fullPath = path.join(cpqGlbPath, filename);
  if (!fs.existsSync(fullPath)) {
    return { filename: null, url: null, mtime: null };
  }
  let mtime: number | null = null;
  try {
    mtime = Math.floor(fs.statSync(fullPath).mtimeMs / 1000);
  } catch {
    mtime = null;
  }
  return { filename, url: `/cpq-models/${filename}`, mtime, isPresentationPlaceholder: false };
}

/** Nur das Präsentations-Modell (für Demo / Positionen ohne Artikelnr.) */
export function resolveCpqGlbPresentationPlaceholder(): CpqGlbResolveResult {
  const cpqGlbPath = getCpqGlbPath();
  if (!fs.existsSync(cpqGlbPath)) {
    return { filename: null, url: null, mtime: null };
  }
  return statPlaceholderGlb(cpqGlbPath, placeholderFilename());
}

export function resolveCpqGlbFromDisk(
  productNumber?: string | null,
  manufacturerNumber?: string | null,
): CpqGlbResolveResult {
  const pn = productNumber?.trim();
  const mfr = manufacturerNumber?.trim();
  if (!pn && !mfr) {
    return { filename: null, url: null, mtime: null };
  }
  const cpqGlbPath = getCpqGlbPath();
  if (!fs.existsSync(cpqGlbPath)) {
    return { filename: null, url: null, mtime: null };
  }
  const placeholder = placeholderFilename();
  const files = fs.readdirSync(cpqGlbPath);
  const glbFiles = files.filter((f) => f.endsWith(".glb") && f !== placeholder);
  const tryMatchPrefix = (pref: string) =>
    pref && glbFiles.find((f) => f.startsWith(pref) || f.startsWith(String(pref).replace(/^0+/, "")));
  const tryMatchManufNr = (m: string) =>
    m &&
    glbFiles.find(
      (f) =>
        f.startsWith(m) ||
        f.startsWith(String(m).replace(/^0+/, "")) ||
        f.includes(`_${m}_`) ||
        f.endsWith(`_${m}.glb`),
    );
  const match = tryMatchManufNr(mfr || "") || tryMatchPrefix(pn || "");
  if (!match) {
    const fallback = statPlaceholderGlb(cpqGlbPath, placeholder);
    if (fallback.url) {
      return fallback;
    }
    return { filename: null, url: null, mtime: null };
  }
  return statProductGlb(cpqGlbPath, match);
}
