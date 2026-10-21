/**
 * Portal-Neuigkeiten: HTML der Erlebniswelt (ein HTML-Block, wie die Service-Seiten). Alle Texte stammen
 * aus Mails bzw. der KI und werden deshalb durchgehend maskiert. CSS in px (Theme: 1rem = 10px), eigener
 * Bereich .mon, damit nichts ins Portal-Theme ausläuft.
 */
import type { PortalNewsContent } from "@shared/portalNews";

/** So viele Beiträge stehen offen da; ältere klappen unter „Ältere Neuigkeiten“ zusammen */
export const OPEN_POSTS = 8;

export type PortalNewsPagePost = PortalNewsContent & { id: string };

export function escapeHtml(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** „2026-10-21“ → „21. Oktober 2026“ */
export function formatNewsDate(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  return `${Number(m[3])}. ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export const PORTAL_NEWS_CSS = `
.mon{--ink:#131313;--red:#ff0002;--line:#e6e6e6;--muted:#6b6b6b;--soft:#f5f5f5;color:var(--ink);font-size:15px;line-height:1.55;max-width:880px;margin:0 auto;padding:24px 0 48px}
.mon *{box-sizing:border-box}
.mon-head{border-bottom:3px solid var(--ink);padding-bottom:16px;margin-bottom:8px}
.mon-head h1{font-size:32px;font-weight:800;letter-spacing:-.01em;margin:0 0 8px;line-height:1.2}
.mon-head p{margin:0;color:var(--muted);max-width:70ch}
.mon-post{display:grid;grid-template-columns:150px 1fr;gap:8px 28px;padding:24px 0;border-bottom:1px solid var(--line)}
.mon-date{font-size:13px;font-weight:700;color:var(--muted);padding-top:4px;white-space:nowrap}
.mon-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;padding:0;list-style:none}
.mon-tags li{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:var(--soft);border-left:3px solid var(--red);padding:2px 8px}
.mon-post h2{font-size:21px;font-weight:800;margin:0 0 6px;line-height:1.3}
.mon-sum{margin:0 0 12px;color:#3a3a3a}
.mon-post h3{font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;margin:14px 0 6px}
.mon-post ul.mon-items{margin:0;padding:0 0 0 18px}
.mon-post ul.mon-items li{margin:0 0 5px}
.mon-older{margin-top:24px}
.mon-older summary{cursor:pointer;font-weight:800;font-size:15px;padding:12px 0;border-bottom:1px solid var(--line)}
.mon-empty{padding:32px 0;color:var(--muted)}
@media (max-width:767px){.mon{padding:16px 0 32px}.mon-head h1{font-size:26px}.mon-post{grid-template-columns:1fr;gap:4px}.mon-post h2{font-size:19px}}
`;

function postHtml(post: PortalNewsPagePost): string {
  const tags = post.tags.length ? `<ul class="mon-tags">${post.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : "";
  const sections = post.sections
    .map(
      (s) =>
        `${s.heading ? `<h3>${escapeHtml(s.heading)}</h3>` : ""}<ul class="mon-items">${s.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`,
    )
    .join("");
  return `<article class="mon-post" id="neuigkeit-${escapeHtml(post.id.slice(0, 8))}"><time class="mon-date" datetime="${escapeHtml(post.postDate)}">${escapeHtml(formatNewsDate(post.postDate))}</time><div>${tags}<h2>${escapeHtml(post.title)}</h2>${post.summary ? `<p class="mon-sum">${escapeHtml(post.summary)}</p>` : ""}${sections}</div></article>`;
}

/** Ganze Seite: Kopf, neueste Beiträge offen, ältere zusammengeklappt. Beiträge kommen schon sortiert (neueste zuerst). */
export function portalNewsPageHtml(params: { title: string; intro: string; posts: PortalNewsPagePost[] }): string {
  const open = params.posts.slice(0, OPEN_POSTS);
  const older = params.posts.slice(OPEN_POSTS);
  const body = params.posts.length
    ? open.map(postHtml).join("") +
      (older.length
        ? `<details class="mon-older"><summary>Ältere Neuigkeiten (${older.length})</summary>${older.map(postHtml).join("")}</details>`
        : "")
    : `<p class="mon-empty">Noch keine Neuigkeiten.</p>`;
  return `<style>${PORTAL_NEWS_CSS}</style><div class="mon" data-mon="portal-news"><header class="mon-head"><h1>${escapeHtml(params.title)}</h1>${
    params.intro ? `<p>${escapeHtml(params.intro)}</p>` : ""
  }</header>${body}</div>`;
}
