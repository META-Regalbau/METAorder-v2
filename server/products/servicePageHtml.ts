// HTML der Service-Seiten (Montageanleitungen/Videos, Montageservice) im Design der Landingpages – gemeinsam für
// Entwurf (scripts/exportCategoryLandingPages.ts) und Shop (scripts/writeServicePages.ts). Im Shop auf `.mbp` begrenzt.
import { CONTACT } from "./industryPages";
import { esc, scopeCss } from "./industryPageHtml";
import { categoryLandingCss } from "./categoryLandingPageHtml";
import {
  MONTAGE_POINTS,
  MONTAGE_REQUEST_FIELDS,
  MONTAGE_SUBJECT,
  SERVICE_DOCUMENTS,
  SERVICE_GROUPS,
  SERVICE_PAGES,
  SERVICE_VIDEOS,
  oxomiDocumentUrl,
  type ServicePage,
} from "./servicePages";

export const SERVICE_URL = (key: ServicePage["key"]) => `/${SERVICE_PAGES.find((p) => p.key === key)!.url}`;

const ICON_PDF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l6 6v14H6z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 2v6h6" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="8" y="18" font-size="6" font-weight="700" fill="currentColor" font-family="Inter,Arial">PDF</text></svg>';

function hero(p: ServicePage, buttons: string): string {
  return `<section class="hero svc-hero"><div class="wrap">
  <span class="eyebrow">${esc(p.eyebrow)}</span>
  <h1>${esc(p.h1)}</h1>
  <p class="lead">${esc(p.lead)}</p>
  <div class="cta-row">${buttons}</div>
</div></section>`;
}

/** Seite „Montageanleitungen und Videos“ (ohne Stylesheet) */
export function instructionsPageHtml(note: (k: keyof ServicePage["notes"]) => string = () => ""): string {
  const p = SERVICE_PAGES.find((x) => x.key === "anleitungen")!;
  const jump = SERVICE_GROUPS.filter((g) => g.key !== "sicherheit").map((g) => `<a href="#${g.anchor}">${esc(g.title.replace(/^(\S+regale).*$/, "$1"))}</a>`).join("");
  const safety = SERVICE_DOCUMENTS.find((d) => d.group === "sicherheit")!;
  const groups = SERVICE_GROUPS.filter((g) => g.key !== "sicherheit")
    .map((g) => {
      const docs = SERVICE_DOCUMENTS.filter((d) => d.group === g.key);
      const vids = SERVICE_VIDEOS.filter((v) => v.group === g.key);
      if (!docs.length && !vids.length) return "";
      const docList = docs
        .map((d) => `<li><a href="${esc(oxomiDocumentUrl(d.id))}" target="_blank" rel="noopener">${ICON_PDF}<span>${esc(d.title)}</span><em>PDF öffnen</em></a></li>`)
        .join("");
      const vidList = vids
        .map(
          (v) => `<div class="vid" data-src="${esc(v.mp4)}"><div class="vid-stage"><button type="button" class="vid-play" aria-label="Video ${esc(v.title)} abspielen"><span class="tri"></span>Video abspielen</button><small>Beim Abspielen wird das Video vom Dienst OXOMI (oxomi.com) geladen.</small></div><div class="vid-meta"><strong>${esc(v.title)}</strong><span>${esc(v.duration)} min</span></div></div>`,
        )
        .join("");
      return `<section class="sec svc-group" id="${g.anchor}"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">${docs.length} Anleitung${docs.length === 1 ? "" : "en"}${vids.length ? ` · ${vids.length} Video${vids.length === 1 ? "" : "s"}` : ""}</span><h2>${esc(g.title)}</h2></div>${g.landing ? `<a class="link" href="${esc(g.landing)}">Zur Regalart →</a>` : ""}</div>
  ${docs.length ? `<ul class="docs-list">${docList}</ul>` : ""}
  ${vids.length ? `<h3 class="sub-h vids-h">Montagevideos</h3><div class="vids">${vidList}</div>` : ""}
</div></section>`;
    })
    .join("\n");
  return `${hero(p, `<a class="btn" href="#sicherheit">Zuerst: Sicherheitshinweise</a><a class="btn ghost" href="${SERVICE_URL("montageservice")}">Montageservice anfragen</a>`)}
<nav class="jump" aria-label="Regalarten"><div class="wrap">${jump}<a class="cta" href="${SERVICE_URL("montageservice")}">Montageservice</a></div></nav>
${note("hero")}
<section class="sec sec-grey" id="sicherheit"><div class="wrap">
  <div class="safety">
    <div><span class="eyebrow">Vor dem Aufbau lesen</span><h2>Sicherheitshinweise</h2>
    <p>Die Sicherheitshinweise liegen jeder Lieferung bei und gelten für alle META-Regale: Lieferumfang anhand des Lieferscheins prüfen, während der Montage gegen Kippen sichern, erst nach vollständiger Montage beladen, Typenschild gut sichtbar anbringen.</p></div>
    <a class="btn" href="${esc(oxomiDocumentUrl(safety.id))}" target="_blank" rel="noopener">${esc(safety.title)} (PDF)</a>
  </div>
  ${note("list")}
</div></section>
${groups}
${note("videos")}
<section class="sec" id="beratung"><div class="wrap">
  <div class="advice">
    <div class="l"><span class="eyebrow">Lieber aufbauen lassen?</span><h2>Der META-Montageservice baut Ihre Regale auf</h2><p>Geschulte Montageteams installieren Ihre Lagereinrichtung – von kleineren Regalzeilen bis hin zu Großprojekten.</p>
      <a class="btn white" href="${SERVICE_URL("montageservice")}" style="margin-top:12px">Montageservice anfragen</a></div>
    <div class="r"><a class="tel" href="tel:${esc(CONTACT.tel)}">${esc(CONTACT.phone)}</a><small>Montag bis Freitag, ${esc(CONTACT.hours)}</small></div>
  </div>
</div></section>
${note("menu")}`;
}

/** Seite „Montageservice“: Teil über dem Formular (ohne Stylesheet) */
export function montageServiceTopHtml(note: (k: keyof ServicePage["notes"]) => string = () => ""): string {
  const p = SERVICE_PAGES.find((x) => x.key === "montageservice")!;
  const points = MONTAGE_POINTS.map((x) => `<div><strong>${esc(x.title)}</strong><span>${esc(x.text)}</span></div>`).join("");
  return `${hero(p, `<a class="btn" href="#anfrage">Jetzt anfragen</a><a class="btn ghost" href="${SERVICE_URL("anleitungen")}">Lieber selbst aufbauen: Anleitungen</a>`)}
${note("hero")}
<section class="sec sec-grey"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">Ihr Projekt im Full Service</span><h2>Das übernimmt META für Sie</h2></div></div>
  <div class="why why3">${points}</div>
</div></section>
<section class="sec" id="anfrage"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">Anfrage</span><h2>Montageservice anfragen</h2><p>Schreiben Sie uns, was aufgebaut werden soll. Wir melden uns und stimmen Umfang und Termin mit Ihnen ab.</p></div></div>
  <div class="req-help"><strong>Diese Angaben helfen uns weiter:</strong><ul>${MONTAGE_REQUEST_FIELDS.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
  ${note("form")}
</div></section>`;
}

/** Seite „Montageservice“: Teil unter dem Formular (ohne Stylesheet) */
export function montageServiceBottomHtml(note: (k: keyof ServicePage["notes"]) => string = () => ""): string {
  return `<section class="sec" id="beratung"><div class="wrap">
  <div class="advice">
    <div class="l"><span class="eyebrow">Lieber telefonisch?</span><h2>Wir beraten Sie gern</h2><p>Unser Team berät Sie zum Montageservice und zur Planung Ihrer Regalanlage.</p></div>
    <div class="r"><a class="tel" href="tel:${esc(CONTACT.tel)}">${esc(CONTACT.phone)}</a><small>Montag bis Freitag, ${esc(CONTACT.hours)}</small><a class="btn white" href="mailto:${esc(CONTACT.mail)}" style="align-self:flex-start">E-Mail an den Digital-Service</a></div>
  </div>
</div></section>
${note("menu")}`;
}

/** Videos erst auf Klick laden (2-Klick-Lösung) und das Kontaktformular für die Montageanfrage vorbelegen */
export function servicePageScript(): string {
  const template = `${MONTAGE_REQUEST_FIELDS.map((f) => `${f}: `).join("\n")}\n`;
  return `<script>(function(){
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.vid .vid-play');if(!b)return;var box=b.closest('.vid');var v=document.createElement('video');v.src=box.getAttribute('data-src');v.controls=true;v.autoplay=true;v.setAttribute('playsinline','');v.preload='auto';var st=box.querySelector('.vid-stage');st.innerHTML='';st.appendChild(v);});
function prefill(){var s=document.querySelector('form[action$="/form/contact"] [name="subject"], #form-subject');var c=document.querySelector('form[action$="/form/contact"] [name="comment"], #form-comment');if(!s&&!c)return false;if(s&&!s.value)s.value=${JSON.stringify(MONTAGE_SUBJECT)};if(c&&!c.value)c.value=${JSON.stringify(template)};return true;}
if(document.querySelector('.req-help')){if(!prefill())document.addEventListener('DOMContentLoaded',prefill);}
})();</script>`;
}

const SERVICE_CSS = `
.svc-hero{padding:28px 0 36px}
.svc-hero h1{font-size:40px;font-weight:800;letter-spacing:-.02em;margin:12px 0 14px}
.svc-hero .lead{max-width:70ch}
.safety{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;background:#fff;border-left:5px solid var(--red);padding:24px}
.safety h2{margin:6px 0 8px}
.safety p{margin:0;color:#3a3a3a;max-width:72ch}
.docs-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-top:1px solid var(--line);border-left:1px solid var(--line)}
.docs-list li{border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:#fff}
.docs-list a{display:grid;grid-template-columns:28px 1fr;gap:4px 12px;padding:16px 18px;text-decoration:none;color:var(--ink);height:100%;transition:box-shadow .15s}
.docs-list a:hover{box-shadow:inset 0 -3px 0 var(--red)}
.docs-list svg{width:28px;height:28px;color:var(--red);grid-row:span 2}
.docs-list span{font-weight:600;font-size:14.5px;line-height:1.35}
.docs-list em{font-style:normal;font-size:12.5px;color:var(--muted)}
.vids-h{margin-top:28px}
.vids{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.vid{border:1px solid var(--line);background:#fff;display:flex;flex-direction:column}
.vid-stage{aspect-ratio:16/9;background:var(--ink);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:14px;text-align:center}
.vid-stage video{width:100%;height:100%;object-fit:contain;background:#000}
.vid-play{display:inline-flex;align-items:center;gap:10px;background:var(--red);color:#fff;border:0;font:inherit;font-weight:700;font-size:14px;padding:11px 16px;cursor:pointer}
.vid-play:hover{background:var(--red-d)}
.vid-play .tri{width:0;height:0;border-left:11px solid #fff;border-top:7px solid transparent;border-bottom:7px solid transparent}
.vid-stage small{color:#bdbdbd;font-size:11.5px;max-width:34ch;line-height:1.4}
.vid-meta{padding:12px 14px;display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.vid-meta strong{font-size:14px;color:var(--ink)}
.vid-meta span{font-size:12.5px;color:var(--muted);white-space:nowrap}
.why.why3{grid-template-columns:repeat(3,1fr)}
.why.why3 div{padding:4px 22px}
.req-help{background:var(--bg-grey);padding:18px 22px;max-width:760px}
.req-help ul{margin:8px 0 0;padding-left:20px;font-size:14.5px}
.req-help li{padding:2px 0}
@media (max-width:1100px){.docs-list,.vids{grid-template-columns:repeat(2,1fr)}}
@media (max-width:760px){.svc-hero h1{font-size:28px}.safety{grid-template-columns:1fr}.docs-list,.vids,.why.why3{grid-template-columns:1fr}.why.why3 div{padding:10px 0;border-right:0;border-bottom:1px solid var(--line)}}
`;

export function servicePageCss(scope?: string): string {
  return categoryLandingCss(scope) + (scope ? scopeCss(SERVICE_CSS, scope) : SERVICE_CSS);
}

