/**
 * Portal-Neuigkeiten: aus einer Changelog-Mail einen Beitrag für interne Mitarbeiter machen.
 *
 * Die KI schreibt verständlich um (was ist neu, was ändert sich im Alltag), lässt Technik-Details weg
 * (Ticket- und Versionsnummern, Plugin-/Klassennamen) und übernimmt nur, was in der Mail steht. Ohne KI
 * gliedern feste Regeln die Mail grob (Betreff als Titel, Aufzählungszeilen als Punkte) – das Ergebnis
 * bleibt dann ein Entwurf.
 */
import { z } from "zod";
import type { IStorage } from "../storage";
import { chatCompletion, isChatLlmConfigured, parseLlmJsonResponse } from "../ai/llmChat";
import type { PortalNewsContent, PortalNewsSection } from "@shared/portalNews";
import { logger } from "../lib/logger";

const log = logger.child({ component: "b2b/portalNewsExtraction" });

export type PortalNewsExtraction = {
  content: PortalNewsContent;
  /** Ist das überhaupt ein Changelog / eine Systemänderung? */
  isChangelog: boolean;
  /** 0–1 */
  confidence: number;
  source: "ai" | "rules";
  /** Begründung bzw. was unklar ist */
  reason: string | null;
};

export type NewsLlm = (system: string, user: string) => Promise<string>;

const SYSTEM_PROMPT = `Du schreibst Beiträge für die interne Seite „Neuigkeiten“ im Händlerportal von META (Regalbau). Leser sind META-Mitarbeiter aus Vertrieb, Innendienst und Kundenservice – keine Entwickler.

Grundlage ist eine Changelog-Mail der Entwickler (Shop/Portal, Regalplaner bzw. Konfigurator und andere Systeme), oft von Kollegen weitergeleitet. Regeln:
- Die ganze Mail lesen, auch weitergeleitete und zitierte Teile. Enthält sie mehrere Changelogs (z. B. Regalplaner-Version und Shop-Release), gehören ALLE in den Beitrag – keinen auslassen.
- Nur Inhalte aus der Mail. Nichts erfinden, nichts ergänzen, keine Vermutungen über Gründe oder Folgen, die nicht in der Mail stehen.
- Verständlich umschreiben: was ist neu, was hat sich geändert, was wurde behoben – aus Sicht der Nutzer (Shop, Portal, Regalplaner, Bestellungen, Kunden).
- Ticketlisten („MC40-1164 – Einbindung des Konfigurators …“) sind Änderungen: jeden Eintrag ohne Nummer in einen verständlichen Satz fassen. Nur so viel sagen, wie der Titel hergibt; bei knappen Titeln knapp bleiben („Fehler bei Türen im CLIP behoben.“).
- Punkte, die laut Mail ausdrücklich noch nicht im Release sind (z. B. „noch nicht enthalten“, „bleiben zunächst beim Dienstleister“), weglassen.
- Technik-Details weglassen: Ticket-/Issue-Nummern, Versionsnummern, Plugin-, Klassen- oder Dateinamen, Commit-Hashes, Server, Testsysteme, Zertifikate, Deployments, Cache, Code-Begriffe. Steht in einem Punkt nur Technik ohne erkennbare Wirkung für Nutzer, lass ihn weg.
- Anrede, Grüße, Signaturen, Weiterleitungsköpfe und interne Absprachen (Rechnung, Aufwand, Meetings, Termine der Entwickler) weglassen.
- Deutsch, sachlich, kurze Sätze, kein Marketing, keine Emojis. Fachbegriffe aus dem META-Alltag (Händlerportal, Angebot, Warenkorb, Konfigurator, Regalplaner, Raumplaner, Artikelnummer, Systemnamen wie CLIP oder MULTIPAL) bleiben.
- title: kurze Überschrift, die das Wichtigste nennt (höchstens 80 Zeichen, kein Datum).
- summary: 1–2 Sätze, worum es geht (bei mehreren Changelogs alle Systeme nennen).
- sections: Ein System → Gruppen „Neu“, „Verbessert“, „Behoben“. Mehrere Systeme → je System Gruppen mit Überschrift „<System>: Neu“, „<System>: Behoben“ usw. (z. B. „Regalplaner: Behoben“, „Händlerportal und Onlineshop: Neu“). Je Punkt ein Satz oder zwei. Leere Gruppen weglassen.
- tags: 1–3 Bereiche, die betroffen sind, z. B. „Onlineshop“, „Händlerportal“, „Regalplaner“, „Bestellungen“.
- postDate: Datum der Änderung (JJJJ-MM-TT) nur, wenn die Mail es ausdrücklich nennt (z. B. „Release vom 20.10.2026“), sonst null.
- isChangelog: true, wenn die Mail Änderungen an Shop, Portal oder Systemen beschreibt. Rückfragen, Angebote, Rechnungen, Terminabsprachen ohne Änderungsliste: false.

Antworte NUR mit JSON:
{"isChangelog":true|false,"confidence":0.0-1.0,"reason":"kurz, deutsch","title":"…","summary":"…","sections":[{"heading":"Neu","items":["…"]}],"tags":["…"],"postDate":"JJJJ-MM-TT"|null}`;

const llmSchema = z.object({
  isChangelog: z.boolean(),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  reason: z.string().nullable().optional().catch(null),
  title: z.string().catch(""),
  summary: z.string().nullable().optional().catch(""),
  sections: z
    .array(
      z.object({
        heading: z.string().nullable().optional().catch(""),
        items: z.array(z.string()).catch([]),
      }),
    )
    .catch([]),
  tags: z.array(z.string()).catch([]),
  postDate: z.string().nullable().optional().catch(null),
});

export function buildNewsPrompt(input: { from: string; subject: string; body: string }): string {
  return [`Absender: ${input.from.slice(0, 200)}`, `Betreff: ${input.subject.slice(0, 300)}`, "", "E-Mail-Text:", input.body.slice(0, 16000) || "(leer)"].join(
    "\n",
  );
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Abschnitte bereinigen: leere Punkte und Gruppen raus, Längen kappen */
export function cleanSections(sections: Array<{ heading?: string | null; items: string[] }>): PortalNewsSection[] {
  return sections
    .map((s) => ({
      heading: clip((s.heading ?? "").trim(), 120),
      items: s.items.map((i) => clip(i.replace(/\s+/g, " ").trim(), 1000)).filter(Boolean).slice(0, 40),
    }))
    .filter((s) => s.items.length > 0)
    .slice(0, 12);
}

/** Datum nur übernehmen, wenn es ein echter Kalendertag ist und nicht weit vom Eingang entfernt liegt */
export function plausiblePostDate(candidate: string | null | undefined, fallback: string): string {
  if (!candidate || !DATE_RE.test(candidate)) return fallback;
  const d = new Date(`${candidate}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== candidate) return fallback;
  const days = Math.abs(d.getTime() - new Date(`${fallback}T12:00:00Z`).getTime()) / 86_400_000;
  return days <= 60 ? candidate : fallback;
}

/** KI-Antwort lesen (rein, testbar); null = unbrauchbar */
export function interpretNewsResponse(raw: string, receivedDate: string): Omit<PortalNewsExtraction, "source"> | null {
  const json = parseLlmJsonResponse(raw);
  if (!json || typeof json !== "object" || !("isChangelog" in json)) return null;
  const parsed = llmSchema.safeParse(json);
  if (!parsed.success) return null;
  const p = parsed.data;
  const sections = cleanSections(p.sections);
  const title = clip(p.title.trim(), 200);
  // Ohne Titel oder Punkte taugt der Beitrag nicht für die Seite
  if (p.isChangelog && (!title || !sections.length)) return null;
  return {
    isChangelog: p.isChangelog,
    confidence: p.confidence,
    reason: p.reason?.trim() || null,
    content: {
      postDate: plausiblePostDate(p.postDate, receivedDate),
      title: title || "Neuigkeit",
      summary: clip((p.summary ?? "").trim(), 1000),
      sections,
      tags: [...new Set(p.tags.map((t) => clip(t.trim(), 40)).filter(Boolean))].slice(0, 4),
    },
  };
}

const SUBJECT_PREFIX_RE = /^\s*((?:aw|wg|re|fw|fwd|antw|weiterleitung)\s*:\s*)+/i;
const BULLET_RE = /^\s*(?:[-*•–·]|\d{1,2}[.)])\s+(.+)$/;
const SIGNATURE_RE = /^\s*(?:--\s*$|viele grüße|beste grüße|mit freundlichen grüßen|freundliche grüße|lg\b|vg\b|gruß)/i;

export function cleanSubject(subject: string): string {
  return subject.replace(SUBJECT_PREFIX_RE, "").trim();
}

/** Ohne KI: Betreff als Titel, Aufzählungszeilen als Punkte (bis zur Signatur) */
export function extractNewsByRules(input: { subject: string; body: string }, receivedDate: string): Omit<PortalNewsExtraction, "source"> {
  const items: string[] = [];
  for (const line of input.body.split(/\r?\n/)) {
    if (SIGNATURE_RE.test(line)) break;
    const m = line.match(BULLET_RE);
    if (m) items.push(m[1]);
  }
  const title = clip(cleanSubject(input.subject) || "Neuigkeit", 200);
  return {
    isChangelog: items.length > 0,
    confidence: items.length > 0 ? 0.4 : 0.1,
    reason: null,
    content: {
      postDate: receivedDate,
      title,
      summary: "",
      sections: cleanSections([{ heading: "Änderungen", items }]),
      tags: [],
    },
  };
}

export async function extractPortalNews(
  storage: Pick<IStorage, "getSetting">,
  input: { from: string; subject: string; body: string; receivedDate: string },
  llm?: NewsLlm,
): Promise<PortalNewsExtraction> {
  const getSetting = storage.getSetting.bind(storage);
  const ask: NewsLlm | null =
    llm ??
    ((await isChatLlmConfigured(getSetting))
      ? (system, user) =>
          chatCompletion(getSetting, {
            tier: "smart",
            temperature: 0.2,
            response_json: true,
            // Ticketlisten mit 20–30 Einträgen brauchen Platz
            max_tokens: 5000,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          })
      : null);

  if (ask) {
    try {
      const ai = interpretNewsResponse(await ask(SYSTEM_PROMPT, buildNewsPrompt(input)), input.receivedDate);
      if (ai) return { ...ai, source: "ai" };
      log.warn({ subject: input.subject }, "[PortalNews] KI-Antwort unbrauchbar, nur Regeln");
    } catch (err) {
      log.warn({ err, subject: input.subject }, "[PortalNews] KI-Umschreiben fehlgeschlagen, nur Regeln");
    }
  }
  const rules = extractNewsByRules(input, input.receivedDate);
  return {
    ...rules,
    source: "rules",
    reason: ask ? "KI-Umschreiben nicht möglich – Text nur grob gegliedert" : "KI nicht eingerichtet – Text nur grob gegliedert",
  };
}
