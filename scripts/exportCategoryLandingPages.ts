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
import { esc, type IndustryShopProduct } from "../server/products/industryPageHtml";
import { SERVICE_PAGES, type ServicePage } from "../server/products/servicePages";
import { instructionsPageHtml, montageServiceBottomHtml, montageServiceTopHtml, servicePageCss, servicePageScript } from "../server/products/servicePageHtml";

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
    if (!f.fits || !f.loadOk || !f.itemOk) throw new Error(`${p.key}: Rechenbeispiel geht nicht auf (Länge ${f.length} mm, Last ${f.sumLoad} kg)`);
    const file = path.join(outDir, `Entwurf-Landingpage-${draftName(p.key)}.html`);
    const menuHref = (menuName: string) => {
      const other = CATEGORY_LANDING_PAGES.find((o) => o.name === menuName);
      return other ? `Entwurf-Landingpage-${draftName(other.key)}.html` : undefined;
    };
    writeFileSync(file, categoryLandingDraftHtml(p, shop.products, { asOf: shop.asOf, menuHref }));
    console.log("Entwurf:", file);
  }
}

/** Entwurf einer Service-Seite; das Shopware-Kontaktformular ist nachgebaut (im Shop: Standard-Formularelement) */
function serviceDraft(p: ServicePage): string {
  let n = 0;
  const note = (k: keyof ServicePage["notes"]) => {
    const x = p.notes[k];
    if (!x) return "";
    n += 1;
    return `<div class="wrap"><aside class="note"><span class="n">${n}</span>${esc(x.text)} ${(x.checks ?? []).map((c) => `<span class="chk">prüfen: ${esc(c)}</span>`).join(" ")}<span class="src">Quelle: ${esc(x.src ?? "")}</span></aside></div>`;
  };
  const form = `<section><div class="wrap" style="max-width:860px;padding-bottom:40px"><form onsubmit="return false" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px">
    ${["Anrede", "Vorname*", "Nachname*", "E-Mail-Adresse*", "Telefonnummer", "Betreff*"].map((l, i) => `<label style="display:flex;flex-direction:column;gap:4px${i === 0 ? ";grid-column:1/-1;max-width:50%" : ""}">${l}<input ${l === "Betreff*" ? 'id="form-subject" name="subject"' : ""} style="border:1px solid #ccc;padding:10px;font:inherit"></label>`).join("")}
    <label style="grid-column:1/-1;display:flex;flex-direction:column;gap:4px">Ihre Nachricht*<textarea id="form-comment" name="comment" rows="8" style="border:1px solid #ccc;padding:10px;font:inherit"></textarea></label>
    <button class="btn" style="grid-column:1/-1;justify-self:start">Absenden</button></form>
    <p class="tcap">Nachbau des Shopware-Kontaktformulars (im Shop mit Datenschutzhinweis und Captcha wie das bestehende Kontaktformular).</p></div></section>`;
  const body =
    p.key === "anleitungen"
      ? instructionsPageHtml(note)
      : montageServiceTopHtml(note) + form + montageServiceBottomHtml(note);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.name)} – Entwurf</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${servicePageCss()}</style></head>
<body class="notes"><div class="draft"><div class="wrap"><span><b>ENTWURF</b> · Service-Seite „${esc(p.name)}“ (/${esc(p.url)}) · nicht im Shop</span><button onclick="document.body.classList.toggle('notes')">Erklärungen ein/aus</button></div></div>
<main>${body}</main>${servicePageScript()}</body></html>`;
}

function exportServiceDrafts(outDir: string): void {
  for (const p of SERVICE_PAGES) {
    const file = path.join(outDir, `Entwurf-Service-${p.key === "anleitungen" ? "Montageanleitungen" : "Montageservice"}.html`);
    writeFileSync(file, serviceDraft(p));
    console.log("Entwurf:", file);
  }
}

main();
exportServiceDrafts(process.argv[3]);
