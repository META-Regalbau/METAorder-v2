/**
 * Verteilpostfächer (Modus „route“, z. B. digital-service@ und digitaler-vertrieb@): Ist die Mail eine
 * Produkt- oder Angebotsanfrage (oder Bestellung) eines Kunden? Dann leitet n8n sie an das Shop-Postfach
 * weiter, wo der E-Mail-Eingang den Entwurf anlegt. Alles andere bleibt im Verteilpostfach liegen.
 *
 * Anders als die Vorprüfung im Bestellpostfach (emailIntakeTriage.ts) kommt hier überwiegend Post, die mit
 * Kunden nichts zu tun hat: Agenturen, Dienstleister, Tool-Benachrichtigungen, Rechnungen an META. Die
 * Hauptfalle: Ein Dienstleister bietet META etwas an („Angebot für Ihre SEO“) — das ist keine Anfrage.
 */
import { z } from "zod";
import type { IStorage } from "../storage";
import { chatCompletion, isChatLlmConfigured, parseLlmJsonResponse } from "../ai/llmChat";
import {
  EMAIL_INTAKE_ROUTE_KIND_LABELS,
  EMAIL_INTAKE_ROUTE_KINDS,
  METAORDER_ROUTE_MARKER,
  type EmailIntakeRouteKind,
} from "@shared/emailIntake";
import { triageByHeuristics, type TriageLlm } from "./emailIntakeTriage";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/emailIntakeRouting" });

export type EmailRouteInput = {
  subject: string;
  body: string;
  /** Absender der Kundenmail (nach dem Auspacken interner Weiterleitungen) */
  from: string;
  autoSubmitted?: string | null;
  attachmentNames: string[];
};

export type EmailRouteResult = {
  kind: EmailIntakeRouteKind;
  confidence: number;
  reason: string;
  source: "heuristic" | "llm" | "fallback";
};

/** Wird weitergeleitet (Bestellung, Angebots- oder Produktanfrage)? */
export function isForwardedRouteKind(kind: EmailIntakeRouteKind): boolean {
  return kind !== "other";
}

/** Eindeutige Fälle ohne KI: Abwesenheitsnotizen und Unzustellbarkeitsmeldungen. */
export function routeByHeuristics(input: EmailRouteInput): EmailRouteResult | null {
  const triage = triageByHeuristics({ ...input, draftParts: [], supportingParts: [] });
  if (triage?.kind === "other") return { kind: "other", confidence: triage.confidence, reason: triage.reason, source: "heuristic" };
  return null;
}

const routeSchema = z.object({
  category: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.enum(EMAIL_INTAKE_ROUTE_KINDS),
  ),
  confidence: z.preprocess((v) => {
    const n = typeof v === "string" ? Number(v.replace(",", ".").replace("%", "")) : v;
    return typeof n === "number" && n > 1 && n <= 100 ? n / 100 : n;
  }, z.number().min(0).max(1)),
  reason: z.preprocess((v) => (typeof v === "string" ? v.slice(0, 400) : undefined), z.string().optional()),
});

const ROUTE_SYSTEM = `Du prüfst E-Mails in einem Abteilungspostfach (Digital-Service / digitaler Vertrieb) von META, einem Hersteller von Regalsystemen (Fachboden-, Weitspann-, Paletten-, Kragarm-, Büroregale, Zubehör, Montage).
Gesucht sind Mails von Kunden oder Interessenten, die das Shop-Team bearbeiten muss:

order: Kunde bestellt verbindlich META-Produkte (Bestellung, Auftrag, Purchase Order).
quote_request: Kunde möchte ein Angebot, Preise, Staffelpreise oder Lieferzeit für META-Produkte, schickt eine Stückliste, Maße oder eine Regalplanung.
product_question: Kunde fragt zu META-Produkten (Maße, Tragkraft, Kombinierbarkeit, Zubehör, Ersatzteile, Montage, Verfügbarkeit, welches Regal passt).
other: alles andere, insbesondere:
- Dienstleister, Agenturen oder Verkäufer, die META etwas anbieten (auch wenn „Angebot“ oder „Anfrage“ im Betreff steht)
- Rechnungen, Mahnungen, Verträge an META; Benachrichtigungen von Tools/Plattformen (Google, Shopware, Agenturen, Hosting)
- Rückfragen zu einer bereits laufenden Bestellung oder Lieferung, Reklamationen, Retouren
- interne Abstimmungen, Newsletter, Werbung, Bewerbungen, Spam, Abwesenheitsnotizen

Im Zweifel, ob ein Kunde etwas zu META-Produkten wissen oder kaufen will: wähle die Anfrage mit niedriger confidence.

Antworte NUR mit JSON:
{"category":"order"|"quote_request"|"product_question"|"other","confidence":0.0-1.0,"reason":"kurz, deutsch"}`;

function buildRoutePrompt(input: EmailRouteInput): string {
  return [
    `Absender: ${input.from.slice(0, 200)}`,
    `Betreff: ${input.subject.slice(0, 300)}`,
    "",
    "E-Mail-Text:",
    input.body.slice(0, 4000) || "(leer)",
    input.attachmentNames.length ? `\nAnhänge:\n${input.attachmentNames.slice(0, 20).map((n) => `- ${n}`).join("\n")}` : "\nAnhänge: keine",
  ].join("\n");
}

/** Ergebnis der KI in eine Einordnung übersetzen (rein, testbar). */
export function interpretRouteResponse(raw: string): EmailRouteResult | null {
  const parsed = routeSchema.safeParse(parseLlmJsonResponse(raw));
  if (!parsed.success) return null;
  const { category, confidence, reason } = parsed.data;
  return { kind: category, confidence, reason: reason ?? "", source: "llm" };
}

/**
 * Einordnung im Verteilpostfach. Ohne KI oder bei unbrauchbarer Antwort: „other“ mit Sicherheit 0 — die Mail
 * bleibt im Verteilpostfach, wo sie ohnehin gelesen wird.
 */
export async function routeInboundEmail(storage: IStorage, input: EmailRouteInput, llm?: TriageLlm): Promise<EmailRouteResult> {
  const heuristic = routeByHeuristics(input);
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
  if (!ask) return { kind: "other", confidence: 0, reason: "KI nicht eingerichtet — Mail bleibt im Postfach", source: "fallback" };
  try {
    const result = interpretRouteResponse(await ask(ROUTE_SYSTEM, buildRoutePrompt(input)));
    if (result) return result;
    return { kind: "other", confidence: 0, reason: "KI-Antwort unbrauchbar — Mail bleibt im Postfach", source: "fallback" };
  } catch (err) {
    log.warn({ err }, "[EmailRoute] Einordnung fehlgeschlagen, Mail bleibt im Postfach");
    return { kind: "other", confidence: 0, reason: "KI-Einordnung fehlgeschlagen — Mail bleibt im Postfach", source: "fallback" };
  }
}

/** Hinweis über der weitergeleiteten Mail (Graph `forward` → `comment`). */
export function buildRouteComment(route: EmailRouteResult, mailbox: string | null, customerEmail: string | null): string {
  const text = route.reason.trim();
  const reason = text ? ` Begründung: ${text}${/[.!?]$/.test(text) ? "" : "."}` : "";
  const origin = mailbox ? ` im Postfach ${mailbox}` : "";
  // Graph setzt das Verteilpostfach als Absender: „Antworten“ in Outlook ginge dorthin, nicht zum Kunden
  const replyHint = customerEmail ? ` Antworten bitte direkt an den Kunden: ${customerEmail}.` : "";
  return (
    `${METAORDER_ROUTE_MARKER}${origin} ` +
    `(Einordnung: ${EMAIL_INTAKE_ROUTE_KIND_LABELS[route.kind]}, Sicherheit ${Math.round(route.confidence * 100)} %).${reason}` +
    replyHint
  );
}
