/**
 * Einspielen von Storefront-Bausteinen (shopware/storefront-snippets/*.js + .css) in den Shop.
 *
 * Weg ohne eigenes Plugin: je Baustein ein Eintrag im Plugin „Eigenes CSS/JS“ (DneCustomCssJs, Entität
 * dne_custom_js_css) mit fester ID, nur für den Kanal „META Regalbau DE“. Danach wird das Theme
 * dieses Kanals neu erstellt, erst dann liefert der Shop das Skript aus. Fremde Einträge bleiben unberührt.
 *
 * Ohne --apply nur Testlauf. Mit --apply Protokoll (Stand vorher); --revert stellt ihn wieder her
 * bzw. löscht den Eintrag. Schreibt nur in Shops mit „test.“ in der URL, außer mit --live.
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { storage } from "../../server/storage";
import { snippetEntryId, type StorefrontSnippetDef } from "../../server/shopContent/shopEntityIds";
import { findDeChannel, shopApi, type ShopApi } from "../../server/shopContent/shopProducts";

const SNIPPET_DIR = path.resolve(import.meta.dirname, "..", "..", "shopware", "storefront-snippets");

export type StorefrontSnippet = StorefrontSnippetDef;

type Entry = { id: string; name: string; description: string | null; active: boolean; js: string | null; css: string | null; salesChannelIds: string[] };
type Protocol = { tenantId: string; at: string; base: string; before: Entry | null };

export const entryId = snippetEntryId;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadEntry(api: ShopApi, id: string): Promise<Entry | null> {
  const res = await api("POST", "search/dne-custom-js-css", { ids: [id], associations: { salesChannels: {} } });
  const e = res?.data?.[0];
  if (!e) return null;
  return {
    id: e.id,
    name: e.name,
    description: e.description ?? null,
    active: !!e.active,
    js: e.js ?? null,
    css: e.css ?? null,
    salesChannelIds: (e.salesChannels ?? []).map((s: { id: string }) => s.id),
  };
}

/** Speichert das Entry so, dass genau die angegebenen Kanäle zugeordnet sind. */
async function writeEntry(api: ShopApi, entry: Entry, current: Entry | null) {
  for (const id of current?.salesChannelIds ?? []) {
    if (!entry.salesChannelIds.includes(id)) await api("DELETE", `dne-custom-js-css/${entry.id}/sales-channels/${id}`);
  }
  await api("POST", "_action/sync", [
    {
      action: "upsert",
      entity: "dne_custom_js_css",
      payload: [{
        id: entry.id,
        name: entry.name,
        description: entry.description,
        active: entry.active,
        js: entry.js,
        css: entry.css,
        salesChannels: entry.salesChannelIds.map((id) => ({ id })),
      }],
    },
  ]);
}

/** Theme des Kanals neu erstellen (wie „Speichern“ im Theme-Manager); erst dann ist das Skript im Shop. */
async function compileTheme(api: ShopApi, salesChannelId: string) {
  const res = await api("POST", "search/theme", {
    filter: [{ type: "equals", field: "salesChannels.id", value: salesChannelId }],
    includes: { theme: ["id", "name"] },
  });
  const theme = res?.data?.[0];
  if (!theme) throw new Error(`Kein Theme für Kanal ${salesChannelId}`);
  const started = Date.now();
  await api("PATCH", `_action/theme/${theme.id}`, { config: {} });
  console.log(`Theme „${theme.name}“ neu erstellt (${Math.round((Date.now() - started) / 1000)} s)`);
}

async function run(snippet: StorefrontSnippet) {
  const tenantId = process.argv[2];
  const usage = `Usage: npx tsx scripts/${snippet.script} <tenantId> [--apply] [--live] | --revert <protokoll.json>`;
  if (!tenantId || tenantId.startsWith("--")) {
    console.error(usage);
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const { api, base, isTest } = shopApi(settings);
  const live = process.argv.includes("--live");
  const channel = await findDeChannel(api, base);
  const id = entryId(snippet.key);
  const current = await loadEntry(api, id);

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    if (!isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
    if (log.before) {
      await writeEntry(api, log.before, current);
      console.log(`Eintrag „${log.before.name}“ auf Stand ${log.at} zurückgesetzt`);
    } else if (current) {
      await api("DELETE", `dne-custom-js-css/${id}`);
      console.log(`Eintrag „${current.name}“ gelöscht`);
    }
    await compileTheme(api, channel.id);
    if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
    return;
  }

  const next: Entry = {
    id,
    name: snippet.name,
    description: `Von METAorder verwaltet (scripts/${snippet.script}). Änderungen hier überschreibt der nächste Lauf.`,
    active: true,
    js: readFileSync(path.join(SNIPPET_DIR, `${snippet.file}.js`), "utf8"),
    css: readFileSync(path.join(SNIPPET_DIR, `${snippet.file}.css`), "utf8"),
    salesChannelIds: [channel.id],
  };
  const unchanged = current && current.js === next.js && current.css === next.css && current.active
    && current.salesChannelIds.join() === next.salesChannelIds.join();
  console.log(`${base} · Kanal ${channel.name} (${channel.id})`);
  console.log(current ? `Eintrag vorhanden${unchanged ? ", unverändert" : ", wird aktualisiert"}` : "Eintrag wird neu angelegt");
  console.log(`JS ${next.js!.length} Zeichen, CSS ${next.css!.length} Zeichen`);

  if (!process.argv.includes("--apply")) {
    console.log("Testlauf – mit --apply schreiben");
    return;
  }
  if (!isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);

  const log: Protocol = { tenantId, at: new Date().toISOString(), base, before: current };
  const file = `${snippet.protocolPrefix}-${isTest ? "Testing" : "Live"}-${log.at.slice(0, 16).replace(":", "-")}.json`;
  writeFileSync(file, JSON.stringify(log, null, 2));
  console.log(`Protokoll: ${file}`);

  if (!unchanged) await writeEntry(api, next, current);
  await compileTheme(api, channel.id);
  if (isTest) await api("DELETE", "_action/cache").catch((e) => console.log("Cache", e.message));
  console.log("Fertig");
}

/** Einstieg für die Skripte scripts/write*.ts eines Bausteins. */
export function runStorefrontSnippetScript(snippet: StorefrontSnippet) {
  run(snippet).then(() => process.exit(0), (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
