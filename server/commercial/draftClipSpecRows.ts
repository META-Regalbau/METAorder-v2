/**
 * CLIP-Positionen ohne Artikelnummer aus Kurzbezeichnung + Maßen zuordnen (Live 13.10.2026: BHTronik).
 *
 * Händler schicken Stücklisten als Tabelle, z. B.
 *   „Meta Steckregal CLIP S3 230 LR AR (Anbaufeld (AR))“  H:2500mm B:1300mm T:600mm Böden:5
 *   „Meta CLIP 200 Zusatzboden“                            B:1700mm T:500mm
 * Die Kürzel sind immer dieselben: AR/GR = Anbau-/Grundregal, 150/200/230/330 = Fachlast in kg,
 * S3 = S3-Rahmen, LR = Längsriegel. Die Maße stehen bei der strukturierten Extraktion in
 * attributes.dimensions_raw, nicht in der Bezeichnung. Ohne sie fand weder der Katalogabgleich noch
 * die KI etwas. Hier wird ohne KI der passende Katalogartikel gewählt: Art, Höhe, Breite, Tiefe und
 * (falls genannt) Fachlast hart; S3, Längsriegel, Ebenen, Farbe weich. Abweichungen stehen als Hinweis
 * dran, alles bleibt Vorschlag (wie bei den Konfigurator-Zeilen).
 */
import type { Product } from "@shared/schema";
import type { LineItemMatch, MatchingResult, ProductMatch } from "../products/productMatcher";
import { CONFIGURATOR_APPROX_CONFIDENCE, CONFIGURATOR_EXACT_CONFIDENCE, parseClipConfiguratorRow } from "./draftConfiguratorRows";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/draftClipSpecRows" });

type Line = { extractedProductName: string; extractedPositionNumber?: string; quantity: number };

export type ClipKind = "Grundregal" | "Anbauregal" | "Zusatz-Fachboden";
export type ClipLineSpec = {
  kind: ClipKind;
  height: number | null;
  width: number | null;
  depth: number | null;
  load: number | null;
  /** „Böden“/„Ebenen“ der Zeile (bei Regalen inkl. Abdeckboden) */
  levels: number | null;
  s3: boolean | null;
  laengsriegel: boolean | null;
  color: "verzinkt" | "RAL 7035" | null;
};

const LOADS = new Set([150, 200, 230, 330]);
/** Maßzahl „1300“ oder „1.300“ */
const N = String.raw`(\d{1,2}\.\d{3}|\d{3,4})`;
const toMm = (v: string) => Number(v.replace(/\./g, ""));

function mm(text: string, re: RegExp): number | null {
  const n = Number(text.match(re)?.[1]?.replace(/\./g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Kurzbezeichnung + Maße einer CLIP-Position lesen; null, wenn Art oder Maße fehlen. */
export function parseClipLineSpec(text: string): ClipLineSpec | null {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!/\bCLIP\b/i.test(t) || /\bSPLIT\b/i.test(t)) return null;
  // Ganze Regalzeilen aus dem Konfigurator zerlegt draftConfiguratorRows
  if (parseClipConfiguratorRow(t)) return null;
  if (/doppel/i.test(t)) return null;

  const boden = /zusatz[-\s]?(fach)?boden/i.test(t);
  const grund = /\bGR\b/.test(t) || /grundregal|grundfeld/i.test(t);
  const anbau = /\bAR\b/.test(t) || /anbauregal|anbaufeld/i.test(t);
  let kind: ClipKind;
  if (boden) kind = "Zusatz-Fachboden";
  else if (grund && !anbau) kind = "Grundregal";
  else if (anbau && !grund) kind = "Anbauregal";
  else return null;

  let height = mm(t, /(?:\bH|H[öo]he)\s*[:=]?\s*(\d[\d.]{2,5})\s*(?:mm)?\b/i);
  let width = mm(t, /(?:\bB|Breite)\s*[:=]?\s*(\d[\d.]{2,5})\s*(?:mm)?\b/i);
  let depth = mm(t, /(?:\bT|Tiefe)\s*[:=]?\s*(\d[\d.]{2,5})\s*(?:mm)?\b/i);
  if (kind === "Zusatz-Fachboden") {
    const pair = t.match(new RegExp(`${N}\\s*[x×]\\s*${N}(?!\\s*[x×])\\s*mm`, "i"));
    if (pair && (width == null || depth == null)) {
      width ??= toMm(pair[1]);
      depth ??= toMm(pair[2]);
    }
    if (width == null || depth == null) return null;
  } else {
    const triple = t.match(new RegExp(`${N}\\s*[x×]\\s*${N}\\s*[x×]\\s*${N}\\s*mm`, "i"));
    if (triple && (height == null || width == null || depth == null)) {
      height ??= toMm(triple[1]);
      width ??= toMm(triple[2]);
      depth ??= toMm(triple[3]);
    }
    if (height == null || width == null || depth == null) return null;
  }

  const explicitLoad = mm(t, /(?:Fachlast|Tragkraft)\s*:?\s*(\d{3})\s*kg/i) ?? mm(t, /\b(\d{3})\s*kg\b/i);
  // Kürzel „CLIP 230“, „CLIP S3 200“ (keine Maße: nicht vor mm/x, nicht nach „:“)
  const shortLoad = [...t.matchAll(/(?<![\d.,:x×])\b(\d{3})\b(?!\s*(?:mm|[x×]|\d|[.,]\d))/gi)]
    .map((m) => Number(m[1]))
    .find((n) => LOADS.has(n));
  const load = explicitLoad != null && LOADS.has(explicitLoad) ? explicitLoad : shortLoad ?? null;

  const levelsMatch = t.match(/B[öo]den\s*:?\s*(\d{1,2})\b/i) ?? t.match(/(\d{1,2})\s*(\+\s*1)?\s*Ebenen/i) ?? t.match(/Ebenen\s*:?\s*(\d{1,2})\b/i);
  const levels = levelsMatch ? Number(levelsMatch[1]) + (levelsMatch[2] ? 1 : 0) : null;

  return {
    kind,
    height: kind === "Zusatz-Fachboden" ? null : height,
    width,
    depth,
    load,
    levels,
    s3: /\bS3\b/i.test(t) ? true : null,
    laengsriegel: /\bLR\b/.test(t) || /L[äa]ngsriegel/i.test(t) ? true : /diagonal/i.test(t) ? false : null,
    color: /RAL\s*7035|lichtgrau/i.test(t) ? "RAL 7035" : /verzinkt|\bvzk\b/i.test(t) ? "verzinkt" : null,
  };
}

type Entry = {
  product: Product;
  kind: ClipKind;
  s3: boolean;
  h: number | null;
  b: number;
  t: number;
  load: number | null;
  levels: number;
  color: string;
  laengsriegel: boolean;
  pack: boolean;
};

const SHELF_RE = /^META CLIP( S3)? \| Fachbodenregal \| (Grundregal|Anbauregal) \| (\d+) x (\d+) x (\d+) mm(.*)$/;
const BODEN_RE = /^META CLIP \| Zusatz-Fachboden \| (\d+) x (\d+) mm(.*)$/;

export function clipCatalog(products: Product[]): Entry[] {
  const out: Entry[] = [];
  for (const product of products) {
    const name = product.name || "";
    const shelf = name.match(SHELF_RE);
    if (shelf) {
      const rest = shelf[6];
      const ebenen = rest.match(/\|\s*(\d+)(\+1)?\s*Ebenen/);
      out.push({
        product,
        kind: shelf[2] as ClipKind,
        s3: Boolean(shelf[1]),
        h: Number(shelf[3]),
        b: Number(shelf[4]),
        t: Number(shelf[5]),
        load: Number(rest.match(/Fachlast\s+(\d+)\s*kg/)?.[1] ?? NaN) || null,
        levels: ebenen ? Number(ebenen[1]) + (ebenen[2] ? 1 : 0) : 0,
        color: /RAL 7035/.test(rest) ? "RAL 7035" : "verzinkt",
        laengsriegel: /L[äa]ngsriegel/.test(rest),
        pack: false,
      });
      continue;
    }
    const boden = name.match(BODEN_RE);
    if (boden) {
      const rest = boden[3];
      out.push({
        product,
        kind: "Zusatz-Fachboden",
        s3: false,
        h: null,
        b: Number(boden[1]),
        t: Number(boden[2]),
        load: Number(rest.match(/\|\s*(\d+)\s*kg/)?.[1] ?? NaN) || null,
        levels: 0,
        color: /RAL 7035/.test(rest) ? "RAL 7035" : "verzinkt",
        laengsriegel: false,
        pack: /\d+\s*Stück/.test(rest),
      });
    }
  }
  return out;
}

export type ClipSpecPick = { product: Product; exact: boolean; differences: string[]; alternatives: Product[] };

export function pickClipSpecProduct(catalog: Entry[], spec: ClipLineSpec): ClipSpecPick | null {
  let pool = catalog.filter(
    (c) => c.kind === spec.kind && c.b === spec.width && c.t === spec.depth && (spec.kind === "Zusatz-Fachboden" || c.h === spec.height),
  );
  if (spec.load != null) pool = pool.filter((c) => c.load === spec.load);
  if (!pool.length) return null;

  const shelf = spec.kind !== "Zusatz-Fachboden";
  const score = (c: Entry) =>
    (shelf ? (spec.s3 === true ? (c.s3 ? 3 : -3) : c.s3 ? -1 : 0) : 0) +
    (shelf ? (spec.laengsriegel === true ? (c.laengsriegel ? 2 : -2) : spec.laengsriegel === false ? (c.laengsriegel ? -2 : 0) : c.laengsriegel ? -2 : 0) : 0) +
    (shelf && spec.levels != null ? (c.levels === spec.levels ? 2 : -Math.abs(c.levels - spec.levels)) : 0) +
    (spec.color ? (c.color === spec.color ? 3 : -3) : c.color === "verzinkt" ? 1 : -1) +
    (c.pack ? -1 : 0);
  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  const best = ranked[0];

  const differences: string[] = [];
  if (shelf && spec.levels != null && best.levels !== spec.levels) {
    differences.push(`Anfrage ${spec.levels} Böden, Katalogartikel ${best.levels} Ebenen`);
  }
  if (shelf && spec.s3 === true && !best.s3) differences.push("S3-Rahmen angefragt, Katalogartikel ohne S3");
  if (shelf && spec.laengsriegel === true && !best.laengsriegel) differences.push("Längsriegel angefragt, Katalogartikel mit Diagonale");
  if (spec.color && best.color !== spec.color) differences.push(`Farbe ${spec.color} angefragt, Katalogartikel ${best.color}`);
  if (spec.load == null && new Set(pool.map((c) => c.load)).size > 1) {
    differences.push(`Fachlast nicht angegeben, ${best.load ?? "?"} kg gewählt`);
  }
  if (!shelf && spec.levels != null && spec.levels > 1) differences.push(`Zeile nennt „Böden: ${spec.levels}“, Menge prüfen`);
  return { product: best.product, exact: differences.length === 0, differences, alternatives: ranked.slice(1, 5).map((c) => c.product) };
}

// ── MULTIPAL: Palettenregale / Großfachregale nach Bezeichnung und Maßen ─────────────────────
// Live 14.10.2026 (THW Mannheim): „Grund-Palettenregal 4 Ebenen mit ca. 2000kg Fachlast | 3300x2700x800“
// ohne Artikelnummer. Den Grundrahmen gibt es nur unter dem alten Namen „META multipal GR 3300 x 2700 x
// 800 bis 1000 kg …“; die Alternativen-Suche schlug 1100 tief vor. Maße wie im Katalog: H x B x T.

export type MultipalFamily = "Palettenregal" | "Großfachregal";
export type MultipalLineSpec = {
  family: MultipalFamily;
  kind: "Grundregal" | "Anbauregal";
  height: number;
  width: number;
  depth: number;
  levels: number | null;
  load: number | null;
};

const TRIPLE = new RegExp(`${N}\\s*[x×]\\s*${N}\\s*[x×]\\s*${N}`, "i");

function rackKind(text: string): "Grundregal" | "Anbauregal" | null {
  const grund = /\bGR\b/.test(text) || /grund/i.test(text);
  const anbau = /\bAR\b/.test(text) || /anbau/i.test(text);
  return grund && !anbau ? "Grundregal" : anbau && !grund ? "Anbauregal" : null;
}

function rackFamily(text: string): MultipalFamily | null {
  if (/gro(ß|ss)fach/i.test(text)) return "Großfachregal";
  if (/palettenregal|multipal/i.test(text)) return "Palettenregal";
  return null;
}

export function parseMultipalLineSpec(text: string): MultipalLineSpec | null {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (/\bCLIP\b|doppel|kragarm|gefahrstoff/i.test(t)) return null;
  const family = rackFamily(t);
  const kind = rackKind(t);
  if (!family || !kind) return null;
  let height = mm(t, /(?:\bH|H[öo]he)\s*[:=]?\s*(\d[\d.]{2,5})\s*(?:mm)?\b/i);
  let width = mm(t, /(?:\bB|Breite)\s*[:=]?\s*(\d[\d.]{2,5})\s*(?:mm)?\b/i);
  let depth = mm(t, /(?:\bT|Tiefe)\s*[:=]?\s*(\d[\d.]{2,5})\s*(?:mm)?\b/i);
  const triple = t.match(TRIPLE);
  if (triple && (height == null || width == null || depth == null)) {
    height ??= toMm(triple[1]);
    width ??= toMm(triple[2]);
    depth ??= toMm(triple[3]);
  }
  if (height == null || width == null || depth == null) return null;
  const levels = t.match(/(\d{1,2})\s*(?:Lager)?ebenen/i);
  const load = t.match(/(\d[\d.]{2,5})\s*kg/i);
  return { family, kind, height, width, depth, levels: levels ? Number(levels[1]) : null, load: load ? toMm(load[1]) : null };
}

type MultipalEntry = { product: Product; family: MultipalFamily; kind: "Grundregal" | "Anbauregal"; h: number; b: number; t: number; levels: number | null; load: number | null; modern: boolean };

export function multipalCatalog(products: Product[]): MultipalEntry[] {
  const out: MultipalEntry[] = [];
  for (const product of products) {
    const name = product.name || "";
    if (!/multipal/i.test(name) || /2 Felder|doppel|gefahrstoff|kragarm|\bKTC\b/i.test(name)) continue;
    const family = /gro(ß|ss)fachregal/i.test(name)
      ? "Großfachregal"
      : /palettenregal/i.test(name) || /^(META |Mittelschweres |Schweres )?multipal (GR|AR) /i.test(name)
        ? "Palettenregal"
        : null;
    const kind = /Grundregal|\bGR\b/.test(name) ? "Grundregal" : /Anbauregal|\bAR\b/.test(name) ? "Anbauregal" : null;
    const dims = name.match(/(\d{3,4})\s*x\s*(\d{3,4})\s*x\s*(\d{3,4})/);
    if (!family || !kind || !dims) continue;
    const levels = name.match(/(\d{1,2})(\+1)?\s*(?:Lager)?[Ee]benen/);
    const load = name.match(/(?:Fachlast|bis|à)\s*(\d{3,4})\s*kg/i);
    out.push({
      product,
      family,
      kind,
      h: Number(dims[1]),
      b: Number(dims[2]),
      t: Number(dims[3]),
      levels: levels ? Number(levels[1]) + (levels[2] ? 1 : 0) : null,
      load: load ? Number(load[1]) : null,
      modern: /^META MULTIPAL \|/.test(name),
    });
  }
  return out;
}

export function pickMultipalProduct(catalog: MultipalEntry[], spec: MultipalLineSpec): ClipSpecPick | null {
  const pool = catalog.filter((c) => c.kind === spec.kind && c.h === spec.height && c.b === spec.width && c.t === spec.depth);
  if (!pool.length) return null;
  const loadClose = (c: MultipalEntry) => spec.load != null && c.load != null && Math.abs(c.load - spec.load) / spec.load <= 0.15;
  const score = (c: MultipalEntry) =>
    (c.family === spec.family ? 4 : -4) +
    (spec.levels != null && c.levels != null ? (c.levels === spec.levels ? 2 : -Math.abs(c.levels - spec.levels)) : 0) +
    (loadClose(c) ? 1 : 0) +
    (c.modern ? 0.5 : 0);
  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  const best = ranked[0];
  const differences: string[] = [];
  if (best.family !== spec.family) differences.push(`${spec.family} angefragt, Katalogartikel ${best.family}`);
  if (spec.levels != null && best.levels == null) differences.push(`Anfrage ${spec.levels} Ebenen, Katalogartikel ohne Ebenen-Angabe`);
  else if (spec.levels != null && best.levels !== spec.levels) differences.push(`Anfrage ${spec.levels} Ebenen, Katalogartikel ${best.levels} Ebenen`);
  if (spec.load != null && best.load != null && !loadClose(best)) {
    differences.push(`Fachlast angefragt ${spec.load} kg, Katalogartikel ${best.load} kg (je Fach oder je Palette prüfen)`);
  }
  return { product: best.product, exact: differences.length === 0, differences, alternatives: ranked.slice(1, 5).map((c) => c.product) };
}

function toMatch(product: Product, confidence: number, reasoning: string): ProductMatch {
  const net = (product as Product & { netPrice?: number }).netPrice;
  return { id: product.id, productNumber: product.productNumber, name: product.name, price: typeof net === "number" ? net : product.price, confidence, reasoning };
}

type ExtractionLine = { position?: number | null; description?: string | null; attributes?: { dimensions_raw?: string | null; color?: string | null } | null };

/** Maße/Farbe aus der strukturierten Extraktion zur Position (gleiche Position und Bezeichnung) */
function extractionAttributes(extractedData: Record<string, unknown>, line: Line, index: number, lineCount: number): string {
  const doc = extractedData.documentExtraction as { line_items?: ExtractionLine[] } | undefined;
  const items = doc?.line_items ?? [];
  const name = (line.extractedProductName || "").trim();
  const sameText = (it: ExtractionLine) => Boolean(it.description?.trim()) && name.startsWith(it.description!.trim());
  const byPosition = line.extractedPositionNumber
    ? items.find((it) => it.position != null && String(it.position) === line.extractedPositionNumber && sameText(it))
    : undefined;
  const found = byPosition ?? (items.length === lineCount && sameText(items[index]) ? items[index] : undefined);
  if (!found?.attributes) return "";
  const parts = [found.attributes.dimensions_raw, found.attributes.color].filter((p): p is string => Boolean(p?.trim()));
  return parts.filter((p) => !name.includes(p.trim())).join(" ");
}

/** Positionen ohne sicheren Treffer, die nicht schon von Hand, aus dem Angebot o. Ä. stammen */
function lineOpen(item: LineItemMatch & { bundle?: unknown; catalogMatchSkipped?: boolean }): boolean {
  if (item.bundle || item.catalogMatchSkipped) return false;
  if (item.status === "matched") return false;
  if (item.matchedProduct && ["configurator", "offer", "learned_customer", "clip_spec"].includes(item.matchStrategy ?? "")) return false;
  return true;
}

/** In place: matchingResults.items der passenden Positionen. Gibt die Anzahl zugeordneter Positionen zurück. */
export function resolveClipSpecRows(params: {
  extractedData: Record<string, unknown>;
  matchingResults: MatchingResult | null;
  products: Product[];
}): number {
  const { extractedData, matchingResults } = params;
  const lines = (extractedData.lineItems as Line[] | undefined) ?? [];
  if (!matchingResults?.items?.length || lines.length !== matchingResults.items.length) return 0;
  const catalog = clipCatalog(params.products);
  const racks = multipalCatalog(params.products);
  if (!catalog.length && !racks.length) return 0;

  let resolved = 0;
  lines.forEach((line, index) => {
    const current = matchingResults.items[index] as LineItemMatch & { productScreen?: unknown; aiMatch?: unknown };
    if (!lineOpen(current)) return;
    const text = `${line.extractedProductName} ${extractionAttributes(extractedData, line, index, lines.length)}`;
    const clip = parseClipLineSpec(text);
    const rack = clip ? null : parseMultipalLineSpec(text);
    const pick = clip ? pickClipSpecProduct(catalog, clip) : rack ? pickMultipalProduct(racks, rack) : null;
    if (!pick) return;
    const confidence = pick.exact ? CONFIGURATOR_EXACT_CONFIDENCE : CONFIGURATOR_APPROX_CONFIDENCE;
    const reason = pick.exact
      ? `Aus Bezeichnung und Maßen (${clip ? "Art, Maße, Fachlast, Ausführung" : "Art, Maße, Ebenen, Fachlast"} passen)`
      : `Aus Bezeichnung und Maßen; Abweichung: ${pick.differences.join("; ")}`;
    const next: LineItemMatch = {
      ...current,
      status: "uncertain",
      confidence,
      matchStrategy: "clip_spec",
      matchedProduct: toMatch(pick.product, confidence, reason),
      alternativeMatches: pick.alternatives.map((p) => toMatch(p, Math.max(40, confidence - 20), "Andere Ausführung")),
      configuratorNote: reason,
    };
    delete (next as { productScreen?: unknown }).productScreen;
    delete (next as { aiMatch?: unknown }).aiMatch;
    matchingResults.items[index] = next;
    resolved++;
  });
  if (resolved) {
    log.info({ event: "draft_clip_spec_rows", resolved, lines: lines.length }, `[ClipSpecRows] ${resolved} Regal-Position(en) aus Maßen zugeordnet`);
  }
  return resolved;
}

/** Pipeline/„Nochmal prüfen“: Katalog aus dem Produkt-Cache. */
export async function runDraftClipSpecRowsStep(params: {
  extractedData: Record<string, unknown>;
  matchingResults: MatchingResult | null;
}): Promise<number> {
  const lines = (params.extractedData.lineItems as Line[] | undefined) ?? [];
  if (!lines.some((l) => /\bCLIP\b|multipal|palettenregal|gro(ß|ss)fachregal/i.test(l.extractedProductName || ""))) return 0;
  try {
    const { productCache } = await import("../products/productCache");
    return resolveClipSpecRows({ ...params, products: productCache.getProducts() });
  } catch (err) {
    log.warn({ err }, "[ClipSpecRows] Schritt übersprungen");
    return 0;
  }
}
