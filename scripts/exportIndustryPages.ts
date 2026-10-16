/**
 * Branchen-Landingpages: Design-Entwürfe (HTML) und Freigabe-Excel aus server/products/industryPages.ts.
 * NUR LESEND, schreibt nichts in den Shop. Artikel, Netto-Preise, Lieferzeiten, Links und Bilder kommen
 * aus einem Shop-Stand (JSON), damit Entwurf und Excel dieselben Zahlen zeigen.
 * Die Bausteine (HTML + Stylesheet) teilen sich Entwurf und Shop: server/products/industryPageHtml.ts
 *
 * Aufruf:
 *   npx tsx scripts/exportIndustryPages.ts <shop-stand.json> <ausgabe-ordner> [--only kfz,handwerk]
 *
 * shop-stand.json: { asOf, source, products: { <Artikelnummer>: { name, priceNet, deliveryTime, url, image } } }
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import XLSXmod from "xlsx";
import { INDUSTRY_PAGES, fillPrices, formatEuro, referencedNumbers, type IndustryNote, type IndustryNoteKey, type IndustryPage } from "../server/products/industryPages";
import { IndustryPageHtml, esc, industryPageCss, plain, type IndustryShopProduct } from "../server/products/industryPageHtml";

const XLSX: any = (XLSXmod as any).readFile ? XLSXmod : (XLSXmod as any).default;

type ShopSnapshot = { asOf: string; source: string; products: Record<string, IndustryShopProduct> };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const draftName = (p: IndustryPage) =>
  ({ kfz: "Kfz-Reifen", handwerk: "Handwerk", industrie: "Industrie", buero: "Buero-Archiv", handel: "Handel-Versand" })[p.key] ?? p.key;

/** Entwurf: Nachbau von Shop-Kopf und -Fuss, dazu alle Bausteine mit Erklaerungen. */
function renderDraft(p: IndustryPage, shop: ShopSnapshot): string {
  const h = new IndustryPageHtml(p, shop.products, {
    notes: true,
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
<body class="notes">

<div class="draft"><div class="wrap">
  <span><b>ENTWURF</b> · Branchenseite „${esc(p.name)}“ · echte Artikel, Netto-Preise und Katalogwerte, Stand ${esc(shop.asOf.split("-").reverse().join("."))} · nicht im Shop</span>
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
  ${h.more(INDUSTRY_PAGES, (o) => `Entwurf-Branchenseite-${draftName(o)}.html`)}
</div></section>
</main>

<footer><div class="wrap"><span>META-Regalbau GmbH &amp; Co. KG · Eichenkamp · 59759 Arnsberg</span><span>Alle Preise exkl. gesetzl. MwSt. · *Garantiebedingungen</span></div></footer>
</body>
</html>
`;
}

// ───────────── Excel ─────────────

type TextRow = { Seite: string; Abschnitt: string; Element: string; Text: string; Zeichen: number; Quelle: string; Prüfhinweis: string; Freigabe: string; Korrektur: string };

function textRows(p: IndustryPage, shop: ShopSnapshot): TextRow[] {
  const rows: TextRow[] = [];
  const price = (n: string) => {
    const sp = shop.products[n];
    if (!sp) throw new Error(`Artikel ${n} fehlt`);
    return sp.priceNet;
  };
  const note = (k: IndustryNoteKey) => p.notes[k];
  const add = (abschnitt: string, element: string, text: string, k?: IndustryNoteKey) => {
    const t = plain(fillPrices(text, price));
    const n = k ? note(k) : undefined;
    rows.push({ Seite: p.name, Abschnitt: abschnitt, Element: element, Text: t, Zeichen: t.length, Quelle: n?.src ?? "", Prüfhinweis: (n?.checks ?? []).join("\n"), Freigabe: "", Korrektur: "" });
  };
  add("SEO", "Meta-Titel", p.metaTitle, "nav");
  add("SEO", "Meta-Beschreibung", p.metaDescription, "nav");
  add("Kopf", "Dachzeile", p.eyebrow, "hero");
  add("Kopf", "H1", p.h1, "hero");
  add("Kopf", "Einleitung", p.lead, "hero");
  p.proof.forEach((x, i) => add("Kopf", `Vorteil ${i + 1}`, x, "hero"));
  add("Kopf", "Button 1", p.ctaPrimary);
  add("Kopf", "Button 2", p.ctaSecondary);
  p.facts.forEach((f, i) => add("Kopf", `Kennzahl ${i + 1}`, `${f.value} – ${f.label}`, "hero"));
  add("Lagerbereiche", "Überschrift", p.areasTitle, "areas");
  add("Lagerbereiche", "Einleitung", p.areasIntro, "areas");
  p.areas.forEach((a, i) => {
    add("Lagerbereiche", `${i + 1} Titel`, a.title, "areas");
    add("Lagerbereiche", `${i + 1} Text`, a.text, "areas");
    add("Lagerbereiche", `${i + 1} META-Lösung`, a.solution, "areas");
    add("Lagerbereiche", `${i + 1} Link`, `${a.linkLabel} → ${a.linkTarget}`, "areas");
  });
  add("Planungshilfe", "Überschrift", p.planning.title, "planning");
  add("Planungshilfe", "Einleitung", p.planning.intro, "planning");
  p.planning.tables.forEach((t, ti) => {
    add("Planungshilfe", `Tabelle ${ti + 1} Kopf`, t.head.join(" | "), "planning");
    t.rows.forEach((r, ri) => add("Planungshilfe", `Tabelle ${ti + 1} Zeile ${ri + 1}`, r.join(" | "), "planning"));
    if (t.caption) add("Planungshilfe", `Tabelle ${ti + 1} Fußnote`, t.caption, "planning");
  });
  const ex = p.planning.example;
  if (ex) {
    add("Planungshilfe", "Beispiel Titel", ex.title, "planning");
    add("Planungshilfe", "Beispiel Annahmen", ex.sub, "planning");
    let sum = 0;
    ex.lines.forEach((l, i) => {
      const total = l.qty * price(l.number);
      sum += total;
      add("Planungshilfe", `Beispiel Position ${i + 1}`, `${l.qty} × ${l.label} (${l.number}) = ${formatEuro(total, true)}`, "planning");
    });
    add("Planungshilfe", "Beispiel Summe", `${formatEuro(sum, true)} netto${ex.perLabel ? ` · ≈ ${formatEuro(Math.round((sum / ex.perLabel.divisor) * 100) / 100, true)} je ${ex.perLabel.unit}` : ex.info ? ` · ${ex.info}` : ""}`, "planning");
    if (ex.warn) add("Planungshilfe", "Beispiel Hinweis", ex.warn, "planning");
  }
  add("Produkte", "Überschrift", p.productsTitle, "products");
  p.duties.meta.forEach((d, i) => add("Sicherheit & Pflichten", `META ${i + 1}`, d, "duties"));
  p.duties.operator.forEach((d, i) => add("Sicherheit & Pflichten", `Betreiber ${i + 1}`, d, "duties"));
  add("Sicherheit & Pflichten", "Hinweis", p.duties.hint, "duties");
  p.why.forEach((w, i) => add("Vorteile", `${i + 1}`, `${w.title} – ${w.text}`, "why"));
  add("Projekt", "Dachzeile", p.project.eyebrow, "project");
  add("Projekt", "Titel", p.project.title, "project");
  add("Projekt", "Text", p.project.text, "project");
  if (p.project.link) add("Projekt", "Link", `${p.project.link.label} → ${p.project.link.href}`, "project");
  p.docs.forEach((d, i) => add("Unterlagen", `${i + 1}`, `${d.label} (${d.where})`, "project"));
  add("FAQ", "Überschrift", p.faqTitle, "faq");
  p.faq.forEach((f, i) => {
    add("FAQ", `Frage ${i + 1}`, f.q, "faq");
    add("FAQ", `Antwort ${i + 1}`, f.a, "faq");
  });
  add("Beratung", "Titel", p.advice.title, "advice");
  add("Beratung", "Text", p.advice.text, "advice");
  return rows;
}

function main(): void {
  const [snapPath, outDir] = process.argv.slice(2);
  if (!snapPath || !outDir) {
    console.error("Usage: npx tsx scripts/exportIndustryPages.ts <shop-stand.json> <ausgabe-ordner> [--only kfz,handwerk]");
    process.exit(1);
  }
  const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const shop: ShopSnapshot = JSON.parse(readFileSync(snapPath, "utf8"));
  const pages = INDUSTRY_PAGES.filter((p) => only.size === 0 || only.has(p.key));

  // Alle Artikel muessen im Shop-Stand sein, sonst bricht der Export ab (keine Platzhalter in Entwurf/Excel)
  const missing = pages.flatMap((p) => referencedNumbers(p).filter((n) => !shop.products[n]).map((n) => `${p.key}: ${n}`));
  if (missing.length) throw new Error(`Artikel fehlen im Shop-Stand:\n${missing.join("\n")}`);

  for (const p of pages) {
    const file = path.join(outDir, `Entwurf-Branchenseite-${draftName(p)}.html`);
    writeFileSync(file, renderDraft(p, shop));
    console.log("Entwurf:", file);
  }

  const seiten = pages.map((p) => ({
    Seite: p.name,
    URL: p.url,
    "Meta-Titel": p.metaTitle,
    "Zeichen Titel": p.metaTitle.length,
    "Meta-Beschreibung": p.metaDescription,
    "Zeichen Beschreibung": p.metaDescription.length,
    H1: p.h1,
    Einleitung: p.lead,
    Entwurf: `Entwurf-Branchenseite-${draftName(p)}.html`,
    Freigabe: "",
    Anmerkung: "",
  }));
  const texte = pages.flatMap((p) => textRows(p, shop));
  const produkte = pages.flatMap((p) => {
    const uses = [
      { Platz: "Bild oben", number: p.hero.number, use: "" },
      ...p.products.map((c, i) => ({ Platz: `Produkt ${i + 1}`, number: c.number, use: c.use })),
      ...(p.planning.example?.lines ?? []).map((l, i) => ({ Platz: `Beispiel ${i + 1} (× ${l.qty})`, number: l.number, use: "" })),
    ];
    return uses.map((u) => {
      const sp = shop.products[u.number];
      return { Seite: p.name, Platz: u.Platz, Artikelnummer: u.number, "Name im Shop": sp.name, "Preis netto": sp.priceNet, Lieferzeit: sp.deliveryTime ?? "", Etikett: u.use, Bild: u.Platz.startsWith("Beispiel") ? "–" : sp.image ? "ja" : "FEHLT", URL: sp.url ?? "" };
    });
  });
  const pruef = pages.flatMap((p) =>
    (Object.entries(p.notes) as Array<[IndustryNoteKey, IndustryNote]>).flatMap(([k, n]) => (n.checks ?? []).map((c) => ({ Seite: p.name, Abschnitt: k, Prüfpunkt: c, Antwort: "" }))),
  );

  const wb = XLSX.utils.book_new();
  const sheet = (rows: object[], cols: number[], name: string) => {
    const s = XLSX.utils.json_to_sheet(rows);
    s["!cols"] = cols.map((wch) => ({ wch }));
    s["!autofilter"] = { ref: s["!ref"] };
    XLSX.utils.book_append_sheet(wb, s, name);
  };
  sheet(seiten, [30, 34, 60, 8, 90, 8, 60, 90, 36, 12, 30], "Seiten");
  sheet(texte, [26, 20, 22, 100, 8, 34, 40, 12, 40], "Texte");
  sheet(produkte, [26, 18, 16, 80, 10, 14, 16, 8, 60], "Produkte");
  sheet(pruef, [26, 12, 90, 50], "Prüfliste");
  const hinweise = XLSX.utils.aoa_to_sheet([
    ["Branchen-Landingpages – Texte zur Freigabe (nichts ist im Shop)"],
    [`Erstellt: ${new Date().toISOString()} aus server/products/industryPages.ts, Shop-Stand ${shop.asOf} (${shop.source})`],
    ["Spalte „Freigabe“: ok / ändern / streichen. Änderungen bitte in „Korrektur“ eintragen – sie fließen in industryPages.ts zurück."],
    ["Preise sind Netto-Preise aus dem Shop und werden beim Schreiben in den Shop nicht als Text gespeichert: Produktkacheln holen Preis und Lieferzeit live."],
    ["Regel: nur belegte META-Inhalte (Katalog „Lagersysteme“ 10/2026, Shop-Artikel, META-Referenzen); Quellen je Zeile in Spalte „Quelle“."],
  ]);
  hinweise["!cols"] = [{ wch: 140 }];
  XLSX.utils.book_append_sheet(wb, hinweise, "Hinweise");
  const xlsx = path.join(outDir, `Branchenseiten-Texte-${shop.asOf}.xlsx`);
  XLSX.writeFile(wb, xlsx);
  console.log("Excel:", xlsx, `(${texte.length} Textzeilen, ${produkte.length} Artikelzeilen, ${pruef.length} Prüfpunkte)`);
}

main();
