/**
 * Regal-Lexikon (server/products/glossary.ts) in den Shop schreiben. Drei Teile, einzeln aufrufbar:
 *
 *   (ohne Schalter)  Seite /regal-lexikon als Erlebniswelt: ein HTML-Element mit eigenem, auf `.mlx` begrenztem
 *                    Stylesheet, Suche/Filter als Script, strukturierte Daten (DefinedTermSet, FAQPage). Kanäle
 *                    META Regalbau DE und META Lagertechnik AT (beide Deutsch, wie die Landingpage Büroregale).
 *   --menu           Menüpunkt „Regal-Lexikon“ in der Hauptnavigation nach „Zubehör“ (Link auf die Seite).
 *                    Die Hauptnavigation teilen sich DE, AT, PL und die Händlerportale.
 *   --seo            Nur die Adresse /regal-lexikon je Kanal prüfen und fehlende setzen (Reparatur).
 *   --faq            Korrigiert die Agentur-Fragen auf /faq (Fachboden-/Palettenregale) nach landingPageTexts.ts
 *                    (faqFixes): „verschweißt“ → geclincht, „Stecksystem“, Schwerlast-Fragen. Nur die Fragen, sonst nichts.
 *
 * Feste IDs (md5 „metaorder-glossary:<teil>“): ein zweiter Lauf ersetzt die eigene Seite. Ohne --apply nur Testlauf.
 * Mit --apply Protokoll; --revert stellt den Stand davor wieder her. Schreibt nur in Shops mit „test.“ in der URL,
 * außer mit --live.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeGlossaryPage.ts <tenantId> [--menu | --faq] [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeGlossaryPage.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import { GLOSSARY_PAGE } from "../server/products/glossary";
import { glossaryShopHtml } from "../server/products/glossaryPageHtml";
import { LANDING_PAGES } from "../server/products/landingPageTexts";
import { DE_LANG, findDeChannel, shopApi, type ShopApi } from "../server/shopContent/shopProducts";

const AT_CHANNEL_NAME = "META Lagertechnik AT";
const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };
const NO_MARGINS = { marginTop: "0", marginBottom: "0", marginLeft: "0", marginRight: "0" };

export const glossaryEntityId = (part: string) => createHash("md5").update(`metaorder-glossary:${part}`).digest("hex");
const LP_ID = glossaryEntityId("lp");
const CMS_ID = glossaryEntityId("cms");
const MENU_ID = glossaryEntityId("menu");

type Protocol = {
  tenantId: string;
  at: string;
  base: string;
  /** Seite: vorher vorhanden (dann wurde sie ersetzt) */
  page?: { replaced: boolean };
  /** Menüpunkt: Nachfolger, dessen Position umgehängt wurde */
  menu?: { categoryId: string; follower: { id: string; afterCategoryId: string | null } | null };
  /** FAQ-Korrekturen: Werte vorher */
  faq?: Array<{ id: string; question: string; answer: string }>;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function findChannel(api: ShopApi, name: string): Promise<{ id: string } | null> {
  const res = await api("POST", "search/sales-channel", { limit: 1, filter: [{ type: "equals", field: "name", value: name }], includes: { sales_channel: ["id"] } });
  return res?.data?.[0] ?? null;
}

function buildCmsPage(html: string) {
  const blockId = glossaryEntityId("block");
  return {
    id: CMS_ID,
    name: "Regal-Lexikon",
    type: "landingpage",
    sections: [
      {
        id: glossaryEntityId("section"),
        type: "default",
        position: 0,
        sizingMode: "full_width",
        mobileBehavior: "wrap",
        visibility: ALL_DEVICES,
        blocks: [
          {
            id: blockId,
            type: "html",
            position: 0,
            sectionPosition: "main",
            ...NO_MARGINS,
            visibility: ALL_DEVICES,
            slots: [{ id: glossaryEntityId("slot"), type: "html", slot: "content", config: { content: { source: "static", value: html } } }],
          },
        ],
      },
    ],
  };
}

/** FAQ-Gruppe einer Landingpage: erstes FAQ-Element im Layout */
async function landingFaqGroup(api: ShopApi, landingPageId: string): Promise<string | null> {
  const lp = (await api("POST", "search/landing-page", { ids: [landingPageId], includes: { landing_page: ["cmsPageId"] } }))?.data?.[0];
  if (!lp?.cmsPageId) return null;
  const sections = (await api("POST", "search/cms-section", { limit: 100, filter: [{ type: "equals", field: "pageId", value: lp.cmsPageId }], associations: { blocks: { associations: { slots: {} } } } }))?.data ?? [];
  const slot = sections.flatMap((s: any) => s.blocks ?? []).flatMap((b: any) => b.slots ?? []).find((x: any) => /hueb-faq/.test(x.type));
  return slot?.config?.group?.value ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Adresse /regal-lexikon je Kanal sicherstellen. Shopware erzeugt die SEO-Adressen einer neuen Landingpage
 * asynchron und hat im Testshop eine direkt danach gesetzte Adresse wieder entfernt. Deshalb: auf den Indexer
 * warten, fehlende Adressen setzen und nach einer Pause erneut prüfen.
 */
async function ensureSeoUrls(api: ShopApi, channels: Array<{ id: string }>, path: string): Promise<void> {
  const current = async () =>
    (((await api("POST", "search/seo-url", {
      limit: 50,
      filter: [{ type: "equals", field: "foreignKey", value: LP_ID }, { type: "equals", field: "isDeleted", value: false }, { type: "equals", field: "isCanonical", value: true }],
      includes: { seo_url: ["seoPathInfo", "salesChannelId"] },
    }))?.data ?? []) as Array<{ seoPathInfo: string; salesChannelId: string }>);
  const missing = async () => {
    const urls = await current();
    return channels.filter((c) => !urls.some((u) => u.salesChannelId === c.id && u.seoPathInfo === path));
  };
  for (let round = 0; round < 3; round++) {
    await sleep(round === 0 ? 15_000 : 10_000);
    const todo = await missing();
    if (!todo.length) break;
    for (const c of todo) {
      await api("PATCH", "_action/seo-url/canonical", {
        foreignKey: LP_ID,
        routeName: "frontend.landing.page",
        pathInfo: `/landingPage/${LP_ID}`,
        seoPathInfo: path,
        salesChannelId: c.id,
        languageId: DE_LANG,
        isModified: true,
      });
    }
    console.log(`  Adresse /${path} gesetzt für ${todo.length} Kanal/Kanäle (Runde ${round + 1})`);
  }
  await sleep(10_000);
  const still = await missing();
  if (still.length) throw new Error(`Adresse /${path} fehlt weiterhin für ${still.map((c) => c.id).join(", ")} – im Admin unter SEO prüfen`);
  console.log(`  Adresse /${path} steht in ${channels.length} Kanälen`);
}

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId || tenantId.startsWith("--")) {
    console.error("Usage: npx tsx scripts/writeGlossaryPage.ts <tenantId> [--menu | --faq] [--apply] [--live] | --revert <protokoll.json> [--live]");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const { api, base, isTest } = shopApi(settings);
  const live = process.argv.includes("--live");
  const de = await findDeChannel(api, base);
  const navRoot = de.navigationCategoryId;
  if (!navRoot) throw new Error("Hauptnavigation des DE-Kanals nicht gefunden");

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    if (!isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
    if (log.menu) {
      if (log.menu.follower) await api("PATCH", `category/${log.menu.follower.id}`, { afterCategoryId: log.menu.follower.afterCategoryId });
      await api("DELETE", `category/${log.menu.categoryId}`).catch((e) => console.log("Menüpunkt", e.message));
      console.log("Menüpunkt entfernt");
    }
    if (log.page) {
      await api("DELETE", `landing-page/${LP_ID}`).catch((e) => console.log("Seite", e.message));
      await api("DELETE", `cms-page/${CMS_ID}`).catch((e) => console.log("Layout", e.message));
      console.log("Seite entfernt");
    }
    for (const q of log.faq ?? []) await api("PATCH", `hueb-seo-faq-questions/${q.id}`, { question: q.question, answer: q.answer });
    if (log.faq?.length) console.log(`FAQ zurückgesetzt: ${log.faq.length} Fragen`);
    if (isTest) await api("DELETE", "_action/cache").catch(() => undefined);
    return;
  }

  const apply = process.argv.includes("--apply");
  if (apply && !isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
  const log: Protocol = { tenantId, at: new Date().toISOString(), base };
  const file = `/app/tmp-claude/regal-lexikon-${process.argv.includes("--menu") ? "menu" : process.argv.includes("--faq") ? "faq" : "seite"}-${tenantId.slice(0, 8)}-${Date.now()}.json`;
  const save = () => writeFileSync(file, JSON.stringify(log, null, 1));

  // ───────── Menüpunkt ─────────
  if (process.argv.includes("--menu")) {
    const lp = (await api("POST", "search/landing-page", { ids: [LP_ID], includes: { landing_page: ["id", "active"] } }))?.data?.[0];
    if (!lp?.active) throw new Error(`Seite ${GLOSSARY_PAGE.url} fehlt im Shop – erst ohne --menu schreiben`);
    const siblings = ((await api("POST", "search/category", { limit: 100, filter: [{ type: "equals", field: "parentId", value: navRoot }], includes: { category: ["id", "name", "afterCategoryId", "active"] } }))?.data ?? []) as any[];
    const own = siblings.find((c) => c.id === MENU_ID);
    if (own) return console.log(`Menüpunkt „${GLOSSARY_PAGE.menuName}“ ist schon da (nach ${siblings.find((c) => c.id === own.afterCategoryId)?.name ?? own.afterCategoryId}) – nichts zu tun`);
    const anchor = siblings.find((c) => c.name === "Zubehör");
    if (!anchor) throw new Error("Menüpunkt „Zubehör“ nicht gefunden");
    const follower = siblings.find((c) => c.afterCategoryId === anchor.id) ?? null;
    console.log(`${apply ? "LEGE AN" : "würde anlegen"} Menüpunkt „${GLOSSARY_PAGE.menuName}“ nach „${anchor.name}“${follower ? `, „${follower.name}“ rückt dahinter` : ""}`);
    if (!apply) return;
    log.menu = { categoryId: MENU_ID, follower: follower ? { id: follower.id, afterCategoryId: follower.afterCategoryId ?? null } : null };
    save();
    await api("POST", "category", {
      id: MENU_ID,
      parentId: navRoot,
      afterCategoryId: anchor.id,
      name: GLOSSARY_PAGE.menuName,
      type: "link",
      linkType: "landing_page",
      internalLink: LP_ID,
      linkNewTab: false,
      active: true,
      visible: true,
      displayNestedProducts: false,
    });
    if (follower) await api("PATCH", `category/${follower.id}`, { afterCategoryId: MENU_ID });
    console.log(`Protokoll: ${file}`);
    if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
    const body = await (await fetch(`${de.domain}/?mlx=${Date.now()}`)).text();
    console.log(`Menüpunkt ${body.includes(GLOSSARY_PAGE.url) ? "auf der Startseite verlinkt" : "noch NICHT im HTML (Cache?)"}`);
    return;
  }

  // ───────── FAQ-Korrekturen der Agentur-Fragen ─────────
  if (process.argv.includes("--faq")) {
    const updates: Array<{ id: string; question: string; answer: string; old: { question: string; answer: string } }> = [];
    for (const cfg of LANDING_PAGES.filter((c) => c.faqFixes?.length)) {
      const groupId = await landingFaqGroup(api, cfg.landingPageId);
      if (!groupId) {
        console.log(`  ${cfg.key}: keine FAQ-Gruppe auf der Landingpage`);
        continue;
      }
      const questions = ((await api("POST", "search/hueb-seo-faq-questions", { limit: 50, filter: [{ type: "equals", field: "group", value: groupId }] }))?.data ?? []) as any[];
      for (const fix of cfg.faqFixes ?? []) {
        const q = questions.find((x) => fix.question.test(String(x.translated?.question ?? x.question ?? "").replace(/\s+/g, " ").trim()));
        if (!q) {
          console.log(`  ${cfg.key}: „${fix.question.source}“ nicht gefunden (schon korrigiert?)`);
          continue;
        }
        const old = { question: String(q.translated?.question ?? q.question ?? ""), answer: String(q.translated?.answer ?? q.answer ?? "") };
        const next = { question: fix.newQuestion ?? old.question, answer: fix.newAnswer ?? old.answer };
        if (next.question === old.question && next.answer === old.answer) continue;
        updates.push({ id: q.id, ...next, old });
      }
    }
    for (const u of updates) console.log(`${apply ? "SCHREIBE" : "würde schreiben"} FAQ „${u.old.question}“${u.question !== u.old.question ? ` → „${u.question}“` : ""}${u.answer !== u.old.answer ? " (neue Antwort)" : ""}`);
    if (!updates.length) console.log("Keine FAQ-Korrektur nötig");
    if (!apply || !updates.length) return;
    log.faq = updates.map((u) => ({ id: u.id, ...u.old }));
    save();
    for (const u of updates) await api("PATCH", `hueb-seo-faq-questions/${u.id}`, { question: u.question, answer: u.answer });
    console.log(`Protokoll: ${file}`);
    if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
    return;
  }

  // ───────── Seite ─────────
  const at = await findChannel(api, AT_CHANNEL_NAME);
  const channels = [de, ...(at ? [at] : [])];
  const path = GLOSSARY_PAGE.url.replace(/^\//, "");
  if (process.argv.includes("--seo")) {
    if (!apply) return console.log(`würde Adresse /${path} in ${channels.length} Kanälen prüfen und setzen`);
    return ensureSeoUrls(api, channels, path);
  }
  const taken = ((await api("POST", "search/seo-url", {
    limit: 20,
    filter: [{ type: "equals", field: "seoPathInfo", value: path }, { type: "equalsAny", field: "salesChannelId", value: channels.map((c) => c.id) }, { type: "equals", field: "isDeleted", value: false }],
    includes: { seo_url: ["seoPathInfo", "foreignKey", "routeName"] },
  }))?.data ?? []) as any[];
  const conflicts = taken.filter((u) => u.foreignKey !== LP_ID);
  if (conflicts.length) throw new Error(`Adresse schon vergeben: ${conflicts.map((u) => `/${u.seoPathInfo} (${u.routeName})`).join(", ")}`);
  const existing = (await api("POST", "search/landing-page", { ids: [LP_ID], includes: { landing_page: ["id"] } }))?.data?.[0];
  const html = glossaryShopHtml({ pageUrl: de.domain + GLOSSARY_PAGE.url });
  const cms = buildCmsPage(html);
  const landingPage = {
    id: LP_ID,
    name: GLOSSARY_PAGE.name,
    active: true,
    url: path,
    metaTitle: GLOSSARY_PAGE.metaTitle,
    metaDescription: GLOSSARY_PAGE.metaDescription,
    salesChannels: channels.map((c) => ({ id: c.id })),
    cmsPageId: CMS_ID,
  };
  console.log(
    `${apply ? (existing ? "ERSETZE" : "LEGE AN") : existing ? "würde ersetzen" : "würde anlegen"} ${de.domain}${GLOSSARY_PAGE.url} – HTML ${Math.round(html.length / 1024)} KB, Kanäle ${[de.name, at ? AT_CHANNEL_NAME : null].filter(Boolean).join(", ")}`,
  );
  if (!apply) return;
  log.page = { replaced: !!existing };
  save();
  if (existing) {
    await api("DELETE", `landing-page/${LP_ID}`);
    await api("DELETE", `cms-page/${CMS_ID}`).catch((e) => console.log("Layout", e.message));
  }
  await api("POST", "cms-page", cms);
  await api("POST", "landing-page", landingPage);
  await ensureSeoUrls(api, channels, path);
  console.log(`Protokoll: ${file}`);
  if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
  const r = await fetch(`${de.domain}${GLOSSARY_PAGE.url}?mlx=${Date.now()}`, { redirect: "manual" });
  const body = await r.text();
  console.log(`${r.status} ${de.domain}${GLOSSARY_PAGE.url} – ${body.includes('class="mlx"') ? "Lexikon im HTML" : "Lexikon NICHT im HTML"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
