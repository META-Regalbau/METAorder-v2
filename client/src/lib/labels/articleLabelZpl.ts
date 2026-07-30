/**
 * Build ZPL for article labels (default 103×150 mm @ 203 dpi).
 * Code128 + QR encode the product number (SKU).
 * Layout scales with width/height so formats can be switched in the UI.
 */

export type ArticleLabelInput = {
  productNumber: string;
  name: string | null;
  size: string | null;
  color: string | null;
};

export type ArticleLabelOpts = {
  /** Label width in mm (default 103) */
  widthMm?: number;
  /** Label height in mm (default 150) */
  heightMm?: number;
  /** Printer DPI (default 203 for ZD220) */
  dpi?: number;
  /** Number of copies (^PQ) */
  copies?: number;
};

export type ArticleLabelFormatId = "103x150" | "40x30";

export type ArticleLabelFormat = {
  id: ArticleLabelFormatId;
  widthMm: number;
  heightMm: number;
};

/** Built-in formats selectable in the print dialog. */
export const ARTICLE_LABEL_FORMATS: readonly ArticleLabelFormat[] = [
  { id: "103x150", widthMm: 103, heightMm: 150 },
  { id: "40x30", widthMm: 40, heightMm: 30 },
] as const;

export const DEFAULT_ARTICLE_LABEL_FORMAT_ID: ArticleLabelFormatId = "103x150";

const DEFAULTS = {
  widthMm: 103,
  heightMm: 150,
  dpi: 203,
  copies: 1,
} as const;

const FORMAT_STORAGE_KEY = "metaorder:v1:articleLabelFormat";

export function getArticleLabelFormat(id: string | null | undefined): ArticleLabelFormat {
  const found = ARTICLE_LABEL_FORMATS.find((f) => f.id === id);
  return found ?? ARTICLE_LABEL_FORMATS[0];
}

export function loadStoredArticleLabelFormatId(): ArticleLabelFormatId {
  if (typeof window === "undefined") return DEFAULT_ARTICLE_LABEL_FORMAT_ID;
  try {
    const raw = localStorage.getItem(FORMAT_STORAGE_KEY);
    if (raw && ARTICLE_LABEL_FORMATS.some((f) => f.id === raw)) {
      return raw as ArticleLabelFormatId;
    }
  } catch {
    // ignore
  }
  return DEFAULT_ARTICLE_LABEL_FORMAT_ID;
}

export function storeArticleLabelFormatId(id: ArticleLabelFormatId): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FORMAT_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

/** Escape ZPL field data so ^ ~ \ do not break the command stream. */
export function escapeZpl(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\^/g, "\\^")
    .replace(/~/g, "\\~");
}

function truncate(text: string, maxChars: number): string {
  const s = text.trim();
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

function variantLine(size: string | null, color: string | null): string {
  return [size, color].map((p) => (p || "").trim()).filter(Boolean).join(" · ");
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Generate one ZPL label (with ^PQ for copies).
 * Proportional layout: SKU, name, size·color, QR + Code128.
 */
export function buildArticleLabelZpl(
  input: ArticleLabelInput,
  opts: ArticleLabelOpts = {},
): string {
  const widthMm = opts.widthMm ?? DEFAULTS.widthMm;
  const heightMm = opts.heightMm ?? DEFAULTS.heightMm;
  const dpi = opts.dpi ?? DEFAULTS.dpi;
  const copies = Math.max(1, Math.min(999, Math.floor(opts.copies ?? DEFAULTS.copies)));

  const pw = mmToDots(widthMm, dpi);
  const ll = mmToDots(heightMm, dpi);

  const sku = String(input.productNumber || "").trim();
  if (!sku) {
    throw new Error("productNumber is required for article label");
  }

  // More room on larger labels
  const maxTextChars = clamp(Math.floor(pw / 12), 24, 60);
  const name = truncate(String(input.name || "").trim(), maxTextChars);
  const variant = truncate(variantLine(input.size, input.color), maxTextChars);

  const skuEsc = escapeZpl(sku);
  const nameEsc = escapeZpl(name);
  const variantEsc = escapeZpl(variant);

  const mx = clamp(Math.round(pw * 0.04), 8, 40);
  const my = clamp(Math.round(ll * 0.03), 6, 36);
  const skuFont = clamp(Math.round(ll * 0.055), 20, 72);
  const nameFont = clamp(Math.round(ll * 0.032), 14, 42);
  const lineGap = Math.round(nameFont * 0.35);

  let y = my;
  const skuY = y;
  y += skuFont + lineGap;
  const nameY = y;
  y += name ? nameFont + lineGap : 0;
  const variantY = y;
  y += variant ? nameFont + Math.round(lineGap * 1.5) : Math.round(lineGap * 1.5);

  const codesTop = y;
  const remainingH = Math.max(80, ll - codesTop - my);
  const qrMag = clamp(Math.round(Math.min(pw, remainingH) / 55), 3, 10);
  // Approximate QR module size in dots (Zebra ^BQ magnification)
  const qrSize = qrMag * 22;
  const barcodeH = clamp(Math.round(remainingH * 0.45), 50, 180);
  const byModule = pw >= 600 ? 3 : pw >= 400 ? 2 : 1.5;
  const barcodeX = mx + qrSize + Math.round(mx * 0.8);
  const barcodeY = codesTop + Math.round((Math.min(qrSize, remainingH) - barcodeH) / 2);

  const lines = [
    "^XA",
    `^PW${pw}`,
    `^LL${ll}`,
    "^LH0,0",
    "^CI28",
    `^FO${mx},${skuY}^A0N,${skuFont},${skuFont}^FD${skuEsc}^FS`,
    name ? `^FO${mx},${nameY}^A0N,${nameFont},${nameFont}^FD${nameEsc}^FS` : null,
    variant ? `^FO${mx},${variantY}^A0N,${nameFont},${nameFont}^FD${variantEsc}^FS` : null,
    `^FO${mx},${codesTop}^BQN,2,${qrMag}^FDLA,${skuEsc}^FS`,
    `^FO${barcodeX},${Math.max(codesTop, barcodeY)}^BY${byModule},2,${barcodeH}^BCN,${barcodeH},Y,N,N^FD${skuEsc}^FS`,
    `^PQ${copies}`,
    "^XZ",
  ];

  return lines.filter((l) => l != null).join("\n");
}

/** Concatenate ZPL for multiple products (each with its own ^XA…^XZ). */
export function buildArticleLabelsBatch(
  items: ArticleLabelInput[],
  opts: ArticleLabelOpts = {},
): string {
  return items.map((item) => buildArticleLabelZpl(item, opts)).join("\n");
}
