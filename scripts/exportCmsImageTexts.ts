/**
 * ALT-Texte der Bilder in Erlebniswelten (Landingpages, Kategorie-Layouts, Startseite) und Linktexte
 * verlinkter Bildkacheln als Excel zur Freigabe. NUR LESEND (Admin-API).
 * Befund und Vorschlaege: server/products/cmsImageTexts.ts. Schreiben: scripts/writeCmsImageTexts.ts
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/exportCmsImageTexts.ts <tenantId> <out.xlsx>
 */
import XLSXmod from "xlsx";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import { altIssue, collectCmsImageUsages, eanFromFileName, linkLabel, parseCmsLink, proposeMediaTexts, type CmsImageUsage } from "../server/products/cmsImageTexts";
import { PRODUCT_IMAGE_TEXTS_MARKER, readableProductName } from "../server/products/productImageTexts";

const XLSX: any = (XLSXmod as any).readFile ? XLSXmod : (XLSXmod as any).default;
const DE_CHANNEL_NAME = "META Regalbau DE";
const DE_LANG = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";
// System je Landingpage: zeigt ein sichtbares Bild dort ein anderes System, gibt es einen Hinweis
const PAGE_SYSTEMS: Array<[RegExp, RegExp]> = [
  [/Palettenregal/i, /MULTIPAL/],
  [/Kragarm/i, /ATLAS|MULTISTRONG/],
  [/Weitspann/i, /SPEED[- ]?RACK|MINI[- ]?RACK/i],
  [/COMPACT|Büro/i, /COMPACT/],
];
// Von Hand gepflegte Texte, die beim Durchsehen aufgefallen sind (bleiben unveraendert)
const MANUAL_NOTES = [
  "09_META_MULTIPAL_Palettenregale (Hero Palettenregale, Valentinstags-Bundles): ALT nennt „2400 kg Fachlast“, die Kennzahl der Landingpage aus den Artikeldaten ist 2.240 kg – bitte prüfen.",
  "Slider Kragarm- und Weitspannregale: von Hand gepflegte ALT-Texte mit Bindestrich-Ketten („…-einseitig-Ausfachung-Rohre“) bleiben stehen; inhaltlich passend, nur schwer lesbar.",
];

async function main(): Promise<void> {
  const [tenantId, out] = process.argv.slice(2);
  if (!tenantId || !out?.endsWith(".xlsx")) {
    console.error("Usage: npx tsx scripts/exportCmsImageTexts.ts <tenantId> <out.xlsx>");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const client = new ShopwareClient(settings);
  const base = settings.shopwareUrl.replace(/\/$/, "");
  const search = async (entity: string, body: Record<string, unknown>) => {
    const r = await client.makeAuthenticatedRequest(`${base}/api/search/${entity}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "sw-language-id": DE_LANG, "sw-inheritance": "1" },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (r.status >= 300) throw new Error(`search ${entity}: ${r.status} ${txt.slice(0, 300)}`);
    return (JSON.parse(txt).data ?? []) as any[];
  };
  const byIds = async (entity: string, ids: string[], body: Record<string, unknown>) => {
    const outRows: any[] = [];
    for (let i = 0; i < ids.length; i += 200) outRows.push(...(await search(entity, { ...body, ids: ids.slice(i, i + 200), limit: 200 })));
    return outRows;
  };

  // 1. Layouts mit Zuordnung
  const pages: any[] = [];
  for (let page = 1; ; page++) {
    const rows = await search("cms-page", {
      page,
      limit: 25,
      associations: { sections: { associations: { blocks: { associations: { slots: {} } } } }, categories: {}, landingPages: {} },
      includes: {
        cms_page: ["id", "name", "type", "sections", "categories", "landingPages"],
        cms_section: ["id", "position", "backgroundMediaId", "blocks", "customFields"],
        cms_block: ["id", "position", "type", "backgroundMediaId", "slots"],
        cms_slot: ["id", "slot", "type", "config", "translated"],
        category: ["id", "name", "active"],
        landing_page: ["id", "name", "active"],
      },
    });
    pages.push(...rows);
    if (rows.length < 25) break;
  }
  const channels = await search("sales-channel", { limit: 50, includes: { sales_channel: ["id", "name"] } });
  const channelName = new Map(channels.map((c) => [c.id, c.name]));
  const pageStatus = (p: any) => {
    const used = [...(p.categories ?? []), ...(p.landingPages ?? [])];
    if (used.some((x: any) => x.active)) return "aktiv";
    return used.length ? "nur inaktiv zugeordnet" : "nicht zugeordnet";
  };
  const pageUse = (p: any) => [...(p.categories ?? []).map((c: any) => `Kategorie ${c.name}${c.active ? "" : " (inaktiv)"}`), ...(p.landingPages ?? []).map((l: any) => `Landingpage ${l.name}${l.active ? "" : " (inaktiv)"}`)].join("; ");
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const visibility = (u: CmsImageUsage) => {
    const status = pageStatus(pageById.get(u.pageId));
    if (status !== "aktiv") return status;
    const names = u.sectionChannels.map((id) => channelName.get(id) ?? id);
    return names.length && !names.includes(DE_CHANNEL_NAME) ? `ausgeblendet (nur ${names.join(", ")})` : "sichtbar";
  };
  const usages = pages.flatMap(collectCmsImageUsages);

  // 2. Medien, Produkte zu EANs, Linkziele
  const mediaIds = [...new Set(usages.map((u) => u.mediaId))];
  const media = await byIds("media", mediaIds, {
    associations: { productMedia: {} },
    includes: { media: ["id", "fileName", "fileExtension", "alt", "title", "customFields", "productMedia"], product_media: ["id"] },
  });
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const eans = [...new Set(media.map((m) => eanFromFileName(m.fileName)).filter(Boolean))] as string[];
  const products = eans.length ? await search("product", { limit: 500, filter: [{ type: "equalsAny", field: "ean", value: eans }], includes: { product: ["id", "productNumber", "ean", "name", "translated", "active"] } }) : [];
  const productByEan = new Map<string, any>();
  for (const p of products.sort((a, b) => Number(b.active) - Number(a.active))) if (!productByEan.has(p.ean)) productByEan.set(p.ean, p);
  const productName = (m: any) => {
    const p = productByEan.get(eanFromFileName(m.fileName) ?? "");
    return p ? String(p.translated?.name ?? p.name ?? "") : null;
  };

  const links = usages.filter((u) => u.link).map((u) => ({ u, parsed: parseCmsLink(u.link) }));
  const categoryIds = [...new Set(links.map((l) => l.parsed.categoryId).filter(Boolean))] as string[];
  const categoryName = new Map((categoryIds.length ? await byIds("category", categoryIds, { includes: { category: ["id", "name", "translated"] } }) : []).map((c) => [c.id, String(c.translated?.name ?? c.name)]));
  const optionIds = [...new Set(links.flatMap((l) => l.parsed.propertyIds))];
  const optionName = new Map((optionIds.length ? await byIds("property-group-option", optionIds, { includes: { property_group_option: ["id", "name", "translated"] } }) : []).map((o) => [o.id, String(o.translated?.name ?? o.name)]));
  const pathTarget = new Map<string, string>();
  for (const path of new Set(links.map((l) => l.parsed.path).filter((p): p is string => Boolean(p)))) {
    const seo = (await search("seo-url", { limit: 1, filter: [{ type: "equalsAny", field: "seoPathInfo", value: [path, `${path}/`] }, { type: "equals", field: "languageId", value: DE_LANG }, { type: "equals", field: "isDeleted", value: false }], includes: { seo_url: ["routeName", "foreignKey"] } }))[0];
    if (!seo) continue;
    const entity = { "frontend.navigation.page": "category", "frontend.landing.page": "landing-page", "frontend.detail.page": "product" }[seo.routeName as string];
    if (!entity) continue;
    const row = (await search(entity, { ids: [seo.foreignKey], includes: { [entity.replace("-", "_")]: ["name", "translated"] } }))[0];
    if (row) pathTarget.set(path, entity === "product" ? readableProductName(String(row.translated?.name ?? row.name)) : String(row.translated?.name ?? row.name));
  }
  const targetOf = (link: string) => {
    const p = parseCmsLink(link);
    if (p.categoryId) return categoryName.get(p.categoryId) ?? null;
    if (/^mailto:/i.test(link)) return link.replace(/^mailto:/i, "E-Mail an ");
    return p.path !== null ? (pathTarget.get(p.path) ?? null) : null;
  };

  // 3. Vorschlaege je Medium
  const proposals = new Map(media.map((m) => [m.id, proposeMediaTexts(m, productName(m))]));
  const notes: string[] = [];
  const usedOn = (id: string) => {
    const list = usages.filter((u) => u.mediaId === id);
    const names = [...new Set(list.map((u) => `${u.pageName} (Abschnitt ${u.section}, ${visibility(u)})`))];
    return `${list.length}× – ${names.join("; ")}`;
  };
  const mediaRows = media
    .map((m) => {
      const issue = altIssue(m.alt, m.fileName);
      const proposal = proposals.get(m.id);
      const productImage = (m.productMedia ?? []).length > 0;
      let befund: string = issue ?? (m.customFields?.[PRODUCT_IMAGE_TEXTS_MARKER] ? "ok (Automatik)" : "ok (von Hand)");
      if (productImage) befund = `${issue ? `${issue}, ` : ""}Produktbild – Automatik zuständig`;
      const hint = [
        issue && !proposal && !productImage ? "kein belegter Vorschlag – bitte Text eintragen oder Zeile leer lassen" : "",
        ...[...new Set(usages.filter((u) => u.mediaId === m.id && visibility(u) === "sichtbar").map((u) => u.pageName))]
          .filter((page) => PAGE_SYSTEMS.some(([pageRe, systemRe]) => pageRe.test(page) && !systemRe.test(proposal?.alt ?? m.alt ?? "")))
          .map((page) => `zeigt auf „${page}“ ein anderes System – Bild dort tauschen`),
      ].filter(Boolean).join("; ");
      return {
        "Medien-ID": m.id,
        Datei: `${m.fileName}.${m.fileExtension}`,
        Befund: befund,
        "ALT aktuell": m.alt ?? "",
        "ALT neu": productImage ? "" : (proposal?.alt ?? ""),
        "TITLE aktuell": m.title ?? "",
        "TITLE neu": productImage ? "" : (proposal?.title ?? ""),
        Quelle: productImage ? "" : (proposal?.source ?? ""),
        "Verwendet auf": usedOn(m.id),
        Hinweis: hint,
      };
    })
    .sort((a, b) => Number(!a["ALT neu"]) - Number(!b["ALT neu"]) || a.Befund.localeCompare(b.Befund));

  // 4. Linktexte fuer verlinkte Bild-Elemente
  const altFor = (id: string) => proposals.get(id)?.alt ?? mediaById.get(id)?.alt ?? "";
  const linkRows = usages
    .filter((u) => u.slotType === "image" && u.link)
    .map((u) => {
      const p = parseCmsLink(u.link);
      const target = targetOf(u.link);
      const filters = p.propertyIds.map((id) => optionName.get(id)).filter((x): x is string => Boolean(x));
      const proposal = target ? linkLabel(target, u.heading, filters) : "";
      const hint = [
        mediaById.has(u.mediaId) ? "" : "Bild fehlt (Medium gelöscht) – Link ohne sichtbares Bild",
        !target ? "Linkziel nicht gefunden – kein Vorschlag" : "",
        target && /Paletten/i.test(u.pageName) && /CLIP/.test(target) ? "Palettenseite verlinkt auf CLIP" : "",
      ].filter(Boolean).join("; ");
      return {
        "Slot-ID": u.slotId,
        Seite: u.pageName,
        Abschnitt: u.section,
        Block: u.block,
        Sichtbar: visibility(u),
        Link: u.link,
        Ziel: target ?? "",
        Überschrift: u.heading,
        "Bild-ALT (neu bzw. aktuell)": altFor(u.mediaId),
        "Linktext aktuell": u.ariaLabel ?? "",
        "Linktext neu": u.ariaLabel === proposal ? "" : proposal,
        Hinweis: hint,
      };
    });

  // 5. Verwendungen und Hinweise
  const usageRows = usages.map((u) => {
    const m = mediaById.get(u.mediaId);
    return {
      Seite: u.pageName,
      Zuordnung: pageUse(pageById.get(u.pageId)),
      Sichtbar: visibility(u),
      Abschnitt: u.section,
      Block: u.block,
      Element: u.element,
      "Medien-ID": u.mediaId,
      Datei: m ? `${m.fileName}.${m.fileExtension}` : "(Medium fehlt)",
      "ALT aktuell": m?.alt ?? "",
      "ALT neu": proposals.get(u.mediaId)?.alt ?? "",
      Link: u.link,
      Ziel: u.link ? (targetOf(u.link) ?? "") : "",
    };
  });
  for (const u of usages.filter((x) => !mediaById.has(x.mediaId))) notes.push(`${u.pageName}, Abschnitt ${u.section}, Block ${u.block} (${u.element}, ${visibility(u)}): Medium ${u.mediaId} gibt es nicht mehr – Element zeigt kein Bild${u.link ? ", Link ohne Inhalt" : ""}.`);
  for (const p of pages)
    for (const section of p.sections ?? [])
      for (const block of section.blocks ?? [])
        for (const slot of block.slots ?? []) {
          const html = String((slot.translated?.config ?? slot.config)?.content?.value ?? "");
          for (const img of html.match(/<img\b[^>]*>/gi) ?? []) {
            const alt = img.match(/\balt="([^"]*)"/i)?.[1];
            const src = img.match(/\bsrc="([^"]*)"/i)?.[1] ?? "";
            const problems = [alt === undefined || !alt.trim() ? "ohne ALT" : "", alt === "Bild" ? "ALT „Bild“" : "", !/^https?:\/\//.test(src) ? `Bildquelle „${src}“ nicht erreichbar` : ""].filter(Boolean);
            if (problems.length) notes.push(`${p.name} (${pageStatus(p)}), Abschnitt ${section.position}: HTML-Bild ${problems.join(", ")} – im Element von Hand korrigieren.`);
          }
        }
  const uniqueNotes = [...new Set(notes)];

  const book = XLSX.utils.book_new();
  const sheet = (rows: any[], cols: number[], name: string) => {
    const s = XLSX.utils.json_to_sheet(rows);
    s["!cols"] = cols.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(book, s, name);
  };
  sheet(mediaRows, [34, 40, 22, 46, 70, 36, 60, 50, 80, 50], "Medien");
  sheet(linkRows, [34, 34, 9, 6, 26, 50, 30, 24, 60, 30, 50, 40], "Linktexte");
  sheet(usageRows, [34, 40, 26, 9, 6, 28, 34, 40, 46, 60, 50, 30], "Verwendungen");
  sheet(
    [
      { Hinweis: "Freigabe: Spalten „ALT neu“, „TITLE neu“ (Blatt Medien) und „Linktext neu“ (Blatt Linktexte) prüfen. Ändern oder leeren ist erlaubt; leere Zellen werden nicht geschrieben." },
      { Hinweis: "ALT gilt je Bild überall, wo es eingebunden ist. Er beschreibt, was das Bild zeigt. Das Linkziel einer Bildkachel steht im Linktext (ariaLabel am Bild-Element)." },
      { Hinweis: "Produktbilder (an Artikeln) übernimmt die Automatik aus PR #142; sie stehen hier nur zur Übersicht. Von Hand gepflegte ALT-Texte ohne Befund bleiben stehen." },
      ...MANUAL_NOTES.map((Hinweis) => ({ Hinweis })),
      ...uniqueNotes.map((Hinweis) => ({ Hinweis })),
    ],
    [160],
    "Hinweise",
  );
  XLSX.writeFile(book, out);
  console.log(`${out}: ${mediaRows.filter((r) => r["ALT neu"]).length} von ${mediaRows.length} Bildern mit Vorschlag, ${linkRows.filter((r) => r["Linktext neu"]).length} Linktexte, ${usageRows.length} Verwendungen, ${uniqueNotes.length} Hinweise`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
