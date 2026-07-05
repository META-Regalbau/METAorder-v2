/**
 * Import von Herstellkosten (VTLS / Herstellkosten) aus ÜbersichtVerkaufsartikel.xlsx
 * in META Order (Tabelle product_herstellpreise) — nicht in Shopware.
 *
 * Default: Dry-Run. Mit --apply werden Werte in der META-Order-Datenbank gespeichert.
 *
 * Aufruf:
 *   npm run import:herstellpreise:dev -- <tenantId> --file="/pfad/ÜbersichtVerkaufsartikel.xlsx"
 *   npm run import:herstellpreise:dev -- <tenantId> --file="/pfad/datei.xlsx" --apply
 */
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware";
import {
  parseHerstellpreisRowsFromFile,
  runHerstellpreisImport,
} from "../server/herstellpreisImport";

function parseArgs(argv: string[]): {
  tenantId: string | undefined;
  file: string | undefined;
  apply: boolean;
} {
  let tenantId: string | undefined;
  let file: string | undefined;
  let apply = false;

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--file=")) {
      file = arg.slice("--file=".length);
      continue;
    }
    if (arg.startsWith("--tenant=")) {
      tenantId = arg.slice("--tenant=".length);
      continue;
    }
    if (!arg.startsWith("-") && !tenantId) {
      tenantId = arg;
    }
  }

  return { tenantId, file, apply };
}

async function main(): Promise<void> {
  const { tenantId: tenantIdArg, file, apply } = parseArgs(process.argv.slice(2));
  const tenantId = tenantIdArg ?? process.env.TENANT_ID;

  if (!tenantId || !file) {
    console.error(
      "Usage: npm run import:herstellpreise:dev -- <tenantId> --file=/pfad/ÜbersichtVerkaufsartikel.xlsx [--apply]",
    );
    process.exit(1);
  }

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) {
    console.error(`Shopware settings not configured for tenant: ${tenantId}`);
    process.exit(1);
  }

  const rows = parseHerstellpreisRowsFromFile(file);
  const client = new ShopwareClient(settings);

  console.log(
    JSON.stringify({ mode: apply ? "apply" : "dry-run", tenantId, file, totalRows: rows.length }, null, 2),
  );

  const result = await runHerstellpreisImport(
    {
      storage,
      tenantId,
      resolveCatalogProductNumbers: async (ifsNumbers) => {
        const products = await client.searchProductsByIfsProductNumbers(ifsNumbers);
        const found = new Set<string>();
        const ifsByNormalized = new Map(
          products.map((p) => [String(p.ifsProductNumber).trim(), p.ifsProductNumber]),
        );
        for (const input of ifsNumbers) {
          const trimmed = String(input).trim();
          if (ifsByNormalized.has(trimmed)) {
            found.add(input);
          }
        }
        return found;
      },
    },
    rows,
    { apply },
    (msg) => console.log(msg),
  );

  console.log("\n===== Zusammenfassung =====");
  console.log(JSON.stringify({
    mode: result.mode,
    totalRows: result.totalRows,
    matched: result.matched,
    updated: result.updated,
    unchanged: result.unchanged,
    notFound: result.notFound,
    errors: result.errors,
  }, null, 2));

  const problems = result.rows.filter((r) => r.status === "not_found" || r.status === "error").slice(0, 20);
  if (problems.length > 0) {
    console.log("\nBeispiele (nicht gefunden / Fehler):");
    for (const row of problems) {
      console.log(`  ${row.productNumber}: ${row.status}${row.message ? ` – ${row.message}` : ""}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
