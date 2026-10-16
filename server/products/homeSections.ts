// Startseiten-Abschnitte „Rabattstaffel“ und „B2B-Zahlung mit Mondu“ im Design der Branchenseiten.
// Sie ersetzen den Inhalt der bestehenden HTML-Elemente (gleiche Abschnitte, gleiche Position).
// Inhalte nur belegt (User-Regel 15.10.2026), Stand Shop 16.10.2026:
// - Rabattstaffel: Aktionen „ab 5000/8000/10000 Euro“ ohne Code, Warenwert 5.000–7.999,99 / 8.000–9.999,99 / ab 10.000 €,
//   nur Kanal META Regalbau DE; „ab 5000 Euro“ zusaetzlich nur bei Rechnungsadresse Deutschland.
// - Mondu: im DE-Kanal aktiv: Rechnungskauf (30 Tage), SEPA-Lastschrift (30 Tage), Ratenkauf (3, 6, 12 Monaten),
//   Echtzeitüberweisung; dazu PayPal und Kredit-/Debitkarte. In AT und PL gibt es Mondu nicht.
import type { HomeMondu, HomeRabatt } from "@shared/shopContent";
import { esc, industryPageCss, scopeCss } from "./industryPageHtml";

/** Bestehende Abschnitte der Startseite (gleiche IDs in Live und Testshop). */
export const HOME_SECTION_IDS = {
  rabatt: "019a7c31292170f582ad3b1fc1457db3",
  mondu: "019c3cd94e8370958d5f8817d7ecae36",
} as const;

/** Erkennung: alter Agentur-Inhalt bzw. bereits von hier geschrieben */
export const HOME_SECTION_MARKERS = {
  rabatt: { old: /meta-discount-banner/, own: 'data-mbp="rabatt"' },
  mondu: { old: /sw-landing[\s\S]*Mondu/i, own: 'data-mbp="mondu"' },
} as const;

export const RABATT: HomeRabatt = {
  eyebrow: "Rabattstaffel",
  title: "Mehr bestellen, mehr sparen",
  intro: "Ab 5.000 € Warenwert ziehen wir den Rabatt automatisch im Warenkorb ab – ganz ohne Rabattcode.",
  tiers: [
    { pct: "5 %", from: "ab 5.000 € Warenwert", range: "bis 7.999,99 €" },
    { pct: "8 %", from: "ab 8.000 € Warenwert", range: "bis 9.999,99 €" },
    { pct: "10 %", from: "ab 10.000 € Warenwert", range: "für große Anlagen" },
  ],
  note: "Gilt im META Onlineshop Deutschland für Bestellungen mit Rechnungsadresse in Deutschland. Der Rabatt erscheint automatisch im Warenkorb und im Checkout.",
};

export const MONDU: HomeMondu = {
  eyebrow: "Bezahlen für Geschäftskunden",
  title: "B2B-Zahlung leicht gemacht",
  intro: "Gemeinsam mit unserem Partner Mondu bieten wir Geschäftskunden Zahlarten mit Zahlungsziel – direkt im Checkout auswählbar.",
  methods: [
    { name: "Rechnungskauf", fact: "30 Tage Zahlungsziel" },
    { name: "SEPA-Lastschrift", fact: "30 Tage Zahlungsziel" },
    { name: "Ratenkauf", fact: "in 3, 6 oder 12 Monaten" },
    { name: "Echtzeitüberweisung", fact: "sofort per Online-Banking" },
  ],
  faq: [
    { q: "Wie bezahle ich als Geschäftskunde?", a: "Wählen Sie im Checkout eine der Mondu-Zahlarten: Rechnungskauf, SEPA-Lastschrift, Ratenkauf oder Echtzeitüberweisung." },
    { q: "Welche Vorteile habe ich?", a: "Beim Rechnungskauf und bei der SEPA-Lastschrift zahlen Sie erst nach 30 Tagen. Mit dem Ratenkauf verteilen Sie größere Anschaffungen auf 3, 6 oder 12 Monate." },
    { q: "Wer kann die Zahlarten nutzen?", a: "Die Zahlarten richten sich an Geschäftskunden. Mondu prüft im Checkout, welche Zahlarten für Ihr Unternehmen zur Verfügung stehen." },
  ],
  footer: ["In Zusammenarbeit mit Mondu", "Außerdem möglich: PayPal und Kredit-/Debitkarte", "Sicher einkaufen dank SSL"],
};

/** Zusaetzliches Stylesheet der beiden Abschnitte (innerhalb von .mbp). */
const HOME_CSS = `
.rb{padding:56px 0;background:#fff}
.rb-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.rb-tier{border:1px solid var(--line);border-top:4px solid var(--red);padding:22px 22px 20px;display:flex;flex-direction:column;gap:4px;background:#fff}
.rb-tier strong{font-size:44px;font-weight:800;color:var(--red);letter-spacing:-.02em;line-height:1}
.rb-tier .from{font-size:16px;font-weight:700;color:var(--ink);margin-top:8px}
.rb-tier .range{font-size:13px;color:var(--muted)}
.rb-tier.top{background:var(--ink);border-color:var(--ink);border-top-color:var(--red)}
.rb-tier.top .from{color:#fff}
.rb-tier.top .range{color:#bdbdbd}
.rb-note{font-size:12.5px;color:var(--muted);margin:14px 0 0;max-width:none}
.pay{padding:56px 0;background:var(--bg-grey)}
.pay-methods{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:1px solid var(--line);border-left:1px solid var(--line);background:#fff}
.pay-methods div{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:18px 18px 16px;display:flex;flex-direction:column;gap:4px;min-width:0}
.pay-methods strong{color:var(--ink);font-size:16px}
.pay-methods span{font-size:13.5px;color:var(--muted)}
.pay-methods svg{width:30px;height:30px;stroke:var(--red);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;margin-bottom:6px}
.pay-faq{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:28px}
.pay-faq h3{font-size:15.5px;margin:0 0 6px}
.pay-faq p{font-size:14px;color:#444;margin:0}
.pay-foot{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:26px;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
.pay-foot span::before{content:"";display:inline-block;width:6px;height:6px;background:var(--red);margin-right:8px;vertical-align:2px}
@media (max-width:1100px){.pay-methods{grid-template-columns:repeat(2,1fr)}}
@media (max-width:760px){.rb,.pay{padding:40px 0}.rb-grid{grid-template-columns:1fr;gap:10px}.rb-tier{flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:4px 14px;padding:16px}.rb-tier strong{font-size:34px}.rb-tier .from{margin-top:0}.rb-tier .range{flex-basis:100%}.pay-methods{grid-template-columns:1fr}.pay-methods div{padding:12px 14px;display:grid;grid-template-columns:30px 1fr;column-gap:12px;row-gap:0;align-items:center}.pay-methods svg{grid-row:span 2;margin:0}.pay-faq{grid-template-columns:1fr;gap:18px}}
`;

const PAY_ICONS = [
  '<rect x="8" y="5" width="24" height="30"/><path d="M13 13h14M13 19h14M13 25h8"/>',
  '<rect x="5" y="10" width="30" height="20"/><path d="M5 16h30M10 25h8"/>',
  '<rect x="6" y="9" width="28" height="25"/><path d="M6 16h28M13 5v7M27 5v7M12 23h4M20 23h4M12 29h4"/>',
  '<path d="M22 4L8 22h11l-3 14 16-20H21z"/>',
];

const style = (scope: string) => `<style>${industryPageCss(scope)}\n${scopeCss(HOME_CSS, scope)}</style>`;

/** `r`: Inhalt aus der Pflegeoberflaeche (Shop-Inhalte), Standard = Ausgangsdaten oben */
export function rabattSectionHtml(scope = ".mbp", r: HomeRabatt = RABATT): string {
  const tiers = r.tiers
    .map((t, i) => `<div class="rb-tier${i === r.tiers.length - 1 ? " top" : ""}"><strong>${esc(t.pct)}</strong><span class="from">${esc(t.from)}</span><span class="range">${esc(t.range)}</span></div>`)
    .join("");
  return `${style(scope)}<div class="${scope.slice(1)}" data-mbp="rabatt"><section class="rb"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">${esc(r.eyebrow)}</span><h2>${esc(r.title)}</h2><p>${esc(r.intro)}</p></div></div>
  <div class="rb-grid">${tiers}</div>
  <p class="rb-note">${esc(r.note)}</p>
</div></section></div>`;
}

export function monduSectionHtml(scope = ".mbp", m: HomeMondu = MONDU): string {
  const methods = m.methods.map((x, i) => `<div><svg viewBox="0 0 40 40" aria-hidden="true">${PAY_ICONS[i % PAY_ICONS.length]}</svg><strong>${esc(x.name)}</strong><span>${esc(x.fact)}</span></div>`).join("");
  const faq = m.faq.map((f) => `<div><h3>${esc(f.q)}</h3><p>${esc(f.a)}</p></div>`).join("");
  return `${style(scope)}<div class="${scope.slice(1)}" data-mbp="mondu"><section class="pay"><div class="wrap">
  <div class="sec-head"><div><span class="eyebrow">${esc(m.eyebrow)}</span><h2>${esc(m.title)}</h2><p>${esc(m.intro)}</p></div></div>
  <div class="pay-methods">${methods}</div>
  <div class="pay-faq">${faq}</div>
  <div class="pay-foot">${m.footer.map((f) => `<span>${esc(f)}</span>`).join("")}</div>
</div></section></div>`;
}
