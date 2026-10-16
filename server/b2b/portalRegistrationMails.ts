/**
 * Portal-Registrierungen: Mails an Kundenstamm und Außendienst (Betreff + HTML). Verschickt werden
 * sie von n8n aus dem Registrierungs-Postfach (Postausgang); hier entsteht nur der Inhalt.
 */
import type {
  PortalRegistrationData,
  PortalRegistrationMatch,
  PortalRegistrationPlan,
} from "@shared/portalRegistrations";

export function escapeHtml(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = "font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5";
const CELL = "padding:4px 12px 4px 0;vertical-align:top";

function table(rows: Array<[string, string | null | undefined]>): string {
  const body = rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `<tr><td style="${CELL};color:#555">${escapeHtml(k)}</td><td style="${CELL}">${escapeHtml(v)}</td></tr>`)
    .join("");
  return `<table style="border-collapse:collapse">${body}</table>`;
}

function contactName(data: PortalRegistrationData): string {
  return [data.contact.firstName, data.contact.lastName].filter(Boolean).join(" ");
}

function registrationRows(data: PortalRegistrationData): Array<[string, string | null]> {
  const address = [data.street, [data.zipCode, data.city].filter(Boolean).join(" "), data.country].filter(Boolean).join(", ");
  return [
    ["Firma", data.company],
    ["Kundennummer laut Anmeldung", data.customerNumber],
    ["USt-IdNr.", data.vatId],
    ["Adresse", address || null],
    ["Telefon", data.phone],
    ["Ansprechpartner", contactName(data) || null],
    ["E-Mail", data.contact.email],
    ["Telefon Ansprechpartner", data.contact.phone],
    ["Expertenmodus", data.expertMode === true ? "gewünscht" : data.expertMode === false ? "nicht gewünscht" : null],
    ["Hinweis", data.notes],
  ];
}

function link(url: string | null, label: string): string {
  return url ? `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>` : "";
}

/** Bitte an den Kundenstamm: Kunde der Anmeldung fehlt im Portal */
export function buildMasterDataRequestMail(params: {
  data: PortalRegistrationData;
  match: PortalRegistrationMatch | null;
  forwardedBy: string | null;
  registrationUrl: string | null;
  /** Automatik an: METAorder legt den Zugang nach dem Anlegen selbst an */
  autoExecute: boolean;
}): { subject: string; html: string } {
  const { data, match } = params;
  const place = [data.zipCode, data.city].filter(Boolean).join(" ");
  const subject = `Portal-Registrierung prüfen: ${data.company ?? contactName(data) ?? "unbekannte Firma"}${place ? ` (${place})` : ""}`.slice(0, 250);
  const similar = (match?.candidates ?? []).slice(0, 5).map((c) => {
    const where = [c.customer.address.zipCode, c.customer.address.city].filter(Boolean).join(" ");
    return `<li>${escapeHtml(c.customer.customerNumber ?? "ohne Nr.")} – ${escapeHtml(c.customer.company ?? "")}${where ? `, ${escapeHtml(where)}` : ""} (${escapeHtml(c.customer.salesChannelName ?? "")}; ${escapeHtml(c.reasons.join(", "))})</li>`;
  });
  const shop = (match?.shopAccounts ?? []).map(
    (s) => `<li>${escapeHtml(s.customerNumber ?? "ohne Nr.")} – ${escapeHtml(s.company ?? "")} (${escapeHtml(s.salesChannelName ?? "Onlineshop")})</li>`,
  );
  const html = `<div style="${STYLE}">
<p>Hallo Kundenstamm-Team,</p>
<p>für das Händlerportal ist eine Registrierung eingegangen${params.forwardedBy ? ` (weitergeleitet von ${escapeHtml(params.forwardedBy)})` : ""}. Einen passenden Kunden im Portal haben wir nicht eindeutig gefunden. Bitte prüft, ob und unter welcher Kundennummer der Kunde im Portal angelegt werden soll.</p>
${table(registrationRows(data))}
${similar.length ? `<p><strong>Ähnliche Kunden im Portal:</strong></p><ul>${similar.join("")}</ul>` : ""}
${shop.length ? `<p><strong>Konten im Onlineshop (nicht Portal):</strong></p><ul>${shop.join("")}</ul>` : ""}
<p>${
    params.autoExecute
      ? "Sobald der Kunde im Portal steht, legt METAorder den Admin-Zugang an und schickt die Passwort-Mail. Die Anmeldung wird dafür regelmäßig neu geprüft – oder in METAorder über „Neu prüfen“."
      : "Sobald der Kunde im Portal steht, findet METAorder ihn beim nächsten Prüfen (regelmäßig oder über „Neu prüfen“); den Admin-Zugang gibt dann ein Kollege in METAorder frei."
  }</p>
${link(params.registrationUrl, "Registrierung in METAorder öffnen")}
<p>Die Originalmail hängt an.</p>
<p style="color:#777;font-size:12px">Automatische Nachricht von METAorder</p>
</div>`;
  return { subject, html };
}

/** Info an den zuständigen Außendienst: Kunde ist registriert, Passwort-Mail ist raus */
export function buildSalesRepInfoMail(params: {
  repName: string | null;
  plan: PortalRegistrationPlan;
  data: PortalRegistrationData;
  passwordResetSent: boolean;
  portalUrl: string;
}): { subject: string; html: string } {
  const { plan } = params;
  const customer = `${plan.company ?? params.data.company ?? "Kunde"}${plan.customerNumber ? ` (Kd. ${plan.customerNumber})` : ""}`;
  const subject = `Ihr Kunde ${customer} ist im Händlerportal registriert`.slice(0, 250);
  const greeting = params.repName?.trim() ? `Hallo ${escapeHtml(params.repName.trim())},` : "Hallo,";
  const html = `<div style="${STYLE}">
<p>${greeting}</p>
<p>Ihr Kunde <strong>${escapeHtml(customer)}</strong> wurde erfolgreich im Händlerportal registriert.</p>
${table([
  ["Administrator", `${plan.employee.firstName} ${plan.employee.lastName}`],
  ["E-Mail", plan.employee.email],
  ["Zugang", plan.employee.action === "create" ? "neu angelegt" : "bestand schon, aktualisiert"],
  ["Expertenmodus", plan.employee.expertMode ? "freigeschaltet" : "nicht freigeschaltet"],
])}
<p>${
    params.passwordResetSent
      ? `Der Administrator hat die Mail zum Setzen des Passworts bekommen. Der Link darin ist 2 Stunden gültig; danach kann er über „Passwort vergessen“ auf ${escapeHtml(params.portalUrl)} einen neuen anfordern.`
      : "Die Mail zum Setzen des Passworts konnte noch nicht ausgelöst werden; wir kümmern uns darum."
  }</p>
<p style="color:#777;font-size:12px">Automatische Nachricht von METAorder</p>
</div>`;
  return { subject, html };
}

/** Graph-Nachricht für POST {graphBase}/sendMail */
export function buildGraphMessage(params: {
  subject: string;
  html: string;
  to: string[];
  cc: string[];
  attachment?: { name: string; base64: string } | null;
}): Record<string, unknown> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  const message: Record<string, unknown> = {
    subject: params.subject,
    body: { contentType: "HTML", content: params.html },
    toRecipients: recipients(params.to),
  };
  if (params.cc.length) message.ccRecipients = recipients(params.cc);
  if (params.attachment) {
    message.attachments = [
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: params.attachment.name,
        contentType: "message/rfc822",
        contentBytes: params.attachment.base64,
      },
    ];
  }
  return message;
}
