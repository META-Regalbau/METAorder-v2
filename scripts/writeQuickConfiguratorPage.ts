/**
 * Legt die Seite /regal-schnellkonfigurator (Erlebniswelt) im Shop an und lädt die Artikeltabelle des
 * Schnellkonfigurators als Datei in die Shop-Medien (server/shopContent/quickConfiguratorCatalog.ts).
 * Das Formular selbst kommt aus shopware/storefront-snippets/quick-configurator.js
 * (scripts/writeQuickConfigurator.ts) und liest die Tabelle aus dem Attribut data-catalog der Seite.
 *
 * Die Tabelle ist ein Stand: Kommen Regale dazu oder fallen weg, das Skript erneut ausführen
 * (ersetzt Datei und Seite, das Theme muss dafür nicht neu erstellt werden).
 *
 * Alle Entitäten haben feste IDs: ein zweiter Lauf ersetzt die eigenen, fremde Inhalte bleiben unberührt.
 * Ohne --apply nur Testlauf. Mit --apply Protokoll im Arbeitsverzeichnis; --revert löscht Seite, Layout und
 * Datei wieder (alles eigene Entitäten). Schreibt nur in Shops mit „test.“ in der URL, außer mit --live.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeQuickConfiguratorPage.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeQuickConfiguratorPage.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import { CONTACT } from "../server/products/industryPages";
import { buildQuickConfigCatalog, loadQuickConfigProducts } from "../server/shopContent/quickConfiguratorCatalog";
import { DE_LANG, findDeChannel, shopApi } from "../server/shopContent/shopProducts";

const PAGE_URL = "regal-schnellkonfigurator";
const FILE_NAME = "metaorder-regal-schnellkonfigurator";
const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };

const qcId = (part: string) => createHash("md5").update(`metaorder-quick-config:${part}`).digest("hex");
const IDS = { media: qcId("catalog"), lp: qcId("lp"), cms: qcId("cms"), section: qcId("section"), block: qcId("block"), slot: qcId("slot") };

type Protocol = { tenantId: string; at: string; base: string; created: { media: boolean; landingPage: boolean; cmsPage: boolean } };

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
<p class="meta-qc-page__lead">Fachbodenregal-Zeile aus META CLIP oder META CLIP S3 berechnen: Höhe, Feldbreite, Tiefe, Fachlast und die verfügbare Länge eingeben. Der Schnellkonfigurator stellt Grund- und Anbauregale zusammen, zeigt Gesamtlänge und Preis und legt die ganze Zeile mit einem Klick in den Warenkorb.</p>
<div class="meta-qc" data-meta-quick-config data-catalog="${esc(catalogUrl)}" data-count="${count}">
<p>Der Schnellkonfigurator wird geladen …</p>
<noscript><p>Für den Schnellkonfigurator bitte JavaScript einschalten. Alle Regale finden Sie unter <a href="/fachbodenregale/">Fachbodenregale</a>.</p></noscript>
</div>
<h2>So wird gerechnet</h2>
<ul>
<li>Eine Regalzeile beginnt mit einem Grundregal. Jedes weitere Feld ist ein Anbauregal, das am vorhandenen Regal angebaut wird.</li>
<li>Die Feldbreite ist die Länge der Fachböden. Für die Gesamtlänge kommen 40 mm je Ständerrahmen dazu; die Zeile wird nie länger als die angegebene Länge.</li>
<li>Passt die Länge mit gemischten Feldbreiten besser, zeigt der Schnellkonfigurator diese Zeile zusätzlich an.</li>
<li>Gibt es eine Fachlast in Ihrer Kombination nicht, wird die nächsthöhere angeboten.</li>
<li>Doppelregale sind von beiden Seiten zugänglich und werden Rücken an Rücken aufgebaut.</li>
</ul>
<h2>Andere Maße oder ganze Lagereinrichtung?</h2>
<p>Für Sonderhöhen, Zubehör oder die Planung eines ganzen Lagers erreichen Sie uns unter <a href="tel:${esc(CONTACT.tel)}">${esc(CONTACT.phone)}</a> (${esc(CONTACT.hours)}) oder per E-Mail an <a href="mailto:${esc(CONTACT.mail)}">${esc(CONTACT.mail)}</a>. Alle Fachbodenregale finden Sie unter <a href="/fachbodenregale/">Fachbodenregale</a>.</p>
</div>`;
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

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    // Seite, Layout und Datei gehören nur diesem Skript (feste IDs): beim Rückbau immer alle drei löschen
    await api("DELETE", `landing-page/${IDS.lp}`).catch((e) => console.log("Seite", e.message));
    await api("DELETE", `cms-page/${IDS.cms}`).catch((e) => console.log("Layout", e.message));
    await api("DELETE", `media/${IDS.media}`).catch((e) => console.log("Datei", e.message));
    console.log(`Zurückgebaut: /${PAGE_URL}, Layout und Artikeltabelle gelöscht`);
    if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
    return;
  }

  const products = await loadQuickConfigProducts(api, de.id);
  const { catalog, skipped } = buildQuickConfigCatalog(products);
  const json = JSON.stringify(catalog);
  console.log(`${base} · Kanal ${de.name}`);
  console.log(`${products.length} CLIP-Fachbodenregale gelesen, ${catalog.items.length} in der Tabelle (${Math.round(json.length / 1024)} KB), ${skipped.length} ausgelassen`);
  for (const s of skipped.slice(0, 20)) console.log(`  ausgelassen: ${s.name} – ${s.reason}`);
  if (!catalog.items.length) throw new Error("Keine Regale gefunden");

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
    metaTitle: "Regal-Schnellkonfigurator für Fachbodenregale | META",
    metaDescription:
      "META CLIP Fachbodenregale nach Maß zusammenstellen: Höhe, Breite, Tiefe, Fachlast und Länge eingeben, Grund- und Anbauregale direkt in den Warenkorb legen.",
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
