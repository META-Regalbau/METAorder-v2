/**
 * Prüfkatalog des Shop-Wächters: je Inhalt, den METAorder in den Shop geschrieben hat, eine Prüfung über
 * die Admin-API (Entität da, aktiv, Kanal, Fingerabdruck) und über die Shop-Seite (Seite abrufen,
 * Kennzeichen suchen). Die Seitenprüfung findet auch Fälle, in denen die Daten noch da sind, ein neues
 * Theme oder Twig-Template sie aber nicht mehr anzeigt. Nur lesend; die Reparatur nennt das
 * Schreibskript, das den Inhalt wieder einspielt.
 *
 * Neue Live-Schreibläufe gehören hier als Prüfpunkt dazu.
 */
import { createHash } from "crypto";
import type {
  ShopWatchBaseline,
  ShopWatchFinding,
  ShopWatchGroup,
  ShopWatchKind,
  ShopWatchRepair,
} from "@shared/shopWatch";
import { INDUSTRY_PAGES } from "../products/industryPages";
import { HOME_SECTION_IDS, HOME_SECTION_MARKERS } from "../products/homeSections";
import { CATEGORY_CONTENT_FIELDS } from "../products/categoryPageHtml";
import { DEFAULT_MANAGED_CROSS_SELLING_GROUP_NAME } from "@shared/schema";
import { industryEntityId, quickConfigId, snippetEntryId, STOREFRONT_SNIPPETS, type StorefrontSnippetDef } from "./shopEntityIds";
import { EXIT_INTENT_CODE, EXIT_INTENT_IDS, EXIT_INTENT_PROMOTION_NAME, EXIT_INTENT_RULE_NAME } from "./exitIntentPromotion";
import { DE_LANG, type ShopApi } from "./shopProducts";

export type ShopPage = { status: number; html: string; location: string | null };
export type ThemeAssets = { js: string; css: string; key: string | null };
export type ShopPlugin = { name: string; version: string; active: boolean };

export type ShopWatchContext = {
  api: ShopApi;
  channelId: string;
  /** Storefront-Adresse des DE-Kanals ohne Schrägstrich am Ende */
  storefront: string;
  /** Seite der Storefront (Pfad mit führendem /), Ergebnis je Lauf gemerkt; redirect "manual" für Weiterleitungen */
  page(path: string, opts?: { redirect?: "follow" | "manual" }): Promise<ShopPage>;
  /** Beliebige Adresse (z. B. Medium), nur Status */
  status(url: string): Promise<number>;
  /** Kompiliertes Theme-JS des Plugins „Eigenes CSS/JS“ und all.css, aus der Startseite ermittelt */
  themeAssets(): Promise<ThemeAssets>;
  plugins(): Promise<ShopPlugin[]>;
  /** Quelle eines Storefront-Bausteins aus dem Repo (shopware/storefront-snippets), null wenn nicht vorhanden */
  snippetSource(file: string): { js: string; css: string } | null;
  baseline: ShopWatchBaseline | null;
};

export type CheckOutcome = {
  findings: ShopWatchFinding[];
  count?: number;
  /** Weitere Kennzahlen für den Soll-Stand (Schlüssel wie ctx.baseline.counts) */
  counts?: Record<string, number>;
  /** Fingerabdrücke der Kategorie-Felder für den Soll-Stand */
  categoryFields?: Record<string, string>;
};

export type ShopWatchCheckDef = {
  id: string;
  group: ShopWatchGroup;
  kind: ShopWatchKind;
  label: string;
  url?: string;
  /** hourly: bei jeder Prüfung; daily: Massendaten, einmal am Tag (Zeitplan folgt) */
  cadence: "hourly" | "daily";
  repair: (opts: { tenantId: string; live: boolean }) => ShopWatchRepair;
  run(ctx: ShopWatchContext): Promise<CheckOutcome>;
};

/** Gleiche IDs in Live und Testshop (Testshop ist ein Klon von Live) */
export const TOPSELLER_SORTING_ID = "018ec1340d2f727f8ab83f4c6c0c2a21";
export const REQUIRED_PLUGINS = ["DneCustomCssJs", "HuebertSeoFaq", "MoorlFoundation", "SsikExtraElements"] as const;
/** Optionale Plugins: wenn installiert, müssen sie aktiv sein */
export const OPTIONAL_PLUGINS = ["MetaClipCpq"] as const;
export const MANAGED_CROSS_SELLING_NAMES = [DEFAULT_MANAGED_CROSS_SELLING_GROUP_NAME, "Regal erweitern", "Einzelteile", "Auch erhältlich in"];
export const MAIN_LANDING_URLS = ["/fachbodenregale/", "/palettenregale/", "/kragarmregale/", "/weitspannregale/", "/bueroregale"];
export const REDIRECTS = [{ from: "/facbodenregale-komplett", to: "/clip-komplettregale" }];
/** Liste, an der Sortierung und Filter geprüft werden (Layout „Fachbodenregale“) */
export const LISTING_SAMPLE_URL = "/clip-grundregale";
/** Erlaubter Rückgang von Massendaten gegenüber dem Soll-Stand, bevor gemeldet wird */
export const COUNT_TOLERANCE = 0.02;

const cmd = (script: string, args: string, o: { tenantId: string; live: boolean }) =>
  `NODE_ENV=development npx tsx scripts/${script} ${o.tenantId} ${args}${o.live ? " --live" : ""}`.replace(/\s+/g, " ").trim();

const fail = (code: ShopWatchFinding["code"], params?: ShopWatchFinding["params"]): ShopWatchFinding => ({ code, severity: "fail", params });
const warn = (code: ShopWatchFinding["code"], params?: ShopWatchFinding["params"]): ShopWatchFinding => ({ code, severity: "warn", params });

async function byIds(api: ShopApi, entity: string, ids: string[], extra: Record<string, unknown> = {}): Promise<Map<string, any>> {
  const res = await api("POST", `search/${entity}`, { ids, limit: ids.length, ...extra });
  return new Map((res?.data ?? []).map((row: any) => [row.id, row]));
}

async function total(api: ShopApi, entity: string, filter: unknown[]): Promise<number> {
  const res = await api("POST", `search/${entity}`, { limit: 1, filter, "total-count-mode": 1, includes: { [entity.replace(/-/g, "_")]: ["id"] } });
  return Number(res?.meta?.total ?? res?.total ?? 0);
}

const notNull = (field: string) => ({ type: "not", operator: "and", queries: [{ type: "equals", field, value: null }] });

/** Alle Zeilen einer Suche seitenweise (Massendaten) */
async function searchAll(api: ShopApi, entity: string, body: Record<string, unknown>, pageSize = 500): Promise<any[]> {
  const rows: any[] = [];
  for (let page = 1; page < 200; page++) {
    const res = await api("POST", `search/${entity}`, { ...body, limit: pageSize, page });
    const data = res?.data ?? [];
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

/** Seite abrufen und Kennzeichen suchen */
export async function checkPage(ctx: ShopWatchContext, path: string, markers: string[]): Promise<ShopWatchFinding[]> {
  const page = await ctx.page(path);
  if (page.status !== 200) return [fail("pageStatus", { path, status: page.status })];
  return markers.filter((m) => !page.html.includes(m)).map((marker) => fail("pageMarkerMissing", { path, marker }));
}

/** Rückgang gegenüber dem Soll-Stand (ohne Soll-Stand nichts) */
export function countFindings(baseline: number | undefined, current: number, tolerance = COUNT_TOLERANCE): ShopWatchFinding[] {
  if (baseline === undefined || baseline <= 0) return [];
  if (current >= baseline * (1 - tolerance)) return [];
  return [{ code: "countDropped", severity: current === 0 ? "fail" : current < baseline * 0.8 ? "fail" : "warn", params: { before: baseline, after: current } }];
}

/** Entities aufgelöst, Leerraum zusammengefasst, Tags bleiben – für die Suche eines Kennsatzes in einer Seite */
export function normalizeText(html: string): string {
  return html
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ");
}

/**
 * Kennsatz aus einem Feldinhalt: erstes Textstück ohne eingebettete Tags (mind. 25 Zeichen), höchstens
 * ~60 Zeichen bis zur Wortgrenze. Ohne Tags, damit er unverändert im HTML der Seite steht.
 */
export function probeText(html: string): string | null {
  const piece = html
    .split(/<[^>]*>/)
    .map((t) => normalizeText(t).trim())
    .find((t) => t.length >= 25);
  if (!piece) return null;
  const cut = piece.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return (piece.length > 60 && lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim();
}

const fingerprint = (values: unknown[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 16);
/** Fingerabdruck wie scripts/writeProductDescriptions.ts (Markierung metaorder_description.hash) */
export const descriptionHash = (html: string) => createHash("sha256").update(html).digest("hex").slice(0, 16);

function snippetCheck(def: StorefrontSnippetDef): ShopWatchCheckDef {
  return {
    id: `snippet:${def.key}`,
    group: "own",
    kind: "snippet",
    label: def.name.replace(/^METAorder:\s*/, ""),
    cadence: "hourly",
    repair: (o) => ({ mode: "auto", command: cmd(def.script, "--apply", o) }),
    async run(ctx) {
      const findings: ShopWatchFinding[] = [];
      const entry = (await byIds(ctx.api, "dne-custom-js-css", [snippetEntryId(def.key)], { associations: { salesChannels: {} } })).get(snippetEntryId(def.key));
      if (!entry) findings.push(fail("entityMissing", { entity: "Eigenes CSS/JS", name: def.name }));
      else {
        if (!entry.active) findings.push(fail("entityInactive", { entity: "Eigenes CSS/JS", name: def.name }));
        if (!(entry.salesChannels ?? []).some((s: { id: string }) => s.id === ctx.channelId)) findings.push(fail("channelMissing", { name: def.name }));
        const source = ctx.snippetSource(def.file);
        if (source && ((entry.js ?? "") !== source.js || (entry.css ?? "") !== source.css)) findings.push(warn("differsFromRepo", { name: def.name }));
      }
      const assets = await ctx.themeAssets();
      if (!assets.js.includes(def.marker)) findings.push(fail("assetMarkerMissing", { asset: "JS", marker: def.marker }));
      if (!assets.css.includes(def.marker)) findings.push(fail("assetMarkerMissing", { asset: "CSS", marker: def.marker }));
      return { findings };
    },
  };
}

async function entityFindings(api: ShopApi, entity: string, label: string, id: string, name: string, needsActive = false): Promise<ShopWatchFinding[]> {
  const row = (await byIds(api, entity, [id])).get(id);
  if (!row) return [fail("entityMissing", { entity: label, name })];
  if (needsActive && row.active === false) return [fail("entityInactive", { entity: label, name })];
  return [];
}

const quickConfigPage: ShopWatchCheckDef = {
  id: "quick-config:page",
  group: "own",
  kind: "quickConfigPage",
  label: "/regal-schnellkonfigurator",
  url: "/regal-schnellkonfigurator",
  cadence: "hourly",
  repair: (o) => ({ mode: "auto", command: cmd("writeQuickConfiguratorPage.ts", "--apply", o) }),
  async run(ctx) {
    const findings = [
      ...(await entityFindings(ctx.api, "landing-page", "Landingpage", quickConfigId("lp"), "Regal-Schnellkonfigurator", true)),
      ...(await entityFindings(ctx.api, "cms-page", "Erlebniswelt", quickConfigId("cms"), "Regal-Schnellkonfigurator")),
      ...(await entityFindings(ctx.api, "media", "Medium", quickConfigId("catalog"), "Artikeltabelle")),
    ];
    const pageFindings = await checkPage(ctx, "/regal-schnellkonfigurator", ["data-meta-quick-config"]);
    findings.push(...pageFindings);
    if (!pageFindings.length) {
      const catalog = (await ctx.page("/regal-schnellkonfigurator")).html.match(/data-catalog="([^"]+)"/)?.[1];
      if (!catalog) findings.push(fail("pageMarkerMissing", { path: "/regal-schnellkonfigurator", marker: "data-catalog" }));
      else {
        const status = await ctx.status(catalog.replace(/&amp;/g, "&"));
        if (status !== 200) findings.push(fail("pageStatus", { path: "Artikeltabelle", status }));
      }
    }
    return { findings };
  },
};

const quickConfigHome: ShopWatchCheckDef = {
  id: "quick-config:home",
  group: "own",
  kind: "quickConfigHome",
  label: "Startseite",
  url: "/",
  cadence: "hourly",
  repair: (o) => ({ mode: "auto", command: cmd("writeQuickConfiguratorPage.ts", "--home --apply", o) }),
  async run(ctx) {
    return {
      findings: [
        ...(await entityFindings(ctx.api, "cms-section", "Abschnitt", quickConfigId("home-section"), "Schnellkonfigurator Startseite")),
        ...(await checkPage(ctx, "/", ["data-meta-quick-config-home"])),
      ],
    };
  },
};

const industryPageChecks: ShopWatchCheckDef[] = INDUSTRY_PAGES.map((page) => ({
  id: `industry:${page.key}`,
  group: "own",
  kind: "industryPage",
  label: page.url,
  url: page.url,
  cadence: "hourly",
  repair: (o) => ({ mode: "auto", command: cmd("writeIndustryPages.ts", "--apply", o) }),
  async run(ctx) {
    return {
      findings: [
        ...(await entityFindings(ctx.api, "landing-page", "Landingpage", industryEntityId(page.key, "lp"), page.url, true)),
        ...(await entityFindings(ctx.api, "hueb-seo-faq-group", "FAQ-Gruppe", industryEntityId(page.key, "faq"), page.url)),
        ...(await checkPage(ctx, page.url, ['class="mbp"', "hueb-faq-element"])),
      ],
    };
  },
}));

const industryHome: ShopWatchCheckDef = {
  id: "industry:home",
  group: "own",
  kind: "industryHome",
  label: "Startseite",
  url: "/",
  cadence: "hourly",
  repair: (o) => ({ mode: "auto", command: cmd("writeIndustryPages.ts", "--home --apply", o) }),
  async run(ctx) {
    return {
      findings: [
        ...(await entityFindings(ctx.api, "cms-section", "Abschnitt", industryEntityId("home", "section"), "Branchen-Teaser")),
        ...(await checkPage(ctx, "/", ["ht-grid"])),
      ],
    };
  },
};

const homeSectionChecks: ShopWatchCheckDef[] = (["rabatt", "mondu"] as const).map((key) => ({
  id: `home-section:${key}`,
  group: "agency",
  kind: "homeSection",
  label: key === "rabatt" ? "Rabattstaffel" : "Mondu",
  url: "/",
  cadence: "hourly",
  repair: (o) => ({ mode: "manual", command: cmd("writeIndustryPages.ts", "--home-sections --apply", o) }),
  async run(ctx) {
    const sectionId = HOME_SECTION_IDS[key];
    const own = HOME_SECTION_MARKERS[key].own;
    const findings: ShopWatchFinding[] = [];
    const slots = await ctx.api("POST", "search/cms-slot", {
      limit: 20,
      filter: [{ type: "equals", field: "block.sectionId", value: sectionId }],
      includes: { cms_slot: ["id", "config", "translated"] },
    });
    const rows: any[] = slots?.data ?? [];
    if (!rows.length) findings.push(fail("entityMissing", { entity: "Abschnitt", name: key === "rabatt" ? "Rabattstaffel" : "Mondu" }));
    else if (!rows.some((s) => JSON.stringify(s.translated?.config ?? s.config ?? {}).includes(own.replace(/"/g, '\\"')))) {
      findings.push(fail("pageMarkerMissing", { path: "Erlebniswelt Startseite", marker: own }));
    }
    findings.push(...(await checkPage(ctx, "/", [own])));
    return { findings };
  },
}));

const categoryFields: ShopWatchCheckDef = {
  id: "category:fields",
  group: "agency",
  kind: "categoryFields",
  label: "Einleitung, SEO-Text, FAQ, Seitenleiste",
  cadence: "hourly",
  repair: (o) => ({ mode: "manual", command: cmd("writeCategoryContent.ts", "Kategorietexte-Live-2026-10-15.xlsx --apply", o) }),
  async run(ctx) {
    const fields = Object.values(CATEGORY_CONTENT_FIELDS);
    const rows = await searchAll(ctx.api, "category", {
      filter: [{ type: "multi", operator: "or", queries: fields.map((f) => notNull(`customFields.${f}`)) }],
      associations: { seoUrls: { filter: [{ type: "equals", field: "salesChannelId", value: ctx.channelId }] } },
      includes: {
        category: ["id", "name", "translated", "customFields", "seoUrls"],
        seo_url: ["seoPathInfo", "isCanonical", "isDeleted", "languageId", "salesChannelId"],
      },
    }, 100);
    const current: Record<string, string> = {};
    const names = new Map<string, string>();
    for (const row of rows) {
      const cf = row.translated?.customFields ?? row.customFields ?? {};
      const values = fields.map((f) => (typeof cf[f] === "string" ? cf[f] : ""));
      if (values.every((v) => !v.trim())) continue;
      current[row.id] = fingerprint(values);
      names.set(row.id, row.translated?.name ?? row.name ?? row.id);
    }
    const findings: ShopWatchFinding[] = [];
    const base = ctx.baseline?.categoryFields;
    if (base) {
      const missing = Object.keys(base).filter((id) => !current[id]);
      const changed = Object.keys(base).filter((id) => current[id] && current[id] !== base[id]);
      if (missing.length) findings.push(fail("fieldsEmpty", { n: missing.length, ids: missing.slice(0, 5).join(", ") }));
      if (changed.length) findings.push(warn("fieldsChanged", { n: changed.length, names: changed.slice(0, 5).map((id) => names.get(id) ?? id).join(", ") }));
    }
    // Anzeige: Kennsatz der Einleitung muss auf der Kategorieseite stehen (Layoutblöcke vorhanden, Theme zeigt sie)
    const samples = rows
      .filter((r) => current[r.id])
      .map((r) => ({
        name: r.translated?.name ?? r.name,
        path: (r.seoUrls ?? []).find((u: any) => u.isCanonical && !u.isDeleted && u.languageId === DE_LANG)?.seoPathInfo as string | undefined,
        probe: probeText(String((r.translated?.customFields ?? r.customFields ?? {})[CATEGORY_CONTENT_FIELDS.intro] ?? "")),
      }))
      .filter((s): s is { name: string; path: string; probe: string } => !!s.path && !!s.probe)
      .sort((a, b) => a.name.localeCompare(b.name, "de"))
      .slice(0, 3);
    for (const s of samples) {
      const path = `/${s.path.replace(/^\//, "")}`;
      const page = await ctx.page(path);
      if (page.status !== 200) findings.push(fail("pageStatus", { path, status: page.status }));
      else if (!normalizeText(page.html).includes(s.probe)) findings.push(fail("pageTextMissing", { path, text: s.probe }));
    }
    return { findings, count: Object.keys(current).length, categoryFields: current };
  },
};

const listingDefaults: ShopWatchCheckDef = {
  id: "category:listing",
  group: "agency",
  kind: "listingDefaults",
  label: "Sortierung Topseller, ohne Herstellerfilter",
  url: LISTING_SAMPLE_URL,
  cadence: "hourly",
  repair: () => ({ mode: "none", hint: "Shop-Admin: Kanal META Regalbau DE → Standard-Sortierung „Topseller“; Layout „Fachbodenregale“ → Filter ohne Hersteller" }),
  async run(ctx) {
    const findings: ShopWatchFinding[] = [];
    const cfg = await ctx.api("POST", "search/system-config", {
      filter: [
        { type: "equals", field: "configurationKey", value: "core.listing.defaultSorting" },
        { type: "equals", field: "salesChannelId", value: ctx.channelId },
      ],
      includes: { system_config: ["configurationValue"] },
    });
    const value = cfg?.data?.[0]?.configurationValue;
    if (value !== TOPSELLER_SORTING_ID) findings.push(fail("settingChanged", { setting: "core.listing.defaultSorting", value: String(value ?? "–") }));
    const page = await ctx.page(LISTING_SAMPLE_URL);
    if (page.status !== 200) findings.push(fail("pageStatus", { path: LISTING_SAMPLE_URL, status: page.status }));
    else {
      if (!/value="topseller"\s+selected/.test(page.html)) findings.push(fail("pageMarkerMissing", { path: LISTING_SAMPLE_URL, marker: "Topseller" }));
      if (/filter-[a-z-]*manufacturer/.test(page.html)) findings.push(fail("filterVisible", { path: LISTING_SAMPLE_URL, filter: "Hersteller" }));
    }
    return { findings };
  },
};

const redirects: ShopWatchCheckDef = {
  id: "seo:redirects",
  group: "agency",
  kind: "redirect",
  label: "Hauptseiten und Weiterleitungen",
  cadence: "hourly",
  repair: () => ({ mode: "none", hint: "Shop-Admin: SEO-URLs der „Alles zu“-Kategorien (kurze Adresse als canonical, alte leiten per 301 weiter)" }),
  async run(ctx) {
    const findings: ShopWatchFinding[] = [];
    for (const path of MAIN_LANDING_URLS) {
      const page = await ctx.page(path, { redirect: "manual" });
      if (page.status !== 200) findings.push(fail("pageStatus", { path, status: page.status }));
    }
    for (const r of REDIRECTS) {
      const page = await ctx.page(r.from, { redirect: "manual" });
      const target = page.location ? page.location.replace(ctx.storefront, "") : "";
      if (page.status !== 301 || target.replace(/\/$/, "") !== r.to) findings.push(fail("redirectWrong", { path: r.from, to: r.to, status: page.status, location: target || "–" }));
    }
    return { findings };
  },
};

const markerCountCheck = (id: string, kind: ShopWatchKind, label: string, entity: string, field: string, repair: ShopWatchCheckDef["repair"]): ShopWatchCheckDef => ({
  id,
  group: "bulk",
  kind,
  label,
  cadence: "daily",
  repair,
  async run(ctx) {
    const count = await total(ctx.api, entity, [notNull(`customFields.${field}`)]);
    return { findings: countFindings(ctx.baseline?.counts[id], count), count };
  },
});

const imageTexts = markerCountCheck("bulk:image-texts", "imageTexts", "ALT/TITLE der Produktbilder", "media", "metaorder_image_texts", () => ({ mode: "none", hint: "METAorder: Einstellungen → Bildtexte der Produktbilder → Lauf starten" }));

const metaTexts: ShopWatchCheckDef = {
  id: "bulk:meta-texts",
  group: "bulk",
  kind: "metaTexts",
  label: "Meta-Title und Meta-Description",
  cadence: "daily",
  repair: () => ({ mode: "none", hint: "METAorder: Einstellungen → Meta-Texte der Artikel → Lauf starten" }),
  async run(ctx) {
    const rows = await searchAll(ctx.api, "product", {
      filter: [notNull("customFields.metaorder_meta_texts")],
      includes: { product: ["id", "metaTitle", "metaDescription", "customFields"] },
    });
    const overwritten = rows.filter((r) => {
      const m = r.customFields?.metaorder_meta_texts ?? {};
      return (m.metaTitle && r.metaTitle !== m.metaTitle) || (m.metaDescription && r.metaDescription !== m.metaDescription);
    }).length;
    const findings = countFindings(ctx.baseline?.counts["bulk:meta-texts"], rows.length);
    // Einzelne Handänderungen sind gewollt; viele auf einmal deuten auf einen Import, der überschreibt
    const before = ctx.baseline?.counts["bulk:meta-texts:overwritten"] ?? 0;
    if (overwritten - before > Math.max(20, rows.length * COUNT_TOLERANCE)) findings.push(warn("overwritten", { n: overwritten, before }));
    return { findings, count: rows.length, counts: { "bulk:meta-texts:overwritten": overwritten } };
  },
};

const descriptions: ShopWatchCheckDef = {
  id: "bulk:descriptions",
  group: "bulk",
  kind: "descriptions",
  label: "Produktbeschreibungen",
  cadence: "daily",
  repair: (o) => ({ mode: "manual", command: cmd("writeProductDescriptions.ts", "Produkttexte-Live-2026-10-14.jsonl --check --apply", o) }),
  async run(ctx) {
    const rows = await searchAll(ctx.api, "product", {
      filter: [notNull("customFields.metaorder_description")],
      includes: { product: ["id", "productNumber", "description", "customFields"] },
    }, 250);
    // Service-Artikel (wdu_service_type) schreibt ein eigener Lauf ohne diese Markierung (#165)
    const overwritten = rows.filter((r) => {
      const hash = r.customFields?.metaorder_description?.hash;
      return hash && !r.customFields?.wdu_service_type && descriptionHash(r.description ?? "") !== hash;
    });
    const findings = countFindings(ctx.baseline?.counts["bulk:descriptions"], rows.length);
    const before = ctx.baseline?.counts["bulk:descriptions:overwritten"];
    if (before !== undefined && overwritten.length > before) {
      const numbers = overwritten.map((r) => r.productNumber).sort();
      findings.push(warn("overwritten", { n: overwritten.length, before, numbers: numbers.slice(0, 10).join(", ") + (numbers.length > 10 ? " …" : "") }));
    }
    return { findings, count: rows.length, counts: { "bulk:descriptions:overwritten": overwritten.length } };
  },
};

const crossSelling: ShopWatchCheckDef = {
  id: "bulk:cross-selling",
  group: "bulk",
  kind: "crossSelling",
  label: MANAGED_CROSS_SELLING_NAMES.join(", "),
  cadence: "daily",
  repair: () => ({ mode: "none", hint: "METAorder: Crossselling → Namensregeln ausführen" }),
  async run(ctx) {
    const res = await ctx.api("POST", "search/product-cross-selling", {
      limit: 1,
      filter: [{ type: "equalsAny", field: "name", value: MANAGED_CROSS_SELLING_NAMES }],
      aggregations: [{ name: "names", type: "terms", field: "name", limit: 20 }],
      includes: { product_cross_selling: ["id"] },
    });
    const buckets: Array<{ key: string; count: number }> = res?.aggregations?.names?.buckets ?? [];
    const findings: ShopWatchFinding[] = [];
    let sum = 0;
    const counts: Record<string, number> = {};
    for (const name of MANAGED_CROSS_SELLING_NAMES) {
      const n = buckets.find((b) => b.key === name)?.count ?? 0;
      sum += n;
      counts[`bulk:cross-selling:${name}`] = n;
      findings.push(...countFindings(ctx.baseline?.counts[`bulk:cross-selling:${name}`], n, 0.05).map((f) => ({ ...f, params: { ...f.params, name } })));
    }
    return { findings, count: sum, counts };
  },
};

const montageTag: ShopWatchCheckDef = {
  id: "bulk:montage-tag",
  group: "bulk",
  kind: "montageTag",
  label: "Tag „Montagekosten“",
  cadence: "daily",
  repair: (o) => ({ mode: "manual", command: cmd("tagRegaltypMontagekosten.ts", "--apply", o) }),
  async run(ctx) {
    const tag = await ctx.api("POST", "search/tag", { filter: [{ type: "equals", field: "name", value: "Montagekosten" }], includes: { tag: ["id"] } });
    const tagId = tag?.data?.[0]?.id;
    if (!tagId) return { findings: [fail("entityMissing", { entity: "Tag", name: "Montagekosten" })], count: 0 };
    const count = await total(ctx.api, "product", [{ type: "equals", field: "tags.id", value: tagId }]);
    return { findings: countFindings(ctx.baseline?.counts["bulk:montage-tag"], count), count };
  },
};

const plugins: ShopWatchCheckDef = {
  id: "platform:plugins",
  group: "platform",
  kind: "plugins",
  label: [...REQUIRED_PLUGINS, ...OPTIONAL_PLUGINS].join(", "),
  cadence: "hourly",
  repair: () => ({ mode: "none", hint: "Agentur: Plugin wieder installieren bzw. aktivieren" }),
  async run(ctx) {
    const list = await ctx.plugins();
    const findings: ShopWatchFinding[] = [];
    for (const name of REQUIRED_PLUGINS) {
      const p = list.find((x) => x.name === name);
      if (!p) findings.push(fail("pluginMissing", { name }));
      else if (!p.active) findings.push(fail("pluginInactive", { name }));
    }
    for (const name of OPTIONAL_PLUGINS) {
      const p = list.find((x) => x.name === name);
      if (p && !p.active) findings.push(fail("pluginInactive", { name }));
    }
    return { findings };
  },
};

/** Aktion zum Code im Exit-Intent-Modal: ohne sie zeigt das Modal einen Code, der nicht funktioniert */
const exitIntentPromotion: ShopWatchCheckDef = {
  id: "exit-intent:promotion",
  group: "own",
  kind: "promotion",
  label: `Newsletter-Willkommensrabatt (${EXIT_INTENT_CODE})`,
  cadence: "hourly",
  repair: (o) => ({ mode: "auto", command: cmd("writeExitIntentPromotion.ts", "--apply", o) }),
  async run(ctx) {
    return {
      findings: [
        ...(await entityFindings(ctx.api, "promotion", "Aktion", EXIT_INTENT_IDS.promotion, EXIT_INTENT_PROMOTION_NAME, true)),
        ...(await entityFindings(ctx.api, "rule", "Regel", EXIT_INTENT_IDS.rule, EXIT_INTENT_RULE_NAME)),
      ],
    };
  },
};

export const SHOP_WATCH_CHECKS: ShopWatchCheckDef[] = [
  plugins,
  ...STOREFRONT_SNIPPETS.map(snippetCheck),
  exitIntentPromotion,
  quickConfigPage,
  quickConfigHome,
  ...industryPageChecks,
  industryHome,
  ...homeSectionChecks,
  categoryFields,
  listingDefaults,
  redirects,
  imageTexts,
  metaTexts,
  descriptions,
  crossSelling,
  montageTag,
];
