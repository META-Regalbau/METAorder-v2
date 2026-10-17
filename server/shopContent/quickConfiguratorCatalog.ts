/**
 * Artikeltabelle für den Regal-Schnellkonfigurator im Shop (shopware/storefront-snippets/quick-configurator.js).
 *
 * Enthalten sind die Fachbodenregale META CLIP und META CLIP S3 als Grund-, Anbau-, Doppel-Grund- und
 * Doppel-Anbauregal, aktiv und im DE-Kanal sichtbar. Alle Merkmale kommen aus dem Artikelnamen
 * („SYSTEM | Fachbodenregal | Rolle | H x B x T mm | Fachlast … kg | … Ebenen | [Längsriegel |] Oberfläche“).
 * Namen mit unbekannten Teilen fallen heraus, damit der Konfigurator keine Sonderausführung als
 * Standardregal anbietet. Preise stehen nicht in der Tabelle, die holt das Skript in der Sitzung des Kunden.
 */
import { parseCatalogName } from "../cross-selling/crossSellNameRules";
import type { ShopApi } from "./shopProducts";

export const QUICK_CONFIG_SYSTEMS = ["META CLIP", "META CLIP S3"] as const;
export const QUICK_CONFIG_ROLES = ["Grundregal", "Anbauregal", "Doppel-Grundregal", "Doppel-Anbauregal"] as const;

/** [id, System, Rolle, Höhe, Breite, Tiefe, Fachlast, Ebenen (Index), Längsriegel 0/1, Oberfläche (Index)] */
export type QuickConfigRow = [string, number, number, number, number, number, number, number, 0 | 1, number];

export type QuickConfigCatalog = {
  v: 1;
  generatedAt: string;
  systems: string[];
  roles: string[];
  levels: string[];
  surfaces: string[];
  items: QuickConfigRow[];
};

export type QuickConfigSkip = { name: string; reason: string };

const LEVELS_RE = /^(\d+(?:\+\d+)?) Ebenen$/;
const KNOWN_SEGMENT = /^(\d[\d.,]*\s*x\s*\d[\d.,]*\s*x\s*\d[\d.,]*\s*mm|Fachlast \d[\d.,]*\s*kg|\d+(?:\+\d+)? Ebenen|Längsriegel)$/i;

export function buildQuickConfigCatalog(
  products: Array<{ id: string; name: string }>,
  generatedAt = new Date().toISOString(),
): { catalog: QuickConfigCatalog; skipped: QuickConfigSkip[] } {
  const levels: string[] = [];
  const surfaces: string[] = [];
  const index = (list: string[], value: string) => {
    const i = list.indexOf(value);
    if (i >= 0) return i;
    list.push(value);
    return list.length - 1;
  };
  const items: QuickConfigRow[] = [];
  const skipped: QuickConfigSkip[] = [];
  const seen = new Map<string, string>();

  for (const p of [...products].sort((a, b) => a.name.localeCompare(b.name, "de"))) {
    const parsed = parseCatalogName(p.name);
    const system = QUICK_CONFIG_SYSTEMS.indexOf(parsed?.system as (typeof QUICK_CONFIG_SYSTEMS)[number]);
    if (!parsed || system < 0 || parsed.type !== "Fachbodenregal") continue;
    const role = QUICK_CONFIG_ROLES.indexOf(parsed.segments[2] as (typeof QUICK_CONFIG_ROLES)[number]);
    if (role < 0) continue;
    const surface = parsed.segments[parsed.segments.length - 1];
    const extra = parsed.segments.slice(3, -1).filter((s) => !KNOWN_SEGMENT.test(s));
    const level = parsed.segments.map((s) => s.match(LEVELS_RE)?.[1]).find(Boolean);
    const [h, b, t] = parsed.dims;
    if (extra.length) skipped.push({ name: p.name, reason: `unbekannte Angabe: ${extra.join(", ")}` });
    else if (parsed.dims.length !== 3 || !h || !b || !t) skipped.push({ name: p.name, reason: "Maße fehlen" });
    else if (!parsed.loadKg) skipped.push({ name: p.name, reason: "Fachlast fehlt" });
    else if (!level) skipped.push({ name: p.name, reason: "Ebenen fehlen" });
    else if (!parsed.surface) skipped.push({ name: p.name, reason: "Oberfläche fehlt" });
    else {
      const lr = parsed.segments.includes("Längsriegel") ? 1 : 0;
      const key = [system, role, h, b, t, parsed.loadKg, level, lr, surface].join("|");
      if (seen.has(key)) {
        skipped.push({ name: p.name, reason: `doppelt (wie ${seen.get(key)})` });
        continue;
      }
      seen.set(key, p.id);
      items.push([p.id, system, role, h, b, t, parsed.loadKg, index(levels, level), lr, index(surfaces, surface)]);
    }
  }
  return {
    catalog: { v: 1, generatedAt, systems: [...QUICK_CONFIG_SYSTEMS], roles: [...QUICK_CONFIG_ROLES], levels, surfaces, items },
    skipped,
  };
}

/** Aktive, im Kanal sichtbare CLIP-/CLIP-S3-Fachbodenregale (nur Hauptartikel, im Shop gibt es keine Varianten). */
export async function loadQuickConfigProducts(api: ShopApi, salesChannelId: string): Promise<Array<{ id: string; name: string }>> {
  const result: Array<{ id: string; name: string }> = [];
  for (let page = 1; ; page++) {
    const res = await api("POST", "search/product", {
      page,
      limit: 500,
      filter: [
        { type: "prefix", field: "name", value: "META CLIP" },
        { type: "contains", field: "name", value: "| Fachbodenregal |" },
        { type: "equals", field: "active", value: true },
        { type: "equals", field: "parentId", value: null },
        { type: "equals", field: "visibilities.salesChannelId", value: salesChannelId },
      ],
      includes: { product: ["id", "name"] },
    });
    const data = (res?.data ?? []) as Array<{ id: string; name: string | null }>;
    for (const p of data) if (p.name) result.push({ id: p.id, name: p.name });
    if (data.length < 500) break;
  }
  return result;
}
