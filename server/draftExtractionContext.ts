import { redactPII, sanitizeDocumentText, truncateText } from "./aiTextUtils";

export type DraftExtractionMailContext = {
  /** Betreff + Text der zugehörigen E-Mail */
  emailContext?: string;
  /** Kombinierter Text weiterer Anhänge derselben Nachricht (Commercial Agent) */
  siblingPdfExcerpts?: string;
};

/**
 * Hauptdokument + E-Mail + weitere Dokumentauszüge zu einem Prompt für Extraktion zusammenführen
 * (innerhalb maxChars, Anteil grob: 45 % / 27,5 % / 27,5 %).
 */
export function mergeDraftExtractionSources(
  primaryDocumentRaw: string,
  maxChars: number,
  extras?: DraftExtractionMailContext,
  applyRedactPii?: boolean
): string {
  const redact = applyRedactPii ? redactPII : (s: string) => s;
  const clean = (s: string) => redact(sanitizeDocumentText(s));

  const email = extras?.emailContext?.trim() ? clean(extras.emailContext) : "";
  const sibling = extras?.siblingPdfExcerpts?.trim() ? clean(extras.siblingPdfExcerpts) : "";

  const budgetPrimary = Math.max(2000, Math.floor(maxChars * 0.45));
  const budgetEmail = email ? Math.max(500, Math.floor(maxChars * 0.275)) : 0;
  const budgetSibling = sibling ? Math.max(500, Math.floor(maxChars * 0.275)) : 0;

  let primary = truncateText(clean(primaryDocumentRaw), budgetPrimary);
  let out = `[Hauptdokument]\n${primary}`;

  if (email) {
    out += `\n\n[E-Mail derselben Anfrage]\n${truncateText(email, budgetEmail)}`;
  }
  if (sibling) {
    out += `\n\n[Weitere Dokumentauszüge derselben E-Mail]\n${truncateText(sibling, budgetSibling)}`;
  }

  return truncateText(out, maxChars);
}

/** Nur E-Mail + weitere Dokumentauszüge (z. B. vor Vision-Bild ohne Fließtext). */
export function mergeEmailAndSiblingExcerptsOnly(
  maxChars: number,
  extras?: DraftExtractionMailContext,
  applyRedactPii?: boolean
): string {
  if (!extras?.emailContext?.trim() && !extras?.siblingPdfExcerpts?.trim()) return "";
  const redact = applyRedactPii ? redactPII : (s: string) => s;
  const clean = (s: string) => redact(sanitizeDocumentText(s));
  const email = extras?.emailContext?.trim()
    ? truncateText(clean(extras.emailContext), Math.floor(maxChars * 0.5))
    : "";
  const sibling = extras?.siblingPdfExcerpts?.trim()
    ? truncateText(clean(extras.siblingPdfExcerpts), Math.floor(maxChars * 0.5))
    : "";
  const parts: string[] = [];
  if (email) parts.push(`[E-Mail derselben Anfrage]\n${email}`);
  if (sibling) parts.push(`[Weitere Dokumentauszüge derselben E-Mail]\n${sibling}`);
  return truncateText(parts.join("\n\n"), maxChars);
}
