/**
 * Shop-Puls PR D: Kaufbarkeit in der Storefront wie ein Kunde. Auswertung der Shop-Seiten (Markup wie
 * Shopware 6.7 im Testshop), Gast-Sitzung mit Cookies, Auswahl der Produktseiten reihum, Prüfung gegen
 * einen simulierten Shop (Wiederholung, Preis gegen die Admin-API, Shop nicht erreichbar), Warenkorb-Probe
 * Schritt für Schritt (nie bestellen, Position wieder entfernen) und Läufe über den Zeitplan: kritisch erst
 * beim zweiten Fehlschlag, Takt 6–22 Uhr, Sperre des Shop-Wächters, bestätigte Bestell-Lücke.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  isLoginPage,
  parseCart,
  parseMoney,
  parseProductPage,
  searchHits,
  StorefrontSession,
} from "../../server/shopPulse/storefront";
import {
  CART_PROBE_KEY,
  cartProbeDetections,
  cartProbeDetector,
  checkProductPages,
  confirmOrderGap,
  isCartProbeDue,
  pageCandidates,
  pickPages,
  productPageDetections,
  productPagesDetector,
  runCartProbe,
  STOREFRONT_STATE_KEY,
  type PageCandidate,
  type StorefrontState,
} from "../../server/shopPulse/detectors/storefront";
import { DE_CHANNEL_ID } from "../../server/shopPulse/detectors/buyability";
import { orderGapDetector } from "../../server/shopPulse/detectors/revenue";
import { runShopPulseForTenant, type ShopPulseDeps } from "../../server/shopPulse/shopPulseScheduler";
import { SHOP_PULSE_SETTINGS_KEY } from "../../server/shopPulse/shopPulseSettings";
import type { ReconcileResult } from "../../server/shopPulse/shopPulseSignals";
import type { StorefrontAccess, StorefrontShop } from "../../server/shopPulse/detectors/types";
import type { BuyabilityProduct } from "../../server/shopPulse/buyabilityData";
import type { PulseOrder } from "../../server/shopPulse/pulseOrders";
import { withShopLock, ShopBusyError } from "../../server/shopContent/shopWatch";
import type { ShopPulseSignal } from "../../shared/shopPulse";

const BASE = "https://shop.example";
const id = (n: string) => Buffer.from(n).toString("hex").padStart(32, "0");

// ---------------------------------------------------------------------------------------------
// Markup wie im Testshop (gekürzt)

function productHtml(o: { id: string; number: string; price?: number | null; buy?: boolean; delivery?: string; availability?: string }) {
  const price = o.price === undefined ? 235 : o.price;
  return `<!DOCTYPE html><html><head>
<!-- {% block layout_head_meta_tags %} viele Twig-Kommentare <form action="/checkout/line-item/add"><button class="btn-buy"></button></form> -->
${price !== null ? `<meta property="product:price:amount" content="${price}">` : ""}
</head><body>
<div class="product-detail-price-container">${price !== null ? `<meta itemprop="price" content="${price}">` : ""}<p class="product-detail-price"> ${price ?? ""} € </p></div>
<div class="product-delivery-information"><link itemprop="availability" href="https://schema.org/${o.availability ?? "InStock"}">
<p class="delivery-information ${o.delivery ?? "delivery-available"}"><span class="delivery-status-indicator bg-success"></span> Sofort verfügbar</p></div>
${o.buy === false ? "" : `<form id="productDetailPageBuyProductForm" action="/checkout/line-item/add" method="post" class="buy-widget" data-add-to-cart="true">
<input type="hidden" name="lineItems[${o.id}][id]" value="${o.id}"><div class="d-grid"><button class="btn btn-primary btn-buy" type="submit" title="In den Warenkorb"> In den Warenkorb </button></div></form>`}
<div class="product-detail-ordernumber-container"><meta itemprop="productID" content="${o.id}"><span class="product-detail-ordernumber" itemprop="sku"> ${o.number} </span></div>
<div class="cms-element-product-slider"><div class="card product-box box-standard"><meta itemprop="price" content="9.99"></div></div>
</body></html>`;
}

const searchHtml = (hits: number) =>
  `<h1 class="search-headline text-center mb-4"> Zu &quot;Fachbodenregal&quot; wurden ${hits} Produkte gefunden </h1>` +
  Array.from({ length: hits }, (_, i) => `<div class="card product-box box-standard"><a class="product-name stretched-link" href="${BASE}/p${i}">P${i}</a></div>`).join("");

const cartHtml = (items: Array<{ id: string; price: string }>) =>
  items.length === 0
    ? `<div class="alert alert-info">Ihr Warenkorb ist leer.</div>`
    : items
        .map(
          (it) => `<li class="line-item line-item-product is-default"><div class="line-item-details"><span class="line-item-product-number">X</span></div>
<div class="line-item-total-price line-item-price"><div class="line-item-total-price-label"> Summe: </div><div class="line-item-total-price-value"> ${it.price} </div></div>
<form action="/checkout/line-item/delete/${it.id}" method="post"><button class="btn line-item-remove-button">Entfernen</button></form></li>`,
        )
        .join("");

const loginHtml = `<form action="/account/login" method="post"></form><form action="/account/register" method="post"></form>`;

// ---------------------------------------------------------------------------------------------
// Simulierter Shop: Storefront (Sitzung per Cookie) und Admin-API

type ShopBehaviour = {
  home?: number;
  searchHits?: number;
  addStatus?: number;
  /** Position landet nicht im Warenkorb */
  cartDropsItem?: boolean;
  cartPrice?: string;
  confirm?: { status: number; location?: string };
  register?: string;
  throwOn?: string;
  /** Produktseiten je Pfad: Status und HTML; Folge = je Abruf der nächste Eintrag */
  pages?: Record<string, Array<{ status: number; html?: string }>>;
};

function fakeShop(behaviour: ShopBehaviour = {}) {
  const calls: string[] = [];
  const carts = new Map<string, string[]>();
  let sessions = 0;
  const pageCalls = new Map<string, number>();
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${u.pathname}${u.search}`);
    if (behaviour.throwOn && u.pathname === behaviour.throwOn) {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }
    const cookie = String((init?.headers as Record<string, string> | undefined)?.Cookie ?? "");
    let session = cookie.match(/session-=(\w+)/)?.[1];
    const headers = new Headers();
    if (!session) {
      session = `s${++sessions}`;
      headers.append("set-cookie", `session-=${session}; path=/; secure; httponly; samesite=lax`);
    }
    const cart = carts.get(session) ?? [];
    carts.set(session, cart);
    const html = (status: number, body: string) => new Response(body, { status, headers });
    const redirect = (status: number, location: string) => {
      headers.set("location", location);
      return new Response(null, { status, headers });
    };
    if (method === "GET" && u.pathname === "/") return html(behaviour.home ?? 200, "<html>Start</html>");
    if (method === "GET" && u.pathname === "/search") return html(200, searchHtml(behaviour.searchHits ?? 24));
    if (method === "POST" && u.pathname === "/checkout/line-item/add") {
      if (behaviour.addStatus && behaviour.addStatus >= 400) return html(behaviour.addStatus, "Fehler");
      const form = new URLSearchParams(String(init?.body ?? ""));
      const itemId = Array.from(form.keys()).map((k) => k.match(/^lineItems\[(\w+)\]\[id\]$/)?.[1]).find(Boolean);
      if (itemId && !behaviour.cartDropsItem) cart.push(itemId);
      headers.append("set-cookie", "sw-states=cart-filled; path=/; secure; httponly");
      return redirect(302, "/checkout/cart");
    }
    if (method === "POST" && u.pathname.startsWith("/checkout/line-item/delete/")) {
      const itemId = u.pathname.split("/").pop()!;
      carts.set(session, cart.filter((x) => x !== itemId));
      return redirect(302, "/checkout/cart");
    }
    if (method === "GET" && u.pathname === "/checkout/cart") return html(200, cartHtml(cart.map((x) => ({ id: x, price: behaviour.cartPrice ?? "235,00 €" }))));
    if (method === "GET" && u.pathname === "/checkout/confirm") {
      const c = behaviour.confirm ?? { status: 302, location: "/checkout/register" };
      return c.location ? redirect(c.status, c.location) : html(c.status, "Kasse");
    }
    if (method === "GET" && u.pathname === "/checkout/register") return cart.length ? html(200, behaviour.register ?? loginHtml) : redirect(302, "/checkout/cart");
    const seq = behaviour.pages?.[u.pathname];
    if (seq) {
      const n = pageCalls.get(u.pathname) ?? 0;
      pageCalls.set(u.pathname, n + 1);
      const p = seq[Math.min(n, seq.length - 1)];
      return html(p.status, p.html ?? "");
    }
    return html(404, "Seite nicht gefunden");
  };
  return { fetchImpl, calls, carts };
}

function fakeApi(o: { seo?: Record<string, string>; prices?: Record<string, { net: number; gross: number }>; calls?: string[] } = {}) {
  return async (method: string, path: string, body?: any) => {
    o.calls?.push(`${method} ${path}`);
    if (path === "search/seo-url") {
      const ids: string[] = body.filter.find((f: any) => f.field === "foreignKey").value;
      return { data: ids.filter((x) => o.seo?.[x]).map((x) => ({ foreignKey: x, seoPathInfo: o.seo![x] })) };
    }
    if (path === "search/product") {
      const p = o.prices?.[body.ids[0]];
      return { data: p ? [{ id: body.ids[0], price: [{ net: p.net, gross: p.gross }] }] : [] };
    }
    throw new Error(`unerwartet: ${path}`);
  };
}

const shopOf = (fetchImpl: StorefrontShop["fetchImpl"], api = fakeApi()): StorefrontShop => ({ storefront: BASE, channelId: DE_CHANNEL_ID, api, fetchImpl, pauseMs: 0 });

const product = (n: string, over: Partial<BuyabilityProduct> = {}): BuyabilityProduct => ({
  id: id(n),
  productNumber: n,
  name: `Artikel ${n}`,
  active: true,
  salesChannelIds: [DE_CHANNEL_ID],
  priceGross: 279.65,
  priceNet: 235,
  stock: 10,
  deliveryTimeId: "d",
  restockTime: null,
  categoryCount: 1,
  isVariant: false,
  childCount: 0,
  ...over,
});

// ---------------------------------------------------------------------------------------------

describe("Seiten auswerten", () => {
  it("Produktseite: ID, Nummer, Kaufformular, Preis aus den Meta-Daten (nicht aus Kommentaren oder Slidern)", () => {
    expect(parseProductPage(productHtml({ id: id("A"), number: "4026212260212" }))).toEqual({
      productId: id("A"),
      productNumber: "4026212260212",
      buyForm: true,
      price: 235,
      availability: "InStock",
      unavailable: false,
    });
  });

  it("Produktseite: ohne Kaufknopf, ausverkauft, nicht verfügbar, ohne Preis", () => {
    expect(parseProductPage(productHtml({ id: "x", number: "1", buy: false })).buyForm).toBe(false);
    expect(parseProductPage(productHtml({ id: "x", number: "1", delivery: "delivery-soldout", availability: "LimitedAvailability" })).unavailable).toBe(true);
    expect(parseProductPage(productHtml({ id: "x", number: "1", delivery: "delivery-not-available" })).unavailable).toBe(true);
    expect(parseProductPage(productHtml({ id: "x", number: "1", availability: "OutOfStock" })).unavailable).toBe(true);
    expect(parseProductPage(productHtml({ id: "x", number: "1", price: null })).price).toBe(null);
  });

  it("Beträge, Suchtreffer, Warenkorb und Anmeldeseite", () => {
    expect(parseMoney(" 1.234,56 € ")).toBe(1234.56);
    expect(parseMoney("235,00&nbsp;€")).toBe(235);
    expect(parseMoney("ohne Preis")).toBe(null);
    expect(searchHits(searchHtml(3))).toBe(3);
    expect(searchHits("<!-- class=\"card product-box --> nichts")).toBe(0);
    expect(parseCart(cartHtml([{ id: "a", price: "12,00 €" }, { id: "b", price: "235,00 €" }]), "b")).toEqual({ hasProduct: true, price: 235, empty: false });
    expect(parseCart(cartHtml([]), "b")).toEqual({ hasProduct: false, price: null, empty: true });
    expect(isLoginPage(loginHtml)).toBe(true);
    expect(isLoginPage("<form action=\"/checkout/order\"></form>")).toBe(false);
  });
});

describe("Gast-Sitzung", () => {
  it("merkt sich Cookies über Weiterleitungen und sperrt Bestellung, Konto und Anmeldung", async () => {
    const shop = fakeShop();
    const s = new StorefrontSession(BASE, shop.fetchImpl as any);
    await s.get("/");
    expect(s.hasCookie("session-")).toBe(true);
    const add = await s.post("/checkout/line-item/add", { "lineItems[abc][id]": "abc" });
    expect(add).toMatchObject({ status: 302, location: "/checkout/cart" });
    expect(s.cookieHeader).toContain("sw-states=cart-filled");
    const cart = await s.get("/checkout/cart");
    expect(parseCart(cart.html, "abc").hasProduct).toBe(true);
    // Weiterleitung folgen: Kasse → Anmeldung (mit derselben Sitzung)
    expect((await s.get("/checkout/confirm")).html).toBe(loginHtml);
    await expect(s.post("/checkout/order", {})).rejects.toThrow(/gesperrt/);
    await expect(s.post("/account/register", {})).rejects.toThrow(/gesperrt/);
    await expect(s.post("/account/login", {})).rejects.toThrow(/gesperrt/);
  });
});

describe("Produktseiten reihum", () => {
  // 10 Artikel mit fallendem Umsatz: A–C = 50 % (Top-Gruppe), bis H = 80 %
  const revenue = new Map(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((n, i) => [n, [30, 12, 10, 8, 7, 6, 5, 4, 10, 8][i]]));
  revenue.set("I", 3);
  revenue.set("J", 2);

  it("Kandidaten: nur kaufbare Topseller, keine Varianten, Hauptartikel mit Varianten oder technische Artikel", () => {
    const products = [
      product("A"),
      product("B", { isVariant: true }),
      product("C", { childCount: 3 }),
      product("D", { isTechnical: true }),
      product("E"),
      product("F", { salesChannelIds: [] }),
      product("G", { id: undefined }),
      product("I"), // kein Topseller (jenseits von 80 %)
      product("J", { active: false }),
    ];
    const c = pageCandidates(products, revenue);
    expect(c.map((x) => [x.productNumber, x.group])).toEqual([["A", "top"], ["E", "rest"]]);
  });

  it("Auswahl: erst fehlerhafte, dann je Gruppe reihum, Zeiger laufen um", () => {
    const c = pageCandidates(["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => product(n)), revenue);
    expect(c.filter((x) => x.group === "top").map((x) => x.productNumber)).toEqual(["A", "B", "C"]);
    let state: StorefrontState = {};
    const seen: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const r = pickPages(c, state);
      seen.push(r.picks.map((p) => p.productNumber));
      state = { ...state, cursorTop: r.cursorTop, cursorRest: r.cursorRest };
    }
    // Top-Gruppe A–C je 2, übrige D–F (G, H jenseits von 80 %) je 3
    expect(seen).toEqual([["A", "B", "D", "E", "F"], ["C", "A", "D", "E", "F"], ["B", "C", "D", "E", "F"]]);
    const r = pickPages(c, { ...state, pages: { E: { at: "x", ok: false, problem: "status" } } });
    expect(r.picks.map((p) => p.productNumber)).toEqual(["E", "A", "B", "D", "F"]);
  });

  it("Prüfung: Status nach Wiederholung gut, Preis per Admin-API bestätigt, echte Fehler bleiben", async () => {
    const cands = pageCandidates(["A", "B", "C", "D", "E"].map((n) => product(n)), revenue) as PageCandidate[];
    const page = (n: string, over: Parameters<typeof productHtml>[0] extends infer T ? Partial<T> : never = {}) => ({ status: 200, html: productHtml({ id: id(n), number: n, ...over }) });
    const shop = fakeShop({
      pages: {
        "/a-seo": [{ status: 503 }, page("A")],
        [`/detail/${id("B")}`]: [page("B", { price: 279.65 })], // brutto passt auch
        [`/detail/${id("C")}`]: [page("C", { price: 199 })], // Spiegel veraltet, API sagt 199 netto
        [`/detail/${id("D")}`]: [page("D", { price: 99 })], // falscher Preis
        [`/detail/${id("E")}`]: [page("E", { buy: false })],
      },
    });
    const apiCalls: string[] = [];
    const api = fakeApi({ seo: { [id("A")]: "a-seo" }, prices: { [id("C")]: { net: 199, gross: 236.81 }, [id("D")]: { net: 235, gross: 279.65 } }, calls: apiCalls });
    const res = await checkProductPages(shopOf(shop.fetchImpl as any, api), cands, new Date("2026-10-19T08:00:00Z"));
    expect(Object.fromEntries(Array.from(res.entries()).map(([k, v]) => [k, v.ok ? "ok" : v.problem]))).toEqual({ A: "ok", B: "ok", C: "ok", D: "price", E: "noBuyButton" });
    expect(res.get("D")).toMatchObject({ shown: 99, expected: 235 });
    expect(res.get("A")?.url).toBe(`${BASE}/a-seo`);
    expect(shop.calls.filter((c) => c === "GET /a-seo")).toHaveLength(2);
    expect(apiCalls).toEqual(["POST search/seo-url", "POST search/product", "POST search/product"]);
    // nie parallel: Abrufe streng nacheinander (keine Überlappung messbar, aber Reihenfolge = Liste)
    expect(shop.calls.filter((c) => c.startsWith("GET /")).map((c) => c.slice(4, 10))).toEqual(["/a-seo", "/a-seo", "/detai", "/detai", "/detai", "/detai"]);

    const d = productPageDetections(cands, Object.fromEntries(res));
    expect(d.map((x) => [x.key, x.code, x.severity])).toEqual([
      ["buyability:page:D", "productPagePrice", "critical"],
      ["buyability:page:E", "productPageNoBuyButton", "critical"],
    ]);
    expect(d[0].params).toMatchObject({ number: "D", shown: 99, expected: 235, revenue: 8 });
  });

  it("Shop antwortet gar nicht: kein Fund je Artikel, sondern Lauf gescheitert", async () => {
    const cands = pageCandidates(["A", "B", "D"].map((n) => product(n)), revenue);
    const shop = fakeShop({ pages: Object.fromEntries(cands.map((c) => [`/detail/${c.id}`, [{ status: 502 }]])) });
    await expect(checkProductPages(shopOf(shop.fetchImpl as any), cands, new Date())).rejects.toThrow(/nicht erreichbar/);
  });
});

describe("Warenkorb-Probe", () => {
  const P = { id: id("A") };

  it("Durchlauf: Start, Suche, Warenkorb, Kasse → Anmeldung; Position wieder entfernt, nie bestellt", async () => {
    const shop = fakeShop();
    const r = await runCartProbe(new StorefrontSession(BASE, shop.fetchImpl as any), P);
    expect(r).toEqual({ ok: true, hits: 24, price: 235 });
    expect(shop.calls).toEqual([
      "GET /",
      "GET /search?search=Fachbodenregal",
      "POST /checkout/line-item/add",
      "GET /checkout/cart",
      "GET /checkout/confirm",
      "GET /checkout/register",
      `POST /checkout/line-item/delete/${P.id}`,
    ]);
    expect(Array.from(shop.carts.values()).flat()).toEqual([]);
    expect(shop.calls.some((c) => /checkout\/order|account\/register|account\/login/.test(c))).toBe(false);
  });

  it.each([
    [{ home: 503 }, { step: "home", status: 503 }],
    [{ searchHits: 0 }, { step: "search", reason: "noHits" }],
    [{ addStatus: 500 }, { step: "add", status: 500 }],
    [{ cartDropsItem: true }, { step: "cart", reason: "missing" }],
    [{ cartPrice: "–" }, { step: "cart", reason: "noPrice" }],
    [{ confirm: { status: 200 } }, { step: "checkout", reason: "noRedirect" }],
    [{ register: "<p>Fehler</p>" }, { step: "checkout", reason: "noLogin" }],
    [{ throwOn: "/checkout/cart" }, { step: "cart", status: 0, reason: "timeout" }],
  ] as Array<[ShopBehaviour, Record<string, unknown>]>)("scheitert mit Schritt: %o", async (behaviour, expected) => {
    const shop = fakeShop(behaviour);
    const r = await runCartProbe(new StorefrontSession(BASE, shop.fetchImpl as any), P);
    expect(r).toMatchObject({ ok: false, ...expected });
    // nach dem Hinzufügen wird immer aufgeräumt
    if (["cart", "checkout"].includes(String(expected.step))) expect(shop.calls.at(-1)).toBe(`POST /checkout/line-item/delete/${P.id}`);
  });

  it("Takt: alle 30 Minuten zwischen 6 und 22 Uhr Berlin, nach Aussetzen oder Fehler gleich wieder", () => {
    const at = (iso: string) => new Date(iso);
    expect(isCartProbeDue(undefined, at("2026-10-19T04:30:00Z"))).toBe(true); // 6:30
    expect(isCartProbeDue(undefined, at("2026-10-19T03:59:00Z"))).toBe(false); // 5:59
    expect(isCartProbeDue(undefined, at("2026-10-19T20:00:00Z"))).toBe(false); // 22:00
    const prev = { at: "2026-10-19T08:00:00.000Z", ok: true, findings: 0 };
    expect(isCartProbeDue(prev, at("2026-10-19T08:15:00Z"))).toBe(false);
    expect(isCartProbeDue(prev, at("2026-10-19T08:30:00Z"))).toBe(true);
    expect(isCartProbeDue({ ...prev, skipped: "busy" }, at("2026-10-19T08:15:00Z"))).toBe(true);
    expect(isCartProbeDue({ ...prev, ok: false }, at("2026-10-19T08:15:00Z"))).toBe(true);
  });

  it("Fund erst ab dem zweiten Fehlschlag, Bestell-Lücke wird bei roter Probe kritisch", () => {
    const last = { at: "x", product: "A", ms: 1, ok: false as const, step: "add" as const, status: 500, reason: "status" };
    expect(cartProbeDetections({ failures: 1, last })).toEqual([]);
    expect(cartProbeDetections({ failures: 2, last }, 340)).toEqual([
      expect.objectContaining({ key: CART_PROBE_KEY, code: "cartProbeAdd", severity: "critical", params: expect.objectContaining({ failures: 2, response: "HTTP 500", number: "A" }), lossPerHour: 340 }),
    ]);
    const gap = { key: "revenue:order-gap", source: "revenue" as const, code: "orderGap" as const, severity: "warning" as const, params: { expected: 4 } };
    expect(confirmOrderGap([gap], false)).toEqual([gap]);
    expect(confirmOrderGap([gap], true)[0]).toMatchObject({ key: "revenue:order-gap", code: "orderGapConfirmed", severity: "critical" });
  });
});

describe("Läufe über den Zeitplan", () => {
  function setup(behaviour: ShopBehaviour = {}) {
    const settings = new Map<string, any>();
    const k = (key: string, t?: string | null) => `${t ?? "_"}:${key}`;
    const rows: ShopPulseSignal[] = [];
    let now = new Date("2026-10-19T08:00:00Z"); // Montag, 10:00 Berlin
    let shop = fakeShop(behaviour);
    let orders: PulseOrder[] = [];
    const products = ["A", "B", "C"].map((n) => product(n));
    const revenue = new Map([["A", 100], ["B", 50], ["C", 10]]);
    const tenantId = "t-storefront";
    const access: StorefrontAccess = { withShop: (fn) => withShopLock(tenantId, () => fn(shopOf(shop.fetchImpl as any))) };
    const deps: ShopPulseDeps = {
      storage: {
        getSetting: async (key: string, t?: string | null) => structuredClone(settings.get(k(key, t))),
        saveSetting: async (key: string, value: any, t?: string | null) => void settings.set(k(key, t), structuredClone(value)),
        getUsersWithPermissionInTenant: async () => [],
        createNotification: async (n: any) => n,
        getShopwareSyncState: async () => undefined,
      } as any,
      repo: {
        listSignalsBySources: async (_t: string | null, sources: string[]) => structuredClone(rows.filter((r) => sources.includes(r.source))),
        listOpenSignals: async () => structuredClone(rows.filter((r) => r.status === "open")),
        applyReconcile: async (_t: string | null, result: ReconcileResult) => {
          rows.push(...structuredClone(result.inserts));
          for (const u of result.updates) Object.assign(rows.find((r) => r.id === u.id)!, structuredClone(u.patch));
        },
      },
      detectors: [orderGapDetector, productPagesDetector, cartProbeDetector],
      loadOrders: async () => orders,
      loadBuyability: () => ({
        products: async () => products,
        revenue: async () => revenue,
        priceChanges: async () => [],
        channelMethods: async () => ({ payment: [], shipping: [] }),
      }),
      loadStorefront: () => access,
      onNotificationCreated: () => undefined,
      baseUrl: null,
      now: () => now,
      newId: (() => {
        let i = 0;
        return () => `id${++i}`;
      })(),
    };
    settings.set(k(SHOP_PULSE_SETTINGS_KEY, tenantId), { enabled: true, learningUntil: "2026-10-01T00:00:00Z", teamsWebhookUrl: "" });
    const pages = Object.fromEntries(products.map((p) => [`/detail/${p.id}`, [{ status: 200, html: productHtml({ id: p.id!, number: p.productNumber }) }]]));
    return {
      deps,
      rows,
      tenantId,
      pages,
      run: (o: { at?: string; behaviour?: ShopBehaviour; force?: boolean } = {}) => {
        if (o.at) now = new Date(o.at);
        if (o.behaviour) shop = fakeShop({ pages, ...o.behaviour });
        return runShopPulseForTenant(deps, tenantId, { force: o.force });
      },
      state: () => settings.get(k(STOREFRONT_STATE_KEY, tenantId)) as StorefrontState,
      shopCalls: () => shop.calls,
      setOrders: (o: PulseOrder[]) => (orders = o),
    };
  }

  it("Probe rot erst beim zweiten Fehlschlag, Entwarnung bei Erfolg; Produktseiten jeden Takt", async () => {
    const t = setup();
    // 10:00: alles gut (3 Produktseiten, Probe)
    let r = await t.run({ behaviour: {} });
    expect(r?.detectors.productPages).toMatchObject({ ok: true, findings: 0 });
    expect(r?.detectors.cartProbe).toMatchObject({ ok: true, findings: 0 });
    // Topseller A und B (C liegt jenseits von 80 % des Umsatzes)
    expect(t.shopCalls().filter((c) => c.startsWith("GET /detail/"))).toHaveLength(2);
    expect(t.state().cart).toMatchObject({ failures: 0 });

    // 10:30: Hinzufügen scheitert – erster Fehlschlag, noch kein Fund
    r = await t.run({ at: "2026-10-19T08:30:00Z", behaviour: { addStatus: 500 } });
    expect(t.state().cart).toMatchObject({ failures: 1, firstFailureAt: "2026-10-19T08:30:00.000Z" });
    expect(t.rows).toEqual([]);

    // 10:45: Probe nicht fällig, keine Storefront-Abrufe für den Warenkorb
    r = await t.run({ at: "2026-10-19T08:45:00Z", behaviour: { addStatus: 500 } });
    expect(r?.detectors.cartProbe?.at).toBe("2026-10-19T08:30:00.000Z");
    expect(t.shopCalls().some((c) => c.includes("line-item"))).toBe(false);

    // 11:00: zweiter Fehlschlag → kritisch, mit Schritt
    r = await t.run({ at: "2026-10-19T09:00:00Z", behaviour: { addStatus: 500 } });
    expect(t.rows.map((x) => [x.key, x.code, x.severity, x.status])).toEqual([[CART_PROBE_KEY, "cartProbeAdd", "critical", "open"]]);
    expect(r?.notices.map((n) => n.kind)).toEqual(["new"]);

    // 11:15: nicht fällig – Meldung bleibt offen
    await t.run({ at: "2026-10-19T09:15:00Z", behaviour: {} });
    expect(t.rows[0].status).toBe("open");

    // 11:30: Probe klappt wieder → erledigt und Entwarnung
    r = await t.run({ at: "2026-10-19T09:30:00Z", behaviour: {} });
    expect(t.rows[0].status).toBe("resolved");
    expect(r?.notices.map((n) => n.kind)).toEqual(["resolved"]);
    expect(t.state().cart).toMatchObject({ failures: 0, lastOkAt: "2026-10-19T09:30:00.000Z" });
  });

  it("nachts keine Probe, „Jetzt prüfen“ schon", async () => {
    const t = setup();
    let r = await t.run({ at: "2026-10-19T21:00:00Z", behaviour: {} }); // 23:00
    expect(r?.detectors.cartProbe).toBeUndefined();
    r = await t.run({ at: "2026-10-19T21:15:00Z", behaviour: {}, force: true });
    expect(r?.detectors.cartProbe).toMatchObject({ ok: true });
  });

  it("Shop-Wächter fragt gerade ab: beide Storefront-Prüfungen setzen aus, offene Meldungen bleiben", async () => {
    const t = setup();
    await t.run({ at: "2026-10-19T08:00:00Z", behaviour: { searchHits: 0 } });
    await t.run({ at: "2026-10-19T08:30:00Z", behaviour: { searchHits: 0 } });
    expect(t.rows.map((x) => [x.code, x.status])).toEqual([["cartProbeSearch", "open"]]);
    let r: Awaited<ReturnType<typeof t.run>> = null;
    await withShopLock(t.tenantId, async () => {
      r = await t.run({ at: "2026-10-19T09:00:00Z", behaviour: {} });
    });
    expect(r!.detectors.cartProbe).toMatchObject({ ok: true, skipped: "busy" });
    expect(r!.detectors.productPages).toMatchObject({ ok: true, skipped: "busy" });
    expect(t.shopCalls()).toEqual([]);
    expect(t.rows[0].status).toBe("open");
    // nächster Takt: Probe gleich wieder (nicht erst nach 30 Minuten)
    r = await t.run({ at: "2026-10-19T09:15:00Z", behaviour: {} });
    expect(r!.detectors.cartProbe).toMatchObject({ ok: true, findings: 0 });
    expect(t.rows[0].status).toBe("resolved");
    await expect(withShopLock(t.tenantId, () => withShopLock(t.tenantId, async () => 1))).rejects.toBeInstanceOf(ShopBusyError);
  });

  it("Produktseite fehlerhaft: kritisch je Artikel, bleibt offen bis zur nächsten Prüfung, die passt", async () => {
    const t = setup();
    const bad = { ...t.pages, [`/detail/${id("B")}`]: [{ status: 200, html: productHtml({ id: id("B"), number: "B", buy: false }) }] };
    await t.run({ at: "2026-10-19T04:00:00Z", behaviour: { pages: bad } }); // 6:00
    expect(t.rows.map((x) => [x.key, x.code, x.severity])).toEqual([["buyability:page:B", "productPageNoBuyButton", "critical"]]);
    // nächster Takt prüft B zuerst erneut; jetzt in Ordnung → erledigt
    await t.run({ at: "2026-10-19T04:15:00Z", behaviour: {} });
    expect(t.rows[0].status).toBe("resolved");
    expect(t.state().pages?.B).toMatchObject({ ok: true });
  });

  it("rote Probe bestätigt die Bestell-Lücke: kritisch, auch in Takten ohne Probe", async () => {
    const t = setup();
    // An den 8 Vergleichs-Montagen je 4 Bestellungen vor 15 Uhr, heute keine
    const orders: PulseOrder[] = [];
    for (let w = 1; w <= 8; w++) {
      const day = new Date(Date.UTC(2026, 9, 19 - 7 * w)).toISOString().slice(0, 10);
      for (let h = 0; h < 4; h++) orders.push({ orderNumber: `MO${w}${h}`, createdAt: new Date(`${day}T0${7 + h}:00:00Z`), day, hour: 9 + h, total: 500, paymentMethod: "Vorkasse" });
    }
    t.setOrders(orders);
    await t.run({ at: "2026-10-19T13:00:00Z", behaviour: { home: 503 } }); // 15:00
    expect(t.rows.map((x) => [x.code, x.severity])).toEqual([["orderGap", "warning"]]);
    await t.run({ at: "2026-10-19T13:30:00Z", behaviour: { home: 503 } });
    const byKey = Object.fromEntries(t.rows.map((x) => [x.key, x]));
    expect(byKey["revenue:order-gap"]).toMatchObject({ code: "orderGapConfirmed", severity: "critical" });
    expect(byKey[CART_PROBE_KEY]).toMatchObject({ code: "cartProbeHome", severity: "critical", lossPerHour: 24 }); // 4 Montage × 4 × 500 € in 28 Tagen / 28 / 12
    // 15:45: Probe nicht fällig, aber noch rot → Lücke bleibt kritisch
    await t.run({ at: "2026-10-19T13:45:00Z", behaviour: { home: 503 } });
    expect(Object.fromEntries(t.rows.map((x) => [x.key, x.severity]))["revenue:order-gap"]).toBe("critical");
  });
});
