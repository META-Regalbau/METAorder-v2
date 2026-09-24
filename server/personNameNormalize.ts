/**
 * Robuste Aufteilung von freien Personennamen aus `buyer.contact_person`
 * (oder ähnlichen LLM-Antworten) in salutation / title / firstName / lastName.
 *
 * Bewusst keine externen Abhängigkeiten — wird sowohl im Server-Code als auch
 * im tsx-Test-Skript verwendet. Sprachen: DE primär, EN als Fallback.
 */

const SALUTATION_RE =
  /^(herr|hr\.?|frau|fr\.?|mr\.?|mrs\.?|ms\.?|mister|miss|madam|madame|monsieur|sehr\s+geehrte[rn]?)$/i;

const TITLE_RE =
  /^(dr\.?|prof\.?|prof\.?\s*dr\.?|dipl\.?-?ing\.?|dipl\.?-?kfm\.?|dipl\.?-?kff\.?|dipl\.?-?wirt\.?-?ing\.?|dipl\.?-?wirt\.?|dipl\.?-?oec\.?|dipl\.?-?math\.?|dipl\.?-?phys\.?|dipl\.?-?inf\.?|ing\.?|mag\.?|m\.?\s?sc\.?|b\.?\s?sc\.?|m\.?\s?a\.?|b\.?\s?a\.?|m\.?\s?eng\.?|b\.?\s?eng\.?|ph\.?\s?d\.?|mba)$/i;

/** Adelsprädikate und Namensbestandteile, die zum Nachnamen gehören. */
const NAME_PARTICLE_RE =
  /^(von|vom|van|de|del|della|di|du|der|den|zu|zum|zur|af|al|el|le|la|los|las|y|do|da|das|den?|st\.?|saint)$/i;

/**
 * Funktionsangaben statt Personen. Treffer → `isRole = true`,
 * dann KEINE Person extrahieren (sonst landen Werte wie „Einkauf" als Vorname).
 */
const ROLE_NOUN_RE =
  /^(einkauf|einkaufsabteilung|bestellabwicklung|bestellwesen|disposition|verkauf|vertrieb|zentrale|service|kundenservice|kundendienst|buchhaltung|rechnungswesen|geschäftsleitung|geschaeftsleitung|info|administration|admin|order|orders|sales|purchasing|procurement|logistics|warehouse|reception|empfang|sekretariat|office)$/i;

/** Präfixe „z. Hd." / „FAO:" / „Attn:" usw., die vor dem Namen stehen. */
const ATTN_PREFIX_RE =
  /^\s*(z\.?\s*hd\.?|z\.?\s*H\.|zu\s+händen(?:\s+von)?|fao\.?|attn\.?|attention|c\/?o)\s*[:.]?\s*/i;

export interface ParsedPersonName {
  /** „Herr" / „Frau" / „Mr." — normalisiert auf erkannte Form, sonst undefined. */
  salutation?: string;
  /** „Dr.", „Prof.", „Dipl.-Ing." — Kette wenn mehrere. */
  title?: string;
  firstName?: string;
  lastName?: string;
  /**
   * True, wenn der Text keine Person beschreibt (z. B. „Einkauf",
   * „Bestellabwicklung"). Aufrufer sollte dann firstName/lastName ignorieren
   * und stattdessen z. B. `contactRole` setzen.
   */
  isRole: boolean;
  /**
   * Reine Heuristik-Selbsteinschätzung:
   *  - "high"   = Anrede/Titel + ≥ 2 Tokens klar trennbar
   *  - "medium" = einzelner Token oder Komma-Notation
   *  - "low"    = leerer Input bzw. nur Anrede/Titel
   */
  confidence: "high" | "medium" | "low";
}

function stripAttnPrefix(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(ATTN_PREFIX_RE, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Behandelt das Komma-Pattern „Nachname, Vorname". Liefert die gewünschte
 * „Vorname Nachname"-Reihenfolge oder null, wenn das Pattern nicht passt.
 */
function reorderLastCommaFirst(raw: string): string | null {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const [left, right] = parts;
  const leftTokens = left.split(/\s+/).filter(Boolean);
  const rightTokens = right.split(/\s+/).filter(Boolean);
  // „Mustermann, Max" → genau 1 Nachname links, 1–3 Tokens rechts (Vorname + ggf. Initialen).
  if (leftTokens.length > 2 || rightTokens.length === 0 || rightTokens.length > 3) return null;
  // Rechts sollte kein typischer Rollenbegriff stehen.
  if (rightTokens.some((t) => ROLE_NOUN_RE.test(t.replace(/\.$/, "")))) return null;
  return `${right} ${left}`;
}

/**
 * Häufige Vornamen (DE/AT/CH plus gängige internationale), klein geschrieben.
 * Zweck: „Nachname Vorname"-Schreibweise ohne Komma erkennen („Schlesselmann Birgit").
 * Kein Anspruch auf Vollständigkeit — die Heuristik greift nur, wenn das ZWEITE Token
 * ein bekannter Vorname ist und das erste nicht.
 */
const COMMON_FIRST_NAMES = new Set(
  (
    "adrian alexander alexandra alfred alina andrea andreas angela angelika anja anke anna anne annette anton " +
    "armin arno astrid axel barbara bastian beate benjamin bernd bernhard bettina birgit bjoern björn brigitte " +
    "britta carina carmen carola carsten christa christian christiane christina christine christoph christopher " +
    "claudia clara claus cornelia daniel daniela david denis dennis diana dieter dietmar dirk dominik doris dorothea " +
    "eberhard edith egon elena elisabeth elke ellen emil erich erik erika ernst eva fabian felix ferdinand florian " +
    "frank franz franziska friedrich fritz gabriele georg gerd gerhard gerlinde gertrud gisela gregor gudrun " +
    "guenter günter guido gustav hannah hanna hannes hans harald hartmut heidi heike heiko heinrich heinz helga " +
    "helmut henrik herbert hermann holger horst hubert ilona ines inge ingeborg ingo ingrid iris irmgard isabel " +
    "isabell isabella jan jana janina jens jessica joachim jochen johann johanna johannes jonas jörg joerg josef " +
    "juergen jürgen julia julian jutta kai karin karl karsten katharina kathrin katja katrin kerstin kevin klaus " +
    "konrad kurt lara laura lars lea lena leon leonie lisa lothar lucas lukas luisa lutz magdalena maik manfred " +
    "manuel manuela marc marcel marco margarete margit maria marianne mario marion mark markus marlene martin " +
    "martina mathias matthias max maximilian melanie michael michaela mirko monika moritz nadine natalie nicole " +
    "niklas nils nina norbert olaf oliver otto patrick paul paula peter petra philipp pia rainer ralf ralph regina " +
    "reinhard renate rene rené richard rita robert roland rolf roman rosemarie rudolf ruth sabine sabrina sandra " +
    "sarah sascha sebastian siegfried sigrid silke silvia simon simone sina sonja sophie stefan stefanie steffen " +
    "stephan stephanie susanne sven svenja sylvia tanja theo theresa thomas thorsten tim timo tina tobias tom toni " +
    "tony torsten udo ulrich ulrike ursula uta ute uwe vanessa vera verena viktor viktoria volker walter werner " +
    "wilfried wilhelm willi wolfgang yvonne ines elias emma mia leonard noah ben finn mila sofia sophia hanne " +
    "malte justine oliver olivier pierre jean marie luca giulia marco francesco paolo pieter jan kees anders " +
    "erik lars sven mikael johan"
  ).split(/\s+/)
);

function isKnownFirstName(token: string): boolean {
  return COMMON_FIRST_NAMES.has(token.toLowerCase().replace(/[.:;,]+$/, ""));
}

/**
 * „Schlesselmann Birgit" → „Birgit Schlesselmann": nur bei genau zwei Tokens, wenn das
 * zweite ein bekannter Vorname ist und das erste nicht (bei „Peter Thomas" bleibt die
 * Reihenfolge, weil beide Vornamen sein können).
 */
function reorderLastFirstWithoutComma(tokens: string[]): string[] {
  if (tokens.length !== 2) return tokens;
  const [a, b] = tokens;
  if (isKnownFirstName(b) && !isKnownFirstName(a) && !isInitial(a)) {
    return [b, a];
  }
  return tokens;
}

function isInitial(token: string): boolean {
  // „M.", „M.-L.", „J.F." – ein paar Großbuchstaben, je mit Punkt, evtl. Bindestrich.
  return /^([A-ZÄÖÜ]\.(?:-[A-ZÄÖÜ]\.)?){1,3}$/.test(token);
}

/**
 * Zerlegt einen freien Namens-String in Salutation/Title/Vor-/Nachname.
 * Tolerant gegen Anreden, Titel, Adelsprädikate, Komma-Notation und
 * „z. Hd."-Präfixe.
 */
export function parsePersonName(raw: string | null | undefined): ParsedPersonName {
  if (!raw || !raw.trim()) {
    return { isRole: false, confidence: "low" };
  }

  let cleaned = raw.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
  cleaned = stripAttnPrefix(cleaned);

  // Reine Funktionsangabe?
  if (ROLE_NOUN_RE.test(cleaned.replace(/[.:;]+$/, ""))) {
    return { isRole: true, confidence: "high" };
  }

  // „Mustermann, Max" → „Max Mustermann"
  const reordered = reorderLastCommaFirst(cleaned);
  if (reordered) cleaned = reordered;

  // Mehrere Personen / „A & B" / „A / B" → erste Person nehmen, Rest ignorieren.
  // (Volle Multi-Person-Unterstützung kommt mit Schema-Erweiterung in Schritt 1.)
  const firstPerson = cleaned.split(/\s*(?:\/|&|\bund\b|\bund\/oder\b|,)\s*/i)[0]?.trim();
  if (firstPerson) cleaned = firstPerson;

  let tokens = cleaned.split(/\s+/).filter(Boolean);

  let salutation: string | undefined;
  let title: string | undefined;

  while (tokens.length && SALUTATION_RE.test(tokens[0].replace(/[.:;]+$/, ""))) {
    salutation = tokens.shift();
  }
  while (tokens.length && TITLE_RE.test(tokens[0].replace(/[.:;]+$/, ""))) {
    title = title ? `${title} ${tokens.shift()}` : tokens.shift();
  }

  if (tokens.length === 0) {
    return { salutation, title, isRole: false, confidence: "low" };
  }

  tokens = reorderLastFirstWithoutComma(tokens);

  // Letztes Token könnte trotz vorhergehender Stripping-Schritte eine Rolle sein.
  if (tokens.length === 1) {
    const only = tokens[0].replace(/[.:;]+$/, "");
    if (ROLE_NOUN_RE.test(only)) {
      return { salutation, title, isRole: true, confidence: "high" };
    }
    return {
      salutation,
      title,
      lastName: tokens[0],
      isRole: false,
      confidence: "medium",
    };
  }

  // Namens-Partikel an den Nachnamen hängen ("Hans Peter von der Heyden").
  let splitIdx = tokens.length - 1;
  while (splitIdx > 0 && NAME_PARTICLE_RE.test(tokens[splitIdx - 1])) {
    splitIdx--;
  }
  // Sicherheitsnetz: mindestens ein Token muss als Vorname übrig bleiben.
  if (splitIdx === 0) splitIdx = 1;

  const firstName = tokens.slice(0, splitIdx).join(" ");
  const lastName = tokens.slice(splitIdx).join(" ");

  // Sanity: Wenn der Vorname NUR aus Initialen besteht und mehr als 2 davon,
  // bleibt das so — ist legitim (z. B. „J. F. K. Kennedy"). Keine Sonderlogik.
  void isInitial;

  return {
    salutation,
    title,
    firstName,
    lastName,
    isRole: false,
    confidence: "high",
  };
}

/**
 * Convenience: nur die Legacy-Felder `firstName` / `lastName` — bewahrt
 * das bisherige API-Shape von `nameParts()` im Übersetzungsmodul.
 */
export function legacyFirstLastFromContactPerson(
  raw: string | null | undefined
): { firstName?: string; lastName?: string } {
  const parsed = parsePersonName(raw);
  if (parsed.isRole) return {};
  const out: { firstName?: string; lastName?: string } = {};
  if (parsed.firstName) out.firstName = parsed.firstName;
  if (parsed.lastName) out.lastName = parsed.lastName;
  return out;
}
