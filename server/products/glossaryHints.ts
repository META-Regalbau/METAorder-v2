// Stufe 2 des Regal-Lexikons: Daten für die Erklär-Hinweise „i“ im Shop (shopware/storefront-snippets/glossary-hints.js).
// Quelle sind die Begriffe mit `hint: true` in glossary.ts; scripts/writeGlossaryHints.ts schreibt sie beim Einspielen
// in den Baustein, damit Lexikon und Hinweise denselben Text haben.

import { GLOSSARY_PAGE, GLOSSARY_TERMS, glossaryPlain, type GlossaryTerm } from "./glossary";

export type GlossaryHint = { key: string; term: string; aliases: string[]; text: string };

/** Platzhalter im Baustein, den das Einspielskript durch die Begriffe ersetzt */
export const GLOSSARY_HINTS_MARKER = /\/\*METAORDER_GLOSSARY_HINTS\*\/[\s\S]*?\/\*END\*\//;

/** Unter dieser Länge nimmt der Hinweis den zweiten Satz dazu („Grundausführung der META-Regale.“ allein sagt zu wenig). */
const MIN_HINT_LENGTH = 60;

/** Satzende: Punkt, Ausrufe- oder Fragezeichen, dann Leerzeichen und ein Großbuchstabe (nicht „z. B. ein“, „1.650“) */
const SENTENCE_END = /[.!?](?=\s+[A-ZÄÖÜ])/g;

export function firstSentences(text: string): string {
  const plain = glossaryPlain(text).replace(/\s+/g, " ").trim();
  const ends = [...plain.matchAll(SENTENCE_END)].map((m) => (m.index ?? 0) + 1);
  if (!ends.length) return plain;
  const first = plain.slice(0, ends[0]);
  if (first.length >= MIN_HINT_LENGTH) return first;
  return plain.slice(0, ends[1] ?? plain.length);
}

export function glossaryHints(terms: GlossaryTerm[] = GLOSSARY_TERMS): GlossaryHint[] {
  return terms
    .filter((t) => t.hint)
    .map((t) => ({ key: t.key, term: t.term, aliases: t.aliases ?? [], text: firstSentences(t.text) }));
}

/** Baustein-JS mit eingesetzten Begriffen und Lexikon-Adresse */
export function injectGlossaryHints(js: string, hints: GlossaryHint[] = glossaryHints()): string {
  if (!GLOSSARY_HINTS_MARKER.test(js)) throw new Error("Platzhalter METAORDER_GLOSSARY_HINTS fehlt in glossary-hints.js");
  const data = { url: GLOSSARY_PAGE.url, terms: hints };
  // </script> kann im Shop-Bundle nicht vorkommen, trotzdem kein rohes „<“ in den Daten
  const json = JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
  return js.replace(GLOSSARY_HINTS_MARKER, () => `/*METAORDER_GLOSSARY_HINTS*/${json}/*END*/`);
}
