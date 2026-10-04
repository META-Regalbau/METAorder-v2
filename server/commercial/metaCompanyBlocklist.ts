/**
 * Zentrale Blockliste für META-eigene Firmen.
 *
 * Diese Firmen sind im Belegfluss IMMER der Empfänger (also delivery_address),
 * NIEMALS der Kunde / buyer. Wenn der Extractor sie versehentlich in
 * `customer` / `billingAddress` einträgt, müssen sie post-extraktion entfernt
 * werden — sonst entstehen Geister-Kunden und automatische Shopware-Anlagen
 * scheitern oder erzeugen Müll.
 *
 * Bewusst restriktiv: nur „META <bekanntes Suffix>" wird geblockt, damit
 * Kunden wie „META Mustermann GmbH" oder „Metaplast GmbH" nicht False-Positive
 * matchen.
 */

/**
 * Anzeigeform für UI / Doku / Prompt — die tatsächlichen Matches laufen
 * über die regulären Ausdrücke unten (tolerant gegen Schreibweisen).
 */
export const META_OWN_COMPANY_NAMES = [
  "META Lagertechnik Ges.m.b.H.",
  "META Online GmbH & Co. KG",
  "META Regalbau GmbH & Co. KG",
  "META-Regalbau",
  "RegalPro",
] as const;

/** „META Regalbau", „META  Lagertechnik", „META Online", „META Shop" (mit oder ohne Bindestrich). */
const META_PREFIX_RE = /\bmeta[\s\-]+(regalbau|lagertechnik|online|shop)\b/i;
/** „META-Regalbau" ohne Whitespace (häufige Schreibweise auf Briefköpfen). */
const META_HYPHEN_RE = /\bmeta-regalbau\b/i;
/** Eigene Marke. Nur als alleinstehender Token matchen, kein Substring. */
const REGALPRO_RE = /\bregalpro\b/i;

export function isMetaOwnCompany(name: string | null | undefined): boolean {
  if (!name) return false;
  const s = name.trim();
  if (!s) return false;
  return META_PREFIX_RE.test(s) || META_HYPHEN_RE.test(s) || REGALPRO_RE.test(s);
}

/**
 * Für Prompt-Komposition: kompakte, kommagetrennte Liste.
 * Wird heute noch nicht im Prompt verwendet (der META-aware Prompt listet die
 * Firmen statisch), aber ist verfügbar, damit zukünftige Prompts dieselbe
 * Quelle der Wahrheit referenzieren können.
 */
export function buildMetaOwnCompaniesPromptHint(): string {
  return META_OWN_COMPANY_NAMES.join(", ");
}
