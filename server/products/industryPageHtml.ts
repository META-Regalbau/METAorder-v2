// HTML der Branchen-Landingpages – gemeinsam fuer Design-Entwuerfe (scripts/exportIndustryPages.ts) und den Shop
// (scripts/writeIndustryPages.ts, HTML-Element der Erlebniswelten). Das Shop-HTML-Element laesst eigenes CSS zu;
// dort wird das Stylesheet auf den Seitenrahmen `.mbp` begrenzt, damit Theme und Seite sich nicht stoeren.
import { CONTACT, HOME_TEASER, fillPrices, formatEuro, type IndustryIcon, type IndustryNote, type IndustryNoteKey, type IndustryPage } from "./industryPages";
import { isSafeHref, type HomeTeaser, type IndustryContact } from "@shared/shopContent";

export type IndustryShopProduct = { id?: string; name: string; priceNet: number; deliveryTime?: string; url?: string | null; image?: string | null };

export type IndustryHtmlOptions = {
  /** Gelbe Erklaerungen mit Quellen und Pruefpunkten (nur Entwurf) */
  notes: boolean;
  /** Ziel eines Lagerbereichs-Links ("/pfad" oder Suchbegriff) als URL */
  linkHref: (target: string) => string;
  /** Beispielrechnung als echtes Warenkorb-Formular (nur Shop, braucht Produkt-IDs) */
  cartForm: boolean;
  /** Telefon, Zeiten, E-Mail (gemeinsame Texte); Standard: CONTACT */
  contact?: IndustryContact;
};

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Linkziel fuer href="…": nur #, /pfad oder http(s), sonst "#" (kein javascript:, kein //fremder-host) */
export const escHref = (href: string) => esc(isSafeHref(href) ? href : "#");
export const plain = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
export const deliveryText = (p: IndustryShopProduct) => (p.deliveryTime ? `Lieferzeit ${p.deliveryTime.replace(/\s*-\s*/, "–")}` : "Lieferzeit laut Shop");

/** Stylesheet auf einen Rahmen begrenzen: `:root`/`body` werden zum Rahmen, alle anderen Selektoren bekommen ihn vorangestellt. */
export function scopeCss(css: string, scope: string): string {
  const out: string[] = [];
  let i = 0;
  const prefix = (sel: string) =>
    sel
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s === ":root" || s === "body" ? scope : s === "*" ? `${scope} *` : s.startsWith("body.") ? `${scope}${s.slice(4)}` : s.startsWith("html") ? scope : `${scope} ${s}`))
      .join(",");
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    if (head.startsWith("@media")) {
      // Block bis zur passenden schliessenden Klammer
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      out.push(`${head}{${scopeCss(src.slice(open + 1, j - 1), scope)}}`);
      i = j;
    } else {
      const close = src.indexOf("}", open);
      out.push(`${prefix(head)}{${src.slice(open + 1, close).trim()}}`);
      i = close + 1;
    }
  }
  return out.join("\n");
}

export const ICONS: Record<IndustryIcon, string> = {
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

/** Bausteine einer Branchenseite. Entwurf und Shop setzen sie unterschiedlich zusammen. */
export class IndustryPageHtml {
  private n = 0;
  constructor(
    private page: IndustryPage,
    private products: Record<string, IndustryShopProduct>,
    private opts: IndustryHtmlOptions,
  ) {}

  private get contact(): IndustryContact {
    return this.opts.contact ?? CONTACT;
  }

  product(num: string): IndustryShopProduct {
    const p = this.products[num];
    if (!p) throw new Error(`${this.page.key}: Artikel ${num} fehlt im Shop-Stand`);
    return p;
  }
  private price = (num: string) => this.product(num).priceNet;
  private prices = (text: string) => fillPrices(text, this.price);

  note(key: IndustryNoteKey, extra = ""): string {
    const note: IndustryNote | undefined = this.opts.notes ? this.page.notes[key] : undefined;
    if (!note) return "";
    this.n += 1;
    const checks = (note.checks ?? []).map((c) => `<span class="chk">prüfen: ${esc(c)}</span>`).join(" ");
    const src = note.src ? `<span class="src">Quelle: ${esc(note.src)}</span>` : "";
    return `<aside class="note"${extra}><span class="n">${this.n}</span>${esc(note.text)} ${checks}${src}</aside>`;
  }

  hero(): string {
    const p = this.page;
    const hero = this.product(p.hero.number);
    return `<section class="hero"><div class="wrap hero-grid">
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
</div></section>`;
  }

  jump(): string {
    return `<nav class="jump" aria-label="Auf dieser Seite"><div class="wrap">
  <a href="#bereiche">Lagerbereiche</a><a href="#planung">Planungshilfe</a><a href="#produkte">Produkte</a><a href="#sicherheit">Sicherheit &amp; Pflichten</a><a href="#unterlagen">Unterlagen</a><a href="#faq">Häufige Fragen</a><a class="cta" href="#beratung">Beratung ${esc(this.contact.phone)}</a>
</div></nav>`;
  }

  areas(): string {
    const p = this.page;
    return `<section class="sec" id="bereiche"><div class="wrap">
  <div class="sec-head"><div>
    <span class="eyebrow">Ihr Betrieb, Ihre Lagerbereiche</span>
    <h2>${esc(p.areasTitle)}</h2>
    <p>${esc(p.areasIntro)}</p>
  </div></div>
  <div class="areas">
${p.areas
  .map(
    (a) => `    <article class="area">
      <svg viewBox="0 0 40 40" aria-hidden="true">${ICONS[a.icon]}</svg>
      <h3>${esc(a.title)}</h3>
      <p>${esc(a.text)}</p>
      <div class="sol"><b>META-Lösung</b>${esc(a.solution)}</div>
      <a class="link" href="${escHref(this.opts.linkHref(a.linkTarget))}">${esc(a.linkLabel)} →</a>
    </article>`,
  )
  .join("\n")}
  </div>
  ${this.note("areas")}
</div></section>`;
  }

  private table(t: IndustryPage["planning"]["tables"][number], first: boolean): string {
    const cls = (i: number) => [t.numCols?.includes(i) ? "num" : "", t.hideMobile?.includes(i) ? "hide-m" : ""].filter(Boolean).join(" ");
    const th = t.head.map((h, i) => `<th${cls(i) ? ` class="${cls(i)}"` : ""}>${esc(h)}</th>`).join("");
    const rows = t.rows.map((r) => `<tr>${r.map((c, i) => `<td${cls(i) ? ` class="${cls(i)}"` : ""}>${this.prices(c)}</td>`).join("")}</tr>`).join("\n");
    const cap = t.caption ? `<p class="tcap">${esc(t.caption)}</p>` : "";
    return `<div class="tscroll"${first ? "" : ' style="margin-top:22px"'}><table class="t"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>${cap}`;
  }

  /** Summe der Beispielrechnung (fuer Excel und Kontrolle) */
  exampleSum(): number {
    return (this.page.planning.example?.lines ?? []).reduce((s, l) => s + l.qty * this.price(l.number), 0);
  }

  private example(): string {
    const ex = this.page.planning.example;
    if (!ex) return "";
    const sum = this.exampleSum();
    const lines = ex.lines
      .map((l) => `<li><span>${l.qty} × ${esc(l.label)}</span><span>${formatEuro(l.qty * this.price(l.number), true)}</span></li>`)
      .join("");
    const per = ex.perLabel
      ? `<p class="per">≈ ${formatEuro(Math.round((sum / ex.perLabel.divisor) * 100) / 100, true)} je ${esc(ex.perLabel.unit)}${ex.perLabel.extra ? ` · ${esc(ex.perLabel.extra)}` : ""}</p>`
      : `<p class="per">${ex.info ? esc(ex.info) : "&nbsp;"}</p>`;
    const warn = ex.warn ? `<div class="warn"><span>⚠</span><span>${ex.warn}</span></div>` : "";
    const button = `<button type="submit" class="btn" style="width:100%;justify-content:center">${esc(ex.cta)}</button>`;
    const cta = this.opts.cartForm
      ? `<form action="/checkout/line-item/add" method="post" data-add-to-cart="true">${ex.lines
          .map((l) => {
            const id = this.product(l.number).id;
            if (!id) throw new Error(`${this.page.key}: Produkt-ID fehlt für ${l.number}`);
            const k = `lineItems[${id}]`;
            return `<input type="hidden" name="${k}[id]" value="${id}"><input type="hidden" name="${k}[referencedId]" value="${id}"><input type="hidden" name="${k}[type]" value="product"><input type="hidden" name="${k}[quantity]" value="${l.qty}"><input type="hidden" name="${k}[stackable]" value="1"><input type="hidden" name="${k}[removable]" value="1">`;
          })
          .join("")}<input type="hidden" name="redirectTo" value="frontend.checkout.cart.page">${button}</form>`
      : `<a class="btn" href="#" style="width:100%;justify-content:center">${esc(ex.cta)}</a>`;
    return `<div class="calc"><h3>${esc(ex.title)}</h3><p class="sub">${esc(ex.sub)}</p><ul>${lines}</ul>
      <div class="sum"><span>Summe netto</span><strong>${formatEuro(sum, true)}</strong></div>${per}${warn}
      ${cta}</div>`;
  }

  planning(): string {
    const p = this.page;
    return `<section class="sec sec-grey" id="planung"><div class="wrap">
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
</div></section>`;
  }

  /** Kopf des Produktbereichs; im Shop folgt darunter der Produkt-Slider. */
  productsHead(allHref: string, allLabel = "Alle passenden Artikel"): string {
    return `<div class="sec-head" id="produkte">
    <div><span class="eyebrow">Direkt bestellen</span><h2>${esc(this.page.productsTitle)}</h2></div>
    <a class="link" href="${escHref(allHref)}">${esc(allLabel)} →</a>
  </div>`;
  }

  /** Produktkarten (nur Entwurf – im Shop zeigt der Produkt-Slider Preise und Warenkorb live). */
  productCards(): string {
    return `<div class="grid">
${this.page.products
  .map((c) => {
    const sp = this.product(c.number);
    return `    <a class="card" href="${escHref(sp.url ?? "#")}">
      <div class="img"><span class="use">${esc(c.use)}</span>${sp.image ? `<img src="${esc(sp.image)}" alt="">` : ""}</div>
      <div class="body"><h3>${esc(c.title)}</h3><div class="spec">${esc(c.spec)}</div><div class="price">${formatEuro(sp.priceNet, true)}<small>zzgl. MwSt.</small></div><div class="stock">${esc(deliveryText(sp))}</div><span class="btn">In den Warenkorb</span></div>
    </a>`;
  })
  .join("\n")}
  </div>
  ${this.note("products")}`;
  }

  duties(): string {
    const p = this.page;
    return `<section class="sec sec-red" id="sicherheit"><div class="wrap">
  <span class="eyebrow">Sicherheit &amp; Pflichten</span>
  <h2>Sicher lagern: Was META liefert – und was Sie als Betreiber tun</h2>
  <div class="duties">
    <div class="duty"><h3>Das liefert META</h3><ul>${p.duties.meta.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div>
    <div class="duty op"><h3>Das liegt bei Ihnen als Betreiber</h3><ul>${p.duties.operator.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
      <p class="hint">${esc(p.duties.hint)}</p></div>
  </div>
  ${this.note("duties")}
</div></section>`;
  }

  why(): string {
    return `<section class="sec"><div class="wrap">
  <div class="why">${this.page.why.map((w) => `<div><strong>${esc(w.title)}</strong><span>${esc(w.text)}</span></div>`).join("")}</div>
  ${this.note("why")}
</div></section>`;
  }

  project(): string {
    const p = this.page;
    return `<section class="sec sec-grey" id="unterlagen"><div class="wrap">
  <div class="split">
    <div class="panel dark">
      <span class="eyebrow">${esc(p.project.eyebrow)}</span>
      <h3>${esc(p.project.title)}</h3>
      <p>${esc(p.project.text)}</p>
      <div class="cta-row" style="margin-top:8px"><a class="btn white" href="#beratung">${esc(p.project.cta)}</a>${p.project.link ? `<a class="link" style="color:#fff" href="${escHref(p.project.link.href)}">${esc(p.project.link.label)} →</a>` : ""}</div>
    </div>
    <div class="panel">
      <span class="eyebrow">Unterlagen für Ihre Freigabe</span>
      <h3>Alles für Einkauf und Sicherheitsfachkraft</h3>
      <ul class="docs">${p.docs.map((d) => `<li>${esc(d.label)} <span>${esc(d.where)}</span></li>`).join("")}</ul>
    </div>
  </div>
  ${this.note("project")}
</div></section>`;
  }

  /** Ueberschrift der FAQ; im Shop folgt das FAQ-Element des Plugins, im Entwurf die Fragen als Akkordeon. */
  faqHead(): string {
    return `<span class="eyebrow">Häufige Fragen</span>
    <h2>${esc(this.page.faqTitle)}</h2>
    ${this.note("faq")}`;
  }

  faqItems(): string {
    return this.page.faq.map((f, i) => `    <details${i === 0 ? " open" : ""}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n");
  }

  advice(): string {
    const p = this.page;
    return `<div class="advice">
    <div class="l">
      <span class="eyebrow">Persönliche Beratung</span>
      <h2>${esc(p.advice.title)}</h2>
      <p>${esc(p.advice.text)}</p>
    </div>
    <div class="r">
      <a class="tel" href="tel:${esc(this.contact.tel)}">${esc(this.contact.phone)}</a>
      <small>Montag bis Freitag, ${esc(this.contact.hours)}</small>
      <a class="btn white" href="mailto:${esc(this.contact.mail)}" style="align-self:flex-start">E-Mail an den Digital-Service</a>
    </div>
  </div>
  ${this.note("advice")}`;
  }

  /** Kacheln zu den anderen Branchenseiten */
  more(all: IndustryPage[], hrefFor: (p: IndustryPage) => string): string {
    const tiles = all
      .filter((o) => o.key !== this.page.key)
      .map((o) => `<a href="${escHref(hrefFor(o))}"><strong>${esc(o.name)}</strong><span>${esc(o.tagline)}</span></a>`)
      .join("");
    return `<div style="margin:48px 0 0">
    <span class="eyebrow">Weitere Branchen</span>
    <h2 style="margin:6px 0 18px">Regale für Ihre Branche</h2>
    <div class="more">${tiles}<span class="soon"><strong>Holz-, Metall- &amp; Baustoffhandel</strong><span>Langgut – in Vorbereitung</span></span></div>
  </div>`;
  }
}

/** Startseiten-Teaser: 5 Branchenkacheln und eine Beratungskachel (Bild = Hauptbild der Branchenseite). */
export function homeTeaserHtml(
  pages: IndustryPage[],
  products: Record<string, IndustryShopProduct>,
  hrefFor: (p: IndustryPage) => string,
  t: HomeTeaser = HOME_TEASER,
  contact: IndustryContact = CONTACT,
): string {
  const tiles = pages
    .map((p) => {
      const img = products[p.hero.number]?.image;
      return `<a class="ht-tile" href="${escHref(hrefFor(p))}">
      <div class="ht-img">${img ? `<img src="${esc(img)}" alt="${esc(p.hero.alt)}" loading="lazy">` : ""}</div>
      <div class="ht-body"><strong>${esc(p.short)}</strong><span class="ht-goods">${esc(p.teaser.goods)}</span><span class="ht-fact">${esc(p.teaser.fact)}</span><span class="ht-more">${esc(t.more)} →</span></div>
    </a>`;
    })
    .join("\n");
  return `<section class="ht"><div class="wrap">
  <div class="sec-head"><div>
    <span class="eyebrow">${esc(t.eyebrow)}</span>
    <h2>${esc(t.title)}</h2>
    <p>${esc(t.intro)}</p>
  </div></div>
  <div class="ht-grid">
${tiles}
    <div class="ht-tile ht-advice">
      <div class="ht-body"><strong>${esc(t.advice.title)}</strong><span class="ht-goods">${esc(t.advice.text)}</span>
        <a class="tel" href="tel:${esc(contact.tel)}">${esc(contact.phone)}</a><small>Montag bis Freitag, ${esc(contact.hours)}</small></div>
    </div>
  </div>
</div></section>`;
}

/** Zusaetze zum Stylesheet: Erklaerungen im roten Abschnitt, Meta-Vorschau (Entwurf), Platzhalter-Kachel. */
const EXTRA_CSS = `
.sec-red .note{color:var(--note-ink)}
.meta-preview{display:none;background:#fff;border:1px dashed #c9c9c9;padding:10px 12px;margin:10px 0 0;font-size:13px}
body.notes .meta-preview{display:block}
.meta-preview b{display:block;color:#1a0dab;font-size:16px;font-weight:500}
.meta-preview i{display:block;color:#006621;font-style:normal}
.more span.soon{border:1px dashed var(--line);padding:16px;display:flex;flex-direction:column;gap:4px;opacity:.6}
.more span.soon span{font-size:12.5px;color:var(--muted)}
.ht{padding:56px 0 48px;background:#fff}
.ht .sec-head{margin-bottom:22px}
.ht-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.ht-tile{display:grid;grid-template-columns:150px 1fr;border:1px solid var(--line);background:#fff;text-decoration:none;color:var(--text);transition:border-color .15s,box-shadow .15s;min-height:150px}
.ht-tile:hover{border-color:var(--red);box-shadow:inset 0 -3px 0 var(--red)}
.ht-img{background:var(--bg-stage);display:grid;place-items:center;overflow:hidden}
.ht-img img{width:86%;max-height:140px;object-fit:contain;mix-blend-mode:multiply}
.ht-body{padding:16px 18px;display:flex;flex-direction:column;gap:6px}
.ht-body strong{color:var(--ink);font-size:16px;line-height:1.3}
.ht-goods{font-size:13.5px;color:#444;line-height:1.45}
.ht-fact{font-size:12.5px;font-weight:600;color:var(--ink);background:var(--bg-grey);padding:4px 8px;align-self:flex-start}
.ht-more{margin-top:auto;font-size:13.5px;font-weight:600;color:var(--ink);border-bottom:1.5px solid var(--red);align-self:flex-start;padding-bottom:1px}
.ht-advice{grid-template-columns:1fr;background:var(--ink);border-color:var(--ink);color:#d8d8d8}
.ht-advice:hover{border-color:var(--ink);box-shadow:none}
.ht-advice strong{color:#fff}
.ht-advice .ht-goods{color:#c9c9c9}
.ht-advice .tel{margin-top:auto;color:#fff;font-size:24px;font-weight:800;text-decoration:none;letter-spacing:-.01em}
.ht-advice small{font-size:12.5px;color:#a8a8a8}
@media (max-width:1100px){.ht-grid{grid-template-columns:repeat(2,1fr)}}
@media (max-width:760px){.ht{padding:40px 0 32px}.ht-grid{grid-template-columns:1fr;gap:10px}.ht-tile{grid-template-columns:96px 1fr;min-height:0}.ht-img img{max-height:96px}.ht-body{padding:12px 14px;gap:4px}.ht-body strong{font-size:15px}.ht-goods{font-size:13px}.ht-advice{grid-template-columns:1fr}}
`;

/** Anpassungen nur im Shop: Theme-Bootstrap (.btn, .card, Ueberschriften) neutralisieren, Abstaende des Elements. */
const SHOP_CSS = `
.mbp{font-size:15px;line-height:1.6}
.mbp .btn{border:0;border-radius:0;line-height:1.3}
.mbp .btn.ghost{border:0}
.mbp h1,.mbp h2,.mbp h3{font-family:inherit;text-transform:none}
.mbp ul{margin-bottom:0}
.mbp p{margin-top:0}
.mbp .jump{position:static}
.mbp img{max-width:100%;height:auto}
.mbp-slider{padding:0 0 24px}
/* Theme: Bootstrap-Zeile um das HTML-Element hat negative Raender – bei voller Breite 20 px Ueberlauf */
.cms-block-container-row:has(> .col-12 > .cms-element-html > .mbp){margin-left:0;margin-right:0}
.cms-block-container-row:has(> .col-12 > .cms-element-html > .mbp) > .col-12{padding-left:0;padding-right:0}
/* In „boxed“-Abschnitten gibt der Theme-Container den Seitenrand schon vor */
.cms-section-default.boxed .mbp .wrap{padding-left:0;padding-right:0}
`;

export function industryPageCss(scope?: string): string {
  const css = INDUSTRY_PAGE_CSS + EXTRA_CSS;
  return scope ? scopeCss(css, scope) + SHOP_CSS : css;
}

/** Stylesheet der Entwuerfe (Look des Live-Shops: Inter, Rot #ff0002, eckige Kanten, Hellgrau-Abschnitte). */
const INDUSTRY_PAGE_CSS = `
/* Tokens: aus dem Live-Shop übernommen (Inter, Rot #ff0002, eckige Kanten, Hellgrau-Abschnitte); --wrap = Theme-Container (1400 px) */
:root{
  --red:#ff0002; --red-d:#d10002; --ink:#131313; --text:#2b2b2b; --muted:#6b6b6a; --grey:#929291;
  --line:#e3e3e3; --bg-grey:#f4f4f4; --bg-stage:#efefef; --ok:#1e8e3e; --white:#fff;
  --note:#fff4c2; --note-b:#e6b800; --note-ink:#3d3300;
  --wrap:1400px; --gutter:20px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font:15px/1.6 Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--text);background:var(--white);-webkit-font-smoothing:antialiased}
a{color:inherit}
img{max-width:100%;display:block}
.wrap{max-width:var(--wrap);margin:0 auto;padding:0 var(--gutter)}
h1,h2,h3{color:var(--ink);line-height:1.2;margin:0}
h2{font-size:28px;font-weight:700;letter-spacing:-.01em}
h3{font-size:17px;font-weight:700}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--red)}
.sec{padding:64px 0}
.sec-grey{background:var(--bg-grey)}
.sec-head{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:28px;flex-wrap:wrap}
.sec-head p{margin:8px 0 0;max-width:62ch;color:var(--muted)}
.btn{display:inline-flex;align-items:center;gap:8px;border:0;background:var(--red);color:#fff;font:inherit;font-weight:600;font-size:14px;padding:13px 20px;text-decoration:none;cursor:pointer;border-radius:0;transition:background .15s}
.btn:hover{background:var(--red-d)}
.btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink)}
.btn.ghost:hover{background:var(--ink);color:#fff}
.btn.white{background:#fff;color:var(--ink)}
.link{font-weight:600;font-size:14px;text-decoration:none;color:var(--ink);border-bottom:1.5px solid var(--red);padding-bottom:1px}
.link:hover{color:var(--red)}

/* Entwurfsleiste + Erklärungen */
.draft{background:#111;color:#fff;font-size:13px;padding:9px 0;position:sticky;top:0;z-index:20}
.draft .wrap{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
.draft button{background:#fff;color:#111;border:0;padding:6px 12px;font:inherit;font-weight:600;cursor:pointer}
.note{display:none;background:var(--note);border-left:4px solid var(--note-b);padding:10px 12px;font-size:13px;line-height:1.5;color:var(--note-ink);margin:14px 0}
.note b{font-weight:700}
.note .n{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--note-ink);color:var(--note);font-size:11px;font-weight:700;margin-right:6px}
.note .src{display:block;margin-top:4px;opacity:.8}
body.notes .note{display:block}
.chk{display:inline-block;background:#ffe08a;color:#3d3300;font-size:11px;font-weight:700;padding:1px 6px;margin-left:4px;vertical-align:middle}
body:not(.notes) .chk{display:none}

/* Shop-Rahmen (Nachbau Live-Header, nur zur Einordnung) */
.usp{background:var(--ink);color:#fff;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.usp .wrap{display:flex;justify-content:space-between;gap:20px;padding-top:7px;padding-bottom:7px;overflow-x:auto;white-space:nowrap}
header.shop{border-bottom:1px solid var(--line)}
header.shop .wrap{display:flex;align-items:center;gap:28px;height:76px}
.logo{font-weight:800;font-size:26px;color:var(--red);letter-spacing:.01em;white-space:nowrap}
.logo span{color:var(--ink);font-weight:500;font-size:14px;margin-left:5px;letter-spacing:0}
.search{flex:1;max-width:520px;display:flex;border:1px solid var(--line)}
.search input{flex:1;border:0;padding:11px 14px;font:inherit;font-size:13px;min-width:0}
.hdr-ic{display:flex;gap:22px;font-size:12px;color:var(--muted);margin-left:auto}
nav.main{border-bottom:1px solid var(--line);background:#fafafa}
nav.main .wrap{display:flex;gap:28px;height:46px;align-items:center;font-weight:600;font-size:13.5px;overflow-x:auto;white-space:nowrap}
nav.main a{text-decoration:none}
nav.main a.on{color:var(--red);box-shadow:inset 0 -3px 0 var(--red);padding:13px 0}
nav.main .new{font-size:10px;background:var(--red);color:#fff;padding:1px 5px;margin-left:4px;vertical-align:2px}
.crumb{font-size:12.5px;color:var(--muted);padding:16px 0 0}
.crumb a{text-decoration:none}

/* Hero */
.hero{padding:28px 0 56px}
.hero-grid{display:grid;grid-template-columns:1.05fr 1fr;gap:48px;align-items:center}
.hero h1{font-size:44px;font-weight:800;letter-spacing:-.02em;margin:12px 0 16px}
.hero .lead{font-size:17px;line-height:1.6;color:#3a3a3a;margin:0 0 22px;max-width:56ch}
.proof{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0 0 26px;padding:0;list-style:none;font-size:14px;font-weight:600;color:var(--ink)}
.proof li{display:flex;align-items:center;gap:8px}
.proof li::before{content:"";width:16px;height:16px;flex:none;background:var(--red);-webkit-mask:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6.2 11.6 2.6 8l1.1-1.1 2.5 2.5 6.1-6.1L13.4 4.4z"/></svg>') center/16px no-repeat;mask:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6.2 11.6 2.6 8l1.1-1.1 2.5 2.5 6.1-6.1L13.4 4.4z"/></svg>') center/16px no-repeat}
.cta-row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.cta-row .tel{font-size:13px;color:var(--muted);margin-left:4px}
.cta-row .tel b{color:var(--ink);font-size:15px}
.stage{position:relative;background:var(--bg-stage);aspect-ratio:5/4;display:grid;place-items:center;overflow:hidden}
.stage img{width:72%;mix-blend-mode:multiply}
.stage .tag{position:absolute;left:0;top:0;background:var(--red);color:#fff;font-size:12px;font-weight:700;padding:6px 10px;letter-spacing:.04em}
.facts{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);border-left:1px solid var(--line);margin-top:-1px}
.facts div{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:14px 14px 12px;background:#fff}
.facts strong{display:block;font-size:20px;white-space:nowrap;font-weight:800;color:var(--ink);letter-spacing:-.01em;line-height:1.1}
.facts span{font-size:12px;color:var(--muted);line-height:1.35;display:block;margin-top:4px}

/* Sprungnavigation */
.jump{position:sticky;top:37px;z-index:10;background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.jump .wrap{display:flex;gap:6px;overflow-x:auto;white-space:nowrap;padding-top:8px;padding-bottom:8px}
.jump a{font-size:13px;font-weight:600;text-decoration:none;padding:7px 12px;color:var(--ink)}
.jump a:hover{background:var(--bg-grey)}
.jump a.cta{margin-left:auto;background:var(--red);color:#fff}

/* Lagerbereiche */
.areas{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-top:1px solid var(--line);border-left:1px solid var(--line)}
.area{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:26px 24px 22px;display:flex;flex-direction:column;gap:10px;background:#fff;transition:box-shadow .15s}
.area:hover{box-shadow:inset 0 -3px 0 var(--red)}
.area svg{width:40px;height:40px;stroke:var(--red);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.area p{margin:0;font-size:14px;color:#444}
.area .sol{font-size:13.5px;color:var(--ink);background:var(--bg-grey);padding:10px 12px;margin-top:2px}
.area .sol b{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.area .link{margin-top:auto;align-self:flex-start}

/* Planungshilfe */
.plan{display:grid;grid-template-columns:1.25fr 1fr;gap:32px;align-items:start}
table.t{width:100%;border-collapse:collapse;background:#fff;font-size:14px}
table.t th,table.t td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:top}
table.t thead th{background:var(--ink);color:#fff;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
table.t td.num,table.t th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
table.t tbody tr:hover{background:#fafafa}
.plan>*{min-width:0}
.tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.tcap{font-size:12.5px;color:var(--muted);margin:10px 0 0}
.calc{background:#fff;border-top:4px solid var(--red);padding:22px 22px 18px}
.calc h3{font-size:19px;margin-bottom:4px}
.calc .sub{font-size:13.5px;color:var(--muted);margin:0 0 16px}
.calc ul{list-style:none;margin:0;padding:0;font-size:14px}
.calc li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed var(--line)}
.calc li span:last-child{font-variant-numeric:tabular-nums;white-space:nowrap}
.calc .sum{display:flex;justify-content:space-between;align-items:baseline;padding:14px 0 4px;font-weight:700;color:var(--ink)}
.calc .sum strong{font-size:26px;letter-spacing:-.01em}
.calc .per{font-size:13px;color:var(--muted);text-align:right;margin:0 0 14px}
.calc .warn{display:flex;gap:10px;font-size:13px;background:#fff1f1;border-left:3px solid var(--red);padding:10px 12px;margin:0 0 16px;color:#5a1010}

/* Produkte */
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.card{border:1px solid var(--line);display:flex;flex-direction:column;background:#fff;text-decoration:none;transition:border-color .15s}
.card:hover{border-color:#bdbdbd}
.card .img{aspect-ratio:1/1;background:var(--bg-stage);display:grid;place-items:center;position:relative}
.card .img img{width:82%;mix-blend-mode:multiply}
.card .use{position:absolute;left:0;top:0;background:#fff;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:5px 8px;color:var(--ink)}
.card .body{padding:14px 14px 16px;display:flex;flex-direction:column;gap:8px;flex:1}
.card h3{font-size:14px;font-weight:600;line-height:1.4}
.card .spec{font-size:12.5px;color:var(--muted)}
.card .price{margin-top:auto;font-size:20px;font-weight:700;color:var(--ink)}
.card .price small{font-size:11.5px;font-weight:500;color:var(--muted);margin-left:4px}
.card .stock{font-size:12px;color:#333}
.card .stock::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-right:6px}
.card .btn{justify-content:center;width:100%;padding:11px}

/* Sicherheit (roter Abschnitt wie Live) */
.sec-red{background:var(--red);color:#fff}
.sec-red h2,.sec-red h3{color:#fff}
.sec-red .eyebrow{color:#fff;opacity:.85}
.duties{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-top:28px}
.duty{background:rgba(255,255,255,.1);padding:24px}
.duty.op{background:#fff;color:var(--text)}
.duty.op h3{color:var(--ink)}
.duty ul{margin:12px 0 0;padding:0;list-style:none;font-size:14.5px}
.duty li{padding:9px 0 9px 26px;position:relative;border-top:1px solid rgba(255,255,255,.22)}
.duty.op li{border-top-color:var(--line)}
.duty li::before{content:"";position:absolute;left:0;top:13px;width:14px;height:14px;background:currentColor;-webkit-mask:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6.2 11.6 2.6 8l1.1-1.1 2.5 2.5 6.1-6.1L13.4 4.4z"/></svg>') center/14px no-repeat;mask:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6.2 11.6 2.6 8l1.1-1.1 2.5 2.5 6.1-6.1L13.4 4.4z"/></svg>') center/14px no-repeat}
.duty.op li::before{background:var(--red);-webkit-mask:none;mask:none;width:6px;height:6px;top:18px;left:4px}
.duty .hint{font-size:12.5px;margin:14px 0 0;color:var(--muted)}

/* Warum META */
.why{display:grid;grid-template-columns:repeat(6,1fr);gap:0;border-left:1px solid var(--line)}
.why div{border-right:1px solid var(--line);padding:4px 18px}
.why strong{display:block;color:var(--ink);font-size:15px;margin-bottom:4px}
.why span{font-size:13px;color:var(--muted);line-height:1.45;display:block}

/* Projekt + Unterlagen */
.split{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.panel{border:1px solid var(--line);padding:26px;display:flex;flex-direction:column;gap:10px;background:#fff}
.panel.dark{background:var(--ink);color:#d8d8d8;border-color:var(--ink)}
.panel.dark h3{color:#fff}
.panel p{margin:0;font-size:14.5px}
.docs{list-style:none;margin:6px 0 0;padding:0}
.docs li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--line);font-size:14px}
.docs li span{color:var(--muted);font-size:12.5px;white-space:nowrap}

/* FAQ */
.faq{display:grid;grid-template-columns:320px 1fr;gap:48px}
.faq details{border-bottom:1px solid var(--line)}
.faq details:first-child{border-top:1px solid var(--line)}
.faq summary{list-style:none;cursor:pointer;padding:18px 40px 18px 0;font-weight:600;color:var(--ink);font-size:15.5px;position:relative}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";position:absolute;right:6px;top:12px;font-size:26px;font-weight:300;color:var(--red)}
.faq details[open] summary::after{content:"–"}
.faq details p{margin:0 0 18px;font-size:14.5px;color:#444;max-width:72ch}

/* Beratung + weitere Branchen */
.advice{display:grid;grid-template-columns:1.2fr 1fr;gap:0;background:var(--ink);color:#d8d8d8}
.advice .l{padding:40px}
.advice h2{color:#fff;margin:8px 0 10px}
.advice .r{background:#1f1f1f;padding:40px;display:flex;flex-direction:column;gap:14px;justify-content:center}
.advice .tel{font-size:30px;font-weight:800;color:#fff;text-decoration:none;letter-spacing:-.01em}
.advice small{font-size:13px;color:#a8a8a8}
.more{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.more a{border:1px solid var(--line);padding:16px;text-decoration:none;display:flex;flex-direction:column;gap:4px;background:#fff}
.more a:hover{border-color:var(--red)}
.more strong{color:var(--ink);font-size:14.5px}
.more span{font-size:12.5px;color:var(--muted)}
.more a.soon{opacity:.55}

footer{background:var(--ink);color:#bdbdbd;font-size:12.5px;padding:28px 0;margin-top:64px}
footer .wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}

.hero h1.long{font-size:36px}
.plan.stacked{grid-template-columns:1fr}
.plan.stacked .calc{max-width:640px}
@media (max-width:1100px){
  .hero-grid,.plan,.faq,.advice{grid-template-columns:1fr}
  .grid{grid-template-columns:repeat(3,1fr)}
  .why{grid-template-columns:repeat(3,1fr);row-gap:20px}
  .more{grid-template-columns:repeat(3,1fr)}
  .hdr-ic{display:none}
}
@media (max-width:760px){
  :root{--gutter:16px}
  .sec{padding:44px 0}
  h2{font-size:23px}
  .hero{padding:18px 0 40px}
  .hero h1,.hero h1.long{font-size:28px}
  .hero .lead{font-size:15.5px}
  .facts{grid-template-columns:repeat(2,1fr)}
  .areas,.duties,.split{grid-template-columns:1fr}
  .grid{grid-template-columns:repeat(2,1fr);gap:10px}
  .card .body{padding:10px}
  .card h3{font-size:13px}
  .card .price{font-size:17px}
  .why{grid-template-columns:1fr 1fr}
  .more{grid-template-columns:1fr 1fr}
  .advice .l,.advice .r{padding:26px 20px}
  .advice .tel{font-size:24px}
  header.shop .wrap{height:auto;padding-top:12px;padding-bottom:12px;flex-wrap:wrap;gap:12px}
  .search{max-width:none;flex-basis:100%}
  .usp .wrap{justify-content:flex-start}
  table.t{font-size:12.5px}
  table.t th,table.t td{padding:8px 6px}
  table.t td.num,table.t th.num{white-space:normal}
  table.t .hide-m{display:none}
  table.t thead th{font-size:10.5px;letter-spacing:.02em}
  .jump{top:0}
  .draft{position:static}
}
`;
