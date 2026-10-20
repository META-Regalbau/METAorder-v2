/**
 * Spielt den Hinweis auf E-Mail-Werbung an Bestandskunden in den Shop ein (Kundenmails B0,
 * shopware/storefront-snippets/email-notice.js + .css): an der Kasse unter der Newsletter-Checkbox und bei der
 * Registrierung unter der E-Mail-Adresse. Erst nach Freigabe der Texte durch den DSB einspielen; das Datum von
 * „--live“ ist dann der Stichtag der Bestandskunden-Regel (in METAorder unter Kundenmails → Einstellungen eintragen).
 * Danach EMAIL_NOTICE_SNIPPET in STOREFRONT_SNIPPETS übernehmen (Shop-Wächter).
 * Ablauf, Protokoll und Rückbau: scripts/lib/storefrontSnippetEntry.ts.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeEmailNotice.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeEmailNotice.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { EMAIL_NOTICE_SNIPPET } from "../server/shopContent/shopEntityIds";
import { runStorefrontSnippetScript } from "./lib/storefrontSnippetEntry";

runStorefrontSnippetScript(EMAIL_NOTICE_SNIPPET);
