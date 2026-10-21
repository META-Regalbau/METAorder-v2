// HTML der System-Landingpages (Vorlage A–K) – gemeinsam fuer den Entwurf (scripts/exportCategoryLandingPages.ts)
// und spaeter das Schreibskript in den Shop. Baut auf dem Design der Branchenseiten auf (industryPageHtml.ts):
// gleiches Stylesheet, im Shop auf `.mbp` begrenzt, dazu die Bausteine dieser Seiten (LANDING_CSS).
import { CONTACT, formatEuro } from "./industryPages";
import { esc, industryPageCss, scopeCss, deliveryText, type IndustryShopProduct } from "./industryPageHtml";
import { GLOSSARY_COMPARISONS, GLOSSARY_TERMS, type GlossaryComparison } from "./glossary";
import {
  BUILD_STEP_KEYS,
  LEXIKON,
  catalogSpans,
  exampleTexts,
  fillExample,
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
/** Externe Links in neuem Tab, Shop-Links im selben */
const ext = (href: string) => (/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : "");
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

/** Farben der Zeichnung (festes Hellbild wie der Shop) */
const C = { ink: "#131313", frame: "#e6e6e6", zinc: "#cfd3d8", red: "#ff0002", orange: "#f26b1d", grey: "#8a8a88", wood: "#d9b77e", woodDark: "#b8925a", goods: "#e9ecef", bar: "#9aa3ad" };
const FRAME_WORD: Record<RowSpec["kind"], string> = { shelf: "Rahmen", pallet: "Ständerrahmen", cantilever: "Ständer" };

/** Zeichnung einer Regalzeile (Vorderansicht) mit Bemaßung: Fachboden-/Weitspann-, Paletten- oder Kragarmregal. */
export function rowDrawingSvg(r: RowSpec, parts: string[]): string {
  const f = rowFigures(r);
  const W = 760;
  const left = 70;
  const right = 24;
  const top = 34;
  const H = 210;
  const fw = r.kind === "cantilever" ? 12 : r.kind === "pallet" ? 10 : 9; // Breite Rahmen/Ständer
  const fieldW = (W - left - right - fw) / r.fields;
  const xs = Array.from({ length: f.frames }, (_, i) => left + i * fieldW);
  const floor = top + H;
  const out: string[] = [];
  const marks: Array<[number, number, string]> = [];
  const n = (v: number) => v.toFixed(1);

  if (r.kind === "shelf") {
    const ys = Array.from({ length: r.drawLevels }, (_, i) => floor - 4 - (i * (H - 18)) / (r.drawLevels - 1));
    if (r.bracing === "diagonal") {
      const a = xs[0] + fw;
      const b = xs[1];
      out.push(`<g stroke="${C.grey}" stroke-width="1.4" stroke-dasharray="6 4"><line x1="${n(a)}" y1="${top + 6}" x2="${n(b)}" y2="${floor - 6}"/><line x1="${n(b)}" y1="${top + 6}" x2="${n(a)}" y2="${floor - 6}"/></g>`);
      marks.push([(a + b) / 2, top + H / 2 - 30, C.grey]);
    }
    for (const x of xs.slice(0, -1))
      for (const y of ys)
        out.push(
          r.board === "wood"
            ? `<rect x="${n(x + fw)}" y="${n(y - 7)}" width="${n(fieldW - fw)}" height="7" fill="${C.wood}" stroke="${C.woodDark}" stroke-width="0.8"/><line x1="${n(x + fw)}" y1="${n(y + 1.5)}" x2="${n(x + fieldW)}" y2="${n(y + 1.5)}" stroke="${C.ink}" stroke-width="3"/>`
            : `<line x1="${n(x + fw)}" y1="${n(y)}" x2="${n(x + fieldW)}" y2="${n(y)}" stroke="${C.red}" stroke-width="5"/>`,
        );
    for (const x of xs) out.push(`<rect x="${n(x)}" y="${top}" width="${fw}" height="${H}" fill="${C.frame}" stroke="${C.ink}" stroke-width="1.6"/>`);
    marks.unshift([xs[1] + fw / 2, top - 14, C.ink], [xs[1] + fw + fieldW / 2, ys[Math.min(2, ys.length - 1)] - 16, r.board === "wood" ? C.woodDark : C.red]);
  }

  if (r.kind === "pallet") {
    const levels = r.drawLevels; // inklusive Bodenebene
    const step = (H - 10) / levels;
    const beamYs = Array.from({ length: levels - 1 }, (_, i) => floor - step * (i + 1));
    const slot = (fieldW - fw) / r.perLevel;
    const pallet = (x: number, y: number) => {
      const pw = slot - 10;
      const goodsH = step - 34;
      return `<rect x="${n(x + 5)}" y="${n(y - 8)}" width="${n(pw)}" height="8" fill="${C.wood}" stroke="${C.woodDark}" stroke-width="0.8"/><rect x="${n(x + 8)}" y="${n(y - 8 - goodsH)}" width="${n(pw - 6)}" height="${n(goodsH)}" fill="${C.goods}" stroke="${C.bar}" stroke-width="1"/>`;
    };
    for (const x of xs.slice(0, -1)) {
      for (let s = 0; s < r.perLevel; s++) out.push(pallet(x + fw + s * slot, floor));
      for (const y of beamYs) {
        for (let s = 0; s < r.perLevel; s++) out.push(pallet(x + fw + s * slot, y - 4));
        out.push(`<rect x="${n(x + fw)}" y="${n(y - 4)}" width="${n(fieldW - fw)}" height="9" fill="${C.orange}" stroke="${C.ink}" stroke-width="0.8"/>`);
      }
    }
    for (const x of xs) out.push(`<rect x="${n(x)}" y="${top}" width="${fw}" height="${H}" fill="${C.zinc}" stroke="${C.ink}" stroke-width="1.6"/>`);
    marks.push([xs[1] + fw / 2, top - 14, C.ink], [xs[1] + fw + slot * 1.5, beamYs[0] + 0.5, C.orange], [xs[1] + fw + slot / 2, beamYs[0] - step / 2, C.woodDark]);
  }

  if (r.kind === "cantilever") {
    const ys = Array.from({ length: r.drawLevels }, (_, i) => floor - 10 - (i * (H - 24)) / (r.drawLevels - 1));
    if (r.bracing === "diagonal")
      for (let i = 0; i < r.fields; i++) {
        const a = xs[i] + fw;
        const b = xs[i + 1];
        out.push(`<g stroke="${C.grey}" stroke-width="1.3" stroke-dasharray="6 4"><line x1="${n(a)}" y1="${top + 30}" x2="${n(b)}" y2="${floor - 20}"/><line x1="${n(b)}" y1="${top + 30}" x2="${n(a)}" y2="${floor - 20}"/></g>`);
      }
    // Langgut liegt über alle Felder auf Fuß und Armen (2 Lagen je Ebene, oberste Ebene frei)
    const x0 = xs[0] - 18;
    const x1 = xs[xs.length - 1] + fw + 18;
    const rests = [floor - 3, ...ys.slice(1, -1).map((y) => y - 4)];
    for (const y of rests) for (let k = 0; k < 2; k++) out.push(`<rect x="${n(x0)}" y="${n(y - 6 - k * 6.5)}" width="${n(x1 - x0)}" height="6" rx="3" fill="${C.bar}" stroke="${C.ink}" stroke-width="0.6"/>`);
    for (const x of xs) {
      out.push(`<rect x="${n(x)}" y="${top}" width="${fw}" height="${H}" fill="#5b6068" stroke="${C.ink}" stroke-width="1.4"/>`);
      out.push(`<rect x="${n(x - 10)}" y="${floor - 3}" width="${fw + 20}" height="6" fill="${C.ink}"/>`);
      for (const y of ys.slice(1)) out.push(`<rect x="${n(x - 7)}" y="${n(y - 4)}" width="${fw + 14}" height="8" fill="${C.red}" stroke="${C.ink}" stroke-width="0.8"/>`);
    }
    marks.push([xs[1] + fw / 2, top - 14, C.ink], [xs[2] - 24, ys[ys.length - 1], C.red], [xs[1] + fieldW / 2, rests[1] - 26, C.bar]);
    if (r.bracing === "diagonal") marks.push([xs[0] + fw + fieldW / 2, (top + floor) / 2 + 4, C.grey]);
  }

  const feet =
    r.kind === "cantilever" ? "" : xs.map((x) => `<rect x="${n(x - 6)}" y="${floor}" width="${fw + 12}" height="5" fill="${C.ink}"/>`).join("");
  // Bemaßung je Feld und Gesamtlänge
  const dimY = floor + 30;
  const segs = xs.slice(0, -1).map((x, i) => {
    const a = i === 0 ? x - 6 : x + fw / 2;
    const b = xs[i + 1] + (i === r.fields - 1 ? fw + 6 : fw / 2);
    const label = i === 0 ? `Grundregal ${fmt(f.baseLen)} mm` : `Anbauregal ${fmt(f.addOnLen)} mm`;
    return `<line x1="${n(a)}" y1="${dimY}" x2="${n(b)}" y2="${dimY}" stroke="${C.ink}"/><line x1="${n(a)}" y1="${dimY - 5}" x2="${n(a)}" y2="${dimY + 5}" stroke="${C.ink}"/><text x="${n((a + b) / 2)}" y="${dimY - 7}" text-anchor="middle">${label}</text>`;
  });
  const sx = xs[0] - 6;
  const ex = xs[xs.length - 1] + fw + 6;
  const ty = dimY + 30;
  const totalLabel = `${fmt(f.length)} mm ${r.length.label}`;
  const total = `<line x1="${n(sx)}" y1="${ty}" x2="${n(ex)}" y2="${ty}" stroke="${C.red}" stroke-width="2"/><line x1="${n(sx)}" y1="${ty - 6}" x2="${n(sx)}" y2="${ty + 6}" stroke="${C.red}" stroke-width="2"/><line x1="${n(ex)}" y1="${ty - 6}" x2="${n(ex)}" y2="${ty + 6}" stroke="${C.red}" stroke-width="2"/><rect x="${n((sx + ex) / 2 - 160)}" y="${ty - 11}" width="320" height="22" fill="#fff"/><text x="${n((sx + ex) / 2)}" y="${ty + 5}" text-anchor="middle" font-weight="700">${totalLabel}</text>`;
  const heightDim = `<line x1="28" y1="${top}" x2="28" y2="${floor}" stroke="${C.ink}"/><line x1="22" y1="${top}" x2="34" y2="${top}" stroke="${C.ink}"/><line x1="22" y1="${floor}" x2="34" y2="${floor}" stroke="${C.ink}"/><text x="22" y="${top + H / 2}" text-anchor="middle" transform="rotate(-90 22 ${top + H / 2})">${fmt(r.height)} mm</text>`;
  const markSvg = marks
    .slice(0, parts.length)
    .map(([x, y, fill], i) => `<circle cx="${n(x)}" cy="${n(y)}" r="11" fill="${fill}" stroke="#fff" stroke-width="1.5"/><text x="${n(x)}" y="${n(y + 4)}" text-anchor="middle" fill="#fff" font-weight="700">${i + 1}</text>`)
    .join("");
  const legend = parts.map((p, i) => `<span><b style="background:${marks[i]?.[2] ?? C.ink}">${i + 1}</b>${esc(p)}</span>`).join("");
  const words = `${f.addOns} Anbauregal${f.addOns === 1 ? "" : "en"}`;
  return `<div class="row-draw"><div class="tscroll"><svg viewBox="0 0 ${W} ${ty + 18}" role="img" aria-label="Regalzeile aus 1 Grundregal und ${words}, ${totalLabel}" font-family="Inter,system-ui,sans-serif" font-size="12.5" fill="${C.ink}">${out.join("")}${feet}${markSvg}${segs.join("")}${total}${heightDim}</svg></div><div class="legend">${legend}</div></div>`;
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

  private comparison(key: string): GlossaryComparison {
    const c = this.page.systems.extraComparisons?.find((x) => x.key === key) ?? GLOSSARY_COMPARISONS.find((x) => x.key === key);
    if (!c) throw new Error(`${this.page.key}: Vergleich ${key} fehlt`);
    return c;
  }

  /** D: Ausfuehrungen im Vergleich (Regal-Lexikon oder eigene Vergleiche der Seite) */
  systems(): string {
    const p = this.page;
    const cards = p.systems.comparisons
      .map((key) => {
        const c = this.comparison(key);
        const side = (s: GlossaryComparison["sides"][number]) => `<div class="side">
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
  <div class="tiles">${this.page.tiles.map((t) => `<a href="${esc(t.href)}"><strong>${esc(t.label)}</strong><span>${esc(t.text)}</span><em>Ansehen →</em></a>`).join("")}</div>
  ${this.note("tiles")}
</div></section>`;
  }

  /** Summe der Beispielzeile (netto) */
  exampleSum(): number {
    return this.page.guide.example.lines.reduce((s, l) => s + l.qty * this.product(l.number).priceNet, 0);
  }

  private exampleBox(): string {
    const ex = this.page.guide.example;
    const r = ex.row;
    const f = rowFigures(r);
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
    const facts = [
      `${fmt(f.length)} mm ${r.length.label}`,
      f.secondary && r.secondary ? `${r.secondary.label} ${fmt(f.secondary.total)} mm` : "",
      `${f.frames} ${FRAME_WORD[r.kind]}`,
      f.units ? `${fmt(f.units)} ${r.kind === "pallet" ? "Palettenplätze" : "Ordner"}` : "",
    ].filter(Boolean);
    return `<div class="calc">
      <h3>${esc(fillExample(ex.title, ex))}</h3>
      <p class="sub">${esc(fillExample(ex.sub, ex))}</p>
      <ul>${lines}</ul>
      <div class="sum"><span>Summe netto</span><strong>${formatEuro(this.exampleSum(), true)}</strong></div>
      <p class="per">${esc(facts.join(" · "))}</p>
      ${cart}
      <a class="btn ghost" href="${esc(ex.configuratorHref)}" style="width:100%;justify-content:center;margin-top:8px">Mit eigenen Maßen konfigurieren</a>
      ${this.note("example")}
    </div>`;
  }

  /** F: So bauen Sie Ihr Regal */
  guide(): string {
    const g = this.page.guide;
    const examples = exampleTexts(g.example);
    const steps = BUILD_STEP_KEYS.map((key, i) => {
      const s = g.steps.find((x) => x.key === key);
      if (!s) throw new Error(`${this.page.key}: Schritt ${key} fehlt`);
      const ex = examples[key];
      return `<li class="step"><span class="no">${i + 1}</span><h3>${esc(s.title)}</h3><p>${landingTextHtml(s.text)}</p>${ex ? `<p class="ex"><b>Im Beispiel</b>${esc(ex)}</p>` : ""}</li>`;
    }).join("\n");
    const conf = g.example.configuratorHref.split("&")[0];
    return `<section class="sec sec-build" id="aufbau"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">Planen und aufbauen</span><h2>${esc(g.title)}</h2><p>${esc(g.intro)}</p></div></div>
  <ol class="steps">${steps}</ol>
  ${this.note("guide")}
  <div class="plan build">
    <div>
      <h3 class="sub-h">Die Regalzeile aus dem Beispiel</h3>
      ${rowDrawingSvg(g.example.row, g.parts)}
    </div>
    ${this.exampleBox()}
  </div>
  <div class="dodont">
    <div class="avoid"><h3>Vermeiden Sie diese Fehler</h3><ul>${g.avoid.map((x) => `<li>${landingTextHtml(x)}</li>`).join("")}</ul></div>
    <div class="ops"><h3>Sicher im Betrieb</h3><ul>${g.operation.map((x) => `<li>${landingTextHtml(x)}</li>`).join("")}</ul></div>
  </div>
  <div class="cta-row build-cta">
    <a class="btn" href="${esc(conf)}">Regal konfigurieren</a>
    <a class="btn ghost" href="${esc(g.instructions.href)}"${ext(g.instructions.href)}>${esc(g.instructions.label)}</a>
    <a class="btn ghost" href="${esc(g.service.href)}"${ext(g.service.href)}>${esc(g.service.label)}</a>
  </div>
</div></section>`;
  }

  /** G: Systemwerte und Planmaße */
  plan(): string {
    const p = this.page;
    const tables = catalogSpans(p)
      .map(
        (s) =>
          `<div class="span-box"><h3>${esc(s.label)}</h3><div class="tscroll"><table class="t spans"><tbody>${s.rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div><p class="tcap">${esc(CATALOG_SOURCE)}, S. ${s.page}</p></div>`,
      )
      .join("");
    const right = p.planImages.length
      ? `<div class="plan-imgs">${p.planImages.map((im) => `<figure><img src="${esc(im.src)}" alt="${esc(im.alt)}" loading="lazy"></figure>`).join("")}</div>`
      : `<div class="plan-note"><h3>Planmaße</h3><p>${esc(p.planNote)}</p><p class="tcap">Im Shop direkt bestellbar ist eine Auswahl der Systemwerte; weitere Maße auf Anfrage.</p></div>`;
    return `<section class="sec sec-grey" id="masse"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">Maße und Planung</span><h2>Systemwerte und Planmaße</h2>${p.planImages.length ? `<p>${esc(p.planNote)}</p>` : ""}</div></div>
  <div class="plan masse${p.catalogSystems.length > 1 ? " multi" : ""}">
    <div class="spans-col">${tables}</div>
    ${right}
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
    const parts = sp.name.split("|").map((s) => s.trim());
    const type = parts.find((x) => /regal$/i.test(x) && !/^(Fach|Paletten|Kragarm|Weitspann|Büro|Langgut)/.test(x)) ?? parts[2] ?? "";
    return `    <a class="card" href="${esc(sp.url ?? "#")}">
      <div class="img">${type ? `<span class="use">${esc(type)}</span>` : ""}${sp.image ? `<img src="${esc(sp.image)}" alt="" loading="lazy">` : ""}</div>
      <div class="body"><h3>${esc(sp.name)}</h3><div class="price">${formatEuro(sp.priceNet, true)}<small>zzgl. MwSt.</small></div><div class="stock">${esc(deliveryText(sp))}</div><span class="btn">In den Warenkorb</span></div>
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
  <div><ul class="more-links">${s.links.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)} →</a></li>`).join("")}</ul>${this.note("seo")}</div>
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

/**
 * Die Landingpages haengen auch am AT-Kanal; Branchenseiten, Schnellkonfigurator und die Beispielrechnung
 * (DE-Preise, Warenkorb) gibt es nur im DE-Shop. Ausserhalb von DE entfernt dieses Script die Verweise.
 */
export function landingChannelScript(deChannelId: string): string {
  return `<script>(function(){if(!window.salesChannelId||window.salesChannelId==='${deChannelId}')return;document.querySelectorAll('.mbp a[href^="/branchen/"],.mbp a[href^="/regal-schnellkonfigurator"],.mbp .calc').forEach(function(e){(e.closest('li')||e).remove();});})();</script>`;
}

/** Bausteine der System-Landingpages zusaetzlich zum Branchen-Stylesheet */
const LANDING_CSS = `
.stage.photo{aspect-ratio:1/1}
.stage.photo img{width:100%;height:100%;object-fit:cover;mix-blend-mode:normal}
.facts strong{font-size:18px}
.hero-grid>div{min-width:0}
a.lex{color:inherit;text-decoration:underline;text-decoration-color:var(--red);text-decoration-thickness:1.5px;text-underline-offset:2px}
a.lex:hover{color:var(--red)}
.cmps{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.cmp{border:1px solid var(--line);padding:22px;background:#fff;display:flex;flex-direction:column;gap:8px;min-width:0}
.cmp>p{margin:0;font-size:14px;color:var(--muted)}
.cmp .sides{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px;flex:1}
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
.sec-build{border-top:4px solid var(--red)}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-top:1px solid var(--line);border-left:1px solid var(--line)}
.step{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:22px 22px 20px;display:flex;flex-direction:column;gap:8px;background:#fff;min-width:0}
.step .no{display:inline-grid;place-items:center;width:30px;height:30px;background:var(--red);color:#fff;font-weight:800;font-size:15px}
.step p{margin:0;font-size:14px;color:#3a3a3a}
.step .ex{background:var(--bg-grey);padding:9px 11px;font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums;margin-top:auto}
.step .ex b{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.plan.build{margin-top:32px}
.sub-h{font-size:17px;margin:0 0 12px}
.row-draw{background:#fff;border:1px solid var(--line);padding:16px 14px 12px}
.row-draw svg{display:block;width:100%;min-width:560px;height:auto}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;margin-top:8px}
.legend span{display:flex;align-items:center;gap:6px}
.legend b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;color:#fff;font-size:11px}
.dodont{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:28px}
.dodont>div{padding:22px}
.dodont ul{margin:10px 0 0;padding:0;list-style:none;font-size:14px}
.dodont li{padding:8px 0 8px 26px;position:relative;border-top:1px solid var(--line)}
.avoid{background:#fff1f1}
.avoid li{border-top-color:#f3cfcf}
.avoid li::before{content:"✕";position:absolute;left:2px;top:8px;color:var(--red);font-weight:800}
.ops{background:var(--bg-grey)}
.ops li::before{content:"";position:absolute;left:4px;top:16px;width:7px;height:7px;background:var(--ink)}
.build-cta{margin-top:22px}
.plan.masse{grid-template-columns:1fr 1fr}
.plan.masse.multi{grid-template-columns:1fr}
.spans-col{display:grid;gap:16px}
.plan.masse.multi .spans-col{grid-template-columns:1fr 1fr}
.span-box{background:#fff;border:1px solid var(--line);padding:16px;min-width:0}
.span-box h3{font-size:15px;margin:0 0 10px}
table.spans th{width:44%;background:#fff;color:var(--ink);font-weight:600;font-size:13.5px;text-transform:none;letter-spacing:0}
table.spans td{font-size:13.5px}
.plan-note{background:#fff;border-top:4px solid var(--ink);padding:18px 20px}
.plan-note h3{font-size:17px;margin:0 0 8px}
.plan-note p{margin:0 0 8px;font-size:14.5px}
.plan-imgs{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start}
.plan-imgs figure{margin:0;background:#fff;border:1px solid var(--line);padding:8px}
.plan-imgs img{width:100%;height:auto}
.grid .card h3{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.seo{display:grid;grid-template-columns:1.4fr 1fr;gap:40px;align-items:start}
.seo p{max-width:68ch;color:#3a3a3a}
.seo h2{margin:6px 0 14px}
.more-links{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.more-links li{border-bottom:1px solid var(--line)}
.more-links a{display:block;padding:13px 0;font-weight:600;font-size:14.5px;text-decoration:none;color:var(--ink)}
.more-links a:hover{color:var(--red)}
@media (max-width:1100px){.cmps,.seo,.plan.masse,.plan.masse.multi{grid-template-columns:1fr}.tiles{grid-template-columns:repeat(2,1fr)}.steps{grid-template-columns:repeat(2,1fr)}}
@media (max-width:760px){.facts strong{font-size:16px;white-space:normal}.cmp .sides,.dodont,.plan-imgs,.plan.masse.multi .spans-col{grid-template-columns:1fr}.tiles{grid-template-columns:1fr}.steps{grid-template-columns:1fr}.step{padding:18px 16px}.cmp{padding:16px}}
`;

/** Stylesheet: ohne Rahmen fuer den Entwurf, mit Rahmen (`.mbp`) fuer das HTML-Element im Shop */
export function categoryLandingCss(scope?: string): string {
  return scope ? industryPageCss(scope) + scopeCss(LANDING_CSS, scope) : industryPageCss() + LANDING_CSS;
}
