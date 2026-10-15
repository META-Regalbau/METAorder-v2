/**
 * Schreibt die Produkttexte aus exportProductDescriptions.ts (<out>.jsonl) in den Shop (Systemsprache).
 * Sicherheitsnetz:
 * - Ohne --apply nur Testlauf (zählt, was geschrieben würde).
 * - Geschrieben wird nur, wenn die Beschreibung im Shop noch genau der beim Export gelesenen
 *   ("alten") entspricht; inzwischen geänderte Artikel werden ausgelassen und gelistet.
 * - Vorher Sicherung aller betroffenen Beschreibungen nach <jsonl>.backup-<zeit>.json.
 * - Markierung customFields.metaorder_description = { hash, writtenAt } am Artikel; mit --check
 *   meldet das Skript Artikel, deren Text seitdem überschrieben wurde (z. B. Pimcore-Export),
 *   mit --check --apply schreibt es sie erneut (nur wenn der Shop dann wieder den alten Text hat).
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeProductDescriptions.ts <tenantId> <texte.jsonl> [--apply] [--check] [--only nr1,nr2]
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import type { DescriptionRow } from "../server/products/productDescriptionTexts";
import type { ProductDescriptionUpdate } from "../server/shopware/client/productMeta";

const MARKER = "metaorder_description";
const hash = (html: string) => createHash("sha256").update(html).digest("hex").slice(0, 16);
const norm = (html: string | null | undefined) => (html ?? "").replace(/\s+/g, " ").trim();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [tenantId, jsonl] = process.argv.slice(2);
  if (!tenantId || !jsonl?.endsWith(".jsonl")) {
    console.error("Usage: npx tsx scripts/writeProductDescriptions.ts <tenantId> <texte.jsonl> [--apply] [--check] [--only nr1,nr2]");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const check = process.argv.includes("--check");
  const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  // Letzte gültige Zeile je Artikel aus dem Export
  const rows = new Map<string, DescriptionRow>();
  for (const line of readFileSync(jsonl, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as DescriptionRow;
    if (!row.problem && row.html) rows.set(row.productNumber, row);
  }

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const client = new ShopwareClient(settings);
  const products = await client.fetchProductMetaSources();
  console.log(`${settings.shopwareUrl}: ${products.length} aktive Artikel, ${rows.size} Texte im Export${only.size ? `, nur ${only.size}` : ""}`);

  const updates: ProductDescriptionUpdate[] = [];
  const backup: Array<{ id: string; productNumber: string; description: string }> = [];
  const changedSinceExport: string[] = [];
  const reverted: string[] = [];
  let alreadyDone = 0;
  let notInShop = 0;
  const now = new Date().toISOString();
  for (const [nr, row] of rows) {
    if (only.size && !only.has(nr)) continue;
    const p = products.find((x) => x.productNumber === nr);
    if (!p) {
      notInShop += 1;
      continue;
    }
    const current = norm(p.description);
    const marker = p.customFields?.[MARKER] as { hash?: string } | undefined;
    if (current === norm(row.html)) {
      alreadyDone += 1;
      continue;
    }
    if (marker?.hash === hash(row.html)) reverted.push(nr); // war schon geschrieben, ist jetzt wieder anders
    if (check && marker?.hash !== hash(row.html)) continue; // --check: nur zurückgesetzte
    if (current !== norm(row.oldHtml)) {
      changedSinceExport.push(nr);
      continue;
    }
    backup.push({ id: p.id, productNumber: nr, description: p.description });
    updates.push({ id: p.id, description: row.html, customFields: { [MARKER]: { hash: hash(row.html), writtenAt: now } } });
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "APPLY" : "DRY-RUN",
        check,
        toWrite: updates.length,
        alreadyDone,
        revertedSinceWrite: reverted.length,
        changedSinceExport: changedSinceExport.length,
        notInShop,
      },
      null,
      1,
    ),
  );
  if (reverted.length) console.log("Zurückgesetzt (z. B. Pimcore-Export):", reverted.slice(0, 30).join(", "));
  if (changedSinceExport.length) console.log("Seit Export geändert, ausgelassen:", changedSinceExport.slice(0, 30).join(", "));
  if (!apply || updates.length === 0) return;

  const backupFile = `${jsonl}.backup-${now.replace(/[:.]/g, "-")}.json`;
  writeFileSync(backupFile, JSON.stringify(backup));
  console.log(`Sicherung: ${backupFile} (${backup.length})`);
  for (let i = 0; i < updates.length; i += 200) {
    await client.syncProductDescriptions(updates.slice(i, i + 200));
    console.log(`PROGRESS ${Math.min(i + 200, updates.length)}/${updates.length}`);
  }
  console.log(`FERTIG: ${updates.length} Beschreibungen geschrieben`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
