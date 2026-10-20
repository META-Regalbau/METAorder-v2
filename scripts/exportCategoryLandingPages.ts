/**
 * System-Landingpages (Vorlage A–K): Design-Entwürfe (HTML) aus server/products/categoryLandingPages.ts.
 * NUR LESEND, schreibt nichts in den Shop. Artikel, Netto-Preise, Lieferzeiten, Links und Bilder kommen aus einem
 * Shop-Stand (JSON, gleiches Format wie bei scripts/exportIndustryPages.ts).
 *
 * Aufruf:
 *   npx tsx scripts/exportCategoryLandingPages.ts <shop-stand.json> <ausgabe-ordner> [--only fachboden]
 *
 * shop-stand.json: { asOf, source, products: { <Artikelnummer>: { name, priceNet, deliveryTime, url, image } } }
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { CATEGORY_LANDING_PAGES, landingProductNumbers, rowFigures } from "../server/products/categoryLandingPages";
import { categoryLandingDraftHtml } from "../server/products/categoryLandingDraft";
import type { IndustryShopProduct } from "../server/products/industryPageHtml";

type ShopSnapshot = { asOf: string; source: string; products: Record<string, IndustryShopProduct> };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const draftName = (key: string) => ({ fachboden: "Fachbodenregale", buero: "Bueroregale", paletten: "Palettenregale", kragarm: "Kragarmregale", weitspann: "Weitspannregale" })[key] ?? key;

function main(): void {
  const [snapPath, outDir] = process.argv.slice(2);
  if (!snapPath || !outDir) {
    console.error("Usage: npx tsx scripts/exportCategoryLandingPages.ts <shop-stand.json> <ausgabe-ordner> [--only fachboden]");
    process.exit(1);
  }
  const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const shop: ShopSnapshot = JSON.parse(readFileSync(snapPath, "utf8"));
  const pages = CATEGORY_LANDING_PAGES.filter((p) => only.size === 0 || only.has(p.key));

  // Alle Artikel muessen im Shop-Stand sein, sonst bricht der Export ab (keine Platzhalter im Entwurf)
  const missing = pages.flatMap((p) => landingProductNumbers(p).filter((n) => !shop.products[n]).map((n) => `${p.key}: ${n}`));
  if (missing.length) throw new Error(`Artikel fehlen im Shop-Stand:\n${missing.join("\n")}`);

  for (const p of pages) {
    const f = rowFigures(p.guide.example.row);
    if (!f.fits || !f.loadOk) throw new Error(`${p.key}: Rechenbeispiel geht nicht auf (Länge ${f.footLength} mm, Last ${f.sumLoad} kg)`);
    const file = path.join(outDir, `Entwurf-Landingpage-${draftName(p.key)}.html`);
    writeFileSync(file, categoryLandingDraftHtml(p, shop.products, { asOf: shop.asOf }));
    console.log("Entwurf:", file);
  }
}

main();
