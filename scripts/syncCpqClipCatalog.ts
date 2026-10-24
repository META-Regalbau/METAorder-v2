/**
 * Regalplaner META CLIP: Produkt-Mappings (Clinch + S3) aus dem Shop-Spiegel des Mandanten ableiten
 * (server/cpq/clipCatalogSync.ts). Dasselbe wie POST /api/cpq/admin/clip-catalog-sync, für die Kommandozeile.
 *
 * Ohne --apply nur Vorschau. Mit --apply Protokoll im Arbeitsverzeichnis; --revert stellt den Stand vorher her.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/syncCpqClipCatalog.ts <tenantId> [--apply]
 *   NODE_ENV=development npx tsx scripts/syncCpqClipCatalog.ts <tenantId> --revert <protokoll.json>
 */
import { readFileSync, writeFileSync } from "fs";
import { revertClipCatalogSync, runClipCatalogSync, type ClipCatalogSyncProtocol } from "../server/cpq/clipCatalogSyncService";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId || tenantId.startsWith("--")) {
    console.error("Usage: npx tsx scripts/syncCpqClipCatalog.ts <tenantId> [--apply] | --revert <protokoll.json>");
    process.exit(1);
  }
  const revertFile = arg("--revert");
  if (revertFile) {
    await revertClipCatalogSync(JSON.parse(readFileSync(revertFile, "utf8")) as ClipCatalogSyncProtocol, tenantId);
    console.log(`Stand vor ${revertFile} wiederhergestellt`);
    return;
  }
  const apply = process.argv.includes("--apply");
  const r = await runClipCatalogSync(tenantId, { apply });
  console.log(`System ${r.systemId ?? "META CLIP (wird angelegt)"}${r.missingComponentTypes.length ? ` · fehlende Bauteiltypen: ${r.missingComponentTypes.join(", ")}` : ""}`);
  console.log(`Soll: ${r.plan.specs} Teile · ${Object.entries(r.plan.byRole).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  for (const s of r.plan.skipped) console.log(`  ausgelassen: ${s.name} (${s.productNumber}) – ${s.reason}`);
  console.log(`Neu ${r.diff.create.length} · geändert ${r.diff.update.length} · deaktiviert ${r.diff.deactivate.length} · unverändert ${r.diff.unchanged}`);
  for (const c of r.diff.create) console.log(`  + ${c.role}: ${c.name}`);
  for (const u of r.diff.update) console.log(`  ~ ${u.role}: ${u.name}`);
  for (const d of r.diff.deactivate) console.log(`  - ${d.name ?? d.productNumber}`);
  if (!apply) {
    console.log("Testlauf – mit --apply schreiben");
    return;
  }
  const file = `Regalplaner-Mappings-Protokoll-${r.protocol!.at.slice(0, 16).replace(":", "-")}.json`;
  writeFileSync(file, JSON.stringify(r.protocol, null, 2));
  console.log(`Geschrieben. Protokoll: ${file}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
