/**
 * Konfigurator-Regalzeilen auflösen (Live 11.10.2026: Heinrich & Schleyer BE730041, WOCKEN BE26-31016).
 *
 * Händler übernehmen den Text unseres Shop-Konfigurators als eine Position mit Gesamtpreis:
 *   „META CLIP Steckregal - Einseitige Regalzeile, Beginn mit: Grundregal. … Fachbodentiefe: 500 mm …
 *    Rahmentyp: Rahmen offen S3 … Abschnitt 1: Anzahl Felder 5, Höhe 2.000 mm, Feldbreite 1.000 mm,
 *    Feldlast 600 kg, Anzahl Ebenen 4, Tragkraft Fachboden 150 kg. Zubehör: 12 x Unterlegplatte …“
 *   „META CLIP Steckregal 2000 x 5080 x 800mm (HxLxT). Anzahl Felder: 5 / Höhe: 2.000 mm / Feldbreite:
 *    1.000 mm / … Anzahl Ebenen: 3 / Tragkraft Fachboden: 230 kg / Tragkraft Abdeckboden …“
 * Der Text ist immer gleich aufgebaut: ohne KI in 1 Grundregal + (Felder − 1) Anbauregale zerlegen
 * und den passenden Katalogartikel wählen (Höhe, Breite, Tiefe, Fachlast hart; S3, Farbe,
 * Längsriegel, Ebenen weich). Abweichungen (z. B. 4 statt 5 Ebenen) stehen als Hinweis dran, alles
 * bleibt Vorschlag. Zubehör wird eigene Position (KI-Abgleich). Der Positionspreis wird wie bei der
 * Stückliste anteilig verteilt (bomSplit-Eintrag, draftBomSplit.distributeBomPrices).
 */
import type { Product } from "@shared/schema";
import type { LineItemMatch, MatchingResult, ProductMatch } from "../products/productMatcher";
import type { DraftBomSplitEntry } from "./draftBomSplit";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/draftConfiguratorRows" });

export const CONFIGURATOR_EXACT_CONFIDENCE = 89;
export const CONFIGURATOR_APPROX_CONFIDENCE = 75;

type Line = { extractedProductName: string; extractedProductNumber?: string; extractedPositionNumber?: string; quantity: number; extractedPrice?: number };

export type ClipSection = { fields: number; height: number; fieldWidth: number; levels: number | null; shelfLoad: number | null };
export type ClipRowSpec = {
  sections: ClipSection[];
  depth: number | null;
  /** Tiefe als Gesamttiefe angegeben → nächste Katalogtiefe darunter */
  depthIsOverall: boolean;
  startWith: "Grundregal" | "Anbauregal";
  topShelf: boolean;
  s3: boolean | null;
  laengsriegel: boolean;
  color: "verzinkt" | "RAL 7035";
  accessories: Array<{ quantity: number; description: string }>;
};

const num = (v: string | undefined) => (v ? Number(v.replace(/\./g, "").replace(",", ".")) : NaN);

function grab(text: string, re: RegExp): number | null {
  const m = text.match(re);
  const n = num(m?.[1]);
  return Number.isFinite(n) ? n : null;
}

/** Konfigurator-Text einer CLIP-Regalzeile lesen; null, wenn es keiner ist. */
export function parseClipConfiguratorRow(text: string): ClipRowSpec | null {
  const t = (text || "").replace(/\s+/g, " ");
  if (!/META\s+CLIP/i.test(t) || !/Anzahl\s+Felder/i.test(t) || !/Feldbreite/i.test(t)) return null;

  const [main, zubehoer = ""] = t.split(/\bZubeh[öo]r\s*:/i);
  const parts = main.split(/\bAbschnitt\s+\d+\s*:/i);
  const header = parts[0];
  const sectionTexts = parts.length > 1 ? parts.slice(1) : [main];
  const sections: ClipSection[] = [];
  for (const s of sectionTexts) {
    const fields = grab(s, /Anzahl\s+Felder\s*:?\s*(\d+)/i);
    const height = grab(s, /(?<![a-zäöü])H[öo]he\s*:?\s*([\d.]+)\s*mm/i);
    const fieldWidth = grab(s, /Feldbreite\s*:?\s*([\d.]+)\s*mm/i);
    if (!fields || !height || !fieldWidth) continue;
    sections.push({
      fields,
      height,
      fieldWidth,
      levels: grab(s, /Anzahl\s+Ebenen\s*:?\s*(\d+)/i),
      shelfLoad: grab(s, /Tragkraft\s+Fachboden\s*:?\s*(\d+)\s*kg/i),
    });
  }
  if (!sections.length) return null;

  let depth = grab(header, /Fachbodentiefe\s*:?\s*([\d.]+)\s*mm/i);
  let depthIsOverall = false;
  if (depth == null) {
    const hlt = t.match(/(\d[\d.]*)\s*x\s*(\d[\d.]*)\s*x\s*(\d[\d.]*)\s*mm\s*\(\s*H\s*x\s*L\s*x\s*T\s*\)/i);
    depth = hlt ? num(hlt[3]) : grab(header, /Gesamttiefe\s*:?\s*([\d.]+)\s*mm/i);
    depthIsOverall = !hlt;
  }

  const accessories = zubehoer
    .split(/;|(?=\b\d+\s*x\s+[A-ZÄÖÜ])/)
    .map((a) => a.trim().replace(/\.\s*Beschaffungsartikel.*$/i, "").replace(/[.;]\s*$/, ""))
    .map((a) => a.match(/^(\d+)\s*x\s+(.{3,})$/i))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ quantity: Number(m[1]), description: m[2].trim() }));

  return {
    sections,
    depth,
    depthIsOverall,
    startWith: /Beginn\s+mit\s*:?\s*Anbauregal/i.test(t) ? "Anbauregal" : "Grundregal",
    topShelf: /Abdeckboden/i.test(t),
    s3: /\bS3\b/.test(t) ? true : null,
    laengsriegel: /L[äa]ngsriegel/i.test(t),
    color: /RAL\s*7035|lichtgrau/i.test(t) ? "RAL 7035" : "verzinkt",
    accessories,
  };
}

type Catalog = { product: Product; type: string; s3: boolean; h: number; b: number; t: number; load: number | null; levels: number; topShelf: boolean; color: string; laengsriegel: boolean };

const CLIP_NAME_RE = /^META CLIP( S3)? \| Fachbodenregal \| (Grundregal|Anbauregal) \| (\d+) x (\d+) x (\d+) mm(.*)$/;

function catalogEntries(products: Product[]): Catalog[] {
  const out: Catalog[] = [];
  for (const product of products) {
    const m = (product.name || "").match(CLIP_NAME_RE);
    if (!m) continue;
    const rest = m[6];
    const ebenen = rest.match(/\|\s*(\d+)(\+1)?\s*Ebenen/);
    out.push({
      product,
      type: m[2],
      s3: Boolean(m[1]),
      h: Number(m[3]),
      b: Number(m[4]),
      t: Number(m[5]),
      load: Number(rest.match(/Fachlast\s+(\d+)\s*kg/)?.[1] ?? NaN) || null,
      levels: ebenen ? Number(ebenen[1]) + (ebenen[2] ? 1 : 0) : 0,
      topShelf: Boolean(ebenen?.[2]),
      color: /RAL 7035/.test(rest) ? "RAL 7035" : "verzinkt",
      laengsriegel: /L[äa]ngsriegel/.test(rest),
    });
  }
  return out;
}

export type ClipPick = { product: Product; exact: boolean; differences: string[]; alternatives: Product[] };

/** Bester Katalogartikel für Grund- oder Anbauregal eines Abschnitts. */
export function pickClipProduct(catalog: Catalog[], spec: ClipRowSpec, section: ClipSection, type: "Grundregal" | "Anbauregal"): ClipPick | null {
  let pool = catalog.filter((c) => c.type === type && c.h === section.height && c.b === section.fieldWidth);
  if (spec.depth != null) {
    const depths = [...new Set(pool.map((c) => c.t))];
    const wanted = spec.depthIsOverall
      ? depths.filter((d) => d <= spec.depth! && spec.depth! - d <= 60).sort((a, b) => b - a)[0]
      : spec.depth;
    pool = pool.filter((c) => c.t === wanted);
  }
  if (section.shelfLoad != null) pool = pool.filter((c) => c.load === section.shelfLoad);
  if (!pool.length) return null;

  const wantLevels = section.levels != null ? section.levels + (spec.topShelf ? 1 : 0) : null;
  const score = (c: Catalog) =>
    (spec.s3 === true ? (c.s3 ? 3 : -3) : c.s3 ? -1 : 0) +
    (c.color === spec.color ? 3 : -3) +
    (c.laengsriegel === spec.laengsriegel ? 2 : -2) +
    (wantLevels != null ? (c.levels === wantLevels ? 2 : -Math.abs(c.levels - wantLevels)) : 0);
  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  const best = ranked[0];
  const differences: string[] = [];
  if (wantLevels != null && best.levels !== wantLevels) {
    differences.push(`Konfiguration ${section.levels}${spec.topShelf ? "+1" : ""} Ebenen, Katalogartikel ${best.levels - (best.topShelf ? 1 : 0)}${best.topShelf ? "+1" : ""} Ebenen`);
  }
  if (spec.s3 === true && !best.s3) differences.push("Konfiguration S3-Rahmen, Katalogartikel ohne S3");
  if (best.color !== spec.color) differences.push(`Farbe ${spec.color} gewünscht, Katalogartikel ${best.color}`);
  if (best.laengsriegel !== spec.laengsriegel) differences.push(spec.laengsriegel ? "Längsriegel gewünscht, Katalogartikel mit Diagonale" : "Diagonale gewünscht, Katalogartikel mit Längsriegel");
  return { product: best.product, exact: differences.length === 0, differences, alternatives: ranked.slice(1, 5).map((c) => c.product) };
}

function toMatch(product: Product, confidence: number, reasoning: string): ProductMatch {
  const net = (product as Product & { netPrice?: number }).netPrice;
  return { id: product.id, productNumber: product.productNumber, name: product.name, price: typeof net === "number" ? net : product.price, confidence, reasoning };
}

export type ConfiguratorRowEntry = { originalPosition: number; summary: string; differences: string[] };

/**
 * Löst Konfigurator-Zeilen auf (in place: lineItems, matchingResults.items, bomSplit, configuratorRows).
 * Nur Positionen ohne sicheren Treffer; Zeilen, deren Regale nicht im Katalog stehen, bleiben stehen.
 */
export function resolveConfiguratorRows(params: {
  extractedData: Record<string, unknown>;
  matchingResults: MatchingResult | null;
  products: Product[];
}): ConfiguratorRowEntry[] {
  const { extractedData, matchingResults } = params;
  const lines = (extractedData.lineItems as Line[] | undefined) ?? [];
  if (!matchingResults?.items?.length || lines.length !== matchingResults.items.length) return [];
  const catalog = catalogEntries(params.products);
  if (!catalog.length) return [];

  type Component = { line: Line; item: LineItemMatch };
  const replacements = new Map<number, { components: Component[]; entry: ConfiguratorRowEntry; split: Omit<DraftBomSplitEntry, "componentIndices"> }>();

  lines.forEach((line, index) => {
    const current = matchingResults.items[index];
    if (current.status === "matched" && current.confidence >= 90) return;
    const spec = parseClipConfiguratorRow(line.extractedProductName);
    if (!spec) return;
    const factor = line.quantity > 0 ? line.quantity : 1;
    const pos = line.extractedPositionNumber ?? String(index + 1);
    const components: Component[] = [];
    const differences = new Set<string>();
    let failed = false;

    spec.sections.forEach((section, sIndex) => {
      const grund = sIndex === 0 && spec.startWith === "Grundregal" ? 1 : 0;
      for (const [type, count] of [["Grundregal", grund], ["Anbauregal", section.fields - grund]] as const) {
        if (count <= 0) continue;
        const pick = pickClipProduct(catalog, spec, section, type);
        if (!pick) {
          failed = true;
          return;
        }
        pick.differences.forEach((d) => differences.add(d));
        const confidence = pick.exact ? CONFIGURATOR_EXACT_CONFIDENCE : CONFIGURATOR_APPROX_CONFIDENCE;
        const description = `${type} ${section.height} x ${section.fieldWidth} x ${pick.product.name.match(/x (\d+) mm/)?.[1] ?? spec.depth ?? "?"} mm aus Konfigurator-Zeile`;
        const reason = pick.exact ? "Aus dem Konfigurator-Text (Maße, Fachlast, Ausführung passen)" : `Aus dem Konfigurator-Text; Abweichung: ${pick.differences.join("; ")}`;
        components.push({
          line: { extractedProductName: description, extractedPositionNumber: `${pos}.${components.length + 1}`, quantity: count * factor },
          item: {
            extractedProductName: description,
            extractedPositionNumber: `${pos}.${components.length + 1}`,
            quantity: count * factor,
            status: "uncertain",
            confidence,
            matchStrategy: "configurator",
            matchedProduct: toMatch(pick.product, confidence, reason),
            alternativeMatches: pick.alternatives.map((p) => toMatch(p, Math.max(40, confidence - 20), "Andere Ausführung")),
            configuratorNote: reason,
          } as LineItemMatch,
        });
      }
    });
    if (failed || !components.length) return;

    for (const acc of spec.accessories) {
      components.push({
        line: { extractedProductName: acc.description, extractedPositionNumber: `${pos}.${components.length + 1}`, quantity: acc.quantity * factor },
        item: { extractedProductName: acc.description, extractedPositionNumber: `${pos}.${components.length + 1}`, quantity: acc.quantity * factor, status: "not_found", confidence: 0 },
      });
    }

    const fields = spec.sections.reduce((s, x) => s + x.fields, 0);
    const summary = `CLIP-Regalzeile, ${fields} Felder: ${components.map((c) => `${c.line.quantity} × ${c.item.matchedProduct?.name ?? c.line.extractedProductName}`).join("; ")}`;
    replacements.set(index, {
      components,
      entry: { originalPosition: index + 1, summary, differences: [...differences] },
      split: {
        originalPosition: index + 1,
        originalLine: { ...line },
        componentCount: components.length,
        totalNet: typeof line.extractedPrice === "number" ? Math.round(line.extractedPrice * factor * 100) / 100 : null,
        priceDistributed: false,
        source: "configurator",
      } as Omit<DraftBomSplitEntry, "componentIndices">,
    });
  });
  if (!replacements.size) return [];

  const newLines: Line[] = [];
  const newItems: LineItemMatch[] = [];
  const splits: DraftBomSplitEntry[] = [...((extractedData.bomSplit as DraftBomSplitEntry[] | undefined) ?? [])];
  const entries: ConfiguratorRowEntry[] = [];
  lines.forEach((line, index) => {
    const rep = replacements.get(index);
    if (!rep) {
      newLines.push(line);
      newItems.push(matchingResults.items[index]);
      return;
    }
    const componentIndices: number[] = [];
    for (const c of rep.components) {
      componentIndices.push(newLines.length);
      newLines.push(c.line);
      newItems.push(c.item);
    }
    splits.push({ ...rep.split, componentIndices });
    entries.push(rep.entry);
  });

  extractedData.lineItems = newLines;
  extractedData.lineItemPlausibility = newLines.map((_, i) => ({ index: i, skipCatalogMatching: false, quantityWasZero: false }));
  matchingResults.items = newItems;
  extractedData.bomSplit = splits;
  extractedData.configuratorRows = entries;
  log.info(
    { event: "draft_configurator_rows", rows: entries.length, components: newLines.length - lines.length + entries.length },
    `[ConfiguratorRows] ${entries.length} Konfigurator-Zeile(n) aufgelöst`,
  );
  return entries;
}

/** Pipeline: vor der Stücklisten-KI, Katalog aus dem Produkt-Cache. */
export async function runDraftConfiguratorRowsStep(params: {
  extractedData: Record<string, unknown>;
  matchingResults: MatchingResult | null;
}): Promise<ConfiguratorRowEntry[]> {
  const lines = (params.extractedData.lineItems as Line[] | undefined) ?? [];
  if (!lines.some((l) => parseClipConfiguratorRow(l.extractedProductName))) return [];
  try {
    const { productCache } = await import("../products/productCache");
    return resolveConfiguratorRows({ ...params, products: productCache.getProducts() });
  } catch (err) {
    log.warn({ err }, "[ConfiguratorRows] Schritt übersprungen");
    return [];
  }
}
