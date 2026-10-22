// HTML des Regal-Lexikons – gemeinsam für den Entwurf (scripts/exportGlossary.ts) und den Shop
// (scripts/writeGlossaryPage.ts, HTML-Element einer Erlebniswelt). Im Shop ist das Stylesheet auf `.mlx` begrenzt.
// Suche und Themenfilter laufen ohne Plugin im Browser; alle Texte stehen im HTML (Suchmaschinen, KI-Suchen).
import { CONTACT } from "./industryPages";
import { esc, scopeCss } from "./industryPageHtml";
import {
  GLOSSARY_COMPARISONS,
  GLOSSARY_GUIDE,
  GLOSSARY_PAGE,
  GLOSSARY_REF,
  GLOSSARY_TERMS,
  GLOSSARY_TOPICS,
  glossaryLetter,
  glossaryPlain,
  sortedGlossaryTerms,
  type GlossaryComparison,
  type GlossaryTerm,
} from "./glossary";

export type GlossaryHtmlOptions = {
  /** Absolute Adresse der Seite für die strukturierten Daten, z. B. https://shop.meta-online.com/regal-lexikon */
  pageUrl: string;
  /** Interne Shop-Links ("/pfad") in absolute Adressen umwandeln (Entwurf außerhalb des Shops) */
  linkBase?: string;
  /** Quellen je Eintrag sichtbar (nur Entwurf) */
  sources?: boolean;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const href = (target: string, o: GlossaryHtmlOptions) => (o.linkBase && target.startsWith("/") ? o.linkBase.replace(/\/$/, "") + target : target);

/** Text mit [[verweis]] → HTML mit Ankerlinks */
export function glossaryTextHtml(text: string, terms: GlossaryTerm[] = GLOSSARY_TERMS): string {
  const byKey = new Map(terms.map((t) => [t.key, t.term]));
  let out = "";
  let last = 0;
  for (const m of text.matchAll(GLOSSARY_REF)) {
    out += esc(text.slice(last, m.index));
    out += `<a class="ref" href="#${m[1]}">${esc(m[2] ?? byKey.get(m[1]) ?? m[1])}</a>`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + esc(text.slice(last));
}

const topicLabel = (key: string) => GLOSSARY_TOPICS.find((t) => t.key === key)?.label ?? key;

function termHtml(t: GlossaryTerm, o: GlossaryHtmlOptions): string {
  const search = [t.term, ...(t.aliases ?? [])].join(" ").toLowerCase();
  return `<div class="term" id="${t.key}" data-topic="${t.topic}" data-search="${esc(search)}">
  <h4><a href="#${t.key}">${esc(t.term)}</a><span class="kat">${esc(topicLabel(t.topic))}</span></h4>
  <p>${glossaryTextHtml(t.text)}</p>
  ${t.example ? `<p class="ex"><b>Beispiel:</b> ${glossaryTextHtml(t.example)}</p>` : ""}
  ${t.aliases?.length ? `<p class="aka">Auch: ${t.aliases.map(esc).join(", ")}</p>` : ""}
  ${t.link ? `<p class="more"><a href="${esc(href(t.link.href, o))}">${esc(t.link.label)} ›</a></p>` : ""}
  ${o.sources ? `<p class="src">Quelle: ${esc(t.src)}</p>` : ""}
</div>`;
}

function comparisonHtml(c: GlossaryComparison, o: GlossaryHtmlOptions): string {
  const list = (items: string[], cls: string, label: string) =>
    items.length ? `<p class="lbl">${label}</p><ul class="${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "";
  const side = (s: GlossaryComparison["sides"][number]) => `<div class="side">
    <h4>${esc(s.name)}</h4>
    ${list(s.plus, "plus", "Vorteile")}
    ${list(s.minus, "minus", "Grenzen")}
    <p class="fit">${esc(s.fit)}</p>
    ${s.link ? `<p class="more"><a href="${esc(href(s.link.href, o))}">${esc(s.link.label)} ›</a></p>` : ""}
  </div>`;
  return `<article class="vs" id="vergleich-${c.key}">
  <h3>${esc(c.title)}</h3>
  <p class="intro">${esc(c.intro)}</p>
  <div class="sides">${side(c.sides[0])}${side(c.sides[1])}</div>
  ${o.sources ? `<p class="src">Quelle: ${esc(c.src)}</p>` : ""}
</article>`;
}

/** Strukturierte Daten: Begriffe als DefinedTermSet, Vergleiche als FAQPage */
export function glossaryJsonLd(o: GlossaryHtmlOptions): string {
  const termSet = {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    "@id": `${o.pageUrl}#begriffe`,
    name: GLOSSARY_PAGE.name,
    url: o.pageUrl,
    inLanguage: "de-DE",
    publisher: { "@type": "Organization", name: "META-Regalbau GmbH & Co. KG" },
    hasDefinedTerm: sortedGlossaryTerms().map((t) => ({
      "@type": "DefinedTerm",
      "@id": `${o.pageUrl}#${t.key}`,
      name: t.term,
      ...(t.aliases?.length ? { alternateName: t.aliases } : {}),
      description: glossaryPlain([t.text, t.example].filter(Boolean).join(" ")),
      url: `${o.pageUrl}#${t.key}`,
      inDefinedTermSet: `${o.pageUrl}#begriffe`,
    })),
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: GLOSSARY_COMPARISONS.map((c) => ({
      "@type": "Question",
      name: c.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: `${c.intro} ${c.sides.map((s) => `${s.name}: ${[...s.plus].join(", ")}${s.minus.length ? `; Grenzen: ${s.minus.join(", ")}` : ""}. ${s.fit}`).join(" ")}`,
      },
    })),
  };
  // "</" im JSON würde das Script-Element beenden
  const json = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json(termSet)}</script><script type="application/ld+json">${json(faq)}</script>`;
}

/** Inhalt der Seite (ohne Stylesheet und Script) */
export function glossaryBodyHtml(o: GlossaryHtmlOptions): string {
  const terms = sortedGlossaryTerms();
  const letters = new Map<string, GlossaryTerm[]>();
  for (const t of terms) letters.set(glossaryLetter(t.term), [...(letters.get(glossaryLetter(t.term)) ?? []), t]);
  const az = ALPHABET.map((l) => (letters.has(l) ? `<a href="#buchstabe-${l.toLowerCase()}">${l}</a>` : `<span>${l}</span>`)).join("");
  const chips = [`<button type="button" class="chip on" data-topic="">Alle</button>`, ...GLOSSARY_TOPICS.map((t) => `<button type="button" class="chip" data-topic="${t.key}">${esc(t.label)}</button>`)].join("");
  const groups = [...letters.entries()]
    .map(([l, ts]) => `<section class="letter" id="buchstabe-${l.toLowerCase()}"><h3 class="l">${l}</h3>${ts.map((t) => termHtml(t, o)).join("")}</section>`)
    .join("");
  const guide = GLOSSARY_GUIDE.map(
    (g) => `<div class="card">
    <h3>${esc(g.title)}</h3>
    <p class="sys">${esc(g.system)}</p>
    <p>${esc(g.text)}</p>
    <p class="links">${g.links.map((l) => `<a href="${esc(href(l.href, o))}">${esc(l.label)} ›</a>`).join("")}</p>
  </div>`,
  ).join("");
  const vsJump = GLOSSARY_COMPARISONS.map((c) => `<a href="#vergleich-${c.key}">${esc(c.title)}</a>`).join("");
  return `<div class="hero"><div class="wrap">
  <span class="eyebrow">Ratgeber</span>
  <h1>${esc(GLOSSARY_PAGE.h1)}</h1>
  <p class="lead">${esc(GLOSSARY_PAGE.lead)}</p>
  <nav class="toc" aria-label="Inhalt"><a href="#wegweiser">Welches Regal passt?</a><a href="#vergleiche">Was ist der Unterschied?</a><a href="#begriffe">Begriffe von A bis Z</a></nav>
</div></div>

<section class="sec" id="wegweiser"><div class="wrap">
  <span class="eyebrow">Wegweiser</span>
  <h2>Welches Regal für welches Lagergut?</h2>
  <p class="sub">Die Regalart richtet sich danach, was Sie lagern und wie Sie es ein- und auslagern.</p>
  <div class="cards">${guide}</div>
</div></section>

<section class="sec sec-grey" id="vergleiche"><div class="wrap">
  <span class="eyebrow">Vergleiche</span>
  <h2>Was ist der Unterschied?</h2>
  <p class="sub">Die häufigsten Entscheidungen beim Regalkauf – mit Vorteilen, Grenzen und einer Empfehlung.</p>
  <nav class="vs-jump" aria-label="Vergleiche">${vsJump}</nav>
  ${GLOSSARY_COMPARISONS.map((c) => comparisonHtml(c, o)).join("")}
</div></section>

<section class="sec" id="begriffe"><div class="wrap">
  <span class="eyebrow">Lexikon</span>
  <h2>Begriffe von A bis Z</h2>
  <div class="tools">
    <label class="search"><span class="sr">Begriff suchen</span><input type="search" id="mlx-q" placeholder="Begriff suchen, z. B. Feldlast" autocomplete="off"></label>
    <nav class="az" aria-label="Alphabet">${az}</nav>
    <div class="chips" role="group" aria-label="Thema">${chips}</div>
  </div>
  <p class="count" aria-live="polite"><span id="mlx-count">${terms.length}</span> Begriffe</p>
  <div class="terms">${groups}</div>
  <p class="none" id="mlx-none" hidden>Kein Begriff gefunden. Rufen Sie uns an, wir erklären es gern: <a href="tel:${esc(CONTACT.tel)}">${esc(CONTACT.phone)}</a>.</p>
</div></section>

<section class="sec sec-grey" id="beratung"><div class="wrap">
  <div class="advice">
    <div class="l">
      <span class="eyebrow">Persönliche Beratung</span>
      <h2>Noch Fragen zu Ihrem Regal?</h2>
      <p>Wir helfen bei der Auswahl, prüfen Lasten und Maße und erstellen Ihnen ein Angebot. Für die vorgeschriebene jährliche Prüfung bietet META die <a href="#regalinspektion">Regalinspektion</a> an.</p>
    </div>
    <div class="r">
      <a class="tel" href="tel:${esc(CONTACT.tel)}">${esc(CONTACT.phone)}</a>
      <small>Montag bis Freitag, ${esc(CONTACT.hours)}</small>
      <a class="btn" href="mailto:${esc(CONTACT.mail)}">E-Mail an den Digital-Service</a>
    </div>
  </div>
</div></section>`;
}

/** Suche, Themenfilter und Sprungmarken; ohne Abhängigkeiten, ES5 wie die übrigen Shop-Bausteine */
export const GLOSSARY_SCRIPT = `(function(){
  var root=document.querySelector('.mlx');if(!root||root.getAttribute('data-ready'))return;root.setAttribute('data-ready','1');
  // Die Branchenseiten gibt es nur im Onlineshop DE; in anderen Kanälen (AT) die Links darauf entfernen
  if(window.salesChannelId&&window.salesChannelId!=='018ec134507f703b82a76467791e7e61'){var bl=root.querySelectorAll('a[href^="/branchen/"]');for(var b=0;b<bl.length;b++)bl[b].parentNode.removeChild(bl[b]);}
  var q=root.querySelector('#mlx-q'),chips=root.querySelectorAll('.chip'),terms=root.querySelectorAll('.term'),groups=root.querySelectorAll('.letter'),
      count=root.querySelector('#mlx-count'),none=root.querySelector('#mlx-none'),topic='';
  function norm(s){return String(s||'').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss');}
  function apply(){
    var words=norm(q.value).split(/\\s+/).filter(Boolean),n=0;
    for(var i=0;i<terms.length;i++){
      var t=terms[i],hay=norm(t.getAttribute('data-search')+' '+t.textContent),ok=!topic||t.getAttribute('data-topic')===topic;
      for(var j=0;ok&&j<words.length;j++)if(hay.indexOf(words[j])<0)ok=false;
      t.hidden=!ok;if(ok)n++;
    }
    for(var k=0;k<groups.length;k++)groups[k].hidden=!groups[k].querySelector('.term:not([hidden])');
    count.textContent=n;none.hidden=n>0;
  }
  q.addEventListener('input',apply);
  for(var i=0;i<chips.length;i++)chips[i].addEventListener('click',function(){
    topic=this.getAttribute('data-topic');for(var c=0;c<chips.length;c++)chips[c].classList.toggle('on',chips[c]===this);apply();
  });
  function reveal(){
    var id=decodeURIComponent(location.hash.slice(1));if(!id)return;var el=document.getElementById(id);
    if(!el||!root.contains(el)||!el.closest('.terms'))return;
    if(el.hidden||(el.parentNode&&el.parentNode.hidden)){q.value='';topic='';for(var c=0;c<chips.length;c++)chips[c].classList.toggle('on',!chips[c].getAttribute('data-topic'));apply();el.scrollIntoView();}
    if(el.classList.contains('term')){el.classList.add('hit');setTimeout(function(){el.classList.remove('hit');},2000);}
  }
  window.addEventListener('hashchange',reveal);reveal();
})();`;

/** Stylesheet; Tokens wie die Branchenseiten (Inter, Rot #ff0002, eckige Kanten, Hellgrau-Abschnitte) */
const GLOSSARY_CSS = `
:root{--red:#ff0002;--red-d:#d10002;--ink:#131313;--text:#2b2b2b;--muted:#6b6b6a;--line:#e3e3e3;--bg-grey:#f4f4f4;--ok:#1e8e3e;--warn:#9a5b00;--wrap:1400px;--gutter:20px}
*{box-sizing:border-box}
body{margin:0;font:15px/1.6 Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--text);background:#fff;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:var(--wrap);margin:0 auto;padding:0 var(--gutter)}
h1,h2,h3,h4{color:var(--ink);line-height:1.25;margin:0}
h1{font-size:36px;font-weight:800;letter-spacing:-.015em;margin:8px 0 14px;max-width:24ch}
h2{font-size:28px;font-weight:700;letter-spacing:-.01em;margin:6px 0 8px}
h3{font-size:18px;font-weight:700}
h4{font-size:16px;font-weight:700}
p{margin:0 0 8px}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--red)}
.sec{padding:56px 0}
.sec-grey{background:var(--bg-grey)}
.sub{color:var(--muted);max-width:68ch;margin-bottom:24px}
.btn{display:inline-flex;align-items:center;border:0;background:var(--red);color:#fff;font:inherit;font-weight:600;font-size:14px;padding:13px 20px;text-decoration:none;border-radius:0;align-self:flex-start}
.btn:hover{background:var(--red-d);color:#fff}
.hero{background:var(--bg-grey);padding:48px 0 40px;border-bottom:1px solid var(--line)}
.lead{font-size:17px;max-width:70ch;color:var(--text)}
.toc{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.toc a{background:#fff;border:1px solid var(--line);padding:9px 14px;font-weight:600;font-size:14px;text-decoration:none;color:var(--ink)}
.toc a:hover{border-color:var(--ink)}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.card{border:1px solid var(--line);padding:20px;display:flex;flex-direction:column;background:#fff}
.card .sys{color:var(--red);font-weight:600;font-size:14px;margin:4px 0 8px}
.card .links{margin-top:auto;display:flex;flex-wrap:wrap;gap:6px 16px;padding-top:6px}
.card .links a,.more a{font-weight:600;font-size:14px;text-decoration:none;border-bottom:1.5px solid var(--red);color:var(--ink)}
.card .links a:hover,.more a:hover{color:var(--red)}
.vs-jump{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}
.vs-jump a{font-size:13px;font-weight:600;text-decoration:none;background:#fff;border:1px solid var(--line);padding:6px 10px;color:var(--ink)}
.vs-jump a:hover{border-color:var(--ink)}
.vs{background:#fff;border:1px solid var(--line);padding:24px;margin:0 0 16px;scroll-margin-top:90px}
.vs .intro{color:var(--muted);margin:6px 0 14px}
.sides{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.side{border-top:3px solid var(--ink);padding-top:12px}
.side .lbl{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:10px 0 4px}
.side ul{list-style:none;margin:0;padding:0}
.side li{position:relative;padding-left:22px;margin:3px 0}
.side .plus li::before{content:"+";position:absolute;left:2px;top:-1px;font-weight:800;color:var(--ok)}
.side .minus li::before{content:"–";position:absolute;left:2px;top:-1px;font-weight:800;color:var(--warn)}
.side .fit{background:var(--bg-grey);padding:8px 10px;font-size:14px;font-weight:600;margin-top:12px}
.tools{position:sticky;top:0;z-index:5;background:#fff;padding:12px 0;border-bottom:1px solid var(--line);margin-bottom:8px}
.search{display:block;max-width:460px}
.search input{width:100%;font:inherit;font-size:15px;padding:11px 14px;border:1px solid #bdbdbd;border-radius:0;background:#fff;color:var(--ink)}
.search input:focus{outline:2px solid var(--ink);outline-offset:1px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.az{display:flex;flex-wrap:wrap;gap:4px;margin:10px 0}
.az a,.az span{display:inline-block;min-width:30px;text-align:center;padding:4px 0;border:1px solid var(--line);font-weight:700;font-size:13px;text-decoration:none;color:var(--ink)}
.az a:hover{border-color:var(--ink)}
.az span{color:#c4c4c4;border-color:#f0f0f0}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font:inherit;font-size:13px;font-weight:600;border:1.5px solid var(--ink);background:#fff;color:var(--ink);padding:5px 12px;cursor:pointer;border-radius:0}
.chip.on{background:var(--ink);color:#fff}
.count{font-size:13px;color:var(--muted);margin:8px 0 0}
.letter{scroll-margin-top:200px}
.letter .l{font-size:28px;color:var(--red);border-bottom:2px solid var(--ink);padding:24px 0 4px;margin-bottom:4px}
.term{padding:14px 0;border-bottom:1px solid var(--line);scroll-margin-top:200px;transition:background .4s}
.term.hit{background:#fff4c2}
.term h4 a{text-decoration:none}
.term .kat{font-size:12px;font-weight:600;color:var(--muted);margin-left:10px;white-space:nowrap}
.term p{max-width:80ch}
.term .ex{font-size:14px;background:var(--bg-grey);padding:8px 10px}
.term .aka{font-size:13px;color:var(--muted)}
.term a.ref{text-decoration:none;border-bottom:1px dotted var(--ink);color:var(--ink)}
.term a.ref:hover{color:var(--red);border-color:var(--red)}
.src{font-size:12px;color:#8a6d00;background:#fff4c2;padding:2px 6px;display:inline-block}
.none{margin-top:16px;font-weight:600}
.advice{display:grid;grid-template-columns:1.2fr 1fr;background:var(--ink);color:#d8d8d8}
.advice .l{padding:40px}
.advice h2{color:#fff}
.advice a{color:#fff}
.advice .r{background:#1f1f1f;padding:40px;display:flex;flex-direction:column;gap:12px;justify-content:center}
.advice .tel{font-size:30px;font-weight:800;color:#fff;text-decoration:none}
@media (max-width:900px){.cards{grid-template-columns:1fr 1fr}.advice{grid-template-columns:1fr}}
@media (max-width:640px){
  h1{font-size:28px}h2{font-size:23px}.sec{padding:40px 0}.hero{padding:32px 0}
  .cards,.sides{grid-template-columns:1fr}.vs{padding:16px}
  .advice .l,.advice .r{padding:24px}.tools{position:static}
}
`;

/** Korrekturen gegen das Shop-Theme (1rem = 10px, Bootstrap-Zeile mit negativen Rändern) */
const SHOP_CSS = `
.mlx{font-size:15px;line-height:1.6;color:var(--text)}
.mlx h1,.mlx h2,.mlx h3,.mlx h4{font-family:inherit;text-transform:none}
.mlx ul{margin-bottom:0}
.mlx [hidden]{display:none!important}
.cms-block-container-row:has(> .col-12 > .cms-element-html > .mlx){margin-left:0;margin-right:0}
.cms-block-container-row:has(> .col-12 > .cms-element-html > .mlx) > .col-12{padding-left:0;padding-right:0}
`;

export function glossaryCss(scope?: string): string {
  return scope ? scopeCss(GLOSSARY_CSS, scope) + SHOP_CSS : GLOSSARY_CSS;
}

/** Fertiges HTML für das HTML-Element der Erlebniswelt */
export function glossaryShopHtml(o: GlossaryHtmlOptions): string {
  return `<style>${glossaryCss(".mlx")}</style><div class="mlx">${glossaryBodyHtml(o)}</div>${glossaryJsonLd(o)}<script>${GLOSSARY_SCRIPT}</script>`;
}

/** Eigenständige Entwurfsseite (Export) */
export function glossaryDraftHtml(o: GlossaryHtmlOptions & { title?: string }): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title ?? GLOSSARY_PAGE.name)}</title><style>${glossaryCss()}</style></head>
<body><div class="mlx">${glossaryBodyHtml(o)}</div>${glossaryJsonLd(o)}<script>${GLOSSARY_SCRIPT}</script></body></html>`;
}
