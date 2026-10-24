/**
 * Spielt den Regalplaner-Baustein in den Shop ein (shopware/storefront-snippets/regalplaner.js + .css): setzt auf
 * der Seite /regalplaner (scripts/writeRegalplanerPage.ts) METAorder als iframe ein und legt die Stückliste aus dem
 * Regalplaner in den Warenkorb. Live seit 24.10.2026 (Protokoll im Repo-Root), der Shop-Wächter prüft ihn mit.
 * Ab Version 4 zusätzlich auf Produktseiten von CLIP-Grund-/Anbauregalen: Knopf „Im Regalplaner anpassen“, der Planer
 * startet mit den Maßen des Artikels (CONFIG.appUrl im Skript = METAorder auf Mittwald).
 * Ablauf, Protokoll und Rückbau: scripts/lib/storefrontSnippetEntry.ts.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeRegalplaner.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeRegalplaner.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { storefrontSnippet } from "../server/shopContent/shopEntityIds";
import { runStorefrontSnippetScript } from "./lib/storefrontSnippetEntry";

runStorefrontSnippetScript(storefrontSnippet("metaorder-regalplaner"));
