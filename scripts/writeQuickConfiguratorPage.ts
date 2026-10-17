/**
 * Legt die Seite /regal-schnellkonfigurator (Erlebniswelt) im Shop an und lädt die Artikeltabelle des
 * Schnellkonfigurators als Datei in die Shop-Medien (server/shopContent/quickConfiguratorCatalog.ts).
 * Das Formular selbst kommt aus shopware/storefront-snippets/quick-configurator.js
 * (scripts/writeQuickConfigurator.ts) und liest die Tabelle aus dem Attribut data-catalog der Seite.
 *
 * Die Tabelle ist ein Stand: Kommen Regale dazu oder fallen weg, das Skript erneut ausführen
 * (ersetzt Datei und Seite, das Theme muss dafür nicht neu erstellt werden), danach auch --home.
 *
 * --home: kleines Formular als eigener Abschnitt auf der Startseite (vor „META Bestseller“, nur im DE-Kanal
 * über moorl_section_config). Es enthält die Auswahlwerte je Regalart (nicht die ganze Tabelle) und führt
 * zur Seite. Ein zweiter Lauf ersetzt nur den eigenen Abschnitt; --revert entfernt ihn und schiebt die
 * folgenden Abschnitte zurück.
 *
 * Alle Entitäten haben feste IDs: ein zweiter Lauf ersetzt die eigenen, fremde Inhalte bleiben unberührt.
 * Ohne --apply nur Testlauf. Mit --apply Protokoll im Arbeitsverzeichnis; --revert löscht Seite, Layout und
 * Datei bzw. den Startseiten-Abschnitt wieder (alles eigene Entitäten). Schreibt nur in Shops mit „test.“ in der URL, außer mit --live.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeQuickConfiguratorPage.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeQuickConfiguratorPage.ts <tenantId> --home [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeQuickConfiguratorPage.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import { CONTACT } from "../server/products/industryPages";
import { buildQuickConfigCatalog, loadQuickConfigProducts, quickConfigSummary, type QuickConfigCatalog } from "../server/shopContent/quickConfiguratorCatalog";
import { DE_LANG, findDeChannel, shopApi } from "../server/shopContent/shopProducts";

const PAGE_URL = "regal-schnellkonfigurator";
const FILE_NAME = "metaorder-regal-schnellkonfigurator";
const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };

const qcId = (part: string) => createHash("md5").update(`metaorder-quick-config:${part}`).digest("hex");
const IDS = {
  media: qcId("catalog"),
  lp: qcId("lp"),
  cms: qcId("cms"),
  section: qcId("section"),
  block: qcId("block"),
  slot: qcId("slot"),
  homeSection: qcId("home-section"),
  homeBlock: qcId("home-block"),
};

type Protocol = {
  tenantId: string;
  at: string;
  base: string;
  created?: { media: boolean; landingPage: boolean; cmsPage: boolean };
  /** Startseiten-Abschnitt (--home): Layout und Position */
  home?: { pageId: string; sectionId: string; position: number; replaced: boolean };
};

const KIND_LABELS: Record<string, string> = {
  fachboden: "Fachbodenregale",
  palette: "Palettenregale",
  weitspann: "Weitspannregale",
  kragarm: "Kragarmregale",
  grossfach: "Großfachregale",
  buero: "Büroregale",
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function pageHtml(catalogUrl: string, count: number): string {
  return `<style>
.meta-qc-page{max-width:1100px;margin:0 auto;padding:32px 16px 56px;color:#121212;font-size:15px;line-height:1.5}
.meta-qc-page h1{margin:0 0 12px;color:#121212;font-size:32px;line-height:1.2;font-weight:700}
.meta-qc-page .meta-qc-page__lead{max-width:760px;margin:0 0 24px;font-size:17px}
.meta-qc-page h2{margin:40px 0 12px;color:#121212;font-size:22px;font-weight:700}
.meta-qc-page ul{margin:0 0 16px;padding-left:20px}
.meta-qc-page li{margin:0 0 6px}
.meta-qc-page a{color:#121212;text-decoration:underline}
@media (max-width:575px){.meta-qc-page{padding-top:20px}.meta-qc-page h1{font-size:26px}}
</style>
<div class="meta-qc-page">
<h1>Regal-Schnellkonfigurator</h1>
<p class="meta-qc-page__lead">Regalzeile berechnen für Fachboden-, Paletten-, Weitspann-, Kragarm-, Großfach- und Büroregale: Regalart wählen, Höhe, Breite, Tiefe, Last und die verfügbare Länge eingeben. Der Schnellkonfigurator stellt Grund- und Anbauregale zusammen, zeigt Gesamtlänge und Preis und legt die ganze Zeile mit einem Klick in den Warenkorb.</p>
<div class="meta-qc" data-meta-quick-config data-catalog="${esc(catalogUrl)}" data-count="${count}">
<p>Der Schnellkonfigurator wird geladen …</p>
<noscript><p>Für den Schnellkonfigurator bitte JavaScript einschalten. Alle Regale finden Sie über das Menü.</p></noscript>
</div>
<h2>So wird gerechnet</h2>
<ul>
<li>Eine Regalzeile beginnt mit einem Grundregal. Jedes weitere Feld ist ein Anbauregal, das am vorhandenen Regal angebaut wird.</li>
<li>Die Gesamtlänge ergibt sich aus den Feldbreiten und den Ständern bzw. Rahmen des jeweiligen Systems; die Zeile wird nie länger als die angegebene Länge.</li>
<li>Passt die Länge mit gemischten Feldbreiten besser, zeigt der Schnellkonfigurator diese Zeile zusätzlich an.</li>
<li>Gibt es eine Last in Ihrer Kombination nicht, wird die nächsthöhere angeboten.</li>
<li>Bei Palettenregalen geben Sie das Gewicht je Palette ein; angeboten werden Ausführungen, deren Last je Palettenplatz dafür reicht.</li>
<li>Doppelregale sind von beiden Seiten zugänglich und werden Rücken an Rücken aufgebaut.</li>
</ul>
<h2>Andere Maße oder ganze Lagereinrichtung?</h2>
<p>Für Sonderhöhen, Zubehör oder die Planung eines ganzen Lagers erreichen Sie uns unter <a href="tel:${esc(CONTACT.tel)}">${esc(CONTACT.phone)}</a> (${esc(CONTACT.hours)}) oder per E-Mail an <a href="mailto:${esc(CONTACT.mail)}">${esc(CONTACT.mail)}</a>.</p>
</div>`;
}

function homeHtml(catalog: QuickConfigCatalog): string {
  const options = quickConfigSummary(catalog);
  return `<style>
.meta-qc-home{padding:40px 0;background:#fff;border-bottom:1px solid #e3e3e3}
.meta-qc-home__inner{max-width:1280px;margin:0 auto;padding:0 20px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:24px 40px;align-items:start}
.meta-qc-home h2{margin:0 0 10px;color:#121212;font-size:26px;line-height:1.25;font-weight:700}
.meta-qc-home__intro p{margin:0;color:#2b2b2b;font-size:15px;line-height:1.5}
@media (max-width:991px){.meta-qc-home__inner{grid-template-columns:1fr}}
@media (max-width:575px){.meta-qc-home{padding:28px 0}.meta-qc-home h2{font-size:22px}}
</style>
<section class="meta-qc-home" data-meta-quick-config-home data-options="${esc(JSON.stringify(options))}" aria-labelledby="meta-qc-home-heading">
<div class="meta-qc-home__inner">
<div class="meta-qc-home__intro">
<h2 id="meta-qc-home-heading">Regal in einer Minute konfigurieren</h2>
<p>Regalart, Maße und verfügbare Länge eingeben – der Schnellkonfigurator stellt Grund- und Anbauregale zusammen, zeigt Ihren Preis und legt die ganze Regalzeile direkt in den Warenkorb.</p>
</div>
<form class="meta-qc-home__form" action="/${PAGE_URL}" method="get"><a class="btn btn-primary" href="/${PAGE_URL}">Zum Schnellkonfigurator</a></form>
</div>
</section>`;
}

function cmsPage(html: string) {
  return {
    id: IDS.cms,
    name: "Regal-Schnellkonfigurator",
    type: "landingpage",
    sections: [
      {
        id: IDS.section,
        type: "default",
        position: 0,
        sizingMode: "full_width",
        mobileBehavior: "wrap",
        visibility: ALL_DEVICES,
        blocks: [
          {
            id: IDS.block,
            type: "html",
            position: 0,
            sectionPosition: "main",
            marginTop: "0",
            marginBottom: "0",
            marginLeft: "0",
            marginRight: "0",
            visibility: ALL_DEVICES,
            slots: [{ id: IDS.slot, type: "html", slot: "content", config: { content: { source: "static", value: html } } }],
          },
        ],
      },
    ],
  };
}

async function exists(api: (m: string, p: string, b?: unknown) => Promise<any>, entity: string, id: string): Promise<boolean> {
  const res = await api("POST", `search/${entity}`, { ids: [id], includes: { [entity.replace(/-/g, "_")]: ["id"] } });
  return (res?.data ?? []).length > 0;
}

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId || tenantId.startsWith("--")) {
    console.error("Usage: npx tsx scripts/writeQuickConfiguratorPage.ts <tenantId> [--apply] [--live] | --revert <protokoll.json>");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const { api, base, isTest } = shopApi(settings);
  const live = process.argv.includes("--live");
  const de = await findDeChannel(api, base);
  if (!isTest && !live && (process.argv.includes("--apply") || arg("--revert"))) {
    throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
  }

  const homeSections = async (pageId: string): Promise<any[]> =>
    ((await api("POST", "search/cms-section", {
      limit: 100,
      filter: [{ type: "equals", field: "pageId", value: pageId }],
      associations: { blocks: {} },
      includes: { cms_section: ["id", "position", "blocks"], cms_block: ["type"] },
    }))?.data ?? []).sort((x: any, y: any) => x.position - y.position);

  async function writeHome(catalog: QuickConfigCatalog) {
    // Die Seite muss es im Ziel-Shop geben, sonst führt das Formular ins Leere
    if (!(await exists(api, "landing-page", IDS.lp))) throw new Error(`/${PAGE_URL} fehlt im Shop – erst ohne --home schreiben`);
    const pageId =
      de.homeCmsPageId ?? (await api("POST", "search/category", { ids: [de.navigationCategoryId], includes: { category: ["cmsPageId"] } }))?.data?.[0]?.cmsPageId;
    if (!pageId) throw new Error("Layout der Startseite nicht gefunden");
    const secs = await homeSections(pageId);
    const existing = secs.find((x: any) => x.id === IDS.homeSection);
    const bestseller = secs.find((x: any) => x.id !== IDS.homeSection && (x.blocks ?? []).some((bl: any) => bl.type === "ssik-extra-products"));
    if (!existing && !bestseller) throw new Error("Abschnitt „META Bestseller“ (ssik-extra-products) auf der Startseite nicht gefunden");
    const position = existing ? existing.position : bestseller.position;
    const html = homeHtml(catalog);
    console.log(
      `${process.argv.includes("--apply") ? (existing ? "ERSETZE" : "LEGE AN") : existing ? "würde ersetzen" : "würde anlegen"} Startseiten-Formular an Position ${position} (vor „META Bestseller“), nur Kanal ${de.name}, HTML ${Math.round(html.length / 1024)} KB`,
    );
    if (!process.argv.includes("--apply")) {
      console.log("Testlauf – mit --apply schreiben");
      return;
    }
    const log: Protocol = { tenantId, at: new Date().toISOString(), base, home: { pageId, sectionId: IDS.homeSection, position, replaced: !!existing } };
    const file = `Schnellkonfigurator-Startseite-Protokoll-${isTest ? "Testing" : "Live"}-${log.at.slice(0, 16).replace(":", "-")}.json`;
    writeFileSync(file, JSON.stringify(log, null, 2));
    console.log(`Protokoll: ${file}`);
    if (existing) await api("DELETE", `cms-section/${IDS.homeSection}`);
    else for (const x of [...secs].reverse().filter((x: any) => x.position >= position)) await api("PATCH", `cms-section/${x.id}`, { position: x.position + 1 });
    await api("POST", "cms-section", {
      id: IDS.homeSection,
      pageId,
      type: "default",
      position,
      sizingMode: "full_width",
      mobileBehavior: "wrap",
      visibility: ALL_DEVICES,
      // Startseiten-Layout teilen sich mehrere Kanäle, der Konfigurator gehört nur zum DE-Shop
      customFields: { moorl_section_config: { color: null, salesChannel: [de.id] } },
      blocks: [
        {
          id: IDS.homeBlock,
          type: "html",
          position: 0,
          sectionPosition: "main",
          marginTop: "0",
          marginBottom: "0",
          marginLeft: "0",
          marginRight: "0",
          visibility: ALL_DEVICES,
          slots: [{ id: qcId("home-slot"), type: "html", slot: "content", config: { content: { source: "static", value: html } } }],
        },
      ],
    });
    if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
    const r = await fetch(`${de.domain}/`);
    const body = await r.text();
    console.log(`${r.status} ${de.domain}/ – Formular ${body.includes("data-meta-quick-config-home") ? "im HTML" : "NICHT im HTML (Cache?)"}`);
  }

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    if (log.home) {
      await api("DELETE", `cms-section/${log.home.sectionId}`).catch((e) => console.log("Abschnitt", e.message));
      if (!log.home.replaced) {
        for (const x of (await homeSections(log.home.pageId)).filter((x: any) => x.position > log.home!.position)) {
          await api("PATCH", `cms-section/${x.id}`, { position: x.position - 1 });
        }
      }
      console.log("Startseiten-Abschnitt entfernt");
      if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
      return;
    }
    // Seite, Layout und Datei gehören nur diesem Skript (feste IDs): beim Rückbau immer alle drei löschen
    await api("DELETE", `landing-page/${IDS.lp}`).catch((e) => console.log("Seite", e.message));
    await api("DELETE", `cms-page/${IDS.cms}`).catch((e) => console.log("Layout", e.message));
    await api("DELETE", `media/${IDS.media}`).catch((e) => console.log("Datei", e.message));
    console.log(`Zurückgebaut: /${PAGE_URL}, Layout und Artikeltabelle gelöscht`);
    if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
    return;
  }

  const products = await loadQuickConfigProducts(api, de.id);
  const { catalog, skipped, counts } = buildQuickConfigCatalog(products);
  const json = JSON.stringify(catalog);
  console.log(`${base} · Kanal ${de.name}`);
  console.log(`${products.length} Regale gelesen, ${catalog.items.length} in der Tabelle (${Math.round(json.length / 1024)} KB), ${skipped.length} ausgelassen`);
  console.log(`  ${Object.entries(counts).map(([k, n]) => `${KIND_LABELS[k] ?? k} ${n}`).join(" · ")}`);
  for (const s of skipped.slice(0, 30)) console.log(`  ausgelassen: ${s.name} – ${s.reason}`);
  if (!catalog.items.length) throw new Error("Keine Regale gefunden");

  if (process.argv.includes("--home")) {
    await writeHome(catalog);
    return;
  }

  // Adresse darf nicht von einer fremden Seite belegt sein
  const taken = await api("POST", "search/seo-url", {
    filter: [{ type: "equals", field: "seoPathInfo", value: PAGE_URL }, { type: "equals", field: "salesChannelId", value: de.id }, { type: "equals", field: "isDeleted", value: false }],
    includes: { seo_url: ["foreignKey", "routeName"] },
  });
  const conflict = (taken?.data ?? []).find((u: any) => u.foreignKey !== IDS.lp);
  if (conflict) throw new Error(`/${PAGE_URL} ist schon vergeben (${conflict.routeName})`);

  const had = { media: await exists(api, "media", IDS.media), landingPage: await exists(api, "landing-page", IDS.lp), cmsPage: await exists(api, "cms-page", IDS.cms) };
  console.log(`Datei ${had.media ? "wird ersetzt" : "wird angelegt"}, Seite ${had.landingPage ? "wird ersetzt" : "wird angelegt"}: ${de.domain}/${PAGE_URL}`);
  if (!process.argv.includes("--apply")) {
    console.log("Testlauf – mit --apply schreiben");
    return;
  }

  const log: Protocol = { tenantId, at: new Date().toISOString(), base, created: { media: !had.media, landingPage: !had.landingPage, cmsPage: !had.cmsPage } };
  const file = `Schnellkonfigurator-Seite-Protokoll-${isTest ? "Testing" : "Live"}-${log.at.slice(0, 16).replace(":", "-")}.json`;
  writeFileSync(file, JSON.stringify(log, null, 2));
  console.log(`Protokoll: ${file}`);

  if (!had.media) await api("POST", "media", { id: IDS.media, private: false });
  // Upload braucht den Rohinhalt (Content-Type application/json würde Shopware als „von URL laden“ deuten);
  // .json lassen die Shop-Medien nicht zu, der Inhalt ist trotzdem JSON
  const client = new ShopwareClient(settings);
  const upload = await client.makeAuthenticatedRequest(
    `${base}/api/_action/media/${IDS.media}/upload?extension=txt&fileName=${FILE_NAME}`,
    { method: "POST", headers: { "Content-Type": "text/plain" }, body: json },
  );
  if (!upload.ok) throw new Error(`Upload der Artikeltabelle: ${upload.status} ${(await upload.text()).slice(0, 300)}`);
  const media = (await api("POST", "search/media", { ids: [IDS.media], includes: { media: ["id", "url"] } }))?.data?.[0];
  if (!media?.url) throw new Error("Adresse der Artikeltabelle nicht gefunden");
  const mediaUrl = new URL(media.url);
  const catalogUrl = mediaUrl.pathname + mediaUrl.search;
  console.log(`Artikeltabelle: ${catalogUrl}`);

  const html = pageHtml(catalogUrl, catalog.items.length);
  if (had.landingPage) await api("DELETE", `landing-page/${IDS.lp}`);
  if (had.cmsPage) await api("DELETE", `cms-page/${IDS.cms}`);
  await api("POST", "cms-page", cmsPage(html));
  await api("POST", "landing-page", {
    id: IDS.lp,
    name: "Regal-Schnellkonfigurator",
    active: true,
    url: PAGE_URL,
    metaTitle: "Regal-Schnellkonfigurator: Regalzeile berechnen | META",
    metaDescription:
      "META Fachboden-, Paletten-, Weitspann-, Kragarm- und Büroregale nach Maß zusammenstellen: Maße, Last und Länge eingeben, Grund- und Anbauregale direkt in den Warenkorb legen.",
    salesChannels: [{ id: de.id }],
    cmsPageId: IDS.cms,
  });
  await api("PATCH", "_action/seo-url/canonical", {
    foreignKey: IDS.lp,
    routeName: "frontend.landing.page",
    pathInfo: `/landingPage/${IDS.lp}`,
    seoPathInfo: PAGE_URL,
    salesChannelId: de.id,
    languageId: DE_LANG,
    isModified: true,
  });
  if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));

  const check = await fetch(`${de.domain}${catalogUrl}`);
  console.log(`${check.status} Artikeltabelle (${check.headers.get("content-type")})`);
  const page = await fetch(`${de.domain}/${PAGE_URL}`);
  const body = await page.text();
  console.log(`${page.status} ${de.domain}/${PAGE_URL} – ${body.includes("data-meta-quick-config") ? "Formular-Platz vorhanden" : "Formular-Platz FEHLT (Cache?)"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
