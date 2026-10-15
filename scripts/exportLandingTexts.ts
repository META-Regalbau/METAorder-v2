/**
 * Texte und Kennzahlen fuer die Landingpages der Hauptkategorien als Excel zur Freigabe.
 * NUR LESEND: liest Landingpages/Layouts (Admin-API) und die Produkte der Regal-Kategorien
 * (Store-API, wie Kunden sie sehen). Konfiguration und Kennzahlen: server/products/landingPageTexts.ts,
 * Texte und Pruefregeln wie bei den Kategorieseiten: server/products/categoryTexts.ts
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/exportLandingTexts.ts <shopTenantId> <out.xlsx> [--llm-tenant <tenantId>] [--only fachboden,paletten]
 */
import { existsSync } from "fs";
import XLSXmod from "xlsx";
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
import { LANDING_PAGES, keyFigureText, keyFiguresFromProducts, mainTypeProducts, needsGeneratedText } from "../server/products/landingPageTexts";

const XLSX: any = (XLSXmod as any).readFile ? XLSXmod : (XLSXmod as any).default;
const DE_CHANNEL_NAME = "META Regalbau DE";
const DE_LANG = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function main(): Promise<void> {
  const [tenantId, out] = process.argv.slice(2);
  if (!tenantId || !out?.endsWith(".xlsx")) {
    console.error("Usage: npx tsx scripts/exportLandingTexts.ts <shopTenantId> <out.xlsx> [--llm-tenant id] [--only key,key]");
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

  const channels = await admin("search/sales-channel", { limit: 50, associations: { domains: {} }, includes: { sales_channel: ["id", "name", "navigationCategoryId", "accessKey", "domains"], sales_channel_domain: ["url"] } });
  const de = channels.data.find((c: any) => c.name === DE_CHANNEL_NAME);
  const domain = ((de.domains ?? []).map((d: any) => d.url).find((u: string) => /shop\.meta-online\.com|test\./.test(u)) ?? base).replace(/\/$/, "");
  const cats = await admin("search/category", {
    limit: 500,
    filter: [{ type: "contains", field: "path", value: de.navigationCategoryId }, { type: "equals", field: "active", value: true }, { type: "equals", field: "type", value: "page" }],
    includes: { category: ["id", "name"] },
  });
  const lps = await admin("search/landing-page", {
    ids: LANDING_PAGES.map((l) => l.landingPageId),
    associations: { cmsPage: { associations: { sections: { associations: { blocks: { associations: { slots: {} } } } } } } },
  });
  const faqGroupQuestions = async (groupId: string) =>
    (await admin("search/hueb-seo-faq-questions", { limit: 50, filter: [{ type: "equals", field: "group", value: groupId }], sort: [{ field: "questionPosition", order: "ASC" }] })).data ?? [];

  const generate = llmCategoryTextGenerator((k) => storage.getSetting(k, llmTenant));
  const review = llmCategoryTextReviewer((k) => storage.getSetting(k, llmTenant));
  const rows: any[] = [];
  for (const cfg of LANDING_PAGES) {
    if (only.size && !only.has(cfg.key)) continue;
    const lp = lps.data.find((x: any) => x.id === cfg.landingPageId);
    if (!lp) {
      console.log(`FEHLT Landingpage ${cfg.key}`);
      continue;
    }
    const sections = [...(lp.cmsPage?.sections ?? [])].sort((a: any, b: any) => a.position - b.position);
    const slotsOf = (sec: any) => [...(sec?.blocks ?? [])].sort((a: any, b: any) => a.position - b.position).flatMap((b: any) => b.slots ?? []);
    const heroHtml = slotsOf(sections[0]).find((s: any) => s.type === "text")?.config?.content?.value ?? "";
    const currentFigures = slotsOf(sections[1]).filter((s: any) => s.type === "text").map((s: any) => keyFigureText(String(s.config?.content?.value ?? "")));
    const faqSlot = sections.flatMap(slotsOf).find((s: any) => /hueb-faq/.test(s.type));
    const currentFaq = faqSlot?.config?.group?.value ? await faqGroupQuestions(faqSlot.config.group.value) : [];

    const products: CategoryProduct[] = [];
    for (const c of cats.data.filter((c: any) => cfg.shelfCategories.test(c.name))) {
      for (let page = 1; page <= 20; page++) {
        const r = await fetch(`${domain}/store-api/product-listing/${c.id}`, {
          method: "POST",
          headers: { "sw-access-key": de.accessKey, "sw-language-id": DE_LANG, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ p: page, limit: 100, order: "topseller", associations: { properties: { associations: { group: {} } } } }),
        });
        if (!r.ok) break;
        const els = ((await r.json()) as any).elements ?? [];
        for (const p of els) {
          products.push({
            name: String(p.translated?.name ?? ""),
            properties: (p.properties ?? []).map((o: any) => ({ group: String(o.group?.translated?.name ?? ""), option: String(o.translated?.name ?? "") })),
          });
        }
        if (els.length < 100) break;
      }
    }
    // Texte beschreiben nur den Hauptregaltyp der Seite (Sonderregale und Altnamen verzerren die Spannen)
    const facts = buildCategoryFacts({ id: cfg.landingPageId, name: cfg.factsName, url: cfg.url, breadcrumb: cfg.factsName }, mainTypeProducts(products, cfg));
    if (cfg.ignoreNameLoads) {
      facts.loads = [];
      // auch nicht ueber die Beispielnamen; Oberflaeche aus den Namen gilt nur fuer die Staender (Holme RAL 2001)
      facts.topProducts = facts.topProducts.map((n) => n.replace(/\s*\|\s*(Fachlast|Feldlast)\s+[\d.]+\s*kg/gi, "").replace(/\s*\|\s*(verzinkt|RAL \d{4})$/i, ""));
      facts.surfaces = [];
      facts.systemFeatures = facts.systemFeatures.map((x) => ({ ...x, values: x.values.filter((v) => !/^(Fachlast|Feldlast|Armlast) \(kg\)/.test(v)) }));
    }
    const figures = keyFiguresFromProducts(products, cfg, currentFigures);
    process.stdout.write(`${cfg.key} (${products.length} Regale) … `);
    const { text, problem } = needsGeneratedText(cfg) ? await generateCategoryText(facts, generate, review) : { text: null, problem: "" };
    const html = text ? buildCategoryHtml(facts, text) : null;
    console.log(problem ? `PRÜFHINWEIS: ${problem}` : "ok");
    rows.push({
      Landingpage: cfg.key,
      URL: cfg.url,
      "Regale (Artikel)": `${facts.productCount} von ${products.length} (Hauptregaltyp)`,
      "Was wird geändert": cfg.plan,
      "Kennzahlen bisher": currentFigures.join("\n"),
      "Kennzahlen neu (aus Shopdaten)": figures.map((f, i) => (cfg.keepFigures?.includes(i) ? `${f} (bleibt)` : cfg.figureOverrides?.[i] ? `${f} (Katalog)` : f)).join("\n"),
      "Wird verwendet": [
        cfg.replaceHero ? "H1 + Einleitung (Kopf)" : "",
        cfg.replaceSeoText || cfg.addSections ? "SEO-Text" : "",
        cfg.addSections ? "FAQ neu, Links, Topseller, Beratung" : "",
        ...(cfg.textFixes ?? []).map((f) => `Korrektur: ${f.note} → „${f.replace}“`),
        ...(cfg.faqFixes ?? []).map((f) => `FAQ-Korrektur: ${f.note}${f.newQuestion ? ` → „${f.newQuestion}“` : ""}${f.newAnswer ? ` → „${f.newAnswer}“` : ""}`),
      ].filter(Boolean).join("\n"),
      "Kopf bisher": plain(heroHtml),
      "H1 neu": text?.h1 ?? "",
      "Einleitung neu (HTML)": html?.introHtml ?? "",
      "SEO-Text neu (HTML)": html?.seoHtml ?? "",
      "FAQ neu (JSON)": html?.faqJson ?? "",
      "FAQ bisher": currentFaq.map((q: any) => `${q.translated?.question ?? q.question}\n→ ${plain(String(q.translated?.answer ?? q.answer ?? ""))}`).join("\n\n"),
      "Maßtabelle (aus Produktdaten)": factsTableHtml(facts),
      "Herstellerangaben belegt": facts.familyClaims ?? "",
      "Katalogangaben (Seite)": facts.catalogFacts.map((c) => `S. ${c.page} – ${c.system}: ${c.text}`).join("\n"),
      Prüfhinweis: problem,
      Plausibilitätsprüfung: problem ? "offen – siehe Prüfhinweis" : needsGeneratedText(cfg) ? "geprüft: Zahlen gegen Produktdaten, Herstellerangaben, Wettbewerber, KI-Gegenlesen" : "",
      "Landingpage-ID": cfg.landingPageId,
    });
  }

  // Mit --only: Zeilen der anderen Seiten aus der vorhandenen Datei uebernehmen (Reihenfolge wie LANDING_PAGES)
  if (only.size && existsSync(out)) {
    const old = XLSX.utils.sheet_to_json(XLSX.readFile(out).Sheets["Landingpages"]) as any[];
    const merged = LANDING_PAGES.map((c) => rows.find((r) => r.Landingpage === c.key) ?? old.find((r) => r.Landingpage === c.key)).filter(Boolean);
    rows.splice(0, rows.length, ...merged);
  }
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [{ wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 60 }, { wch: 32 }, { wch: 36 }, { wch: 50 }, { wch: 50 }, { wch: 40 }, { wch: 70 }, { wch: 90 }, { wch: 70 }, { wch: 70 }, { wch: 50 }, { wch: 40 }, { wch: 30 }, { wch: 34 }];
  const info = XLSX.utils.aoa_to_sheet([
    ["Landingpages – Texte und Kennzahlen zur Freigabe (nichts ist im Shop)"],
    [`Erstellt: ${new Date().toISOString()} aus ${base}, Kanal ${DE_CHANNEL_NAME}`],
    ["Kennzahlen neu: aus den Artikelnamen der Regal-Kategorien (was Kunden im Shop kaufen können). Spalte darf geändert werden."],
    ["Texte: wie bei den Kategorieseiten geprüft – jede Zahl muss in den Produktdaten stehen, Herstellerangaben nur, wo belegt."],
    ["Was nicht in „Was wird geändert“ steht, bleibt unverändert (auch die nur für „Headless“ freigegebenen Agentur-Abschnitte)."],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Landingpages");
  XLSX.utils.book_append_sheet(book, info, "Hinweise");
  XLSX.writeFile(book, out);
  console.log(`FERTIG ${out}: ${rows.length} Landingpages, ${rows.filter((r) => !r.Prüfhinweis).length} mit Text`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
