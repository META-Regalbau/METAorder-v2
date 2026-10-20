/**
 * Kundenmails: Startvorlagen je Mailart für Brevo im Design des „META Newsletter - Master Template (DE/EN)“
 * (Brevo #10, ausgelesen am 20.10.2026): grauer Rahmen (#e8e8e8), weiße 600-px-Fläche mit roter Linie oben (#ff0002),
 * Kopf mit Logo und „at all levels“, rote Dachzeile, große Überschrift (#100e09), graue Unterzeile (#929191),
 * Fließtext (#3d3b36), roter Knopf, Infokasten auf #f5f5f5, dunkles Kontaktband, heller Fußbereich.
 * Bewusst nur Deutsch (Entscheidung 20.10.2026: zuerst DE).
 *
 * - Werbemails laufen als Kampagne: Platzhalter {{ contact.MO_… }}, Fußzeile je Rechtsgrundlage, {{ unsubscribe }}.
 * - Die Service-Mail läuft über den Transaktionsweg: {{ params.MO_… }}, ohne Werbung, ohne Abmeldelink.
 * Nicht übernommen aus dem Master: Fuß-Logo mit Platzhalter-URL, „[UNSUBSCRIBE]“, Social-Links ohne Ziel,
 * Telefonnummer +49 2931 9570 (Datenschutzerklärung: +49 2932 957-0).
 * Stellen, die in Brevo ergänzt werden müssen, tragen TEMPLATE_TODO_MARK; solange eine Vorlage ihn enthält,
 * verweigert METAorder den Versand an Kunden (sendRun).
 */
import type { CustomerMailBuildType } from "@shared/customerMails";
import { REGULAR_LETTER_MAX_ACCESSORIES, REGULAR_LETTER_MAX_ITEMS } from "./regularLetter";
import { NEW_PRODUCT_MAX, SERVICE_MAX_POSITIONS } from "./mailContent";

export const TEMPLATE_TODO_MARK = "⟦";

export const REGULAR_LETTER_TEMPLATE_NAME = "METAorder – Stammkunden-Brief";
export const REGULAR_LETTER_DEFAULT_SUBJECT = "Ihre Artikel bei META: aktuelle Preise und Lieferzeiten";

const RED = "#ff0002";
const INK = "#100e09";
const BODY = "#3d3b36";
const MUTED = "#929191";
const LINE = "#e8e8e8";
const SOFT = "#f5f5f5";
const FONT = "Arial, Helvetica, sans-serif";
const LOGO = "https://shop.meta-online.com/media/49/93/89/1717322639/META-Logo-Red-on-Transparent-RGB.png?ts=1745143432";
const SHOP = "https://shop.meta-online.com";

type Scope = "contact" | "params";

const spacer = (px: number) => `<tr><td style="height:${px}px; line-height:${px}px; font-size:0;">&nbsp;</td></tr>`;
const kicker = (text: string, color = RED) =>
  `<span style="font-family:${FONT}; font-size:11px; line-height:16px; letter-spacing:1.5px; text-transform:uppercase; font-weight:bold; color:${color};">${text}</span>`;
const section = (inner: string, top = 0) => `
  <tr>
    <td style="padding:${top}px 40px 0 40px;" class="px">
${inner}
    </td>
  </tr>`;
const table = (rows: string, style = "") => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"${style ? ` style="${style}"` : ""}>${rows}</table>`;
const text = (html: string, size = 16, color = BODY) =>
  `<tr><td style="font-family:${FONT}; font-size:${size}px; line-height:${Math.round(size * 1.5)}px; color:${color}; mso-line-height-rule:exactly;">${html}</td></tr>`;
const button = (href: string, label: string) => `<tr><td>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td bgcolor="${RED}" style="mso-padding-alt:14px 28px;"><a href="${href}" style="display:block; padding:14px 28px; font-family:${FONT}; font-size:14px; line-height:18px; font-weight:bold; color:#ffffff; text-decoration:none; letter-spacing:0.3px;">${label} &rarr;</a></td>
            </tr></table>
          </td></tr>`;

function layout(opts: { title: string; preheader: string; headerNote: string; body: string; footer: string }): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${opts.title}</title>
<style>
  body { margin:0; padding:0; width:100% !important; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  table { border-collapse:collapse !important; }
  a { color:${RED}; }
  @media only screen and (max-width:620px) {
    .wrap { width:100% !important; }
    .stack { display:block !important; width:100% !important; max-width:100% !important; }
    .px { padding-left:24px !important; padding-right:24px !important; }
    .h1 { font-size:30px !important; line-height:34px !important; }
    .h2 { font-size:22px !important; line-height:26px !important; }
    .thumb { width:64px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${LINE};">

<span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px;">${opts.preheader}</span>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${LINE};">
<tr>
<td align="center" style="padding:24px 12px;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="wrap" style="width:600px; max-width:600px; background-color:#ffffff;">

  <tr>
    <td style="padding:28px 40px 22px 40px; border-top:3px solid ${RED};" class="px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td align="left" valign="middle" width="220" style="width:220px;">
            <a href="${SHOP}"><img src="${LOGO}" width="160" height="69" alt="META" style="display:block; width:160px; height:69px; border:0; outline:none; text-decoration:none;"></a>
            <span style="display:block; font-family:${FONT}; font-size:11px; line-height:16px; color:${MUTED}; padding-top:8px;">at all levels</span>
          </td>
          <td align="right" valign="middle" style="font-family:${FONT}; font-size:11px; line-height:16px; color:${MUTED};">${opts.headerNote}</td>
        </tr>
      </table>
    </td>
  </tr>
${opts.body}
  <tr><td style="height:36px; line-height:36px; font-size:0;">&nbsp;</td></tr>

  <tr>
    <td bgcolor="${INK}" style="background-color:${INK}; padding:36px 40px;" class="px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td align="center" style="font-family:${FONT}; font-size:24px; line-height:30px; font-weight:bold; color:#ffffff; mso-line-height-rule:exactly;">Fragen? Sprechen Sie mit uns.</td></tr>
        <tr><td align="center" style="font-family:${FONT}; font-size:15px; line-height:22px; color:${MUTED}; padding-top:10px;">Antworten Sie einfach auf diese E-Mail. Wir melden uns.</td></tr>
        <tr><td align="center" style="padding-top:22px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td bgcolor="${RED}" style="mso-padding-alt:14px 30px;"><a href="${SHOP}" style="display:block; padding:14px 30px; font-family:${FONT}; font-size:14px; line-height:18px; font-weight:bold; color:#ffffff; text-decoration:none;">Zum Onlineshop &rarr;</a></td>
          </tr></table>
        </td></tr>
      </table>
    </td>
  </tr>

  <tr>
    <td bgcolor="${SOFT}" style="background-color:${SOFT}; padding:32px 40px;" class="px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td><img src="${LOGO}" width="120" height="52" alt="META" style="display:block; width:120px; height:52px; border:0; outline:none; text-decoration:none;"></td></tr>
        <tr>
          <td style="font-family:${FONT}; font-size:13px; line-height:20px; color:${BODY}; padding-top:14px;">
            META-Regalbau GmbH &amp; Co. KG<br>
            Eichenkamp &middot; 59759 Arnsberg &middot; Deutschland<br>
            T +49 2932 957-0 &middot; <a href="mailto:info@meta-online.com" style="color:${BODY}; text-decoration:underline;">info@meta-online.com</a> &middot; <a href="${SHOP}" style="color:${BODY}; text-decoration:underline;">shop.meta-online.com</a>
          </td>
        </tr>
        <tr><td style="height:20px; line-height:20px; font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="border-top:1px solid ${LINE}; padding-top:18px; font-family:${FONT}; font-size:11px; line-height:18px; color:${MUTED};">
            ${opts.footer}
            <a href="${SHOP}/datenschutz" style="color:${MUTED}; text-decoration:underline;">Datenschutz</a>
            &nbsp;&middot;&nbsp;
            <a href="${SHOP}/impressum" style="color:${MUTED}; text-decoration:underline;">Impressum</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="wrap" style="width:600px; max-width:600px;">
  <tr><td align="center" style="padding:18px 24px 4px 24px; font-family:${FONT}; font-size:11px; line-height:16px; color:${MUTED};">META &middot; at all levels</td></tr>
</table>

</td>
</tr>
</table>

</body>
</html>
`;
}

/** Fußzeile der Werbemails (Entwurf B0, Freigabe durch den DSB offen) */
const ADVERTISING_FOOTER = `{% if contact.MO_GRUNDLAGE == "bestandskunde" %}Sie erhalten diese E-Mail, weil Sie bei META bestellt haben. Sie können der Nutzung Ihrer E-Mail-Adresse für Werbung jederzeit widersprechen. Dafür entstehen nur die Übermittlungskosten nach den Basistarifen.<br><br>
            <a href="{{ unsubscribe }}" style="color:${MUTED}; text-decoration:underline;">Keine Werbe-E-Mails mehr</a>{% else %}Sie erhalten diese E-Mail, weil Sie den META Newsletter abonniert haben.<br><br>
            <a href="{{ unsubscribe }}" style="color:${MUTED}; text-decoration:underline;">Abmelden</a>{% endif %}
            &nbsp;&middot;&nbsp;`;
const SERVICE_FOOTER = `Sie erhalten diese E-Mail zu Ihrer Bestellung {{ params.MO_BESTELLNR }} bei META.<br><br>`;

/** Einstieg wie im Master: Dachzeile, Überschrift, Unterzeile, Anrede und Text */
function intro(s: Scope, kickerText: string, h1: string, sub: string, paragraphs: string[]): string {
  return section(
    table(
      [
        spacer(32),
        `<tr><td>${kicker(kickerText)}</td></tr>`,
        spacer(12),
        `<tr><td class="h1" style="font-family:${FONT}; font-size:36px; line-height:40px; font-weight:bold; color:${INK}; mso-line-height-rule:exactly;">${h1}</td></tr>`,
        spacer(8),
        text(sub, 18, MUTED),
        spacer(28),
        text(`Guten Tag{% if ${s}.MO_NAME %} {{ ${s}.MO_NAME }}{% endif %},`),
        spacer(12),
        ...paragraphs.flatMap((p, i) => [text(p), ...(i < paragraphs.length - 1 ? [spacer(12)] : [])]),
        spacer(28),
      ].join("\n"),
      `border-top:1px solid ${LINE};`,
    ),
  );
}

/** Abschnittstitel wie „Kurz notiert“ im Master: schwarze Linie oben, rote Dachzeile */
const sectionTitle = (title: string) => section(table([spacer(24), `<tr><td>${kicker(title)}</td></tr>`, spacer(12)].join("\n"), `border-top:2px solid ${INK};`));

type ItemOpts = { number?: boolean; price?: boolean; delivery?: boolean; link: string };

/** Artikelzeilen: Bild links (falls vorhanden), Name, Art.-Nr., Preis, Lieferzeit, Link; Trennlinie wie im Master */
function itemRows(s: Scope, prefix: string, count: number, o: ItemOpts): string {
  const rows: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const f = (n: string) => `${s}.MO_${prefix}_${i}_${n}`;
    rows.push(`{% if ${f("NAME")} %}
        <tr>
          <td class="thumb" width="88" valign="top" style="width:88px; padding:16px 16px 16px 0; border-bottom:1px solid ${LINE};">{% if ${f("BILD")} %}<a href="{{ ${f("URL")} }}"><img src="{{ ${f("BILD")} }}" width="88" alt="" style="display:block; width:88px; max-width:88px; height:auto; border:0;"></a>{% endif %}</td>
          <td valign="top" style="padding:16px 0; border-bottom:1px solid ${LINE}; font-family:${FONT};">
            <span style="display:block; font-size:16px; line-height:22px; font-weight:bold; color:${INK};">{{ ${f("NAME")} }}</span>
            ${o.number ? `<span style="display:block; font-size:13px; line-height:20px; color:${MUTED}; padding-top:4px;">Art.-Nr. {{ ${f("NR")} }}</span>` : ""}
            ${o.price ? `<span style="display:block; font-size:15px; line-height:22px; font-weight:bold; color:${INK}; padding-top:6px;">{{ ${f("PREIS")} }}</span>` : ""}
            ${o.delivery ? `{% if ${f("LIEFERZEIT")} %}<span style="display:block; font-size:13px; line-height:20px; color:${BODY};">Lieferzeit: {{ ${f("LIEFERZEIT")} }}</span>{% endif %}` : ""}
            {% if ${f("URL")} %}<span style="display:block; padding-top:8px;"><a href="{{ ${f("URL")} }}" style="font-size:13px; line-height:18px; font-weight:bold; color:${RED}; text-decoration:none;">${o.link} &rarr;</a></span>{% endif %}
          </td>
        </tr>
        {% endif %}`);
  }
  return section(table(rows.join("\n")));
}

/** Infokasten auf Hellgrau wie „Produkt im Fokus“ im Master, hier für Zubehör */
function accessoryBox(s: Scope, title: string, intro: string, count: number): string {
  return `{% if ${s}.MO_ZUB_ANZAHL > 0 %}
  <tr><td style="height:36px; line-height:36px; font-size:0;">&nbsp;</td></tr>
  <tr>
    <td style="padding:0 40px;" class="px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${SOFT}" style="background-color:${SOFT}; border:1px solid ${LINE};">
        <tr><td style="padding:28px 28px 4px 28px;">${kicker(title)}<span style="display:block; font-family:${FONT}; font-size:15px; line-height:22px; color:${BODY}; padding-top:10px;">${intro}</span></td></tr>
        <tr><td style="padding:0 28px 20px 28px;">
${table(
  Array.from({ length: count }, (_, k) => {
    const i = k + 1;
    const f = (n: string) => `${s}.MO_ZUB_${i}_${n}`;
    return `{% if ${f("NAME")} %}<tr>
            <td class="thumb" width="72" valign="top" style="width:72px; padding:14px 14px 14px 0; border-bottom:1px solid ${LINE};">{% if ${f("BILD")} %}<a href="{{ ${f("URL")} }}"><img src="{{ ${f("BILD")} }}" width="72" alt="" style="display:block; width:72px; max-width:72px; height:auto; border:0;"></a>{% endif %}</td>
            <td valign="top" style="padding:14px 0; border-bottom:1px solid ${LINE}; font-family:${FONT};">
              <span style="display:block; font-size:15px; line-height:21px; font-weight:bold; color:${INK};">{{ ${f("NAME")} }}</span>
              <span style="display:block; font-size:14px; line-height:20px; color:${INK}; padding-top:4px;">{{ ${f("PREIS")} }}</span>
              <span style="display:block; padding-top:6px;"><a href="{{ ${f("URL")} }}" style="font-size:13px; line-height:18px; font-weight:bold; color:${RED}; text-decoration:none;">Zum Artikel &rarr;</a></span>
            </td>
          </tr>{% endif %}`;
  }).join("\n"),
)}
        </td></tr>
      </table>
    </td>
  </tr>
  {% endif %}`;
}

const shopButton = (label: string) => section(table([spacer(28), button(SHOP, label)].join("\n")));

function regularLetterHtml(): string {
  return layout({
    title: REGULAR_LETTER_TEMPLATE_NAME,
    preheader: "Ihre Artikel bei META mit aktuellem Preis und aktueller Lieferzeit.",
    headerNote: "Für Stammkunden",
    body: [
      intro("contact", "Ihre Artikel bei META", "Alles für Ihren Nachschub.", "Aktuelle Preise und Lieferzeiten im Überblick.", [
        "vielen Dank, dass Sie regelmäßig bei META bestellen. Hier sind die Artikel, die Sie mehrfach bei uns gekauft haben, mit aktuellem Listenpreis (netto) und aktueller Lieferzeit aus unserem Onlineshop.",
      ]),
      sectionTitle("Ihre Stammartikel"),
      itemRows("contact", "STAMM", REGULAR_LETTER_MAX_ITEMS, { number: true, price: true, delivery: true, link: "Zum Artikel" }),
      accessoryBox("contact", "Das passt dazu", "Zubehör und Ergänzungen zu Ihren Artikeln:", REGULAR_LETTER_MAX_ACCESSORIES),
      shopButton("Zum Onlineshop"),
    ].join("\n"),
    footer: ADVERTISING_FOOTER,
  });
}

function overdueHtml(): string {
  return layout({
    title: "METAorder – Erinnerung Stammkunden",
    preheader: "Ihre Artikel bei META mit aktuellem Preis und aktueller Lieferzeit.",
    headerNote: "Für Stammkunden",
    body: [
      intro("contact", "Ihre Artikel bei META", "Brauchen Sie Nachschub?", "Ihre Artikel mit aktuellem Preis und Lieferzeit.", [
        "Sie haben in der Vergangenheit regelmäßig bei META bestellt. Falls Sie Nachschub brauchen: Hier sind Ihre Artikel mit aktuellem Listenpreis (netto) und aktueller Lieferzeit aus unserem Onlineshop.",
      ]),
      sectionTitle("Ihre Stammartikel"),
      itemRows("contact", "STAMM", REGULAR_LETTER_MAX_ITEMS, { number: true, price: true, delivery: true, link: "Zum Artikel" }),
      accessoryBox("contact", "Das passt dazu", "Zubehör und Ergänzungen zu Ihren Artikeln:", REGULAR_LETTER_MAX_ACCESSORIES),
      shopButton("Zum Onlineshop"),
    ].join("\n"),
    footer: ADVERTISING_FOOTER,
  });
}

function newsletterHtml(): string {
  return layout({
    title: "METAorder – Newsletter",
    preheader: `${TEMPLATE_TODO_MARK}Vorschautext in Brevo ergänzen⟧`,
    headerNote: `Newsletter ${TEMPLATE_TODO_MARK}Ausgabe⟧`,
    body: [
      intro("contact", `${TEMPLATE_TODO_MARK}Thema der Ausgabe⟧`, `${TEMPLATE_TODO_MARK}Überschrift⟧`, `${TEMPLATE_TODO_MARK}Unterzeile⟧`, [
        `${TEMPLATE_TODO_MARK}Diesen Absatz in Brevo durch den Newsletter-Text ersetzen. Solange ein solches Zeichen in der Vorlage steht, sendet METAorder nicht an Kunden.⟧`,
      ]),
      `{% if contact.MO_NEU_ANZAHL > 0 %}`,
      sectionTitle("Neu im Shop"),
      itemRows("contact", "NEU", NEW_PRODUCT_MAX, { price: true, link: "Zum Artikel" }),
      `{% endif %}`,
      section(
        table(
          [
            spacer(36),
            `<tr><td style="border-left:3px solid ${RED}; padding:4px 0 4px 20px;">${kicker("Regal-Lexikon", MUTED)}<span style="display:block; font-family:${FONT}; font-size:20px; line-height:26px; font-weight:bold; color:${INK}; padding-top:8px;">Fachbegriffe rund um Regale erklärt</span><span style="display:block; padding-top:12px;"><a href="${SHOP}/regal-lexikon" style="font-family:${FONT}; font-size:13px; line-height:18px; font-weight:bold; color:${RED}; text-decoration:none;">Zum Regal-Lexikon &rarr;</a></span></td></tr>`,
          ].join("\n"),
        ),
      ),
    ].join("\n"),
    footer: ADVERTISING_FOOTER,
  });
}

function serviceHtml(): string {
  return layout({
    title: "METAorder – Service nach dem Versand",
    preheader: "Informationen zu Ihrer Bestellung bei META.",
    headerNote: "Bestellung {{ params.MO_BESTELLNR }}",
    body: [
      intro("params", "Ihre Bestellung", "Ihre Bestellung ist unterwegs.", "Bestellung {{ params.MO_BESTELLNR }} vom {{ params.MO_BESTELLDATUM }}", [
        "vielen Dank für Ihre Bestellung.{% if params.MO_VERSANDDATUM %} Sie wurde am {{ params.MO_VERSANDDATUM }} versandt.{% endif %}",
      ]),
      `{% if params.MO_SENDUNG_URL %}${section(table(button("{{ params.MO_SENDUNG_URL }}", "Sendung verfolgen")))}{% endif %}`,
      `{% if params.MO_POS_ANZAHL > 0 %}`,
      section(table(spacer(28))),
      sectionTitle("Ihre Artikel"),
      itemRows("params", "POS", SERVICE_MAX_POSITIONS, { link: "Zur Produktseite" }),
      `{% endif %}`,
    ].join("\n"),
    footer: SERVICE_FOOTER,
  });
}

function accessoriesHtml(): string {
  return layout({
    title: "METAorder – Zubehör zur Bestellung",
    preheader: "Passendes Zubehör zu Ihrer Bestellung bei META.",
    headerNote: "Zu Bestellung {{ contact.MO_BESTELLNR }}",
    body: [
      intro("contact", "Passend zu Ihrer Bestellung", "Das passt dazu.", "Zubehör zu Ihrer Bestellung {{ contact.MO_BESTELLNR }}", [
        "zu Ihrer Bestellung vom {{ contact.MO_BESTELLDATUM }} passen diese Artikel aus unserem Onlineshop (Listenpreis netto).",
      ]),
      accessoryBox("contact", "Zubehör", "Ergänzungen zu den Artikeln, die Sie bestellt haben:", 3),
      shopButton("Zum Onlineshop"),
    ].join("\n"),
    footer: ADVERTISING_FOOTER,
  });
}

function reactivationHtml(): string {
  return layout({
    title: "METAorder – Reaktivierung",
    preheader: "Ihre Artikel bei META mit aktuellem Preis.",
    headerNote: "Ihre Artikel",
    body: [
      intro("contact", "Ihre Artikel bei META", "Schön, wieder von Ihnen zu lesen.", "Ihre damaligen Artikel mit aktuellem Preis.", [
        "Sie haben vor einiger Zeit bei META bestellt. Hier sind Ihre damaligen Artikel mit aktuellem Listenpreis (netto) und aktueller Lieferzeit aus unserem Onlineshop.",
      ]),
      sectionTitle("Ihre Artikel"),
      itemRows("contact", "STAMM", REGULAR_LETTER_MAX_ITEMS, { number: true, price: true, delivery: true, link: "Zum Artikel" }),
      accessoryBox("contact", "Das passt dazu", "Zubehör und Ergänzungen zu Ihren Artikeln:", REGULAR_LETTER_MAX_ACCESSORIES),
      shopButton("Zum Onlineshop"),
    ].join("\n"),
    footer: ADVERTISING_FOOTER,
  });
}

export function regularLetterTemplateHtml(): string {
  return regularLetterHtml();
}

export const MAIL_TEMPLATES: Record<CustomerMailBuildType, { name: string; subject: string; html: () => string }> = {
  regularLetter: { name: REGULAR_LETTER_TEMPLATE_NAME, subject: REGULAR_LETTER_DEFAULT_SUBJECT, html: regularLetterHtml },
  regularOverdue: { name: "METAorder – Erinnerung Stammkunden", subject: "Ihre Artikel bei META: aktuelle Preise und Lieferzeiten", html: overdueHtml },
  newsletter: { name: "METAorder – Newsletter", subject: "META Newsletter", html: newsletterHtml },
  afterSalesService: { name: "METAorder – Service nach dem Versand", subject: "Informationen zu Ihrer META-Bestellung", html: serviceHtml },
  afterSalesAccessories: { name: "METAorder – Zubehör zur Bestellung", subject: "Passendes Zubehör zu Ihrer Bestellung", html: accessoriesHtml },
  reactivation: { name: "METAorder – Reaktivierung", subject: "Ihre Artikel bei META: aktuelle Preise", html: reactivationHtml },
};
