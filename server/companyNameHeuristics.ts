/**
 * Deterministische Firmenname-Heuristik (offline, ohne LLM).
 *
 * Findet Firmenkandidaten in Freitext anhand bekannter Rechtsform-Suffixe
 * (GmbH, AG, e.K., S.r.l., Inc. …) und bewertet sie nach Stärke, Häufigkeit,
 * Footer-Nähe und optionaler Übereinstimmung mit der Absender-E-Mail-Domain.
 *
 * Wird als Sicherheitsnetz vor/neben der LLM-Extraktion eingesetzt:
 * - LLM kann den Firmennamen aus Briefkopf/Footer hallunzinieren oder
 *   übersehen, gerade wenn der Footer in Italian/English/etc. steht.
 * - Diese Heuristik liefert einen reproduzierbaren Fallback, ohne API-Kosten,
 *   und lässt sich punktgenau testen.
 *
 * Bewusst restriktiv: lieber null zurückgeben als raten. Aufrufer überschreiben
 * mit dem Ergebnis nur leere `company`-Felder.
 *
 * Tests: scripts/testCompanyNameHeuristics.ts
 */

import { isMetaOwnCompany } from "./metaCompanyBlocklist";

export const COMPANY_NAME_HEURISTICS_VERSION = "2";

/**
 * Kanonisierte Rechtsform-Suffixe mit Stärke-Gewicht.
 *
 * Stärke (`weight`):
 *  - 3: kombiniertes/zusammengesetztes Suffix (z. B. "GmbH & Co. KG"),
 *       sehr eindeutig, kaum falsche Treffer
 *  - 2: klassische Einzel-Rechtsformen (GmbH, AG, KG, e.K., S.r.l., Inc., Ltd.)
 *  - 1: schwächere/kurze Formen (UG, SE, GbR, AB) – noch hilfreich, aber
 *       leichter mit Abkürzungen verwechselbar
 */
type LegalFormSuffix = {
  /** Anzeige-Form (genau wie in einer Visitenkarte gedruckt). */
  display: string;
  /** Pattern-Stück für den Match. Muss als RegExp-Quelle gültig sein. */
  pattern: string;
  weight: 1 | 2 | 3;
};

const LEGAL_FORM_SUFFIXES: LegalFormSuffix[] = [
  // Zusammengesetzte deutsche Suffixe (am ehesten am Ende, sehr stark) — VOR
  // den kürzeren Varianten matchen, damit "GmbH & Co. KG" nicht nur als "KG"
  // erkannt wird.
  { display: "GmbH & Co. KG", pattern: "GmbH\\s*&\\s*Co\\.?\\s*KG", weight: 3 },
  { display: "GmbH & Co. KGaA", pattern: "GmbH\\s*&\\s*Co\\.?\\s*KGaA", weight: 3 },
  { display: "AG & Co. KG", pattern: "AG\\s*&\\s*Co\\.?\\s*KG", weight: 3 },
  { display: "AG & Co. KGaA", pattern: "AG\\s*&\\s*Co\\.?\\s*KGaA", weight: 3 },
  { display: "GmbH & Co. OHG", pattern: "GmbH\\s*&\\s*Co\\.?\\s*OHG", weight: 3 },
  { display: "Ges.m.b.H.", pattern: "Ges\\.?\\s*m\\.?\\s*b\\.?\\s*H\\.?", weight: 3 },
  { display: "Ges. n. b. R.", pattern: "Ges\\.?\\s*n\\.?\\s*b\\.?\\s*R\\.?", weight: 2 },
  // Deutsche Standard-Rechtsformen
  { display: "GmbH", pattern: "GmbH", weight: 2 },
  { display: "gGmbH", pattern: "gGmbH", weight: 2 },
  { display: "mbH", pattern: "mbH", weight: 2 },
  { display: "AG", pattern: "AG", weight: 2 },
  { display: "KGaA", pattern: "KGaA", weight: 2 },
  { display: "KG", pattern: "KG", weight: 2 },
  { display: "OHG", pattern: "OHG", weight: 2 },
  { display: "GbR", pattern: "GbR", weight: 1 },
  { display: "e.K.", pattern: "e\\.?\\s*K\\.?", weight: 2 },
  { display: "e.Kfm.", pattern: "e\\.?\\s*Kfm\\.?", weight: 2 },
  { display: "e.Kfr.", pattern: "e\\.?\\s*Kfr\\.?", weight: 2 },
  { display: "UG (haftungsbeschränkt)", pattern: "UG\\s*\\(haftungsbeschr[äa]nkt\\)", weight: 3 },
  { display: "UG", pattern: "UG", weight: 1 },
  { display: "SE", pattern: "SE", weight: 1 },
  { display: "e.G.", pattern: "e\\.?\\s*G\\.?", weight: 2 },
  { display: "e.V.", pattern: "e\\.?\\s*V\\.?", weight: 2 },
  { display: "Stiftung", pattern: "Stiftung", weight: 1 },
  // Schweiz
  { display: "AG", pattern: "Aktiengesellschaft", weight: 2 },
  // Italienisch (relevant: Südtirol, IT-Lieferanten wie GROHE Bruneck)
  { display: "S.r.l.", pattern: "S\\.?\\s*r\\.?\\s*l\\.?", weight: 2 },
  { display: "S.r.l.s.", pattern: "S\\.?\\s*r\\.?\\s*l\\.?\\s*s\\.?", weight: 2 },
  { display: "S.p.A.", pattern: "S\\.?\\s*p\\.?\\s*A\\.?", weight: 2 },
  { display: "S.a.s.", pattern: "S\\.?\\s*a\\.?\\s*s\\.?", weight: 2 },
  { display: "S.n.c.", pattern: "S\\.?\\s*n\\.?\\s*c\\.?", weight: 2 },
  // Französisch / Belgien / Luxemburg
  { display: "S.A.", pattern: "S\\.?\\s*A\\.?", weight: 2 },
  { display: "S.A.S.", pattern: "S\\.?\\s*A\\.?\\s*S\\.?", weight: 2 },
  { display: "S.A.R.L.", pattern: "S\\.?\\s*A\\.?\\s*R\\.?\\s*L\\.?", weight: 2 },
  { display: "S.A.U.", pattern: "S\\.?\\s*A\\.?\\s*U\\.?", weight: 2 },
  { display: "SARL", pattern: "SARL", weight: 2 },
  { display: "SAS", pattern: "SAS", weight: 1 },
  { display: "EURL", pattern: "EURL", weight: 2 },
  { display: "SCS", pattern: "SCS", weight: 1 },
  // Spanisch / Portugiesisch
  { display: "S.L.", pattern: "S\\.?\\s*L\\.?", weight: 2 },
  { display: "S.L.U.", pattern: "S\\.?\\s*L\\.?\\s*U\\.?", weight: 2 },
  { display: "Lda.", pattern: "Lda\\.?", weight: 2 },
  // Niederlande / Belgien
  { display: "B.V.", pattern: "B\\.?\\s*V\\.?", weight: 2 },
  { display: "N.V.", pattern: "N\\.?\\s*V\\.?", weight: 2 },
  { display: "BVBA", pattern: "BVBA", weight: 2 },
  // Skandinavien
  { display: "AB", pattern: "AB", weight: 1 },
  { display: "AS", pattern: "AS", weight: 1 },
  { display: "ApS", pattern: "ApS", weight: 2 },
  { display: "A/S", pattern: "A/S", weight: 2 },
  { display: "Oy", pattern: "Oy", weight: 1 },
  // UK / IE
  { display: "Ltd.", pattern: "Ltd\\.?", weight: 2 },
  { display: "Limited", pattern: "Limited", weight: 2 },
  { display: "PLC", pattern: "PLC", weight: 2 },
  { display: "LLP", pattern: "LLP", weight: 2 },
  // US / CA
  { display: "Inc.", pattern: "Inc\\.?", weight: 2 },
  { display: "Incorporated", pattern: "Incorporated", weight: 2 },
  { display: "LLC", pattern: "LLC", weight: 2 },
  { display: "Corp.", pattern: "Corp\\.?", weight: 2 },
  { display: "Corporation", pattern: "Corporation", weight: 2 },
  { display: "Co.", pattern: "Co\\.?", weight: 1 },
  // AU / Asien
  { display: "Pty Ltd", pattern: "Pty\\s*Ltd\\.?", weight: 3 },
  { display: "Pty", pattern: "Pty\\.?", weight: 1 },
];

/**
 * Marker-Phrasen, die auf den Beginn eines E-Mail-Signatur-Footers hindeuten.
 * Treffer in einem Bereich kurz nach einem Marker bekommen einen Bonus.
 */
const FOOTER_MARKER_PATTERNS: string[] = [
  // Deutsch
  "mit freundlichen gr[üu]ßen",
  "mit besten gr[üu]ßen",
  "mit den besten gr[üu]ßen",
  "beste gr[üu]ße",
  "liebe gr[üu]ße",
  "viele gr[üu]ße",
  "freundliche gr[üu]ße",
  "freundlich gr[üu]ßt",
  "herzliche gr[üu]ße",
  "mfg",
  "lg",
  "vg",
  // Englisch
  "best regards",
  "kind regards",
  "regards,",
  "sincerely",
  "yours sincerely",
  "yours truly",
  "thanks (and )?regards",
  "many thanks",
  // Italienisch
  "cordiali saluti",
  "distinti saluti",
  "saluti,",
  // Französisch
  "cordialement",
  "bien cordialement",
  "salutations distingu[ée]es",
  // Spanisch / Portugiesisch
  "saludos cordiales",
  "atentamente",
  "atenciosamente",
];

const FOOTER_MARKER_RE = new RegExp(`(${FOOTER_MARKER_PATTERNS.join("|")})`, "gi");

/**
 * Erlaubte Zeichen für den eigentlichen Firmennamen (vor dem Suffix).
 * Bewusst restriktiv — bricht bei Newline, ":", "|", "<", "@", "/", "\\", Tab.
 * Whitespace ohne Newline (\\t schon nicht enthalten, NUR Leerzeichen).
 */
const NAME_CHAR_CLASS = String.raw`[\p{L}\p{N}&\.\-'’,()/ ]`;

/**
 * Gibt die globale Regex zurück, die ALLE Suffix-Varianten greift.
 * Wir bauen sie genau einmal, weil der Pattern-Build nicht ganz billig ist.
 */
let cachedSuffixRegex: RegExp | null = null;
function getSuffixRegex(): RegExp {
  if (cachedSuffixRegex) return cachedSuffixRegex;
  // Sortierung wichtig: längere/zusammengesetzte Suffixe ZUERST.
  // Sonst matcht "KG" einen "GmbH & Co. KG"-Footer fälschlich auf den
  // Co.-Teil und das vorangestellte "GmbH" geht für den Namen verloren.
  const sorted = [...LEGAL_FORM_SUFFIXES].sort(
    (a, b) => b.pattern.length - a.pattern.length
  );
  const alt = sorted.map((s) => `(?:${s.pattern})`).join("|");
  // Lookbehind verhindert, dass "AG" mitten in einem Wort matcht ("Tag", "Lager").
  // Lookahead sichert ein Wort-Ende (Whitespace, Komma, Klammer, Punkt, EOL).
  cachedSuffixRegex = new RegExp(
    `(?<=^|[\\s\\.,;:!\\?\\(\\)\\[\\]"”'’<>«»\\-])(${alt})(?=$|[\\s\\.,;:!\\?\\(\\)\\[\\]"”'’<>«»])`,
    "gu"
  );
  return cachedSuffixRegex;
}

/** Maps eine Pattern-Quelle wieder auf das Anzeige-Suffix. */
function findSuffixMeta(matchedRaw: string): LegalFormSuffix | null {
  const normalized = matchedRaw.replace(/\s+/g, "").toLowerCase();
  // Reihenfolge: längere/zusammengesetzte zuerst, damit "GmbH & Co. KG" gewinnt.
  const sorted = [...LEGAL_FORM_SUFFIXES].sort(
    (a, b) => b.pattern.length - a.pattern.length
  );
  for (const s of sorted) {
    const probe = new RegExp(`^(?:${s.pattern})$`, "iu");
    if (probe.test(matchedRaw)) return s;
    // Toleranter Fallback ohne Whitespace, falls "Ges. m. b. H." → "Ges.m.b.H."
    const probeStripped = new RegExp(`^(?:${s.pattern.replace(/\\s\*/g, "")})$`, "iu");
    if (probeStripped.test(normalized.replace(/\./g, ""))) {
      return s;
    }
  }
  return null;
}

export type CompanyNameCandidate = {
  /** Komplett-Form mit Suffix, z. B. "Grohe GmbH". */
  display: string;
  /** Erkanntes Suffix in Anzeige-Schreibweise. */
  suffix: string;
  /** Gewicht des Suffixes (siehe LegalFormSuffix). */
  suffixWeight: 1 | 2 | 3;
  /** Wie oft im Text gefunden (höher = stärker). */
  occurrences: number;
  /** Steht (mindestens einmal) im Footer-Bereich nach einem Marker. */
  inFooter: boolean;
  /** Slug der Firma (a-z0-9), genutzt für Domain-Vergleich. */
  slug: string;
  /** Optionaler Bonus, wenn der Slug in einer Sender-Domain steckt. */
  matchesEmailDomain: boolean;
  /** Aggregierter Score (höher = besser). */
  score: number;
  /** Quelle, in der zuerst gefunden — nur informativ. */
  source: string;
};

export type CompanyNameHeuristicResult = {
  top: CompanyNameCandidate | null;
  candidates: CompanyNameCandidate[];
  /** Slug der Absender-Domain, falls bekannt. */
  emailDomainSlug?: string;
  /** Adressblock, der typischerweise zusammen mit dem Firmennamen im Footer steht. */
  address: SignatureAddressBlock;
  version: string;
};

/**
 * Aggregierte Adress-/Kontakt-Felder aus Footer/Briefkopf.
 * Alle Felder optional — gibt nur das zurück, was wirklich sicher gefunden wurde.
 */
export type SignatureAddressBlock = {
  street?: string;
  zipCode?: string;
  city?: string;
  /** ISO-2-Code (DE, AT, CH, IT, FR, …) — wird aus PLZ-Präfix oder Ländertext abgeleitet. */
  country?: string;
  phone?: string;
  email?: string;
  /**
   * Roh-Token-Sammlung aller im Footer gefundenen Adress-/Kontakt-Strings.
   * Nutzen wir downstream, um identische Strings aus den Line-Items zu filtern,
   * damit Footer-Inhalte nicht versehentlich als Produkt erscheinen.
   */
  rawTokens: string[];
};

/**
 * Slug für Vergleich „Firma ↔ Domain": kleinbuchstaben, nur a-z0-9.
 * "Grohe GmbH" → "grohegmbh", aber wir vergleichen primär den Namen-Teil
 * (vor dem Suffix), siehe slugifyCompanyName.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // Diakritika weg
    .replace(/[^a-z0-9]/g, "");
}

function slugifyCompanyName(display: string): string {
  // Suffix-Bereiche grob herausschneiden, damit "GROHE GmbH" → "grohe".
  const withoutSuffix = display
    .replace(/\b(GmbH\s*&\s*Co\.?\s*KG(?:aA)?|GmbH|mbH|AG|KGaA|KG|OHG|GbR|UG(?:\s*\(haftungsbeschr[äa]nkt\))?|SE|e\.?\s*K\.?|e\.?\s*Kfm\.?|e\.?\s*Kfr\.?|e\.?\s*G\.?|e\.?\s*V\.?|Ltd\.?|Limited|PLC|LLP|Inc\.?|Incorporated|LLC|Corp\.?|Corporation|Co\.?|Pty\s*Ltd\.?|Pty\.?|S\.?\s*r\.?\s*l\.?(?:\s*s\.?)?|S\.?\s*p\.?\s*A\.?|S\.?\s*A\.?\s*R\.?\s*L\.?|S\.?\s*A\.?\s*S\.?|S\.?\s*A\.?\s*U\.?|S\.?\s*A\.?|SARL|SAS|EURL|SCS|S\.?\s*L\.?\s*U\.?|S\.?\s*L\.?|Lda\.?|B\.?\s*V\.?|N\.?\s*V\.?|BVBA|ApS|A\/S|Oy|AB|AS|Ges\.?\s*m\.?\s*b\.?\s*H\.?|Aktiengesellschaft|Stiftung)\b/giu, " ")
    .trim();
  return slugify(withoutSuffix);
}

/**
 * Findet die Domain-Slugs aus einer Liste von E-Mail-Adressen (oder Texten,
 * die Mail-Adressen enthalten). Generische Provider werden ignoriert, damit
 * "gmail" / "outlook" nicht als Firmen-Beleg dienen.
 */
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail",
  "googlemail",
  "outlook",
  "hotmail",
  "live",
  "yahoo",
  "gmx",
  "web",
  "t-online",
  "icloud",
  "me",
  "aol",
  "msn",
  "mac",
  "protonmail",
  "proton",
  "mail",
  "fastmail",
  "btinternet",
  "orange",
  "free",
  "libero",
  "tin",
  "alice",
  "tiscali",
  "virgilio",
]);

export function extractDomainSlugsFromTextLike(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)\.[A-Za-z]{2,}/g) || [];
  const slugs = new Set<string>();
  for (const m of matches) {
    const [, host] = m.split("@");
    if (!host) continue;
    const parts = host.split(".");
    // "groheshop.com" → "groheshop"; "info.shop.example.co.uk" → "example"
    const second = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const slug = slugify(second);
    if (!slug || GENERIC_EMAIL_DOMAINS.has(slug)) continue;
    slugs.add(slug);
  }
  return Array.from(slugs);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Holt den Firmennamen vor einem Suffix-Treffer. Bricht an Trennzeichen,
 * sodass Adress-Salat ("..., Industriestraße 5, Grohe GmbH") sauber endet.
 */
function pullNameBeforeSuffix(textBefore: string): string | null {
  // Newlines sind harte Grenzen — Firmenname steht IMMER in derselben Zeile
  // wie sein Suffix (Footer-Zeile, Briefkopf-Zeile, Impressum-Zeile).
  // Daher: nur die letzte Zeile vor dem Suffix betrachten.
  const lastNewline = Math.max(textBefore.lastIndexOf("\n"), textBefore.lastIndexOf("\r"));
  const sameLine = lastNewline >= 0 ? textBefore.slice(lastNewline + 1) : textBefore;
  const re = new RegExp(`(${NAME_CHAR_CLASS}{2,80})$`, "u");
  const m = sameLine.match(re);
  if (!m) return null;
  let raw = m[1];
  // Komma / Strichpunkt sind in der CharClass enthalten, aber an einer
  // Komma-Grenze (z. B. "..., Grohe") wollen wir AB dem Komma starten,
  // weil davor i.d.R. eine andere Adresse/Telefonnummer steht.
  const lastBreak = Math.max(
    raw.lastIndexOf(","),
    raw.lastIndexOf(";"),
    raw.lastIndexOf("•"),
    raw.lastIndexOf("·"),
    raw.lastIndexOf("|"),
    raw.lastIndexOf(")"),
    raw.lastIndexOf("/")
  );
  if (lastBreak >= 0 && lastBreak < raw.length - 2) {
    raw = raw.slice(lastBreak + 1);
  }
  // Mehrfach-Whitespace zusammenziehen.
  raw = raw.replace(/\s+/g, " ").trim();
  // Häufiger Müll vorne — Telefon, Fax, E-Mail-Label, URL-Reste.
  raw = raw
    .replace(/^(www\.|http:\/\/|https:\/\/|tel\.?:?|fax:?|e-?mail:?|mailto:|url:)/i, "")
    .trim();
  // Wenn nur 1 Wort und das ist "Co." o.ä. → ungültig.
  if (raw.length < 2) return null;
  if (/^(co|the|to|by|at|fa|fa\.|firma)$/i.test(raw)) return null;
  return raw;
}

/**
 * Findet alle Suffix-Treffer im Text und extrahiert pro Treffer den
 * davorstehenden (mutmaßlichen) Firmennamen.
 */
function findRawMatches(text: string): Array<{
  display: string;
  suffix: LegalFormSuffix;
  index: number;
}> {
  if (!text) return [];
  const suffixRe = getSuffixRegex();
  const out: Array<{ display: string; suffix: LegalFormSuffix; index: number }> = [];
  // RegExp ist `g` + `u`: für jede Iteration manuell.
  suffixRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  const dedup = new Set<string>();
  while ((m = suffixRe.exec(text)) !== null) {
    const suffix = findSuffixMeta(m[0]);
    if (!suffix) continue;
    const matchStart = m.index;
    const lookback = text.slice(Math.max(0, matchStart - 120), matchStart);
    const nameOnly = pullNameBeforeSuffix(lookback);
    if (!nameOnly) continue;
    // Vollform: Firma + Originalschreibweise des Suffixes.
    const display = `${nameOnly} ${m[0]}`.replace(/\s+/g, " ").trim();
    // Mindestplausi: Firma muss mindestens einen Buchstaben enthalten und
    // mehr als nur Zahlen sein.
    if (!/[A-Za-zÀ-ÿ]/.test(nameOnly)) continue;
    const dedupKey = display.toLowerCase();
    if (dedup.has(dedupKey)) {
      // bestehende Occurrence erhöhen, neuen Index ignorieren
      const existing = out.find((o) => o.display.toLowerCase() === dedupKey);
      if (existing) {
        out.push({ display: existing.display, suffix: existing.suffix, index: matchStart });
      }
      continue;
    }
    dedup.add(dedupKey);
    out.push({ display, suffix, index: matchStart });
  }
  return out;
}

/** Rechtsform aus LinkedIn-Company-Slug (z. B. ewth-gmbh → EWTH GmbH). */
const LINKEDIN_SLUG_LEGAL: Record<string, string> = {
  gmbh: "GmbH",
  ag: "AG",
  kg: "KG",
  kgaa: "KGaA",
  ohg: "OHG",
  ug: "UG",
  eurl: "EURL",
  srl: "S.r.l.",
  ltd: "Ltd.",
  inc: "Inc.",
  llc: "LLC",
};

export function linkedInCompanySlugToDisplayName(slug: string): string | null {
  const parts = slug.toLowerCase().trim().split("-").filter(Boolean);
  if (parts.length < 2) return null;
  const legalKey = parts[parts.length - 1];
  const legalDisplay = LINKEDIN_SLUG_LEGAL[legalKey];
  if (!legalDisplay) return null;
  parts.pop();
  const namePart = parts
    .map((p) =>
      p.length <= 4 && /^[a-z]+$/.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)
    )
    .join(" ");
  if (!namePart || !/[A-Za-zÀ-ÿ]/.test(namePart)) return null;
  return `${namePart} ${legalDisplay}`.replace(/\s+/g, " ").trim();
}

function findLinkedInCompanyMatches(text: string): Array<{
  display: string;
  suffix: LegalFormSuffix;
  index: number;
}> {
  if (!text) return [];
  const re = /linkedin\.com\/company\/([a-z0-9-]+)/gi;
  const out: Array<{ display: string; suffix: LegalFormSuffix; index: number }> = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const display = linkedInCompanySlugToDisplayName(m[1]);
    if (!display) continue;
    const key = display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const suffix =
      LEGAL_FORM_SUFFIXES.find((s) => display.endsWith(s.display)) ??
      ({ display: "GmbH", pattern: "GmbH", weight: 2 } as LegalFormSuffix);
    out.push({ display, suffix, index: m.index });
  }
  return out;
}

/** „Sitz des Unternehmens: Taiskirchen im Innkreis“ aus Impressums-Footer. */
export function extractLegalSeatCityFromText(text: string): string | undefined {
  const m = text.match(/Sitz\s+des\s+Unternehmens\s*:\s*([^\n\r|<]+)/i);
  if (!m) return undefined;
  const city = m[1].trim().replace(/\s*<.*$/, "");
  return city.length >= 2 ? city : undefined;
}

/** Land aus UID-/USt-IdNr. (ATU… → AT, DE… → DE). */
export function inferCountryFromUidNumber(text: string): string | undefined {
  if (/\bUID[-\s]?Nummer\s*:\s*ATU\d+/i.test(text)) return "AT";
  if (/\b(?:USt\.?-?Id\.?|VAT\s*ID)\s*:\s*DE\d+/i.test(text)) return "DE";
  if (/\b(?:USt\.?-?Id\.?|VAT\s*ID)\s*:\s*ATU\d+/i.test(text)) return "AT";
  if (/\b(?:USt\.?-?Id\.?|VAT\s*ID)\s*:\s*CH\d+/i.test(text)) return "CH";
  return undefined;
}

function fillLegalFooterAddressFromText(block: SignatureAddressBlock, text: string): void {
  if (!text) return;
  if (!block.city) {
    const city = extractLegalSeatCityFromText(text);
    if (city) {
      block.city = city;
      block.rawTokens.push(city);
    }
  }
  if (!block.country) {
    const country = inferCountryFromUidNumber(text);
    if (country) block.country = country;
  }
}

/**
 * Findet alle Footer-Marker-Positionen in einem Text.
 */
function findFooterStarts(text: string): number[] {
  if (!text) return [];
  FOOTER_MARKER_RE.lastIndex = 0;
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = FOOTER_MARKER_RE.exec(text)) !== null) {
    positions.push(m.index);
  }
  return positions;
}

/**
 * Aggregiert Roh-Treffer aus mehreren Quellen in benannte Kandidaten.
 */
function aggregateCandidates(
  perSource: Array<{
    source: string;
    text: string;
    matches: ReturnType<typeof findRawMatches>;
    footerStarts: number[];
  }>,
  emailDomainSlugs: string[],
  blockNames: (string | undefined | null)[]
): CompanyNameCandidate[] {
  type Acc = Omit<CompanyNameCandidate, "score" | "matchesEmailDomain"> & {
    matchesEmailDomain: boolean;
  };
  const map = new Map<string, Acc>();

  for (const src of perSource) {
    for (const raw of src.matches) {
      const slug = slugifyCompanyName(raw.display);
      if (!slug) continue;
      if (blockNames.some((b) => b && isMetaOwnCompany(b))) {
        // Defensive: wenn explizit geblockte Namen mitgegeben werden, gar nicht
        // erst aufnehmen.
      }
      if (isMetaOwnCompany(raw.display)) continue;
      const key = raw.display.toLowerCase();
      const inFooter = src.footerStarts.some(
        (start) => raw.index >= start && raw.index - start <= 800
      );
      const matchesDomain = emailDomainSlugs.some(
        (d) => d === slug || (slug.length >= 4 && d.includes(slug)) || (d.length >= 4 && slug.includes(d))
      );
      const existing = map.get(key);
      if (existing) {
        existing.occurrences += 1;
        if (inFooter) existing.inFooter = true;
        if (matchesDomain) existing.matchesEmailDomain = true;
      } else {
        map.set(key, {
          display: raw.display,
          suffix: raw.suffix.display,
          suffixWeight: raw.suffix.weight,
          occurrences: 1,
          inFooter,
          slug,
          matchesEmailDomain: matchesDomain,
          source: src.source,
        });
      }
    }
  }

  const all: CompanyNameCandidate[] = Array.from(map.values()).map((c) => {
    let score = 0;
    score += c.suffixWeight * 2; // 2..6
    score += clamp(c.occurrences, 1, 5); // 1..5
    if (c.inFooter) score += 4;
    if (c.matchesEmailDomain) score += 5;
    // Bonus: längerer (echter) Firmenname ist meist plausibler als nur "Co."
    const nameLen = c.display.replace(/\s+/g, " ").trim().length;
    if (nameLen >= 8) score += 1;
    if (nameLen >= 16) score += 1;
    return { ...c, score };
  });

  all.sort((a, b) => b.score - a.score || b.occurrences - a.occurrences);
  return all;
}

export type CompanyNameHeuristicInput = {
  /** Plain-Text-Sammlung der wichtigsten Quellen (E-Mail-Body, PDF-Text, …). */
  sources: Array<{ source: string; text: string }>;
  /** Optional: zusätzliche E-Mail-Adressen, aus denen Domain-Slugs gewonnen werden. */
  emailAddresses?: string[];
  /** Optional: Firmen, die explizit nicht als Kandidat verwendet werden sollen. */
  blockNames?: (string | undefined | null)[];
};

/**
 * Hauptfunktion: scannt alle Quellen, bewertet Kandidaten und liefert den
 * Top-Treffer (oder null, falls keiner sicher genug ist).
 *
 * Auswahl-Politik:
 *  - Score muss >= 4 sein.
 *  - Falls Top-Score gleichauf liegt, gewinnt der mit mehr Footer-Treffern.
 */
export function pickCompanyFromTextSources(
  input: CompanyNameHeuristicInput
): CompanyNameHeuristicResult {
  const { sources, emailAddresses, blockNames } = input;
  const domainSlugsFromInputs = emailAddresses
    ? extractDomainSlugsFromTextLike(emailAddresses.join(" "))
    : [];
  const domainSlugsFromSources = sources.flatMap((s) => extractDomainSlugsFromTextLike(s.text));
  const emailDomainSlugs = Array.from(new Set([...domainSlugsFromInputs, ...domainSlugsFromSources]));

  const perSource = sources
    .filter((s) => typeof s.text === "string" && s.text.trim().length > 0)
    .map((s) => ({
      source: s.source,
      text: s.text,
      matches: [...findRawMatches(s.text), ...findLinkedInCompanyMatches(s.text)],
      footerStarts: findFooterStarts(s.text),
    }));

  const candidates = aggregateCandidates(perSource, emailDomainSlugs, blockNames ?? []);

  const top = candidates.length > 0 && candidates[0].score >= 4 ? candidates[0] : null;

  // Adressblock typischerweise direkt um den Top-Firmen-Treffer herum
  // (gleicher Footer-Bereich). Wir suchen daher pro Quelle ein Fenster um
  // den Firmen-Index herum ab und extrahieren Adress-/Kontakt-Tokens.
  const address = top
    ? collectAddressBlockAroundCompany(perSource, top)
    : collectAddressBlockFallback(perSource);

  return {
    top,
    candidates,
    emailDomainSlug: emailDomainSlugs[0],
    address,
    version: COMPANY_NAME_HEURISTICS_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Adress-/Kontakt-Extraktion (Straße, PLZ + Ort + Land, Telefon, E-Mail)
// ---------------------------------------------------------------------------

/**
 * Erweitertes PLZ-Pattern, das auch internationale Präfixe wie
 *  - `I-39031 Bruneck (BZ)`   (Italien)
 *  - `A-1010 Wien`            (Österreich)
 *  - `D-12345 Berlin`         (Deutschland)
 *  - `CH-8001 Zürich`         (Schweiz)
 *  - `F-75001 Paris`          (Frankreich)
 * korrekt zerlegt. Liefert ISO-Country, PLZ und Ort.
 */
const COUNTRY_PREFIX_MAP: Record<string, string> = {
  D: "DE",
  DE: "DE",
  A: "AT",
  AT: "AT",
  CH: "CH",
  I: "IT",
  IT: "IT",
  F: "FR",
  FR: "FR",
  B: "BE",
  BE: "BE",
  NL: "NL",
  L: "LU",
  LU: "LU",
  E: "ES",
  ES: "ES",
  P: "PT",
  PT: "PT",
  PL: "PL",
  CZ: "CZ",
  SK: "SK",
  HU: "HU",
  SI: "SI",
  HR: "HR",
  DK: "DK",
  S: "SE",
  SE: "SE",
  N: "NO",
  NO: "NO",
  FI: "FI",
  GB: "GB",
  UK: "GB",
  IE: "IE",
};

const PLZ_WITH_OPTIONAL_PREFIX_RE =
  /\b(?:([A-Z]{1,3})-)?(\d{4,5})\s+([A-Za-zÄÖÜäöüßÀ-ÿ][A-Za-zÄÖÜäöüßÀ-ÿ\s\-'.()]{1,80})/u;

export type ParsedPlzCity = {
  zipCode: string;
  city: string;
  country?: string;
};

/**
 * Sucht in einer einzelnen Zeile nach PLZ + Ort (+ optional Country-Präfix).
 * Bricht den Ortsnamen am ersten Komma, damit "39031 Bruneck (BZ), Italien"
 * sauber als city="Bruneck (BZ)" zurückkommt.
 */
export function parsePlzCityCountryFromLine(line: string): ParsedPlzCity | null {
  if (!line) return null;
  const m = line.match(PLZ_WITH_OPTIONAL_PREFIX_RE);
  if (!m) return null;
  const [, rawPrefix, zip, cityRaw] = m;
  // city stoppt vor "," oder " - ", damit die Straße nicht reinrutscht.
  let city = cityRaw.split(",")[0].split(" - ")[0].trim();
  // Häufiger Müll am Ortsende: trailing "(BZ)" lassen wir bewusst stehen,
  // weil das oft die Provinz ist; aber "Tel." / "Fax" / E-Mail wäre Schrott.
  city = city.replace(/\b(tel\.?|fax|mob\.?|mobile|e-?mail|mailto|www).*$/i, "").trim();
  if (city.length < 2) return null;
  let country: string | undefined;
  if (rawPrefix) {
    country = COUNTRY_PREFIX_MAP[rawPrefix.toUpperCase()];
  }
  // Fallback: Country-Wort hinter dem Ort
  const tail = line.slice(m.index! + m[0].length).toLowerCase();
  if (!country) {
    if (/\b(deutschland|germany)\b/.test(tail)) country = "DE";
    else if (/\b(österreich|oesterreich|austria)\b/.test(tail)) country = "AT";
    else if (/\b(schweiz|switzerland|suisse|svizzera)\b/.test(tail)) country = "CH";
    else if (/\b(italien|italy|italia)\b/.test(tail)) country = "IT";
    else if (/\b(frankreich|france)\b/.test(tail)) country = "FR";
    else if (/\b(niederlande|netherlands|nederland)\b/.test(tail)) country = "NL";
    else if (/\b(belgien|belgium|belgi[eë])\b/.test(tail)) country = "BE";
    else if (/\b(spanien|spain|españa|espana)\b/.test(tail)) country = "ES";
    else if (/\b(polen|poland|polska)\b/.test(tail)) country = "PL";
  }
  return { zipCode: zip, city, country };
}

/** Straßen-Marker DE/EN/IT/FR/NL — alles am Wortgrenzen-Token. */
const STREET_MARKER_RE = new RegExp(
  String.raw`(stra[ßs]e|str\.?|street|gasse|weg|allee|platz|ring|damm|ufer|chaussee|boulevard|avenue|via|viale|piazza|corso|vicolo|strada|rua|calle|paseo|plaza|laan|straat|plein|carrer|rue)\b`,
  "i"
);

/** Hausnummer-Token am Zeilenende: "Mahlstraße 11", "Industriestr. 5a", "Rue de la Paix 42 bis". */
const HOUSE_NUMBER_AT_END_RE = /(?:^|\s)\d{1,4}\s*[A-Za-z]?(?:\s+(?:bis|ter))?\s*$/;

/**
 * Negativ-Marker: Zeilen, die typisch in Footern stehen, aber NIE eine
 * Straße sind (USt-IdNr., HRB, Telefon, Fax, E-Mail, Web, GF-Hinweis).
 */
const NON_STREET_LINE_RE =
  /\b(ust\.?-?id|umsatzsteuer|vat\s*(id|nr)|hrb|hra|hr\b|amtsgericht|geschäftsf|gesch\.\s*f[üu]hrer|managing\s*director|tel\.?|telefon|phone|fax|mobil|mob\.?|e-?mail|mailto|www\.|http|iban|bic|swift|steuer-?nr|stnr|ust-?nr|p\.?iva|vat\s*number)/i;

/**
 * Extrahiert die Straße + Hausnummer aus einem Adressblock. Verwendet
 * Marker-Token (Straße/str./via/rue/…) und schneidet die Zeile ggf. am
 * Komma vor der PLZ ab.
 */
export function parseStreetLine(line: string): string | null {
  if (!line) return null;
  let s = line.replace(/\s+/g, " ").trim();
  // Negativ-Liste: Footer-Zeilen, die wie eine "Zahl am Ende" aussehen, aber
  // garantiert keine Straße sind (USt-ID, HRB, Telefon, Fax, E-Mail, Web …).
  if (NON_STREET_LINE_RE.test(s)) return null;
  // Komma + PLZ-Bereich hinten abschneiden ("Industriestraße 5, 39031 Bruneck (BZ)" → "Industriestraße 5").
  const cutByComma = s.split(/,\s*[A-Z]{0,3}-?\d{4,5}\b/)[0].trim();
  if (cutByComma.length >= 5) s = cutByComma;
  // Wenn die Zeile noch eine PLZ enthält (ohne Komma davor), Teil VOR der PLZ nehmen.
  const plzMatch = s.match(/\b[A-Z]{0,3}-?\d{4,5}\b/);
  if (plzMatch && plzMatch.index! > 5) {
    s = s.slice(0, plzMatch.index).replace(/,\s*$/, "").trim();
  }
  if (!STREET_MARKER_RE.test(s) && !HOUSE_NUMBER_AT_END_RE.test(s)) return null;
  // Vorne abschneiden, wenn ein Komma davorsteht: "..., J.-G.-Mahlstraße 11" → "J.-G.-Mahlstraße 11"
  const lastComma = s.lastIndexOf(",");
  if (lastComma >= 0 && lastComma < s.length - 2 && STREET_MARKER_RE.test(s.slice(lastComma))) {
    s = s.slice(lastComma + 1).trim();
  }
  // Minimum: 5 Zeichen, max 120
  if (s.length < 5 || s.length > 120) return null;
  return s;
}

import { isPlausiblePhoneNumber } from "./buyerContactFieldUtils";

/** Telefonnummer-Pattern: internationale + nationale Formate. */
const PHONE_RE =
  /(\+?\d{1,3}[\s\.\-\/]?)?(\(?\d{2,5}\)?[\s\.\-\/]?){1,3}\d{3,}/g;

/**
 * Extrahiert plausible Telefonnummern aus Text. Filtert offensichtliche
 * Fehl-Treffer (reine Zahlen ohne Trenner, < 7 Ziffern, EAN/GTIN-Längen).
 */
export function extractPhoneNumbers(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  // Wir schauen nur Zeilen mit "Tel"/"Phone"/etc. oder Zeilen, die mit + beginnen,
  // bzw. extrahieren strikt formatierte Nummern. Das hält False-Positives klein.
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/\b(gtin|ean|art\.?\s*nr|artikelnummer|sku)\b/i.test(trimmed)) continue;

    // Volle Mobil-/Tel.-Zeile ab „+“ (inkl. Durchwahl), z. B. „M: +43 7764/207 01-52“.
    const plusIdx = trimmed.indexOf("+");
    if (plusIdx >= 0 && trimmed.length <= 120 && /:\s*\+/.test(trimmed)) {
      const candidate = trimmed.slice(plusIdx).replace(/\s*<.*$/, "").trim();
      if (isPlausiblePhoneNumber(candidate) && !out.includes(candidate)) {
        out.push(candidate);
        continue;
      }
    }

    const looksLikePhoneLine =
      /\b(tel\.?|telefon|phone|mobile?|mob\.?|fon|fax|m\.?:|t\.?:|p\.?:)/i.test(trimmed) ||
      /^\s*\+\d/.test(trimmed) ||
      /^\s*\(\d/.test(trimmed) ||
      /^[\d\s\.\-\/+\(\)]{8,}$/.test(trimmed);
    if (!looksLikePhoneLine) continue;
    const matches = trimmed.match(PHONE_RE) || [];
    for (const raw of matches) {
      const cleaned = raw.trim();
      if (!isPlausiblePhoneNumber(cleaned)) continue;
      if (!out.includes(cleaned)) out.push(cleaned);
    }
  }
  return out;
}

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

/** Extrahiert alle E-Mail-Adressen aus dem Text. */
export function extractEmails(text: string): string[] {
  if (!text) return [];
  const matches = text.match(EMAIL_RE) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(m);
  }
  return out;
}

type PerSourceEntry = {
  source: string;
  text: string;
  matches: ReturnType<typeof findRawMatches>;
  footerStarts: number[];
};

/**
 * Sammelt den Adressblock in einem Fenster um den Top-Firmen-Treffer.
 * Bevorzugt Zeilen aus dem Footer-Bereich derselben Quelle.
 */
function collectAddressBlockAroundCompany(
  perSource: PerSourceEntry[],
  top: CompanyNameCandidate
): SignatureAddressBlock {
  const block: SignatureAddressBlock = { rawTokens: [] };

  // Quelle finden, in der der Top-Treffer vorkommt.
  const sourceWithMatch = perSource.find((src) =>
    src.matches.some((m) => m.display.toLowerCase() === top.display.toLowerCase())
  );
  if (!sourceWithMatch) return collectAddressBlockFallback(perSource);

  // Fenster um den Match: 250 Zeichen davor (Footer-Block), 400 Zeichen danach
  // (Adresse + Telefon + E-Mail kommen meist nach dem Firmennamen).
  const matchEntry = sourceWithMatch.matches.find(
    (m) => m.display.toLowerCase() === top.display.toLowerCase()
  );
  if (!matchEntry) return collectAddressBlockFallback(perSource);

  const windowStart = Math.max(0, matchEntry.index - 250);
  const windowEnd = Math.min(sourceWithMatch.text.length, matchEntry.index + 400);
  const windowText = sourceWithMatch.text.slice(windowStart, windowEnd);

  fillAddressBlockFromText(block, windowText);
  fillLegalFooterAddressFromText(block, sourceWithMatch.text);

  // E-Mail / Telefon ggf. zusätzlich aus allen Quellen ergänzen — die liegen
  // manchmal weiter weg vom Firmennamen.
  if (!block.email || !block.phone) {
    for (const src of perSource) {
      if (!block.email) {
        const emails = extractEmails(src.text).filter((e) => {
          const dom = e.split("@")[1]?.toLowerCase() || "";
          // generische Provider als letztes Mittel zulassen, aber bevorzugen
          // nicht-generische Domains.
          return dom.length > 0;
        });
        if (emails.length > 0) {
          // bevorzugt nicht-generisch
          const nonGeneric = emails.find((e) => {
            const dom = e.split("@")[1]?.split(".")?.slice(-2, -1)[0] || "";
            return !GENERIC_EMAIL_DOMAINS.has(dom.toLowerCase());
          });
          block.email = nonGeneric ?? emails[0];
          block.rawTokens.push(block.email);
        }
      }
      if (!block.phone) {
        const phones = extractPhoneNumbers(src.text);
        if (phones.length > 0) {
          block.phone = phones[0];
          block.rawTokens.push(block.phone);
        }
      }
    }
  }

  return block;
}

function collectAddressBlockFallback(perSource: PerSourceEntry[]): SignatureAddressBlock {
  const block: SignatureAddressBlock = { rawTokens: [] };
  for (const src of perSource) {
    // Wenn überhaupt keine Firma gefunden wurde, schauen wir nur Footer-Bereiche an.
    for (const start of src.footerStarts) {
      fillAddressBlockFromText(block, src.text.slice(start, start + 600));
      if (block.street && block.zipCode && block.city) break;
    }
    fillLegalFooterAddressFromText(block, src.text);
  }
  return block;
}

function fillAddressBlockFromText(block: SignatureAddressBlock, text: string): void {
  if (!text) return;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // PLZ + Ort + Country: erste Zeile, die ein PLZ-Pattern enthält.
  if (!block.zipCode || !block.city) {
    for (const line of lines) {
      const parsed = parsePlzCityCountryFromLine(line);
      if (parsed) {
        if (!block.zipCode) {
          block.zipCode = parsed.zipCode;
          block.rawTokens.push(parsed.zipCode);
        }
        if (!block.city) {
          block.city = parsed.city;
          block.rawTokens.push(parsed.city);
        }
        if (!block.country && parsed.country) {
          block.country = parsed.country;
        }
        break;
      }
    }
  }

  // Straße: bevorzugt aus derselben Zeile wie PLZ (mit Komma getrennt),
  // sonst aus einer eigenen Zeile davor.
  if (!block.street) {
    for (const line of lines) {
      const street = parseStreetLine(line);
      if (street) {
        block.street = street;
        block.rawTokens.push(street);
        break;
      }
    }
  }

  // Telefon
  if (!block.phone) {
    const phones = extractPhoneNumbers(text);
    if (phones.length > 0) {
      block.phone = phones[0];
      block.rawTokens.push(block.phone);
    }
  }

  // E-Mail
  if (!block.email) {
    const emails = extractEmails(text);
    if (emails.length > 0) {
      // bevorzugt nicht-generischen Provider
      const nonGeneric = emails.find((e) => {
        const dom = e.split("@")[1]?.split(".")?.slice(-2, -1)[0] || "";
        return !GENERIC_EMAIL_DOMAINS.has(dom.toLowerCase());
      });
      block.email = nonGeneric ?? emails[0];
      block.rawTokens.push(block.email);
    }
  }
}
