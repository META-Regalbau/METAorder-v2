/**
 * Branchen-Landingpages: Design-Entwürfe (HTML) und Freigabe-Excel aus server/products/industryPages.ts.
 * NUR LESEND, schreibt nichts in den Shop. Artikel, Netto-Preise, Lieferzeiten, Links und Bilder kommen
 * aus einem Shop-Stand (JSON), damit Entwurf und Excel dieselben Zahlen zeigen.
 *
 * Aufruf:
 *   npx tsx scripts/exportIndustryPages.ts <shop-stand.json> <ausgabe-ordner> [--only kfz,handwerk]
 *
 * shop-stand.json: { asOf, source, products: { <Artikelnummer>: { name, priceNet, deliveryTime, url, image } } }
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSXmod from "xlsx";
import {
  CONTACT,
  INDUSTRY_PAGES,
  fillPrices,
  formatEuro,
  referencedNumbers,
  type IndustryIcon,
  type IndustryNote,
  type IndustryNoteKey,
  type IndustryPage,
} from "../server/products/industryPages";

const XLSX: any = (XLSXmod as any).readFile ? XLSXmod : (XLSXmod as any).default;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ShopProduct = { name: string; priceNet: number; deliveryTime?: string; url?: string | null; image?: string | null };
type ShopSnapshot = { asOf: string; source: string; products: Record<string, ShopProduct> };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const deliveryText = (p: ShopProduct) => (p.deliveryTime ? `Lieferzeit ${p.deliveryTime.replace(/\s*-\s*/, "–")}` : "Lieferzeit laut Shop");

const ICONS: Record<IndustryIcon, string> = {
  tire: '<circle cx="20" cy="20" r="15"/><circle cx="20" cy="20" r="7"/><path d="M20 5v8M20 27v8M5 20h8M27 20h8"/>',
  move: '<rect x="9" y="5" width="22" height="25"/><path d="M9 13h22M9 21h22"/><circle cx="13" cy="34" r="2.5"/><circle cx="27" cy="34" r="2.5"/>',
  cart: '<rect x="9" y="5" width="22" height="25"/><circle cx="13" cy="34" r="2.5"/><circle cx="27" cy="34" r="2.5"/>',
  grid: '<rect x="5" y="6" width="30" height="28"/><path d="M5 15h30M5 24h30M15 6v28M25 6v28"/>',
  drop: '<path d="M20 5c5 7 9 12 9 17a9 9 0 0 1-18 0c0-5 4-10 9-17z"/><path d="M15 23a5 5 0 0 0 5 5"/>',
  cabinet: '<rect x="7" y="5" width="26" height="30"/><path d="M7 20h26M18 12h4M18 27h4"/>',
  pallet: '<path d="M5 33h30M8 33V9h24v24M8 21h24M14 33v-6h12v6"/>',
  drum: '<circle cx="20" cy="20" r="14"/><circle cx="20" cy="20" r="4"/><path d="M6 20h4M30 20h4"/><path d="M11 11c4 3 14 3 18 0M11 29c4-3 14-3 18 0"/>',
  profiles: '<path d="M8 35V5M14 35V9M20 35V5M26 35V9M32 35V5M5 35h30"/>',
  pipes: '<path d="M5 12h30M5 20h30M5 28h30"/><circle cx="5" cy="12" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="5" cy="28" r="2"/>',
  screws: '<path d="M6 30l8-8M6 30l-1 4 4-1M14 22l4-4M17 17l3 3"/><rect x="22" y="6" width="12" height="12"/><path d="M22 24h12v10H22z"/>',
  helmet: '<path d="M8 26a12 12 0 0 1 24 0"/><path d="M5 26h30v4H5zM20 14v-4"/>',
  folder: '<path d="M8 6h6v28H8zM17 6h6v28h-6zM26 6h6v28h-6z"/><path d="M8 26h6M17 26h6M26 26h6"/>',
  archive: '<rect x="5" y="8" width="30" height="7"/><path d="M7 15v19h26V15M16 21h8"/>',
  lock: '<rect x="9" y="17" width="22" height="17"/><path d="M14 17v-5a6 6 0 0 1 12 0v5M20 23v5"/>',
  box: '<path d="M5 13l15-7 15 7v15l-15 7-15-7z"/><path d="M5 13l15 7 15-7M20 20v15"/>',
  package: '<rect x="6" y="12" width="28" height="20"/><path d="M6 12l4-6h20l4 6M17 12v8h6v-8"/>',
  store: '<path d="M5 14l3-8h24l3 8M5 14v20h30V14M5 14h30M15 34V24h10v10"/>',
  heavy: '<rect x="6" y="18" width="28" height="14"/><path d="M12 18v-6h16v6M20 12V6"/>',
  warning: '<path d="M20 5l16 28H4z"/><path d="M20 15v9M20 28v1"/>',
};

const CHECK_MASK =
  "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path d=\"M6.2 11.6 2.6 8l1.1-1.1 2.5 2.5 6.1-6.1L13.4 4.4z\"/></svg>')";

class Renderer {
  private n = 0;
  constructor(private page: IndustryPage, private shop: ShopSnapshot) {}

  product(num: string): ShopProduct {
    const p = this.shop.products[num];
    if (!p) throw new Error(`${this.page.key}: Artikel ${num} fehlt im Shop-Stand`);
    return p;
  }
  price = (num: string) => this.product(num).priceNet;
  prices = (text: string) => fillPrices(text, this.price);

  note(key: IndustryNoteKey, extra = ""): string {
    const note: IndustryNote | undefined = this.page.notes[key];
    if (!note) return "";
    this.n += 1;
    const checks = (note.checks ?? []).map((c) => `<span class="chk">prüfen: ${esc(c)}</span>`).join(" ");
    const src = note.src ? `<span class="src">Quelle: ${esc(note.src)}</span>` : "";
    return `<aside class="note"${extra}><span class="n">${this.n}</span>${esc(note.text)} ${checks}${src}</aside>`;
  }

  table(t: IndustryPage["planning"]["tables"][number], first: boolean): string {
    const cls = (i: number) => [t.numCols?.includes(i) ? "num" : "", t.hideMobile?.includes(i) ? "hide-m" : ""].filter(Boolean).join(" ");
    const th = t.head.map((h, i) => `<th${cls(i) ? ` class="${cls(i)}"` : ""}>${esc(h)}</th>`).join("");
    const rows = t.rows.map((r) => `<tr>${r.map((c, i) => `<td${cls(i) ? ` class="${cls(i)}"` : ""}>${this.prices(c)}</td>`).join("")}</tr>`).join("\n");
    const cap = t.caption ? `<p class="tcap">${esc(t.caption)}</p>` : "";
    return `<div class="tscroll"${first ? "" : ' style="margin-top:22px"'}><table class="t"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>${cap}`;
  }

  example(): string {
    const ex = this.page.planning.example;
    if (!ex) return "";
    let sum = 0;
    const lines = ex.lines
      .map((l) => {
        const total = l.qty * this.price(l.number);
        sum += total;
        return `<li><span>${l.qty} × ${esc(l.label)}</span><span>${formatEuro(total, true)}</span></li>`;
      })
      .join("");
    const per = ex.perLabel
      ? `<p class="per">≈ ${formatEuro(Math.round((sum / ex.perLabel.divisor) * 100) / 100, true)} je ${esc(ex.perLabel.unit)}${ex.perLabel.extra ? ` · ${esc(ex.perLabel.extra)}` : ""}</p>`
      : `<p class="per">${ex.info ? esc(ex.info) : "&nbsp;"}</p>`;
    const warn = ex.warn ? `<div class="warn"><span>⚠</span><span>${ex.warn}</span></div>` : "";
    return `<div class="calc"><h3>${esc(ex.title)}</h3><p class="sub">${esc(ex.sub)}</p><ul>${lines}</ul>
      <div class="sum"><span>Summe netto</span><strong>${formatEuro(sum, true)}</strong></div>${per}${warn}
      <a class="btn" href="#" style="width:100%;justify-content:center">${esc(ex.cta)}</a></div>`;
  }

  render(all: IndustryPage[]): string {
    const p = this.page;
    const hero = this.product(p.hero.number);
    const nav = all.map((o) => (o.key === p.key ? "" : `<a href="Entwurf-Branchenseite-${draftName(o)}.html"><strong>${esc(o.name)}</strong><span>${esc(o.tagline)}</span></a>`)).join("");
    const css = readFileSync(path.join(__dirname, "industryPageDraft.css"), "utf8");
    return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Branchenseite ${esc(p.short)} – Entwurf</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${css}
.sec-red .note{color:var(--note-ink)}
.meta-preview{display:none;background:#fff;border:1px dashed #c9c9c9;padding:10px 12px;margin:10px 0 0;font-size:13px}
body.notes .meta-preview{display:block}
.meta-preview b{display:block;color:#1a0dab;font-size:16px;font-weight:500}
.meta-preview i{display:block;color:#006621;font-style:normal}
</style>
</head>
<body class="notes">

<div class="draft"><div class="wrap">
  <span><b>ENTWURF</b> · Branchenseite „${esc(p.name)}“ · echte Artikel, Netto-Preise und Katalogwerte, Stand ${esc(this.shop.asOf.split("-").reverse().join("."))} · nicht im Shop</span>
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
  ${this.note("nav")}
  <div class="meta-preview"><b>${esc(p.metaTitle)}</b><i>shop.meta-online.com${esc(p.url)}</i>${esc(p.metaDescription)}</div>
</div>

<section class="hero"><div class="wrap hero-grid">
  <div>
    <span class="eyebrow">${esc(p.eyebrow)}</span>
    <h1${p.h1.length > 55 ? ' class="long"' : ""}>${esc(p.h1)}</h1>
    <p class="lead">${esc(p.lead)}</p>
    <ul class="proof">${p.proof.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <div class="cta-row">
      <a class="btn" href="#planung">${esc(p.ctaPrimary)}</a>
      <a class="btn ghost" href="#produkte">${esc(p.ctaSecondary)}</a>
    </div>
    ${this.note("hero")}
  </div>
  <div>
    <div class="stage">
      <span class="tag">${esc(p.hero.tag)}</span>
      ${hero.image ? `<img src="${esc(hero.image)}" alt="${esc(p.hero.alt)}">` : ""}
    </div>
    <div class="facts">${p.facts.map((f) => `<div><strong>${esc(f.value)}</strong><span>${esc(f.label)}</span></div>`).join("")}</div>
    ${this.note("facts")}
  </div>
</div></section>

<nav class="jump" aria-label="Auf dieser Seite"><div class="wrap">
  <a href="#bereiche">Lagerbereiche</a><a href="#planung">Planungshilfe</a><a href="#produkte">Produkte</a><a href="#sicherheit">Sicherheit &amp; Pflichten</a><a href="#unterlagen">Unterlagen</a><a href="#faq">Häufige Fragen</a><a class="cta" href="#beratung">Beratung ${esc(CONTACT.phone)}</a>
</div></nav>

<section class="sec" id="bereiche"><div class="wrap">
  <div class="sec-head"><div>
    <span class="eyebrow">Ihr Betrieb, Ihre Lagerbereiche</span>
    <h2>${esc(p.areasTitle)}</h2>
    <p>${esc(p.areasIntro)}</p>
  </div></div>
  <div class="areas">
${p.areas
  .map(
    (a) => `    <article class="area">
      <svg viewBox="0 0 40 40">${ICONS[a.icon]}</svg>
      <h3>${esc(a.title)}</h3>
      <p>${esc(a.text)}</p>
      <div class="sol"><b>META-Lösung</b>${esc(a.solution)}</div>
      <a class="link" href="#" title="${esc(a.linkTarget)}">${esc(a.linkLabel)} →</a>
    </article>`,
  )
  .join("\n")}
  </div>
  ${this.note("areas")}
</div></section>

<section class="sec sec-grey" id="planung"><div class="wrap">
  <div class="sec-head"><div>
    <span class="eyebrow">Planungshilfe</span>
    <h2>${esc(p.planning.title)}</h2>
    <p>${esc(p.planning.intro)}</p>
  </div></div>
  <div class="plan${p.planning.stacked ? " stacked" : ""}">
    <div>${p.planning.tables.map((t, i) => this.table(t, i === 0)).join("\n")}</div>
    ${this.example()}
  </div>
  ${this.note("planning")}
</div></section>

<section class="sec" id="produkte"><div class="wrap">
  <div class="sec-head">
    <div><span class="eyebrow">Direkt bestellen</span><h2>${esc(p.productsTitle)}</h2></div>
    <a class="link" href="#">Alle passenden Artikel →</a>
  </div>
  <div class="grid">
${p.products
  .map((c) => {
    const sp = this.product(c.number);
    return `    <a class="card" href="${esc(sp.url ?? "#")}">
      <div class="img"><span class="use">${esc(c.use)}</span>${sp.image ? `<img src="${esc(sp.image)}" alt="">` : ""}</div>
      <div class="body"><h3>${esc(c.title)}</h3><div class="spec">${esc(c.spec)}</div><div class="price">${formatEuro(sp.priceNet, true)}<small>zzgl. MwSt.</small></div><div class="stock">${esc(deliveryText(sp))}</div><span class="btn">In den Warenkorb</span></div>
    </a>`;
  })
  .join("\n")}
  </div>
  ${this.note("products")}
</div></section>

<section class="sec sec-red" id="sicherheit"><div class="wrap">
  <span class="eyebrow">Sicherheit &amp; Pflichten</span>
  <h2>Sicher lagern: Was META liefert – und was Sie als Betreiber tun</h2>
  <div class="duties">
    <div class="duty"><h3>Das liefert META</h3><ul>${p.duties.meta.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div>
    <div class="duty op"><h3>Das liegt bei Ihnen als Betreiber</h3><ul>${p.duties.operator.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
      <p class="hint">${esc(p.duties.hint)}</p></div>
  </div>
  ${this.note("duties")}
</div></section>

<section class="sec"><div class="wrap">
  <div class="why">${p.why.map((w) => `<div><strong>${esc(w.title)}</strong><span>${esc(w.text)}</span></div>`).join("")}</div>
  ${this.note("why")}
</div></section>

<section class="sec sec-grey" id="unterlagen"><div class="wrap">
  <div class="split">
    <div class="panel dark">
      <span class="eyebrow">${esc(p.project.eyebrow)}</span>
      <h3>${esc(p.project.title)}</h3>
      <p>${esc(p.project.text)}</p>
      <div class="cta-row" style="margin-top:8px"><a class="btn white" href="#beratung">${esc(p.project.cta)}</a>${p.project.link ? `<a class="link" style="color:#fff" href="${esc(p.project.link.href)}">${esc(p.project.link.label)} →</a>` : ""}</div>
    </div>
    <div class="panel">
      <span class="eyebrow">Unterlagen für Ihre Freigabe</span>
      <h3>Alles für Einkauf und Sicherheitsfachkraft</h3>
      <ul class="docs">${p.docs.map((d) => `<li>${esc(d.label)} <span>${esc(d.where)}</span></li>`).join("")}</ul>
    </div>
  </div>
  ${this.note("project")}
</div></section>

<section class="sec" id="faq"><div class="wrap faq">
  <div>
    <span class="eyebrow">Häufige Fragen</span>
    <h2>${esc(p.faqTitle)}</h2>
    ${this.note("faq")}
  </div>
  <div>
${p.faq.map((f, i) => `    <details${i === 0 ? " open" : ""}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n")}
  </div>
</div></section>

<section id="beratung"><div class="wrap">
  <div class="advice">
    <div class="l">
      <span class="eyebrow">Persönliche Beratung</span>
      <h2>${esc(p.advice.title)}</h2>
      <p>${esc(p.advice.text)}</p>
    </div>
    <div class="r">
      <a class="tel" href="tel:${CONTACT.tel}">${esc(CONTACT.phone)}</a>
      <small>Montag bis Freitag, ${esc(CONTACT.hours)}</small>
      <a class="btn white" href="mailto:${CONTACT.mail}" style="align-self:flex-start">E-Mail an den Digital-Service</a>
    </div>
  </div>
  ${this.note("advice")}
  <div style="margin:48px 0 0">
    <span class="eyebrow">Weitere Branchen</span>
    <h2 style="margin:6px 0 18px">Regale für Ihre Branche</h2>
    <div class="more">${nav}<a class="soon" href="#"><strong>Holz-, Metall- &amp; Baustoffhandel</strong><span>Langgut – Welle 2</span></a></div>
  </div>
</div></section>
</main>

<footer><div class="wrap"><span>META-Regalbau GmbH &amp; Co. KG · Eichenkamp · 59759 Arnsberg</span><span>Alle Preise exkl. gesetzl. MwSt. · *Garantiebedingungen</span></div></footer>
</body>
</html>
`;
  }
}

const draftName = (p: IndustryPage) =>
  ({ kfz: "Kfz-Reifen", handwerk: "Handwerk", industrie: "Industrie", buero: "Buero-Archiv", handel: "Handel-Versand" })[p.key] ?? p.key;

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
    writeFileSync(file, new Renderer(p, shop).render(INDUSTRY_PAGES));
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
