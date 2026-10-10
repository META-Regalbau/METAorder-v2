/**
 * Vorprüfung einer eingehenden Mail (n8n-Abruf): Ist das überhaupt eine Bestellung oder
 * Anfrage, oder etwas anderes (Rechnung, Reklamation, Newsletter, Abwesenheitsnotiz …)?
 *
 * Bisher wurde aus allem, was keine Bestellung war, ein Angebotsentwurf. „Sonstiges“ wird jetzt
 * vor der Entwurfs-Pipeline erkannt und von n8n weitergeleitet. Im Zweifel geht die Mail in die
 * Pipeline: ein überflüssiger Entwurf wird geprüft und gelöscht, eine verschluckte Bestellung
 * fällt dagegen niemandem auf.
 */
import { z } from "zod";
import type { IStorage } from "../storage";
import type { AttachmentClassification } from "./commercialAttachmentClassifier";
import { chatCompletion, isChatLlmConfigured, parseLlmJsonResponse } from "../ai/llmChat";
import { EMAIL_INTAKE_OTHER_TYPES, type EmailIntakeOtherType } from "@shared/emailIntake";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/emailIntakeTriage" });

export type EmailTriageInput = {
  subject: string;
  body: string;
  from: string;
  /** Kopfzeile Auto-Submitted (RFC 3834); gesetzt bei Abwesenheitsnotizen und Systemmails */
  autoSubmitted?: string | null;
  /** Anhänge, aus denen ein Entwurf entstünde, mit Belegart */
  draftParts: Array<{ filename: string; classification?: AttachmentClassification }>;
  /** Anhänge, die nur Beilage wären (Rechnung, Lieferschein, AB) */
  supportingParts: Array<{ filename: string; kind: string }>;
  /** Textauszug der Entwurfs-Anhänge */
  documentTextPreview?: string;
};

export type EmailTriageResult =
  | { kind: "commercial"; confidence: number; reason: string; source: "heuristic" | "llm" | "fallback" }
  | {
      kind: "other";
      otherType: EmailIntakeOtherType;
      confidence: number;
      reason: string;
      source: "heuristic" | "llm";
    };

const AUTO_REPLY_SUBJECT_RE =
  /^\s*(automatische antwort|abwesenheitsnotiz|abwesenheit|out of office|automatic reply|auto(?:matic)?[- ]?reply|autoreply|auto:|réponse automatique|risposta automatica|respuesta automática)\b/i;
const BOUNCE_FROM_RE = /\b(mailer-daemon|postmaster)@/i;
const BOUNCE_SUBJECT_RE = /^\s*(unzustellbar|undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail)\b/i;

/** Eindeutige Fälle ohne KI. null = weiter mit der KI-Einordnung. */
export function triageByHeuristics(input: EmailTriageInput): EmailTriageResult | null {
  const autoSubmitted = (input.autoSubmitted ?? "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") {
    return { kind: "other", otherType: "auto_reply", confidence: 0.99, reason: `Kopfzeile Auto-Submitted: ${autoSubmitted}`, source: "heuristic" };
  }
  if (AUTO_REPLY_SUBJECT_RE.test(input.subject)) {
    return { kind: "other", otherType: "auto_reply", confidence: 0.95, reason: "Betreff einer automatischen Antwort", source: "heuristic" };
  }
  if (BOUNCE_FROM_RE.test(input.from) || BOUNCE_SUBJECT_RE.test(input.subject)) {
    return { kind: "other", otherType: "general", confidence: 0.95, reason: "Unzustellbarkeitsmeldung", source: "heuristic" };
  }
  // Ein Anhang mit Belegtitel „Bestellung“/„Anfrage“ ist sicher Geschäft — keine KI nötig
  const titled = input.draftParts.find(
    (p) => p.classification?.kind === "purchase_order" && p.classification.signals.includes("title_bestellung"),
  );
  if (titled) {
    return { kind: "commercial", confidence: 0.95, reason: `Anhang ${titled.filename} trägt den Titel einer Bestellung/Anfrage`, source: "heuristic" };
  }
  return null;
}

const triageSchema = z.object({
  category: z.enum(["order", "quote_request", "other"]),
  otherType: z.enum(EMAIL_INTAKE_OTHER_TYPES).optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(400).optional(),
});

const TRIAGE_SYSTEM = `Du sortierst eingehende E-Mails eines B2B-Herstellers (Regalsysteme) im Bestell-Postfach.

order: Kunde bestellt verbindlich (Bestellung, Auftrag, Purchase Order).
quote_request: Kunde möchte ein Angebot, Preise, Verfügbarkeit oder schickt eine Stückliste/Anfrage zu Artikeln.
other: alles andere, z. B. Rechnungen oder Zahlungsavis (invoice), Lieferscheine/Versandmeldungen/Auftragsbestätigungen von Lieferanten (delivery), Rückfragen zu einer bereits laufenden Bestellung oder Lieferung (order_status), Reklamationen/Retouren (complaint), Newsletter/Werbung (newsletter), Abwesenheitsnotizen (auto_reply), Bewerbungen (application), Spam (spam), sonstige Nachrichten (general).

Wichtig: Eine Rückfrage zu einer BESTEHENDEN Bestellung („wann kommt die Lieferung?“, „bitte Lieferadresse ändern“) ist other/order_status. Eine NEUE Anfrage oder Nachbestellung ist order bzw. quote_request.
Im Zweifel zwischen Geschäft und other: wähle order oder quote_request mit niedriger confidence.

Antworte NUR mit JSON:
{"category":"order"|"quote_request"|"other","otherType":"invoice"|"delivery"|"order_status"|"complaint"|"newsletter"|"auto_reply"|"application"|"spam"|"general","confidence":0.0-1.0,"reason":"kurz, deutsch"}`;

function buildTriagePrompt(input: EmailTriageInput): string {
  const attachments = [
    ...input.draftParts.map((p) => `- ${p.filename}${p.classification ? ` (Belegart: ${p.classification.kind})` : ""}`),
    ...input.supportingParts.map((p) => `- ${p.filename} (Belegart: ${p.kind})`),
  ];
  return [
    `Absender: ${input.from.slice(0, 200)}`,
    `Betreff: ${input.subject.slice(0, 300)}`,
    "",
    "E-Mail-Text:",
    input.body.slice(0, 4000) || "(leer)",
    attachments.length ? `\nAnhänge:\n${attachments.join("\n")}` : "\nAnhänge: keine",
    input.documentTextPreview?.trim() ? `\nAuszug aus den Anhängen:\n${input.documentTextPreview.slice(0, 2500)}` : "",
  ].join("\n");
}

export type TriageLlm = (system: string, user: string) => Promise<string>;

/** Ergebnis der KI in eine Einordnung übersetzen (rein, testbar). */
export function interpretTriageResponse(raw: string): EmailTriageResult | null {
  const parsed = triageSchema.safeParse(parseLlmJsonResponse(raw));
  if (!parsed.success) return null;
  const { category, otherType, confidence, reason } = parsed.data;
  if (category === "other") {
    return { kind: "other", otherType: otherType ?? "general", confidence, reason: reason ?? "", source: "llm" };
  }
  return { kind: "commercial", confidence, reason: reason ?? category, source: "llm" };
}

export async function triageInboundEmail(
  storage: IStorage,
  input: EmailTriageInput,
  llm?: TriageLlm,
): Promise<EmailTriageResult> {
  const heuristic = triageByHeuristics(input);
  if (heuristic) return heuristic;

  const getSetting = storage.getSetting.bind(storage);
  const ask: TriageLlm | null =
    llm ??
    ((await isChatLlmConfigured(getSetting))
      ? (system, user) =>
          chatCompletion(getSetting, {
            tier: "fast",
            temperature: 0,
            response_json: true,
            max_tokens: 300,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          })
      : null);
  if (!ask) {
    return { kind: "commercial", confidence: 0, reason: "KI nicht eingerichtet — Mail geht in die Entwurfs-Pipeline", source: "fallback" };
  }
  try {
    const result = interpretTriageResponse(await ask(TRIAGE_SYSTEM, buildTriagePrompt(input)));
    if (result) return result;
    return { kind: "commercial", confidence: 0, reason: "KI-Antwort unbrauchbar — Mail geht in die Entwurfs-Pipeline", source: "fallback" };
  } catch (err) {
    log.warn({ err }, "[EmailTriage] Einordnung fehlgeschlagen, Mail geht in die Entwurfs-Pipeline");
    return { kind: "commercial", confidence: 0, reason: "KI-Einordnung fehlgeschlagen — Mail geht in die Entwurfs-Pipeline", source: "fallback" };
  }
}
