/**
 * Shop-Inhalte (Pflegeoberflaeche, Konzept 16.10.2026, Schritt A): Uebersicht mit Pruefergebnis, Detail,
 * Vorschau mit dem vorhandenen HTML-Renderer und Uebernahme der Ausgangsdaten aus dem Code.
 * Schreibt nichts in den Shop; die Vorschau liest Artikel (Preis, Bild, Lieferzeit) aus dem Shop des Mandanten.
 */
import {
  SHOP_CONTENT_KIND_ORDER,
  SHOP_CONTENT_SCHEMAS,
  resolveIndustryPage,
  type HomeMondu,
  type HomeRabatt,
  type HomeTeaser,
  type IndustryCommon,
  type IndustryPage,
  type ShopContentDetail,
  type ShopContentIssue,
  type ShopContentKind,
  type ShopContentListEntry,
  type StoredIndustryPage,
} from "@shared/shopContent";
import { checkShopContent, countIssues } from "@shared/shopContentRules";
import type { ShopContentItemRow, ShopContentPublicationRow, ShopContentVersionRow } from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { referencedNumbers } from "../products/industryPages";
import { esc, homeTeaserHtml, type IndustryShopProduct } from "../products/industryPageHtml";
import { homeSectionDraftHtml, industryDraftHtml } from "../products/industryPageDraft";
import { monduSectionHtml, rabattSectionHtml } from "../products/homeSections";
import { shopContentSeed } from "./shopContentSeed";
import { createItemWithVersion, existingKeys, getItem, getVersion, latestPublications, listItemsWithLatestVersion, listVersions } from "./shopContentRepository";
import { findDeChannel, loadIndustryShopProducts, shopApi } from "./shopProducts";

const log = logger.child({ component: "shopContent/shopContentService" });

export class ShopContentError extends Error {
  constructor(
    public code: "notFound" | "shopwareMissing" | "noContent",
    message: string,
  ) {
    super(message);
  }
}

type User = { id: string | null; name: string | null };

type Loaded = { item: ShopContentItemRow; version: ShopContentVersionRow; data: unknown; schemaIssues: ShopContentIssue[] };

/** Gespeicherte Daten gegen das Schema pruefen; Fehler als Pruefergebnis statt Abbruch */
function parse(kind: ShopContentKind, raw: unknown): { data: unknown; issues: ShopContentIssue[] } {
  const schema = SHOP_CONTENT_SCHEMAS[kind];
  if (!schema) return { data: raw, issues: [{ level: "error", rule: "unknownKind", path: "", params: { kind } }] };
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data, issues: [] };
  return {
    data: raw,
    issues: parsed.error.issues.slice(0, 20).map((i) => ({ level: "error" as const, rule: "schema", path: i.path.join("."), params: { message: i.message } })),
  };
}

type State = {
  loaded: Loaded[];
  common: IndustryCommon | null;
  /** aktive Branchenseiten, gemeinsame Texte aufgeloest */
  pages: IndustryPage[];
  publications: Map<string, ShopContentPublicationRow & { versionNo: number | null }>;
};

async function loadState(tenantId: string | null): Promise<State> {
  const [rows, publications] = await Promise.all([listItemsWithLatestVersion(tenantId), latestPublications(tenantId)]);
  const loaded = rows.map(({ item, version }) => {
    const { data, issues } = parse(item.kind as ShopContentKind, version.data);
    return { item, version, data, schemaIssues: issues };
  });
  const commonRow = loaded.find((l) => l.item.kind === "common" && l.schemaIssues.length === 0);
  const common = (commonRow?.data as IndustryCommon | undefined) ?? null;
  const pages = common
    ? loaded.filter((l) => l.item.kind === "industry_page" && l.item.active && l.schemaIssues.length === 0).map((l) => resolveIndustryPage(l.data as StoredIndustryPage, common))
    : [];
  loaded.sort((a, b) => SHOP_CONTENT_KIND_ORDER[a.item.kind as ShopContentKind] - SHOP_CONTENT_KIND_ORDER[b.item.kind as ShopContentKind] || a.item.position - b.item.position);
  return { loaded, common, pages, publications };
}

function issuesOf(l: Loaded, state: State): ShopContentIssue[] {
  if (l.schemaIssues.length) return l.schemaIssues;
  return checkShopContent(l.item.kind as ShopContentKind, l.data, { common: state.common, pages: state.pages });
}

function entryOf(l: Loaded, state: State, issues: ShopContentIssue[]): ShopContentListEntry {
  const pub = (target: "test" | "live") => {
    const p = state.publications.get(`${l.item.id}:${target}`);
    return p ? { versionNo: p.versionNo, publishedAt: p.publishedAt.toISOString(), publishedBy: p.publishedByName, status: p.status } : null;
  };
  const { errors, warnings } = countIssues(issues);
  const url = l.item.kind === "industry_page" ? ((l.data as StoredIndustryPage)?.url ?? null) : null;
  return {
    id: l.item.id,
    kind: l.item.kind as ShopContentKind,
    key: l.item.key,
    name: l.item.name,
    url: typeof url === "string" ? url : null,
    versionNo: l.version.versionNo,
    versionAt: l.version.createdAt.toISOString(),
    versionBy: l.version.createdByName,
    errors,
    warnings,
    test: pub("test"),
    live: pub("live"),
  };
}

export async function listShopContent(tenantId: string | null): Promise<ShopContentListEntry[]> {
  const state = await loadState(tenantId);
  return state.loaded.map((l) => entryOf(l, state, issuesOf(l, state)));
}

export async function getShopContentDetail(tenantId: string | null, id: string): Promise<ShopContentDetail> {
  const state = await loadState(tenantId);
  const l = state.loaded.find((x) => x.item.id === id);
  if (!l) throw new ShopContentError("notFound", "Eintrag nicht gefunden");
  const issues = issuesOf(l, state);
  const versions = await listVersions(tenantId, id);
  return {
    item: entryOf(l, state, issues),
    data: l.data,
    issues,
    versions: versions.map((v) => ({ id: v.id, versionNo: v.versionNo, comment: v.comment, createdAt: v.createdAt.toISOString(), createdBy: v.createdByName })),
  };
}

// ───────────── Artikel aus dem Shop (Vorschau) ─────────────

const PRODUCT_CACHE_MS = 10 * 60 * 1000;
type CachedProduct = { product: IndustryShopProduct | null; problem?: "missing" | "inactive" | "noPrice" };
const productCache = new Map<string, { at: number; asOf: string; byNumber: Map<string, CachedProduct> }>();
/** Je Mandant nur eine Shop-Abfrage zur Zeit (Live nicht parallel abfragen) */
const tenantQueue = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tenantQueue.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  tenantQueue.set(key, next.catch(() => undefined));
  return next;
}

async function shopProducts(tenantId: string | null, numbers: string[]): Promise<{ products: Record<string, IndustryShopProduct>; issues: ShopContentIssue[]; asOf: string }> {
  const key = tenantId ?? "";
  return serialized(key, async () => {
    let cache = productCache.get(key);
    if (!cache || Date.now() - cache.at > PRODUCT_CACHE_MS) {
      cache = { at: Date.now(), asOf: new Date().toISOString(), byNumber: new Map() };
      productCache.set(key, cache);
    }
    const missing = numbers.filter((n) => !cache!.byNumber.has(n));
    if (missing.length) {
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) throw new ShopContentError("shopwareMissing", "Shopware ist für diesen Mandanten nicht eingerichtet");
      const { api, base } = shopApi(settings);
      const de = await findDeChannel(api, base);
      const loaded = await loadIndustryShopProducts(api, missing, de);
      for (const n of missing) cache.byNumber.set(n, { product: loaded.products[n] ?? null });
      for (const p of loaded.problems) cache.byNumber.set(p.number, { product: loaded.products[p.number] ?? null, problem: p.problem });
      log.debug({ tenantId, numbers: missing.length, problems: loaded.problems.length }, "Artikel für die Vorschau geladen");
    }
    const products: Record<string, IndustryShopProduct> = {};
    const issues: ShopContentIssue[] = [];
    const rule = { missing: "articleMissing", inactive: "articleInactive", noPrice: "articleNoPrice" } as const;
    for (const n of numbers) {
      const c = cache.byNumber.get(n)!;
      // Fehlende Artikel als Platzhalter, damit die Vorschau trotzdem sichtbar ist
      products[n] = c.product && typeof c.product.priceNet === "number" ? c.product : { name: c.product?.name ?? n, priceNet: 0, image: c.product?.image ?? null, url: c.product?.url ?? null };
      if (c.problem) issues.push({ level: "error", rule: rule[c.problem], path: "", params: { number: n } });
    }
    return { products, issues, asOf: cache.asOf };
  });
}

// ───────────── Vorschau ─────────────

const stamp = (iso: string) => new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function commonHtml(c: IndustryCommon): string {
  const list = (items: string[]) => `<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  return `<section class="sec"><div class="wrap">
  <h2>Kontakt</h2><p>${esc(c.contact.phone)} · Montag bis Freitag, ${esc(c.contact.hours)} · ${esc(c.contact.mail)}</p>
  <h2>Betreiberpflichten (alle Seiten)</h2>${list(c.operator.map(esc))}<p class="hint">${esc(c.dutyHint)}</p>
  <h2>Vorteilsleiste</h2>${list(c.why.map((w) => `<b>${esc(w.title)}</b> – ${esc(w.text)}`))}
  <h2>Unterlagen</h2>${list(c.docs.map((d) => `${esc(d.label)} (${esc(d.where)})`))}
  <h2>Fragen für alle Seiten</h2>${list(c.faq.map((f) => `<b>${esc(f.q)}</b><br>${esc(f.a)}`))}
</div></section>`;
}

export async function renderShopContentPreview(
  tenantId: string | null,
  id: string,
  opts: { versionNo?: number; notes: boolean },
): Promise<{ html: string; issues: ShopContentIssue[]; asOf: string | null; versionNo: number }> {
  const item = await getItem(tenantId, id);
  if (!item) throw new ShopContentError("notFound", "Eintrag nicht gefunden");
  const version = await getVersion(tenantId, id, opts.versionNo);
  if (!version) throw new ShopContentError("notFound", "Version nicht gefunden");
  const kind = item.kind as ShopContentKind;
  const { data, issues: schemaIssues } = parse(kind, version.data);
  if (schemaIssues.length) return { html: "", issues: schemaIssues, asOf: null, versionNo: version.versionNo };
  const state = await loadState(tenantId);
  const banner = (asOf: string | null) =>
    `VORSCHAU · ${item.name} · Version ${version.versionNo}${asOf ? ` · Artikel, Preise und Bilder aus dem Shop, Stand ${stamp(asOf)}` : ""} · nicht veröffentlicht`;

  if (kind === "industry_page") {
    if (!state.common) throw new ShopContentError("noContent", "Gemeinsame Texte fehlen");
    const page = resolveIndustryPage(data as StoredIndustryPage, state.common);
    const shop = await shopProducts(tenantId, referencedNumbers(page));
    const pages = state.pages.map((p) => (p.key === page.key ? page : p));
    const html = industryDraftHtml(page, shop.products, { asOf: shop.asOf.slice(0, 10), pages, hrefFor: () => "#", contact: state.common.contact, notes: opts.notes, banner: banner(shop.asOf) });
    return { html, issues: shop.issues, asOf: shop.asOf, versionNo: version.versionNo };
  }
  if (kind === "home_teaser") {
    if (!state.common) throw new ShopContentError("noContent", "Gemeinsame Texte fehlen");
    const shop = await shopProducts(tenantId, [...new Set(state.pages.map((p) => p.hero.number))]);
    const section = homeTeaserHtml(state.pages, shop.products, (p) => p.url, data as HomeTeaser, state.common.contact);
    return { html: homeSectionDraftHtml(item.name, section, banner(shop.asOf)), issues: shop.issues, asOf: shop.asOf, versionNo: version.versionNo };
  }
  if (kind === "home_rabatt") return { html: homeSectionDraftHtml(item.name, rabattSectionHtml(".mbp", data as HomeRabatt), banner(null)), issues: [], asOf: null, versionNo: version.versionNo };
  if (kind === "home_mondu") return { html: homeSectionDraftHtml(item.name, monduSectionHtml(".mbp", data as HomeMondu), banner(null)), issues: [], asOf: null, versionNo: version.versionNo };
  return { html: homeSectionDraftHtml(item.name, commonHtml(data as IndustryCommon), banner(null)), issues: [], asOf: null, versionNo: version.versionNo };
}

// ───────────── Uebernahme aus dem Code ─────────────

/** Legt fehlende Eintraege aus den Ausgangsdaten als Version 1 an; vorhandene bleiben unberuehrt. */
export async function importShopContentFromCode(tenantId: string | null, user: User): Promise<{ created: string[]; skipped: string[] }> {
  const seed = shopContentSeed();
  const have = await existingKeys(tenantId);
  const common = seed.find((s) => s.kind === "common")!.data as IndustryCommon;
  const pages = seed.filter((s) => s.kind === "industry_page").map((s) => resolveIndustryPage(s.data as StoredIndustryPage, common));
  const created: string[] = [];
  const skipped: string[] = [];
  for (const entry of seed) {
    if (have.has(`${entry.kind}:${entry.key}`)) {
      skipped.push(entry.name);
      continue;
    }
    const checkResult = checkShopContent(entry.kind, entry.data, { common, pages });
    await createItemWithVersion(tenantId, entry, { comment: "Übernahme aus dem Code (industryPages.ts, homeSections.ts)", checkResult, userId: user.id, userName: user.name });
    created.push(entry.name);
  }
  log.info({ event: "shopContent.imported", tenantId, userId: user.id, username: user.name, created, skipped: skipped.length }, `Shop-Inhalte aus dem Code übernommen: ${created.length} neu, ${skipped.length} schon vorhanden`);
  return { created, skipped };
}
