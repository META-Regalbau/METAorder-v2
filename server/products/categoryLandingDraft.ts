// Entwurfsansicht einer System-Landingpage: Nachbau von Shop-Kopf und -Fuss mit allen Bausteinen (Vorlage A–K)
// und den gelben Erklaerungen (Belege). Genutzt von scripts/exportCategoryLandingPages.ts. Schreibt nichts in den Shop.
import type { CategoryLandingPage } from "./categoryLandingPages";
import { CategoryLandingHtml, categoryLandingCss } from "./categoryLandingPageHtml";
import { esc, type IndustryShopProduct } from "./industryPageHtml";

export function categoryLandingDraftHtml(
  p: CategoryLandingPage,
  products: Record<string, IndustryShopProduct>,
  opts: { asOf: string; notes?: boolean; /** Menüpunkt → Entwurfsdatei der anderen Seiten */ menuHref?: (menuName: string) => string | undefined },
): string {
  const notes = opts.notes ?? true;
  const h = new CategoryLandingHtml(p, products, { notes, cartForm: false });
  const menu = ["Fachbodenregale", "Büroregale", "Palettenregale", "Kragarmregale", "Weitspannregale", "Zubehör", "Regal-Lexikon", "Service"];
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Landingpage ${esc(p.name)} – Entwurf</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${categoryLandingCss()}
</style>
</head>
<body${notes ? ' class="notes"' : ""}>

<div class="draft"><div class="wrap">
  <span><b>ENTWURF</b> · Landingpage „${esc(p.name)}“ (${esc(p.url)}) · Vorlage A–K mit neuem Abschnitt „So bauen Sie Ihr Regal“ · echte Artikel und Netto-Preise, Stand ${esc(opts.asOf.split("-").reverse().join("."))} · nicht im Shop</span>
  <button onclick="document.body.classList.toggle('notes')">Erklärungen ein/aus</button>
</div></div>

<div class="usp"><div class="wrap"><span>Kostenloser Versand</span><span>Nur B2B-Verkauf</span><span>Sicher einkaufen dank SSL</span></div></div>
<header class="shop"><div class="wrap">
  <div class="logo">META<span>at all levels</span></div>
  <form class="search" onsubmit="return false"><input placeholder="Suchbegriff eingeben …" aria-label="Suche"></form>
  <div class="hdr-ic"><span>Ihr Konto</span><span>Warenkorb</span></div>
</div></header>
<nav class="main" aria-label="Hauptnavigation"><div class="wrap">
  <a href="#">Home</a>${menu.map((m) => `<a${m === p.name ? ' class="on"' : ""} href="${esc(opts.menuHref?.(m) ?? "#")}">${esc(m)}</a>`).join("")}
</div></nav>

<main>
<div class="wrap"><div class="crumb"><a href="#">Home</a> › ${esc(p.name)}</div></div>

${h.hero()}

${h.jump()}

${h.systems()}

${h.tiles()}

${h.guide()}

${h.plan()}

<section class="sec"><div class="wrap">
  ${h.productsHead()}
  ${h.productCards()}
</div></section>

${h.seo()}

<section class="sec sec-grey" id="faq"><div class="wrap faq">
  <div>
    ${h.faqHead()}
  </div>
  <div>
${h.faqItems()}
  </div>
</div></section>

<section id="beratung" class="sec"><div class="wrap">
  ${h.advice()}
</div></section>
</main>

<footer><div class="wrap"><span>META-Regalbau GmbH &amp; Co. KG · Eichenkamp · 59759 Arnsberg</span><span>Alle Preise exkl. gesetzl. MwSt.</span></div></footer>
</body>
</html>
`;
}
