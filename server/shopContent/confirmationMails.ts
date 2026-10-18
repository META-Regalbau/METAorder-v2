/**
 * Bestätigungs-Mails des Onlineshops (scripts/writeConfirmationMails.ts), nur Deutsch:
 *
 * 1. Newsletter-Double-Opt-in (Mail-Template-Typ newsletterDoubleOptIn): Shopware-Standard mit Betreff
 *    „Newsletter“ und einem „hier“-Link. Die meisten Anmeldungen bleiben unbestätigt (Live DE-Shop seit
 *    20.07.2026: 8 Anmeldungen, 1 bestätigt, 1 abgemeldet, 6 offen). Neu: klarer Betreff, Knopf,
 *    Link zum Kopieren. Die Checkbox schickt keinen Namen mit, deshalb Anrede nur mit Namen, wenn er da ist.
 *    Das Template gilt für alle Kanäle mit Deutsch (auch AT und Händlerportale), daher ohne Kanalnamen.
 *
 * 2. Doppelte Double-Opt-in-Mails: Je Ereignis laufen zwei aktive Flows mit derselben Mail – die alten
 *    Standard-Flows („x- …“, 2024) und die am 27.07.2026 neu angelegten („wird aktiv genutzt“). Die älteren
 *    werden abgeschaltet (nicht gelöscht).
 *
 * 3. Mail-Fußzeile des Kanals META Regalbau DE: Impressum/Datenschutz/AGB zeigten auf Platzhalter-IDs
 *    („impressum-page-id“) und führten ins Leere; die Textfassung klebte die Adress-Zeilen zusammen und
 *    nannte „Bankverbindung: Bankverbindungen:“; auf dem Handy lief die IBAN aus der Spalte. Inhalte nur aus den Kanal-Stammdaten
 *    (core.basicInformation.address / bankAccount des Kanals) und der bisherigen Fußzeile.
 */
import type { ShopApi } from "./shopProducts";

export const NEWSLETTER_DOI_TYPE = "newsletterDoubleOptIn";
export const NEWSLETTER_DOI_SUBJECT = "Bitte bestätigen Sie Ihre Anmeldung zum META-Newsletter";

/** Primärfarbe des Shop-Themes (--bs-primary); weiß darauf nur ab 18px fett (Kontrast 4:1) */
const BRAND_RED = "#ff0002";

const greeting =
  "Guten Tag{% if newsletterRecipient.lastName %} {{ newsletterRecipient.firstName }} {{ newsletterRecipient.lastName }}{% endif %},";

export const NEWSLETTER_DOI_HTML = `<div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #121212;">
<p style="margin: 0 0 16px;">${greeting}</p>
<p style="margin: 0 0 16px;">vielen Dank für Ihre Anmeldung zum META-Newsletter mit Neuheiten und Aktionen rund um Regalsysteme.</p>
<p style="margin: 0 0 24px;"><strong>Bitte bestätigen Sie Ihre E-Mail-Adresse.</strong> Erst nach Ihrer Bestätigung ist die Anmeldung abgeschlossen.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 24px;">
  <tr>
    <td align="center" bgcolor="${BRAND_RED}" style="border-radius: 4px;">
      <a href="{{ url }}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: Arial, sans-serif; font-size: 18px; font-weight: bold; line-height: 1.2; color: #ffffff; text-decoration: none; border-radius: 4px; background-color: ${BRAND_RED};">Anmeldung bestätigen</a>
    </td>
  </tr>
</table>
<p style="margin: 0 0 16px; font-size: 13px; color: #5f5f5f;">Falls der Knopf nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br><a href="{{ url }}" style="color: #5f5f5f; word-break: break-all;">{{ url }}</a></p>
<p style="margin: 0 0 16px;">Sie können sich jederzeit wieder abmelden. Sollten Sie den Newsletter nicht angefordert haben, ignorieren Sie diese E-Mail.</p>
<p style="margin: 0;">Viele Grüße<br>Ihr META-Team</p>
</div>`;

export const NEWSLETTER_DOI_PLAIN = `${greeting}

vielen Dank für Ihre Anmeldung zum META-Newsletter mit Neuheiten und Aktionen rund um Regalsysteme.

Bitte bestätigen Sie Ihre E-Mail-Adresse. Erst nach Ihrer Bestätigung ist die Anmeldung abgeschlossen.

Anmeldung bestätigen:
{{ url }}

Sie können sich jederzeit wieder abmelden. Sollten Sie den Newsletter nicht angefordert haben, ignorieren Sie diese E-Mail.

Viele Grüße
Ihr META-Team`;

/** Ereignisse, deren Bestätigungs-Mail doppelt rausging */
export const DOI_EVENTS = ["checkout.customer.double_opt_in_guest_order", "checkout.customer.double_opt_in_registration"] as const;

export type FlowLite = {
  id: string;
  name: string;
  eventName: string;
  active: boolean;
  createdAt: string;
  sequences?: Array<{ actionName: string | null; config?: { mailTemplateId?: string } | unknown[] }>;
};

const mailTemplatesOf = (f: FlowLite) =>
  (f.sequences ?? [])
    .filter((s) => s.actionName === "action.mail.send")
    .map((s) => (Array.isArray(s.config) ? undefined : s.config?.mailTemplateId))
    .filter((id): id is string => !!id)
    .sort();

/**
 * Aktive Flows, die je Ereignis dieselbe Mail ein zweites Mal schicken. Behalten wird der jüngste;
 * Flows mit Bedingungen oder anderen Aktionen bleiben unangetastet (nur reine Mail-Flows zählen).
 */
export function duplicateDoiFlows(flows: FlowLite[]): FlowLite[] {
  const out: FlowLite[] = [];
  for (const event of DOI_EVENTS) {
    const groups = new Map<string, FlowLite[]>();
    for (const f of flows) {
      if (f.eventName !== event || !f.active) continue;
      const seqs = f.sequences ?? [];
      const mails = mailTemplatesOf(f);
      if (!mails.length || mails.length !== seqs.length) continue;
      const key = mails.join(",");
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    for (const group of Array.from(groups.values())) {
      const sorted = [...group].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      out.push(...sorted.slice(1));
    }
  }
  return out;
}

/** Stammdaten der Fußzeile aus core.basicInformation (Kanal META Regalbau DE), Stand 18.10.2026 */
const COMPANY = {
  name: "META Regalbau GmbH & Co. KG",
  street: "Eichenkamp",
  city: "59759 Arnsberg",
  country: "Deutschland",
  register: "Handelsregister: Arnsberg, HRA 1551",
  partner: "Persönlich haftend: META-Regalbau GmbH, 59759 Arnsberg, HRB 302",
  vatId: "USt-IdNr.: DE111797160",
  bank: "Deutsche Bank Arnsberg",
  iban: "DE83 4667 0007 0554 4770 00",
  bic: "DEUTDEDW466",
};

const LEGAL_PAGES = [
  ["Impressum", "impressum"],
  ["Datenschutz", "datenschutz"],
  ["AGB", "agb"],
] as const;

const htmlEscape = (s: string) => s.replace(/&/g, "&amp;");

/**
 * HTML-Fußzeile: Logo, Adresse | Bank, Social Media, Registerangaben, Rechtliches. Bisher drei Spalten – auf dem
 * Handy lief die IBAN (ohne Leerzeichen) aus der Spalte. Links absolut auf die Storefront.
 */
export function buildFooterHtml(storefront: string): string {
  const c = COMPANY;
  const links = LEGAL_PAGES.map(
    ([label, path]) => `            <a href="${storefront}/${path}" style="color: #666666; text-decoration: underline; margin: 0 10px;">${label}</a>`,
  ).join("\n");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; font-family: Arial, sans-serif; font-size: 12px; color: #666666; padding: 20px; margin-top: 40px;">
    <tr>
        <td colspan="2" style="padding-bottom: 10px;">
            <img src="{{ asset('media/49/8d/35/1741168752/META_at_all_levels_RGB_klein.png?ts=1741168766') }}" alt="META Regalbau" style="max-width: 150px; display: block;" />
        </td>
    </tr>
    <tr>
        <td width="50%" valign="top" style="padding: 10px;">
${htmlEscape(c.name)}<br>
${c.street}<br>
${c.city}<br>
${c.country}
        </td>
        <td width="50%" valign="top" style="padding: 10px;">
Bankverbindung:<br>
${c.bank}<br>
IBAN: ${c.iban}<br>
BIC: ${c.bic}
        </td>
    </tr>
    <tr>
        <td colspan="2" style="padding: 0 10px 10px;">
                <a href="https://www.facebook.com/meta.regalbau/" target="_blank" style="margin-right: 8px;">
                    <img src="{{ asset('media/9a/e6/05/1743667987/Facebook.svg?ts=1743667987') }}" alt="Facebook" width="20" height="20" />
                </a>
                <a href="https://www.instagram.com/meta_regalbau/" target="_blank" style="margin-right: 8px;">
                    <img src="{{ asset('media/53/78/88/1743667987/Insta.svg?ts=1743667987') }}" alt="Instagram" width="20" height="20" />
                </a>
                <a href="https://www.youtube.com/user/METAregalbau" target="_blank" style="margin-right: 8px;">
                    <img src="{{ asset('media/fa/c3/eb/1743667987/youtube.svg?ts=1743667987') }}" alt="YouTube" width="20" height="20" />
                </a>
                <a href="https://www.linkedin.com/company/meta-regalbau-gmbh-&-co-kg/" target="_blank" style="margin-right: 8px;">
                    <img src="{{ asset('media/4d/ba/be/1743667987/Linkedin.svg?ts=1743667987') }}" alt="LinkedIn" width="20" height="20" />
                </a>
        </td>
    </tr>
    <tr>
        <td colspan="2" style="padding: 10px; font-size: 11px; color: #666666;">
${c.register} · ${c.partner} · ${c.vatId}
        </td>
    </tr>
    <tr>
        <td colspan="2" style="padding-top: 10px; border-top: 1px solid #dddddd; text-align: center;">
${links}
        </td>
    </tr>
</table>
`;
}

/** Textfassung: eine Angabe je Zeile statt der zusammengeklebten Stammdaten */
export function buildFooterPlain(storefront: string): string {
  const c = COMPANY;
  return `

--
${c.name}
${c.street}, ${c.city}, ${c.country}
${c.register}
${c.partner}
${c.vatId}

Bankverbindung: ${c.bank}, IBAN ${c.iban}, BIC ${c.bic}

${LEGAL_PAGES.map(([label, path]) => `${label}: ${storefront}/${path}`).join("\n")}
`;
}

/** Kopfzeilen-Logo ohne alt-Text bekommt „META Regalbau“ (sonst zeigt die Mail den Dateinamen) */
export function headerWithLogoAlt(headerHtml: string): string {
  return headerHtml.replace(/<img(?![^>]*\balt=)([^>]*?)(\s*\/?)>/g, '<img$1 alt="META Regalbau"$2>');
}

export type MailTemplateDe = { id: string; subject: string; contentHtml: string; contentPlain: string };
export type HeaderFooterDe = { id: string; headerHtml: string | null; footerHtml: string | null; footerPlain: string | null };

/** Das (einzige) Newsletter-DOI-Template mit deutschem Inhalt */
export async function loadNewsletterDoiTemplate(api: ShopApi): Promise<MailTemplateDe> {
  const res = await api("POST", "search/mail-template", {
    limit: 5,
    filter: [{ type: "equals", field: "mailTemplateType.technicalName", value: NEWSLETTER_DOI_TYPE }],
  });
  const list = res?.data ?? [];
  if (list.length !== 1) throw new Error(`Erwartet 1 Template ${NEWSLETTER_DOI_TYPE}, gefunden ${list.length}`);
  const t = list[0];
  return { id: t.id, subject: t.subject, contentHtml: t.contentHtml, contentPlain: t.contentPlain };
}

/** Kopf-/Fußzeile, die am Kanal hängt (deutscher Inhalt) */
export async function loadChannelHeaderFooter(api: ShopApi, channelId: string): Promise<HeaderFooterDe> {
  const ch = await api("POST", "search/sales-channel", { ids: [channelId], includes: { sales_channel: ["mailHeaderFooterId"] } });
  const id = ch?.data?.[0]?.mailHeaderFooterId;
  if (!id) throw new Error("Kanal hat keine Mail-Kopf-/Fußzeile");
  const res = await api("POST", "search/mail-header-footer", { ids: [id] });
  const hf = res?.data?.[0];
  if (!hf) throw new Error(`Kopf-/Fußzeile ${id} fehlt`);
  return { id: hf.id, headerHtml: hf.headerHtml, footerHtml: hf.footerHtml, footerPlain: hf.footerPlain };
}
