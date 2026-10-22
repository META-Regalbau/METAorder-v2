// Header der Startseite (Bühne ganz oben) mit mehreren Handlungsaufrufen, im Design der Branchenseiten.
// Ersetzt im DE-Shop den Agentur-Slider („META Regale – Fachbodenregale kaufen“), AT und PL behalten ihn.
// Inhalte nur belegt (User-Regel 15.10.2026), Stand Shop 22.10.2026:
// - Schnellkonfigurator /regal-schnellkonfigurator: Regalart, Maße, maximale Regallänge → Regalzeile mit Preis in den Warenkorb
// - Kategorien und Adressen aus dem Hauptmenü des DE-Shops
// - Telefon und Zeiten wie Beratungskachel der Branchenseiten (CONTACT)
// - „Nur B2B Verkauf“ aus der Vorteilsleiste des Shops
import { CONTACT } from "./industryPages";
import { esc, industryPageCss, scopeCss } from "./industryPageHtml";
import type { IndustryContact } from "@shared/shopContent";

/** Kennzeichen der eigenen Fassung im Shop-HTML (Schreibskript, Prüfung) */
export const HOME_HERO_MARKER = 'data-mbp="hero"';

/** Bild des bisherigen Sliders (Medium im Shop, gleiche ID in Live und Testshop) */
export const HOME_HERO_IMAGE_ALT = "META Fachbodenregal mit Fachteilern";

export type HomeHero = {
  eyebrow: string;
  title: string;
  lead: string;
  primary: { label: string; href: string };
  secondary: { label: string };
  categories: { label: string; intro: string; links: Array<{ label: string; href: string }> };
  more: { label: string; href: string };
};

export const HOME_HERO: HomeHero = {
  eyebrow: "Regalsysteme vom Hersteller",
  title: "Regale für Lager, Betrieb und Büro",
  lead: "Fachboden-, Paletten-, Kragarm-, Weitspann- und Büroregale von META – direkt online bestellen. Für Geschäftskunden.",
  primary: {
    label: "Regal konfigurieren",
    href: "/regal-schnellkonfigurator",
  },
  secondary: { label: "Beratung" },
  categories: {
    label: "Regalarten",
    intro: "Direkt zum Sortiment",
    links: [
      { label: "Fachbodenregale", href: "/fachbodenregale/" },
      { label: "Palettenregale", href: "/palettenregale/" },
      { label: "Kragarmregale", href: "/kragarmregale/" },
      { label: "Weitspannregale", href: "/weitspannregale/" },
      { label: "Büroregale", href: "/bueroregale" },
      { label: "Zubehör", href: "/zubehoer" },
    ],
  },
  more: { label: "Regal-Lexikon", href: "/regal-lexikon" },
};

const HERO_CSS = `
.hh{position:relative;background:#fcfcfc;overflow:hidden;border-bottom:1px solid var(--line)}
.hh-bg{position:absolute;inset:0;width:100%;height:100%!important;max-width:none!important;object-fit:cover;object-position:right center}
.hh::before{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(90deg,#fcfcfc 0,#fcfcfc 38%,rgba(252,252,252,.85) 52%,rgba(252,252,252,0) 68%)}
.hh-inner{position:relative;z-index:2;min-height:420px;display:flex;flex-direction:column;justify-content:center}
.hh-text{max-width:600px;padding:48px 0 40px}
.hh-title{font-size:46px;font-weight:800;letter-spacing:-.02em;line-height:1.08;margin:12px 0 16px}
.hh-lead{font-size:17px;line-height:1.55;color:#3a3a3a;margin:0 0 26px;max-width:52ch}
.hh-cta{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch}
.hh-cta .btn{font-size:15px;padding:15px 22px}
.hh-cta svg{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.hh-tel{display:inline-flex;align-items:center;gap:10px;padding:8px 18px 8px 14px;background:#fff;box-shadow:inset 0 0 0 1.5px var(--ink);color:var(--ink);text-decoration:none;line-height:1.25;transition:background .15s,color .15s}
.hh-tel:hover{background:var(--ink);color:#fff}
.hh-tel span{display:flex;flex-direction:column}
.hh-tel strong{font-size:15px;font-weight:700}
.hh-tel small{font-size:12px;opacity:.75}
.hh-cats{position:relative;z-index:2;background:#fff;border-top:1px solid var(--line)}
.hh-cats .wrap{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;padding-top:14px;padding-bottom:14px}
.hh-cats b{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-right:6px}
.hh-cats a{font-size:14px;font-weight:600;color:var(--ink);text-decoration:none;padding:7px 14px;border:1px solid var(--line);background:#fff;transition:border-color .15s,color .15s}
.hh-cats a:hover{border-color:var(--red);color:var(--red)}
.hh-cats a.hh-more{border-color:transparent;padding-left:4px;margin-left:auto;border-bottom:1.5px solid var(--red);padding:2px 0 1px}
.hh-cats a.hh-more:hover{color:var(--red)}
@media (max-width:1100px){.hh::before{background:linear-gradient(90deg,#fcfcfc 0,#fcfcfc 50%,rgba(252,252,252,.7) 70%,rgba(252,252,252,.2) 100%)}.hh-title{font-size:38px}.hh-cats b{display:none}}
@media (max-width:760px){
.hh-bg{object-position:70% center}
.hh::before{background:rgba(252,252,252,.86)}
.hh-inner{min-height:0}
.hh-text{padding:28px 0}
.hh-title{font-size:29px;margin:8px 0 10px}
.hh-lead{font-size:15.5px;margin-bottom:18px}
.hh-cta{flex-direction:column}
.hh-cta .btn,.hh-tel{justify-content:center;width:100%}
.hh-cats .wrap{flex-wrap:nowrap;overflow-x:auto;padding-top:12px;padding-bottom:12px;-webkit-overflow-scrolling:touch}
.hh-cats a{white-space:nowrap;flex:none}
.hh-cats b{display:none}
.hh-cats a.hh-more{margin-left:4px}
}
`;

const ICON_CONFIG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V4M20 20V4M4 9h16M4 15h16"/></svg>';
const ICON_PHONE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>';

/**
 * `image`: Adresse des Hintergrundbilds (Fachbodenregal rechts, links freie helle Fläche) oder null.
 * `h` Inhalt, `contact` Telefon/Zeiten; Standard = Ausgangsdaten oben.
 */
export function homeHeroHtml(image: string | null, scope = ".mbp", h: HomeHero = HOME_HERO, contact: IndustryContact = CONTACT): string {
  const cats = h.categories.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("");
  return `<style>${industryPageCss(scope)}\n${scopeCss(HERO_CSS, scope)}</style><div class="${scope.slice(1)}" ${HOME_HERO_MARKER}><section class="hh">
  ${image ? `<img class="hh-bg" src="${esc(image)}" alt="${esc(HOME_HERO_IMAGE_ALT)}" fetchpriority="high">` : ""}
  <div class="wrap hh-inner"><div class="hh-text">
    <span class="eyebrow">${esc(h.eyebrow)}</span>
    <h2 class="hh-title">${esc(h.title)}</h2>
    <p class="hh-lead">${esc(h.lead)}</p>
    <div class="hh-cta">
      <a class="btn" href="${esc(h.primary.href)}">${ICON_CONFIG}${esc(h.primary.label)}</a>
      <a class="hh-tel" href="tel:${esc(contact.tel)}">${ICON_PHONE}<span><strong>${esc(h.secondary.label)} ${esc(contact.phone)}</strong><small>Mo–Fr ${esc(contact.hours.replace(/ bis /, "–"))}</small></span></a>
    </div>
  </div></div>
  <nav class="hh-cats" aria-label="${esc(h.categories.label)}"><div class="wrap"><b>${esc(h.categories.intro)}</b>${cats}<a class="hh-more" href="${esc(h.more.href)}">${esc(h.more.label)} →</a></div></nav>
</section></div>`;
}
