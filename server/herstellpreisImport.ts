import * as XLSX from "xlsx";
import type { IStorage } from "./storage";
import { herstellpreisCatalogHas } from "./productIdentifiers";

export type HerstellpreisRow = {
  productNumber: string;
  herstellkostenNet: number;
  source: "vtls" | "herstellkosten";
};

export type HerstellpreisImportOptions = {
  apply: boolean;
};

export type HerstellpreisImportRowResult = {
  productNumber: string;
  herstellkostenNet: number;
  source: HerstellpreisRow["source"];
  status: "would_update" | "updated" | "unchanged" | "not_found" | "error";
  previousNet?: number | null;
  message?: string;
};

export type HerstellpreisImportResult = {
  mode: "apply" | "dry-run";
  totalRows: number;
  matched: number;
  updated: number;
  unchanged: number;
  notFound: number;
  errors: number;
  rows: HerstellpreisImportRowResult[];
};

export type HerstellpreisImportDeps = {
  storage: IStorage;
  tenantId?: string | null;
  /** Geladene wdu_ifs_productnumber-Werte aus dem Shopware-Katalog (In-Memory-Abgleich). */
  ifsCatalog?: ReadonlySet<string>;
};

const PRODUCT_NUMBER_CHUNK = 200;
const UPSERT_BATCH_SIZE = 500;

function parseGermanNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeProductNumber(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return raw;
  return raw;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/** Liest Herstellkosten aus der SAP/VTLS-Excel (ÜbersichtVerkaufsartikel). */
export function parseHerstellpreisRowsFromBuffer(buffer: Buffer): HerstellpreisRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel-Datei enthält kein Tabellenblatt");
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName]);
  const out: HerstellpreisRow[] = [];
  const seen = new Set<string>();

  for (const row of rawRows) {
    const productNumber = normalizeProductNumber(row["Verkaufsartikel"]);
    if (!productNumber || seen.has(productNumber)) continue;

    const vtls = parseGermanNumber(row["VTLS Herstell Kosten"]);
    const herstell = parseGermanNumber(row["Herstellkosten "] ?? row["Herstellkosten"]);
    const net = vtls ?? herstell;
    if (net == null) continue;

    seen.add(productNumber);
    out.push({
      productNumber,
      herstellkostenNet: net,
      source: vtls != null ? "vtls" : "herstellkosten",
    });
  }

  return out;
}

export function parseHerstellpreisRowsFromFile(filePath: string): HerstellpreisRow[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel-Datei enthält kein Tabellenblatt");
  }
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return parseHerstellpreisRowsFromBuffer(buffer);
}

export async function runHerstellpreisImport(
  deps: HerstellpreisImportDeps,
  rows: HerstellpreisRow[],
  options: HerstellpreisImportOptions,
  log: (message: string) => void = () => {},
): Promise<HerstellpreisImportResult> {
  const { storage, tenantId, ifsCatalog } = deps;
  const results: HerstellpreisImportRowResult[] = [];
  let matched = 0;
  let updated = 0;
  let unchanged = 0;
  let notFound = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += PRODUCT_NUMBER_CHUNK) {
    const chunk = rows.slice(i, i + PRODUCT_NUMBER_CHUNK);
    const numbers = chunk.map((r) => r.productNumber);

    const existingMap = await storage.getProductHerstellpreiseByProductNumbers(numbers, tenantId);
    const pendingUpserts: HerstellpreisRow[] = [];

    for (const row of chunk) {
      const inCatalog = ifsCatalog ? herstellpreisCatalogHas(ifsCatalog, row.productNumber) : true;
      if (!inCatalog) {
        notFound += 1;
        results.push({
          productNumber: row.productNumber,
          herstellkostenNet: row.herstellkostenNet,
          source: row.source,
          status: "not_found",
          message: "Kein Shopware-Artikel mit wdu_ifs_productnumber gefunden",
        });
        continue;
      }

      matched += 1;
      const previousNet = existingMap.get(row.productNumber) ?? null;

      if (previousNet != null && nearlyEqual(previousNet, row.herstellkostenNet)) {
        unchanged += 1;
        results.push({
          productNumber: row.productNumber,
          herstellkostenNet: row.herstellkostenNet,
          source: row.source,
          status: "unchanged",
          previousNet,
        });
        continue;
      }

      results.push({
        productNumber: row.productNumber,
        herstellkostenNet: row.herstellkostenNet,
        source: row.source,
        status: options.apply ? "updated" : "would_update",
        previousNet,
      });
      pendingUpserts.push(row);
    }

    if (options.apply && pendingUpserts.length > 0) {
      for (let j = 0; j < pendingUpserts.length; j += UPSERT_BATCH_SIZE) {
        const batch = pendingUpserts.slice(j, j + UPSERT_BATCH_SIZE);
        try {
          await storage.upsertProductHerstellpreise(
            batch.map((row) => ({
              productNumber: row.productNumber,
              herstellkostenNet: row.herstellkostenNet,
              source: row.source,
            })),
            tenantId,
          );
          updated += batch.length;
        } catch (error: unknown) {
          errors += batch.length;
          const message = error instanceof Error ? error.message : String(error);
          for (const row of batch) {
            const resultRow = results.find(
              (r) => r.productNumber === row.productNumber && r.status === "updated",
            );
            if (resultRow) {
              resultRow.status = "error";
              resultRow.message = message;
            }
          }
          log(`[Herstellpreis-Import] Batch-Fehler: ${message}`);
        }
      }
    } else {
      updated += pendingUpserts.length;
    }

    log(
      `[Herstellpreis-Import] Fortschritt ${Math.min(i + PRODUCT_NUMBER_CHUNK, rows.length)}/${rows.length}`,
    );
  }

  return {
    mode: options.apply ? "apply" : "dry-run",
    totalRows: rows.length,
    matched,
    updated,
    unchanged,
    notFound,
    errors,
    rows: results,
  };
}
