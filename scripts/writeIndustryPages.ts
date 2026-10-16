/**
 * Legt die Branchen-Landingpages (server/products/industryPages.ts) als Erlebniswelten im Shop an.
 * Aufbau je Seite: HTML-Elemente mit eigenem, auf `.mbp` begrenztem Stylesheet (Design wie die Entwürfe),
 * dazu der Standard-Produkt-Slider (Preise, Lieferzeit, Warenkorb live) und das FAQ-Plugin (hueb SEO FAQ).
 * Preise in Tabellen und Beispielrechnung kommen beim Schreiben aus dem Ziel-Shop.
 *
 * Alle Entitäten sind neu und haben feste IDs je Branche: ein zweiter Lauf ersetzt die eigenen Seiten,
 * fremde Inhalte werden nie angefasst. Ohne --apply nur Testlauf. Mit --apply Protokoll; --revert löscht
 * die angelegten Seiten wieder. Schreibt nur in Shops mit „test.“ in der URL, außer mit --live.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeIndustryPages.ts <tenantId> [--only kfz,handwerk] [--apply] [--live] [--image-fallback <shop-stand.json>]
 *   NODE_ENV=development npx tsx scripts/writeIndustryPages.ts <tenantId> --revert <protokoll.json>
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import { INDUSTRY_PAGES, referencedNumbers, type IndustryPage } from "../server/products/industryPages";
import { IndustryPageHtml, industryPageCss, type IndustryShopProduct } from "../server/products/industryPageHtml";

const DE_CHANNEL_NAME = "META Regalbau DE";
const DE_LANG = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";
const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };
const NO_MARGINS = { marginTop: "0", marginBottom: "0", marginLeft: "0", marginRight: "0" };
const SLIDER_MARGINS = { marginTop: "0", marginBottom: "20px", marginLeft: "20px", marginRight: "20px" };

/** Feste ID je Branche und Teil – ein zweiter Lauf findet seine eigenen Entitäten wieder. */
export const industryEntityId = (key: string, part: string) => createHash("md5").update(`metaorder-industry:${key}:${part}`).digest("hex");

type Protocol = {
  tenantId: string;
  at: string;
  landingPages: string[];
  cmsPages: string[];
  faqGroups: string[];
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const htmlBlock = (id: string, position: number, html: string) => ({
  id,
  type: "html",
  position,
  sectionPosition: "main",
  ...NO_MARGINS,
  visibility: ALL_DEVICES,
  slots: [{ id: createHash("md5").update(`${id}:slot`).digest("hex"), type: "html", slot: "content", config: { content: { source: "static", value: html } } }],
});

function buildCmsPage(page: IndustryPage, products: Record<string, IndustryShopProduct>, faqGroupId: string) {
  const id = (part: string) => industryEntityId(page.key, part);
  const h = new IndustryPageHtml(page, products, {
    notes: false,
    cartForm: true,
    linkHref: (t) => (t.startsWith("/") || t.startsWith("#") ? t : `/search?search=${encodeURIComponent(t)}`),
  });
  const wrap = (inner: string) => `<div class="mbp">${inner}</div>`;
  const style = `<style>${industryPageCss(".mbp")}</style>`;
  const section = (part: string, position: number, sizingMode: "full_width" | "boxed", blocks: any[]) => ({
    id: id(`section-${part}`),
    type: "default",
    position,
    sizingMode,
    mobileBehavior: "wrap",
    visibility: ALL_DEVICES,
    blocks,
  });
  const sliderSlot = {
    id: id("slot-slider"),
    type: "product-slider",
    slot: "productSlider",
    config: {
      products: { source: "static", value: page.products.map((p) => products[p.number].id) },
      title: { source: "static", value: "" },
      displayMode: { source: "static", value: "standard" },
      boxLayout: { source: "static", value: "standard" },
      navigation: { source: "static", value: true },
      navigationArrows: { source: "static", value: "outside" },
      rotate: { source: "static", value: false },
      border: { source: "static", value: false },
      elMinWidth: { source: "static", value: "260px" },
      speed: { source: "static", value: 300 },
      autoplayTimeout: { source: "static", value: 5000 },
      verticalAlign: { source: "static", value: null },
    },
  };
  const sections = [
    section("top", 0, "full_width", [htmlBlock(id("block-top"), 0, style + wrap(h.hero() + h.jump() + h.areas() + h.planning()))]),
    section("products", 1, "boxed", [
      htmlBlock(id("block-products-head"), 0, wrap(`<div class="wrap" style="padding-top:56px">${h.productsHead("#bereiche", "Alle Lagerbereiche")}</div>`)),
      { id: id("block-slider"), type: "product-slider", position: 1, sectionPosition: "main", ...SLIDER_MARGINS, visibility: ALL_DEVICES, slots: [sliderSlot] },
    ]),
    section("middle", 2, "full_width", [htmlBlock(id("block-middle"), 0, wrap(h.duties() + h.why() + h.project()))]),
    section("faq", 3, "boxed", [
      htmlBlock(id("block-faq-head"), 0, wrap(`<div class="wrap" id="faq" style="padding-top:56px">${h.faqHead()}</div>`)),
      { id: id("block-faq"), type: "text", position: 1, sectionPosition: "main", ...SLIDER_MARGINS, visibility: ALL_DEVICES, slots: [{ id: id("slot-faq"), type: "hueb-faq-element", slot: "content", config: { group: { source: "static", value: faqGroupId } } }] },
    ]),
    section("bottom", 4, "full_width", [
      htmlBlock(id("block-bottom"), 0, wrap(`<section id="beratung" style="padding:32px 0 64px"><div class="wrap">${h.advice()}${h.more(INDUSTRY_PAGES, (o) => o.url)}</div></section>`)),
    ]),
  ];
  return { id: id("cms"), name: `Branchenseite ${page.name}`, type: "landingpage", sections };
}

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Usage: npx tsx scripts/writeIndustryPages.ts <tenantId> [--only kfz,handwerk] [--apply] [--live] | --revert <protokoll.json>");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const client = new ShopwareClient(settings);
  const base = settings.shopwareUrl.replace(/\/$/, "");
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await client.makeAuthenticatedRequest(`${base}/api/${path}`, { method, headers: { "Content-Type": "application/json", "sw-language-id": DE_LANG }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${txt.slice(0, 400)}`);
    return txt ? JSON.parse(txt) : null;
  };
  const isTest = /\/\/test\./.test(base);
  const deleteOwn = async (log: Pick<Protocol, "landingPages" | "cmsPages" | "faqGroups">) => {
    for (const id of log.landingPages) await api("DELETE", `landing-page/${id}`).catch((e) => console.log("Landingpage", e.message));
    for (const id of log.cmsPages) await api("DELETE", `cms-page/${id}`).catch((e) => console.log("Layout", e.message));
    for (const id of log.faqGroups) {
      const qs = (await api("POST", "search/hueb-seo-faq-questions", { limit: 100, filter: [{ type: "equals", field: "group", value: id }] }))?.data ?? [];
      for (const q of qs) await api("DELETE", `hueb-seo-faq-questions/${q.id}`);
      await api("DELETE", `hueb-seo-faq-group/${id}`).catch((e) => console.log("FAQ-Gruppe", e.message));
    }
  };

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    await deleteOwn(log);
    if (isTest) await api("DELETE", "_action/cache").catch(() => undefined);
    console.log(`Zurückgebaut: ${log.landingPages.length} Seiten, ${log.cmsPages.length} Layouts, ${log.faqGroups.length} FAQ-Gruppen`);
    return;
  }

  const apply = process.argv.includes("--apply");
  if (apply && !isTest && !process.argv.includes("--live")) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
  const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const pages = INDUSTRY_PAGES.filter((p) => only.size === 0 || only.has(p.key));

  const channels = await api("POST", "search/sales-channel", { limit: 50, associations: { domains: {} }, includes: { sales_channel: ["id", "name", "domains"], sales_channel_domain: ["url"] } });
  const de = channels.data.find((c: any) => c.name === DE_CHANNEL_NAME);
  if (!de) throw new Error(`Verkaufskanal ${DE_CHANNEL_NAME} fehlt`);
  const domain = ((de.domains ?? []).map((d: any) => d.url).find((u: string) => /shop\.meta-online\.com|test\./.test(u)) ?? base).replace(/\/$/, "");

  // Artikel aus dem Ziel-Shop: ID, Netto-Preis, Bild, Lieferzeit, URL
  const numbers = [...new Set(pages.flatMap(referencedNumbers))];
  const found = await api("POST", "search/product", {
    limit: numbers.length + 10,
    filter: [{ type: "equalsAny", field: "productNumber", value: numbers }],
    associations: { cover: { associations: { media: {} } }, seoUrls: {}, deliveryTime: {}, visibilities: {} },
    includes: {
      product: ["id", "productNumber", "name", "translated", "price", "cover", "seoUrls", "deliveryTime", "active", "visibilities"],
      product_media: ["media"],
      media: ["url"],
      seo_url: ["seoPathInfo", "isCanonical", "isDeleted", "salesChannelId", "languageId"],
      delivery_time: ["name", "translated"],
      product_visibility: ["salesChannelId"],
    },
  });
  const products: Record<string, IndustryShopProduct> = {};
  const problems: string[] = [];
  for (const x of found.data ?? []) {
    const seo = (x.seoUrls ?? []).find((u: any) => u.salesChannelId === de.id && u.languageId === DE_LANG && u.isCanonical && !u.isDeleted);
    const net = x.price?.[0]?.net;
    if (!x.active || !(x.visibilities ?? []).some((v: any) => v.salesChannelId === de.id)) problems.push(`${x.productNumber}: nicht aktiv im Kanal ${DE_CHANNEL_NAME}`);
    if (typeof net !== "number") problems.push(`${x.productNumber}: kein Preis`);
    products[x.productNumber] = {
      id: x.id,
      name: x.translated?.name ?? x.name,
      priceNet: net,
      deliveryTime: x.deliveryTime?.translated?.name ?? x.deliveryTime?.name,
      url: seo ? `${domain}/${seo.seoPathInfo}` : `${domain}/detail/${x.id}`,
      image: x.cover?.media?.url ?? null,
    };
  }
  for (const n of numbers) if (!products[n]) problems.push(`${n}: fehlt im Shop`);
  // Testshop hat nicht alle Bilddateien: fehlende Hauptbilder aus einem Shop-Stand (exportIndustryPages-JSON) nehmen
  const fallbackFile = arg("--image-fallback");
  if (fallbackFile) {
    const fallback = JSON.parse(readFileSync(fallbackFile, "utf8")).products as Record<string, IndustryShopProduct>;
    for (const page of pages) {
      const p = products[page.hero.number];
      const ok = p?.image ? (await fetch(p.image, { method: "HEAD" }).catch(() => null))?.ok : false;
      if (p && !ok && fallback[page.hero.number]?.image) {
        console.log(`  ${page.key}: Hauptbild fehlt im Shop – nehme ${fallback[page.hero.number].image}`);
        p.image = fallback[page.hero.number].image;
      }
    }
  }
  if (problems.length) throw new Error(`Artikel nicht verwendbar:\n${problems.join("\n")}`);

  // Adressen duerfen nicht schon von fremden Seiten belegt sein
  const paths = pages.map((p) => p.url.replace(/^\//, ""));
  const taken = await api("POST", "search/seo-url", {
    limit: 50,
    filter: [{ type: "equalsAny", field: "seoPathInfo", value: paths }, { type: "equals", field: "salesChannelId", value: de.id }, { type: "equals", field: "isDeleted", value: false }],
    includes: { seo_url: ["seoPathInfo", "foreignKey", "routeName"] },
  });
  const ownIds = new Set(pages.map((p) => industryEntityId(p.key, "lp")));
  const conflicts = (taken.data ?? []).filter((u: any) => !ownIds.has(u.foreignKey));
  if (conflicts.length) throw new Error(`Adresse schon vergeben: ${conflicts.map((u: any) => `/${u.seoPathInfo} (${u.routeName})`).join(", ")}`);

  const existing = new Set<string>(
    ((await api("POST", "search/landing-page", { ids: [...ownIds], includes: { landing_page: ["id"] } }))?.data ?? []).map((x: any) => x.id),
  );
  const log: Protocol = { tenantId, at: new Date().toISOString(), landingPages: [], cmsPages: [], faqGroups: [] };
  const plans = pages.map((page) => {
    const lpId = industryEntityId(page.key, "lp");
    const faqGroupId = industryEntityId(page.key, "faq");
    const cms = buildCmsPage(page, products, faqGroupId);
    const landingPage = {
      id: lpId,
      name: page.name,
      active: true,
      url: page.url.replace(/^\//, ""),
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
      salesChannels: [{ id: de.id }],
      cmsPageId: cms.id,
    };
    const faqGroup = { id: faqGroupId, name: `Branchenseite ${page.name}`, active: true, position: 60 };
    const questions = page.faq.map((f, i) => ({ id: industryEntityId(page.key, `faq-${i}`), group: faqGroupId, name: "ID", active: true, questionPosition: i + 1, question: f.q, answer: f.a }));
    const htmlSize = cms.sections.flatMap((s) => s.blocks).flatMap((b: any) => b.slots).reduce((n: number, sl: any) => n + String(sl.config?.content?.value ?? "").length, 0);
    return { page, lpId, cms, landingPage, faqGroup, questions, replace: existing.has(lpId), htmlSize };
  });

  for (const p of plans)
    console.log(
      `${apply ? (p.replace ? "ERSETZE" : "LEGE AN") : p.replace ? "würde ersetzen" : "würde anlegen"} ${domain}${p.page.url} – ${p.cms.sections.length} Abschnitte, ${p.page.products.length} Produkte im Slider, ${p.questions.length} FAQ, HTML ${Math.round(p.htmlSize / 1024)} KB`,
    );
  if (!apply) return;

  const file = `/app/tmp-claude/branchenseiten-${tenantId.slice(0, 8)}-${Date.now()}.json`;
  for (const p of plans) {
    if (p.replace) await deleteOwn({ landingPages: [p.lpId], cmsPages: [p.cms.id], faqGroups: [p.faqGroup.id] });
    // Das FAQ-Plugin nimmt die Fragen nicht verschachtelt mit der Gruppe an: erst Gruppe, dann Fragen
    await api("POST", "hueb-seo-faq-group", p.faqGroup);
    log.faqGroups.push(p.faqGroup.id);
    writeFileSync(file, JSON.stringify(log, null, 1));
    for (const q of p.questions) await api("POST", "hueb-seo-faq-questions", q);
    await api("POST", "cms-page", p.cms);
    log.cmsPages.push(p.cms.id);
    writeFileSync(file, JSON.stringify(log, null, 1));
    await api("POST", "landing-page", p.landingPage);
    log.landingPages.push(p.lpId);
    writeFileSync(file, JSON.stringify(log, null, 1));
    // Shopware macht aus "branchen/x" automatisch "branchen-x": gewuenschte Adresse als canonical setzen
    await api("PATCH", "_action/seo-url/canonical", {
      foreignKey: p.lpId,
      routeName: "frontend.landing.page",
      pathInfo: `/landingPage/${p.lpId}`,
      seoPathInfo: p.landingPage.url,
      salesChannelId: de.id,
      languageId: DE_LANG,
      isModified: true,
    });
  }
  console.log(`Protokoll: ${file}`);
  if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
  for (const p of plans) {
    const r = await fetch(`${domain}${p.page.url}`, { redirect: "manual" });
    console.log(`${r.status} ${domain}${p.page.url}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
