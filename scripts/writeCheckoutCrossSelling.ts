/**
 * Spielt „Das passt dazu“ für Mini-Warenkorb und Warenkorbseite in den Shop ein
 * (shopware/storefront-snippets/checkout-cross-selling.js + .css).
 * Ablauf, Protokoll und Rückbau: server/shopContent/storefrontSnippetEntry.ts.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeCheckoutCrossSelling.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeCheckoutCrossSelling.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { runStorefrontSnippetScript } from "../server/shopContent/storefrontSnippetEntry";

runStorefrontSnippetScript({
  key: "metaorder-checkout-cross-selling",
  name: "METAorder: Das passt dazu im Warenkorb",
  file: "checkout-cross-selling",
  script: "writeCheckoutCrossSelling.ts",
  protocolPrefix: "Warenkorb-Crossselling-Protokoll",
});
