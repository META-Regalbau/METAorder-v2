/**
 * Neuer Header der Startseite (server/products/homeHero.ts): eigener Abschnitt ganz oben mit Konfigurator,
 * Beratung und Regalarten. Er steht direkt vor dem Agentur-Slider und gilt nur im DE-Kanal; der Slider wird
 * auf die übrigen Kanäle mit diesem Layout beschränkt (AT, PL behalten ihn), ohne solche Kanäle ausgeblendet.
 *
 * Kanal-Einstellung und Sichtbarkeit des Sliders vor dem ersten Lauf liegen im Protokoll und zusätzlich im
 * eigenen Abschnitt (customFields.metaorder_home_hero) – so stellt auch das Protokoll eines späteren Laufs
 * den Ursprung wieder her. Ein zweiter Lauf ersetzt nur den eigenen Abschnitt.
 *
 * Bild: Medium des bisherigen Sliders aus dem Ziel-Shop. Der Testshop hat keine Bilddateien, dort mit
 * --image-fallback <Shop-Adresse> dasselbe Medium von dieser Adresse nehmen.
 *
 * Ohne --apply nur Testlauf. Schreibt nur in Shops mit „test.“ in der URL, außer mit --live.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeHomeHero.ts <tenantId> [--apply] [--live] [--image-fallback https://shop.meta-online.com]
 *   NODE_ENV=development npx tsx scripts/writeHomeHero.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import { HOME_HERO_MARKER, homeHeroHtml } from "../server/products/homeHero";
import { homeHeroId } from "../server/shopContent/shopEntityIds";
import { DE_CHANNEL_NAME, findDeChannel, shopApi } from "../server/shopContent/shopProducts";

const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };
const NO_DEVICES = { mobile: false, tablet: false, desktop: false };
/** Dateiname des Slider-Bilds im Shop (Medium ohne Endung) */
const IMAGE_FILE = "slider-fachbodenregal-arc-weiss-1920x453";
const IDS = { section: homeHeroId("section"), block: homeHeroId("block"), slot: homeHeroId("slot") };

type SliderBefore = { sectionId: string; customFields: unknown; visibility: unknown };
type Protocol = { tenantId: string; at: string; base: string; pageId: string; position: number; replaced: boolean; slider: SliderBefore };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Usage: npx tsx scripts/writeHomeHero.ts <tenantId> [--apply] [--live] [--image-fallback <url>] | --revert <protokoll.json>");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const { api, base, isTest } = shopApi(settings);
  const live = process.argv.includes("--live");
  const sectionsOf = async (pageId: string): Promise<any[]> =>
    ((await api("POST", "search/cms-section", {
      limit: 100,
      filter: [{ type: "equals", field: "pageId", value: pageId }],
      associations: { blocks: {} },
      includes: { cms_section: ["id", "position", "blocks", "customFields", "visibility"], cms_block: ["type"] },
    }))?.data ?? []).sort((a: any, b: any) => a.position - b.position);

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    if (!isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
    const secs = await sectionsOf(log.pageId);
    const own = secs.find((x) => x.id === IDS.section);
    // Ursprung des Sliders: aus dem eigenen Abschnitt (erster Lauf), sonst aus dem Protokoll
    const before: SliderBefore = own?.customFields?.metaorder_home_hero?.slider ?? log.slider;
    await api("PATCH", `cms-section/${before.sectionId}`, { customFields: before.customFields, visibility: before.visibility });
    console.log("Slider wiederhergestellt");
    if (own) {
      await api("DELETE", `cms-section/${IDS.section}`);
      for (const x of secs.filter((x) => x.position > own.position)) await api("PATCH", `cms-section/${x.id}`, { position: x.position - 1 });
      console.log("Header-Abschnitt entfernt");
    } else console.log("Header-Abschnitt schon entfernt");
    if (isTest) await api("DELETE", "_action/cache").catch(() => undefined);
    return;
  }

  const apply = process.argv.includes("--apply");
  if (apply && !isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
  const de = await findDeChannel(api, base);
  const pageId: string | undefined =
    de.homeCmsPageId ?? (await api("POST", "search/category", { ids: [de.navigationCategoryId], includes: { category: ["cmsPageId"] } }))?.data?.[0]?.cmsPageId;
  if (!pageId) throw new Error("Layout der Startseite nicht gefunden");

  const secs = await sectionsOf(pageId);
  const existing = secs.find((x) => x.id === IDS.section);
  const slider = secs.find((x) => x.id !== IDS.section && (x.blocks ?? []).some((b: any) => b.type === "ssik-extra-slider"));
  if (!slider) throw new Error("Slider (ssik-extra-slider) auf der Startseite nicht gefunden – nichts geändert");
  const sliderBefore: SliderBefore = existing?.customFields?.metaorder_home_hero?.slider ?? {
    sectionId: slider.id,
    customFields: slider.customFields ?? null,
    visibility: slider.visibility ?? null,
  };
  const position = existing ? existing.position : slider.position;

  // Übrige Kanäle mit diesem Startseiten-Layout behalten den Slider
  const channels = (await api("POST", "search/sales-channel", {
    limit: 50,
    associations: { navigationCategory: {} },
    includes: { sales_channel: ["id", "name", "homeCmsPageId", "navigationCategory"], category: ["cmsPageId"] },
  }))?.data ?? [];
  const others = channels.filter((c: any) => c.id !== de.id && (c.homeCmsPageId ?? c.navigationCategory?.cmsPageId) === pageId);

  // Bild des Sliders im Ziel-Shop, notfalls dasselbe Medium von der Fallback-Adresse
  const media = (await api("POST", "search/media", { limit: 1, filter: [{ type: "equals", field: "fileName", value: IMAGE_FILE }], includes: { media: ["url"] } }))?.data?.[0];
  let image: string | null = media?.url ?? null;
  const fallback = arg("--image-fallback");
  if (image && !(await fetch(image, { method: "HEAD" }).catch(() => null))?.ok) {
    const alt = fallback ? `${fallback.replace(/\/$/, "")}${new URL(image).pathname}` : null;
    console.log(`  Bild im Shop nicht abrufbar (${image})${alt ? ` – nehme ${alt}` : ""}`);
    image = alt;
  }
  if (!image) console.log("  Ohne Hintergrundbild");

  const html = homeHeroHtml(image);
  console.log(
    `${apply ? (existing ? "ERSETZE" : "LEGE AN") : existing ? "würde ersetzen" : "würde anlegen"} Header an Position ${position} (vor dem Slider), nur Kanal ${DE_CHANNEL_NAME}, HTML ${Math.round(html.length / 1024)} KB`,
  );
  console.log(`  Slider ${others.length ? `nur noch in: ${others.map((c: any) => c.name).join(", ")}` : "ausgeblendet (kein weiterer Kanal mit diesem Layout)"}`);
  if (!apply) return;

  const file = `/app/tmp-claude/startseite-header-${tenantId.slice(0, 8)}-${Date.now()}.json`;
  const log: Protocol = { tenantId, at: new Date().toISOString(), base, pageId, position, replaced: !!existing, slider: sliderBefore };
  writeFileSync(file, JSON.stringify(log, null, 1));

  if (existing) await api("DELETE", `cms-section/${IDS.section}`);
  else for (const x of [...secs].reverse().filter((x) => x.position >= position)) await api("PATCH", `cms-section/${x.id}`, { position: x.position + 1 });
  await api("POST", "cms-section", {
    id: IDS.section,
    pageId,
    type: "default",
    position,
    sizingMode: "full_width",
    mobileBehavior: "wrap",
    visibility: ALL_DEVICES,
    customFields: { moorl_section_config: { color: null, salesChannel: [de.id] }, metaorder_home_hero: { slider: sliderBefore } },
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
  });
  const sliderCfg = ((sliderBefore.customFields as any) ?? {}).moorl_section_config ?? {};
  await api(
    "PATCH",
    `cms-section/${slider.id}`,
    others.length
      ? { customFields: { ...((sliderBefore.customFields as any) ?? {}), moorl_section_config: { color: null, ...sliderCfg, salesChannel: others.map((c: any) => c.id) } } }
      : { visibility: NO_DEVICES },
  );
  console.log(`Protokoll: ${file}`);
  if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
  const r = await fetch(`${de.domain}/?mbp=${Date.now()}`);
  const body = await r.text();
  console.log(`${r.status} ${de.domain}/ – Header ${body.includes(HOME_HERO_MARKER) ? "sichtbar" : "NICHT im HTML (Cache?)"}, Slider ${body.includes("ssik-extra-slider") ? "noch da" : "weg"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
