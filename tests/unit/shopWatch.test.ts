/**
 * Shop-Wächter: Prüfpunkte gegen einen simulierten Shop (Admin-API + Storefront), Soll-Stand,
 * Deploy-Fingerabdruck, Hilfsfunktionen für Seiten und Texte.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import {
  baselineFromRun,
  createShopWatchContext,
  diffFingerprint,
  runShopWatchChecks,
  themeAssetUrls,
} from "../../server/shopContent/shopWatch";
import {
  SHOP_WATCH_CHECKS,
  countFindings,
  descriptionHash,
  normalizeText,
  probeText,
  type ShopWatchCheckDef,
} from "../../server/shopContent/shopWatchChecks";
import { snippetEntryId, STOREFRONT_SNIPPETS } from "../../server/shopContent/shopEntityIds";
import { worstStatus, type ShopWatchBaseline } from "../../shared/shopWatch";

const SHOP = "https://shop.example";
const CHANNEL = "channel-de";
const check = (id: string) => SHOP_WATCH_CHECKS.find((c) => c.id === id)!;
const opts = { tenantId: "t1", live: true };

const HOME = `<html><head>
<link rel="stylesheet" href="${SHOP}/theme/abc123/css/all.css?1700000000">
<script src="${SHOP}/theme/abc123/js/dne-custom-css-js/dne-custom-css-js.js?1700000000"></script>
</head><body><div data-meta-quick-config-home></div><div class="mbp"><div class="ht-grid"></div></div>
<div data-mbp="rabatt"></div><div data-mbp="mondu"></div></body></html>`;

type Routes = Record<string, { status?: number; body?: string; location?: string }>;

function fakeFetch(routes: Routes) {
  return async (url: string, init?: RequestInit) => {
    const r = routes[url] ?? { status: 404, body: "" };
    const status = r.status ?? 200;
    if (r.location && init?.redirect !== "manual") {
      const target = routes[r.location.startsWith("http") ? r.location : `${SHOP}${r.location}`] ?? { body: "" };
      return new Response(target.body ?? "", { status: target.status ?? 200 });
    }
    return new Response(r.body ?? "", { status, headers: r.location ? { location: r.location } : {} });
  };
}

function fakeApi(handlers: Record<string, (body: any) => any>) {
  return async (method: string, path: string, body?: any) => {
    const h = handlers[`${method} ${path}`];
    if (!h) throw new Error(`unerwartet: ${method} ${path}`);
    return h(body);
  };
}

const ctxWith = (api: ReturnType<typeof fakeApi>, routes: Routes, baseline: ShopWatchBaseline | null = null, snippets: Record<string, { js: string; css: string }> = {}) =>
  createShopWatchContext({
    api,
    channelId: CHANNEL,
    storefront: SHOP,
    baseline,
    fetchImpl: fakeFetch(routes) as any,
    readSnippet: (file) => snippets[file] ?? null,
  });

describe("Hilfsfunktionen", () => {
  it("findet Theme-Dateien und den Deploy-Schlüssel in der Startseite", () => {
    expect(themeAssetUrls(HOME)).toEqual({
      js: `${SHOP}/theme/abc123/js/dne-custom-css-js/dne-custom-css-js.js?1700000000`,
      css: `${SHOP}/theme/abc123/css/all.css?1700000000`,
      key: "abc123?1700000000",
    });
    expect(themeAssetUrls("<html></html>").key).toBeNull();
  });

  it("Kennsatz: erstes Textstück ohne Tags, an der Wortgrenze gekürzt, Entities aufgelöst", () => {
    const html = '<div class="bg-light"><p class="fs-6">Hier finden Sie Anbauregale der Systeme META&nbsp;CLIP, CLIP SET und CLIP S3 für die Erweiterung.</p></div>';
    const probe = probeText(html)!;
    expect(probe).toBe("Hier finden Sie Anbauregale der Systeme META CLIP, CLIP SET");
    expect(normalizeText('<p class="fs-6 mb-3">Hier finden Sie Anbauregale der Systeme META CLIP, CLIP SET</p>')).toContain(probe);
    expect(probeText("<p>kurz</p>")).toBeNull();
  });

  it("Rückgang: bis 2 % still, darüber gelb, unter 80 % oder 0 rot, ohne Soll nichts", () => {
    expect(countFindings(undefined, 0)).toEqual([]);
    expect(countFindings(1000, 985)).toEqual([]);
    expect(countFindings(1000, 950)[0]).toMatchObject({ code: "countDropped", severity: "warn" });
    expect(countFindings(1000, 700)[0].severity).toBe("fail");
    expect(countFindings(1000, 0)[0].severity).toBe("fail");
  });

  it("Deploy-Fingerabdruck: Shopware-Version, Plugins und Theme getrennt gemeldet", () => {
    const before = { shopwareVersion: "6.7.14.2", plugins: ["A@1", "B@1"], themeAsset: "abc?1" };
    expect(diffFingerprint(undefined, before)).toEqual([]);
    expect(diffFingerprint(before, before)).toEqual([]);
    expect(diffFingerprint(before, { shopwareVersion: "6.7.15.0", plugins: ["A@2", "B@1"], themeAsset: "def?2" })).toEqual([
      { field: "shopwareVersion", before: "6.7.14.2", after: "6.7.15.0" },
      { field: "plugins", before: "A@1", after: "A@2" },
      { field: "themeAsset", before: "abc?1", after: "def?2" },
    ]);
  });

  it("schlimmster Status: fail vor error vor warn", () => {
    expect(worstStatus([])).toBe("ok");
    expect(worstStatus(["ok", "warn"])).toBe("warn");
    expect(worstStatus(["warn", "error"])).toBe("error");
    expect(worstStatus(["error", "fail", "ok"])).toBe("fail");
  });
});

describe("Prüfpunkte gegen einen simulierten Shop", () => {
  const snippet = STOREFRONT_SNIPPETS.find((s) => s.key === "metaorder-checkout-cross-selling")!;
  const source = { js: "/* js */ .meta-xsell", css: ".meta-xsell{}" };
  const themeRoutes = (js: string, css: string): Routes => ({
    [`${SHOP}/`]: { body: HOME },
    [`${SHOP}/theme/abc123/js/dne-custom-css-js/dne-custom-css-js.js?1700000000`]: { body: js },
    [`${SHOP}/theme/abc123/css/all.css?1700000000`]: { body: css },
  });
  const entryApi = (entry: any) =>
    fakeApi({ "POST search/dne-custom-js-css": (b) => ({ data: entry && b.ids.includes(snippetEntryId(snippet.key)) ? [entry] : [] }) });

  it("Baustein vorhanden, aktiv, Kanal, wie im Repo und im Theme ausgeliefert → ok", async () => {
    const api = entryApi({ id: snippetEntryId(snippet.key), active: true, salesChannels: [{ id: CHANNEL }], ...source });
    const ctx = ctxWith(api, themeRoutes(".meta-xsell", ".meta-xsell"), null, { [snippet.file]: source });
    const { results } = await runShopWatchChecks(ctx, [check(`snippet:${snippet.key}`)], opts);
    expect(results[0]).toMatchObject({ status: "ok", findings: [], group: "own", repair: { mode: "auto" } });
    expect(results[0].repair.command).toBe("NODE_ENV=development npx tsx scripts/writeCheckoutCrossSelling.ts t1 --apply --live");
  });

  it("Baustein nach Deploy weg: Eintrag fehlt und Theme liefert ihn nicht aus → rot", async () => {
    const ctx = ctxWith(entryApi(null), themeRoutes("", ""), null, { [snippet.file]: source });
    const { results } = await runShopWatchChecks(ctx, [check(`snippet:${snippet.key}`)], opts);
    expect(results[0].status).toBe("fail");
    expect(results[0].findings.map((f) => f.code)).toEqual(["entityMissing", "assetMarkerMissing", "assetMarkerMissing"]);
  });

  it("Baustein im Shop geändert oder deaktiviert: inaktiv rot, abweichender Inhalt gelb", async () => {
    const api = entryApi({ id: snippetEntryId(snippet.key), active: false, salesChannels: [], js: "anders", css: source.css });
    const ctx = ctxWith(api, themeRoutes(".meta-xsell", ".meta-xsell"), null, { [snippet.file]: source });
    const { results } = await runShopWatchChecks(ctx, [check(`snippet:${snippet.key}`)], opts);
    expect(results[0].findings.map((f) => [f.code, f.severity])).toEqual([
      ["entityInactive", "fail"],
      ["channelMissing", "fail"],
      ["differsFromRepo", "warn"],
    ]);
  });

  it("Startseiten-Abschnitt der Agentur: Kennzeichen fehlt im Layout und auf der Seite → rot, Reparatur per Knopf", async () => {
    const api = fakeApi({ "POST search/cms-slot": () => ({ data: [{ id: "s1", config: { content: { value: '<div class="meta-discount-banner">' } } }] }) });
    const ctx = ctxWith(api, { [`${SHOP}/`]: { body: "<html>Agentur-Original</html>" } });
    const { results } = await runShopWatchChecks(ctx, [check("home-section:rabatt")], opts);
    expect(results[0]).toMatchObject({ status: "fail", group: "agency", repair: { mode: "manual" } });
    expect(results[0].findings.map((f) => f.code)).toEqual(["pageMarkerMissing", "pageMarkerMissing"]);
  });

  it("Kategorietexte: Soll-Stand erkennt geleerte und geänderte Kategorien, Seite muss den Kennsatz zeigen", async () => {
    const intro = "<p>Hier finden Sie Grundregale der Systeme META CLIP und CLIP S3 in vielen Maßen.</p>";
    const category = (id: string, name: string, path: string, introHtml: string) => ({
      id,
      name,
      customFields: { meta_category_intro: introHtml, meta_category_seo_text: "<p>SEO</p>", meta_category_faq: "", meta_category_sidebar: "" },
      seoUrls: [{ seoPathInfo: path, isCanonical: true, isDeleted: false, languageId: "2fbb5fe2e29a4d70aa5854ce7ce3e20b", salesChannelId: CHANNEL }],
    });
    const api = fakeApi({
      "POST search/category": () => ({ data: [category("c1", "CLIP Grundregale", "clip-grundregale", intro), category("c2", "CLIP Zubehör", "clip-zubehoer", "<p>Geänderter Text der Agentur für das Zubehör im Shop.</p>")] }),
    });
    const first = await runShopWatchChecks(ctxWith(api, {}), [check("category:fields")], opts);
    const baseline: ShopWatchBaseline = { takenAt: "x", counts: {}, categoryFields: { ...first.categoryFields!, c2: "alt", c3: "weg" } };
    const routes: Routes = {
      [`${SHOP}/clip-grundregale`]: { body: `<div><p class="fs-6">${intro.replace(/<\/?p>/g, "")}</p></div>` },
      [`${SHOP}/clip-zubehoer`]: { body: "<div>ohne Text</div>" },
    };
    const { results } = await runShopWatchChecks(ctxWith(api, routes, baseline), [check("category:fields")], opts);
    expect(results[0].count).toBe(2);
    expect(results[0].findings.map((f) => [f.code, f.params?.n ?? f.params?.path])).toEqual([
      ["fieldsEmpty", 1],
      ["fieldsChanged", 1],
      ["pageTextMissing", "/clip-zubehoer"],
    ]);
  });

  it("Weiterleitung: falsches Ziel wird gemeldet, Hauptseiten müssen direkt antworten", async () => {
    const routes: Routes = {
      [`${SHOP}/facbodenregale-komplett`]: { status: 302, location: `${SHOP}/` },
      [`${SHOP}/fachbodenregale/`]: { body: "ok" },
      [`${SHOP}/palettenregale/`]: { body: "ok" },
      [`${SHOP}/kragarmregale/`]: { body: "ok" },
      [`${SHOP}/weitspannregale/`]: { body: "ok" },
      [`${SHOP}/bueroregale`]: { status: 301, location: "/irgendwo" },
    };
    const { results } = await runShopWatchChecks(ctxWith(fakeApi({}), routes), [check("seo:redirects")], opts);
    expect(results[0].findings.map((f) => [f.code, f.params?.path])).toEqual([
      ["pageStatus", "/bueroregale"],
      ["redirectWrong", "/facbodenregale-komplett"],
    ]);
  });

  it("Produktbeschreibungen: Service-Artikel ausgenommen, nur neue Überschreibungen gegenüber dem Soll gelb", async () => {
    const ours = "<p>Unser Text</p>";
    const rows = [
      { id: "1", productNumber: "A1", description: ours, customFields: { metaorder_description: { hash: descriptionHash(ours) } } },
      { id: "2", productNumber: "A2", description: "<p>Pimcore</p>", customFields: { metaorder_description: { hash: descriptionHash(ours) } } },
      { id: "3", productNumber: "SW1", description: "<p>Service neu</p>", customFields: { wdu_service_type: "forklift", metaorder_description: { hash: descriptionHash(ours) } } },
    ];
    const api = fakeApi({ "POST search/product": () => ({ data: rows }) });
    const first = await runShopWatchChecks(ctxWith(api, {}), [check("bulk:descriptions")], opts);
    expect(first.results[0]).toMatchObject({ status: "ok", count: 3, counts: { "bulk:descriptions:overwritten": 1 } });
    const baseline: ShopWatchBaseline = { takenAt: "x", counts: { "bulk:descriptions": 3, "bulk:descriptions:overwritten": 0 }, categoryFields: {} };
    const second = await runShopWatchChecks(ctxWith(api, {}, baseline), [check("bulk:descriptions")], opts);
    expect(second.results[0].findings).toEqual([{ code: "overwritten", severity: "warn", params: { n: 1, before: 0, numbers: "A2" } }]);
  });

  it("Plugins: fehlende Pflicht-Plugins rot, installiertes aber deaktiviertes MetaClipCpq rot", async () => {
    const api = fakeApi({
      "POST search/plugin": () => ({
        data: [
          { name: "DneCustomCssJs", version: "5", active: true },
          { name: "HuebertSeoFaq", version: "4", active: false },
          { name: "MoorlFoundation", version: "1", active: true },
          { name: "MetaClipCpq", version: "1.1.0", active: false },
        ],
      }),
    });
    const { results } = await runShopWatchChecks(ctxWith(api, {}), [check("platform:plugins")], opts);
    expect(results[0].findings.map((f) => `${f.code}:${f.params?.name}`)).toEqual([
      "pluginInactive:HuebertSeoFaq",
      "pluginMissing:SsikExtraElements",
      "pluginInactive:MetaClipCpq",
    ]);
  });

  it("Fehler in einer Prüfung (Netz, API) stoppt den Lauf nicht und wird Status error", async () => {
    const broken: ShopWatchCheckDef = { ...check("bulk:montage-tag"), run: async () => { throw new Error("502 Bad Gateway"); } };
    const { results } = await runShopWatchChecks(ctxWith(fakeApi({}), {}), [broken, check("platform:plugins")], opts);
    expect(results[0]).toMatchObject({ status: "error", findings: [{ code: "checkFailed", params: { message: "502 Bad Gateway" } }] });
    expect(results[1].status).toBe("error"); // search/plugin ist im simulierten Shop nicht vorhanden
    expect(results).toHaveLength(2);
  });
});

describe("Soll-Stand", () => {
  it("übernimmt Kennzahlen und Zusatz-Kennzahlen, ignoriert gescheiterte Prüfungen", () => {
    const base = { group: "bulk", kind: "imageTexts", label: "", repair: { mode: "none" }, findings: [], ms: 1 } as const;
    const baseline = baselineFromRun(
      {
        startedAt: "", finishedAt: "", trigger: "manual", shopUrl: SHOP, status: "ok", deployChanges: [],
        fingerprint: { shopwareVersion: null, plugins: [], themeAsset: null },
        results: [
          { ...base, id: "bulk:image-texts", status: "ok", count: 100 },
          { ...base, id: "bulk:cross-selling", status: "warn", count: 7, counts: { "bulk:cross-selling:Einzelteile": 7 } },
          { ...base, id: "bulk:montage-tag", status: "error", count: 0 },
        ],
        categoryFields: { c1: "f1" },
      },
      new Date("2026-10-17T12:00:00Z"),
    );
    expect(baseline).toEqual({
      takenAt: "2026-10-17T12:00:00.000Z",
      counts: { "bulk:image-texts": 100, "bulk:cross-selling": 7, "bulk:cross-selling:Einzelteile": 7 },
      categoryFields: { c1: "f1" },
    });
  });

  it("jeder Prüfpunkt hat eine eindeutige ID", () => {
    const ids = SHOP_WATCH_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
