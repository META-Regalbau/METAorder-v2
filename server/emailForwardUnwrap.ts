/**
 * Interne Weiterleitungen aus der Auswertung herausnehmen.
 *
 * Kundenbestellungen erreichen das Bestellpostfach oft über Kollegen („WG: …", „Moin, anbei
 * eine Bestellung"). Für die Auswertung zählt ausschließlich die URSPRÜNGLICHE Kundenmail:
 * ihr Absender, ihr Betreff, ihr Text. Weiterleitungs-Notizen und interne Adressen dürfen
 * weder in die Kundenzuordnung noch in Intent/Extraktion/Notizen einfließen.
 *
 * Regel: Ist der Kopf-Absender eine eigene Domain, wird die Weiterleitungskette
 * (Outlook-Blöcke „Von/Gesendet/An/Betreff", „From/Sent/To/Subject", „-----Ursprüngliche
 * Nachricht-----") von außen nach innen abgelaufen. Der erste Block mit externem Absender
 * ist die Kundenmail. Kommt die Mail direkt vom Kunden, bleibt alles unverändert —
 * leitet ein KUNDE etwas weiter, ist das Teil seiner Nachricht.
 */

import { isOwnOperatorEmail } from "./draftCustomerEmailResolution";

export type UnwrappedEmail = {
  /** Anzeige-Absender „Name <mail>" der ursprünglichen Kundenmail */
  from: string;
  fromEmail: string | null;
  subject: string;
  body: string;
  /** Anzahl entfernter interner Weiterleitungsebenen (0 = nichts verändert) */
  strippedForwardLevels: number;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Kopfzeile eines Weiterleitungsblocks: „Von: …" / „From: …" */
const BLOCK_FROM_RE = /^[>\s]*(?:\*{0,2})(?:Von|From|De|Da)(?:\*{0,2})\s*:\s*(.+)$/i;
const BLOCK_FIELD_RE =
  /^[>\s]*(?:\*{0,2})(Gesendet|Sent|Datum|Date|An|To|Cc|Kopie|Betreff|Subject|Envoy[ée]|Objet|Inviato|Oggetto|A)(?:\*{0,2})\s*:\s*(.*)$/i;
const SUBJECT_FIELD_RE = /^(Betreff|Subject|Objet|Oggetto)$/i;

type ForwardBlock = {
  fromLine: string;
  fromEmail: string | null;
  subject: string | null;
  /** Index der ersten Textzeile NACH dem Kopfblock */
  bodyStartLine: number;
};

function cleanAddressLine(value: string): string {
  // Outlook-Klartext: „Name <a@b.de<mailto:a@b.de>>" → „Name <a@b.de>"
  return value
    .replace(/<mailto:[^>]*>/gi, "")
    .replace(/\[mailto:[^\]]*\]/gi, "")
    .replace(/>>+/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function findForwardBlocks(lines: string[]): ForwardBlock[] {
  const blocks: ForwardBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(BLOCK_FROM_RE);
    if (!m) continue;
    // Ein echter Weiterleitungskopf hat in den nächsten Zeilen mindestens zwei weitere Felder.
    let fields = 0;
    let subject: string | null = null;
    let j = i + 1;
    for (; j < Math.min(lines.length, i + 8); j++) {
      const f = lines[j].match(BLOCK_FIELD_RE);
      if (!f) {
        if (!lines[j].trim()) break;
        // Umbruch innerhalb eines Feldes (lange An-/Cc-Liste)
        if (fields > 0 && /^\s+\S/.test(lines[j])) continue;
        break;
      }
      fields += 1;
      if (SUBJECT_FIELD_RE.test(f[1])) subject = f[2].trim();
    }
    if (fields < 2) continue;
    const fromLine = cleanAddressLine(m[1]);
    const email = fromLine.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;
    blocks.push({ fromLine, fromEmail: email, subject, bodyStartLine: j });
    i = j - 1;
  }
  return blocks;
}

/** „WG: [External] AW: Bestellung" → „Bestellung" (nur Weiterleitungs-/Banner-Präfixe, Antworten bleiben erkennbar). */
export function stripForwardSubjectPrefixes(subject: string): string {
  let s = (subject || "").trim();
  for (let i = 0; i < 6; i++) {
    const next = s
      .replace(/^(?:WG|FW|FWD|WEITERGELEITET|TR|I)\s*:\s*/i, "")
      .replace(/^\[(?:external|extern|ext)\]\s*/i, "")
      .trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

export function unwrapInternalForward(input: {
  from?: string | null;
  subject?: string | null;
  body?: string | null;
}): UnwrappedEmail {
  const from = (input.from ?? "").trim();
  const subject = (input.subject ?? "").trim();
  const body = input.body ?? "";
  const headerEmail = from.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;
  const unchanged: UnwrappedEmail = {
    from,
    fromEmail: headerEmail,
    subject,
    body,
    strippedForwardLevels: 0,
  };

  // Nur interne Weiterleitungen auspacken. Ohne erkennbare Kopf-Adresse (z. B. .msg mit
  // reinem Anzeigenamen) entscheidet der erste Block: ist auch der intern, wird ausgepackt.
  if (headerEmail && !isOwnOperatorEmail(headerEmail)) return unchanged;

  const lines = body.split(/\r?\n/);
  const blocks = findForwardBlocks(lines);
  if (blocks.length === 0) return unchanged;

  const externalIdx = blocks.findIndex((b) => b.fromEmail && !isOwnOperatorEmail(b.fromEmail));
  if (externalIdx < 0) return unchanged;
  if (!headerEmail && externalIdx === 0 && blocks.length === 1) {
    // Kein Hinweis auf interne Weiterleitung — nichts anfassen.
    return unchanged;
  }

  const block = blocks[externalIdx];
  const innerBody = lines.slice(block.bodyStartLine).join("\n").replace(/^\s*\n/, "").trimEnd();
  return {
    from: block.fromLine,
    fromEmail: block.fromEmail,
    subject: stripForwardSubjectPrefixes(block.subject || subject),
    body: innerBody,
    strippedForwardLevels: externalIdx + 1,
  };
}
