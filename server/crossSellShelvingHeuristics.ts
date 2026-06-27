import type { Product } from "@shared/schema";
import { CROSS_SELL_CATEGORIES } from "@shared/schema";

export const CROSS_SELL_SHELVING_SETTING_KEY = "cross_sell_shelving_category_patterns";

export type CrossSellShelvingQuotas = {
  totalCap: number;
  /** Max. Böden in der ersten Phase */
  reservedBoeden: number;
  reservedDiagonal: number;
  reservedKleinteile: number;
  reservedZubehoer: number;
};

export type CrossSellShelvingPatternConfig = {
  sourceShelf: string[];
  /** Quelle gilt als „Doppel“ wenn eine Kategorie einen dieser Substrings enthält */
  sourceDoppelHints: string[];
  /** Quelle gilt als „Einfach“ wenn eine Kategorie einen dieser Substrings enthält */
  sourceEinfachHints: string[];
  targetShelfBoard: string[];
  targetAccessory: string[];
  /** Zubehör mit Breite+Tiefe statt nur Tiefe (Substring in Kategorie oder Produktname) */
  targetAccessoryWidthDepthPatterns: string[];
  targetDiagonal: string[];
  targetSmallPartsEinfach: string[];
  targetSmallPartsDoppel: string[];
  /** Absolute Toleranz Maße (mm) */
  dimensionToleranceMm: number;
  /** Relativ-Toleranz (z. B. 0.01 = 1 %) */
  dimensionRelativeTolerance: number;
  quotas: CrossSellShelvingQuotas;
};

export const DEFAULT_CROSS_SELL_SHELVING_PATTERN_CONFIG: CrossSellShelvingPatternConfig = {
  sourceShelf: ["regal", "steckrahmen", "steck", "ständer", "steher", "rahmen", "fachbodenregal"],
  sourceDoppelHints: ["doppelregal", "doppel"],
  sourceEinfachHints: ["einfachregal", "einfach"],
  targetShelfBoard: ["fachboden", "einlegeboden", "boden", "regalboden"],
  targetAccessory: ["zubehör", "zubehor", "verbinder", "halter", "anker", "schraube", "abdeck"],
  targetAccessoryWidthDepthPatterns: ["verbinder", "winkel", "traverse", "konsole"],
  targetDiagonal: ["diagonal", "verstrebung", "versteifung"],
  targetSmallPartsEinfach: ["fuß", "fuss", "kappe", "gleiter", "bodenträger"],
  targetSmallPartsDoppel: ["fuß", "fuss", "kappe", "gleiter", "bodenträger"],
  dimensionToleranceMm: 5,
  dimensionRelativeTolerance: 0.01,
  quotas: {
    totalCap: 10,
    reservedBoeden: 2,
    reservedDiagonal: 2,
    reservedKleinteile: 2,
    reservedZubehoer: 3,
  },
};

function deepMergeShelving(
  base: CrossSellShelvingPatternConfig,
  patch: Partial<CrossSellShelvingPatternConfig>,
): CrossSellShelvingPatternConfig {
  return {
    ...base,
    ...patch,
    quotas: { ...base.quotas, ...patch.quotas },
    sourceShelf: patch.sourceShelf ?? base.sourceShelf,
    sourceDoppelHints: patch.sourceDoppelHints ?? base.sourceDoppelHints,
    sourceEinfachHints: patch.sourceEinfachHints ?? base.sourceEinfachHints,
    targetShelfBoard: patch.targetShelfBoard ?? base.targetShelfBoard,
    targetAccessory: patch.targetAccessory ?? base.targetAccessory,
    targetAccessoryWidthDepthPatterns:
      patch.targetAccessoryWidthDepthPatterns ?? base.targetAccessoryWidthDepthPatterns,
    targetDiagonal: patch.targetDiagonal ?? base.targetDiagonal,
    targetSmallPartsEinfach: patch.targetSmallPartsEinfach ?? base.targetSmallPartsEinfach,
    targetSmallPartsDoppel: patch.targetSmallPartsDoppel ?? base.targetSmallPartsDoppel,
  };
}

export function mergeCrossSellShelvingPatternConfig(stored: unknown): CrossSellShelvingPatternConfig {
  if (!stored || typeof stored !== "object") {
    return { ...DEFAULT_CROSS_SELL_SHELVING_PATTERN_CONFIG };
  }
  return deepMergeShelving(
    { ...DEFAULT_CROSS_SELL_SHELVING_PATTERN_CONFIG },
    stored as Partial<CrossSellShelvingPatternConfig>,
  );
}

export async function loadCrossSellShelvingPatternConfig(
  getSetting: (key: string, tenantId?: string | null) => Promise<unknown>,
  tenantId: string | null,
): Promise<CrossSellShelvingPatternConfig> {
  const raw = await getSetting(CROSS_SELL_SHELVING_SETTING_KEY, tenantId);
  return mergeCrossSellShelvingPatternConfig(raw);
}

/** Wie shopware.parseDimensionsFromProductName: length = Tiefe; Böden oft „Breite x Tiefe“. */
function parseDimensionsFromProductName(
  name?: string | null,
): { width?: number; height?: number; length?: number } {
  if (!name || typeof name !== "string") return {};
  const m = name.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  if (!m) return {};
  const a = parseInt(m[1]!, 10);
  const b = parseInt(m[2]!, 10);
  if (Number.isNaN(a) || Number.isNaN(b)) return {};
  const isStand = /steckrahmen|ständer|steher|rahmen/i.test(name);
  if (isStand) {
    return { height: a, length: b };
  }
  return { width: a, length: b };
}

export function normalizeFootprint(product: Product): {
  width?: number;
  depth?: number;
  height?: number;
} {
  const d = product.dimensions;
  const out: { width?: number; depth?: number; height?: number } = {};
  if (d?.width != null) out.width = d.width;
  if (d?.length != null) out.depth = d.length;
  if (d?.height != null) out.height = d.height;
  if (out.width != null && out.depth != null) {
    return out;
  }
  const parsed = parseDimensionsFromProductName(product.name);
  if (parsed.width != null && out.width == null) out.width = parsed.width;
  if (parsed.length != null && out.depth == null) out.depth = parsed.length;
  if (parsed.height != null && out.height == null) out.height = parsed.height;
  return out;
}

function categoryBlob(p: Product): string {
  const names = (p.categoryNames || []).map((c) => c.toLowerCase()).join(" ");
  return `${names} ${(p.name || "").toLowerCase()}`;
}

export function productMatchesAnyPattern(product: Product, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const blob = categoryBlob(product);
  return patterns.some((pat) => pat && blob.includes(pat.toLowerCase()));
}

function nearEqual(a: number, b: number, absTol: number, relTol: number): boolean {
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff <= absTol || diff / scale <= relTol;
}

export function sameWidthAndDepth(
  a: { width?: number; depth?: number },
  b: { width?: number; depth?: number },
  absTol: number,
  relTol: number,
): boolean {
  if (a.width == null || a.depth == null || b.width == null || b.depth == null) return false;
  return nearEqual(a.width, b.width, absTol, relTol) && nearEqual(a.depth, b.depth, absTol, relTol);
}

export function sameDepthOnly(
  a: { depth?: number },
  b: { depth?: number },
  absTol: number,
  relTol: number,
): boolean {
  if (a.depth == null || b.depth == null) return false;
  return nearEqual(a.depth, b.depth, absTol, relTol);
}

export function sameWidthOnly(
  a: { width?: number },
  b: { width?: number },
  absTol: number,
  relTol: number,
): boolean {
  if (a.width == null || b.width == null) return false;
  return nearEqual(a.width, b.width, absTol, relTol);
}

export type ShelvingSupplementHit = {
  product: Product;
  category: string;
  reason: string;
};

function sortByStockThenNumber(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const ds = (b.stock ?? 0) - (a.stock ?? 0);
    if (ds !== 0) return ds;
    return (a.productNumber || "").localeCompare(b.productNumber || "");
  });
}

function classifySourceRack(
  source: Product,
  cfg: CrossSellShelvingPatternConfig,
): "doppel" | "einfach" | "neutral" {
  const blob = categoryBlob(source);
  if (cfg.sourceDoppelHints.some((h) => h && blob.includes(h.toLowerCase()))) {
    return "doppel";
  }
  if (cfg.sourceEinfachHints.some((h) => h && blob.includes(h.toLowerCase()))) {
    return "einfach";
  }
  return "neutral";
}

/**
 * Heuristische Ergänzungen für Regale: Böden, Diagonalen, Kleinteile, Zubehör (Kategorien + Maße).
 */
export function findShelvingSupplements(
  source: Product,
  catalog: Product[],
  cfg: CrossSellShelvingPatternConfig,
): ShelvingSupplementHit[] {
  if (!source.productNumber) return [];
  if (!productMatchesAnyPattern(source, cfg.sourceShelf)) {
    return [];
  }

  const absTol = cfg.dimensionToleranceMm;
  const relTol = cfg.dimensionRelativeTolerance;
  const srcFp = normalizeFootprint(source);
  const rackKind = classifySourceRack(source, cfg);
  const hits: ShelvingSupplementHit[] = [];
  const seenPn = new Set<string>();

  const push = (p: Product, category: string, reason: string) => {
    const pn = p.productNumber?.trim();
    if (!pn || pn === source.productNumber || seenPn.has(pn)) return;
    seenPn.add(pn);
    hits.push({ product: p, category, reason });
  };

  const boeden: Product[] = [];
  const diagonals: Product[] = [];
  const kleinteile: Product[] = [];
  const zubehoer: Product[] = [];

  for (const cand of catalog) {
    if (!cand.productNumber || cand.id === source.id) continue;
    const candFp = normalizeFootprint(cand);
    const blob = categoryBlob(cand);

    if (productMatchesAnyPattern(cand, cfg.targetShelfBoard)) {
      if (sameWidthAndDepth(srcFp, candFp, absTol, relTol)) {
        boeden.push(cand);
      }
      continue;
    }

    if (productMatchesAnyPattern(cand, cfg.targetDiagonal)) {
      if (sameWidthOnly(srcFp, candFp, absTol, relTol)) {
        diagonals.push(cand);
      }
      continue;
    }

    const smallPartHit =
      productMatchesAnyPattern(cand, cfg.targetSmallPartsEinfach) ||
      productMatchesAnyPattern(cand, cfg.targetSmallPartsDoppel);
    if (smallPartHit) {
      if (!sameDepthOnly(srcFp, candFp, absTol, relTol)) {
        continue;
      }
      const candDoppel = blob.includes("doppel");
      let ok = false;
      if (rackKind === "doppel") {
        ok = candDoppel;
      } else if (rackKind === "einfach") {
        ok = !candDoppel;
      } else {
        ok = true;
      }
      if (ok) {
        kleinteile.push(cand);
      }
      continue;
    }

    if (productMatchesAnyPattern(cand, cfg.targetAccessory)) {
      const needWidthDepth = cfg.targetAccessoryWidthDepthPatterns.some(
        (pat) => pat && blob.includes(pat.toLowerCase()),
      );
      const dimOk = needWidthDepth
        ? sameWidthAndDepth(srcFp, candFp, absTol, relTol)
        : sameDepthOnly(srcFp, candFp, absTol, relTol);
      if (dimOk) {
        zubehoer.push(cand);
      }
    }
  }

  for (const p of sortByStockThenNumber(boeden).slice(0, 12)) {
    push(p, CROSS_SELL_CATEGORIES.BOARDS, "Boden: gleiche Breite und Tiefe wie Regal");
  }
  for (const p of sortByStockThenNumber(diagonals).slice(0, 12)) {
    push(p, CROSS_SELL_CATEGORIES.DIAGONAL, "Diagonalverstrebung: gleiche Breite wie Regal");
  }
  for (const p of sortByStockThenNumber(kleinteile).slice(0, 12)) {
    push(p, CROSS_SELL_CATEGORIES.SMALL_PARTS, "Kleinteil: Tiefe passend, Einfach/Doppel nach Quelle");
  }
  for (const p of sortByStockThenNumber(zubehoer).slice(0, 15)) {
    push(p, CROSS_SELL_CATEGORIES.ACCESSORIES, "Zubehör: Maßregel nach Kategorie");
  }

  return hits;
}

export type StagingCandidate = { product: Product; category: string };

/**
 * Kombiniert regelbasierte Treffer mit Heuristik: reservierte Slots für Böden/Diagonal/Kleinteile/Zubehör,
 * danach Regel-Treffer, dann Auffüllen aus Heuristik.
 */
export function mergeStagingCandidatesWithQuotas(
  ruleHits: StagingCandidate[],
  heuristicHits: ShelvingSupplementHit[],
  cfg: CrossSellShelvingPatternConfig,
): StagingCandidate[] {
  const q = cfg.quotas;
  const totalCap = Math.max(1, q.totalCap);
  const heur = heuristicHits.map((h) => ({ product: h.product, category: h.category }));

  const byCat = (cat: string) => heur.filter((x) => x.category === cat);

  const out: StagingCandidate[] = [];
  const seen = new Set<string>();

  const tryAdd = (c: StagingCandidate | undefined): boolean => {
    if (!c) return false;
    const pn = c.product.productNumber?.trim();
    if (!pn || seen.has(pn)) return false;
    if (out.length >= totalCap) return false;
    seen.add(pn);
    out.push(c);
    return true;
  };

  const takeUpTo = (list: StagingCandidate[], max: number) => {
    let n = 0;
    for (const c of list) {
      if (n >= max) break;
      if (tryAdd(c)) n += 1;
    }
  };

  takeUpTo(byCat(CROSS_SELL_CATEGORIES.BOARDS), q.reservedBoeden);
  takeUpTo(byCat(CROSS_SELL_CATEGORIES.DIAGONAL), q.reservedDiagonal);
  takeUpTo(byCat(CROSS_SELL_CATEGORIES.SMALL_PARTS), q.reservedKleinteile);
  takeUpTo(byCat(CROSS_SELL_CATEGORIES.ACCESSORIES), q.reservedZubehoer);

  for (const c of ruleHits) {
    tryAdd(c);
  }

  for (const c of heur) {
    tryAdd(c);
  }

  return out.slice(0, totalCap);
}
