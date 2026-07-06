import type { Product, CrossSellCooccurrence, CrossSellEventPairStats } from "@shared/schema";
import type { IStorage } from "./storage";
import type { LearningSettings } from "./crossSellLearning";

/**
 * Fester Massstab fuer die absolute Co-Occurrence-Normalisierung.
 * directionalCoOccScore = confidence * log1p(lift); ~1.0 entspricht einem starken
 * Paar (z. B. confidence 0.5 & lift ~5). Werte darueber werden auf 1.0 gekappt.
 */
const CO_OCC_ABS_SCALE = 1.0;

export type HybridWeights = {
  wCoOcc: number;
  wEmbed: number;
  wSignal: number;
  wRule: number;
  signalAlpha: number;
  signalBeta: number;
};

export function hybridWeightsFromLearningSettings(s: LearningSettings): HybridWeights {
  return {
    wCoOcc: s.wCoOcc ?? 0.35,
    wEmbed: s.wEmbed ?? 0.25,
    wSignal: s.wSignal ?? 0.3,
    wRule: s.wRule ?? 0.1,
    signalAlpha: s.signalAlpha ?? 2,
    signalBeta: s.signalBeta ?? 20,
  };
}

/** Richtungsgebundener Key: Quell-Artikel -> Ziel-Artikel (wie in Analytics). */
export function crossSellEventLookupKey(sourcePn: string, targetPn: string): string {
  return `${sourcePn.trim().toLowerCase()}::${targetPn.trim().toLowerCase()}`;
}

export function buildCrossSellEventStatsMap(stats: CrossSellEventPairStats[]): Map<string, CrossSellEventPairStats> {
  const m = new Map<string, CrossSellEventPairStats>();
  for (const row of stats) {
    const a = row.sourceProductNumber.trim();
    const b = row.targetProductNumber.trim();
    m.set(crossSellEventLookupKey(a, b), row);
  }
  return m;
}

function directionalCoOccScore(
  sourcePn: string,
  targetPn: string,
  rows: CrossSellCooccurrence[],
): number {
  const s = sourcePn.trim();
  const t = targetPn.trim();
  let best = 0;
  for (const row of rows) {
    const a = row.productNumberA.trim();
    const b = row.productNumberB.trim();
    if (a === s && b === t) {
      best = Math.max(best, row.confidence * Math.log1p(Math.max(0, row.lift)));
    }
    if (b === s && a === t) {
      best = Math.max(best, row.confidence * Math.log1p(Math.max(0, row.lift)));
    }
  }
  return best;
}

function bayesianSignalScore(
  row: CrossSellEventPairStats | undefined,
  alpha: number,
  beta: number,
): number {
  if (!row) return 0;
  const imp = row.impressions || 0;
  const adds = row.adds || 0;
  const clicks = row.clicks || 0;
  const removes = row.removes || 0;
  const returns = row.returns || 0;
  const pos = adds + 0.35 * clicks;
  const neg = removes + returns;
  const rate = (pos + alpha) / (imp + alpha + beta);
  const negPenalty = neg / (imp + 8);
  return Math.max(0, Math.min(1, rate - negPenalty));
}

function cosineSimilarity(a: number[] | null, b: number[] | null): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, Math.min(1, sim));
}

/** RuleEngine-Gewicht 250 - index*5 auf 0..1 normiert. */
export function ruleBoostNormalized(ruleIndex: number): number {
  const w = Math.max(1, 250 - ruleIndex * 5);
  return Math.min(1, w / 250);
}

export type HybridRankedProduct = Product & {
  hybridScore: number;
  hybridComponents: { coOcc: number; embed: number; signal: number; rule: number };
};

/**
 * Hybrid-Score fuer Cross-Sell-Kandidaten (Co-Occurrence, Embedding, Funnel-Events, Regel-Rang).
 */
export async function rankCrossSellCandidatesHybrid(params: {
  storage: IStorage;
  tenantId: string | null;
  sourceProduct: Product;
  candidates: Product[];
  cooccurrences: CrossSellCooccurrence[];
  eventStatsMap: Map<string, CrossSellEventPairStats>;
  weights: HybridWeights;
  /** Maximaler Regel-Index pro Kandidaten-Produkt-ID (niedriger Index = hoehere Prioritaet). */
  ruleIndexByProductId?: Map<string, number>;
}): Promise<HybridRankedProduct[]> {
  const {
    storage,
    tenantId,
    sourceProduct,
    candidates,
    cooccurrences,
    eventStatsMap,
    weights,
    ruleIndexByProductId,
  } = params;

  const srcPn = sourceProduct.productNumber?.trim() || "";
  if (!srcPn) {
    return candidates.map((c) => ({
      ...c,
      hybridScore: 0,
      hybridComponents: { coOcc: 0, embed: 0, signal: 0, rule: 0 },
    }));
  }

  const sourceEmb = await storage.getSemanticDocumentEmbedding("product", sourceProduct.id, tenantId);

  const raw: Array<{
    product: Product;
    coOcc: number;
    embed: number;
    signal: number;
    rule: number;
  }> = [];

  for (const c of candidates) {
    const tgtPn = c.productNumber?.trim() || "";
    if (!tgtPn || c.id === sourceProduct.id) continue;

    const coOcc = directionalCoOccScore(srcPn, tgtPn, cooccurrences);
    const candEmb = await storage.getSemanticDocumentEmbedding("product", c.id, tenantId);
    const embed = cosineSimilarity(sourceEmb, candEmb);

    const evKey = crossSellEventLookupKey(srcPn, tgtPn);
    const ev = eventStatsMap.get(evKey);
    const signal = bayesianSignalScore(ev, weights.signalAlpha, weights.signalBeta);

    const ri = c.id ? ruleIndexByProductId?.get(c.id) : undefined;
    const rule = ri === undefined ? 0 : ruleBoostNormalized(ri);

    raw.push({ product: c, coOcc, embed, signal, rule });
  }

  // Absolute (nicht set-relative) Normalisierung der Co-Occurrence.
  // Vorher: coOcc / max(coOcc) -> der beste Kandidat bekam IMMER 1.0, auch wenn
  // die absolute Co-Occurrence winzig war (z. B. 2 zufaellige gemeinsame Kaeufe).
  // Bei duenner Historie wurde so "der Beste unter den Schwachen" kuenstlich
  // hochskaliert. Jetzt fester Massstab: ~1.0 entspricht einem starken Paar.
  const normalizedCo = raw.map((r) => Math.min(1, r.coOcc / CO_OCC_ABS_SCALE));

  // Fehlende Signalquellen (keine Embeddings, keine Bestellhistorie, keine Events)
  // duerfen ihr Gewicht nicht still "verschlucken". Wenn eine Quelle fuer ALLE
  // Kandidaten leer ist, wird ihr Gewicht 0 gesetzt und die verbleibenden aktiven
  // Gewichte werden re-normalisiert -> die vorhandenen Signale behalten volle Wirkung.
  const hasCoOcc = normalizedCo.some((v) => v > 0);
  const hasEmbed = raw.some((r) => r.embed > 0);
  const hasSignal = raw.some((r) => r.signal > 0);
  const hasRule = raw.some((r) => r.rule > 0);
  const wCo = hasCoOcc ? weights.wCoOcc : 0;
  const wEm = hasEmbed ? weights.wEmbed : 0;
  const wSi = hasSignal ? weights.wSignal : 0;
  const wRu = hasRule ? weights.wRule : 0;
  const wSum = wCo + wEm + wSi + wRu;

  const scored: HybridRankedProduct[] = raw.map((r, i) => {
    const nCo = normalizedCo[i];
    const rawScore = wCo * nCo + wEm * r.embed + wSi * r.signal + wRu * r.rule;
    const score = wSum > 0 ? rawScore / wSum : 0;
    return {
      ...r.product,
      hybridScore: score,
      hybridComponents: { coOcc: nCo, embed: r.embed, signal: r.signal, rule: r.rule },
    };
  });

  scored.sort((a, b) => {
    if (b.hybridScore !== a.hybridScore) return b.hybridScore - a.hybridScore;
    // Kein Lagerbestand-Tie-Break: Bestand ist kein Relevanzsignal fuers
    // Cross-Selling. Stabile, deterministische Reihenfolge ueber Artikelnummer.
    return (a.productNumber || "").localeCompare(b.productNumber || "");
  });

  return scored;
}
