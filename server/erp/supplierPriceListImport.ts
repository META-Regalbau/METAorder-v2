/**
 * Lieferanten-Preisliste: Excel/CSV mit Spalten Artikelnummer + Preis.
 */
import * as XLSX from "xlsx";

export type SupplierPriceListRow = {
  productNumber: string;
  unitPrice: number;
};

export type SupplierPriceListImportRowResult = {
  productNumber: string;
  unitPrice: number;
  catalogMatch: "matched" | "unmatched";
  status: "would_import" | "imported" | "error";
  message?: string;
};

export type SupplierPriceListImportResult = {
  mode: "apply" | "dry-run";
  totalRows: number;
  matched: number;
  unmatched: number;
  imported: number;
  errors: number;
  rows: SupplierPriceListImportRowResult[];
  priceListId?: string;
};

function parseGermanNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeProductNumber(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeHeader(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "");
}

/** Mappt flexible Header auf Artikelnummer / Preis. */
function resolveColumns(sample: Record<string, unknown>): {
  productKey: string | null;
  priceKey: string | null;
} {
  let productKey: string | null = null;
  let priceKey: string | null = null;
  for (const key of Object.keys(sample)) {
    const n = normalizeHeader(key);
    if (
      !productKey &&
      (n === "artikelnummer" ||
        n === "articlenumber" ||
        n === "productnumber" ||
        n === "sku" ||
        n === "artikelnr" ||
        n === "artnr")
    ) {
      productKey = key;
    }
    if (
      !priceKey &&
      (n === "preis" ||
        n === "price" ||
        n === "unitprice" ||
        n === "einkaufspreis" ||
        n === "ek" ||
        n === "nettopreis")
    ) {
      priceKey = key;
    }
  }
  return { productKey, priceKey };
}

export function parseSupplierPriceListFromBuffer(buffer: Buffer): SupplierPriceListRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Datei enthält kein Tabellenblatt");
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: "",
  });
  if (!rawRows.length) {
    throw new Error("Datei enthält keine Datenzeilen");
  }

  const { productKey, priceKey } = resolveColumns(rawRows[0]);
  if (!productKey || !priceKey) {
    throw new Error('Spalten "Artikelnummer" und "Preis" erforderlich');
  }

  const out: SupplierPriceListRow[] = [];
  const seen = new Set<string>();

  for (const row of rawRows) {
    const productNumber = normalizeProductNumber(row[productKey]);
    if (!productNumber || seen.has(productNumber)) continue;
    const unitPrice = parseGermanNumber(row[priceKey]);
    if (unitPrice == null) continue;
    seen.add(productNumber);
    out.push({ productNumber, unitPrice });
  }

  if (!out.length) {
    throw new Error("Keine gültigen Preiszeilen gefunden");
  }

  return out;
}
