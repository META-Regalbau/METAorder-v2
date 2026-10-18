/**
 * Shop-Puls Stufe 2 (S2-5): Vorschlag für Meta-Title und Meta-Description einer Seite mit vielen Impressionen
 * und wenig Klicks (Meldung „gscLowCtr“). Nur ein Vorschlag zur Freigabe: METAorder schreibt nichts in den Shop.
 *
 * Grundlage sind der aktuelle Title, die Description, die Überschrift und der sichtbare Text der Seite (ein
 * Abruf der Storefront unter der Sperre des Shop-Wächters) und die Suchanfragen, für die Google die Seite zeigt.
 * Die KI läuft wie die Meta-Texte der Artikel (PR #143): gleiche Längen, gleiche Prüfregeln (keine Aussagen zu
 * Preis, Versand, Lieferzeit, Zertifikaten, Garantie, Oberfläche oder Wettbewerbern, die die Seite nicht selbst
 * macht; keine Zahl, die nicht auf der Seite steht). Durchgefallene Vorschläge werden einmal neu angefragt.
 */
import { z } from "zod";
import { CLAIM_RULES, descriptionText, META_DESCRIPTION_MAX, META_DESCRIPTION_MIN, META_TITLE_MAX, META_TITLE_MIN } from "../products/productMetaTexts";

export type PageMeta = { title: string; description: string; h1: string; text: string };

const attr = (html: string, re: RegExp) => descriptionText(html.match(re)?.[1] ?? "");

/** Title, Description, erste Überschrift und sichtbarer Text (gekürzt) aus dem HTML der Seite */
export function extractPageMeta(html: string): PageMeta {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  return {
    title: attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: attr(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || attr(html, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i),
    h1: attr(body, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    text: descriptionText(body.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? body).slice(0, 2500),
  };
}

export type MetaSuggestion = { metaTitle: string; metaDescription: string };

const digits = (s: string) => new Set((s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((d) => d.replace(",", ".")));

/** Prüfung wie bei den Artikel-Meta-Texten; liefert den Grund oder null */
export function validateSuggestion(page: PageMeta, queries: string[], s: MetaSuggestion): string | null {
  if (s.metaTitle.length < META_TITLE_MIN || s.metaTitle.length > META_TITLE_MAX) return "title_length";
  if (s.metaDescription.length < META_DESCRIPTION_MIN || s.metaDescription.length > META_DESCRIPTION_MAX) return "description_length";
  const source = [page.title, page.description, page.h1, page.text, ...queries].join(" ");
  const text = `${s.metaTitle} ${s.metaDescription}`;
  for (const [pattern, reason] of CLAIM_RULES) {
    if (pattern.test(text) && !pattern.test(source)) return `claim_${reason}`;
  }
  const known = digits(source);
  for (const d of Array.from(digits(text))) if (!known.has(d)) return "number";
  return null;
}

const SYSTEM = [
  "Du schreibst Meta-Title und Meta-Description für eine Seite des Onlineshops von META Regalbau (shop.meta-online.com).",
  "Ziel: mehr Klicks aus der Google-Suche für die Suchanfragen, für die Google die Seite schon zeigt.",
  `Meta-Title ${META_TITLE_MIN}–${META_TITLE_MAX} Zeichen, Meta-Description ${META_DESCRIPTION_MIN}–${META_DESCRIPTION_MAX} Zeichen, Deutsch, sachlich.`,
  "Nur Aussagen, die auf der Seite stehen. Keine Preise, Rabatte, Versand- oder Lieferzeitversprechen, Zertifikate, Garantien, Oberflächen oder Herkunftsangaben, die die Seite nicht selbst nennt. Keine Wettbewerber. Keine Zahl, die nicht auf der Seite steht.",
  'Antworte nur mit JSON: {"metaTitle": "…", "metaDescription": "…"}',
].join("\n");

const responseSchema = z.object({ metaTitle: z.string().trim().min(1), metaDescription: z.string().trim().min(1) });

export type MetaAsk = (messages: Array<{ role: "system" | "user"; content: string }>) => Promise<string>;

/** Vorschlag erzeugen (höchstens zwei Versuche); null mit Grund, wenn beide durchfallen */
export async function suggestPageMeta(
  ask: MetaAsk,
  parse: (raw: string) => unknown,
  input: { url: string; page: PageMeta; queries: string[] },
): Promise<{ suggestion: MetaSuggestion | null; rejected: string | null }> {
  const user = JSON.stringify({
    adresse: input.url,
    aktuellerTitle: input.page.title,
    aktuelleDescription: input.page.description,
    ueberschrift: input.page.h1,
    seitentext: input.page.text,
    suchanfragen: input.queries.slice(0, 20),
  });
  let feedback = "";
  let reason: string | null = "empty";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ask([
      { role: "system", content: SYSTEM },
      { role: "user", content: feedback ? `${user}\nDer letzte Vorschlag fiel durch (${feedback}). Bitte korrigieren.` : user },
    ]);
    const parsed = responseSchema.safeParse(parse(raw));
    if (!parsed.success) {
      reason = "empty";
      feedback = "kein gültiges JSON";
      continue;
    }
    reason = validateSuggestion(input.page, input.queries, parsed.data);
    if (!reason) return { suggestion: parsed.data, rejected: null };
    feedback = reason;
  }
  return { suggestion: null, rejected: reason };
}
