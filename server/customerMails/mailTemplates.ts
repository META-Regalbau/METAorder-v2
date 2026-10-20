/**
 * Kundenmails: Startvorlagen je Mailart für Brevo (per Knopf angelegt, danach in Brevo gestaltbar).
 * - Werbemails laufen als Kampagne: Platzhalter {{ contact.MO_… }}, Fußzeile je Rechtsgrundlage, Abmeldelink.
 * - Die Service-Mail läuft über den Transaktionsweg: Platzhalter {{ params.MO_… }}, ohne Werbung, ohne Abmeldelink.
 * Texte nur mit belegten Aussagen über META. Stellen, die in Brevo ergänzt werden müssen, tragen TEMPLATE_TODO_MARK;
 * solange eine Vorlage ihn enthält, verweigert METAorder den Versand an Kunden (sendRun).
 */
import type { CustomerMailBuildType } from "@shared/customerMails";
import { REGULAR_LETTER_MAX_ACCESSORIES, REGULAR_LETTER_MAX_ITEMS } from "./regularLetter";
import { NEW_PRODUCT_MAX, SERVICE_MAX_POSITIONS } from "./mailContent";
import { REGULAR_LETTER_DEFAULT_SUBJECT, REGULAR_LETTER_TEMPLATE_NAME, regularLetterTemplateHtml } from "./regularLetterTemplate";

export const TEMPLATE_TODO_MARK = "⟦";

const RED = "#c8102e";
const INK = "#1d1d1b";
const MUTED = "#5f5f5c";
const LINE = "#dcdcd8";

type Scope = "contact" | "params";

function layout(body: string, footer: string): string {
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>META Regalbau</title></head>
<body style="margin:0;padding:0;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
        <tr><td style="padding:20px 28px;border-bottom:4px solid ${RED};font-size:20px;font-weight:bold;color:${INK}">META Regalbau</td></tr>
${body}
        <tr><td style="padding:18px 28px;background:#f4f4f2;font-size:12px;line-height:1.5;color:${MUTED}">
          ${footer}
          <br><br>META-Regalbau GmbH &amp; Co. KG · Eichenkamp · 59759 Arnsberg ·
          <a href="https://shop.meta-online.com/impressum" style="color:${MUTED}">Impressum</a> ·
          <a href="https://shop.meta-online.com/datenschutz" style="color:${MUTED}">Datenschutz</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const p = (html: string) => `<p style="margin:0 0 14px">${html}</p>`;
const textRow = (html: string) => `        <tr><td style="padding:24px 28px 8px;font-size:15px;line-height:1.55">
          ${html}
        </td></tr>`;
const greeting = (s: Scope) => p(`Guten Tag{% if ${s}.MO_NAME %} {{ ${s}.MO_NAME }}{% endif %},`);
const closing = textRow(`${p("Sie haben Fragen? Antworten Sie einfach auf diese E-Mail.")}<p style="margin:0">Freundliche Grüße<br>Ihr META-Team</p>`);

/** Fußzeile der Werbemails (Entwurf B0, Freigabe durch den DSB offen) */
const ADVERTISING_FOOTER = `{% if contact.MO_GRUNDLAGE == "bestandskunde" %}
          Sie erhalten diese E-Mail, weil Sie bei META bestellt haben. Sie können der Nutzung Ihrer E-Mail-Adresse für Werbung jederzeit widersprechen: <a href="{{ unsubscribe }}" style="color:${MUTED}">Keine Werbe-E-Mails mehr</a>. Dafür entstehen nur die Übermittlungskosten nach den Basistarifen.
          {% else %}
          Sie erhalten diese E-Mail, weil Sie den Newsletter von META abonniert haben. <a href="{{ unsubscribe }}" style="color:${MUTED}">Hier abmelden</a>.
          {% endif %}`;
const SERVICE_FOOTER = `Sie erhalten diese E-Mail zu Ihrer Bestellung {{ params.MO_BESTELLNR }} bei META.`;

function productRows(s: Scope, prefix: string, count: number, opts: { number?: boolean; delivery?: boolean; price?: boolean; link?: string }): string {
  const rows: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const f = (name: string) => `{{ ${s}.MO_${prefix}_${i}_${name} }}`;
    const extra = [
      opts.number ? `<br><span style="color:${MUTED};font-size:13px">Art.-Nr. ${f("NR")}</span>` : "",
      opts.price ? `<br><span style="font-size:14px">${f("PREIS")}</span>` : "",
      opts.delivery ? `{% if ${s}.MO_${prefix}_${i}_LIEFERZEIT %}<br><span style="color:${MUTED};font-size:13px">Lieferzeit: ${f("LIEFERZEIT")}</span>{% endif %}` : "",
    ].join("");
    rows.push(`{% if ${s}.MO_${prefix}_${i}_NAME %}
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-size:15px;color:${INK}"><strong>${f("NAME")}</strong>${extra}</td>
          <td style="padding:12px 0 12px 12px;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap">{% if ${s}.MO_${prefix}_${i}_URL %}<a href="${f("URL")}" style="color:${RED};font-weight:bold;text-decoration:none">${opts.link ?? "Zum Artikel"} &rsaquo;</a>{% endif %}</td>
        </tr>
        {% endif %}`);
  }
  return `        <tr><td style="padding:0 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${rows.join("\n")}
          </table>
        </td></tr>`;
}

const heading = (text: string) => `        <tr><td style="padding:24px 28px 0;font-size:17px;font-weight:bold">${text}</td></tr>`;

function overdueHtml(): string {
  return layout(
    [
      textRow(
        greeting("contact") +
          p("Sie haben in der Vergangenheit regelmäßig bei META bestellt. Falls Sie Nachschub brauchen: Hier sind Ihre Artikel mit aktuellem Listenpreis (netto) und aktueller Lieferzeit aus unserem Onlineshop."),
      ),
      productRows("contact", "STAMM", REGULAR_LETTER_MAX_ITEMS, { number: true, price: true, delivery: true }),
      `{% if contact.MO_ZUB_ANZAHL > 0 %}`,
      heading("Das passt dazu"),
      productRows("contact", "ZUB", REGULAR_LETTER_MAX_ACCESSORIES, { price: true }),
      `{% endif %}`,
      closing,
    ].join("\n"),
    ADVERTISING_FOOTER,
  );
}

function newsletterHtml(): string {
  return layout(
    [
      textRow(
        greeting("contact") +
          p(`${TEMPLATE_TODO_MARK}Thema dieser Ausgabe: Diesen Absatz in Brevo durch den eigentlichen Newsletter-Text ersetzen. Solange dieses Zeichen hier steht, sendet METAorder nicht an Kunden.⟧`),
      ),
      `{% if contact.MO_NEU_ANZAHL > 0 %}`,
      heading("Neu im Shop"),
      productRows("contact", "NEU", NEW_PRODUCT_MAX, { price: true }),
      `{% endif %}`,
      textRow(p(`Fachbegriffe rund um Regale erklärt unser <a href="https://shop.meta-online.com/regal-lexikon" style="color:${RED}">Regal-Lexikon</a>.`)),
      closing,
    ].join("\n"),
    ADVERTISING_FOOTER,
  );
}

function serviceHtml(): string {
  return layout(
    [
      textRow(
        greeting("params") +
          p("vielen Dank für Ihre Bestellung {{ params.MO_BESTELLNR }} vom {{ params.MO_BESTELLDATUM }}.{% if params.MO_VERSANDDATUM %} Sie wurde am {{ params.MO_VERSANDDATUM }} versandt.{% endif %}") +
          `{% if params.MO_SENDUNG_URL %}${p(`<a href="{{ params.MO_SENDUNG_URL }}" style="color:${RED};font-weight:bold">Sendung verfolgen &rsaquo;</a>`)}{% endif %}`,
      ),
      `{% if params.MO_POS_ANZAHL > 0 %}`,
      heading("Ihre Artikel"),
      productRows("params", "POS", SERVICE_MAX_POSITIONS, { link: "Zur Produktseite" }),
      `{% endif %}`,
      textRow(`${p("Sie haben Fragen zu Lieferung oder Aufbau? Antworten Sie einfach auf diese E-Mail.")}<p style="margin:0">Freundliche Grüße<br>Ihr META-Team</p>`),
    ].join("\n"),
    SERVICE_FOOTER,
  );
}

function accessoriesHtml(): string {
  return layout(
    [
      textRow(greeting("contact") + p("zu Ihrer Bestellung {{ contact.MO_BESTELLNR }} vom {{ contact.MO_BESTELLDATUM }} passen diese Artikel aus unserem Onlineshop (Listenpreis netto):")),
      productRows("contact", "ZUB", 3, { price: true }),
      closing,
    ].join("\n"),
    ADVERTISING_FOOTER,
  );
}

function reactivationHtml(): string {
  return layout(
    [
      textRow(greeting("contact") + p("Sie haben vor einiger Zeit bei META bestellt. Hier sind Ihre damaligen Artikel mit aktuellem Listenpreis (netto) und aktueller Lieferzeit aus unserem Onlineshop.")),
      productRows("contact", "STAMM", REGULAR_LETTER_MAX_ITEMS, { number: true, price: true, delivery: true }),
      `{% if contact.MO_ZUB_ANZAHL > 0 %}`,
      heading("Das passt dazu"),
      productRows("contact", "ZUB", REGULAR_LETTER_MAX_ACCESSORIES, { price: true }),
      `{% endif %}`,
      closing,
    ].join("\n"),
    ADVERTISING_FOOTER,
  );
}

export const MAIL_TEMPLATES: Record<CustomerMailBuildType, { name: string; subject: string; html: () => string }> = {
  regularLetter: { name: REGULAR_LETTER_TEMPLATE_NAME, subject: REGULAR_LETTER_DEFAULT_SUBJECT, html: regularLetterTemplateHtml },
  regularOverdue: { name: "METAorder – Erinnerung Stammkunden", subject: "Ihre Artikel bei META: aktuelle Preise und Lieferzeiten", html: overdueHtml },
  newsletter: { name: "METAorder – Newsletter", subject: "META Newsletter", html: newsletterHtml },
  afterSalesService: { name: "METAorder – Service nach dem Versand", subject: "Informationen zu Ihrer META-Bestellung", html: serviceHtml },
  afterSalesAccessories: { name: "METAorder – Zubehör zur Bestellung", subject: "Passendes Zubehör zu Ihrer Bestellung", html: accessoriesHtml },
  reactivation: { name: "METAorder – Reaktivierung", subject: "Ihre Artikel bei META: aktuelle Preise", html: reactivationHtml },
};
