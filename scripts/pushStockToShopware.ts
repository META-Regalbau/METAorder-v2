/**
 * ERP-Bestand eines Mandanten als absolute Menge nach Shopware schreiben.
 *
 * Entspricht dem Button „Bestand nach Shopware schreiben" in der Warenwirtschaft, nutzt
 * dieselbe Funktion (pushErpStockToShopware) — nur ohne UI, damit es skriptbar ist.
 *
 * Vor dem Schreiben wird der aktuelle Shopware-Bestand aller betroffenen Artikel als CSV
 * gesichert. Das ist die einzige Rückfahrkarte: Shopware speichert keinen Verlauf des
 * Lagerbestands, ein falscher Lauf wäre sonst nicht rekonstruierbar.
 *
 * Aufruf:
 *   DATABASE_URL=… npx tsx scripts/pushStockToShopware.ts --tenant=IDS --backup=/pfad/backup.csv
 *   … dieselbe Zeile mit --apply, um wirklich zu schreiben.
 */
import { eq } from "drizzle-orm";
import { writeFileSync } from "fs";
import { db } from "../server/db";
import { tenants } from "../shared/schema";
import { buildStockReconcileDiff, pushErpStockToShopware } from "../server/erp/erpStockReconcile";
import { storage } from "../server/storage";

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const tenantArg = arg("tenant");
  const backupPath = arg("backup");
  const apply = process.argv.includes("--apply");
  if (!tenantArg) {
    console.error("--tenant=<Name|ID> fehlt.");
    process.exit(1);
  }

  const all = await db.select().from(tenants);
  const tenant =
    all.find((t) => t.id === tenantArg) ||
    all.find((t) => t.name.toLowerCase() === tenantArg.toLowerCase());
  if (!tenant) {
    console.error(`Mandant "${tenantArg}" nicht gefunden.`);
    process.exit(1);
  }

  const settings = await storage.getShopwareSettings(tenant.id);
  if (!settings) {
    console.error(`Mandant ${tenant.name} hat keine Shopware-Konfiguration.`);
    process.exit(1);
  }

  console.log(`Mandant: ${tenant.name}`);
  console.log(`Shop:    ${settings.shopwareUrl}`);
  console.log(`Modus:   ${apply ? "APPLY — es wird in den Shop geschrieben" : "DRY RUN"}`);
  console.log();

  const diff = await buildStockReconcileDiff(tenant.id, { onlyDiffs: false });
  const changed = diff.rows.filter((r) => r.delta !== 0 && !r.isParent);
  const writable = changed.filter((r) => r.shopwareId || r.label?.shopwareId);
  const noId = changed.length - writable.length;

  const toZero = writable.filter((r) => r.erpQty === 0 && (r.shopwareQty ?? 0) > 0);
  const up = writable.filter((r) => r.erpQty > (r.shopwareQty ?? 0));

  console.log(`Lager:                       ${diff.warehouseCode}`);
  console.log(`Abweichungen gesamt:         ${changed.length}`);
  console.log(`  davon schreibbar:          ${writable.length}`);
  console.log(`  ohne Shopware-ID (skip):   ${noId}`);
  console.log(`  davon auf 0 gesetzt:       ${toZero.length}`);
  console.log(`  davon erhöht:              ${up.length}`);
  console.log();

  if (backupPath) {
    const csv = [
      "artikelnummer;shopware_id;shop_bestand_vorher;erp_bestand_neu;delta",
      ...writable.map((r) =>
        [
          r.productNumber,
          r.shopwareId || r.label?.shopwareId || "",
          r.shopwareQty ?? "",
          r.erpQty,
          r.delta,
        ].join(";"),
      ),
    ].join("\n");
    writeFileSync(backupPath, csv, "utf8");
    console.log(`Sicherung der Shop-Bestände geschrieben: ${backupPath}`);
    console.log();
  }

  if (!apply) {
    console.log("DRY RUN — im Shop wurde nichts geändert.");
    process.exit(0);
  }

  if (!backupPath) {
    console.error("Ohne --backup=<Pfad> wird nicht geschrieben. Shopware kennt kein Undo.");
    process.exit(1);
  }

  console.log("Schreibe in den Shop …");
  const result = await pushErpStockToShopware(tenant.id, { allDiffs: true });
  console.log();
  console.log(`Aktualisiert: ${result.updated}   Übersprungen: ${result.skipped}   Fehler: ${result.failed}`);
  if (result.errors.length > 0) {
    console.log("Fehler (max. 20):");
    for (const e of result.errors) console.log(`  ${e}`);
  }
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
