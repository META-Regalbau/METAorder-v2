/**
 * Person-Name-Normalisierung – Unit-Tests.
 * Ausführung: npx tsx scripts/testPersonNameNormalize.ts
 */

import {
  parsePersonName,
  legacyFirstLastFromContactPerson,
} from "../server/personNameNormalize";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  const msg =
    message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  assert(actual === expected, msg);
}

console.log("=== personNameNormalize Unit Tests ===\n");

// --- 1. Trivialfälle ---
{
  const empty = parsePersonName("");
  assertEqual(empty.firstName, undefined, "empty → no firstName");
  assertEqual(empty.lastName, undefined, "empty → no lastName");
  assertEqual(empty.isRole, false, "empty → not role");
  assertEqual(empty.confidence, "low", "empty → low confidence");

  const nullInput = parsePersonName(null);
  assertEqual(nullInput.lastName, undefined, "null → no lastName");
  assertEqual(nullInput.confidence, "low", "null → low");
  console.log("  trivial cases: OK");
}

// --- 2. Einfache „Vorname Nachname" ---
{
  const p = parsePersonName("Max Mustermann");
  assertEqual(p.firstName, "Max", "simple first");
  assertEqual(p.lastName, "Mustermann", "simple last");
  assertEqual(p.isRole, false, "simple not role");
  assertEqual(p.confidence, "high", "simple → high");
  console.log("  simple first+last: OK");
}

// --- 3. Anrede + Titel werden weggestrippt ---
{
  const a = parsePersonName("Herr Dr. Max Mustermann");
  assertEqual(a.salutation?.toLowerCase(), "herr", "salutation Herr");
  assertEqual(a.title, "Dr.", "title Dr.");
  assertEqual(a.firstName, "Max", "salutation+title first");
  assertEqual(a.lastName, "Mustermann", "salutation+title last");

  const b = parsePersonName("Frau Prof. Dr. Anna Müller");
  assertEqual(b.salutation?.toLowerCase(), "frau", "salutation Frau");
  assert(/prof\.? dr\./i.test(b.title || ""), "title chain Prof. Dr.");
  assertEqual(b.firstName, "Anna", "prof first");
  assertEqual(b.lastName, "Müller", "prof last");

  const c = parsePersonName("Dipl.-Ing. Peter Schmitt");
  assert(/dipl\.-?ing\.?/i.test(c.title || ""), "title Dipl.-Ing.");
  assertEqual(c.firstName, "Peter", "dipl first");
  assertEqual(c.lastName, "Schmitt", "dipl last");
  console.log("  salutation + title stripping: OK");
}

// --- 4. Adelsprädikate / Namens-Partikel ---
{
  const a = parsePersonName("Hans Peter von der Heyden");
  assertEqual(a.firstName, "Hans Peter", "particle first");
  assertEqual(a.lastName, "von der Heyden", "particle last");

  const b = parsePersonName("Max van de Berg");
  assertEqual(b.firstName, "Max", "van de first");
  assertEqual(b.lastName, "van de Berg", "van de last");

  const c = parsePersonName("Juan de la Cruz");
  assertEqual(c.firstName, "Juan", "de la first");
  assertEqual(c.lastName, "de la Cruz", "de la last");
  console.log("  particles (von/van/de la): OK");
}

// --- 5. Komma-Notation „Nachname, Vorname" ---
{
  const a = parsePersonName("Mustermann, Max");
  assertEqual(a.firstName, "Max", "comma first");
  assertEqual(a.lastName, "Mustermann", "comma last");

  const b = parsePersonName("Müller-Brandt, Anna");
  assertEqual(b.firstName, "Anna", "double-name comma first");
  assertEqual(b.lastName, "Müller-Brandt", "double-name comma last");
  console.log("  comma notation: OK");
}

// --- 6. „z. Hd." / „Attn:" / „c/o" Präfixe ---
{
  const a = parsePersonName("z. Hd. Max Mustermann");
  assertEqual(a.firstName, "Max", "zHd first");
  assertEqual(a.lastName, "Mustermann", "zHd last");

  const b = parsePersonName("z.Hd. Frau Anna Müller");
  assertEqual(b.salutation?.toLowerCase(), "frau", "zHd + salutation");
  assertEqual(b.lastName, "Müller", "zHd + salutation last");

  const c = parsePersonName("Attn: John Smith");
  assertEqual(c.firstName, "John", "attn first");
  assertEqual(c.lastName, "Smith", "attn last");

  const d = parsePersonName("zu Händen von Lisa Beck");
  assertEqual(d.firstName, "Lisa", "zuHaendenVon first");
  assertEqual(d.lastName, "Beck", "zuHaendenVon last");
  console.log("  attn prefixes: OK");
}

// --- 7. Rollen / Funktionen werden NICHT als Person extrahiert ---
{
  for (const role of [
    "Einkauf",
    "Bestellabwicklung",
    "Disposition",
    "Sales",
    "Buchhaltung",
    "Sekretariat",
  ]) {
    const p = parsePersonName(role);
    assertEqual(p.isRole, true, `${role} → isRole`);
    assertEqual(p.firstName, undefined, `${role} → no firstName`);
    assertEqual(p.lastName, undefined, `${role} → no lastName`);
  }
  console.log("  role detection (Einkauf, Sales, ...): OK");
}

// --- 8. Einzelnes Token → Nachname (kein "Vorname-Halluzinieren") ---
{
  const p = parsePersonName("Müller");
  assertEqual(p.firstName, undefined, "single → no first");
  assertEqual(p.lastName, "Müller", "single → last");
  assertEqual(p.confidence, "medium", "single → medium");
  console.log("  single token: OK");
}

// --- 9. Initialen ---
{
  const a = parsePersonName("M. Schmitt");
  assertEqual(a.firstName, "M.", "initial first");
  assertEqual(a.lastName, "Schmitt", "initial last");

  const b = parsePersonName("M.-L. Schmitt-Krause");
  assertEqual(b.firstName, "M.-L.", "double-initial first");
  assertEqual(b.lastName, "Schmitt-Krause", "double-initial last");
  console.log("  initials: OK");
}

// --- 10. Mehrere Personen / „A & B" → erste Person ---
{
  const a = parsePersonName("Max Mustermann / Lisa Beck");
  assertEqual(a.firstName, "Max", "two persons first");
  assertEqual(a.lastName, "Mustermann", "two persons last");

  const b = parsePersonName("Anna Müller & Peter Schmidt");
  assertEqual(b.firstName, "Anna", "ampersand first");
  assertEqual(b.lastName, "Müller", "ampersand last");

  const c = parsePersonName("Hans Müller und Lisa Beck");
  assertEqual(c.firstName, "Hans", "und first");
  assertEqual(c.lastName, "Müller", "und last");
  console.log("  multiple persons: OK");
}

// --- 11. Nur Anrede ohne Person → leer + low ---
{
  const p = parsePersonName("Herr");
  assertEqual(p.lastName, undefined, "salutation only → no last");
  assertEqual(p.firstName, undefined, "salutation only → no first");
  assertEqual(p.confidence, "low", "salutation only → low");
  console.log("  salutation only: OK");
}

// --- 12. Legacy-Wrapper bewahrt altes API-Shape ---
{
  const a = legacyFirstLastFromContactPerson("Max Mustermann");
  assertEqual(a.firstName, "Max", "legacy first");
  assertEqual(a.lastName, "Mustermann", "legacy last");

  const role = legacyFirstLastFromContactPerson("Einkauf");
  assertEqual(role.firstName, undefined, "legacy role → no first");
  assertEqual(role.lastName, undefined, "legacy role → no last");

  const empty = legacyFirstLastFromContactPerson(null);
  assertEqual(empty.firstName, undefined, "legacy null → no first");
  assertEqual(empty.lastName, undefined, "legacy null → no last");
  console.log("  legacy wrapper: OK");
}

// --- 13. Regression: alter Bug "Hans Peter von der Heyden" hatte Heyden als einzigen Nachnamen
//         und „Hans Peter von der" als Vorname → jetzt korrekt zusammen mit Partikeln.
{
  const p = parsePersonName("Hans Peter von der Heyden");
  assert(p.lastName === "von der Heyden", `regression: ${JSON.stringify(p)}`);
  console.log("  regression: 'Hans Peter von der Heyden': OK");
}

console.log("\nAll tests passed.\n");
