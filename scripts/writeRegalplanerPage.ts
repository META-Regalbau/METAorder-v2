/**
 * Legt die Seite /regalplaner (Erlebniswelt) im Shop an: Überschrift, kurze Erklärung und der Platz für den
 * Regalplaner META CLIP. Den Regalplaner selbst setzt shopware/storefront-snippets/regalplaner.js
 * (scripts/writeRegalplaner.ts) als iframe auf METAorder ein; die Adresse von METAorder steht im Attribut
 * data-app der Seite (--app-url, sonst PUBLIC_APP_URL).
 *
 * Alle Entitäten haben feste IDs: ein zweiter Lauf ersetzt die eigenen, fremde Inhalte bleiben unberührt.
 * Ohne --apply nur Testlauf. Mit --apply Protokoll im Arbeitsverzeichnis; --revert löscht Seite und Layout
 * wieder. Schreibt nur in Shops mit „test.“ in der URL, außer mit --live.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeRegalplanerPage.ts <tenantId> --app-url https://… [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeRegalplanerPage.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import { CONTACT } from "../server/products/industryPages";
import { regalplanerId } from "../server/shopContent/shopEntityIds";
import { DE_LANG, findDeChannel, shopApi } from "../server/shopContent/shopProducts";

const PAGE_URL = "regalplaner";
const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };
const IDS = { lp: regalplanerId("lp"), cms: regalplanerId("cms"), section: regalplanerId("section"), block: regalplanerId("block"), slot: regalplanerId("slot") };

type Protocol = { tenantId: string; at: string; base: string; appUrl: string; created: { landingPage: boolean; cmsPage: boolean } };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function regalplanerPageHtml(appUrl: string): string {
  return `<style>
.meta-rp-page{max-width:1400px;margin:0 auto;padding:32px 20px 56px;color:#121212;font-size:15px;line-height:1.5}
.meta-rp-page h1{margin:0 0 12px;color:#121212;font-size:32px;line-height:1.2;font-weight:700}
.meta-rp-page .meta-rp-page__lead{max-width:760px;margin:0 0 24px;font-size:17px}
.meta-rp-page h2{margin:40px 0 12px;color:#121212;font-size:22px;font-weight:700}
.meta-rp-page ul{margin:0 0 16px;padding-left:20px}
.meta-rp-page li{margin:0 0 6px}
.meta-rp-page a{color:#121212;text-decoration:underline}
@media (max-width:575px){.meta-rp-page{padding-top:20px}.meta-rp-page h1{font-size:26px}}
/* Theme: Bootstrap-Zeile um das HTML-Element hat negative Ränder – bei voller Breite 20 px Überlauf */
.cms-block-container-row:has(> .col-12 > .cms-element-html .meta-rp-page){margin-left:0;margin-right:0}
.cms-block-container-row:has(> .col-12 > .cms-element-html .meta-rp-page) > .col-12{padding-left:0;padding-right:0}
</style>
<div class="meta-rp-page">
<h1>Regalplaner META CLIP</h1>
<p class="meta-rp-page__lead">Fachbodenregal META CLIP in 3D planen: Rahmen, Feldanzahl, Höhe, Feldbreite, Tiefe, Fachlast und Anzahl der Fachböden wählen. Der Regalplaner stellt die Stückliste aus Ständerrahmen, Fachböden, Diagonalstäben und Zubehör zusammen und legt sie mit einem Klick in den Warenkorb.</p>
<div class="meta-rp" data-meta-regalplaner data-app="${esc(appUrl)}">
<p>Der Regalplaner wird geladen …</p>
<noscript><p>Für den Regalplaner bitte JavaScript einschalten. Alle Regale finden Sie über das Menü.</p></noscript>
</div>
<h2>So funktioniert der Regalplaner</h2>
<ul>
<li>Angeboten werden nur Kombinationen, die es im Shop gibt. Wählen Sie einen Wert, der zu den übrigen nicht passt, rücken diese auf die nächste lieferbare Ausführung.</li>
<li>Rahmen: vormontierte Ständerrahmen oder Steckrahmen S3 zum Selbstaufbau.</li>
<li>Die Feldlast (Höchstlast je Feld, alle Böden zusammen) richtet sich nach Rahmen und Höhe. Bei hohen, schmalen Regalen nimmt der Regalplaner die Fußverdübelung mit auf.</li>
<li>Ohne Anmeldung zeigt der Regalplaner Katalogpreise. Sind Sie im Shop angemeldet, berechnet der Warenkorb Ihren Preis.</li>
<li>Regalzeilen aus fertigen Grund- und Anbauregalen stellt der <a href="/regal-schnellkonfigurator">Regal-Schnellkonfigurator</a> zusammen.</li>
</ul>
<h2>Fragen zur Planung?</h2>
<p>Für Sonderhöhen, Doppelregale oder die Planung eines ganzen Lagers erreichen Sie uns unter <a href="tel:${esc(CONTACT.tel)}">${esc(CONTACT.phone)}</a> (${esc(CONTACT.hours)}) oder per E-Mail an <a href="mailto:${esc(CONTACT.mail)}">${esc(CONTACT.mail)}</a>.</p>
</div>`;
}

function cmsPage(html: string) {
  return {
    id: IDS.cms,
    name: "Regalplaner META CLIP",
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

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId || tenantId.startsWith("--")) {
    console.error("Usage: npx tsx scripts/writeRegalplanerPage.ts <tenantId> --app-url https://… [--apply] [--live] | --revert <protokoll.json>");
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
  const exists = async (entity: string, id: string) =>
    ((await api("POST", `search/${entity}`, { ids: [id], includes: { [entity.replace(/-/g, "_")]: ["id"] } }))?.data ?? []).length > 0;

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    // Seite und Layout gehören nur diesem Skript (feste IDs): beim Rückbau beide löschen
    await api("DELETE", `landing-page/${IDS.lp}`).catch((e) => console.log("Seite", e.message));
    await api("DELETE", `cms-page/${IDS.cms}`).catch((e) => console.log("Layout", e.message));
    console.log(`Zurückgebaut: /${PAGE_URL} und Layout gelöscht`);
    if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
    return;
  }

  const appUrl = (arg("--app-url") ?? process.env.PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const parsed = (() => { try { return new URL(appUrl); } catch { return null; } })();
  const local = parsed && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (!parsed || (parsed.protocol !== "https:" && !local)) throw new Error("--app-url https://<METAorder> angeben (http nur für localhost)");
  if (!isTest && local) throw new Error("Live-Shop nicht auf ein lokales METAorder zeigen lassen");
  // METAorder muss den Shop kennen (Shop-Adresse des Mandanten = frame-ancestors und Gast-Mandant)
  const probe = await fetch(`${parsed.origin}/api/cpq/public/guest-token?shop=${encodeURIComponent(de.domain)}`).catch(() => null);
  console.log(`${base} · Kanal ${de.name} · METAorder ${parsed.origin}`);
  console.log(`Gast-Zugang für ${de.domain}: ${probe ? `${probe.status}${probe.ok ? " ok" : " – METAorder kennt diesen Shop nicht (Shopware-Adresse des Mandanten / CPQ_EMBED_ORIGINS)"}` : "METAorder nicht erreichbar"}`);

  const taken = await api("POST", "search/seo-url", {
    filter: [{ type: "equals", field: "seoPathInfo", value: PAGE_URL }, { type: "equals", field: "salesChannelId", value: de.id }, { type: "equals", field: "isDeleted", value: false }],
    includes: { seo_url: ["foreignKey", "routeName"] },
  });
  const conflict = (taken?.data ?? []).find((u: any) => u.foreignKey !== IDS.lp);
  if (conflict) throw new Error(`/${PAGE_URL} ist schon vergeben (${conflict.routeName})`);

  const had = { landingPage: await exists("landing-page", IDS.lp), cmsPage: await exists("cms-page", IDS.cms) };
  console.log(`Seite ${had.landingPage ? "wird ersetzt" : "wird angelegt"}: ${de.domain}/${PAGE_URL}`);
  if (!process.argv.includes("--apply")) {
    console.log("Testlauf – mit --apply schreiben");
    return;
  }

  const log: Protocol = { tenantId, at: new Date().toISOString(), base, appUrl: parsed.origin, created: { landingPage: !had.landingPage, cmsPage: !had.cmsPage } };
  const file = `Regalplaner-Seite-Protokoll-${isTest ? "Testing" : "Live"}-${log.at.slice(0, 16).replace(":", "-")}.json`;
  writeFileSync(file, JSON.stringify(log, null, 2));
  console.log(`Protokoll: ${file}`);

  if (had.landingPage) await api("DELETE", `landing-page/${IDS.lp}`);
  if (had.cmsPage) await api("DELETE", `cms-page/${IDS.cms}`);
  await api("POST", "cms-page", cmsPage(regalplanerPageHtml(parsed.origin)));
  await api("POST", "landing-page", {
    id: IDS.lp,
    name: "Regalplaner META CLIP",
    active: true,
    url: PAGE_URL,
    metaTitle: "Regalplaner META CLIP: Fachbodenregal in 3D planen | META",
    metaDescription:
      "META CLIP Fachbodenregal online planen: Rahmen, Maße, Fachlast und Böden wählen, Stückliste und Preis sehen und alles direkt in den Warenkorb legen.",
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
  const page = await fetch(`${de.domain}/${PAGE_URL}`);
  const body = await page.text();
  console.log(`${page.status} ${de.domain}/${PAGE_URL} – ${body.includes("data-meta-regalplaner") ? "Platz für den Regalplaner vorhanden" : "Platz FEHLT (Cache?)"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
