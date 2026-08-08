/**
 * Build ZPL for storage-bin labels (Lagerplatz-Etiketten).
 *
 * Anders als beim Artikeletikett ist hier der Lagerplatz-Code der Held: er muss aus einigen
 * Metern Entfernung lesbar sein. Die Schriftgröße skaliert deshalb sowohl mit der Etikettenhöhe
 * als auch mit der Codelänge, damit "A-01" groß und "A-12-03-07" noch vollständig passt.
 * Code128 + QR kodieren denselben Code, damit der Platz gescannt werden kann.
 */

import {
  QR_FIELD_MODULES,
  barcodeWidth,
  escapeZpl,
  fitBarcodeModule,
  mmToDots,
  qrFieldSize,
} from "./articleLabelZpl";

export type LocationLabelInput = {
  /** Lagerplatz-Code, z. B. A-01-02-03 — Hauptinhalt und Barcode-Nutzlast. */
  code: string;
  /** Optionale Bezeichnung des Lagerplatzes. */
  name: string | null;
  /** Optionaler Regaltyp, z. B. "PAL — Palettenregal". */
  shelfType: string | null;
  /** Optionaler Lagercode, z. B. "HL". */
  warehouseCode: string | null;
};

export type LocationLabelOpts = {
  widthMm?: number;
  heightMm?: number;
  dpi?: number;
  copies?: number;
};

export type LocationLabelFormatId = "103x50" | "103x150" | "40x30";

export type LocationLabelFormat = {
  id: LocationLabelFormatId;
  widthMm: number;
  heightMm: number;
};

/** Formate, die im Druckdialog wählbar sind (Medien, die bereits im Einsatz sind). */
export const LOCATION_LABEL_FORMATS: readonly LocationLabelFormat[] = [
  { id: "103x50", widthMm: 103, heightMm: 50 },
  { id: "103x150", widthMm: 103, heightMm: 150 },
  { id: "40x30", widthMm: 40, heightMm: 30 },
] as const;

export const DEFAULT_LOCATION_LABEL_FORMAT_ID: LocationLabelFormatId = "103x50";

const DEFAULTS = {
  widthMm: 103,
  heightMm: 50,
  dpi: 203,
  copies: 1,
} as const;

const FORMAT_STORAGE_KEY = "metaorder:v1:locationLabelFormat";

export function getLocationLabelFormat(id: string | null | undefined): LocationLabelFormat {
  const found = LOCATION_LABEL_FORMATS.find((f) => f.id === id);
  return found ?? LOCATION_LABEL_FORMATS[0];
}

export function loadStoredLocationLabelFormatId(): LocationLabelFormatId {
  if (typeof window === "undefined") return DEFAULT_LOCATION_LABEL_FORMAT_ID;
  try {
    const raw = localStorage.getItem(FORMAT_STORAGE_KEY);
    if (raw && LOCATION_LABEL_FORMATS.some((f) => f.id === raw)) {
      return raw as LocationLabelFormatId;
    }
  } catch {
    // ignore
  }
  return DEFAULT_LOCATION_LABEL_FORMAT_ID;
}

export function storeLocationLabelFormatId(id: LocationLabelFormatId): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FORMAT_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function truncate(text: string, maxChars: number): string {
  const s = text.trim();
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

/** Zweite Zeile: Bezeichnung, Regaltyp und Lager — je nachdem, was gepflegt ist. */
export function locationSubtitle(input: LocationLabelInput): string {
  return [input.name, input.shelfType, input.warehouseCode]
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .join(" · ");
}

/** Ein ZPL-Etikett (inkl. ^PQ für Kopien). */
export function buildLocationLabelZpl(
  input: LocationLabelInput,
  opts: LocationLabelOpts = {},
): string {
  const widthMm = opts.widthMm ?? DEFAULTS.widthMm;
  const heightMm = opts.heightMm ?? DEFAULTS.heightMm;
  const dpi = opts.dpi ?? DEFAULTS.dpi;
  const copies = Math.max(1, Math.min(999, Math.floor(opts.copies ?? DEFAULTS.copies)));

  const pw = mmToDots(widthMm, dpi);
  const ll = mmToDots(heightMm, dpi);

  const code = String(input.code || "").trim();
  if (!code) {
    throw new Error("code is required for location label");
  }

  const mx = clamp(Math.round(pw * 0.04), 8, 40);
  const my = clamp(Math.round(ll * 0.06), 6, 36);
  const innerW = Math.max(40, pw - 2 * mx);

  // Der Code füllt die Breite aus, wird aber nie höher als ~30 % des Etiketts.
  // 0.62 ist das ungefähre Breite/Höhe-Verhältnis der skalierbaren ZPL-Schrift A0.
  const widthLimitedFont = Math.floor(innerW / (0.62 * code.length));
  const codeFont = clamp(Math.min(Math.round(ll * 0.3), widthLimitedFont), 16, 220);

  const subFont = clamp(Math.round(ll * 0.09), 12, 40);
  const subtitle = truncate(locationSubtitle(input), Math.max(10, Math.floor(innerW / (0.6 * subFont))));

  const codeEsc = escapeZpl(code);
  const subtitleEsc = escapeZpl(subtitle);

  // Layout zunächst ab 0 rechnen, danach vertikal zentrieren — sonst klebt auf hohen
  // Etiketten (z. B. 103×150) alles oben und das untere Drittel bleibt leer.
  let y = 0;
  const codeY = y;
  y += codeFont + Math.round(subFont * 0.35);
  const subtitleY = y;
  if (subtitle) y += subFont + Math.round(subFont * 0.5);

  const codesTop = y;
  const availableH = Math.max(50, ll - 2 * my - codesTop);

  // QR und Code128 stehen nebeneinander. Untereinander wäre auf hohen Etiketten hübscher,
  // ist aber fehleranfällig: die tatsächliche Höhe des ^BQ-Feldes hängt von QR-Version und
  // Ruhezone ab, und schon eine kleine Unterschätzung schiebt den Barcode in den QR.
  // Nebeneinander genügt eine reservierte Breite, die wir über qrFieldSize() sicher kennen.
  const gap = Math.round(mx * 0.8);
  const qrMag = clamp(
    Math.floor(Math.min(Math.round(pw * 0.4), availableH) / QR_FIELD_MODULES),
    2,
    10,
  );
  const qrBox = qrFieldSize(qrMag);

  // Passt der Code128 selbst bei minimaler Modulbreite nicht neben den QR (langer Code auf
  // kleinem Etikett), entfällt der QR. Ein abgeschnittener Barcode wäre unscannbar, ein
  // fehlender QR nur unbequem.
  const showQr = innerW - (qrBox + gap) >= barcodeWidth(code.length, 1);

  const barcodeX = showQr ? qrBox + gap : 0;
  // Modulbreite so groß wie möglich, aber nur so groß, dass der Code128 in die Restbreite
  // passt — lange Lagerplatz-Codes würden auf kleinen Etiketten sonst abgeschnitten.
  const byModule = fitBarcodeModule(innerW - barcodeX, code.length);
  const barcodeH = clamp(Math.round(qrBox * 0.7), 40, 220);
  const barcodeY = showQr ? codesTop + Math.round((qrBox - barcodeH) / 2) : codesTop;

  const contentH = showQr ? codesTop + qrBox : codesTop + barcodeH;
  const yOffset = my + Math.max(0, Math.round((ll - 2 * my - contentH) / 2));

  const lines = [
    "^XA",
    `^PW${pw}`,
    `^LL${ll}`,
    "^LH0,0",
    "^CI28",
    `^FO${mx},${yOffset + codeY}^A0N,${codeFont},${codeFont}^FD${codeEsc}^FS`,
    subtitle
      ? `^FO${mx},${yOffset + subtitleY}^A0N,${subFont},${subFont}^FD${subtitleEsc}^FS`
      : null,
    showQr ? `^FO${mx},${yOffset + codesTop}^BQN,2,${qrMag}^FDLA,${codeEsc}^FS` : null,
    `^FO${mx + barcodeX},${yOffset + barcodeY}^BY${byModule},2,${barcodeH}^BCN,${barcodeH},N,N,N^FD${codeEsc}^FS`,
    `^PQ${copies}`,
    "^XZ",
  ];

  return lines.filter((l) => l != null).join("\n");
}

/** ZPL für mehrere Lagerplätze (jeweils eigenes ^XA…^XZ). */
export function buildLocationLabelsBatch(
  items: LocationLabelInput[],
  opts: LocationLabelOpts = {},
): string {
  return items.map((item) => buildLocationLabelZpl(item, opts)).join("\n");
}
