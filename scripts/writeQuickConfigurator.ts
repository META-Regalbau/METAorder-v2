/**
 * Spielt den Regal-Schnellkonfigurator in den Shop ein (shopware/storefront-snippets/quick-configurator.js
 * + .css): Formular auf /regal-schnellkonfigurator, Einstiegskasten auf der Fachbodenregal-Seite und den
 * CLIP-Listen, Link auf den Produktseiten der CLIP-Regale. Die Seite selbst und die Artikeltabelle schreibt
 * scripts/writeQuickConfiguratorPage.ts.
 * Ablauf, Protokoll und Rückbau: scripts/lib/storefrontSnippetEntry.ts.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeQuickConfigurator.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeQuickConfigurator.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { runStorefrontSnippetScript } from "./lib/storefrontSnippetEntry";

runStorefrontSnippetScript({
  key: "metaorder-quick-configurator",
  name: "METAorder: Regal-Schnellkonfigurator",
  file: "quick-configurator",
  script: "writeQuickConfigurator.ts",
  protocolPrefix: "Schnellkonfigurator-Protokoll",
});
