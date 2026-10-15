// HTML fuer die Kategorie-Zusatzfelder (meta_category_intro/seo_text/faq/sidebar). Nur Bootstrap-Klassen
// des Shop-Themes: eigenes CSS ist ohne Agentur nicht moeglich, <details> filtert Shopware heraus.
export const CATEGORY_CONTENT_FIELDS = {
  intro: "meta_category_intro",
  seoText: "meta_category_seo_text",
  faq: "meta_category_faq",
  sidebar: "meta_category_sidebar",
} as const;

export const BERATUNG_PHONE = { display: "02932 957-0", tel: "+492932957 0".replace(/\s/g, ""), hours: "8:15 bis 16:30 Uhr" };

export type CategoryLink = { label: string; url: string };

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Einleitung im hellen Kasten, Vorteile als Pillen, Schnelllinks als kleine Knoepfe. */
export function introHtml(introParagraphHtml: string, badges: string[], related: CategoryLink[]): string {
  // Desktop: Pillen; Handy: eine kompakte Zeile, damit die Produkte nicht nach unten rutschen
  const badgeHtml = badges.length
    ? `<div class="d-none d-md-flex flex-wrap gap-2 mb-3">${badges.map((b) => `<span class="d-inline-flex align-items-center bg-white border rounded-pill px-3 py-1"><strong class="text-success me-2">✓</strong>${esc(b)}</span>`).join("")}</div>` +
      `<p class="d-md-none small mb-3">${badges.map((b) => `<strong class="text-success">✓</strong> ${esc(b)}`).join(" &nbsp;")}</p>`
    : "";
  const relatedHtml = related.length
    ? `<div class="d-flex flex-wrap align-items-center gap-2"><span class="text-muted me-1">Passend dazu:</span>${related
        .map((l) => `<a class="btn btn-sm btn-outline-dark rounded-pill px-3" href="${esc(l.url)}">${esc(l.label)}</a>`)
        .join("")}</div>`
    : "";
  const lead = introParagraphHtml.replace(/^<p>/, '<p class="fs-6 mb-3">');
  return `<div class="bg-light rounded-3 p-3 p-md-4 mb-3">${lead}${badgeHtml}${relatedHtml}</div>`;
}

/** SEO-Text/FAQ: Theme-Klassen fuer Ueberschriften, Tabelle und FAQ-Kaesten. */
export function styleSeoHtml(html: string): string {
  return html
    .replace(/<table>/g, '<table class="table table-sm table-striped mb-4">')
    .replace(/<th>/g, '<th scope="row" class="w-25">')
    .replace(/<h2>/g, '<h2 class="h4 mt-4 mb-2">');
}

export function faqHtmlBoxes(items: Array<{ q: string; a: string }>): string {
  return (
    `<h2 class="h4 mt-4 mb-3">Häufige Fragen</h2>` +
    items
      .map((x) => `<div class="border rounded-3 px-3 py-2 mb-2"><h3 class="fs-6 fw-bold mb-1">${esc(x.q)}</h3><p class="mb-1">${esc(x.a)}</p></div>`)
      .join("")
  );
}

/** Seitenleiste unter den Filtern: Passend dazu, Downloads, Beratung mit Telefon. */
export function sidebarHtml(related: CategoryLink[], downloads: CategoryLink[]): string {
  const list = (items: CategoryLink[], prefix: string) =>
    `<ul class="list-unstyled mb-0">${items
      .map((l, i) => `<li class="py-2${i < items.length - 1 ? " border-bottom" : ""}"><a class="text-decoration-none text-dark" href="${esc(l.url)}">${prefix} ${esc(l.label)}</a></li>`)
      .join("")}</ul>`;
  const box = (title: string, body: string, extra = "") => `<div class="border rounded-3 p-3 mb-3${extra}"><div class="fw-bold mb-2">${title}</div>${body}</div>`;
  return (
    (related.length ? box("Passend dazu", list(related, "›")) : "") +
    (downloads.length ? box("Downloads", list(downloads, "↓")) : "") +
    `<div class="rounded-3 p-3 mb-3 bg-light"><div class="fw-bold mb-1">Beratung</div><p class="small mb-2">Sie planen eine größere Anlage? Wir beraten Sie und erstellen Ihnen gern ein Angebot.</p>` +
    `<a class="btn btn-primary w-100 mb-2" href="tel:${BERATUNG_PHONE.tel}">☎ ${BERATUNG_PHONE.display}</a><div class="small text-muted text-center">${BERATUNG_PHONE.hours}</div></div>`
  );
}
