/**
 * Teams-Info zu Problem-Tickets aus dem E-Mail-Eingang (Entscheidung 11.10.2026).
 *
 * METAorder baut die fertige Nachricht (Adaptive Card), n8n schickt sie an einen Teams-Workflow-
 * Webhook („Post to a channel when a webhook request is received“). Der zuständige Bearbeiter wird
 * im Kanal @erwähnt (über seine E-Mail = Teams-Anmeldename); ohne Bearbeiter oder ohne E-Mail geht
 * die Nachricht ohne Erwähnung in den Kanal. Nur neue Tickets: Wiederholungen von n8n posten nicht
 * erneut.
 */
import type { EmailIntakeProblemReason, EmailIntakeTeamsBlock, EmailIntakeTicketRef } from "@shared/emailIntake";

const REASON_LABEL: Record<EmailIntakeProblemReason, string> = {
  processing_failed: "E-Mail konnte nicht verarbeitet werden",
  shopware_failed: "Automatische Anlage in Shopware fehlgeschlagen",
  margin_red: "DB zu niedrig – Freigabe nötig",
};

/** Basisadresse für Links in Teams: PUBLIC_APP_URL, sonst die aufgerufene Adresse */
export function publicAppBaseUrl(fallback: string | null): string | null {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return configured || (fallback ? fallback.replace(/\/$/, "") : null);
}

/** In Teams-Text (Markdown-Untermenge) nichts interpretieren lassen, was aus der Mail kommt */
function plain(text: string, max = 200): string {
  return text.replace(/[<>*_`[\]#]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildTeamsTicketMessage(ticket: EmailIntakeTicketRef, baseUrl: string | null): Record<string, unknown> {
  const mentionName = ticket.assignedTo ?? ticket.assignedToEmail ?? "";
  const mention = ticket.assignedToEmail ? `<at>${plain(mentionName, 80)}</at>` : null;
  const ticketUrl = baseUrl && ticket.ticketId ? `${baseUrl}/tickets?ticketId=${encodeURIComponent(ticket.ticketId)}` : null;
  const draftUrl = baseUrl && ticket.draftPath ? `${baseUrl}${ticket.draftPath}` : null;

  const facts = [
    { title: "Ticket", value: ticket.ticketNumber },
    ...(ticket.subject ? [{ title: "Betreff", value: plain(ticket.subject) }] : []),
    ...(ticket.customer ? [{ title: "Kunde", value: plain(ticket.customer) }] : []),
    { title: "Zuständig", value: ticket.assignedTo ? plain(ticket.assignedTo, 80) : "niemand ermittelt – bitte übernehmen" },
  ];
  const actions = [
    ...(ticketUrl ? [{ type: "Action.OpenUrl", title: "Ticket öffnen", url: ticketUrl }] : []),
    ...(draftUrl ? [{ type: "Action.OpenUrl", title: "Entwurf öffnen", url: draftUrl }] : []),
  ];

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: `⚠️ ${REASON_LABEL[ticket.reason]}`, weight: "Bolder", size: "Medium", wrap: true },
            ...(mention ? [{ type: "TextBlock", text: `${mention}, bitte kümmere dich darum.`, wrap: true }] : []),
            { type: "FactSet", facts },
          ],
          ...(actions.length ? { actions } : {}),
          ...(mention
            ? {
                msteams: {
                  entities: [{ type: "mention", text: mention, mentioned: { id: ticket.assignedToEmail, name: plain(mentionName, 80) } }],
                },
              }
            : {}),
        },
      },
    ],
  };
}

/** Block `teams` der Antwort: nur bei hinterlegtem Webhook und neuen Tickets. */
export function buildIntakeTeamsBlock(
  webhookUrl: string,
  tickets: EmailIntakeTicketRef[],
  baseUrl: string | null,
): EmailIntakeTeamsBlock | null {
  const url = webhookUrl.trim();
  const fresh = tickets.filter((t) => t.isNew);
  if (!url || fresh.length === 0) return null;
  return { webhookUrl: url, messages: fresh.map((t) => buildTeamsTicketMessage(t, baseUrl)) };
}
