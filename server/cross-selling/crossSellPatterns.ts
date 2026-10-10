// Muster-Lernen fuer das Cross-Selling (reine Funktionen): Was bei bestellten Produkten
// zusammen gekauft wird, wird auf aehnliche Produkte ohne eigene Bestellungen uebertragen.
// Beispiel: "CLIP Fachbodenregal Grundregal" wird mit "CLIP Zusatz-Fachboden" gleicher Breite
// und Tiefe gekauft -> jedes CLIP-Grundregal bekommt den Zusatzboden in seinen Massen.
import type { OrderBasketStats } from "./crossSellScoring";

export type ProductSignature = {
  productNumber: string;
  name: string;
  /** Regal-System + Produktart, z. B. "CLIP|fachbodenregal grundregal" */
  typeKey: string;
  width: number | null;
  depth: number | null;
  /** Namensbestandteile fuer die Feinauswahl (Fachlast, Oberflaeche) */
  tokens: Set<string>;
  active: boolean;
};

const DIM_TOLERANCE_MM = 5;

function parseMm(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** Produktart aus dem Namen: neues Schema "META CLIP | Art | Unterart | Masse …", sonst Woerter vor den Massen. */
export function productTypeFromName(name: string): string {
  const parts = name.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const type = [parts[1]];
    if (parts[2] && !/\d/.test(parts[2]) && parts[2].length <= 30) type.push(parts[2]);
    return type.join(" ").toLowerCase();
  }
  const words = name.trim().split(/\s+/);
  const out: string[] = [];
  for (const w of words) {
    if (/^\d+([.,/]\d+)*$/.test(w)) break;
    out.push(w);
    if (out.length >= 3) break;
  }
  return out.join(" ").toLowerCase();
}

export function productSignature(row: {
  productNumber: string;
  name: string | null;
  active: boolean | null;
  payload: unknown;
}): ProductSignature {
  const p = (row.payload ?? {}) as { properties?: Array<{ groupName?: string; optionName?: string }>; active?: boolean };
  const prop = (g: string) => p.properties?.find((x) => x.groupName === g)?.optionName;
  const name = (row.name ?? "").trim();
  const system = (prop("Regal-System") ?? "").trim().toUpperCase();
  return {
    productNumber: row.productNumber,
    name,
    typeKey: `${system}|${productTypeFromName(name)}`,
    width: parseMm(prop("Breite")),
    depth: parseMm(prop("Tiefe")),
    tokens: nameTokens(name),
    active: row.active !== false && p.active !== false,
  };
}

/**
 * Namensbestandteile fuer die Feinauswahl; Oberflaechen vereinheitlicht ("vzk" = "verzinkt",
 * "R7035" = "RAL 7035"), damit z. B. ein verzinktes Regal den verzinkten Boden bekommt.
 */
export function nameTokens(name: string): Set<string> {
  const out = new Set<string>();
  for (const raw of name.toLowerCase().split(/[\s|/,]+/)) {
    let t = raw.trim();
    if (t === "vzk") t = "verzinkt";
    else if (/^r\d{4}$/.test(t)) t = t.slice(1);
    else if (t === "ral") continue;
    if (t.length >= 2) out.add(t);
  }
  return out;
}

const near = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) <= DIM_TOLERANCE_MM;

export type CrossSellPattern = {
  key: string;
  sourceType: string;
  targetType: string;
  sameWidth: boolean;
  sameDepth: boolean;
  /** verschiedene Ausgangsprodukte mit echten gemeinsamen Bestellungen */
  sources: Set<string>;
  orders: number;
  /** bei Mustern ohne Massbezug: tatsaechlich gekaufte Ziele mit Haeufigkeit */
  targets: Map<string, number>;
};

/**
 * Muster aus den Warenkoerben: je gerichtetem Paar (Quelle, Ziel) mit mindestens
 * `minPairOrders` gemeinsamen Bestellungen. Paare innerhalb derselben Produktart zaehlen
 * nicht (Alternativen, z. B. Regal in anderer Groesse).
 */
export function buildCrossSellPatterns(
  basket: OrderBasketStats,
  signatures: Map<string, ProductSignature>,
  minPairOrders = 2,
): Map<string, CrossSellPattern> {
  const patterns = new Map<string, CrossSellPattern>();
  const add = (s: ProductSignature, t: ProductSignature, orders: number) => {
    if (s.typeKey === t.typeKey || s.typeKey.endsWith("|") || t.typeKey.endsWith("|")) return;
    const sameWidth = near(s.width, t.width);
    const sameDepth = near(s.depth, t.depth);
    const key = `${s.typeKey}>${t.typeKey}|w${sameWidth ? 1 : 0}d${sameDepth ? 1 : 0}`;
    let p = patterns.get(key);
    if (!p) {
      p = { key, sourceType: s.typeKey, targetType: t.typeKey, sameWidth, sameDepth, sources: new Set(), orders: 0, targets: new Map() };
      patterns.set(key, p);
    }
    p.sources.add(s.productNumber);
    p.orders += orders;
    p.targets.set(t.productNumber, (p.targets.get(t.productNumber) ?? 0) + orders);
  };
  for (const [key, entry] of basket.pairs) {
    if (entry.orders < minPairOrders) continue;
    const [a, b] = key.split("\u0000");
    const sa = signatures.get(a);
    const sb = signatures.get(b);
    if (!sa || !sb) continue;
    add(sa, sb, entry.orders);
    add(sb, sa, entry.orders);
  }
  return patterns;
}

export type PatternCandidate = {
  source: string;
  target: string;
  patternKey: string;
  patternSources: number;
  patternOrders: number;
};

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

/**
 * Muster auf alle aktiven Produkte anwenden. Mit Massbezug: Ziel gleicher Art mit passender
 * Breite/Tiefe (bei mehreren das mit den meisten gemeinsamen Namensbestandteilen, z. B.
 * Fachlast und Oberflaeche). Ohne Massbezug: die am haeufigsten gekauften Ziele des Musters.
 */
export function applyCrossSellPatterns(
  patterns: Map<string, CrossSellPattern>,
  signatures: Map<string, ProductSignature>,
  opts: { minSources: number; perPattern?: number; maxPerSource?: number },
): PatternCandidate[] {
  const perPattern = opts.perPattern ?? 1;
  const byType = new Map<string, ProductSignature[]>();
  for (const s of signatures.values()) {
    if (!s.active) continue;
    const list = byType.get(s.typeKey) ?? [];
    list.push(s);
    byType.set(s.typeKey, list);
  }
  const bySourceType = new Map<string, CrossSellPattern[]>();
  for (const p of patterns.values()) {
    if (p.sources.size < opts.minSources) continue;
    const list = bySourceType.get(p.sourceType) ?? [];
    list.push(p);
    bySourceType.set(p.sourceType, list);
  }

  const out: PatternCandidate[] = [];
  const perSource: PatternCandidate[] = [];
  for (const [sourceType, list] of bySourceType) {
    for (const source of byType.get(sourceType) ?? []) {
      for (const p of list) {
        let targets: string[];
        if (p.sameWidth || p.sameDepth) {
          targets = (byType.get(p.targetType) ?? [])
            .filter((t) => (!p.sameWidth || near(source.width, t.width)) && (!p.sameDepth || near(source.depth, t.depth)))
            .sort((x, y) => tokenOverlap(source.tokens, y.tokens) - tokenOverlap(source.tokens, x.tokens) || x.productNumber.localeCompare(y.productNumber))
            .slice(0, perPattern)
            .map((t) => t.productNumber);
        } else {
          // gekaufte Ziele; bei mehreren Varianten (z. B. Farbe) die mit passender Oberflaeche
          targets = Array.from(p.targets.entries())
            .filter(([pn]) => signatures.get(pn)?.active)
            .sort(
              (x, y) =>
                tokenOverlap(source.tokens, signatures.get(y[0])!.tokens) - tokenOverlap(source.tokens, signatures.get(x[0])!.tokens) ||
                y[1] - x[1],
            )
            .slice(0, perPattern)
            .map(([pn]) => pn);
        }
        for (const target of targets) {
          if (target === source.productNumber) continue;
          perSource.push({ source: source.productNumber, target, patternKey: p.key, patternSources: p.sources.size, patternOrders: p.orders });
        }
      }
      // je Quelle die am besten belegten Muster, jedes Ziel nur einmal
      const seen = new Set<string>();
      perSource
        .sort((a, b) => b.patternSources - a.patternSources || b.patternOrders - a.patternOrders)
        .filter((c) => (seen.has(c.target) ? false : (seen.add(c.target), true)))
        .slice(0, opts.maxPerSource ?? 8)
        .forEach((c) => out.push(c));
      perSource.length = 0;
    }
  }
  return out;
}
