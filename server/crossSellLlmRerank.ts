import { createHash } from "crypto";
import type { Product } from "@shared/schema";
import type { IStorage } from "./storage";
import type { HybridRankedProduct } from "./crossSellHybridRanker";
import { getOpenAIClientFromSettings } from "./openaiClient";

const CACHE_SETTING_KEY = "cross_sell_llm_rerank_cache";

type LlmRankingRow = { productNumber: string; reason: string };
type CacheBlob = { v: 1; entries: Record<string, { expiresAt: string; ranking: LlmRankingRow[] }> };

function envBool(name: string, defaultTrue: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return defaultTrue;
  return v === "1" || v === "true" || v === "yes";
}

function envInt(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function normalizeCacheBlob(raw: unknown): CacheBlob {
  if (raw && typeof raw === "object" && (raw as CacheBlob).v === 1 && (raw as CacheBlob).entries) {
    return raw as CacheBlob;
  }
  return { v: 1, entries: {} };
}

async function readCache(
  storage: IStorage,
  tenantId: string | null,
  cacheKey: string,
): Promise<LlmRankingRow[] | null> {
  const raw = await storage.getSetting(CACHE_SETTING_KEY, tenantId);
  const blob = normalizeCacheBlob(raw);
  if (!blob.entries?.[cacheKey]) return null;
  const exp = new Date(blob.entries[cacheKey].expiresAt).getTime();
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;
  return blob.entries[cacheKey].ranking || null;
}

async function writeCache(
  storage: IStorage,
  tenantId: string | null,
  cacheKey: string,
  ranking: LlmRankingRow[],
  ttlHours: number,
): Promise<void> {
  const blob = normalizeCacheBlob(await storage.getSetting(CACHE_SETTING_KEY, tenantId));
  const ttlMs = Math.max(1, ttlHours) * 3600 * 1000;
  const now = Date.now();
  const pruned: CacheBlob = { v: 1, entries: {} };
  for (const [k, v] of Object.entries(blob.entries || {})) {
    if (new Date(v.expiresAt).getTime() > now) {
      pruned.entries[k] = v;
    }
  }
  pruned.entries[cacheKey] = {
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    ranking,
  };
  const keys = Object.keys(pruned.entries);
  if (keys.length > 200) {
    keys.sort(
      (a, b) =>
        new Date(pruned.entries[b].expiresAt).getTime() - new Date(pruned.entries[a].expiresAt).getTime(),
    );
    for (const k of keys.slice(200)) {
      delete pruned.entries[k];
    }
  }
  await storage.saveSetting(CACHE_SETTING_KEY, pruned, tenantId);
}

function buildCacheKey(
  tenantId: string | null,
  sourcePn: string,
  candidates: HybridRankedProduct[],
): string {
  const payload = JSON.stringify({
    t: tenantId,
    src: sourcePn,
    ids: candidates.map((c) => c.id),
    hs: candidates.map((c) => c.hybridScore),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 48);
}

function summarizeProduct(p: Product): string {
  const dims = p.dimensions
    ? `${p.dimensions.width ?? "?"}x${p.dimensions.height ?? "?"}x${p.dimensions.length ?? "?"} ${p.dimensions.unit || "mm"}`
    : "";
  const props = (p.properties || [])
    .slice(0, 6)
    .map((x) => `${x.groupName}: ${x.optionName}`)
    .join("; ");
  return [
    `nr=${p.productNumber}`,
    `name=${p.name}`,
    dims && `abmessungen=${dims}`,
    props && `eigenschaften=${props}`,
    p.price != null && `preis_brutto=${p.price}`,
  ]
    .filter(Boolean)
    .join(" | ");
}

/**
 * GPT-4o Re-Rank fuer Top-K Cross-Sell-Kandidaten inkl. kurzer deutscher Begründung pro Ziel-Artikel.
 */
export async function llmRerankCrossSellCandidates(params: {
  storage: IStorage;
  tenantId: string | null;
  sourceProduct: Product;
  candidates: HybridRankedProduct[];
  topK: number;
  topN: number;
  ttlHours: number;
  useLlmFromSettings: boolean;
}): Promise<Array<HybridRankedProduct & { crossSellReason?: string }>> {
  const { storage, tenantId, sourceProduct, candidates, topK, topN, ttlHours, useLlmFromSettings } = params;

  const enabledEnv = envBool("CROSS_SELL_LLM_RERANK_ENABLED", true);
  if (!enabledEnv || !useLlmFromSettings || candidates.length === 0) {
    return candidates.slice(0, topN).map((c) => ({ ...c }));
  }

  const top = candidates.slice(0, Math.min(topK, envInt("CROSS_SELL_LLM_RERANK_TOPK", topK), candidates.length));
  const srcPn = sourceProduct.productNumber?.trim() || "";
  const cacheKey = buildCacheKey(tenantId, srcPn, top);
  const cached = await readCache(storage, tenantId, cacheKey);
  if (cached && cached.length > 0) {
    return applyLlmRanking(candidates, cached, topN);
  }

  const openai = await getOpenAIClientFromSettings(storage.getSetting.bind(storage));
  if (!openai) {
    return candidates.slice(0, topN).map((c) => ({ ...c }));
  }

  const system = `Du bist ein B2B-Commerce-Experte fuer technische Regale und Zubehoer.
Du bekommst ein QUELLPRODUKT und eine Liste KANDIDAT-PRODUKTE mit Vorab-Scores (Hybrid).
Sortiere die Kandidaten nach Cross-Selling-Qualitaet fuer die Quelle (passende Ergaenzung, gleiche Serie wo sinnvoll, keine inkompatiblen Serien).
Antworte NUR als JSON mit Schema:
{"ranking":[{"productNumber":"string","reason":"string max 200 Zeichen Deutsch"}]}
Die Liste ranking muss die besten zuerst enthalten (hoechstens ${topN} Eintraege).`;

  const userLines = [
    `QUELLE: ${summarizeProduct(sourceProduct)}`,
    `KANDIDATEN (JSON-Array mit hybridScore):`,
    JSON.stringify(
      top.map((c) => ({
        productNumber: c.productNumber,
        hybridScore: Number(c.hybridScore.toFixed(4)),
        summary: summarizeProduct(c),
      })),
      null,
      0,
    ),
  ];

  try {
    const completion = await openai.client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userLines.join("\n") },
      ],
    });
    const text = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(text) as { ranking?: LlmRankingRow[] };
    const ranking = Array.isArray(parsed.ranking) ? parsed.ranking : [];
    await writeCache(storage, tenantId, cacheKey, ranking, envInt("CROSS_SELL_LLM_RERANK_TTL_HOURS", ttlHours));
    return applyLlmRanking(candidates, ranking, topN);
  } catch (e: unknown) {
    console.warn("[CrossSellLLM] rerank failed, fallback hybrid:", e instanceof Error ? e.message : e);
    return candidates.slice(0, topN).map((c) => ({ ...c }));
  }
}

function applyLlmRanking(
  allHybridOrdered: HybridRankedProduct[],
  ranking: LlmRankingRow[],
  topN: number,
): Array<HybridRankedProduct & { crossSellReason?: string }> {
  const byPn = new Map<string, HybridRankedProduct>();
  for (const c of allHybridOrdered) {
    const pn = c.productNumber?.trim();
    if (pn) byPn.set(pn.toLowerCase(), c);
  }
  const out: Array<HybridRankedProduct & { crossSellReason?: string }> = [];
  const used = new Set<string>();
  for (const row of ranking) {
    const pn = row.productNumber?.trim().toLowerCase();
    if (!pn) continue;
    const c = byPn.get(pn);
    if (!c?.id || used.has(c.id)) continue;
    out.push({ ...c, crossSellReason: row.reason?.slice(0, 400) });
    used.add(c.id);
    if (out.length >= topN) return out;
  }
  for (const c of allHybridOrdered) {
    if (out.length >= topN) break;
    if (c.id && !used.has(c.id)) {
      out.push({ ...c });
      used.add(c.id);
    }
  }
  return out;
}
