/**
 * Spielt die Erklär-Hinweise aus dem Regal-Lexikon in den Shop ein
 * (shopware/storefront-snippets/glossary-hints.js + .css): ein „i“ hinter Fachbegriffen im Artikelnamen, in der
 * Eigenschaften-Tabelle und in den Filtertiteln, mit dem ersten Satz der Erklärung und dem Link auf
 * /regal-lexikon#schluessel. Die Begriffe (hint: true in server/products/glossary.ts) schreibt das Skript beim
 * Einspielen in den Baustein. Ablauf, Protokoll und Rückbau: scripts/lib/storefrontSnippetEntry.ts.
 *
 * Voraussetzung: /regal-lexikon steht im selben Shop (scripts/writeGlossaryPage.ts).
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeGlossaryHints.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeGlossaryHints.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { glossaryHints, injectGlossaryHints } from "../server/products/glossaryHints";
import { runStorefrontSnippetScript } from "./lib/storefrontSnippetEntry";

const hints = glossaryHints();
console.log(`${hints.length} Begriffe: ${hints.map((h) => h.term).join(", ")}`);

runStorefrontSnippetScript({
  key: "metaorder-glossary-hints",
  name: "METAorder: Erklär-Hinweise Regal-Lexikon",
  file: "glossary-hints",
  script: "writeGlossaryHints.ts",
  protocolPrefix: "Lexikon-Hinweise-Protokoll",
  transformJs: (js) => injectGlossaryHints(js, hints),
});
