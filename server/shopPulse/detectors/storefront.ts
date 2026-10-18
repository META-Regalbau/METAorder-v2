/**
 * Shop-Puls, Kaufbarkeit in der Storefront, so wie ein Kunde sie erlebt (Konzept Stufe 1, Abschnitt 2 B2;
 * PR D). Ohne JavaScript, per HTTP, unter der Sperre des Shop-Wächters (nie parallel zu dessen Läufen).
 * Tests in tests/unit/shopPulseStorefront.test.ts.
 *
 * 1. Produktseiten reihum: die Topseller (80 % des MO-Netto-Umsatzes der letzten 365 Tage, Live 269) in
 *    zwei Gruppen. Je Takt (15 Minuten) 2 Seiten der Top-Gruppe (50 % des Umsatzes, Live 78) und 3 der
 *    übrigen, zusammen 20 pro Stunde: die Top 78 also rund alle 10 Stunden, die übrigen rund alle 16.
 *    Geprüft: Status 200, Kaufformular mit Kaufknopf, kein „nicht verfügbar“, angezeigter Preis = Preis
 *    laut Spiegel (netto oder brutto). Weicht der Preis ab, zählt erst der frische Preis aus der Admin-API
 *    (der Spiegel kann hinterherhinken). Ein Fehlstatus wird nach kurzer Pause einmal wiederholt. Fehlerhafte
 *    Seiten kommen im nächsten Takt zuerst wieder dran; ihre Meldung bleibt offen, bis die Seite wieder
 *    passt. Antwortet der Shop gar nicht, gilt der Lauf als gescheitert (das meldet die Warenkorb-Probe).
 * 2. Warenkorb-Probe alle 30 Minuten zwischen 6 und 22 Uhr (Berlin): Startseite → Suche „Fachbodenregal“
 *    hat Treffer → Topseller in den Warenkorb → Warenkorb zeigt die Position mit Preis → Kasse leitet zur
 *    Anmeldung weiter. Danach wird die Position wieder entfernt. Bestellt wird nie, Konten werden nie
 *    angelegt (freigegeben vom User am 17.10.2026). „Kritisch“ erst beim zweiten Fehlschlag in Folge, mit
 *    dem Schritt, an dem es scheiterte.
 *
 * Ist die Warenkorb-Probe rot, wird eine gleichzeitig offene Bestell-Lücke (Umsatz-Puls) kritisch.
 */
import type { ShopPulseDetection } from "@shared/shopPulse";
import type { BuyabilityProduct } from "../buyabilityData";
import type { PulseOrder } from "../pulseOrders";
import { addDays, berlinTime } from "../pulseOrders";
import { parseCart, parseProductPage, searchHits, isLoginPage, StorefrontSession } from "../storefront";
import { createShopWatchContext } from "../../shopContent/shopWatch";
import type { ShopPage } from "../../shopContent/shopWatchChecks";
import { DE_LANG } from "../../shopContent/shopProducts";
import { DE_CHANNEL_ID, isSellable, lossPerHourOf, shortName, topsellers, TOPSELLER_SHARE } from "./buyability";
import type { ShopPulseDetector, ShopPulseDetectorContext, ShopPulseDetectorState, StorefrontShop } from "./types";

export const STOREFRONT_STATE_KEY = "shop_pulse_storefront_state";
/** Top-Gruppe: Artikel mit zusammen 50 % des Umsatzes (Live 17.10.2026: 78) */
export const TOP_GROUP_SHARE = 0.5;
export const PAGES_TOP_PER_RUN = 2;
export const PAGES_REST_PER_RUN = 3;
/** Fehlerhafte Seiten, die ein Lauf zusätzlich erneut prüft */
export const PAGES_RECHECK_MAX = 5;
const PRICE_TOLERANCE = 0.011;
const RETRY_PAUSE_MS = 2000;

export const CART_PROBE_KEY = "buyability:cart:probe";
export const CART_SEARCH_TERM = "Fachbodenregal";
export const CART_FROM_HOUR = 6;
export const CART_TO_HOUR = 22;
/** 30-Minuten-Takt mit Spielraum für den 15-Minuten-Takt des Shop-Puls */
const CART_INTERVAL_MS = 25 * 60 * 1000;
/** Ab so vielen Fehlschlägen in Folge kritisch */
export const CART_FAILURES_CRITICAL = 2;

export type PageProblem = "status" | "noBuyButton" | "unavailable" | "price";
export type PageCheck = {
  at: string;
  ok: boolean;
  problem?: PageProblem;
  url?: string;
  status?: number;
  shown?: number | null;
  expected?: number | null;
};

export type CartProbeStep = "home" | "search" | "add" | "cart" | "checkout";
export type CartProbeResult =
  | { ok: true; hits: number; price: number }
  | { ok: false; step: CartProbeStep; status: number; reason: string };

export type CartProbeState = {
  /** Fehlschläge in Folge */
  failures: number;
  firstFailureAt?: string;
  lastOkAt?: string;
  last?: { at: string; product: string; ms: number } & CartProbeResult;
};

/** Settings-Key shop_pulse_storefront_state */
export type StorefrontState = {
  cursorTop?: number;
  cursorRest?: number;
  /** letzte Prüfung je Artikelnummer (nur aktuelle Topseller) */
  pages?: Record<string, PageCheck>;
  cart?: CartProbeState;
};

async function getState(ctx: Pick<ShopPulseDetectorContext, "storage" | "tenantId">): Promise<StorefrontState> {
  const raw = await ctx.storage.getSetting(STOREFRONT_STATE_KEY, ctx.tenantId);
  return raw && typeof raw === "object" ? (raw as StorefrontState) : {};
}

async function patchState(ctx: Pick<ShopPulseDetectorContext, "storage" | "tenantId">, patch: Partial<StorefrontState>): Promise<void> {
  await ctx.storage.saveSetting(STOREFRONT_STATE_KEY, { ...(await getState(ctx)), ...patch }, ctx.tenantId);
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

// ---------------------------------------------------------------------------------------------
// Auswahl der Produktseiten

export type PageCandidate = BuyabilityProduct & { id: string; revenue: number; group: "top" | "rest" };

/**
 * Topseller, deren Seite ein Kunde kaufen kann: im DE-Kanal aktiv, keine Variante (erbt Felder), kein
 * Hauptartikel mit Varianten, kein technischer Artikel. Absteigend nach Umsatz.
 */
export function pageCandidates(products: BuyabilityProduct[], revenue: Map<string, number>, channelId = DE_CHANNEL_ID): PageCandidate[] {
  const top = topsellers(revenue, TOPSELLER_SHARE);
  const topGroup = topsellers(revenue, TOP_GROUP_SHARE);
  const out: PageCandidate[] = [];
  for (const p of products) {
    if (!p.id || !top.has(p.productNumber) || p.isVariant || p.isTechnical || (p.childCount ?? 0) > 0 || !isSellable(p, channelId)) continue;
    out.push({ ...p, id: p.id, revenue: revenue.get(p.productNumber) ?? 0, group: topGroup.has(p.productNumber) ? "top" : "rest" });
  }
  return out.sort((a, b) => b.revenue - a.revenue || a.productNumber.localeCompare(b.productNumber));
}

/** Seiten dieses Laufs: zuerst die fehlerhaften (höchstens 5), dann reihum je Gruppe */
export function pickPages(
  candidates: PageCandidate[],
  state: Pick<StorefrontState, "cursorTop" | "cursorRest" | "pages">,
  per = { top: PAGES_TOP_PER_RUN, rest: PAGES_REST_PER_RUN, recheck: PAGES_RECHECK_MAX },
): { picks: PageCandidate[]; cursorTop: number; cursorRest: number } {
  const picks = candidates.filter((c) => state.pages?.[c.productNumber]?.ok === false).slice(0, per.recheck);
  const picked = new Set(picks.map((c) => c.productNumber));
  const rotate = (group: PageCandidate[], cursor: number, n: number): number => {
    if (!group.length) return 0;
    let i = cursor % group.length;
    for (let taken = 0, seen = 0; taken < n && seen < group.length; seen++) {
      const c = group[i];
      i = (i + 1) % group.length;
      if (picked.has(c.productNumber)) continue;
      picks.push(c);
      picked.add(c.productNumber);
      taken++;
    }
    return i;
  };
  const cursorTop = rotate(candidates.filter((c) => c.group === "top"), state.cursorTop ?? 0, per.top);
  const cursorRest = rotate(candidates.filter((c) => c.group === "rest"), state.cursorRest ?? 0, per.rest);
  return { picks, cursorTop, cursorRest };
}

// ---------------------------------------------------------------------------------------------
// Prüfung einer Produktseite

const priceFits = (shown: number, ...expected: Array<number | null | undefined>) =>
  expected.some((e) => typeof e === "number" && Math.abs(shown - e) <= PRICE_TOLERANCE);

/** Seite gegen den Spiegel: Status, nicht verfügbar, Kaufknopf, Preis (netto oder brutto) */
export function judgeProductPage(page: ShopPage, product: Pick<BuyabilityProduct, "priceNet" | "priceGross">, at: string, url: string): PageCheck {
  if (page.status !== 200) return { at, ok: false, problem: "status", url, status: page.status };
  const info = parseProductPage(page.html);
  if (info.unavailable) return { at, ok: false, problem: "unavailable", url };
  if (!info.buyForm) return { at, ok: false, problem: "noBuyButton", url };
  const expected = product.priceNet ?? product.priceGross ?? null;
  if (info.price === null || !priceFits(info.price, product.priceNet, product.priceGross)) {
    return { at, ok: false, problem: "price", url, shown: info.price, expected };
  }
  return { at, ok: true, url };
}

/** SEO-Adressen der Produktseiten im DE-Kanal (eine Abfrage); fehlt eine, gilt /detail/<id> */
export async function productPaths(shop: Pick<StorefrontShop, "api" | "channelId">, ids: string[]): Promise<Map<string, string>> {
  const paths = new Map(ids.map((id) => [id, `/detail/${id}`]));
  if (!ids.length) return paths;
  const res = await shop.api("POST", "search/seo-url", {
    // Shopware erlaubt höchstens 500 je Abfrage
    limit: Math.min(ids.length * 4, 500),
    filter: [
      { type: "equalsAny", field: "foreignKey", value: ids },
      { type: "equals", field: "routeName", value: "frontend.detail.page" },
      { type: "equals", field: "salesChannelId", value: shop.channelId },
      { type: "equals", field: "languageId", value: DE_LANG },
      { type: "equals", field: "isCanonical", value: true },
      { type: "equals", field: "isDeleted", value: false },
    ],
    includes: { seo_url: ["foreignKey", "seoPathInfo"] },
  });
  for (const row of res?.data ?? []) {
    if (row?.foreignKey && row?.seoPathInfo) paths.set(String(row.foreignKey), `/${String(row.seoPathInfo).replace(/^\/+/, "")}`);
  }
  return paths;
}

/** Frischer Preis aus der Admin-API (Standardwährung) */
async function freshPrice(shop: Pick<StorefrontShop, "api">, id: string): Promise<{ net: number | null; gross: number | null } | null> {
  const res = await shop.api("POST", "search/product", { ids: [id], includes: { product: ["id", "price"] } });
  const price = res?.data?.[0]?.price?.[0];
  if (!price) return null;
  return { net: typeof price.net === "number" ? price.net : null, gross: typeof price.gross === "number" ? price.gross : null };
}

const unreachable = (c: PageCheck) => c.problem === "status" && (!c.status || c.status >= 500);

/** Seiten nacheinander prüfen (mit Pause), Fehlstatus einmal wiederholen, Preisabweichung gegen die Admin-API */
export async function checkProductPages(shop: StorefrontShop, picks: PageCandidate[], now: Date): Promise<Map<string, PageCheck>> {
  const results = new Map<string, PageCheck>();
  if (!picks.length) return results;
  const paths = await productPaths(shop, picks.map((p) => p.id)).catch(() => new Map(picks.map((p) => [p.id, `/detail/${p.id}`])));
  const load = async (path: string): Promise<ShopPage> => {
    // je Abruf ein frischer Wächter-Kontext: der merkt sich Seiten, eine Wiederholung soll neu laden
    const watch = createShopWatchContext({ api: shop.api, channelId: shop.channelId, storefront: shop.storefront, baseline: null, fetchImpl: shop.fetchImpl });
    return watch.page(path).catch(() => ({ status: 0, html: "", location: null }));
  };
  const at = now.toISOString();
  for (const [i, p] of picks.entries()) {
    if (i > 0) await sleep(shop.pauseMs);
    const path = paths.get(p.id) ?? `/detail/${p.id}`;
    const url = `${shop.storefront}${path}`;
    let check = judgeProductPage(await load(path), p, at, url);
    if (!check.ok && check.problem === "status") {
      await sleep(shop.pauseMs > 0 ? RETRY_PAUSE_MS : 0);
      check = judgeProductPage(await load(path), p, at, url);
    }
    if (!check.ok && check.problem === "price" && check.shown !== null && check.shown !== undefined) {
      const fresh = await freshPrice(shop, p.id).catch(() => null);
      if (fresh && priceFits(check.shown, fresh.net, fresh.gross)) check = { at, ok: true, url };
      else if (fresh) check.expected = fresh.net ?? fresh.gross ?? check.expected;
    }
    results.set(p.productNumber, check);
  }
  // Antwortet der Shop gar nicht (ab 3 Seiten keine einzige brauchbar), ist das kein Fund je Artikel
  const all = Array.from(results.values());
  if (all.length >= 3 && all.every(unreachable)) throw new Error(`Storefront nicht erreichbar (${all.length} Produktseiten ohne Antwort)`);
  return results;
}

const PAGE_CODE = {
  status: "productPageStatus",
  noBuyButton: "productPageNoBuyButton",
  unavailable: "productPageUnavailable",
  price: "productPagePrice",
} as const;

/** Offene Funde: jeder aktuelle Topseller, dessen letzte Prüfung fehlschlug */
export function productPageDetections(candidates: PageCandidate[], pages: Record<string, PageCheck>): ShopPulseDetection[] {
  const out: ShopPulseDetection[] = [];
  for (const c of candidates) {
    const check = pages[c.productNumber];
    if (!check || check.ok || !check.problem) continue;
    const params: Record<string, string | number> = { number: c.productNumber, name: shortName(c.name), revenue: Math.round(c.revenue) };
    if (check.problem === "status") params.status = check.status ?? 0;
    if (check.problem === "price") {
      if (typeof check.shown === "number") params.shown = check.shown;
      if (typeof check.expected === "number") params.expected = check.expected;
    }
    out.push({
      key: `buyability:page:${c.productNumber}`,
      source: "buyability",
      code: PAGE_CODE[check.problem],
      severity: "critical",
      params,
      evidence: { url: check.url ?? null, checkedAt: check.at, group: c.group },
      lossPerHour: lossPerHourOf(c.revenue),
    });
  }
  return out;
}

export const productPagesDetector: ShopPulseDetector = {
  id: "productPages",
  source: "buyability",
  keyPrefix: "buyability:page:",
  async run(ctx) {
    const [products, revenue] = await Promise.all([ctx.buyability.products(), ctx.buyability.revenue()]);
    if (!products.length) throw new Error("Produktspiegel leer");
    const candidates = pageCandidates(products, revenue);
    const state = await getState(ctx);
    const { picks, cursorTop, cursorRest } = pickPages(candidates, state);
    const results = await ctx.storefront.withShop((shop) => checkProductPages(shop, picks, ctx.now));
    const current = new Set(candidates.map((c) => c.productNumber));
    const pages: Record<string, PageCheck> = {};
    for (const [pn, check] of Object.entries(state.pages ?? {})) if (current.has(pn)) pages[pn] = check;
    for (const [pn, check] of Array.from(results.entries())) pages[pn] = check;
    await patchState(ctx, { cursorTop, cursorRest, pages });
    return productPageDetections(candidates, pages);
  },
};

// ---------------------------------------------------------------------------------------------
// Warenkorb-Probe

/** Fällig: 6–22 Uhr Berlin und 30 Minuten seit der letzten Probe (ausgesetzt oder gescheitert: gleich wieder) */
export function isCartProbeDue(prev: ShopPulseDetectorState | undefined, now: Date): boolean {
  const { hour } = berlinTime(now);
  if (hour < CART_FROM_HOUR || hour >= CART_TO_HOUR) return false;
  if (!prev || prev.skipped || !prev.ok) return true;
  return now.getTime() - Date.parse(prev.at) >= CART_INTERVAL_MS;
}

/**
 * Ein Durchlauf wie ein Gast. Legt eine Position in den Warenkorb und entfernt sie am Ende wieder (auch
 * wenn ein Schritt scheitert). Bestellt nie.
 */
export async function runCartProbe(session: StorefrontSession, product: { id: string }, pauseMs = 0): Promise<CartProbeResult> {
  let step: CartProbeStep = "home";
  let added = false;
  const fail = (status: number, reason: string): CartProbeResult => ({ ok: false, step, status, reason });
  try {
    const home = await session.get("/");
    if (home.status !== 200) return fail(home.status, "status");

    await sleep(pauseMs);
    step = "search";
    const search = await session.get(`/search?search=${encodeURIComponent(CART_SEARCH_TERM)}`);
    if (search.status !== 200) return fail(search.status, "status");
    const hits = searchHits(search.html);
    if (hits === 0) return fail(search.status, "noHits");

    await sleep(pauseMs);
    step = "add";
    const id = product.id;
    const add = await session.post("/checkout/line-item/add", {
      redirectTo: "frontend.checkout.cart.page",
      [`lineItems[${id}][id]`]: id,
      [`lineItems[${id}][referencedId]`]: id,
      [`lineItems[${id}][type]`]: "product",
      [`lineItems[${id}][quantity]`]: "1",
      [`lineItems[${id}][stackable]`]: "1",
      [`lineItems[${id}][removable]`]: "1",
    });
    added = true;
    if (add.status >= 400) return fail(add.status, "status");

    await sleep(pauseMs);
    step = "cart";
    const cart = await session.get("/checkout/cart");
    if (cart.status !== 200) return fail(cart.status, "status");
    const info = parseCart(cart.html, id);
    if (!info.hasProduct) return fail(cart.status, "missing");
    if (info.price === null || info.price <= 0) return fail(cart.status, "noPrice");

    await sleep(pauseMs);
    step = "checkout";
    const confirm = await session.get("/checkout/confirm", { redirect: "manual" });
    const target = confirm.location ?? "";
    if (confirm.status < 300 || confirm.status >= 400 || !/\/(checkout\/register|account\/login)/.test(target)) return fail(confirm.status, "noRedirect");
    const login = await session.get(target);
    if (login.status !== 200) return fail(login.status, "status");
    if (!isLoginPage(login.html)) return fail(login.status, "noLogin");
    return { ok: true, hits, price: info.price };
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return fail(0, timeout ? "timeout" : "network");
  } finally {
    if (added) {
      // Position wieder entfernen: der leere Gast-Warenkorb wird von Shopware nicht gespeichert
      await session.post(`/checkout/line-item/delete/${product.id}`, { redirectTo: "frontend.checkout.cart.page" }).catch(() => undefined);
    }
  }
}

const CART_CODE = {
  home: "cartProbeHome",
  search: "cartProbeSearch",
  add: "cartProbeAdd",
  cart: "cartProbeCart",
  checkout: "cartProbeCheckout",
} as const;

/** Üblicher Shop-Umsatz einer Geschäftsstunde (7–19 Uhr), Schnitt der letzten 28 Tage, brutto */
export function shopRevenuePerHour(orders: PulseOrder[], now: Date): number | null {
  const today = berlinTime(now).day;
  const from = addDays(today, -28);
  const total = orders.filter((o) => o.day >= from && o.day < today && o.hour >= 7 && o.hour < 19).reduce((s, o) => s + o.total, 0);
  const perHour = Math.round(total / 28 / 12);
  return perHour > 0 ? perHour : null;
}

/** Fund ab dem zweiten Fehlschlag in Folge, benannt nach dem Schritt, an dem die letzte Probe scheiterte */
export function cartProbeDetections(state: CartProbeState | undefined, lossPerHour: number | null = null): ShopPulseDetection[] {
  const last = state?.last;
  if (!state || state.failures < CART_FAILURES_CRITICAL || !last || last.ok) return [];
  return [
    {
      key: CART_PROBE_KEY,
      source: "buyability",
      code: CART_CODE[last.step],
      severity: "critical",
      params: {
        failures: state.failures,
        response: last.status > 0 ? `HTTP ${last.status}` : last.reason,
        term: CART_SEARCH_TERM,
        number: last.product,
      },
      evidence: { step: last.step, reason: last.reason, status: last.status, firstFailureAt: state.firstFailureAt ?? null, lastOkAt: state.lastOkAt ?? null, at: last.at },
      lossPerHour,
    },
  ];
}

export const cartProbeDetector: ShopPulseDetector = {
  id: "cartProbe",
  source: "buyability",
  keyPrefix: "buyability:cart:",
  due: isCartProbeDue,
  async run(ctx) {
    const [products, revenue] = await Promise.all([ctx.buyability.products(), ctx.buyability.revenue()]);
    const state = await getState(ctx);
    const candidates = pageCandidates(products, revenue);
    // Topseller mit zuletzt einwandfreier Produktseite (sonst der umsatzstärkste)
    const product = candidates.find((c) => state.pages?.[c.productNumber]?.ok !== false) ?? candidates[0];
    if (!product) throw new Error("Kein Topseller für die Warenkorb-Probe");
    const started = Date.now();
    const result = await ctx.storefront.withShop((shop) => runCartProbe(new StorefrontSession(shop.storefront, shop.fetchImpl), product, shop.pauseMs));
    const at = ctx.now.toISOString();
    const prev = state.cart ?? { failures: 0 };
    const cart: CartProbeState = result.ok
      ? { failures: 0, lastOkAt: at, last: { at, product: product.productNumber, ms: Date.now() - started, ...result } }
      : {
          failures: prev.failures + 1,
          firstFailureAt: prev.failures > 0 ? prev.firstFailureAt ?? at : at,
          lastOkAt: prev.lastOkAt,
          last: { at, product: product.productNumber, ms: Date.now() - started, ...result },
        };
    await patchState(ctx, { cart });
    if (cart.failures < CART_FAILURES_CRITICAL) return [];
    const loss = await ctx.orders().then((o) => shopRevenuePerHour(o, ctx.now)).catch(() => null);
    return cartProbeDetections(cart, loss);
  },
};

// ---------------------------------------------------------------------------------------------
// Verknüpfung mit dem Umsatz-Puls

/** Warenkorb-Probe rot: eine gleichzeitig offene Bestell-Lücke ist bestätigt und wird kritisch */
export function confirmOrderGap(detections: ShopPulseDetection[], cartRed: boolean): ShopPulseDetection[] {
  if (!cartRed) return detections;
  return detections.map((d) =>
    d.code === "orderGap" ? { ...d, code: "orderGapConfirmed", severity: "critical", evidence: { ...(d.evidence ?? {}), confirmedBy: CART_PROBE_KEY } } : d,
  );
}

export async function getStorefrontState(store: ShopPulseDetectorContext["storage"], tenantId: string | null): Promise<StorefrontState> {
  return getState({ storage: store, tenantId });
}
