/**
 * Schreibt die System-Landingpages (server/products/categoryLandingPages.ts, Vorlage A–K) in den Shop.
 * Je Seite eine neue Erlebniswelt mit festen IDs; sie wird an die bestehende Landingpage gehängt, URL,
 * Meta-Texte und SEO-Adressen bleiben unverändert. Die bisherige Erlebniswelt (Agentur) wird nicht angefasst
 * und kommt mit --revert zurück.
 *
 * Aufbau: HTML-Elemente mit eigenem, auf `.mbp` begrenztem Stylesheet (Design wie die Entwürfe), dazu der
 * Standard-Produkt-Slider (Preise, Lieferzeit, Warenkorb live) und das FAQ-Plugin (hueb SEO FAQ). Preise der
 * Beispielrechnung kommen beim Schreiben aus dem Ziel-Shop.
 *
 * FAQ: Die Prüfpflicht-Frage steht in der gemeinsamen Gruppe „Sicherheit und Regalprüfung“ (writeIndustryPages.ts)
 * und wird als zweites FAQ-Element gezeigt. Die übrigen Fragen kommen in die bestehende Gruppe der Seite
 * (faqGroupId, z. B. Agentur-Gruppe „Fachbodenregale“, die auch auf /faq steht) – die bisherigen Fragen kommen
 * ins Protokoll und mit --revert zurück. Ohne faqGroupId legt das Skript eine eigene Gruppe an.
 *
 * Ohne --apply nur Testlauf. Schreibt nur in Shops mit „test.“ in der URL, außer mit --live.
 *
 * Aufruf (lokal mit Docker-DB oder im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeCategoryLandingPages.ts <tenantId> --only fachboden [--apply] [--live] [--protocol-dir <ordner>]
 *   NODE_ENV=development npx tsx scripts/writeCategoryLandingPages.ts <tenantId> --revert <protokoll.json>
 */
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { storage } from "../server/storage";
import { CATEGORY_LANDING_PAGES, landingProductNumbers, rowFigures, type CategoryLandingPage } from "../server/products/categoryLandingPages";
import { CategoryLandingHtml, categoryLandingCss, landingChannelScript } from "../server/products/categoryLandingPageHtml";
import type { IndustryShopProduct } from "../server/products/industryPageHtml";
import { industryEntityId, landingEntityId } from "../server/shopContent/shopEntityIds";
import { findDeChannel, loadIndustryShopProducts, productProblemText, shopApi } from "../server/shopContent/shopProducts";

const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };
const NO_MARGINS = { marginTop: "0", marginBottom: "0", marginLeft: "0", marginRight: "0" };
// Seitlich ohne Rand: Slider stehen bündig mit dem Theme-Container (wie Überschriften und Bestseller)
const SLIDER_MARGINS = { marginTop: "0", marginBottom: "20px", marginLeft: "0", marginRight: "0" };
/** Gemeinsame FAQ-Gruppe der Branchenseiten (Prüfpflicht, Regal-Lexikon) */
const COMMON_FAQ_GROUP_ID = industryEntityId("common", "faq");
const COMMON_FAQ_QUESTION = "Müssen Regale regelmäßig geprüft werden?";

type FaqQuestion = { id: string; question: string; answer: string; questionPosition: number };
type PageLog = {
  key: string;
  landingPageId: string;
  /** Erlebniswelt der Landingpage vor dem Lauf */
  previousCmsPageId: string;
  cmsPageId: string;
  faqGroupId: string;
  /** Gruppe neu angelegt (Rückbau löscht sie) oder Fragen vor dem Lauf (Rückbau stellt sie her) */
  faqCreated: boolean;
  faqBefore: FaqQuestion[];
  /** Zweiter Lauf: die ursprünglichen Fragen stehen im ersten Protokoll – nur damit zurückbauen */
  faqBeforeInFirstProtocol?: boolean;
};
type Protocol = { tenantId: string; shop: string; at: string; pages: PageLog[] };

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

function buildCmsPage(page: CategoryLandingPage, products: Record<string, IndustryShopProduct>, faqGroupId: string, deChannelId: string) {
  const id = (part: string) => landingEntityId(page.key, part);
  const h = new CategoryLandingHtml(page, products, { notes: false, cartForm: true });
  const wrap = (inner: string) => `<div class="mbp" data-mbp="landing-${page.key}">${inner}</div>`;
  const style = `<style>${categoryLandingCss(".mbp")}</style>`;
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
      products: { source: "static", value: page.productNumbers.map((n) => products[n].id) },
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
  const faqEl = (part: string, position: number, group: string, extra: object = {}) => ({
    id: id(`block-${part}`),
    type: "text",
    position,
    sectionPosition: "main",
    ...SLIDER_MARGINS,
    ...extra,
    visibility: ALL_DEVICES,
    slots: [{ id: id(`slot-${part}`), type: "hueb-faq-element", slot: "content", config: { group: { source: "static", value: group } } }],
  });
  const sections = [
    section("top", 0, "full_width", [htmlBlock(id("block-top"), 0, style + wrap(h.hero() + h.jump() + h.systems() + h.tiles() + h.guide() + h.plan()) + landingChannelScript(deChannelId))]),
    section("products", 1, "boxed", [
      htmlBlock(id("block-products-head"), 0, wrap(`<div class="wrap" style="padding-top:56px">${h.productsHead()}</div>`)),
      { id: id("block-slider"), type: "product-slider", position: 1, sectionPosition: "main", ...SLIDER_MARGINS, visibility: ALL_DEVICES, slots: [sliderSlot] },
    ]),
    section("seo", 2, "full_width", [htmlBlock(id("block-seo"), 0, wrap(h.seo()))]),
    section("faq", 3, "boxed", [
      htmlBlock(id("block-faq-head"), 0, wrap(`<div class="wrap" id="faq" style="padding-top:24px">${h.faqHead()}</div>`)),
      // Eigene und gemeinsame Fragen sollen wie eine Liste aussehen: kein Abstand zwischen den beiden FAQ-Elementen
      faqEl("faq", 1, faqGroupId, { marginBottom: "0" }),
      faqEl("faq-common", 2, COMMON_FAQ_GROUP_ID),
    ]),
    section("bottom", 4, "full_width", [htmlBlock(id("block-bottom"), 0, wrap(`<section id="beratung" style="padding:32px 0 64px"><div class="wrap">${h.advice()}</div></section>`))]),
  ];
  return { id: id("cms"), name: `METAorder Landingpage ${page.name}`, type: "landingpage", sections };
}

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Usage: npx tsx scripts/writeCategoryLandingPages.ts <tenantId> --only fachboden [--apply] [--live] | --revert <protokoll.json>");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const { api, base, isTest } = shopApi(settings);
  const questionsOf = async (groupId: string): Promise<FaqQuestion[]> =>
    (((await api("POST", "search/hueb-seo-faq-questions", { limit: 100, filter: [{ type: "equals", field: "group", value: groupId }] }))?.data ?? []) as any[]).map((q) => ({
      id: q.id,
      question: q.question,
      answer: q.answer,
      questionPosition: q.questionPosition,
    }));
  const live = !isTest;
  if (live && (process.argv.includes("--apply") || process.argv.includes("--revert")) && !process.argv.includes("--live")) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    const later = log.pages.filter((p) => p.faqBeforeInFirstProtocol).map((p) => p.key);
    if (later.length) throw new Error(`Protokoll eines zweiten Laufs (${later.join(", ")}): bitte mit dem ersten Protokoll zurückbauen, dort stehen die ursprünglichen FAQ-Fragen`);
    for (const p of log.pages) {
      await api("PATCH", `landing-page/${p.landingPageId}`, { cmsPageId: p.previousCmsPageId });
      for (const q of await questionsOf(p.faqGroupId)) await api("DELETE", `hueb-seo-faq-questions/${q.id}`);
      if (p.faqCreated) await api("DELETE", `hueb-seo-faq-group/${p.faqGroupId}`).catch((e) => console.log("FAQ-Gruppe", e.message));
      else for (const q of p.faqBefore) await api("POST", "hueb-seo-faq-questions", { ...q, group: p.faqGroupId, name: "ID", active: true });
      if (p.cmsPageId !== p.previousCmsPageId) await api("DELETE", `cms-page/${p.cmsPageId}`).catch((e) => console.log("Layout", e.message));
      console.log(`${p.key}: Landingpage wieder auf ${p.previousCmsPageId}, ${p.faqCreated ? "FAQ-Gruppe gelöscht" : `${p.faqBefore.length} FAQ-Fragen zurück`}`);
    }
    if (isTest) await api("DELETE", "_action/cache").catch(() => undefined);
    return;
  }

  const apply = process.argv.includes("--apply");
  const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  if (only.size === 0) throw new Error("--only <seiten> angeben (z. B. --only fachboden)");
  const pages = CATEGORY_LANDING_PAGES.filter((p) => only.has(p.key));
  if (pages.length !== only.size) throw new Error(`Unbekannte Seite in --only: ${[...only].join(", ")}`);

  const de = await findDeChannel(api, base);
  const loaded = await loadIndustryShopProducts(api, [...new Set(pages.flatMap(landingProductNumbers))], de);
  if (loaded.problems.length) throw new Error(`Artikel nicht verwendbar:\n${loaded.problems.map(productProblemText).join("\n")}`);
  const commonGroup = (await api("POST", "search/hueb-seo-faq-group", { ids: [COMMON_FAQ_GROUP_ID] }))?.data?.[0];
  if (!commonGroup) throw new Error("Gemeinsame FAQ-Gruppe „Sicherheit und Regalprüfung“ fehlt – erst writeIndustryPages.ts laufen lassen");

  const plans = [];
  for (const page of pages) {
    const f = rowFigures(page.guide.example.row);
    if (!f.fits || !f.loadOk || !f.itemOk) throw new Error(`${page.key}: Rechenbeispiel geht nicht auf`);
    const lp = (await api("POST", "search/landing-page", { ids: [page.landingPageId], includes: { landing_page: ["id", "name", "cmsPageId", "url"] } }))?.data?.[0];
    if (!lp) throw new Error(`${page.key}: Landingpage ${page.landingPageId} fehlt im Shop`);
    const cmsId = landingEntityId(page.key, "cms");
    if (lp.cmsPageId !== page.agencyCmsPageId && lp.cmsPageId !== cmsId)
      throw new Error(`${page.key}: Landingpage zeigt auf unbekannte Erlebniswelt ${lp.cmsPageId} (erwartet ${page.agencyCmsPageId}) – im Shop geändert? Nichts geschrieben`);
    const faqGroupId = page.faqGroupId ?? landingEntityId(page.key, "faq");
    const groupExists = Boolean((await api("POST", "search/hueb-seo-faq-group", { ids: [faqGroupId] }))?.data?.[0]);
    if (page.faqGroupId && !groupExists) throw new Error(`${page.key}: FAQ-Gruppe ${page.faqGroupId} fehlt`);
    const cms = buildCmsPage(page, loaded.products, faqGroupId, de.id);
    const questions = page.faq
      .filter((q) => q.q !== COMMON_FAQ_QUESTION)
      .map((q, i) => ({ id: landingEntityId(page.key, `faq-${i}`), group: faqGroupId, name: "ID", active: true, questionPosition: i + 1, question: q.q, answer: q.a }));
    const htmlSize = cms.sections.flatMap((s) => s.blocks).flatMap((b: any) => b.slots).reduce((n: number, sl: any) => n + String(sl.config?.content?.value ?? "").length, 0);
    const replace = lp.cmsPageId === cmsId;
    plans.push({ page, lp, cms, faqGroupId, groupExists, questions, replace });
    console.log(
      `${apply ? "SCHREIBE" : "würde schreiben"} ${de.domain}/${String(lp.url).replace(/^\//, "")} („${lp.name}“): Erlebniswelt ${replace ? "ersetzen" : `neu, statt ${lp.cmsPageId}`}, ${cms.sections.length} Abschnitte, ${page.productNumbers.length} Produkte im Slider, ${questions.length} FAQ in Gruppe ${faqGroupId}${groupExists ? " (bestehend)" : " (neu)"} + gemeinsame Gruppe, HTML ${Math.round(htmlSize / 1024)} KB`,
    );
    for (const l of page.guide.example.lines) {
      const p = loaded.products[l.number];
      console.log(`  Beispiel ${l.qty} × ${p.name} – ${p.priceNet} € netto`);
    }
  }
  if (!apply) return;

  const dir = arg("--protocol-dir") ?? "/app/tmp-claude";
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `landingpages-${tenantId.slice(0, 8)}-${Date.now()}.json`);
  const log: Protocol = { tenantId, shop: base, at: new Date().toISOString(), pages: [] };
  for (const p of plans) {
    const entry: PageLog = {
      key: p.page.key,
      landingPageId: p.page.landingPageId,
      // Beim zweiten Lauf zeigt die Landingpage schon auf die eigene Erlebniswelt: Rückbau geht dann auf die Agentur-Fassung
      previousCmsPageId: p.replace ? p.page.agencyCmsPageId : p.lp.cmsPageId,
      cmsPageId: p.cms.id,
      faqGroupId: p.faqGroupId,
      faqCreated: !p.groupExists,
      faqBefore: p.groupExists ? await questionsOf(p.faqGroupId) : [],
    };
    // Beim zweiten Lauf stehen schon die eigenen Fragen in der Gruppe: die ursprünglichen stehen im ersten Protokoll
    if (p.replace && entry.faqBefore.some((q) => q.id === landingEntityId(p.page.key, "faq-0"))) {
      entry.faqBefore = [];
      entry.faqBeforeInFirstProtocol = true;
    }
    log.pages.push(entry);
    writeFileSync(file, JSON.stringify(log, null, 1));

    if (!p.groupExists) await api("POST", "hueb-seo-faq-group", { id: p.faqGroupId, name: `Landingpage ${p.page.name}`, active: true, position: 50 });
    for (const q of await questionsOf(p.faqGroupId)) await api("DELETE", `hueb-seo-faq-questions/${q.id}`);
    for (const q of p.questions) await api("POST", "hueb-seo-faq-questions", q);
    if (p.replace) {
      // Eigene Erlebniswelt an Ort und Stelle aktualisieren (feste IDs): sie kann im Shop zusätzlich an einer
      // Kategorie hängen (Live: „Alles zu META Büroregalen“), dann verweigert Shopware das Löschen. Danach
      // Abschnitte und Blöcke entfernen, die es im neuen Stand nicht mehr gibt.
      await api("PATCH", `cms-page/${p.cms.id}`, p.cms);
      const keepSections = new Set(p.cms.sections.map((x: any) => x.id));
      const keepBlocks = new Set(p.cms.sections.flatMap((x: any) => x.blocks.map((b: any) => b.id)));
      const current = (await api("POST", "search/cms-section", {
        limit: 100,
        filter: [{ type: "equals", field: "pageId", value: p.cms.id }],
        associations: { blocks: {} },
        includes: { cms_section: ["id", "blocks"], cms_block: ["id"] },
      }))?.data ?? [];
      for (const sec of current) {
        if (!keepSections.has(sec.id)) await api("DELETE", `cms-section/${sec.id}`);
        else for (const b of sec.blocks ?? []) if (!keepBlocks.has(b.id)) await api("DELETE", `cms-block/${b.id}`);
      }
    } else {
      await api("POST", "cms-page", p.cms);
      await api("PATCH", `landing-page/${p.page.landingPageId}`, { cmsPageId: p.cms.id });
    }
    console.log(`${p.page.key}: Erlebniswelt ${p.cms.id} an Landingpage ${p.page.landingPageId} gehängt`);
  }
  console.log(`Protokoll: ${file}`);
  if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
  for (const p of plans) {
    const url = `${de.domain}/${String(p.lp.url).replace(/^\//, "")}${String(p.lp.url).endsWith("/") ? "" : "/"}?mbp=${Date.now()}`;
    const r = await fetch(url);
    const body = await r.text();
    console.log(`${r.status} ${url} – ${body.includes(`data-mbp="landing-${p.page.key}"`) ? "neue Seite sichtbar" : "neue Seite NICHT im HTML (Cache? auf Live ca. 5 min)"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
