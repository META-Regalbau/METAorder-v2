/**
 * Texte fuer Kategorieseiten (Einleitung, SEO-Text mit Massetabelle, FAQ) als Excel zur Freigabe.
 * NUR LESEND: liest Kategorien (Admin-API) und deren Produkte (Store-API, wie Kunden sie sehen),
 * schreibt nichts in den Shop. Aufbau und Pruefregeln: server/products/categoryTexts.ts
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/exportCategoryTexts.ts <shopTenantId> <out.xlsx> \
 *     [--llm-tenant <tenantId>] [--only "Name A,Name B"]
 */
import * as XLSX from "xlsx";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import {
  buildCategoryFacts,
  buildCategoryHtml,
  factsTableHtml,
  generateCategoryText,
  llmCategoryTextGenerator,
  llmCategoryTextReviewer,
  type CategoryProduct,
} from "../server/products/categoryTexts";

const DE_CHANNEL_NAME = "META Regalbau DE";
const DE_LANG = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [tenantId, out] = process.argv.slice(2);
  if (!tenantId || !out?.endsWith(".xlsx")) {
    console.error("Usage: npx tsx scripts/exportCategoryTexts.ts <shopTenantId> <out.xlsx> [--llm-tenant id] [--only \"A,B\"]");
    process.exit(1);
  }
  const llmTenant = arg("--llm-tenant") ?? tenantId;
  const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const client = new ShopwareClient(settings);
  const base = settings.shopwareUrl.replace(/\/$/, "");
  const admin = async (path: string, body: unknown) => {
    const r = await client.makeAuthenticatedRequest(`${base}/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "sw-language-id": DE_LANG }, body: JSON.stringify(body) });
    return r.json() as Promise<any>;
  };

  const channels = await admin("search/sales-channel", { limit: 50, includes: { sales_channel: ["id", "name", "navigationCategoryId", "accessKey", "domains"] }, associations: { domains: {} } });
  const de = channels.data.find((c: any) => c.name === DE_CHANNEL_NAME);
  const accessKey = de.accessKey ?? (await client.getSalesChannelAccessKey(de.id));
  const domain = (de.domains ?? []).map((d: any) => d.url).find((u: string) => /shop\.meta-online\.com|test\./.test(u)) ?? base;

  const cats = await admin("search/category", {
    limit: 500,
    filter: [
      { type: "contains", field: "path", value: de.navigationCategoryId },
      { type: "equals", field: "active", value: true },
      { type: "equals", field: "type", value: "page" },
    ],
    associations: { seoUrls: {} },
    includes: { category: ["id", "name", "breadcrumb", "seoUrls", "productAssignmentType", "description", "metaTitle", "metaDescription"], seo_url: ["seoPathInfo", "isCanonical", "isDeleted", "salesChannelId", "languageId"] },
  });
  const byName = (c: any) => (Array.isArray(c.breadcrumb) ? c.breadcrumb.slice(1).join(" › ") : c.name);

  const rows: any[] = [];
  const generate = llmCategoryTextGenerator((k) => storage.getSetting(k, llmTenant));
  const review = llmCategoryTextReviewer((k) => storage.getSetting(k, llmTenant));
  for (const c of cats.data) {
    if (only.size && !only.has(c.name)) continue;
    if (/^Alles zu/.test(c.name)) continue; // Landingpages haben eigenen Inhalt
    // Produkte so, wie Kunden sie sehen (Topseller zuerst)
    const products: CategoryProduct[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await fetch(`${domain.replace(/\/$/, "")}/store-api/product-listing/${c.id}`, {
        method: "POST",
        headers: { "sw-access-key": accessKey, "sw-language-id": DE_LANG, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ p: page, limit: 100, order: "topseller", associations: { properties: { associations: { group: {} } } } }),
      });
      if (!r.ok) break;
      const d = (await r.json()) as any;
      const els = d.elements ?? [];
      for (const p of els) {
        products.push({
          name: String(p.translated?.name ?? ""),
          properties: (p.properties ?? []).map((o: any) => ({ group: String(o.group?.translated?.name ?? ""), option: String(o.translated?.name ?? "") })),
        });
      }
      if (els.length < 100) break;
    }
    if (products.length === 0) continue; // Service-/Download-Seiten ohne Produkte
    const url = (c.seoUrls ?? []).find((u: any) => u.salesChannelId === de.id && u.languageId === DE_LANG && u.isCanonical && !u.isDeleted)?.seoPathInfo ?? "";
    const facts = buildCategoryFacts({ id: c.id, name: c.name, url: `/${url}`, breadcrumb: byName(c) }, products);
    if (process.argv.includes("--facts-only")) {
      console.log(`FAKTEN ${c.name} | Herstellerangaben: ${facts.familyClaims ? "ja" : "nein"} | Systeme: ${facts.systems.join(", ")}`);
      continue;
    }
    process.stdout.write(`${c.name} (${products.length} Artikel) … `);
    const { text, problem } = await generateCategoryText(facts, generate, review);
    const html = text ? buildCategoryHtml(facts, text) : null;
    console.log(problem ? `PRÜFHINWEIS: ${problem}` : "ok");
    rows.push({
      Kategorie: c.name,
      Pfad: facts.breadcrumb,
      URL: facts.url,
      Artikel: products.length,
      "H1 neu": text?.h1 ?? "",
      "Einleitung (HTML, über der Liste)": html?.introHtml ?? "",
      "SEO-Text (HTML, unter der Liste)": html?.seoHtml ?? "",
      "FAQ (HTML)": html?.faqHtml ?? "",
      "FAQ (JSON für FAQPage)": html?.faqJson ?? "",
      "Maßtabelle (aus Produktdaten)": factsTableHtml(facts),
      "Zeichen gesamt": html ? (html.introHtml + html.seoHtml + html.faqHtml).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length : 0,
      "Herstellerangaben belegt": facts.familyClaims ?? "",
      "Text bisher (HTML)": String(c.description ?? "").slice(0, 32000),
      Prüfhinweis: problem,
      "Kategorie-ID": c.id,
    });
  }

  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [{ wch: 28 }, { wch: 40 }, { wch: 28 }, { wch: 8 }, { wch: 40 }, { wch: 70 }, { wch: 90 }, { wch: 90 }, { wch: 40 }, { wch: 50 }, { wch: 10 }, { wch: 40 }, { wch: 40 }, { wch: 30 }, { wch: 34 }];
  const info = XLSX.utils.aoa_to_sheet([
    ["Texte für Kategorieseiten – Entwurf zur Freigabe (nichts ist im Shop)"],
    [`Erstellt: ${new Date().toISOString()} aus ${base}, Kanal ${DE_CHANNEL_NAME}`],
    ["Einleitung: 2–3 Sätze über der Produktliste. SEO-Text: 3–4 Abschnitte + Maßtabelle unter der Liste. FAQ: 4–6 Fragen (auch als JSON für FAQPage-Auszeichnung)."],
    ["Maßtabelle: vom Code aus den Produkten der Kategorie gebaut, nicht von der KI."],
    ["Prüfung: jede Zahl muss in den Kategoriedaten stehen; Herstellerangaben nur, wo belegt; keine Preis-/Lieferversprechen."],
    ["Anzeige im Shop braucht Text- und FAQ-Block im Layout „Fachbodenregale“ (Agentur)."],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Kategorietexte");
  XLSX.utils.book_append_sheet(book, info, "Hinweise");
  XLSX.writeFile(book, out);
  console.log(`FERTIG ${out}: ${rows.length} Kategorien, ${rows.filter((r) => !r.Prüfhinweis).length} mit Text`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
