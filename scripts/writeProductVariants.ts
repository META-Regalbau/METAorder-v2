/**
 * Spielt „Auch erhältlich in" für die Produktseite in den Shop ein
 * (shopware/storefront-snippets/product-variants.js + .css): dasselbe Regal in anderer Höhe, Tiefe
 * oder Farbe als Auswahl über den Vorteilen. Die Daten kommen aus dem Crossselling-Tab
 * „Auch erhältlich in" (feste Namensregeln, Lauf in METAorder unter Crossselling).
 * Ablauf, Protokoll und Rückbau: scripts/lib/storefrontSnippetEntry.ts.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeProductVariants.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeProductVariants.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { runStorefrontSnippetScript } from "./lib/storefrontSnippetEntry";

runStorefrontSnippetScript({
  key: "metaorder-product-variants",
  name: "METAorder: Auch erhältlich in (Produktseite)",
  file: "product-variants",
  script: "writeProductVariants.ts",
  protocolPrefix: "Auch-erhaeltlich-Protokoll",
});
