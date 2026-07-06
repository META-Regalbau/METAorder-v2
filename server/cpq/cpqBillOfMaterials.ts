/**
 * CPQ Bill of Materials - resolves config to line items with product details
 */

import type { ConfigContext } from "./ruleEvaluator";
import { evaluateRules } from "./constraintEngine";
import type { CpqComponentType, CpqProductMapping, CpqRule } from "@shared/schema";

export type BomLineItem = {
  productId: string;
  productNumber: string; // GTIN/EAN (Shop-Produktnummer)
  manufacturerNumber?: string; // eigentliche Artikelnummer (für GLB, Stückliste)
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  componentType: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  length?: number;
};

export type BillOfMaterialsResult = {
  items: BomLineItem[];
  totalPrice: number;
  errors: string[];
  warnings: string[];
};

// Maps component type role to config quantity key (engl. + deutsche/synonyme Bezeichnungen)
const ROLE_TO_QUANTITY: Record<string, string> = {
  frame: "frame_quantity",
  beam: "beam_quantity",
  shelf: "shelf_quantity",
  connector: "connector_quantity",
  accessory: "accessory_quantity",
  // Deutsche/Synonyme für Stücklistenberechnung
  steher: "frame_quantity",
  ständer: "frame_quantity",
  rahmen: "frame_quantity",
  stand: "frame_quantity",
  traverse: "beam_quantity",
  träger: "beam_quantity",
  längsträger: "beam_quantity",
  boden: "shelf_quantity",
  böden: "shelf_quantity",
  fachboden: "shelf_quantity",
  regalboden: "shelf_quantity",
  zubehör: "accessory_quantity",
};

/** Rolle normalisieren (z. B. "Steher" → "frame") für Mengen-Lookup.
 *  Unterstützt auch Rollen wie "Ständer 2000x600" oder "Regalboden" per enthalten-Prüfung. */
function normalizeRole(role: string): string {
  const r = role.toLowerCase().trim();
  if (ROLE_TO_QUANTITY[r]) return r;
  // Exakte Matches
  if (["frame", "steher", "ständer", "rahmen", "stand"].includes(r)) return "frame";
  if (["beam", "traverse", "träger", "längsträger"].includes(r)) return "beam";
  if (["shelf", "boden", "böden", "fachboden", "regalboden"].includes(r)) return "shelf";
  // Enthält-Prüfung für Rollen wie "Ständer 2000x600", "Regalboden 1000x600"
  if (r.includes("ständer") || r.includes("steher") || r.includes("rahmen") || (r.includes("stand") && !r.includes("regal"))) return "frame";
  if (r.includes("träger") || r.includes("traverse") || r.includes("längsträger")) return "beam";
  if (r.includes("boden") || r.includes("böden") || r.includes("fachboden") || r.includes("regalboden") || r.includes("shelf")) return "shelf";
  if (r.includes("zubehör") || r.includes("accessory")) return "accessory";
  if (r.includes("connector")) return "connector";
  return r;
}

// Maps component type role to config attribute keys for matching
const ROLE_ATTR_MAP: Record<string, string[]> = {
  frame: ["height", "depth"],
  beam: ["width", "length"],
  shelf: ["width", "depth"],
};

const DIMENSIONED_ROLES = new Set(["frame", "beam", "shelf"]);

/** Shopware-Maße können Floats sein – Vergleich mit ±1 mm Toleranz. */
const DIMENSION_TOLERANCE_MM = 1;

function dimensionsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= DIMENSION_TOLERANCE_MM;
}

function isDimensionedRole(role: string): boolean {
  return DIMENSIONED_ROLES.has(role);
}

function formatDimensionMismatch(role: string, config: ConfigContext): string {
  const parts: string[] = [];
  const attrKeys = ROLE_ATTR_MAP[role] ?? [];
  for (const key of attrKeys) {
    const val = config[key] as number | undefined;
    if (val !== undefined) {
      const label = key === "depth" ? "Tiefe" : key === "height" ? "Höhe" : key === "width" ? "Breite" : key;
      parts.push(`${label} ${val} mm`);
    }
  }
  return parts.length > 0 ? parts.join(", ") : "gewählte Maße";
}

// Produkt-Dimensionen für Fallback-Matching (Shopware: length = Tiefe)
interface ProductDimensions {
  width?: number;
  height?: number;
  length?: number;
}

export type GetProductFn = (
  productNumber: string
) =>
  | {
      id: string;
      name: string;
      price: number;
      dimensions?: ProductDimensions;
      manufacturerNumber?: string;
      imageUrl?: string;
    }
  | undefined;

function resolveProductDimension(
  key: string,
  attrs: Record<string, number> | null | undefined,
  dims: ProductDimensions | undefined
): number | undefined {
  const attrVal = attrs?.[key] as number | undefined;
  if (attrVal !== undefined) return attrVal;
  if (!dims) return undefined;
  if (key === "height") return dims.height;
  if (key === "depth" || key === "length") return dims.length;
  if (key === "width") return dims.width;
  return undefined;
}

function matchMappingToConfig(
  mapping: CpqProductMapping,
  role: string,
  config: ConfigContext,
  getProduct: GetProductFn
): boolean {
  const attrKeys = ROLE_ATTR_MAP[role];
  if (!attrKeys) return true;

  const attrs = mapping.attributes as Record<string, number> | null | undefined;
  const product = getProduct(mapping.shopwareProductNumber);
  const dims = product?.dimensions;

  for (const key of attrKeys) {
    const configVal = config[key] as number | undefined;
    if (configVal === undefined) continue;

    const productVal = resolveProductDimension(key, attrs ?? undefined, dims);
    if (productVal === undefined) {
      // Dimensionierte Rolle + gesetzte Config-Dimension → ohne passenden Wert kein Match
      if (isDimensionedRole(role)) return false;
      continue;
    }

    if (!dimensionsEqual(configVal, productVal)) {
      return false;
    }
  }
  return true;
}

export async function resolveBillOfMaterials(
  systemId: string,
  config: ConfigContext,
  componentTypes: CpqComponentType[],
  mappings: CpqProductMapping[],
  rules: CpqRule[],
  getProductByNumber: GetProductFn
): Promise<BillOfMaterialsResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const items: BomLineItem[] = [];

  const result = evaluateRules(rules, config);
  if (result.errors.length > 0) {
    return { items: [], totalPrice: 0, errors: result.errors, warnings: result.warnings };
  }
  Object.assign(warnings, result.warnings);

  const cfg = result.config;
  const fieldCount = (cfg.field_count as number) ?? 1;
  const levelCount = (cfg.level_count as number) ?? 2;

  // Typische Feldbreite (mm) für Shelf-Matching, falls width fehlt
  if (cfg.width === undefined) cfg.width = 1000;

  if (cfg.frame_quantity === undefined) cfg.frame_quantity = fieldCount + 1;
  if (cfg.beam_quantity === undefined) cfg.beam_quantity = levelCount * fieldCount * 2;
  if (cfg.shelf_quantity === undefined) cfg.shelf_quantity = levelCount * fieldCount;

  const mappingsByType = new Map<string, CpqProductMapping[]>();
  for (const m of mappings) {
    if (m.status !== "active") continue;
    const ctId = m.componentTypeId;
    const list = mappingsByType.get(ctId) ?? [];
    list.push(m);
    mappingsByType.set(ctId, list);
  }

  for (const ct of componentTypes) {
    const role = (ct.role ?? "").trim() || (ct.name ?? "");
    const normalizedRole = normalizeRole(role) || normalizeRole(ct.name ?? "");
    const qtyKey = ROLE_TO_QUANTITY[normalizedRole] ?? `${normalizedRole || role}_quantity`;
    let qty = (result.config[qtyKey] as number) ?? 0;
    if (qty <= 0) continue;

    const list = mappingsByType.get(ct.id) ?? [];
    const candidates = list.filter((m) => matchMappingToConfig(m, normalizedRole, result.config, getProductByNumber));
    let mapping = candidates[0];
    if (!mapping && list.length > 0) {
      if (isDimensionedRole(normalizedRole)) {
        errors.push(
          `${ct.name}: Kein passender Artikel für ${formatDimensionMismatch(normalizedRole, result.config)} gefunden`
        );
        continue;
      }
      mapping = list[0];
    }
    if (!mapping) {
      warnings.push(`${ct.name}: Kein Produkt-Mapping vorhanden`);
      continue;
    }

    const product = getProductByNumber(mapping.shopwareProductNumber);
    if (!product) {
      errors.push(
        `Produkt ${mapping.shopwareProductNumber} (${ct.name}) nicht im Katalog gefunden. ` +
        "Bitte Shopware-Sync ausführen (Admin > Einstellungen > Shopware) oder Produktnummer/ManufacturerNr im Mapping prüfen."
      );
      continue;
    }

    items.push({
      productId: product.id,
      productNumber: mapping.shopwareProductNumber,
      manufacturerNumber: product.manufacturerNumber ?? undefined,
      name: product.name,
      quantity: qty,
      unitPrice: product.price,
      lineTotal: qty * product.price,
      componentType: ct.name,
      imageUrl: product.imageUrl,
      width: product.dimensions?.width,
      height: product.dimensions?.height,
      length: product.dimensions?.length,
    });
  }

  for (const req of result.requiredComponents) {
    if (!req.type) continue;
    const reqNorm = normalizeRole(req.type);
    const ct = componentTypes.find(
      (c) => normalizeRole(c.role) === reqNorm || c.role === req.type || c.name.toLowerCase().includes(req.type.toLowerCase())
    );
    if (!ct) continue;

    const list = mappingsByType.get(ct.id) ?? [];
    const mapping = list.find((m) => {
      if (!req.value) return true;
      const attrs = m.attributes as Record<string, unknown> | null;
      return attrs && attrs[req.attribute ?? "subtype"] === req.value;
    }) ?? list[0];
    if (!mapping) continue;

    const existing = items.find((i) => i.productNumber === mapping.shopwareProductNumber);
    if (existing) continue;

    const product = getProductByNumber(mapping.shopwareProductNumber);
    if (!product) {
      warnings.push(`Pflicht-Zubehör ${mapping.shopwareProductNumber} nicht im Katalog`);
      continue;
    }

    items.push({
      productId: product.id,
      productNumber: mapping.shopwareProductNumber,
      manufacturerNumber: product.manufacturerNumber ?? undefined,
      name: product.name,
      quantity: 1,
      unitPrice: product.price,
      lineTotal: product.price,
      componentType: ct.name,
      imageUrl: product.imageUrl,
      width: product.dimensions?.width,
      height: product.dimensions?.height,
      length: product.dimensions?.length,
    });
  }

  const totalPrice = items.reduce((sum, i) => sum + i.lineTotal, 0);

  // Diagnose: Komponententypen/Mappings vorhanden, aber keine Positionen
  if (items.length === 0 && componentTypes.length > 0 && mappings.some((m) => m.status === "active")) {
    const roleHints = componentTypes.map((ct) => {
      const r = ((ct.role ?? "").trim() || (ct.name ?? ""));
      const norm = normalizeRole(r) || normalizeRole(ct.name ?? "");
      const qtyKey = ROLE_TO_QUANTITY[norm] ?? `${norm || r}_quantity`;
      const qty = (result.config[qtyKey] as number) ?? 0;
      return `${ct.name} (Rolle: "${ct.role || "—"}") → ${qtyKey}=${qty}`;
    });
    warnings.push(
      "Stückliste leer trotz Komponententypen/Mappings. " +
        "Rollen der Komponententypen müssen ‚Ständer/Steher‘, ‚Böden/Boden‘ oder ‚Träger‘ enthalten. " +
        `Diagnose: ${roleHints.join("; ")}. ` +
        "Falls Rollen stimmen: Shopware-Sync ausführen (Admin > Einstellungen > Shopware)."
    );
  }

  return { items, totalPrice, errors, warnings };
}
