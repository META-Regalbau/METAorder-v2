/**
 * Legt die Service-Seiten (server/products/servicePages.ts) im Shop an: „Montageanleitungen und Videos“ und
 * „Montageservice“ (mit Shopware-Kontaktformular), je als Erlebniswelt + Landingpage mit fester Adresse
 * (/service/montageanleitungen, /service/montageservice), dazu zwei Menüpunkte unter „Service“.
 * Kanäle wie die System-Landingpages (META Regalbau DE und META Lagertechnik AT).
 *
 * Alle Entitäten sind neu und haben feste IDs (serviceEntityId): ein zweiter Lauf ersetzt die eigenen Seiten,
 * Menüpunkte werden nur einmal angelegt. Ohne --apply nur Testlauf; Protokoll; --revert löscht alles wieder
 * und stellt die Menü-Reihenfolge her. Schreibt nur in Shops mit „test.“ in der URL, außer mit --live.
 *
 * Aufruf (lokal mit Docker-DB oder im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeServicePages.ts <tenantId> [--apply] [--live] [--protocol-dir <ordner>]
 *   NODE_ENV=development npx tsx scripts/writeServicePages.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { storage } from "../server/storage";
import { CATEGORY_LANDING_PAGES } from "../server/products/categoryLandingPages";
import { SERVICE_PAGES, type ServicePage } from "../server/products/servicePages";
import { instructionsPageHtml, montageServiceBottomHtml, montageServiceTopHtml, servicePageCss, servicePageScript } from "../server/products/servicePageHtml";
import { serviceEntityId } from "../server/shopContent/shopEntityIds";
import { DE_LANG, findDeChannel, shopApi, type ShopApi } from "../server/shopContent/shopProducts";

const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };
const NO_MARGINS = { marginTop: "0", marginBottom: "0", marginLeft: "0", marginRight: "0" };
/** Menüpunkt „Service“ und sein bisher letzter Unterpunkt „Reklamation und Retouren“ (Live und Testing gleich) */
const SERVICE_CATEGORY_NAME = "Service";
const AFTER_CATEGORY_NAME = "Reklamation und Retouren";

type Protocol = {
  tenantId: string;
  shop: string;
  at: string;
  landingPages: string[];
  cmsPages: string[];
  categories: string[];
  /** Unterpunkt, der hinter die neuen Menüpunkte gerückt ist (Rückbau stellt afterCategoryId her) */
  follower?: { id: string; afterCategoryId: string | null } | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

function buildCmsPage(page: ServicePage) {
  const id = (part: string) => serviceEntityId(page.key, part);
  const style = `<style>${servicePageCss(".mbp")}</style>`;
  const wrap = (inner: string) => `<div class="mbp" data-mbp="service-${page.key}">${inner}</div>`;
  const section = (part: string, position: number, sizingMode: "full_width" | "boxed", blocks: any[]) => ({
    id: id(`section-${part}`),
    type: "default",
    position,
    sizingMode,
    mobileBehavior: "wrap",
    visibility: ALL_DEVICES,
    blocks,
  });
  const sections =
    page.key === "anleitungen"
      ? [section("main", 0, "full_width", [htmlBlock(id("block-main"), 0, style + wrap(instructionsPageHtml()) + servicePageScript())])]
      : [
          section("top", 0, "full_width", [htmlBlock(id("block-top"), 0, style + wrap(montageServiceTopHtml()) + servicePageScript())]),
          section("form", 1, "boxed", [
            {
              id: id("block-form"),
              type: "form",
              position: 0,
              sectionPosition: "main",
              marginTop: "0",
              marginBottom: "40px",
              marginLeft: "20px",
              marginRight: "20px",
              visibility: ALL_DEVICES,
              slots: [
                {
                  id: id("slot-form"),
                  type: "form",
                  slot: "content",
                  config: {
                    type: { source: "static", value: "contact" },
                    title: { source: "static", value: "" },
                    mailReceiver: { source: "static", value: [] },
                    defaultMailReceiver: { source: "static", value: true },
                    confirmationText: { source: "static", value: "Vielen Dank für Ihre Anfrage zum Montageservice. Wir melden uns und stimmen Umfang und Termin mit Ihnen ab." },
                  },
                },
              ],
            },
          ]),
          section("bottom", 2, "full_width", [htmlBlock(id("block-bottom"), 0, wrap(montageServiceBottomHtml()))]),
        ];
  return { id: id("cms"), name: `METAorder Service ${page.name}`, type: "landingpage", sections };
}

/** Shopware macht aus "service/x" automatisch "service-x": gewünschte Adresse setzen und nach dem Indexer nachsetzen */
async function ensureSeoUrl(api: ShopApi, lpId: string, seoPath: string, channelIds: string[]): Promise<void> {
  const missing = async () => {
    const urls = (((await api("POST", "search/seo-url", {
      limit: 50,
      filter: [{ type: "equals", field: "foreignKey", value: lpId }, { type: "equals", field: "isDeleted", value: false }, { type: "equals", field: "isCanonical", value: true }],
      includes: { seo_url: ["seoPathInfo", "salesChannelId"] },
    }))?.data ?? []) as Array<{ seoPathInfo: string; salesChannelId: string }>);
    return channelIds.filter((c) => !urls.some((u) => u.salesChannelId === c && u.seoPathInfo === seoPath));
  };
  for (let round = 0; round < 3; round++) {
    await sleep(round === 0 ? 15_000 : 10_000);
    const todo = await missing();
    if (!todo.length) break;
    for (const c of todo)
      await api("PATCH", "_action/seo-url/canonical", { foreignKey: lpId, routeName: "frontend.landing.page", pathInfo: `/landingPage/${lpId}`, seoPathInfo: seoPath, salesChannelId: c, languageId: DE_LANG, isModified: true });
    console.log(`  Adresse /${seoPath} gesetzt für ${todo.length} Kanal/Kanäle (Runde ${round + 1})`);
  }
  await sleep(10_000);
  const still = await missing();
  if (still.length) throw new Error(`Adresse /${seoPath} fehlt weiterhin für ${still.join(", ")} – im Admin unter SEO prüfen`);
}

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Usage: npx tsx scripts/writeServicePages.ts <tenantId> [--apply] [--live] | --revert <protokoll.json> [--live]");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const { api, base, isTest } = shopApi(settings);
  if (!isTest && (process.argv.includes("--apply") || process.argv.includes("--revert")) && !process.argv.includes("--live")) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    if (log.follower) await api("PATCH", `category/${log.follower.id}`, { afterCategoryId: log.follower.afterCategoryId });
    for (const id of [...log.categories].reverse()) await api("DELETE", `category/${id}`).catch((e) => console.log("Menüpunkt", e.message));
    for (const id of log.landingPages) await api("DELETE", `landing-page/${id}`).catch((e) => console.log("Landingpage", e.message));
    for (const id of log.cmsPages) await api("DELETE", `cms-page/${id}`).catch((e) => console.log("Layout", e.message));
    if (isTest) await api("DELETE", "_action/cache").catch(() => undefined);
    console.log(`Zurückgebaut: ${log.landingPages.length} Seiten, ${log.categories.length} Menüpunkte`);
    return;
  }

  const apply = process.argv.includes("--apply");
  const de = await findDeChannel(api, base);
  // Kanäle wie die Fachboden-Landingpage (DE und AT)
  const ref = (await api("POST", "search/landing-page", { ids: [CATEGORY_LANDING_PAGES[0].landingPageId], associations: { salesChannels: {} }, includes: { landing_page: ["salesChannels"], sales_channel: ["id", "name"] } }))?.data?.[0];
  const channels = ((ref?.salesChannels ?? []) as Array<{ id: string; name: string }>).filter((c) => c.id);
  if (!channels.some((c) => c.id === de.id)) throw new Error("Referenz-Landingpage hängt nicht am DE-Kanal");

  const serviceCat = ((await api("POST", "search/category", { limit: 5, filter: [{ type: "equals", field: "name", value: SERVICE_CATEGORY_NAME }, { type: "equals", field: "parentId", value: de.navigationCategoryId }], includes: { category: ["id", "name"] } }))?.data ?? [])[0];
  if (!serviceCat) throw new Error("Menüpunkt „Service“ nicht gefunden");
  const kids = ((await api("POST", "search/category", { limit: 50, filter: [{ type: "equals", field: "parentId", value: serviceCat.id }], includes: { category: ["id", "name", "afterCategoryId"] } }))?.data ?? []) as any[];

  const ownLp = SERVICE_PAGES.map((p) => serviceEntityId(p.key, "lp"));
  const taken = ((await api("POST", "search/seo-url", {
    limit: 20,
    filter: [{ type: "equalsAny", field: "seoPathInfo", value: SERVICE_PAGES.map((p) => p.url) }, { type: "equals", field: "isDeleted", value: false }],
    includes: { seo_url: ["seoPathInfo", "foreignKey", "routeName"] },
  }))?.data ?? []) as any[];
  const conflicts = taken.filter((u) => !ownLp.includes(u.foreignKey));
  if (conflicts.length) throw new Error(`Adresse schon vergeben: ${conflicts.map((u) => `/${u.seoPathInfo} (${u.routeName})`).join(", ")}`);
  const existing = new Set(((await api("POST", "search/landing-page", { ids: ownLp, includes: { landing_page: ["id"] } }))?.data ?? []).map((x: any) => x.id));

  const plans = SERVICE_PAGES.map((page) => {
    const cms = buildCmsPage(page);
    const lpId = serviceEntityId(page.key, "lp");
    const landingPage = { id: lpId, name: page.name, active: true, url: page.url, metaTitle: page.metaTitle, metaDescription: page.metaDescription, salesChannels: channels.map((c) => ({ id: c.id })), cmsPageId: cms.id };
    const size = JSON.stringify(cms).length;
    console.log(`${apply ? (existing.has(lpId) ? "ERSETZE" : "LEGE AN") : existing.has(lpId) ? "würde ersetzen" : "würde anlegen"} ${de.domain}/${page.url} – ${cms.sections.length} Abschnitt(e), ${Math.round(size / 1024)} KB, Kanäle ${channels.map((c) => c.name).join(", ")}`);
    return { page, cms, lpId, landingPage, replace: existing.has(lpId) };
  });
  const menu = SERVICE_PAGES.map((p) => ({ id: serviceEntityId(p.key, "menu"), page: p }));
  const missingMenu = menu.filter((m) => !kids.some((k) => k.id === m.id));
  const anchor = kids.find((k) => k.name === AFTER_CATEGORY_NAME);
  if (missingMenu.length && !anchor) throw new Error(`Unterpunkt „${AFTER_CATEGORY_NAME}“ unter Service nicht gefunden`);
  const follower = anchor ? kids.find((k) => k.afterCategoryId === anchor.id && !menu.some((m) => m.id === k.id)) ?? null : null;
  console.log(
    missingMenu.length
      ? `${apply ? "LEGE AN" : "würde anlegen"} Menüpunkte unter „Service“ nach „${AFTER_CATEGORY_NAME}“: ${missingMenu.map((m) => `„${m.page.menuName}“`).join(", ")}${follower ? `; „${follower.name}“ rückt dahinter` : ""}`
      : "Menüpunkte unter „Service“ sind schon da",
  );
  if (!apply) return;

  const dir = arg("--protocol-dir") ?? "/app/tmp-claude";
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `service-seiten-${tenantId.slice(0, 8)}-${Date.now()}.json`);
  const log: Protocol = { tenantId, shop: base, at: new Date().toISOString(), landingPages: [], cmsPages: [], categories: [] };
  const save = () => writeFileSync(file, JSON.stringify(log, null, 1));
  save();
  for (const p of plans) {
    if (p.replace) {
      await api("DELETE", `landing-page/${p.lpId}`);
      await api("DELETE", `cms-page/${p.cms.id}`).catch(() => undefined);
    }
    await api("POST", "cms-page", p.cms);
    log.cmsPages.push(p.cms.id);
    save();
    await api("POST", "landing-page", p.landingPage);
    log.landingPages.push(p.lpId);
    save();
    console.log(`${p.page.key}: Seite angelegt`);
  }
  if (missingMenu.length) {
    log.follower = follower ? { id: follower.id, afterCategoryId: follower.afterCategoryId ?? null } : null;
    let after = anchor!.id;
    for (const m of menu) {
      if (!missingMenu.includes(m)) {
        after = m.id;
        continue;
      }
      await api("POST", "category", {
        id: m.id,
        parentId: serviceCat.id,
        afterCategoryId: after,
        name: m.page.menuName,
        type: "link",
        linkType: "landing_page",
        internalLink: serviceEntityId(m.page.key, "lp"),
        linkNewTab: false,
        active: true,
        visible: true,
        displayNestedProducts: false,
      });
      log.categories.push(m.id);
      save();
      after = m.id;
    }
    if (follower) await api("PATCH", `category/${follower.id}`, { afterCategoryId: after });
  }
  for (const p of plans) await ensureSeoUrl(api, p.lpId, p.page.url, channels.map((c) => c.id));
  console.log(`Protokoll: ${file}`);
  if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
  for (const p of plans) {
    const r = await fetch(`${de.domain}/${p.page.url}?mbp=${Date.now()}`);
    const body = await r.text();
    console.log(`${r.status} ${de.domain}/${p.page.url} – ${body.includes(`data-mbp="service-${p.page.key}"`) ? "sichtbar" : "NICHT im HTML (Cache?)"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
