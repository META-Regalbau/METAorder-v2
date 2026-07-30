import * as XLSX from "xlsx";
import type { Product } from "@shared/schema";
import type { ShopwareClient } from "./shopware";
import { getWduIfsProductNumber } from "./productIdentifiers";

export type VisibilityLevel = 10 | 20 | 30;

export type VisibilityCellAction =
  | { kind: "set"; visibility: VisibilityLevel }
  | { kind: "remove" };

export type ParsedVisibilityRow = {
  rowNumber: number;
  identifier: string;
  /** Spaltenkopf (Kanalname) → Aktion */
  channelActions: Record<string, VisibilityCellAction>;
  cellErrors: string[];
};

export type VisibilityImportOptions = {
  apply: boolean;
};

export type VisibilityChannelChangeResult = {
  salesChannelName: string;
  salesChannelId: string;
  previousVisibility: number | null;
  action: "set" | "remove";
  visibility?: VisibilityLevel;
};

export type VisibilityImportRowResult = {
  rowNumber: number;
  identifier: string;
  productId?: string;
  productNumber?: string;
  productName?: string;
  matchStrategy?: string;
  status:
    | "would_update"
    | "updated"
    | "unchanged"
    | "not_found"
    | "ambiguous"
    | "error"
    | "skipped";
  changes: VisibilityChannelChangeResult[];
  message?: string;
};

export type VisibilityImportResult = {
  mode: "apply" | "dry-run";
  totalRows: number;
  matched: number;
  updated: number;
  unchanged: number;
  notFound: number;
  ambiguous: number;
  errors: number;
  unknownColumns: string[];
  rows: VisibilityImportRowResult[];
};

export type VisibilityImportDeps = {
  client: ShopwareClient;
  products: Product[];
  salesChannels: Array<{ id: string; name: string }>;
};

const IDENTIFIER_SEPARATORS_RE = /[\s\u00A0\-–._/]/g;

function normalizeIdentifierValue(value: string | undefined | null): string | undefined {
  if (value == null || typeof value !== "string") return undefined;
  const compact = value.trim().replace(IDENTIFIER_SEPARATORS_RE, "");
  return compact ? compact.toLowerCase() : undefined;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-");
}

/** Mappt Excel-Zellwert auf Sichtbarkeits-Aktion. Leer = null (unverändert). */
export function parseVisibilityCell(value: unknown): VisibilityCellAction | null | { error: string } {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 30) return { kind: "set", visibility: 30 };
    if (value === 20) return { kind: "set", visibility: 20 };
    if (value === 10) return { kind: "set", visibility: 10 };
    return { error: `Ungültiger Visibility-Wert: ${value}` };
  }

  const token = normalizeToken(value);
  if (!token) return null;

  if (["sichtbar", "visible", "30", "v", "show"].includes(token)) {
    return { kind: "set", visibility: 30 };
  }
  if (
    ["listen", "produktlisten", "in produktlisten ausblenden", "hide_listing", "20", "l"].includes(
      token,
    )
  ) {
    return { kind: "set", visibility: 20 };
  }
  if (
    [
      "suche",
      "such+listen",
      "suche+listen",
      "in produktlisten und suche ausblenden",
      "hide_search",
      "10",
      "s",
    ].includes(token)
  ) {
    return { kind: "set", visibility: 10 };
  }
  if (["entfernen", "remove", "delete", "-", "x", "löschen", "loeschen"].includes(token)) {
    return { kind: "remove" };
  }

  return { error: `Unbekannter Sichtbarkeitswert: "${String(value).trim()}"` };
}

export function parseVisibilityMatrixFromBuffer(buffer: Buffer): ParsedVisibilityRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel-Datei enthält kein Tabellenblatt");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  if (!matrix.length) {
    throw new Error("Excel-Datei ist leer");
  }

  const headerRow = matrix[0] ?? [];
  const identifierHeader = normalizeHeader(headerRow[0]);
  if (!identifierHeader) {
    throw new Error('Erste Spalte muss "Identifier" (oder Artikelkennung) heißen');
  }

  const channelHeaders: Array<{ index: number; name: string }> = [];
  for (let i = 1; i < headerRow.length; i++) {
    const name = normalizeHeader(headerRow[i]);
    if (!name) continue;
    channelHeaders.push({ index: i, name });
  }

  if (channelHeaders.length === 0) {
    throw new Error("Keine Verkaufskanal-Spalten gefunden (Spalte 2 ff.)");
  }

  const rows: ParsedVisibilityRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const raw = matrix[r] ?? [];
    const identifier = String(raw[0] ?? "").trim();
    if (!identifier) continue;

    const channelActions: Record<string, VisibilityCellAction> = {};
    const cellErrors: string[] = [];

    for (const col of channelHeaders) {
      const parsed = parseVisibilityCell(raw[col.index]);
      if (parsed == null) continue;
      if ("error" in parsed) {
        cellErrors.push(`${col.name}: ${parsed.error}`);
        continue;
      }
      channelActions[col.name] = parsed;
    }

    rows.push({
      rowNumber: r + 1,
      identifier,
      channelActions,
      cellErrors,
    });
  }

  return rows;
}

type LookupEntry = { product: Product; strategy: string };

function addLookupKey(
  map: Map<string, LookupEntry[]>,
  key: string | undefined,
  product: Product,
  strategy: string,
): void {
  const normalized = normalizeIdentifierValue(key);
  if (!normalized) return;
  const list = map.get(normalized) ?? [];
  if (!list.some((e) => e.product.id === product.id)) {
    list.push({ product, strategy });
  }
  map.set(normalized, list);
}

function buildIdentifierLookup(products: Product[]): Map<string, LookupEntry[]> {
  const map = new Map<string, LookupEntry[]>();
  for (const product of products) {
    addLookupKey(map, product.ean, product, "ean");
    addLookupKey(map, product.productNumber, product, "productNumber");
    addLookupKey(map, product.manufacturerNumber, product, "manufacturerNumber");
    addLookupKey(map, product.sapProductNumber, product, "sapProductNumber");
    addLookupKey(map, getWduIfsProductNumber(product.customFields), product, "wdu_ifs_productnumber");
  }
  return map;
}

function resolveSalesChannelMap(
  salesChannels: Array<{ id: string; name: string }>,
): Map<string, { id: string; name: string }> {
  const map = new Map<string, { id: string; name: string }>();
  for (const sc of salesChannels) {
    const key = normalizeToken(sc.name);
    if (key) map.set(key, sc);
  }
  return map;
}

async function fetchCurrentVisibilities(
  client: ShopwareClient,
  productId: string,
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  try {
    const current = await client.searchEntity("product-visibility", {
      limit: 500,
      filter: [{ type: "equals", field: "productId", value: productId }],
      includes: {
        product_visibility: ["id", "salesChannelId", "visibility"],
      },
    });
    for (const entry of current?.data || []) {
      const salesChannelId = entry?.salesChannelId || entry?.attributes?.salesChannelId;
      if (!salesChannelId) continue;
      const visibility = entry?.visibility ?? entry?.attributes?.visibility ?? null;
      map.set(salesChannelId, typeof visibility === "number" ? visibility : null);
    }
  } catch {
    // Dry-Run ohne vorherige Werte ist akzeptabel
  }
  return map;
}

export async function runVisibilityImport(
  deps: VisibilityImportDeps,
  rows: ParsedVisibilityRow[],
  options: VisibilityImportOptions,
  log: (message: string) => void = () => {},
): Promise<VisibilityImportResult> {
  const { client, products, salesChannels } = deps;
  const lookup = buildIdentifierLookup(products);
  const channelByName = resolveSalesChannelMap(salesChannels);

  const unknownColumnsSet = new Set<string>();
  const results: VisibilityImportRowResult[] = [];
  let matched = 0;
  let updated = 0;
  let unchanged = 0;
  let notFound = 0;
  let ambiguous = 0;
  let errors = 0;

  for (const row of rows) {
    if (row.cellErrors.length > 0) {
      errors += 1;
      results.push({
        rowNumber: row.rowNumber,
        identifier: row.identifier,
        status: "error",
        changes: [],
        message: row.cellErrors.join("; "),
      });
      continue;
    }

    const resolvedChannels: Array<{
      name: string;
      id: string;
      action: VisibilityCellAction;
    }> = [];

    for (const [channelName, action] of Object.entries(row.channelActions)) {
      const sc = channelByName.get(normalizeToken(channelName));
      if (!sc) {
        unknownColumnsSet.add(channelName);
        continue;
      }
      resolvedChannels.push({ name: sc.name, id: sc.id, action });
    }

    if (Object.keys(row.channelActions).length > 0 && resolvedChannels.length === 0) {
      errors += 1;
      results.push({
        rowNumber: row.rowNumber,
        identifier: row.identifier,
        status: "error",
        changes: [],
        message: "Keine gültigen Verkaufskanal-Spalten in dieser Zeile",
      });
      continue;
    }

    const needle = normalizeIdentifierValue(row.identifier);
    const hits = needle ? lookup.get(needle) ?? [] : [];

    if (hits.length === 0) {
      notFound += 1;
      results.push({
        rowNumber: row.rowNumber,
        identifier: row.identifier,
        status: "not_found",
        changes: [],
        message: "Kein Produkt mit dieser Kennung gefunden (GTIN / Artikelnr. / SAP)",
      });
      continue;
    }

    const uniqueById = new Map<string, LookupEntry>();
    for (const hit of hits) {
      if (!uniqueById.has(hit.product.id)) uniqueById.set(hit.product.id, hit);
    }
    if (uniqueById.size > 1) {
      ambiguous += 1;
      const numbers = Array.from(uniqueById.values())
        .map((h) => h.product.productNumber)
        .join(", ");
      results.push({
        rowNumber: row.rowNumber,
        identifier: row.identifier,
        status: "ambiguous",
        changes: [],
        message: `Mehrere Produkte gefunden: ${numbers}`,
      });
      continue;
    }

    const hit = Array.from(uniqueById.values())[0]!;
    matched += 1;

    if (resolvedChannels.length === 0) {
      unchanged += 1;
      results.push({
        rowNumber: row.rowNumber,
        identifier: row.identifier,
        productId: hit.product.id,
        productNumber: hit.product.productNumber,
        productName: hit.product.name,
        matchStrategy: hit.strategy,
        status: "unchanged",
        changes: [],
        message: "Keine Änderungen in dieser Zeile",
      });
      continue;
    }

    const currentVis = await fetchCurrentVisibilities(client, hit.product.id);
    const plannedChanges: VisibilityChannelChangeResult[] = [];
    const apiChanges: Array<
      | { salesChannelId: string; visibility: VisibilityLevel }
      | { salesChannelId: string; remove: true }
    > = [];

    for (const ch of resolvedChannels) {
      const previous = currentVis.get(ch.id) ?? null;
      if (ch.action.kind === "remove") {
        if (previous == null) continue; // bereits nicht zugewiesen
        plannedChanges.push({
          salesChannelName: ch.name,
          salesChannelId: ch.id,
          previousVisibility: previous,
          action: "remove",
        });
        apiChanges.push({ salesChannelId: ch.id, remove: true });
      } else {
        if (previous === ch.action.visibility) continue;
        plannedChanges.push({
          salesChannelName: ch.name,
          salesChannelId: ch.id,
          previousVisibility: previous,
          action: "set",
          visibility: ch.action.visibility,
        });
        apiChanges.push({ salesChannelId: ch.id, visibility: ch.action.visibility });
      }
    }

    if (plannedChanges.length === 0) {
      unchanged += 1;
      results.push({
        rowNumber: row.rowNumber,
        identifier: row.identifier,
        productId: hit.product.id,
        productNumber: hit.product.productNumber,
        productName: hit.product.name,
        matchStrategy: hit.strategy,
        status: "unchanged",
        changes: [],
        message: "Sichtbarkeit bereits wie gewünscht",
      });
      continue;
    }

    if (!options.apply) {
      updated += 1;
      results.push({
        rowNumber: row.rowNumber,
        identifier: row.identifier,
        productId: hit.product.id,
        productNumber: hit.product.productNumber,
        productName: hit.product.name,
        matchStrategy: hit.strategy,
        status: "would_update",
        changes: plannedChanges,
      });
      continue;
    }

    try {
      await client.applyProductVisibilityChanges(hit.product.id, apiChanges);
      updated += 1;
      results.push({
        rowNumber: row.rowNumber,
        identifier: row.identifier,
        productId: hit.product.id,
        productNumber: hit.product.productNumber,
        productName: hit.product.name,
        matchStrategy: hit.strategy,
        status: "updated",
        changes: plannedChanges,
      });
    } catch (error: unknown) {
      errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        rowNumber: row.rowNumber,
        identifier: row.identifier,
        productId: hit.product.id,
        productNumber: hit.product.productNumber,
        productName: hit.product.name,
        matchStrategy: hit.strategy,
        status: "error",
        changes: plannedChanges,
        message,
      });
      log(`[Visibility-Import] Fehler bei ${row.identifier}: ${message}`);
    }
  }

  return {
    mode: options.apply ? "apply" : "dry-run",
    totalRows: rows.length,
    matched,
    updated,
    unchanged,
    notFound,
    ambiguous,
    errors,
    unknownColumns: Array.from(unknownColumnsSet).sort(),
    rows: results,
  };
}

/** Erzeugt eine Excel-Vorlage mit Identifier + Verkaufskanal-Spalten und Legende. */
export function buildVisibilityImportTemplateBuffer(
  salesChannels: Array<{ id: string; name: string }>,
): Buffer {
  const headers = ["Identifier", ...salesChannels.map((sc) => sc.name)];
  const exampleRow = [
    "Beispiel-GTIN-oder-Artikelnr",
    ...salesChannels.map((_, i) => (i === 0 ? "sichtbar" : "")),
  ];

  const dataSheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  const legendSheet = XLSX.utils.aoa_to_sheet([
    ["Wert", "Bedeutung", "Shopware visibility"],
    ["sichtbar / visible / 30", "Sichtbar", 30],
    ["listen / produktlisten / 20", "In Produktlisten ausblenden", 20],
    ["suche / such+listen / 10", "In Produktlisten und Suche ausblenden", 10],
    ["entfernen / - / x", "Verkaufskanal-Zuordnung entfernen", "—"],
    ["(leer)", "Unverändert lassen", "—"],
    [],
    ["Hinweis"],
    [
      "Spalte 1: Identifier (GTIN/EAN, Shopware-Artikelnr., Hersteller-Nr./alt, oder SAP/wdu_ifs_productnumber).",
    ],
    ["Weitere Spalten: Name des Verkaufskanals (exakt wie in Shopware)."],
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Sichtbarkeit");
  XLSX.utils.book_append_sheet(workbook, legendSheet, "Legende");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
