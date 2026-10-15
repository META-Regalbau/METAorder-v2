/**
 * Schreibt freigegebene Kategorietexte (Excel aus exportCategoryTexts.ts) in die Zusatzfelder
 * meta_category_intro / _seo_text / _faq / _sidebar (Layout-Blöcke zeigen sie an).
 * Gestaltung: server/products/categoryPageHtml.ts (nur Bootstrap-Klassen des Themes).
 *
 * Je Kategorie abgeleitet:
 * - Vorteils-Badges nur aus belegten Herstellerangaben (Spalte "Herstellerangaben belegt") + Regaltyp
 * - "Passend dazu": Nachbarkategorien (gleiche Elternkategorie) MIT Produkten im Shop
 * - Entscheidungshilfe Grund-/Anbauregal nur bei Grund- und Anbauregalen
 * - Seitenleiste: Passend dazu, "Alles zu …", Downloads, Beratung (Telefon)
 *
 * Ohne --apply nur Testlauf. Vor dem Schreiben Sicherung der bisherigen Feldwerte.
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeCategoryContent.ts <tenantId> <texte.xlsx> [--only "A,B"] [--apply]
 */
import { writeFileSync } from "fs";
import XLSXmod from "xlsx";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import {
  CATEGORY_CONTENT_FIELDS,
  faqHtmlBoxes,
  introHtml,
  sidebarHtml,
  styleSeoHtml,
  type CategoryLink,
} from "../server/products/categoryPageHtml";

const XLSX: any = (XLSXmod as any).readFile ? XLSXmod : (XLSXmod as any).default;
const DE_CHANNEL_NAME = "META Regalbau DE";
const DE_LANG = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const LANDING: Array<[RegExp, CategoryLink]> = [
  [/CLIP|COMPACT|Fachboden/i, { label: "Alles zu META Fachbodenregalen", url: "/fachbodenregale/" }],
  [/MULTIPAL|Paletten/i, { label: "Alles zum META Palettenregal", url: "/palettenregale/" }],
  [/MULTISTRONG|ATLAS|Kragarm/i, { label: "Alles zu META Kragarmregalen", url: "/kragarmregale/" }],
  [/MINI-RACK|SPEED-RACK|Weitspann/i, { label: "Alles zu META Weitspannregalen", url: "/weitspannregale/" }],
];

function badgesFor(name: string, claims: string, table: string): string[] {
  const out: string[] = [];
  if (/Made in Germany/i.test(claims)) out.push("Made in Germany");
  if (/5 Jahren META-Qualitätsgarantie/i.test(claims)) out.push("5 Jahre META-Garantie");
  if (/RAL-RG 614\/2/.test(claims)) out.push("Gütegesichert nach RAL-RG 614/2");
  if (/DIBt-zugelassen/.test(claims)) out.push("DIBt-zugelassen");
  if (/ATLAS/.test(claims) && /GS-Zertifikat/.test(claims)) out.push("GS-zertifiziert");
  if (/5 Jahren Herstellergarantie/.test(claims)) out.push("5 Jahre Herstellergarantie");
  if (/CLIP/i.test(name) && /<th[^>]*>Aufbauart<\/th><td>Steckregal<\/td>/.test(table)) out.push("Werkzeuglos gesteckt");
  if (/Grundregale$/.test(name)) out.push("Mit Anbauregalen erweiterbar");
  if (/Anbauregale$/.test(name)) out.push("Erweitert Ihr Grundregal");
  return out.slice(0, 4);
}

function guideHtml(name: string, anbau: CategoryLink | undefined, grund: CategoryLink | undefined): string {
  if (!/(Grund|Anbau)regale$/.test(name)) return "";
  const kragarm = /MULTISTRONG|ATLAS|Kragarm/i.test(name);
  const rahmen = kragarm ? "Ständer" : "Seitenrahmen";
  const link = /Grundregale$/.test(name) ? anbau && `<a href="${anbau.url}">Passende Anbauregale ansehen</a>` : grund && `<a href="${grund.url}">Passende Grundregale ansehen</a>`;
  return `<h2>Grundregal oder Anbauregal?</h2><p>Ein <strong>Grundregal</strong> steht für sich und hat zwei eigene ${rahmen}. Ein <strong>Anbauregal</strong> nutzt ${kragarm ? "einen Ständer" : "den Seitenrahmen"} des Nachbarregals mit – so verlängern Sie eine Regalreihe. Für eine Reihe aus drei Regalen brauchen Sie 1 Grundregal + 2 Anbauregale.${link ? ` ${link}` : ""}</p>`;
}

async function main(): Promise<void> {
  const [tenantId, xlsx] = process.argv.slice(2);
  if (!tenantId || !xlsx?.endsWith(".xlsx")) {
    console.error('Usage: npx tsx scripts/writeCategoryContent.ts <tenantId> <texte.xlsx> [--only "A,B"] [--apply]');
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const rows = (XLSX.utils.sheet_to_json(XLSX.readFile(xlsx).Sheets["Kategorietexte"]) as any[]).filter(
    (r) => !r["Prüfhinweis"] && (!only.size || only.has(r.Kategorie)),
  );

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const client = new ShopwareClient(settings);
  const base = settings.shopwareUrl.replace(/\/$/, "");
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await client.makeAuthenticatedRequest(`${base}/api/${path}`, { method, headers: { "Content-Type": "application/json", "sw-language-id": DE_LANG }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${txt.slice(0, 300)}`);
    return txt ? JSON.parse(txt) : null;
  };
  const channels = await api("POST", "search/sales-channel", { limit: 50, associations: { domains: {} }, includes: { sales_channel: ["id", "name", "accessKey", "domains", "navigationCategoryId"], sales_channel_domain: ["url"] } });
  const de = channels.data.find((c: any) => c.name === DE_CHANNEL_NAME);
  const domain = (de.domains ?? []).map((d: any) => d.url).find((u: string) => /shop\.meta-online\.com|test\./.test(u)) ?? base;
  const cats = await api("POST", "search/category", {
    limit: 500,
    filter: [{ type: "contains", field: "path", value: de.navigationCategoryId }, { type: "equals", field: "active", value: true }],
    associations: { seoUrls: {} },
    includes: { category: ["id", "name", "parentId", "type", "seoUrls", "customFields"], seo_url: ["seoPathInfo", "isCanonical", "isDeleted", "salesChannelId", "languageId"] },
  });
  const urlOf = (c: any) => {
    const u = (c.seoUrls ?? []).find((x: any) => x.salesChannelId === de.id && x.languageId === DE_LANG && x.isCanonical && !x.isDeleted);
    return u ? `/${u.seoPathInfo}` : null;
  };
  const productCount = async (id: string): Promise<number> => {
    const r = await fetch(`${domain.replace(/\/$/, "")}/store-api/product-listing/${id}`, {
      method: "POST",
      headers: { "sw-access-key": de.accessKey, "sw-language-id": DE_LANG, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ limit: 1 }),
    });
    return r.ok ? Number(((await r.json()) as any).total ?? 0) : 0;
  };
  const byName = (n: string) => cats.data.find((c: any) => c.name === n && c.type === "page");
  const downloads: CategoryLink[] = ["Datenblätter", "Montageanleitungen", "Kataloge"]
    .map((n) => ({ label: n, url: byName(n) ? urlOf(byName(n)) : null }))
    .filter((l): l is CategoryLink => Boolean(l.url));

  const backup: any[] = [];
  const updates: Array<{ id: string; name: string; fields: Record<string, string> }> = [];
  for (const row of rows) {
    const cat = cats.data.find((c: any) => c.id === row["Kategorie-ID"]) ?? byName(row.Kategorie);
    if (!cat) {
      console.log(`FEHLT ${row.Kategorie}`);
      continue;
    }
    const prefix = String(row.Kategorie).split(" ")[0];
    const siblings: CategoryLink[] = [];
    for (const s of cats.data.filter((c: any) => c.parentId === cat.parentId && c.id !== cat.id && c.type === "page")) {
      const url = urlOf(s);
      if (url && (await productCount(s.id)) > 0) siblings.push({ label: s.name, url });
    }
    const short = (l: CategoryLink) => ({ ...l, label: l.label.startsWith(`${prefix} `) ? l.label.slice(prefix.length + 1) : l.label });
    const anbau = siblings.find((l) => /Anbauregale$/.test(l.label));
    const grund = siblings.find((l) => /Grundregale$/.test(l.label));
    const landing = LANDING.find(([re]) => re.test(row.Kategorie))?.[1];
    const fields = {
      [CATEGORY_CONTENT_FIELDS.intro]: introHtml(
        String(row["Einleitung (HTML, über der Liste)"]),
        badgesFor(row.Kategorie, String(row["Herstellerangaben belegt"] ?? ""), String(row["Maßtabelle (aus Produktdaten)"] ?? "")),
        siblings.map(short),
      ),
      [CATEGORY_CONTENT_FIELDS.seoText]: styleSeoHtml(guideHtml(row.Kategorie, anbau, grund) + String(row["SEO-Text (HTML, unter der Liste)"])),
      [CATEGORY_CONTENT_FIELDS.faq]: faqHtmlBoxes(JSON.parse(String(row["FAQ (JSON für FAQPage)"]))),
      [CATEGORY_CONTENT_FIELDS.sidebar]: sidebarHtml([...siblings, ...(landing ? [landing] : [])], downloads),
    };
    backup.push({ id: cat.id, name: cat.name, customFields: Object.fromEntries(Object.values(CATEGORY_CONTENT_FIELDS).map((k) => [k, cat.customFields?.[k] ?? null])) });
    updates.push({ id: cat.id, name: cat.name, fields });
    console.log(`${apply ? "SCHREIBE" : "würde schreiben"} ${cat.name} | Passend dazu: ${siblings.map((s) => s.label).join(", ") || "–"} | Badges: ${badgesFor(row.Kategorie, String(row["Herstellerangaben belegt"] ?? ""), String(row["Maßtabelle (aus Produktdaten)"] ?? "")).join(", ") || "–"}`);
  }
  if (!apply || updates.length === 0) return;
  const file = `${xlsx}.feld-sicherung-${tenantId.slice(0, 8)}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log(`Sicherung: ${file}`);
  for (const u of updates) await api("PATCH", `category/${u.id}`, { customFields: u.fields });
  console.log(`FERTIG: ${updates.length} Kategorien geschrieben`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
