/**
 * Kurze SEO-/GEO-Produktbeschreibungen per KI als Excel fuer den Pimcore-Import.
 * Schreibt NICHT in den Shop. Nur aktive, sichtbare Artikel; Texte auf Deutsch, HTML.
 * Aufbau und Pruefregeln: server/products/productDescriptionTexts.ts
 *
 * Zwischenstand je Artikel in <out>.jsonl - ein abgebrochener Lauf setzt dort fort.
 *
 * Aufruf (im App-Container, siehe Projekt-Doku zu Skripten gegen Shopware):
 *   NODE_ENV=development npx tsx scripts/exportProductDescriptions.ts <shopTenantId> <out.xlsx> \
 *     [--llm-tenant <tenantId>] [--limit 30] [--concurrency 3]
 */
import { appendFileSync, existsSync, readFileSync } from "fs";
import * as XLSX from "xlsx";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import {
  CLOSING_SENTENCES,
  generateDescriptions,
  llmDescriptionGenerator,
  type DescriptionRow,
} from "../server/products/productDescriptionTexts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [tenantId, out] = process.argv.slice(2);
  if (!tenantId || !out?.endsWith(".xlsx")) {
    console.error("Usage: npx tsx scripts/exportProductDescriptions.ts <shopTenantId> <out.xlsx> [--llm-tenant id] [--limit n] [--concurrency n]");
    process.exit(1);
  }
  const llmTenant = arg("--llm-tenant") ?? tenantId;
  const limit = Number(arg("--limit") ?? Infinity);
  const concurrency = Number(arg("--concurrency") ?? 3);
  const checkpoint = out.replace(/\.xlsx$/, ".jsonl");

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const client = new ShopwareClient(settings);
  const products = (await client.fetchProductMetaSources())
    .filter((p) => p.active && p.visible && p.name)
    .sort((a, b) => a.productNumber.localeCompare(b.productNumber));

  const done = new Map<string, DescriptionRow>();
  if (existsSync(checkpoint)) {
    for (const line of readFileSync(checkpoint, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as DescriptionRow;
      // Fehlversuche beim Fortsetzen neu anfragen
      if (!row.problem) done.set(row.productNumber, row);
    }
  }
  const todo = products.filter((p) => !done.has(p.productNumber)).slice(0, limit);
  console.log(`${settings.shopwareUrl}: ${products.length} aktive Artikel, fertig ${done.size}, jetzt ${todo.length}`);

  const t0 = Date.now();
  await generateDescriptions(todo, llmDescriptionGenerator((k) => storage.getSetting(k, llmTenant)), {
    concurrency,
    onProgress: (n, total) => console.log(`PROGRESS ${n}/${total} (${Math.round((Date.now() - t0) / 1000)}s)`),
    onRows: (rows) => {
      for (const row of rows) {
        appendFileSync(checkpoint, `${JSON.stringify(row)}\n`);
        if (!row.problem) done.set(row.productNumber, row);
      }
    },
  });

  // Excel aus allen Zeilen (fertige + letzte Fehlversuche)
  const all = new Map<string, DescriptionRow>();
  for (const line of readFileSync(checkpoint, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as DescriptionRow;
    const prev = all.get(row.productNumber);
    if (!prev || prev.problem || !row.problem) all.set(row.productNumber, row);
  }
  const order = new Map(products.map((p, i) => [p.productNumber, i]));
  const rows = [...all.values()]
    .filter((r) => order.has(r.productNumber))
    .sort((a, b) => (order.get(a.productNumber) ?? 0) - (order.get(b.productNumber) ?? 0));

  const sheet = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      Artikelnummer: r.productNumber,
      "IFS-Nummer": r.ifsNumber,
      Name: r.name,
      Familie: r.family,
      "Beschreibung neu (HTML)": r.html,
      "Zeichen neu": r.textLength,
      "Beschreibung alt (HTML)": r.oldHtml.slice(0, 32000),
      "Zeichen alt": r.oldTextLength,
      Prüfhinweis: r.problem,
    })),
  );
  sheet["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 60 }, { wch: 9 }, { wch: 90 }, { wch: 10 }, { wch: 60 }, { wch: 10 }, { wch: 24 }];
  const info = XLSX.utils.aoa_to_sheet([
    ["Kurze Produktbeschreibungen (SEO/GEO) für den Pimcore-Import"],
    [`Erstellt: ${new Date().toISOString()} aus ${settings.shopwareUrl}, aktive und sichtbare Artikel`],
    ["Aufbau: Einleitung, 4–6 Stichpunkte mit Kerndaten, „Geeignet für …“, fester Schlusssatz je Familie"],
    ["Prüfung: nur Zahlen aus dem Artikel, Werte aus dem Namen haben Vorrang, keine Preis-/Versand-/Firmenangaben im KI-Teil"],
    ["Spalte „Prüfhinweis“ gefüllt = kein Text erzeugt (Grund); diese Zeilen nicht importieren"],
    [],
    ["Familie", "Schlusssatz"],
    ...Object.entries(CLOSING_SENTENCES),
  ]);
  info["!cols"] = [{ wch: 12 }, { wch: 160 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Beschreibungen");
  XLSX.utils.book_append_sheet(book, info, "Hinweise");
  XLSX.writeFile(book, out);
  const ok = rows.filter((r) => !r.problem).length;
  console.log(`FERTIG ${out}: ${rows.length} Zeilen, ${ok} mit Text, ${rows.length - ok} mit Prüfhinweis`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
