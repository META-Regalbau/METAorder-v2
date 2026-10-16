// Entwurfsansicht einer Branchenseite: Nachbau von Shop-Kopf und -Fuss mit allen Bausteinen und den gelben
// Erklaerungen (Belege). Genutzt von scripts/exportIndustryPages.ts (Entwurf-Dateien) und der Vorschau der
// Pflegeoberflaeche Shop-Inhalte (server/shopContent/shopContentPreview.ts). Schreibt nichts in den Shop.
import type { IndustryContact } from "@shared/shopContent";
import type { IndustryPage } from "./industryPages";
import { IndustryPageHtml, esc, industryPageCss, type IndustryShopProduct } from "./industryPageHtml";

export type IndustryDraftOptions = {
  /** Stand der Artikeldaten (JJJJ-MM-TT) fuer die Kopfzeile */
  asOf: string;
  /** Alle Branchenseiten fuer „Weitere Branchen“ */
  pages: IndustryPage[];
  hrefFor: (p: IndustryPage) => string;
  contact?: IndustryContact;
  /** Erklaerungen beim Laden einblenden (Standard: ja) */
  notes?: boolean;
  /** Text der Kopfzeile statt „ENTWURF … nicht im Shop“ */
  banner?: string;
};

export function industryDraftHtml(p: IndustryPage, products: Record<string, IndustryShopProduct>, opts: IndustryDraftOptions): string {
  const notes = opts.notes ?? true;
  const h = new IndustryPageHtml(p, products, {
    notes,
    contact: opts.contact,
    cartForm: false,
    linkHref: (t) => (t.startsWith("#") ? t : "#"),
  });
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Branchenseite ${esc(p.short)} – Entwurf</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${industryPageCss()}
</style>
</head>
<body${notes ? ' class="notes"' : ""}>

<div class="draft"><div class="wrap">
  <span>${opts.banner ? esc(opts.banner) : `<b>ENTWURF</b> · Branchenseite „${esc(p.name)}“ · echte Artikel, Netto-Preise und Katalogwerte, Stand ${esc(opts.asOf.split("-").reverse().join("."))} · nicht im Shop`}</span>
  <button onclick="document.body.classList.toggle('notes')">Erklärungen ein/aus</button>
</div></div>

<div class="usp"><div class="wrap"><span>Kostenloser Versand</span><span>Nur B2B-Verkauf</span><span>5 Jahre Garantie*</span><span>Sicher einkaufen dank SSL</span></div></div>
<header class="shop"><div class="wrap">
  <div class="logo">META<span>at all levels</span></div>
  <form class="search" onsubmit="return false"><input placeholder="Suchbegriff eingeben …" aria-label="Suche"></form>
  <div class="hdr-ic"><span>Ihr Konto</span><span>Warenkorb</span></div>
</div></header>
<nav class="main" aria-label="Hauptnavigation"><div class="wrap">
  <a href="#">Home</a><a href="#">Fachbodenregale</a><a href="#">Büroregale</a><a href="#">Palettenregale</a><a href="#">Kragarmregale</a><a href="#">Weitspannregale</a><a href="#">Zubehör</a><a class="on" href="#">Branchen<span class="new">NEU</span></a><a href="#">Service</a>
</div></nav>

<main>
<div class="wrap">
  <div class="crumb"><a href="#">Home</a> › <a href="#">Branchen</a> › ${esc(p.name)}</div>
  ${h.note("nav")}
  <div class="meta-preview"><b>${esc(p.metaTitle)}</b><i>shop.meta-online.com${esc(p.url)}</i>${esc(p.metaDescription)}</div>
</div>

${h.hero()}

${h.jump()}

${h.areas()}

${h.planning()}

<section class="sec"><div class="wrap">
  ${h.productsHead("#")}
  ${h.productCards()}
</div></section>

${h.duties()}

${h.why()}

${h.project()}

<section class="sec" id="faq"><div class="wrap faq">
  <div>
    ${h.faqHead()}
  </div>
  <div>
${h.faqItems()}
  </div>
</div></section>

<section id="beratung"><div class="wrap">
  ${h.advice()}
  ${h.more(opts.pages, opts.hrefFor)}
</div></section>
</main>

<footer><div class="wrap"><span>META-Regalbau GmbH &amp; Co. KG · Eichenkamp · 59759 Arnsberg</span><span>Alle Preise exkl. gesetzl. MwSt. · *Garantiebedingungen</span></div></footer>
</body>
</html>
`;
}

/** Startseiten-Abschnitt als eigenes Dokument (Vorschau): Stylesheet der Branchenseiten + Abschnitt */
export function homeSectionDraftHtml(title: string, sectionHtml: string, banner: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${industryPageCss()}
</style>
</head>
<body>
<div class="draft"><div class="wrap"><span>${esc(banner)}</span></div></div>
${sectionHtml}
</body>
</html>
`;
}
