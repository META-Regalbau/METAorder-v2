/**
 * CLI-Import von SAP-Rechnungsnummern in den Shop.
 *
 * Die eigentliche Logik liegt in server/shopFakturenImport.ts (wird auch vom
 * META-Order-Upload-Endpoint genutzt). Dieses Skript ist nur der CLI-Wrapper.
 *
 * Default ist ein Dry-Run (keine Aenderungen). Zum Anwenden: --apply
 *
 * Aufruf (im Container):
 *   docker compose cp ~/Downloads/Shop_Fakturen.xlsx app:/app/Shop_Fakturen.xlsx
 *   docker compose exec app npm run import:shop-fakturen -- <tenantId> --file=/app/Shop_Fakturen.xlsx
 *   docker compose exec app npm run import:shop-fakturen -- <tenantId> --file=/app/Shop_Fakturen.xlsx --apply
 *
 * Flags:
 *   --field-on-conflict       Bei echtem Konflikt nur Custom Field setzen (keine neue Rechnung)
 *   --skip-original-backfill  Fehlende Originalrechnung NICHT automatisch nachlegen
 *   --mark-unsent             SAP-Rechnungen als "vorhanden, aber nicht verschickt" markieren
 */
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware";
import { parseFakturaRowsFromFile, runFakturaImport } from "../server/shopFakturenImport";

const DEFAULT_FILE = "/app/Shop_Fakturen.xlsx";

function parseArgs(argv: string[]): {
  tenantId: string | undefined;
  file: string;
  apply: boolean;
  fieldOnConflict: boolean;
  skipOriginalBackfill: boolean;
  markUnsent: boolean;
} {
  let tenantId: string | undefined;
  let file = DEFAULT_FILE;
  let apply = false;
  let fieldOnConflict = false;
  let skipOriginalBackfill = false;
  let markUnsent = false;

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--field-on-conflict") {
      fieldOnConflict = true;
      continue;
    }
    if (arg === "--skip-original-backfill") {
      skipOriginalBackfill = true;
      continue;
    }
    if (arg === "--mark-unsent") {
      markUnsent = true;
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

  return { tenantId, file, apply, fieldOnConflict, skipOriginalBackfill, markUnsent };
}

async function main(): Promise<void> {
  const { tenantId: tenantIdArg, file, apply, fieldOnConflict, skipOriginalBackfill, markUnsent } =
    parseArgs(process.argv.slice(2));
  const tenantId = tenantIdArg ?? process.env.TENANT_ID;

  if (!tenantId) {
    console.error(
      "Usage: npm run import:shop-fakturen -- <tenantId> [--file=/app/Shop_Fakturen.xlsx] [--field-on-conflict] [--skip-original-backfill] [--mark-unsent] [--apply]",
    );
    process.exit(1);
  }

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) {
    console.error(`Shopware settings not configured for tenant: ${tenantId}`);
    process.exit(1);
  }

  const rows = parseFakturaRowsFromFile(file);
  const client = new ShopwareClient(settings);

  console.log(
    JSON.stringify(
      { mode: apply ? "apply" : "dry-run", tenantId, file, totalRows: rows.length, fieldOnConflict, skipOriginalBackfill, markUnsent },
      null,
      2,
    ),
  );

  const result = await runFakturaImport(
    client,
    tenantId,
    rows,
    { apply, fieldOnConflict, skipOriginalBackfill, markUnsent },
    (msg) => console.log(msg),
  );

  console.log("\n===== Zusammenfassung =====");
  console.log(JSON.stringify(result.summary, null, 2));
  if (markUnsent) {
    console.log(
      `\nAls "nicht verschickt" markiert (sent=false): ${result.markedUnsentCount} SAP-Rechnung(en)` +
        (apply ? "" : " (Dry-Run, noch nicht angewendet)"),
    );
  }

  const problems = result.rows.filter(
    (r) => r.status === "not_found" || r.status === "skipped_conflict" || r.status === "error",
  );
  if (problems.length > 0) {
    console.log("\n===== Zu pruefen =====");
    for (const p of problems) {
      console.log(`Zeile ${p.rowNumber} [${p.status}] ${p.orderNumber} -> ${p.invoiceNumber}: ${p.message}`);
    }
  }

  if (!apply) {
    const creatable =
      (result.summary["would_create"] ?? 0) +
      (result.summary["would_create_nachlieferung"] ?? 0) +
      (result.summary["would_create_original"] ?? 0);
    console.log(`\nDry-Run: ${creatable} Rechnung(en) wuerden erstellt. Zum Anwenden: --apply`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("import-shop-fakturen failed:", message);
  process.exit(1);
});
