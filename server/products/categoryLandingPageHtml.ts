// HTML der System-Landingpages (Vorlage A–K) – gemeinsam fuer den Entwurf (scripts/exportCategoryLandingPages.ts)
// und spaeter das Schreibskript in den Shop. Baut auf dem Design der Branchenseiten auf (industryPageHtml.ts):
// gleiches Stylesheet, im Shop auf `.mbp` begrenzt, dazu die Bausteine dieser Seiten (LANDING_CSS).
import { CONTACT, formatEuro } from "./industryPages";
import { esc, industryPageCss, scopeCss, deliveryText, type IndustryShopProduct } from "./industryPageHtml";
import { GLOSSARY_COMPARISONS, GLOSSARY_TERMS } from "./glossary";
import {
  BUILD_STEP_KEYS,
  LEXIKON,
  catalogSpans,
  exampleTexts,
  rowFigures,
  type CategoryLandingPage,
  type LandingNoteKey,
  type RowSpec,
} from "./categoryLandingPages";
import { CATALOG_SOURCE } from "./catalogFacts";

export type LandingHtmlOptions = {
  /** Gelbe Erklaerungen mit Quellen und Pruefpunkten (nur Entwurf) */
  notes: boolean;
  /** Beispielzeile als echtes Warenkorb-Formular (nur Shop, braucht Produkt-IDs) */
  cartForm: boolean;
};

const fmt = (n: number) => n.toLocaleString("de-DE");
const TERM_NAMES = new Map(GLOSSARY_TERMS.map((t) => [t.key, t.term]));

/** Text mit Lexikon-Verweisen [[schluessel]] / [[schluessel|Text]] als HTML; unbekannte Schluessel werfen. */
export function landingTextHtml(text: string): string {
  return esc(text).replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, key: string, label?: string) => {
    const name = TERM_NAMES.get(key);
    if (!name) throw new Error(`Lexikon-Begriff ${key} fehlt`);
    return `<a class="lex" href="${LEXIKON}#${key}">${label ?? name}</a>`;
  });
}

/** Klartext ohne Lexikon-Markup (Excel, Tests) */
export const landingPlain = (text: string) => text.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, key: string, label?: string) => label ?? TERM_NAMES.get(key) ?? key);

/** Zeichnung einer Regalzeile: Rahmen, Fachboeden, Aussteifung, Bemaßung bis zu den Fussplatten (SVG, festes Hellbild wie der Shop). */
export function rowDrawingSvg(r: RowSpec, parts: string[], bracing: string): string {
  const f = rowFigures(r);
  const W = 760;
  const left = 70;
  const right = 24;
  const top = 34;
  const H = 210; // Regalhoehe in der Zeichnung
  const frameW = 9;
  const fieldW = (W - left - right - frameW) / r.fields;
  const xs = Array.from({ length: f.frames }, (_, i) => left + i * fieldW);
  const shelfYs = Array.from({ length: r.levels }, (_, i) => top + H - (i * (H - 18)) / (r.levels - 1) - 4);
  const frames = xs.map((x) => `<rect x="${x.toFixed(1)}" y="${top}" width="${frameW}" height="${H}" fill="#e6e6e6" stroke="#131313" stroke-width="1.6"/>`).join("");
  const feet = xs.map((x) => `<rect x="${(x - 6).toFixed(1)}" y="${top + H}" width="${frameW + 12}" height="5" fill="#131313"/>`).join("");
  const shelves = xs
    .slice(0, -1)
    .flatMap((x) => shelfYs.map((y) => `<line x1="${(x + frameW).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + fieldW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#ff0002" stroke-width="5"/>`))
    .join("");
  const x0 = xs[0] + frameW;
  const x1 = xs[1];
  const brace =
    bracing === "diagonal"
      ? `<g stroke="#8a8a88" stroke-width="1.4" stroke-dasharray="6 4"><line x1="${x0}" y1="${top + 6}" x2="${x1}" y2="${top + H - 6}"/><line x1="${x1}" y1="${top + 6}" x2="${x0}" y2="${top + H - 6}"/></g>`
      : "";
  // Bemaßung: je Feld Fussplatten-Zuschlag, darunter Gesamtlaenge
  const dimY = top + H + 30;
  const segs = xs.slice(0, -1).map((x, i) => {
    const a = i === 0 ? x - 6 : x + frameW / 2;
    const b = xs[i + 1] + (i === r.fields - 1 ? frameW + 6 : frameW / 2);
    const label = i === 0 ? `Grundregal ${fmt(f.footBase)} mm` : `Anbauregal ${fmt(f.footAddOn)} mm`;
    return `<line x1="${a.toFixed(1)}" y1="${dimY}" x2="${b.toFixed(1)}" y2="${dimY}" stroke="#131313" stroke-width="1"/><line x1="${a.toFixed(1)}" y1="${dimY - 5}" x2="${a.toFixed(1)}" y2="${dimY + 5}" stroke="#131313"/><text x="${((a + b) / 2).toFixed(1)}" y="${dimY - 7}" text-anchor="middle">${label}</text>`;
  });
  const endX = xs[xs.length - 1] + frameW + 6;
  const totalY = dimY + 30;
  const startX = xs[0] - 6;
  const total = `<line x1="${startX}" y1="${totalY}" x2="${endX.toFixed(1)}" y2="${totalY}" stroke="#ff0002" stroke-width="2"/><line x1="${startX}" y1="${totalY - 6}" x2="${startX}" y2="${totalY + 6}" stroke="#ff0002" stroke-width="2"/><line x1="${endX.toFixed(1)}" y1="${totalY - 6}" x2="${endX.toFixed(1)}" y2="${totalY + 6}" stroke="#ff0002" stroke-width="2"/><rect x="${((startX + endX) / 2 - 150).toFixed(1)}" y="${totalY - 11}" width="300" height="22" fill="#fff"/><text x="${((startX + endX) / 2).toFixed(1)}" y="${totalY + 5}" text-anchor="middle" font-weight="700">${fmt(f.footLength)} mm bis zu den Fußplatten</text>`;
  const heightDim = `<line x1="28" y1="${top}" x2="28" y2="${top + H}" stroke="#131313"/><line x1="22" y1="${top}" x2="34" y2="${top}" stroke="#131313"/><line x1="22" y1="${top + H}" x2="34" y2="${top + H}" stroke="#131313"/><text x="22" y="${top + H / 2}" text-anchor="middle" transform="rotate(-90 22 ${top + H / 2})">${fmt(r.height)} mm</text>`;
  // Beschriftung der Bauteile (Nummern im Bild, Legende darunter)
  const mark = (n: number, x: number, y: number, fill: string) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="${fill}"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="#fff" font-weight="700">${n}</text>`;
  const marks = [
    mark(1, xs[1] + frameW / 2, top - 14, "#131313"),
    mark(2, xs[1] + frameW + fieldW / 2, shelfYs[2] - 14, "#ff0002"),
    bracing === "diagonal" ? mark(3, (x0 + x1) / 2, top + H / 2 - 30, "#8a8a88") : "",
  ].join("");
  const legend = parts
    .map((p, i) => `<span><b class="${["k", "r", "g"][i] ?? "k"}">${i + 1}</b>${esc(p)}</span>`)
    .join("");
  const viewH = totalY + 18;
  return `<div class="row-draw"><div class="tscroll"><svg viewBox="0 0 ${W} ${viewH}" role="img" aria-label="Regalzeile aus 1 Grundregal und ${f.addOns} Anbauregalen, ${fmt(f.footLength)} mm lang" font-family="Inter,system-ui,sans-serif" font-size="12.5" fill="#131313">${brace}${shelves}${frames}${feet}${marks}${segs.join("")}${total}${heightDim}</svg></div><div class="legend">${legend}</div></div>`;
}

/** Bausteine einer System-Landingpage. Entwurf und Shop setzen sie unterschiedlich zusammen. */
export class CategoryLandingHtml {
  private n = 0;
  constructor(
    private page: CategoryLandingPage,
    private products: Record<string, IndustryShopProduct>,
    private opts: LandingHtmlOptions,
  ) {}

  product(num: string): IndustryShopProduct {
    const p = this.products[num];
    if (!p) throw new Error(`${this.page.key}: Artikel ${num} fehlt im Shop-Stand`);
    return p;
  }

  note(key: LandingNoteKey): string {
    const note = this.opts.notes ? this.page.notes[key] : undefined;
    if (!note) return "";
    this.n += 1;
    const checks = (note.checks ?? []).map((c) => `<span class="chk">prüfen: ${esc(c)}</span>`).join(" ");
    const src = note.src ? `<span class="src">Quelle: ${esc(note.src)}</span>` : "";
    return `<aside class="note"><span class="n">${this.n}</span>${esc(note.text)} ${checks}${src}</aside>`;
  }

  /** A + B: Kopf mit Kennzahlen */
  hero(): string {
    const p = this.page;
    return `<section class="hero"><div class="wrap hero-grid">
  <div>
    <span class="eyebrow">${esc(p.eyebrow)}</span>
    <h1${p.h1.length > 55 ? ' class="long"' : ""}>${esc(p.h1)}</h1>
    <p class="lead">${esc(p.lead)}</p>
    <ul class="proof">${p.proof.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <div class="cta-row">
      <a class="btn" href="${esc(p.ctaPrimary.href)}">${esc(p.ctaPrimary.label)}</a>
      <a class="btn ghost" href="${esc(p.ctaSecondary.href)}">${esc(p.ctaSecondary.label)}</a>
    </div>
    ${this.note("hero")}
  </div>
  <div>
    <div class="stage photo"><img src="${esc(p.heroImage.src)}" alt="${esc(p.heroImage.alt)}"></div>
    <div class="facts">${p.facts.map((f) => `<div><strong>${esc(f.value)}</strong><span>${esc(f.label)}</span></div>`).join("")}</div>
  </div>
</div></section>`;
  }

  jump(): string {
    return `<nav class="jump" aria-label="Auf dieser Seite"><div class="wrap">
  <a href="#ausfuehrung">Ausführungen</a><a href="#sortiment">Sortiment</a><a href="#aufbau">So bauen Sie Ihr Regal</a><a href="#masse">Maße</a><a href="#produkte">Topseller</a><a href="#faq">Häufige Fragen</a><a class="cta" href="#beratung">Beratung ${esc(CONTACT.phone)}</a>
</div></nav>`;
  }

  /** D: Ausfuehrungen im Vergleich (aus dem Regal-Lexikon) */
  systems(): string {
    const p = this.page;
    const cards = p.systems.comparisons
      .map((key) => {
        const c = GLOSSARY_COMPARISONS.find((x) => x.key === key);
        if (!c) throw new Error(`${p.key}: Vergleich ${key} fehlt im Lexikon`);
        const side = (s: (typeof c.sides)[number]) => `<div class="side">
        <h4>${esc(s.name)}</h4>
        <ul class="plus">${s.plus.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        ${s.minus.length ? `<ul class="minus">${s.minus.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <p class="fit">${esc(s.fit)}</p>
      </div>`;
        return `<article class="cmp"><h3>${esc(c.title)}</h3><p>${esc(c.intro)}</p><div class="sides">${side(c.sides[0])}${side(c.sides[1])}</div></article>`;
      })
      .join("\n");
    return `<section class="sec" id="ausfuehrung"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">Ausführungen</span><h2>${esc(p.systems.title)}</h2><p>${esc(p.systems.intro)}</p></div>
  <a class="link" href="${LEXIKON}">Alle Begriffe im Regal-Lexikon →</a></div>
  <div class="cmps">${cards}</div>
  ${this.note("systems")}
</div></section>`;
  }

  /** E: Direkt zum Sortiment */
  tiles(): string {
    return `<section class="sec sec-grey" id="sortiment"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">Direkt bestellen</span><h2>${esc(this.page.name)} im Shop</h2></div></div>
  <div class="tiles">${this.page.tiles.map((t) => `<a href="${esc(t.href)}"><strong>${esc(t.label)}</strong><span>${esc(t.text)}</span><em>Zu den Artikeln →</em></a>`).join("")}</div>
  ${this.note("tiles")}
</div></section>`;
  }

  /** Summe der Beispielzeile (netto) */
  exampleSum(): number {
    return this.page.guide.example.lines.reduce((s, l) => s + l.qty * this.product(l.number).priceNet, 0);
  }

  private exampleBox(): string {
    const ex = this.page.guide.example;
    const f = rowFigures(ex.row);
    const lines = ex.lines.map((l) => `<li><span>${l.qty} × ${esc(l.label)}</span><span>${formatEuro(l.qty * this.product(l.number).priceNet, true)}</span></li>`).join("");
    const button = `<button type="submit" class="btn" style="width:100%;justify-content:center">Diese Zeile in den Warenkorb</button>`;
    const cart = this.opts.cartForm
      ? `<form action="/checkout/line-item/add" method="post" data-add-to-cart="true">${ex.lines
          .map((l) => {
            const id = this.product(l.number).id;
            if (!id) throw new Error(`${this.page.key}: Produkt-ID fehlt für ${l.number}`);
            const k = `lineItems[${id}]`;
            return `<input type="hidden" name="${k}[id]" value="${id}"><input type="hidden" name="${k}[referencedId]" value="${id}"><input type="hidden" name="${k}[type]" value="product"><input type="hidden" name="${k}[quantity]" value="${l.qty}"><input type="hidden" name="${k}[stackable]" value="1"><input type="hidden" name="${k}[removable]" value="1">`;
          })
          .join("")}<input type="hidden" name="redirectTo" value="frontend.checkout.cart.page">${button}</form>`
      : `<a class="btn" href="#" style="width:100%;justify-content:center">Diese Zeile in den Warenkorb</a>`;
    return `<div class="calc">
      <h3>Beispiel: ${fmt(ex.row.space)} mm Wand</h3>
      <p class="sub">${ex.row.fields} Felder à ${fmt(ex.row.nominal)} mm, ${fmt(ex.row.height)} mm hoch, ${fmt(ex.row.depth)} mm tief, ${ex.row.levels} Böden à ${fmt(ex.row.shelfLoad)} kg, an der Wand befestigt</p>
      <ul>${lines}</ul>
      <div class="sum"><span>Summe netto</span><strong>${formatEuro(this.exampleSum(), true)}</strong></div>
      <p class="per">${fmt(f.footLength)} mm lang · Planmaß ${fmt(f.planLength)} mm · ${f.frames} Rahmen</p>
      ${cart}
      <a class="btn ghost" href="${esc(ex.configuratorHref)}" style="width:100%;justify-content:center;margin-top:8px">Mit eigenen Maßen konfigurieren</a>
      ${this.note("example")}
    </div>`;
  }

  /** F: So bauen Sie Ihr Regal */
  guide(): string {
    const g = this.page.guide;
    const examples = exampleTexts(g.example.row);
    const steps = BUILD_STEP_KEYS.map((key, i) => {
      const s = g.steps.find((x) => x.key === key);
      if (!s) throw new Error(`${this.page.key}: Schritt ${key} fehlt`);
      const ex = examples[key];
      return `<li class="step"><span class="no">${i + 1}</span><h3>${esc(s.title)}</h3><p>${landingTextHtml(s.text)}</p>${ex ? `<p class="ex"><b>Beispiel</b>${esc(ex)}</p>` : ""}</li>`;
    }).join("\n");
    return `<section class="sec" id="aufbau"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">Planen und aufbauen</span><h2>${esc(g.title)}</h2><p>${esc(g.intro)}</p></div></div>
  <ol class="steps">${steps}</ol>
  ${this.note("guide")}
  <div class="plan build">
    <div>
      <h3 class="sub-h">Ihre Regalzeile im Beispiel</h3>
      ${rowDrawingSvg(g.example.row, g.drawing.parts, g.drawing.bracing)}
    </div>
    ${this.exampleBox()}
  </div>
  <div class="dodont">
    <div class="avoid"><h3>Vermeiden Sie diese Fehler</h3><ul>${g.avoid.map((x) => `<li>${landingTextHtml(x)}</li>`).join("")}</ul></div>
    <div class="ops"><h3>Sicher im Betrieb</h3><ul>${g.operation.map((x) => `<li>${landingTextHtml(x)}</li>`).join("")}</ul></div>
  </div>
  <div class="cta-row" style="margin-top:22px">
    <a class="btn" href="${esc(g.example.configuratorHref.replace(/&.*$/, ""))}">Regal konfigurieren</a>
    <a class="btn ghost" href="${esc(g.instructions.href)}" target="_blank" rel="noopener">${esc(g.instructions.label)}</a>
    <a class="btn ghost" href="${esc(g.service.href)}" target="_blank" rel="noopener">${esc(g.service.label)}</a>
  </div>
</div></section>`;
  }

  /** G: Planmaße und Systemwerte */
  plan(): string {
    const p = this.page;
    const spans = catalogSpans(p);
    const rows = spans.rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
    return `<section class="sec sec-grey" id="masse"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">Maße und Planung</span><h2>${esc(p.eyebrow)}: Systemwerte und Planmaße</h2><p>${esc(p.planNote)}</p></div></div>
  <div class="plan">
    <div class="tscroll"><table class="t spans"><tbody>${rows}</tbody></table><p class="tcap">Systemwerte laut ${esc(CATALOG_SOURCE)} (S. ${spans.page}). Im Shop direkt bestellbar ist eine Auswahl daraus; weitere Maße auf Anfrage.</p></div>
    <div class="plan-imgs">${p.planImages.map((im) => `<figure><img src="${esc(im.src)}" alt="${esc(im.alt)}" loading="lazy"></figure>`).join("")}</div>
  </div>
  ${this.note("plan")}
</div></section>`;
  }

  productsHead(): string {
    return `<div class="sec-head" id="produkte"><div><span class="eyebrow">Topseller</span><h2>${esc(this.page.productsTitle)}</h2></div><a class="link" href="${esc(this.page.productsHref)}">Alle ${esc(this.page.name)} →</a></div>`;
  }

  /** H (nur Entwurf): Produktkarten; im Shop zeigt der Produkt-Slider Preise und Warenkorb live */
  productCards(): string {
    return `<div class="grid">
${this.page.productNumbers
  .map((num) => {
    const sp = this.product(num);
    const [sys, , type, dims, load] = sp.name.split("|").map((s) => s.trim());
    return `    <a class="card" href="${esc(sp.url ?? "#")}">
      <div class="img">${type ? `<span class="use">${esc(type)}</span>` : ""}${sp.image ? `<img src="${esc(sp.image)}" alt="">` : ""}</div>
      <div class="body"><h3>${esc(sp.name)}</h3><div class="spec">${esc([sys, dims, load].filter(Boolean).join(" · "))}</div><div class="price">${formatEuro(sp.priceNet, true)}<small>zzgl. MwSt.</small></div><div class="stock">${esc(deliveryText(sp))}</div><span class="btn">In den Warenkorb</span></div>
    </a>`;
  })
  .join("\n")}
  </div>
  ${this.note("products")}`;
  }

  /** I: Mehr zum Thema */
  seo(): string {
    const s = this.page.seo;
    return `<section class="sec"><div class="wrap seo">
  <div><span class="eyebrow">Mehr zum Thema</span><h2>${esc(s.title)}</h2>${s.paragraphs.map((x) => `<p>${landingTextHtml(x)}</p>`).join("")}</div>
  <ul class="more-links">${s.links.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)} →</a></li>`).join("")}</ul>
  ${this.note("seo")}
</div></section>`;
  }

  faqHead(): string {
    return `<span class="eyebrow">Häufige Fragen</span><h2>${esc(this.page.faqTitle)}</h2>${this.note("faq")}`;
  }

  faqItems(): string {
    return this.page.faq.map((f, i) => `    <details${i === 0 ? " open" : ""}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n");
  }

  /** K: Beratung */
  advice(): string {
    const a = this.page.advice;
    return `<div class="advice">
    <div class="l"><span class="eyebrow">Persönliche Beratung</span><h2>${esc(a.title)}</h2><p>${esc(a.text)}</p></div>
    <div class="r">
      <a class="tel" href="tel:${esc(CONTACT.tel)}">${esc(CONTACT.phone)}</a>
      <small>Montag bis Freitag, ${esc(CONTACT.hours)}</small>
      <a class="btn white" href="mailto:${esc(CONTACT.mail)}" style="align-self:flex-start">E-Mail an den Digital-Service</a>
    </div>
  </div>
  ${this.note("advice")}`;
  }
}

/** Bausteine der System-Landingpages zusaetzlich zum Branchen-Stylesheet */
const LANDING_CSS = `
.stage.photo{aspect-ratio:1/1}
.stage.photo img{width:100%;height:100%;object-fit:cover;mix-blend-mode:normal}
.facts strong{font-size:18px}
a.lex{color:inherit;text-decoration:underline;text-decoration-color:var(--red);text-decoration-thickness:1.5px;text-underline-offset:2px}
a.lex:hover{color:var(--red)}
.cmps{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.cmp{border:1px solid var(--line);padding:22px;background:#fff;display:flex;flex-direction:column;gap:8px;min-width:0}
.cmp>p{margin:0;font-size:14px;color:var(--muted)}
.cmp .sides{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px}
.cmp .side{background:var(--bg-grey);padding:14px;display:flex;flex-direction:column;gap:6px;min-width:0}
.cmp h4{margin:0;font-size:14.5px;color:var(--ink)}
.cmp ul{margin:0;padding:0;list-style:none;font-size:13.5px}
.cmp li{padding:3px 0 3px 18px;position:relative;line-height:1.45}
.cmp .plus li::before{content:"+";position:absolute;left:0;font-weight:800;color:var(--ok)}
.cmp .minus li::before{content:"–";position:absolute;left:0;font-weight:800;color:#a05f00}
.cmp .fit{margin:auto 0 0;font-size:13px;font-weight:600;color:var(--ink);border-top:1px solid var(--line);padding-top:8px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:1px solid var(--line);border-left:1px solid var(--line)}
.tiles a{border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:#fff;padding:22px 20px;text-decoration:none;display:flex;flex-direction:column;gap:6px;transition:box-shadow .15s}
.tiles a:hover{box-shadow:inset 0 -3px 0 var(--red)}
.tiles strong{font-size:16px;color:var(--ink)}
.tiles span{font-size:13.5px;color:var(--muted);line-height:1.45}
.tiles em{font-style:normal;font-weight:600;font-size:13.5px;margin-top:auto;padding-top:6px;color:var(--ink)}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-top:1px solid var(--line);border-left:1px solid var(--line);counter-reset:none}
.step{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:22px 22px 20px;display:flex;flex-direction:column;gap:8px;background:#fff;min-width:0}
.step .no{display:inline-grid;place-items:center;width:30px;height:30px;background:var(--red);color:#fff;font-weight:800;font-size:15px}
.step p{margin:0;font-size:14px;color:#3a3a3a}
.step .ex{background:var(--bg-grey);padding:9px 11px;font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}
.step .ex b{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.plan.build{margin-top:32px}
.sub-h{font-size:17px;margin:0 0 12px}
.row-draw{background:#fff;border:1px solid var(--line);padding:16px 14px 12px}
.row-draw svg{display:block;width:100%;min-width:560px;height:auto}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;margin-top:8px}
.legend span{display:flex;align-items:center;gap:6px}
.legend b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;color:#fff;font-size:11px}
.legend b.k{background:#131313}.legend b.r{background:var(--red)}.legend b.g{background:#8a8a88}
.dodont{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:28px}
.dodont>div{padding:22px}
.dodont ul{margin:10px 0 0;padding:0;list-style:none;font-size:14px}
.dodont li{padding:8px 0 8px 26px;position:relative;border-top:1px solid var(--line)}
.avoid{background:#fff1f1}
.avoid li{border-top-color:#f3cfcf}
.avoid li::before{content:"✕";position:absolute;left:2px;top:8px;color:var(--red);font-weight:800}
.ops{background:var(--bg-grey)}
.ops li::before{content:"";position:absolute;left:4px;top:16px;width:7px;height:7px;background:var(--ink)}
table.spans th{width:38%;background:#fff;color:var(--ink);font-weight:600;font-size:14px;text-transform:none;letter-spacing:0}
.plan-imgs{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.plan-imgs figure{margin:0;background:#fff;border:1px solid var(--line);padding:8px}
.plan-imgs img{width:100%;height:auto}
.seo{display:grid;grid-template-columns:1.4fr 1fr;gap:40px;align-items:start}
.seo p{max-width:68ch;color:#3a3a3a}
.seo h2{margin:6px 0 14px}
.more-links{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.more-links li{border-bottom:1px solid var(--line)}
.more-links a{display:block;padding:13px 0;font-weight:600;font-size:14.5px;text-decoration:none;color:var(--ink)}
.more-links a:hover{color:var(--red)}
@media (max-width:1100px){.cmps,.seo{grid-template-columns:1fr}.tiles{grid-template-columns:repeat(2,1fr)}.steps{grid-template-columns:repeat(2,1fr)}}
@media (max-width:760px){.cmp .sides,.dodont,.plan-imgs{grid-template-columns:1fr}.tiles{grid-template-columns:1fr}.steps{grid-template-columns:1fr}.step{padding:18px 16px}.cmp{padding:16px}}
`;

/** Stylesheet: ohne Rahmen fuer den Entwurf, mit Rahmen (`.mbp`) fuer das HTML-Element im Shop */
export function categoryLandingCss(scope?: string): string {
  return scope ? industryPageCss(scope) + scopeCss(LANDING_CSS, scope) : industryPageCss() + LANDING_CSS;
}
