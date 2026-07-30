/**
 * Shopware-Varianten: Größe/Farbe aus Options/Properties/Name ableiten und Anzeigelabel bauen.
 * Anzeige-Soll: Nummer · Name · Größe · Farbe
 */

export type VariantOptionLike = {
  group?: string | null;
  option?: string | null;
  value?: string | null;
};

export type PropertyLike = {
  groupName?: string | null;
  optionName?: string | null;
};

export type ErpProductLabel = {
  productNumber: string;
  name: string | null;
  size: string | null;
  color: string | null;
  optionsLabel: string | null;
  /** Kompakte Zeile: Nummer · Name · Größe · Farbe */
  label: string;
  /** Shopware-UUID — nur für API-Aktionen, nicht als Anzeige */
  shopwareId?: string | null;
  /** false = inaktiv in Shopware */
  active?: boolean | null;
  /** Parent mit Varianten — nicht als Lager-SKU */
  isParent?: boolean;
};

const SIZE_GROUP_RE =
  /größe|groesse|grösse|grosse|size|maßangabe|massangabe|maß|mass|dimension|länge|laenge|konfektion|kleidergröße|kleidergroesse|clothing\s*size/i;
const COLOR_GROUP_RE = /farbe|color|colour|farbton|ral/i;
/** Bekannte Größen-Tokens (längere zuerst) — auch als Optionswert. */
const SIZE_TOKEN_RE = /\b(XXXL|XXL|XL|XXS|XS|3XL|2XL|S|M|L)\b/i;
const SIZE_VALUE_RE = /^(XXXL|XXL|XL|XXS|XS|3XL|2XL|S|M|L|\d{2,3})$/i;

function looksLikeSizeValue(opt: string): boolean {
  return SIZE_VALUE_RE.test(norm(opt));
}

function norm(s: string | null | undefined): string {
  return String(s ?? "").trim();
}

export function optionsFromProperties(properties?: PropertyLike[] | null): VariantOptionLike[] {
  if (!properties?.length) return [];
  return properties
    .map((p) => ({ group: norm(p.groupName), option: norm(p.optionName) }))
    .filter((o) => o.group && o.option);
}

/**
 * Größe/Farbe aus dem Varianten-Namen (Fallback, wenn Options fehlen).
 * z. B. `"Buntspecht" Frauen T-Shirt L Melange Grey` → size L, color Melange Grey
 */
export function parseSizeColorFromName(name: string | null | undefined): {
  size: string | null;
  color: string | null;
  baseName: string | null;
} {
  let working = norm(name).replace(/^["'\u201e\u201c]+|["'\u201c\u201d]+$/g, "").trim();
  if (!working) return { size: null, color: null, baseName: null };

  const sizeMatch = working.match(SIZE_TOKEN_RE);
  let size: string | null = null;
  let color: string | null = null;

  if (sizeMatch && sizeMatch.index != null) {
    size = sizeMatch[1].toUpperCase();
    const after = working.slice(sizeMatch.index + sizeMatch[0].length).trim();
    if (after) color = after.replace(/^[-–,]+/, "").trim() || null;
    working = working.slice(0, sizeMatch.index).trim().replace(/[-–,]+$/, "").trim();
  }

  return {
    size,
    color,
    baseName: working.replace(/["'\u201e\u201c\u201d]/g, "").replace(/\s+/g, " ").trim() || null,
  };
}

export function extractSizeColor(
  options?: VariantOptionLike[] | null,
  properties?: PropertyLike[] | null,
  name?: string | null,
): { size: string | null; color: string | null; optionsLabel: string | null; baseName: string | null } {
  const merged: VariantOptionLike[] = [
    ...(options || []),
    ...optionsFromProperties(properties),
  ];
  const seen = new Set<string>();
  const unique: VariantOptionLike[] = [];
  for (const o of merged) {
    const group = norm(o.group);
    const option = norm(o.option) || norm(o.value);
    if (!option) continue;
    const key = `${group.toLowerCase()}::${option.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ group, option });
  }

  let size: string | null = null;
  let color: string | null = null;
  for (const o of unique) {
    const g = norm(o.group);
    const opt = norm(o.option);
    if (!opt) continue;
    if (!size && SIZE_GROUP_RE.test(g)) size = opt;
    else if (!color && COLOR_GROUP_RE.test(g)) color = opt;
  }

  // Optionswerte wie S/M/L/XL/42 als Größe, auch wenn Gruppenname nicht matcht
  if (!size) {
    for (const o of unique) {
      const opt = norm(o.option);
      if (opt && opt !== color && looksLikeSizeValue(opt)) {
        size = opt.toUpperCase() === opt.toLowerCase() ? opt : opt;
        // Normalize letter sizes to upper
        if (/^(XXXL|XXL|XL|XXS|XS|3XL|2XL|S|M|L)$/i.test(opt)) size = opt.toUpperCase();
        break;
      }
    }
  }

  // Verbleibende Optionen zuordnen
  if ((!size || !color) && unique.length > 0) {
    const rest = unique.filter((o) => {
      const opt = norm(o.option);
      return opt && opt !== size && opt !== color;
    });
    for (const o of rest) {
      const opt = norm(o.option);
      if (!opt) continue;
      if (!size && looksLikeSizeValue(opt)) {
        size = /^(XXXL|XXL|XL|XXS|XS|3XL|2XL|S|M|L)$/i.test(opt) ? opt.toUpperCase() : opt;
        continue;
      }
      if (!color) {
        color = opt;
        continue;
      }
      if (!size) {
        size = opt;
      }
    }
  }

  const fromName = parseSizeColorFromName(name);
  if (!size && fromName.size) size = fromName.size;
  if (!color && fromName.color) color = fromName.color;

  const optionsLabel =
    unique.length > 0
      ? unique.map((o) => (o.group ? `${o.group}: ${o.option}` : o.option)).join(" · ")
      : null;

  return { size, color, optionsLabel, baseName: fromName.baseName };
}

export function formatErpProductLabel(args: {
  productNumber: string;
  name?: string | null;
  size?: string | null;
  color?: string | null;
  optionsLabel?: string | null;
}): string {
  const parts: string[] = [];
  parts.push(norm(args.productNumber));
  if (args.name) parts.push(norm(args.name));
  if (args.size) parts.push(norm(args.size));
  if (args.color) parts.push(norm(args.color));
  if (!args.size && !args.color && args.optionsLabel) {
    parts.push(norm(args.optionsLabel));
  }
  return parts.filter(Boolean).join(" · ");
}

export function buildErpProductLabel(args: {
  productNumber: string;
  name?: string | null;
  /** Optional: Elternname für Varianten (bevorzugt als Anzeigename) */
  parentName?: string | null;
  options?: VariantOptionLike[] | null;
  properties?: PropertyLike[] | null;
  shopwareId?: string | null;
  active?: boolean | null;
  isParent?: boolean;
}): ErpProductLabel {
  const productNumber = norm(args.productNumber);
  const rawName = args.name ? norm(args.name) : null;
  const { size, color, optionsLabel, baseName } = extractSizeColor(
    args.options,
    args.properties,
    rawName,
  );
  const parentName = args.parentName ? norm(args.parentName) : null;
  // Anzeigename: Parent-Name > bereinigter Basisname > Rohname
  const name = parentName || baseName || rawName;

  return {
    productNumber,
    name,
    size,
    color,
    optionsLabel,
    shopwareId: args.shopwareId ?? null,
    active: args.active ?? null,
    isParent: args.isParent ?? false,
    label: formatErpProductLabel({ productNumber, name, size, color, optionsLabel }),
  };
}
