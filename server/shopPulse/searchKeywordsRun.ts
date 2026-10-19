/**
 * Shop-Puls Stufe 3 (S3-1), Suchwörter mit Datenbank und Shopware (Entscheidung 19.10.2026):
 *
 * - Begriffe ohne Treffer kommen aus der GA4-Prüfung (offene Meldung ga4SearchNoHits, Belege terms) oder
 *   von Hand von der Seite. Je Begriff ein Eintrag mit den passenden Artikeln (searchKeywords.ts).
 * - Eindeutige Zuordnung → ohne vorherige Freigabe direkt am Produkt in Shopware eintragen: Feld
 *   customSearchKeywords (Sprache Deutsch), vorhandene Einträge bleiben, nichts wird überschrieben. Unklare
 *   Fälle bleiben Vorschläge; dort trägt man per Knopf ein.
 * - Jede Eintragung: vorher/nachher je Artikel in der Tabelle (Protokoll und Rückweg), Hinweis an Oliver
 *   (Teams-Direktnachricht und Glocke: Begriff → Artikel, Häufigkeit, Knopf „Rückgängig“), Eintrag im
 *   Maßnahmen-Protokoll. Rückgängig nimmt nur den Begriff wieder heraus.
 * - Der Shop wird nur unter der Sperre des Shop-Wächters abgefragt und beschrieben (nie parallel).
 */
import { and, desc, eq, isNull, type AnyColumn } from "drizzle-orm";
import { shopPulseSearchKeywords, shopwareProducts, type ShopPulseSearchKeywordRow } from "@shared/schema";
import {
  normalizeKeywordSettings,
  SHOP_PULSE_KEYWORD_AUTO_KINDS,
  SHOP_PULSE_KEYWORD_MATCH_KINDS,
  SHOP_PULSE_KEYWORD_SOURCES,
  SHOP_PULSE_KEYWORD_STATUSES,
  type ShopPulseKeywordApplied,
  type ShopPulseKeywordCandidate,
  type ShopPulseKeywordMatchKind,
  type ShopPulseKeywordSettings,
  type ShopPulseKeywordSource,
  type ShopPulseKeywordStatus,
  type ShopPulseSearchKeyword,
} from "@shared/shopPulseHandoff";
import type { ShopPulseSignal } from "@shared/shopPulse";
import type { IStorage } from "../storage";
import { db } from "../db";
import { logger } from "../lib/logger";
import { shopApi, type ShopApi } from "../shopContent/shopProducts";
import { ShopBusyError, withShopLock } from "../shopContent/shopWatch";
import { DE_CHANNEL_ID } from "./detectors/buyability";
import { loadProductRevenue } from "./buyabilityData";
import { cleanTerm, matchSearchTerm, mergeKeywords, prepareProducts, removeKeyword, termKey, type KeywordProduct } from "./searchKeywords";
import type { ActionCandidate } from "./actionLog";
import { sendToOliver, type ShopPulseOutboundDeps } from "./handoffRun";
import { SHOP_PULSE_PAGE_PATH } from "./shopPulseNotify";

const log = logger.child({ component: "shopPulse/searchKeywordsRun" });

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const oneOf = <T extends string>(list: readonly T[], v: string, fallback: T): T => ((list as readonly string[]).includes(v) ? (v as T) : fallback);

export const KEYWORD_SETTINGS_KEY = "shop_pulse_keyword_settings";
export const KEYWORD_STATE_KEY = "shop_pulse_keyword_state";
/** So viele Begriffe trägt ein Durchlauf höchstens automatisch ein (Schutz vor Massenänderungen) */
export const MAX_AUTO_PER_RUN = 5;
/** So viele neue Begriffe prüft ein Durchlauf höchstens */
const MAX_TERMS_PER_RUN = 50;
const REVENUE_DAYS = 365;

export function rowToKeyword(r: ShopPulseSearchKeywordRow): ShopPulseSearchKeyword {
  return {
    id: r.id,
    term: r.term,
    source: oneOf<ShopPulseKeywordSource>(SHOP_PULSE_KEYWORD_SOURCES, r.source, "manual"),
    searches: r.searches ?? 0,
    status: oneOf<ShopPulseKeywordStatus>(SHOP_PULSE_KEYWORD_STATUSES, r.status, "suggested"),
    matchKind: oneOf<ShopPulseKeywordMatchKind>(SHOP_PULSE_KEYWORD_MATCH_KINDS, r.matchKind, "none"),
    candidates: Array.isArray(r.candidates) ? (r.candidates as ShopPulseKeywordCandidate[]) : [],
    applied: Array.isArray(r.applied) ? (r.applied as ShopPulseKeywordApplied[]) : [],
    appliedAt: iso(r.appliedAt),
    appliedBy: r.appliedBy ?? null,
    revertedAt: iso(r.revertedAt),
    revertedBy: r.revertedBy ?? null,
    error: r.error ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listKeywords(tenantId: string | null): Promise<ShopPulseSearchKeyword[]> {
  const rows = await db.select().from(shopPulseSearchKeywords).where(tenantIs(shopPulseSearchKeywords.tenantId, tenantId)).orderBy(desc(shopPulseSearchKeywords.updatedAt)).limit(500);
  return rows.map(rowToKeyword);
}

export async function getKeyword(tenantId: string | null, id: string): Promise<ShopPulseSearchKeyword | undefined> {
  const rows = await db.select().from(shopPulseSearchKeywords).where(and(eq(shopPulseSearchKeywords.id, id), tenantIs(shopPulseSearchKeywords.tenantId, tenantId))).limit(1);
  return rows[0] ? rowToKeyword(rows[0]) : undefined;
}

async function keywordByTerm(tenantId: string | null, key: string): Promise<ShopPulseSearchKeyword | undefined> {
  const rows = await db.select().from(shopPulseSearchKeywords).where(and(eq(shopPulseSearchKeywords.termKey, key), tenantIs(shopPulseSearchKeywords.tenantId, tenantId))).limit(1);
  return rows[0] ? rowToKeyword(rows[0]) : undefined;
}

type KeywordPatch = Partial<Omit<ShopPulseSearchKeyword, "id" | "createdAt" | "updatedAt">>;

async function updateKeyword(tenantId: string | null, id: string, patch: KeywordPatch, now = new Date()): Promise<ShopPulseSearchKeyword | undefined> {
  const set: Partial<typeof shopPulseSearchKeywords.$inferInsert> = { updatedAt: now };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.matchKind !== undefined) set.matchKind = patch.matchKind;
  if (patch.candidates !== undefined) set.candidates = patch.candidates;
  if (patch.applied !== undefined) set.applied = patch.applied;
  if (patch.searches !== undefined) set.searches = patch.searches;
  if (patch.appliedAt !== undefined) set.appliedAt = patch.appliedAt ? new Date(patch.appliedAt) : null;
  if (patch.appliedBy !== undefined) set.appliedBy = patch.appliedBy;
  if (patch.revertedAt !== undefined) set.revertedAt = patch.revertedAt ? new Date(patch.revertedAt) : null;
  if (patch.revertedBy !== undefined) set.revertedBy = patch.revertedBy;
  if (patch.error !== undefined) set.error = patch.error;
  const rows = await db.update(shopPulseSearchKeywords).set(set).where(and(eq(shopPulseSearchKeywords.id, id), tenantIs(shopPulseSearchKeywords.tenantId, tenantId))).returning();
  return rows[0] ? rowToKeyword(rows[0]) : undefined;
}

async function insertKeyword(tenantId: string | null, k: { term: string; source: ShopPulseKeywordSource; searches: number; matchKind: ShopPulseKeywordMatchKind; candidates: ShopPulseKeywordCandidate[] }, now: Date): Promise<ShopPulseSearchKeyword> {
  const [row] = await db
    .insert(shopPulseSearchKeywords)
    .values({ tenantId, term: k.term, termKey: termKey(k.term), source: k.source, searches: k.searches, status: "suggested", matchKind: k.matchKind, candidates: k.candidates, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning();
  if (row) return rowToKeyword(row);
  const existing = await keywordByTerm(tenantId, termKey(k.term));
  if (!existing) throw new Error("Suchbegriff nicht gespeichert");
  return existing;
}

export async function getKeywordSettings(storage: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<ShopPulseKeywordSettings> {
  return normalizeKeywordSettings(await storage.getSetting(KEYWORD_SETTINGS_KEY, tenantId));
}

// ---------------------------------------------------------------------------------------------
// Quellen

/** Kaufbare, nicht technische Artikel des DE-Kanals aus dem Produktspiegel (mit EAN und Herstellernummer) */
export async function loadKeywordProducts(tenantId: string | null): Promise<KeywordProduct[]> {
  const rows = await db
    .select({ productNumber: shopwareProducts.productNumber, name: shopwareProducts.name, active: shopwareProducts.active, payload: shopwareProducts.payload })
    .from(shopwareProducts)
    .where(tenantIs(shopwareProducts.tenantId, tenantId));
  const out: KeywordProduct[] = [];
  for (const r of rows) {
    const p = (r.payload ?? {}) as Record<string, any>;
    const channels = Array.isArray(p.salesChannelIds) ? p.salesChannelIds.map(String) : [];
    if (r.active !== true || !channels.includes(DE_CHANNEL_ID) || !p.id) continue;
    if (p.customFields?.wdu_service_type || /^SW\d+$/i.test(r.productNumber)) continue;
    out.push({
      id: String(p.id),
      productNumber: r.productNumber,
      name: String(r.name ?? p.name ?? ""),
      ean: p.ean ? String(p.ean) : null,
      manufacturerNumber: p.manufacturerNumber ? String(p.manufacturerNumber) : null,
    });
  }
  return out;
}

/** Begriffe ohne Treffer aus der offenen GA4-Meldung (Belege terms: Begriff und Anzahl der Suchen) */
export function ga4TermsOf(signals: ShopPulseSignal[]): Array<{ term: string; count: number }> {
  const out = new Map<string, { term: string; count: number }>();
  for (const s of signals) {
    if (s.code !== "ga4SearchNoHits" || s.status !== "open") continue;
    for (const t of Array.isArray(s.evidence.terms) ? (s.evidence.terms as unknown[]) : []) {
      const term = typeof (t as any)?.term === "string" ? cleanTerm((t as any).term) : "";
      if (term.length < 3) continue;
      const count = Number((t as any)?.count) || 0;
      const prev = out.get(termKey(term));
      if (!prev || prev.count < count) out.set(termKey(term), { term, count });
    }
  }
  return Array.from(out.values()).sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------------------------
// Shopware: lesen und schreiben (Sprache Deutsch über shopApi)

export type KeywordShop = {
  /** eigener Wert (null = keiner) und wirksamer Wert (mit Vererbung bzw. Rückfallsprache) */
  read(productIds: string[]): Promise<Map<string, { own: string[] | null; effective: string[] | null; productNumber: string }>>;
  write(productId: string, keywords: string[] | null): Promise<void>;
};

export function keywordShop(api: ShopApi): KeywordShop {
  return {
    read: async (ids) => {
      const res = await api("POST", "search/product", { ids, limit: ids.length, includes: { product: ["id", "productNumber", "customSearchKeywords", "translated"] } });
      const out = new Map<string, { own: string[] | null; effective: string[] | null; productNumber: string }>();
      for (const p of res?.data ?? []) {
        const own = Array.isArray(p.customSearchKeywords) ? p.customSearchKeywords.map(String) : null;
        const eff = Array.isArray(p.translated?.customSearchKeywords) ? p.translated.customSearchKeywords.map(String) : own;
        out.set(String(p.id), { own, effective: eff, productNumber: String(p.productNumber) });
      }
      return out;
    },
    write: async (id, keywords) => {
      await api("PATCH", `product/${id}`, { customSearchKeywords: keywords });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Ablauf

export type KeywordDeps = ShopPulseOutboundDeps & {
  storage: ShopPulseOutboundDeps["storage"] & Pick<IStorage, "getShopwareSettings">;
  products: (tenantId: string | null) => Promise<KeywordProduct[]>;
  revenue: (tenantId: string | null, since: Date) => Promise<Map<string, number>>;
  /** Shop unter der Sperre des Shop-Wächters (ShopBusyError, wenn belegt) */
  withShop: <T>(tenantId: string | null, fn: (shop: KeywordShop) => Promise<T>) => Promise<T>;
  insertActions: (tenantId: string | null, candidates: ActionCandidate[]) => Promise<unknown>;
};

export function keywordDeps(storage: IStorage, out: Omit<ShopPulseOutboundDeps, "storage">, insertActions: KeywordDeps["insertActions"]): KeywordDeps {
  return {
    storage,
    ...out,
    products: loadKeywordProducts,
    revenue: loadProductRevenue,
    withShop: (tenantId, fn) =>
      withShopLock(tenantId, async () => {
        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) throw new Error("Shopware settings not configured");
        return fn(keywordShop(shopApi(settings).api));
      }),
    insertActions,
  };
}

export class KeywordError extends Error {
  constructor(readonly reason: "notFound" | "notCandidate" | "notApplied") {
    super(reason);
  }
}

/** Begriff prüfen (neu anlegen bzw. Zuordnung neu rechnen), ohne einzutragen */
export async function checkTerm(
  deps: Pick<KeywordDeps, "products" | "revenue">,
  tenantId: string | null,
  input: { term: string; source: ShopPulseKeywordSource; searches: number },
  now: Date,
  cache?: { products?: ReturnType<typeof prepareProducts>; revenue?: Map<string, number> },
): Promise<ShopPulseSearchKeyword> {
  const term = cleanTerm(input.term);
  const products = cache?.products ?? prepareProducts(await deps.products(tenantId));
  const revenue = cache?.revenue ?? (await deps.revenue(tenantId, new Date(now.getTime() - REVENUE_DAYS * 24 * 60 * 60 * 1000)));
  const match = matchSearchTerm(term, products, revenue);
  const existing = await keywordByTerm(tenantId, termKey(term));
  if (!existing) return insertKeyword(tenantId, { term, source: input.source, searches: input.searches, matchKind: match.kind, candidates: match.candidates }, now);
  // Eingetragene, zurückgenommene und verworfene Begriffe bleiben, wie sie sind; Vorschläge bekommen die neue Zuordnung
  if (existing.status !== "suggested" && existing.status !== "failed") return (await updateKeyword(tenantId, existing.id, { searches: Math.max(existing.searches, input.searches) }, now)) ?? existing;
  return (await updateKeyword(tenantId, existing.id, { matchKind: match.kind, candidates: match.candidates, searches: Math.max(existing.searches, input.searches) }, now)) ?? existing;
}

const productLine = (a: Pick<ShopPulseKeywordApplied, "productNumber" | "name">) => `${a.productNumber} (${a.name.length > 60 ? `${a.name.slice(0, 59)}…` : a.name})`;

/**
 * Begriff an den gewählten Artikeln eintragen (nur Artikel aus den Vorschlägen). Vorhandene Suchwörter
 * bleiben; steht der Begriff schon drin, wird an diesem Artikel nichts geschrieben.
 */
export async function applyKeyword(deps: KeywordDeps, tenantId: string | null, id: string, productNumbers: string[], by: string, now = new Date()): Promise<ShopPulseSearchKeyword> {
  const k = await getKeyword(tenantId, id);
  if (!k) throw new KeywordError("notFound");
  const chosen = k.candidates.filter((c) => productNumbers.includes(c.productNumber));
  if (!chosen.length || chosen.length !== new Set(productNumbers).size) throw new KeywordError("notCandidate");
  let applied: ShopPulseKeywordApplied[];
  try {
    applied = await deps.withShop(tenantId, async (shop) => {
      const current = await shop.read(chosen.map((c) => c.productId));
      const out: ShopPulseKeywordApplied[] = [];
      for (const c of chosen) {
        const cur = current.get(c.productId);
        if (!cur) throw new Error(`Artikel ${c.productNumber} nicht im Shop gefunden`);
        const after = mergeKeywords(cur.effective, k.term);
        if (!after) continue; // schon enthalten
        await shop.write(c.productId, after);
        out.push({ productId: c.productId, productNumber: c.productNumber, name: c.name, before: cur.own, after });
      }
      return out;
    });
  } catch (err) {
    // Shop-Wächter fragt den Shop gerade ab: nichts geschrieben, später erneut
    if (err instanceof ShopBusyError) throw err;
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
    await updateKeyword(tenantId, k.id, { status: "failed", error: message }, now);
    log.warn({ err, tenantId, term: k.term }, "Shop-Puls: Suchwort nicht eingetragen");
    throw err;
  }
  const merged = [...k.applied.filter((a) => !applied.some((b) => b.productId === a.productId)), ...applied];
  const saved = (await updateKeyword(tenantId, k.id, { status: "applied", applied: merged, appliedAt: now.toISOString(), appliedBy: by, error: null, revertedAt: null, revertedBy: null }, now))!;
  if (!applied.length) return saved;
  const lines = applied.map(productLine);
  const searches = k.searches ? `${k.searches}× gesucht ohne Treffer (GA4)` : "von Hand geprüft";
  await sendToOliver(
    deps,
    tenantId,
    {
      heading: `🔎 Suchwort eingetragen: „${k.term}“`,
      paragraphs: [`→ ${lines.join(", ")}`, `${searches}. Eingetragen von ${by} im Feld „Suchbegriffe“; vorhandene Suchbegriffe sind geblieben.`, "Passt das nicht, auf der Seite „Rückgängig“ drücken."],
      bell: { title: `Suchwort eingetragen: „${k.term}“`, message: lines.join(", ") },
      link: `${SHOP_PULSE_PAGE_PATH}?tab=keywords&keyword=${encodeURIComponent(k.id)}`,
      actions: [
        { title: "Rückgängig", query: `?tab=keywords&keyword=${encodeURIComponent(k.id)}&action=revert` },
        { title: "In METAorder öffnen", query: `?tab=keywords&keyword=${encodeURIComponent(k.id)}` },
      ],
    },
    now,
  );
  await deps.insertActions(tenantId, [
    {
      occurredAt: now.toISOString(),
      kind: "searchKeyword",
      title: `Suchwort „${k.term}“ eingetragen: ${applied.map((a) => a.productNumber).join(", ")}`.slice(0, 300),
      description: `Feld „Suchbegriffe“ (customSearchKeywords, Deutsch) ergänzt. ${searches}.\n${applied.map((a) => `${productLine(a)}: vorher ${a.before?.length ? a.before.join(", ") : "leer"}, nachher ${a.after.join(", ")}`).join("\n")}`,
      scope: { type: "products", values: applied.map((a) => a.productNumber) },
      source: "shopPulse",
      sourceKey: `keyword:${k.id}:${now.toISOString()}`,
      actor: by,
    },
  ]);
  log.info({ tenantId, term: k.term, products: applied.map((a) => a.productNumber), by }, "Shop-Puls: Suchwort eingetragen");
  return saved;
}

/** Begriff an allen eingetragenen Artikeln wieder herausnehmen (später ergänzte Suchwörter bleiben) */
export async function revertKeyword(deps: KeywordDeps, tenantId: string | null, id: string, by: string, now = new Date()): Promise<ShopPulseSearchKeyword> {
  const k = await getKeyword(tenantId, id);
  if (!k) throw new KeywordError("notFound");
  if (k.status !== "applied" || !k.applied.length) throw new KeywordError("notApplied");
  await deps.withShop(tenantId, async (shop) => {
    const current = await shop.read(k.applied.map((a) => a.productId));
    for (const a of k.applied) {
      const cur = current.get(a.productId);
      if (!cur) continue; // Artikel gelöscht: nichts zurückzunehmen
      const rest = removeKeyword(cur.own ?? cur.effective, k.term);
      // war vorher nichts eigenes eingetragen und ist jetzt nichts anderes dazugekommen: wieder leer (erbt)
      const value = a.before === null && rest.length === 0 ? null : rest;
      await shop.write(a.productId, value);
    }
  });
  const saved = (await updateKeyword(tenantId, k.id, { status: "reverted", revertedAt: now.toISOString(), revertedBy: by }, now))!;
  await deps.insertActions(tenantId, [
    {
      occurredAt: now.toISOString(),
      kind: "searchKeywordRevert",
      title: `Suchwort „${k.term}“ zurückgenommen: ${k.applied.map((a) => a.productNumber).join(", ")}`.slice(0, 300),
      description: `Begriff aus dem Feld „Suchbegriffe“ wieder entfernt (übrige Suchbegriffe unverändert).`,
      scope: { type: "products", values: k.applied.map((a) => a.productNumber) },
      source: "shopPulse",
      sourceKey: `keyword:${k.id}:revert:${now.toISOString()}`,
      actor: by,
    },
  ]);
  log.info({ tenantId, term: k.term, by }, "Shop-Puls: Suchwort zurückgenommen");
  return saved;
}

export async function dismissKeyword(tenantId: string | null, id: string, now = new Date()): Promise<ShopPulseSearchKeyword | undefined> {
  const k = await getKeyword(tenantId, id);
  if (!k) return undefined;
  if (k.status === "applied") throw new KeywordError("notApplied");
  return updateKeyword(tenantId, id, { status: "dismissed" }, now);
}

export type KeywordRunResult = { checked: number; applied: number; skipped: "disabled" | "silent" | "busy" | null };

/** Vorschlag, der automatisch eingetragen werden darf: aus GA4, eindeutig, genau ein Artikel, noch nicht versucht */
export const isAutoEligible = (k: ShopPulseSearchKeyword) =>
  k.source === "ga4" && k.status === "suggested" && SHOP_PULSE_KEYWORD_AUTO_KINDS.includes(k.matchKind) && k.candidates.length === 1;

/**
 * Automatischer Durchlauf (Shop-Puls-Takt): neue Begriffe aus der GA4-Meldung prüfen, danach eindeutige
 * Vorschläge eintragen (höchstens 5 je Durchlauf). allowApply false (Lernwoche, Shop-Puls aus): nur prüfen.
 * Ist der Shop belegt, bleibt der Rest für den nächsten Takt.
 */
export async function runKeywordSuggestions(deps: KeywordDeps, tenantId: string | null, signals: ShopPulseSignal[], now: Date, opts: { allowApply: boolean }): Promise<KeywordRunResult> {
  const terms = ga4TermsOf(signals);
  const existing = await listKeywords(tenantId);
  const known = new Set(existing.map((k) => termKey(k.term)));
  const fresh = terms.filter((t) => !known.has(termKey(t.term))).slice(0, MAX_TERMS_PER_RUN);
  const checked: ShopPulseSearchKeyword[] = [];
  if (fresh.length) {
    const products = prepareProducts(await deps.products(tenantId));
    const revenue = await deps.revenue(tenantId, new Date(now.getTime() - REVENUE_DAYS * 24 * 60 * 60 * 1000));
    for (const t of fresh) checked.push(await checkTerm(deps, tenantId, { term: t.term, source: "ga4", searches: t.count }, now, { products, revenue }));
    await deps.storage.saveSetting(KEYWORD_STATE_KEY, { lastRunAt: now.toISOString() }, tenantId);
  }
  const settings = await getKeywordSettings(deps.storage, tenantId);
  if (!settings.autoApply) return { checked: checked.length, applied: 0, skipped: "disabled" };
  if (!opts.allowApply) return { checked: checked.length, applied: 0, skipped: "silent" };
  const due = [...existing, ...checked.filter((c) => !existing.some((e) => e.id === c.id))].filter(isAutoEligible).sort((a, b) => b.searches - a.searches);
  let applied = 0;
  for (const k of due.slice(0, MAX_AUTO_PER_RUN)) {
    try {
      await applyKeyword(deps, tenantId, k.id, [k.candidates[0].productNumber], "Shop-Puls (automatisch)", now);
      applied++;
    } catch (err) {
      if (err instanceof ShopBusyError) return { checked: checked.length, applied, skipped: "busy" };
      log.warn({ err, tenantId, term: k.term }, "Shop-Puls: Suchwort automatisch nicht eingetragen");
    }
  }
  return { checked: checked.length, applied, skipped: null };
}

export async function keywordLastRunAt(storage: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<string | null> {
  const raw = await storage.getSetting(KEYWORD_STATE_KEY, tenantId);
  return raw && typeof raw === "object" && typeof (raw as any).lastRunAt === "string" ? (raw as any).lastRunAt : null;
}
