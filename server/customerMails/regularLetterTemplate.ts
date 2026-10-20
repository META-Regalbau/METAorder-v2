/**
 * Kundenmails B2: Startvorlage „Stammkunden-Brief“ für Brevo (per Knopf angelegt, danach in Brevo gestaltbar).
 * Platzhalter in Brevo-Syntax ({{ contact.MO_… }}), Fußzeile je Rechtsgrundlage über MO_GRUNDLAGE.
 * Texte: nur belegte Aussagen über META (keine Versprechen zu Rabatten, Lieferterminen o. Ä.). Die Fußzeilen folgen
 * dem B0-Entwurf (Kundenmails-Rechtstexte-Entwurf-2026-10-20.html) und sind bis zur Freigabe durch den DSB ein Entwurf.
 */
import { REGULAR_LETTER_MAX_ACCESSORIES, REGULAR_LETTER_MAX_ITEMS } from "./regularLetter";

export const REGULAR_LETTER_TEMPLATE_NAME = "METAorder – Stammkunden-Brief";
export const REGULAR_LETTER_DEFAULT_SUBJECT = "Ihre Artikel bei META: aktuelle Preise und Lieferzeiten";

const RED = "#c8102e";
const INK = "#1d1d1b";
const MUTED = "#5f5f5c";
const LINE = "#dcdcd8";

function itemRow(prefix: "STAMM" | "ZUB", i: number): string {
  const f = (name: string) => `{{ contact.MO_${prefix}_${i}_${name} }}`;
  const delivery = prefix === "STAMM" ? `{% if contact.MO_STAMM_${i}_LIEFERZEIT %}<br><span style="color:${MUTED};font-size:13px">Lieferzeit: ${f("LIEFERZEIT")}</span>{% endif %}` : "";
  return `{% if contact.MO_${prefix}_${i}_NAME %}
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-size:15px;color:${INK}">
            <strong>${f("NAME")}</strong>${prefix === "STAMM" ? `<br><span style="color:${MUTED};font-size:13px">Art.-Nr. ${f("NR")}</span>` : ""}
            <br><span style="font-size:14px">${f("PREIS")}</span>${delivery}
          </td>
          <td style="padding:12px 0 12px 12px;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap">
            <a href="${f("URL")}" style="color:${RED};font-weight:bold;text-decoration:none">Zum Artikel &rsaquo;</a>
          </td>
        </tr>
        {% endif %}`;
}

export function regularLetterTemplateHtml(): string {
  const items = Array.from({ length: REGULAR_LETTER_MAX_ITEMS }, (_, i) => itemRow("STAMM", i + 1)).join("\n");
  const accessories = Array.from({ length: REGULAR_LETTER_MAX_ACCESSORIES }, (_, i) => itemRow("ZUB", i + 1)).join("\n");
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>META Regalbau</title></head>
<body style="margin:0;padding:0;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
        <tr><td style="padding:20px 28px;border-bottom:4px solid ${RED};font-size:20px;font-weight:bold;color:${INK}">META Regalbau</td></tr>
        <tr><td style="padding:24px 28px 8px;font-size:15px;line-height:1.55">
          <p style="margin:0 0 14px">Guten Tag{% if contact.MO_NAME %} {{ contact.MO_NAME }}{% endif %},</p>
          <p style="margin:0 0 14px">vielen Dank, dass Sie regelmäßig bei META bestellen. Hier sind die Artikel, die Sie mehrfach bei uns gekauft haben, mit aktuellem Listenpreis (netto) und aktueller Lieferzeit aus unserem Onlineshop.</p>
        </td></tr>
        <tr><td style="padding:0 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${items}
          </table>
        </td></tr>
        {% if contact.MO_ZUB_ANZAHL > 0 %}
        <tr><td style="padding:24px 28px 0;font-size:17px;font-weight:bold">Das passt dazu</td></tr>
        <tr><td style="padding:0 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${accessories}
          </table>
        </td></tr>
        {% endif %}
        <tr><td style="padding:24px 28px;font-size:15px;line-height:1.55">
          <p style="margin:0 0 14px">Sie haben Fragen zu Ihrer Bestellung oder brauchen eine andere Ausführung? Antworten Sie einfach auf diese E-Mail.</p>
          <p style="margin:0">Freundliche Grüße<br>Ihr META-Team</p>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f4f4f2;font-size:12px;line-height:1.5;color:${MUTED}">
          {% if contact.MO_GRUNDLAGE == "bestandskunde" %}
          Sie erhalten diese E-Mail, weil Sie bei META bestellt haben. Sie können der Nutzung Ihrer E-Mail-Adresse für Werbung jederzeit widersprechen: <a href="{{ unsubscribe }}" style="color:${MUTED}">Keine Werbe-E-Mails mehr</a>. Dafür entstehen nur die Übermittlungskosten nach den Basistarifen.
          {% else %}
          Sie erhalten diese E-Mail, weil Sie den Newsletter von META abonniert haben. <a href="{{ unsubscribe }}" style="color:${MUTED}">Hier abmelden</a>.
          {% endif %}
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
