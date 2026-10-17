/**
 * Artikeltabelle für den Regal-Schnellkonfigurator im Shop (shopware/storefront-snippets/quick-configurator.js).
 *
 * Enthalten sind Grund- und Anbauregale (bei Fachbodenregalen auch Doppel-Grund-/Doppel-Anbauregale) dieser
 * Regalarten, aktiv und im DE-Kanal sichtbar:
 * - Fachbodenregal: META CLIP, META CLIP S3
 * - Büroregal: META CLIP COMPACT, META CLIP COMPACT S3 (Büro-Steckregal)
 * - Palettenregal und Großfachregal: META MULTIPAL
 * - Weitspannregal: META MINI-RACK
 * - Kragarmregal: META MULTISTRONG L und M
 * Alle Merkmale kommen aus dem Artikelnamen („SYSTEM | Art | Rolle | H x B x T mm | Fachlast … kg | … | Oberfläche“),
 * bei MULTIPAL zusätzlich die Stützenbreite aus der Eigenschaft „Stützentyp“ bzw. „Rahmentyp/Profiltyp“
 * („85/20“: erste Zahl = Breite in mm); sie bestimmt die Gesamtlänge der Regalzeile.
 * Namen mit unbekannten Teilen fallen heraus, damit der Konfigurator keine Sonderausführung als Standardregal
 * anbietet. Preise stehen nicht in der Tabelle, die holt das Skript in der Sitzung des Kunden.
 */
import { parseCatalogName } from "../cross-selling/crossSellNameRules";
import type { ShopApi } from "./shopProducts";

/** Regalart → System und Artikelart im Namen */
export const QUICK_CONFIG_KINDS: Array<{ key: string; systems: string[]; type: string }> = [
  { key: "fachboden", systems: ["META CLIP", "META CLIP S3"], type: "Fachbodenregal" },
  { key: "palette", systems: ["META MULTIPAL"], type: "Palettenregal" },
  { key: "weitspann", systems: ["META MINI-RACK"], type: "Weitspannregal" },
  { key: "kragarm", systems: ["META MULTISTRONG L", "META MULTISTRONG M"], type: "Kragarmregal" },
  { key: "grossfach", systems: ["META MULTIPAL"], type: "Großfachregal" },
  { key: "buero", systems: ["META CLIP COMPACT", "META CLIP COMPACT S3"], type: "Büro-Steckregal" },
];
export const QUICK_CONFIG_ROLES = ["Grundregal", "Anbauregal", "Doppel-Grundregal", "Doppel-Anbauregal"] as const;

/**
 * [id, Regalart, System, Rolle, Höhe, Breite, Tiefe, Last, Ebenen, Paletten je Feld (0 = keine Angabe),
 *  Oberfläche (-1 = keine), doppelseitig 0/1, Böden (-1 = keine Angabe), Ausstattung (-1 = keine),
 *  Stützenbreite in mm (0 = Regel des Systems)] –
 * Texte als Index in die Listen des Katalogs.
 */
export type QuickConfigRow = [string, number, number, number, number, number, number, number, number, number, number, 0 | 1, number, number, number];

/** Systeme, deren Gesamtlänge von der Stützenbreite des Artikels abhängt */
const POST_FROM_PROPERTY = new Set(["META MULTIPAL"]);
export const POST_PROPERTY_GROUPS = ["Stützentyp", "Rahmentyp/Profiltyp"];

/** „85/20“, „Profil 85/20“ → 85 */
export function postWidthFromProperty(value: string | null | undefined): number | null {
  const m = String(value ?? "").match(/(\d+)\s*\/\s*\d+/);
  return m ? Number(m[1]) : null;
}

export type QuickConfigCatalog = {
  v: 2;
  generatedAt: string;
  kinds: string[];
  systems: string[];
  roles: string[];
  levels: string[];
  surfaces: string[];
  boards: string[];
  features: string[];
  items: QuickConfigRow[];
};

export type QuickConfigSkip = { name: string; reason: string };

const DIM_RE = /^\d[\d.,]*\s*x\s*\d[\d.,]*\s*x\s*\d[\d.,]*\s*mm$/i;
const LOAD_RE = /^(?:Fachlast|Armlast) \d[\d.,]*\s*kg$/i;
const LEVELS_RE = /^(\d+(?:\+\d+)?) Ebenen$/;
const PALLETS_RE = /^(\d+) Paletten$/;
const SURFACE_RE = /^(verzinkt|RAL \d{4})$/;
const BOARDS: Record<string, string> = { Spanplattenböden: "Spanplatte", Stahlpaneelböden: "Stahlpaneel", Stahlpaneele: "Stahlpaneel" };
const SIDES = ["einseitig", "doppelseitig"];
const FEATURES = ["Längsriegel", "Endanschlag", "Mittelanschlag"];

function kindOf(system: string, type: string): number {
  return QUICK_CONFIG_KINDS.findIndex((k) => k.type === type && k.systems.includes(system));
}

export function buildQuickConfigCatalog(
  products: Array<{ id: string; name: string; post?: number | null }>,
  generatedAt = new Date().toISOString(),
): { catalog: QuickConfigCatalog; skipped: QuickConfigSkip[]; counts: Record<string, number> } {
  const lists = { systems: [] as string[], levels: [] as string[], surfaces: [] as string[], boards: [] as string[], features: [] as string[] };
  const index = (list: string[], value: string) => {
    const i = list.indexOf(value);
    if (i >= 0) return i;
    list.push(value);
    return list.length - 1;
  };
  const items: QuickConfigRow[] = [];
  const skipped: QuickConfigSkip[] = [];
  const counts: Record<string, number> = {};
  const seen = new Map<string, string>();

  for (const p of [...products].sort((a, b) => a.name.localeCompare(b.name, "de"))) {
    const parsed = parseCatalogName(p.name);
    if (!parsed) continue;
    const kind = kindOf(parsed.system, parsed.type);
    const role = QUICK_CONFIG_ROLES.indexOf(parsed.segments[2] as (typeof QUICK_CONFIG_ROLES)[number]);
    if (kind < 0 || role < 0) continue;

    let level: string | null = null;
    let pallets = 0;
    let surface: string | null = null;
    let board: string | null = null;
    let side = role >= 2 ? 1 : 0;
    let feature: string | null = null;
    const unknown: string[] = [];
    for (const seg of parsed.segments.slice(3)) {
      if (DIM_RE.test(seg) || LOAD_RE.test(seg)) continue;
      const lv = seg.match(LEVELS_RE);
      const pl = seg.match(PALLETS_RE);
      if (lv) level = lv[1];
      else if (pl) pallets = Number(pl[1]);
      else if (SURFACE_RE.test(seg)) surface = seg;
      else if (BOARDS[seg]) board = BOARDS[seg];
      else if (SIDES.includes(seg)) side = seg === "doppelseitig" ? 1 : 0;
      else if (FEATURES.includes(seg)) feature = seg;
      else unknown.push(seg);
    }
    const [h, b, t] = parsed.dims;
    const kindKey = QUICK_CONFIG_KINDS[kind].key;
    if (unknown.length) skipped.push({ name: p.name, reason: `unbekannte Angabe: ${unknown.join(", ")}` });
    else if (parsed.dims.length !== 3 || !h || !b || !t) skipped.push({ name: p.name, reason: "Maße fehlen" });
    else if (!parsed.loadKg) skipped.push({ name: p.name, reason: "Fachlast fehlt" });
    else if (!level) skipped.push({ name: p.name, reason: "Ebenen fehlen" });
    else if (kindKey === "palette" && !pallets) skipped.push({ name: p.name, reason: "Palettenzahl fehlt" });
    else if (POST_FROM_PROPERTY.has(parsed.system) && !p.post) skipped.push({ name: p.name, reason: "Stützentyp fehlt" });
    else {
      const key = [kind, parsed.system, role, h, b, t, parsed.loadKg, level, pallets, surface, side, board, feature].join("|");
      if (seen.has(key)) {
        skipped.push({ name: p.name, reason: `doppelt (wie ${seen.get(key)})` });
        continue;
      }
      seen.set(key, p.id);
      counts[kindKey] = (counts[kindKey] ?? 0) + 1;
      items.push([
        p.id,
        kind,
        index(lists.systems, parsed.system),
        role,
        h,
        b,
        t,
        parsed.loadKg,
        index(lists.levels, level),
        pallets,
        surface ? index(lists.surfaces, surface) : -1,
        side as 0 | 1,
        board ? index(lists.boards, board) : -1,
        feature ? index(lists.features, feature) : -1,
        POST_FROM_PROPERTY.has(parsed.system) ? (p.post as number) : 0,
      ]);
    }
  }
  return {
    catalog: {
      v: 2,
      generatedAt,
      kinds: QUICK_CONFIG_KINDS.map((k) => k.key),
      roles: [...QUICK_CONFIG_ROLES],
      ...lists,
      items,
    },
    skipped,
    counts,
  };
}

/** Auswahlwerte je Regalart für das kleine Formular auf der Startseite (ohne die ganze Tabelle zu laden). */
export function quickConfigSummary(catalog: QuickConfigCatalog): Record<string, { h: number[]; b: number[]; t: number[]; load: number[] }> {
  const result: Record<string, { h: number[]; b: number[]; t: number[]; load: number[] }> = {};
  const add = (list: number[], v: number) => {
    if (!list.includes(v)) list.push(v);
  };
  for (const r of catalog.items) {
    const key = catalog.kinds[r[1]];
    const s = (result[key] ??= { h: [], b: [], t: [], load: [] });
    add(s.h, r[4]);
    add(s.b, r[5]);
    add(s.t, r[6]);
    add(s.load, r[7]);
  }
  for (const s of Object.values(result)) for (const list of Object.values(s)) list.sort((a, b) => a - b);
  return result;
}

/**
 * Aktive, im Kanal sichtbare Regale der Regalarten oben (nur Hauptartikel, im Shop gibt es keine Varianten),
 * bei MULTIPAL mit Stützenbreite aus den Eigenschaften.
 */
export async function loadQuickConfigProducts(
  api: ShopApi,
  salesChannelId: string,
): Promise<Array<{ id: string; name: string; post: number | null }>> {
  const types = [...new Set(QUICK_CONFIG_KINDS.map((k) => k.type))];
  const result: Array<{ id: string; name: string; post: number | null }> = [];
  for (let page = 1; ; page++) {
    const res = await api("POST", "search/product", {
      page,
      limit: 500,
      filter: [
        { type: "prefix", field: "name", value: "META " },
        { type: "multi", operator: "or", queries: types.map((t) => ({ type: "contains", field: "name", value: `| ${t} |` })) },
        { type: "equals", field: "active", value: true },
        { type: "equals", field: "parentId", value: null },
        { type: "equals", field: "visibilities.salesChannelId", value: salesChannelId },
      ],
      includes: { product: ["id", "name"] },
    });
    const data = (res?.data ?? []) as Array<{ id: string; name: string | null }>;
    for (const p of data) if (p.name) result.push({ id: p.id, name: p.name, post: null });
    if (data.length < 500) break;
  }
  const byId = new Map(result.map((p) => [p.id, p]));
  const ids = result.filter((p) => [...POST_FROM_PROPERTY].some((s) => p.name.startsWith(`${s} |`))).map((p) => p.id);
  for (let i = 0; i < ids.length; i += 200) {
    const res = await api("POST", "search/product", {
      ids: ids.slice(i, i + 200),
      limit: 200,
      associations: { properties: { associations: { group: {} }, filter: [{ type: "equalsAny", field: "group.name", value: POST_PROPERTY_GROUPS }] } },
      includes: { product: ["id", "properties"], property_group_option: ["name", "group"], property_group: ["name"] },
    });
    for (const p of (res?.data ?? []) as Array<{ id: string; properties?: Array<{ name: string; group?: { name: string } }> }>) {
      const opt = (p.properties ?? []).find((o) => POST_PROPERTY_GROUPS.includes(o.group?.name ?? ""));
      const target = byId.get(p.id);
      if (target) target.post = postWidthFromProperty(opt?.name);
    }
  }
  return result;
}
