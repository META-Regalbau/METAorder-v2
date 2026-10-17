/**
 * Legt die Branchen-Landingpages (server/products/industryPages.ts) als Erlebniswelten im Shop an.
 * Aufbau je Seite: HTML-Elemente mit eigenem, auf `.mbp` begrenztem Stylesheet (Design wie die Entwürfe),
 * dazu der Standard-Produkt-Slider (Preise, Lieferzeit, Warenkorb live) und das FAQ-Plugin (hueb SEO FAQ).
 * Preise in Tabellen und Beispielrechnung kommen beim Schreiben aus dem Ziel-Shop.
 *
 * FAQ: Fragen, die in INDUSTRY_COMMON.faq stehen (Prüfpflicht, Regal-Lexikon), liegen in einer gemeinsamen FAQ-Gruppe
 * „Sicherheit und Regalprüfung“, die jede Seite als zweites FAQ-Element zeigt. So stehen sie auf /faq (dort zeigt das
 * Plugin alle Gruppen) nur einmal. Die Gruppe wird bei jedem Lauf mit allen Seiten auf den Stand des Codes gebracht.
 *
 * Alle Entitäten sind neu und haben feste IDs je Branche: ein zweiter Lauf ersetzt die eigenen Seiten,
 * fremde Inhalte werden nie angefasst. Ohne --apply nur Testlauf. Mit --apply Protokoll; --revert löscht
 * die angelegten Seiten wieder. Schreibt nur in Shops mit „test.“ in der URL, außer mit --live.
 *
 * --home: Teaser „Regale für Ihre Branche“ als eigener Abschnitt auf der Startseite (nach „META Bestseller“,
 * nur im DE-Kanal über moorl_section_config). Ersetzt beim zweiten Lauf nur den eigenen Abschnitt; --revert
 * entfernt ihn und schiebt die folgenden Abschnitte zurück.
 *
 * --home-sections: ersetzt den Inhalt der bestehenden Startseiten-Abschnitte „Rabattstaffel“ und „B2B-Zahlung
 * (Mondu)“ durch Fassungen im Design der Branchenseiten (server/products/homeSections.ts); beide nur im DE-Kanal.
 * Altes HTML, Kanal-Einstellung und Hintergrund kommen ins Protokoll, --revert stellt sie wieder her.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeIndustryPages.ts <tenantId> [--only kfz,handwerk] [--apply] [--live] [--image-fallback <shop-stand.json>]
 *   NODE_ENV=development npx tsx scripts/writeIndustryPages.ts <tenantId> --home [--apply] [--live] [--image-fallback <shop-stand.json>]
 *   NODE_ENV=development npx tsx scripts/writeIndustryPages.ts <tenantId> --home-sections [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeIndustryPages.ts <tenantId> --revert <protokoll.json>
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import { INDUSTRY_COMMON, INDUSTRY_PAGES, referencedNumbers, type IndustryPage } from "../server/products/industryPages";
import { IndustryPageHtml, homeTeaserHtml, industryPageCss, type IndustryShopProduct } from "../server/products/industryPageHtml";
import { HOME_SECTION_IDS, HOME_SECTION_MARKERS, monduSectionHtml, rabattSectionHtml } from "../server/products/homeSections";
import { industryEntityId } from "../server/shopContent/shopEntityIds";
import { DE_CHANNEL_NAME, DE_LANG, findDeChannel, loadIndustryShopProducts, productProblemText, shopApi } from "../server/shopContent/shopProducts";

const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };
const NO_MARGINS = { marginTop: "0", marginBottom: "0", marginLeft: "0", marginRight: "0" };
const SLIDER_MARGINS = { marginTop: "0", marginBottom: "20px", marginLeft: "20px", marginRight: "20px" };


type Protocol = {
  tenantId: string;
  at: string;
  landingPages: string[];
  cmsPages: string[];
  faqGroups: string[];
  /** Startseiten-Teaser (--home) */
  home?: { pageId: string; sectionId: string };
  /** Gemeinsame FAQ-Gruppe: neu angelegt (Rückbau löscht sie) oder Fragen vor dem Lauf (Rückbau stellt sie her) */
  commonFaq?: { groupId: string; created: boolean; before: Array<{ id: string; question: string; answer: string; questionPosition: number }> };
  /** Ersetzte Startseiten-Abschnitte (--home-sections): Werte vor dem Lauf */
  homeSlots?: Array<{ sectionId: string; slotId: string; config: unknown; customFields: unknown; backgroundColor: string | null }>;
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

/** Gemeinsame FAQ-Gruppe aller Branchenseiten */
const COMMON_FAQ_GROUP = { id: industryEntityId("common", "faq"), name: "Sicherheit und Regalprüfung", active: true, position: 5 };
const isCommonFaq = (f: { q: string }) => INDUSTRY_COMMON.faq.some((c) => c.q === f.q);

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
      // Eigene und gemeinsame Fragen sollen wie eine Liste aussehen: kein Abstand zwischen den beiden FAQ-Elementen
      { id: id("block-faq"), type: "text", position: 1, sectionPosition: "main", ...SLIDER_MARGINS, marginBottom: "0", visibility: ALL_DEVICES, slots: [{ id: id("slot-faq"), type: "hueb-faq-element", slot: "content", config: { group: { source: "static", value: faqGroupId } } }] },
      { id: id("block-faq-common"), type: "text", position: 2, sectionPosition: "main", ...SLIDER_MARGINS, visibility: ALL_DEVICES, slots: [{ id: id("slot-faq-common"), type: "hueb-faq-element", slot: "content", config: { group: { source: "static", value: COMMON_FAQ_GROUP.id } } }] },
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
  const { api, base, isTest } = shopApi(settings);
  const deleteOwn = async (log: Pick<Protocol, "landingPages" | "cmsPages" | "faqGroups">) => {
    for (const id of log.landingPages) await api("DELETE", `landing-page/${id}`).catch((e) => console.log("Landingpage", e.message));
    for (const id of log.cmsPages) await api("DELETE", `cms-page/${id}`).catch((e) => console.log("Layout", e.message));
    for (const id of log.faqGroups) {
      const qs = (await api("POST", "search/hueb-seo-faq-questions", { limit: 100, filter: [{ type: "equals", field: "group", value: id }] }))?.data ?? [];
      for (const q of qs) await api("DELETE", `hueb-seo-faq-questions/${q.id}`);
      await api("DELETE", `hueb-seo-faq-group/${id}`).catch((e) => console.log("FAQ-Gruppe", e.message));
    }
  };

  const homeSections = async (pageId: string) =>
    ((await api("POST", "search/cms-section", { limit: 100, filter: [{ type: "equals", field: "pageId", value: pageId }], associations: { blocks: {} }, includes: { cms_section: ["id", "position", "blocks"], cms_block: ["type"] } }))?.data ?? []).sort(
      (a: any, b: any) => a.position - b.position,
    );
  /** Eigenen Abschnitt loeschen und die folgenden Abschnitte um eins nach oben schieben */
  const removeHomeSection = async (pageId: string, sectionId: string) => {
    const secs = await homeSections(pageId);
    const own = secs.find((x: any) => x.id === sectionId);
    if (!own) return console.log("Startseiten-Abschnitt schon entfernt");
    await api("DELETE", `cms-section/${sectionId}`);
    for (const x of secs.filter((x: any) => x.position > own.position)) await api("PATCH", `cms-section/${x.id}`, { position: x.position - 1 });
    console.log("Startseiten-Abschnitt entfernt");
  };

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    await deleteOwn(log);
    if (log.commonFaq) {
      const qs = (await api("POST", "search/hueb-seo-faq-questions", { limit: 100, filter: [{ type: "equals", field: "group", value: log.commonFaq.groupId }] }))?.data ?? [];
      for (const q of qs) await api("DELETE", `hueb-seo-faq-questions/${q.id}`);
      if (log.commonFaq.created) await api("DELETE", `hueb-seo-faq-group/${log.commonFaq.groupId}`).catch((e) => console.log("FAQ-Gruppe", e.message));
      else for (const q of log.commonFaq.before) await api("POST", "hueb-seo-faq-questions", { ...q, group: log.commonFaq.groupId, name: "ID", active: true });
      console.log(`Gemeinsame FAQ-Gruppe ${log.commonFaq.created ? "gelöscht" : "zurückgesetzt"}`);
    }
    if (log.home) await removeHomeSection(log.home.pageId, log.home.sectionId);
    for (const h of log.homeSlots ?? []) {
      await api("PATCH", `cms-slot/${h.slotId}`, { config: h.config });
      await api("PATCH", `cms-section/${h.sectionId}`, { customFields: h.customFields, backgroundColor: h.backgroundColor });
    }
    if (log.homeSlots?.length) console.log(`Startseiten-Abschnitte zurückgesetzt: ${log.homeSlots.length}`);
    if (isTest) await api("DELETE", "_action/cache").catch(() => undefined);
    console.log(`Zurückgebaut: ${log.landingPages.length} Seiten, ${log.cmsPages.length} Layouts, ${log.faqGroups.length} FAQ-Gruppen`);
    return;
  }

  const apply = process.argv.includes("--apply");
  if (apply && !isTest && !process.argv.includes("--live")) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
  const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const home = process.argv.includes("--home");
  // Der Teaser zeigt immer alle Branchen
  const pages = home ? INDUSTRY_PAGES : INDUSTRY_PAGES.filter((p) => only.size === 0 || only.has(p.key));

  const de = await findDeChannel(api, base);
  const domain = de.domain;

  if (process.argv.includes("--home-sections")) {
    const parts = [
      { key: "rabatt" as const, html: rabattSectionHtml() },
      { key: "mondu" as const, html: monduSectionHtml() },
    ];
    const plans: Array<{ key: string; sec: any; slot: any; html: string; own: boolean }> = [];
    for (const part of parts) {
      const sec = (await api("POST", "search/cms-section", { ids: [HOME_SECTION_IDS[part.key]], associations: { blocks: { associations: { slots: {} } } } }))?.data?.[0];
      const slot = sec?.blocks?.flatMap((b: any) => b.slots ?? []).find((x: any) => x.type === "html");
      const current = String(slot?.config?.content?.value ?? "");
      const marker = HOME_SECTION_MARKERS[part.key];
      const own = current.includes(marker.own);
      if (!slot || !(own || marker.old.test(current))) throw new Error(`Abschnitt ${part.key} (${HOME_SECTION_IDS[part.key]}) nicht gefunden oder Inhalt unbekannt – nichts geändert`);
      plans.push({ key: part.key, sec, slot, html: part.html, own });
      console.log(`${apply ? "SCHREIBE" : "würde schreiben"} Startseite „${part.key}“ (Position ${sec.position}, bisher ${own ? "eigene Fassung" : "Agentur-Fassung"}), nur Kanal ${DE_CHANNEL_NAME}, HTML ${Math.round(part.html.length / 1024)} KB`);
    }
    if (!apply) return;
    const file = `/app/tmp-claude/startseite-abschnitte-${tenantId.slice(0, 8)}-${Date.now()}.json`;
    const log: Protocol = {
      tenantId,
      at: new Date().toISOString(),
      landingPages: [],
      cmsPages: [],
      faqGroups: [],
      homeSlots: plans.map((x) => ({ sectionId: x.sec.id, slotId: x.slot.id, config: x.slot.config, customFields: x.sec.customFields ?? null, backgroundColor: x.sec.backgroundColor ?? null })),
    };
    writeFileSync(file, JSON.stringify(log, null, 1));
    for (const x of plans) {
      await api("PATCH", `cms-slot/${x.slot.id}`, { config: { ...(x.slot.config ?? {}), content: { source: "static", value: x.html } } });
      // Rabattstaffel und Mondu gibt es nur im DE-Shop (AT: nur Stripe, PL: keine Mondu-Zahlart)
      const cfg = (x.sec.customFields ?? {}).moorl_section_config ?? {};
      await api("PATCH", `cms-section/${x.sec.id}`, { backgroundColor: null, customFields: { ...(x.sec.customFields ?? {}), moorl_section_config: { color: null, ...cfg, salesChannel: [de.id] } } });
    }
    console.log(`Protokoll: ${file}`);
    if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
    const body = await (await fetch(`${domain}/?mbp=${Date.now()}`)).text();
    for (const x of plans) console.log(`${x.key}: ${body.includes(`data-mbp="${x.key}"`) ? "auf der Startseite sichtbar" : "NICHT im HTML"}`);
    return;
  }

  // Artikel aus dem Ziel-Shop: ID, Netto-Preis, Bild, Lieferzeit, URL
  const numbers = home ? [...new Set(pages.map((p) => p.hero.number))] : [...new Set(pages.flatMap(referencedNumbers))];
  const loaded = await loadIndustryShopProducts(api, numbers, de);
  const products: Record<string, IndustryShopProduct> = loaded.products;
  const problems = loaded.problems.map(productProblemText);
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

  if (home) {
    // Teaser verlinkt die Branchenseiten: die muessen im Ziel-Shop existieren und aktiv sein
    const lpIds = pages.map((p) => industryEntityId(p.key, "lp"));
    const lps = ((await api("POST", "search/landing-page", { ids: lpIds, includes: { landing_page: ["id", "active"] } }))?.data ?? []) as any[];
    const missing = pages.filter((p) => !lps.some((l) => l.id === industryEntityId(p.key, "lp") && l.active));
    if (missing.length) throw new Error(`Branchenseiten fehlen im Shop: ${missing.map((p) => p.url).join(", ")} – erst ohne --home schreiben`);
    const pageId =
      de.homeCmsPageId ?? (await api("POST", "search/category", { ids: [de.navigationCategoryId], includes: { category: ["cmsPageId"] } }))?.data?.[0]?.cmsPageId;
    if (!pageId) throw new Error("Layout der Startseite nicht gefunden");
    const secs = await homeSections(pageId);
    const sectionId = industryEntityId("home", "section");
    const existingSec = secs.find((x: any) => x.id === sectionId);
    const anchor = secs.find((x: any) => (x.blocks ?? []).some((b: any) => b.type === "ssik-extra-products"));
    if (!existingSec && !anchor) throw new Error("Abschnitt „META Bestseller“ (ssik-extra-products) auf der Startseite nicht gefunden");
    const position = existingSec ? existingSec.position : anchor.position + 1;
    const html = `<style>${industryPageCss(".mbp")}</style><div class="mbp">${homeTeaserHtml(pages, products, (p) => p.url)}</div>`;
    const section = {
      id: sectionId,
      pageId,
      type: "default",
      position,
      sizingMode: "full_width",
      mobileBehavior: "wrap",
      visibility: ALL_DEVICES,
      // Startseiten-Layout teilen sich mehrere Kanaele, die Branchenseiten gibt es nur im DE-Shop
      customFields: { moorl_section_config: { color: null, salesChannel: [de.id] } },
      blocks: [htmlBlock(industryEntityId("home", "block"), 0, html)],
    };
    console.log(
      `${apply ? (existingSec ? "ERSETZE" : "LEGE AN") : existingSec ? "würde ersetzen" : "würde anlegen"} Startseiten-Teaser an Position ${position} (nach „META Bestseller“), nur Kanal ${DE_CHANNEL_NAME}, HTML ${Math.round(html.length / 1024)} KB`,
    );
    if (!apply) return;
    const file = `/app/tmp-claude/branchen-startseite-${tenantId.slice(0, 8)}-${Date.now()}.json`;
    const log: Protocol = { tenantId, at: new Date().toISOString(), landingPages: [], cmsPages: [], faqGroups: [], home: { pageId, sectionId } };
    writeFileSync(file, JSON.stringify(log, null, 1));
    if (existingSec) await api("DELETE", `cms-section/${sectionId}`);
    else for (const x of [...secs].reverse().filter((x: any) => x.position >= position)) await api("PATCH", `cms-section/${x.id}`, { position: x.position + 1 });
    await api("POST", "cms-section", section);
    console.log(`Protokoll: ${file}`);
    if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
    const r = await fetch(`${domain}/`);
    const body = await r.text();
    console.log(`${r.status} ${domain}/ – Teaser ${body.includes('class="ht-grid"') ? "sichtbar" : "NICHT im HTML (Cache?)"}`);
    return;
  }

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
    const questions = page.faq.filter((f) => !isCommonFaq(f)).map((f, i) => ({ id: industryEntityId(page.key, `faq-${i}`), group: faqGroupId, name: "ID", active: true, questionPosition: i + 1, question: f.q, answer: f.a }));
    const htmlSize = cms.sections.flatMap((s) => s.blocks).flatMap((b: any) => b.slots).reduce((n: number, sl: any) => n + String(sl.config?.content?.value ?? "").length, 0);
    return { page, lpId, cms, landingPage, faqGroup, questions, replace: existing.has(lpId), htmlSize };
  });

  for (const p of plans)
    console.log(
      `${apply ? (p.replace ? "ERSETZE" : "LEGE AN") : p.replace ? "würde ersetzen" : "würde anlegen"} ${domain}${p.page.url} – ${p.cms.sections.length} Abschnitte, ${p.page.products.length} Produkte im Slider, ${p.questions.length} FAQ, HTML ${Math.round(p.htmlSize / 1024)} KB`,
    );
  const commonQuestions = INDUSTRY_COMMON.faq.map((f, i) => ({ id: industryEntityId("common", `faq-${i}`), group: COMMON_FAQ_GROUP.id, name: "ID", active: true, questionPosition: i + 1, question: f.q, answer: f.a }));
  console.log(`${apply ? "SCHREIBE" : "würde schreiben"} gemeinsame FAQ-Gruppe „${COMMON_FAQ_GROUP.name}“ mit ${commonQuestions.length} Fragen`);
  if (!apply) return;

  const file = `/app/tmp-claude/branchenseiten-${tenantId.slice(0, 8)}-${Date.now()}.json`;
  // Gemeinsame Gruppe zuerst: die Seiten verweisen darauf
  const commonExisting = (await api("POST", "search/hueb-seo-faq-group", { ids: [COMMON_FAQ_GROUP.id] }))?.data?.[0];
  const commonBefore = commonExisting
    ? (((await api("POST", "search/hueb-seo-faq-questions", { limit: 100, filter: [{ type: "equals", field: "group", value: COMMON_FAQ_GROUP.id }] }))?.data ?? []) as any[])
    : [];
  log.commonFaq = {
    groupId: COMMON_FAQ_GROUP.id,
    created: !commonExisting,
    before: commonBefore.map((q) => ({ id: q.id, question: q.question, answer: q.answer, questionPosition: q.questionPosition })),
  };
  writeFileSync(file, JSON.stringify(log, null, 1));
  if (!commonExisting) await api("POST", "hueb-seo-faq-group", COMMON_FAQ_GROUP);
  for (const q of commonBefore) await api("DELETE", `hueb-seo-faq-questions/${q.id}`);
  for (const q of commonQuestions) await api("POST", "hueb-seo-faq-questions", q);
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
