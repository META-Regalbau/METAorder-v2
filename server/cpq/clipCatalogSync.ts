/**
 * Regalplaner META CLIP: Produkt-Mappings aus dem Shop-Katalog ableiten.
 *
 * Die Mappings (cpq_product_mapping) bestimmen, welche Shop-Artikel der Regalplaner in die Stückliste
 * nimmt. Bis Oktober 2026 waren sie händisch gepflegt: S3-Ständer und Fremdböden (META FIX 80 kg,
 * MULTISTRONG 330 kg bei 1300 mm) steckten im CLIP-System, S3 fehlte fast ganz. Dieses Modul leitet den
 * Soll-Stand aus den Artikelnamen ab:
 *
 * - Ständerrahmen: „META CLIP | Ständerrahmen T1N | H x T mm“ (vormontiert, frameVariant clinch) und
 *   „META CLIP S3 | Ständerrahmen T1N/T2N | H x T mm“ (Steckrahmen, frameVariant s3). Die Feldlast kommt aus
 *   den Grund- und Anbauregalen desselben Systems mit gleicher Höhe und gleichem Rahmentyp (Eigenschaft
 *   „max. Feldlast“, kleinster Wert). Ohne belegte Feldlast wird der Rahmen nicht angeboten.
 * - Böden: „META CLIP | Zusatz-Fachboden | B x T mm | Last kg“ (mit Fachbodenträgern), weder SPLIT noch Doppelpack.
 * - Diagonalstab je Feldbreite, Vollblech-Rückwand (Höhe x Breite) und die Kleinteile mit festem Namen.
 * - Nur aktive Artikel, die im Onlineshop „META Regalbau DE“ sichtbar sind; Oberfläche nur verzinkt und RAL 7035.
 *
 * Reine Funktionen; den Abgleich mit der Datenbank macht clipCatalogSyncService.ts.
 */
import type { CpqProductMapping } from "@shared/schema";

/** Onlineshop „META Regalbau DE“ (gleiche ID im Testshop und im Live-Shop). */
export const CLIP_SALES_CHANNEL_ID = "018ec134507f703b82a76467791e7e61";

export type ClipRole =
  | "frame"
  | "shelf"
  | "diagonal"
  | "accessory"
  | "spannschloss"
  | "klemmfuss"
  | "abdeckkappe"
  | "verankerung_grund"
  | "verankerung_anbau";

/** Bauteiltypen des Systems META CLIP (Name im CPQ-Admin, Rolle = Mengen-Schlüssel der Stückliste). */
export const CLIP_COMPONENT_TYPES: Array<{ role: ClipRole; name: string; required: boolean }> = [
  { role: "frame", name: "Ständer", required: true },
  { role: "shelf", name: "Boden", required: true },
  { role: "diagonal", name: "Diagonalstab", required: true },
  { role: "spannschloss", name: "Spannschloss", required: true },
  { role: "klemmfuss", name: "Klemmfuß-Set", required: true },
  { role: "abdeckkappe", name: "Abdeckkappen-Set", required: true },
  { role: "accessory", name: "Rückwand", required: false },
  { role: "verankerung_grund", name: "Verankerung Grundregal", required: false },
  { role: "verankerung_anbau", name: "Verankerung Anbauregal", required: false },
];

export type ClipCatalogProduct = {
  shopwareId: string;
  productNumber: string;
  name: string;
  active: boolean;
  salesChannelIds: string[];
  /** Eigenschaften „Gruppe → Wert“ (nur für Grund- und Anbauregale gebraucht). */
  properties: Record<string, string>;
};

export type FrameVariant = "clinch" | "s3";
export type MappingAttributes = Record<string, number | string>;

export type ClipMappingSpec = {
  role: ClipRole;
  shopwareProductId: string;
  shopwareProductNumber: string;
  productName: string;
  attributes: MappingAttributes;
};

const SURFACES: Record<string, string> = { "ral 7035": "lackiert", verzinkt: "verzinkt", vzk: "verzinkt" };
const surfaceOf = (raw: string) => SURFACES[raw.trim().toLowerCase()];

const FRAME_RE = /^META CLIP( S3)? \| Ständerrahmen (T[12]N) \| (\d{4}) x (\d{3}) mm \| (RAL 7035|verzinkt|vzk)$/;
const SHELF_RE = /^META CLIP \| Zusatz-Fachboden \| (\d{3,4}) x (\d{3}) mm \| (\d+) kg \| (RAL 7035|verzinkt)$/;
const DIAGONAL_RE = /^META CLIP \| Diagonalstab \| für Regalbreite (\d{3,4}) mm\s*\| verzinkt$/;
const REAR_RE = /^META CLIP \| Vollblech-Rückwand \| (\d{4}) x (\d{3,4}) mm \| (RAL 7035|verzinkt)$/;
const FIXED_PARTS: Array<{ name: string; role: ClipRole }> = [
  { name: "META CLIP | Spannschloss | für CLIP Diagonalstab | verzinkt", role: "spannschloss" },
  { name: "META CLIP | Klemmfuß Einfachregal | verzinkt | 10 Stück", role: "klemmfuss" },
  { name: "META CLIP | Abdeckkappe Einfachregal | 10 Stück", role: "abdeckkappe" },
  { name: "META CLIP | Fußverdübelungs-Set für Grundregal", role: "verankerung_grund" },
  { name: "META CLIP | Fußverdübelungs-Set für Anbauregal", role: "verankerung_anbau" },
];
const SET_RE = /^META CLIP( S3)? \| Fachbodenregal \| (Grundregal|Anbauregal) \|/;

/** Rolle und Attribute eines Einzelteils aus dem Artikelnamen, oder null (kein Regalplaner-Teil). */
export function classifyClipPart(rawName: string): { role: ClipRole; attributes: MappingAttributes; frameType?: string } | null {
  const name = rawName.trim();
  let m = FRAME_RE.exec(name);
  if (m) {
    return {
      role: "frame",
      frameType: m[2],
      attributes: { height: Number(m[3]), depth: Number(m[4]), surface: surfaceOf(m[5]), frameVariant: m[1] ? "s3" : "clinch" },
    };
  }
  if ((m = SHELF_RE.exec(name))) {
    return { role: "shelf", attributes: { width: Number(m[1]), depth: Number(m[2]), load: Number(m[3]), surface: surfaceOf(m[4]) } };
  }
  if ((m = DIAGONAL_RE.exec(name))) return { role: "diagonal", attributes: { width: Number(m[1]) } };
  if ((m = REAR_RE.exec(name))) {
    return { role: "accessory", attributes: { height: Number(m[1]), width: Number(m[2]), surface: surfaceOf(m[3]) } };
  }
  const fixed = FIXED_PARTS.find((p) => p.name === name);
  return fixed ? { role: fixed.role, attributes: {} } : null;
}

const normType = (raw: string | undefined) => (raw ?? "").replace(/^(Rahmen|Profil)\s+/i, "").replace(/\s+/g, "").toUpperCase();
const kg = (raw: string | undefined) => {
  const n = Number(String(raw ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Feldlast je „Variante:Höhe:Rahmentyp“ aus den Grund- und Anbauregalen (kleinster belegter Wert). */
export function frameLoadTable(products: ClipCatalogProduct[]): Map<string, number> {
  const table = new Map<string, number>();
  for (const p of products) {
    const m = SET_RE.exec(p.name);
    if (!m || !p.active) continue;
    const pr = p.properties;
    if (pr["Bauweise"] && pr["Bauweise"] !== "Einfachregal") continue;
    const height = kg(pr["Höhe"]);
    const load = kg(pr["max. Feldlast"]);
    const type = normType(pr["Rahmentyp/Profiltyp"]);
    if (!height || !load || !type) continue;
    const key = `${m[1] ? "s3" : "clinch"}:${height}:${type}`;
    table.set(key, Math.min(load, table.get(key) ?? Number.POSITIVE_INFINITY));
  }
  return table;
}

export type ClipMappingPlan = {
  specs: ClipMappingSpec[];
  skipped: Array<{ productNumber: string; name: string; reason: string }>;
};

/** Soll-Stand der Mappings aus dem Katalog. */
export function buildClipMappingPlan(products: ClipCatalogProduct[]): ClipMappingPlan {
  const loads = frameLoadTable(products);
  const specs: ClipMappingSpec[] = [];
  const skipped: ClipMappingPlan["skipped"] = [];
  const seen = new Set<string>();
  for (const p of products) {
    const part = classifyClipPart(p.name);
    if (!part) continue;
    const skip = (reason: string) => skipped.push({ productNumber: p.productNumber, name: p.name, reason });
    if (!p.active) { skip("inaktiv"); continue; }
    if (!p.salesChannelIds.includes(CLIP_SALES_CHANNEL_ID)) { skip("nicht im Onlineshop META Regalbau DE"); continue; }
    if (seen.has(p.productNumber)) continue;
    const attributes = { ...part.attributes };
    if (part.role === "frame") {
      const key = `${attributes.frameVariant}:${attributes.height}:${part.frameType}`;
      const feldlast = loads.get(key);
      if (!feldlast) { skip(`keine belegte Feldlast (kein Grund-/Anbauregal ${key})`); continue; }
      attributes.feldlast = feldlast;
    }
    seen.add(p.productNumber);
    specs.push({ role: part.role, shopwareProductId: p.shopwareId, shopwareProductNumber: p.productNumber, productName: p.name, attributes });
  }
  return { specs, skipped };
}

export type ClipMappingDiff = {
  create: ClipMappingSpec[];
  update: Array<{ id: string; spec: ClipMappingSpec; before: { attributes: unknown; status: string; componentTypeId: string } }>;
  deactivate: Array<{ id: string; productNumber: string; name: string | null; before: { status: string } }>;
  unchanged: number;
};

const sameAttrs = (a: unknown, b: MappingAttributes) => {
  const x = (a ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(b)]);
  return [...keys].every((k) => x[k] === b[k]);
};

/**
 * Vergleicht den Ist-Stand mit dem Soll-Stand. Mappings, die der Katalog nicht (mehr) hergibt, werden
 * nur deaktiviert (status inactive), nie gelöscht – so bleibt der Rückbau einfach.
 */
export function diffClipMappings(
  current: CpqProductMapping[],
  specs: ClipMappingSpec[],
  componentTypeIdByRole: Record<string, string>,
): ClipMappingDiff {
  const diff: ClipMappingDiff = { create: [], update: [], deactivate: [], unchanged: 0 };
  const byNumber = new Map<string, CpqProductMapping>();
  for (const m of current) {
    // Bei doppelten Mappings gewinnt das aktive; das zweite wird deaktiviert
    const prev = byNumber.get(m.shopwareProductNumber);
    if (!prev || (prev.status !== "active" && m.status === "active")) {
      if (prev && prev.status === "active") diff.deactivate.push({ id: prev.id, productNumber: prev.shopwareProductNumber, name: prev.productName, before: { status: prev.status } });
      byNumber.set(m.shopwareProductNumber, m);
    } else if (m.status === "active") {
      diff.deactivate.push({ id: m.id, productNumber: m.shopwareProductNumber, name: m.productName, before: { status: m.status } });
    }
  }
  const wanted = new Set<string>();
  for (const spec of specs) {
    wanted.add(spec.shopwareProductNumber);
    const ctId = componentTypeIdByRole[spec.role];
    const existing = byNumber.get(spec.shopwareProductNumber);
    if (!existing) { diff.create.push(spec); continue; }
    if (existing.status === "active" && existing.componentTypeId === ctId && sameAttrs(existing.attributes, spec.attributes)) {
      diff.unchanged++;
      continue;
    }
    diff.update.push({ id: existing.id, spec, before: { attributes: existing.attributes, status: existing.status, componentTypeId: existing.componentTypeId } });
  }
  for (const m of byNumber.values()) {
    if (!wanted.has(m.shopwareProductNumber) && m.status === "active") {
      diff.deactivate.push({ id: m.id, productNumber: m.shopwareProductNumber, name: m.productName, before: { status: m.status } });
    }
  }
  return diff;
}

/** Kombinationen, die der Katalog wirklich hergibt – der Regalplaner bietet nur diese an (GET …/options). */
export type ClipCombinations = {
  frames: Array<{ variant: FrameVariant; height: number; depth: number; surface: string; feldlast: number | null }>;
  shelves: Array<{ width: number; depth: number; load: number; surface: string }>;
  rears: Array<{ height: number; width: number; surface: string }>;
  diagonals: number[];
};

export function clipCombinationsFromMappings(
  mappings: Array<Pick<CpqProductMapping, "componentTypeId" | "attributes" | "status">>,
  componentTypes: Array<{ id: string; role: string }>,
): ClipCombinations {
  const roleOf = new Map(componentTypes.map((t) => [t.id, t.role.toLowerCase().trim()]));
  const out: ClipCombinations = { frames: [], shelves: [], rears: [], diagonals: [] };
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  for (const m of mappings) {
    if (m.status !== "active") continue;
    const a = (m.attributes ?? {}) as Record<string, unknown>;
    const surface = typeof a.surface === "string" ? a.surface : "verzinkt";
    switch (roleOf.get(m.componentTypeId)) {
      case "frame":
        if (num(a.height) && num(a.depth)) {
          out.frames.push({
            variant: a.frameVariant === "s3" ? "s3" : "clinch",
            height: num(a.height),
            depth: num(a.depth),
            surface,
            feldlast: num(a.feldlast) || null,
          });
        }
        break;
      case "shelf":
        if (num(a.width) && num(a.depth) && num(a.load)) out.shelves.push({ width: num(a.width), depth: num(a.depth), load: num(a.load), surface });
        break;
      case "accessory":
        if (num(a.height) && num(a.width)) out.rears.push({ height: num(a.height), width: num(a.width), surface });
        break;
      case "diagonal":
        if (num(a.width) && !out.diagonals.includes(num(a.width))) out.diagonals.push(num(a.width));
        break;
    }
  }
  return out;
}
