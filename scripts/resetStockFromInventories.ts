/**
 * Bestände eines Mandanten auf die Inventurergebnisse zurücksetzen.
 *
 * Fachlich: erst alles auf 0, dann die gezählten Mengen aus den Inventuren eintragen.
 * Technisch wird das in einem Schritt gemacht — je Artikel eine Korrekturbuchung auf die
 * Zielmenge. Zwei getrennte Läufe (erst 0, dann hoch) würden dieselbe Endmenge ergeben, aber
 * die Bewegungsliste mit doppelt so vielen Buchungen fluten und zwischenzeitlich einen
 * Bestand von 0 im System stehen lassen.
 *
 * Zielmenge je Artikel:
 *   - Artikel in einer Inventur gezählt → jüngste Zählung gewinnt (counted_at, sonst created_at)
 *   - Artikel ohne Zählung              → 0
 *
 * Geschrieben wird über erpStorage.recordStockMovement mit movementType "adjustment".
 * Damit bleibt die Bewegungsliste konsistent zum Bestand — ein direktes UPDATE auf
 * erp_stock_levels würde die Salden und das Bewegungsjournal auseinanderlaufen lassen.
 * Reservierte Mengen werden nicht angefasst.
 *
 * Aufruf (Host, gegen die lokale DB):
 *   DATABASE_URL=postgresql://metaorder:metaorder@127.0.0.1:5433/metaorder \
 *   npx tsx scripts/resetStockFromInventories.ts --tenant=IDS
 *
 * Optionen:
 *   --tenant=<Name|ID>   Mandant (Pflicht)
 *   --include-drafts     auch Inventuren im Status "draft" berücksichtigen (Default: nur completed)
 *   --apply              tatsächlich buchen (ohne diese Option nur Dry-Run)
 *   --csv=<Pfad>         vollständige Zeilenliste als CSV ablegen
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import {
  erpInventoryCountLines,
  erpInventoryCounts,
  erpStockLevels,
  erpWarehouses,
} from "../shared/erpSchema";
import { tenants } from "../shared/schema";
import { erpStorage } from "../server/erp/erpStorage";

type Args = {
  tenant: string;
  includeDrafts: boolean;
  apply: boolean;
  csv: string | null;
};

function parseArgs(argv: string[]): Args {
  let tenant = "";
  let csv: string | null = null;
  for (const a of argv) {
    if (a.startsWith("--tenant=")) tenant = a.slice("--tenant=".length);
    if (a.startsWith("--csv=")) csv = a.slice("--csv=".length);
  }
  return {
    tenant,
    includeDrafts: argv.includes("--include-drafts"),
    apply: argv.includes("--apply"),
    csv,
  };
}

function fmt(n: number): string {
  return new Intl.NumberFormat("de-DE").format(n);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tenant) {
    console.error("--tenant=<Name|ID> fehlt.");
    process.exit(1);
  }

  const allTenants = await db.select().from(tenants);
  const tenant =
    allTenants.find((t) => t.id === args.tenant) ||
    allTenants.find((t) => t.name.toLowerCase() === args.tenant.toLowerCase());
  if (!tenant) {
    console.error(
      `Mandant "${args.tenant}" nicht gefunden. Vorhanden: ${allTenants.map((t) => t.name).join(", ")}`,
    );
    process.exit(1);
  }

  const warehouses = await db
    .select()
    .from(erpWarehouses)
    .where(eq(erpWarehouses.tenantId, tenant.id));
  if (warehouses.length === 0) {
    console.error(`Mandant ${tenant.name} hat kein Lager.`);
    process.exit(1);
  }

  console.log(`Mandant: ${tenant.name} (${tenant.id})`);
  console.log(`Lager:   ${warehouses.map((w) => `${w.code} — ${w.name}`).join(", ")}`);
  console.log(`Modus:   ${args.apply ? "APPLY — es wird gebucht" : "DRY RUN — es wird nichts geändert"}`);
  console.log(`Inventuren: ${args.includeDrafts ? "completed + draft" : "nur completed"}`);
  console.log();

  // ---- 1. Zielmengen aus den Inventuren ----------------------------------------------
  const statusFilter = args.includeDrafts ? ["completed", "draft"] : ["completed"];
  const counts = await db
    .select()
    .from(erpInventoryCounts)
    .where(
      and(
        eq(erpInventoryCounts.tenantId, tenant.id),
        inArray(erpInventoryCounts.status, statusFilter),
      ),
    );

  const countById = new Map(counts.map((c) => [c.id, c]));
  const lines = counts.length
    ? await db
        .select()
        .from(erpInventoryCountLines)
        .where(
          inArray(
            erpInventoryCountLines.inventoryCountId,
            counts.map((c) => c.id),
          ),
        )
    : [];

  /** Jüngste Zählung je Artikel — counted_at, sonst created_at als Ersatz. */
  const target = new Map<
    string,
    { qty: number; countId: string; at: Date; warehouseId: string; conflicts: number }
  >();
  for (const line of lines) {
    if (line.countedQty == null) continue;
    const count = countById.get(line.inventoryCountId);
    if (!count) continue;
    const at = count.countedAt ?? count.createdAt ?? new Date(0);
    const prev = target.get(line.productNumber);
    if (!prev || at > prev.at) {
      target.set(line.productNumber, {
        qty: Number(line.countedQty),
        countId: count.id,
        at,
        warehouseId: count.warehouseId,
        conflicts: (prev?.conflicts ?? 0) + (prev ? 1 : 0),
      });
    } else {
      prev.conflicts += 1;
    }
  }

  // ---- 2. Ist-Bestände ----------------------------------------------------------------
  const stock = await db
    .select()
    .from(erpStockLevels)
    .where(eq(erpStockLevels.tenantId, tenant.id));

  type Row = {
    productNumber: string;
    warehouseId: string;
    /**
     * Lagerplatz der bestehenden Bestandszeile. Muss mitgebucht werden: recordStockMovement
     * sucht die Zeile über (Lager, Artikel, Lagerplatz) und trifft ohne diesen Wert nur
     * Zeilen mit location_id IS NULL — für Artikel mit zugewiesenem Platz würde sonst eine
     * zweite Zeile entstehen und die eigentliche unverändert bleiben.
     */
    locationId: string | null;
    current: number;
    targetQty: number;
    delta: number;
    source: "inventur" | "nicht-gezaehlt" | "neu-aus-inventur";
    countId: string | null;
  };

  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const s of stock) {
    const key = `${s.warehouseId}|${s.productNumber}`;
    seen.add(key);
    const hit = target.get(s.productNumber);
    const current = Number(s.quantity || 0);
    const targetQty = hit ? hit.qty : 0;
    rows.push({
      productNumber: s.productNumber,
      warehouseId: s.warehouseId,
      locationId: s.locationId ?? null,
      current,
      targetQty,
      delta: targetQty - current,
      source: hit ? "inventur" : "nicht-gezaehlt",
      countId: hit?.countId ?? null,
    });
  }

  // Artikel, die nur in einer Inventur vorkommen (noch ohne Bestandszeile)
  for (const [productNumber, hit] of target) {
    const key = `${hit.warehouseId}|${productNumber}`;
    if (seen.has(key)) continue;
    rows.push({
      productNumber,
      warehouseId: hit.warehouseId,
      locationId: null,
      current: 0,
      targetQty: hit.qty,
      delta: hit.qty,
      source: "neu-aus-inventur",
      countId: hit.countId,
    });
  }

  const changed = rows.filter((r) => r.delta !== 0);
  const fromInventory = rows.filter((r) => r.source !== "nicht-gezaehlt");
  const toZero = rows.filter((r) => r.source === "nicht-gezaehlt" && r.current !== 0);
  const created = rows.filter((r) => r.source === "neu-aus-inventur");

  const sumBefore = rows.reduce((a, r) => a + r.current, 0);
  const sumAfter = rows.reduce((a, r) => a + r.targetQty, 0);

  console.log("── Übersicht ─────────────────────────────────────────────");
  console.log(`Bestandszeilen gesamt:            ${fmt(rows.length)}`);
  console.log(`  davon mit Inventurwert:         ${fmt(fromInventory.length)}`);
  console.log(`  davon ohne Zählung → auf 0:     ${fmt(rows.length - fromInventory.length)}`);
  console.log(`     davon heute noch ungleich 0: ${fmt(toZero.length)}  (Menge: ${fmt(toZero.reduce((a, r) => a + r.current, 0))})`);
  console.log(`Neue Zeilen aus Inventur:         ${fmt(created.length)}`);
  console.log();
  console.log(`Zeilen mit Änderung:              ${fmt(changed.length)}`);
  console.log(`Gesamtmenge vorher:               ${fmt(sumBefore)}`);
  console.log(`Gesamtmenge nachher:              ${fmt(sumAfter)}`);
  console.log(`Differenz:                        ${sumAfter - sumBefore > 0 ? "+" : ""}${fmt(sumAfter - sumBefore)}`);
  console.log();

  const multiCounted = Array.from(target.entries()).filter(([, v]) => v.conflicts > 0);
  if (multiCounted.length > 0) {
    console.log(`── ${multiCounted.length} Artikel mehrfach gezählt — jüngste Zählung gewinnt ──`);
    for (const [pn, v] of multiCounted.slice(0, 15)) {
      console.log(
        `  ${pn.padEnd(20)} → ${String(v.qty).padStart(4)}  (Inventur ${v.countId.slice(0, 8)} vom ${v.at.toISOString().slice(0, 10)})`,
      );
    }
    if (multiCounted.length > 15) console.log(`  … und ${multiCounted.length - 15} weitere`);
    console.log();
  }

  const biggest = [...changed].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);
  console.log("── Größte Änderungen ─────────────────────────────────────");
  console.log("Artikel              vorher → nachher   Δ      Quelle");
  for (const r of biggest) {
    console.log(
      `${r.productNumber.padEnd(20)} ${String(r.current).padStart(5)} → ${String(r.targetQty).padStart(5)}  ${(r.delta > 0 ? "+" : "") + r.delta}`.padEnd(52) +
        r.source,
    );
  }
  console.log();

  if (args.csv) {
    const { writeFileSync } = await import("fs");
    const csv = [
      "artikelnummer;lager;vorher;nachher;differenz;quelle;inventur",
      ...rows
        .sort((a, b) => a.productNumber.localeCompare(b.productNumber))
        .map((r) =>
          [r.productNumber, r.warehouseId, r.current, r.targetQty, r.delta, r.source, r.countId ?? ""].join(";"),
        ),
    ].join("\n");
    writeFileSync(args.csv, csv, "utf8");
    console.log(`CSV geschrieben: ${args.csv}`);
    console.log();
  }

  if (!args.apply) {
    console.log("DRY RUN — nichts geändert. Zum Ausführen dieselbe Zeile mit --apply wiederholen.");
    process.exit(0);
  }

  // ---- 3. Buchen ----------------------------------------------------------------------
  console.log("── Buchen ────────────────────────────────────────────────");
  let ok = 0;
  let failed = 0;
  for (const r of changed) {
    try {
      await erpStorage.recordStockMovement(
        {
          warehouseId: r.warehouseId,
          productNumber: r.productNumber,
          locationId: r.locationId,
          quantity: r.delta,
          movementType: "adjustment",
          referenceType: "inventory_reset",
          referenceId: r.countId ?? undefined,
          note:
            r.source === "nicht-gezaehlt"
              ? "Bestandsreset: nicht inventarisiert → 0"
              : `Bestandsreset aus Inventur ${r.countId?.slice(0, 8) ?? ""}`,
        },
        tenant.id,
      );
      ok += 1;
      if (ok % 50 === 0) console.log(`  ${ok}/${changed.length} …`);
    } catch (e: any) {
      failed += 1;
      console.error(`  FEHLER ${r.productNumber}: ${e?.message || e}`);
    }
  }

  console.log();
  console.log(`Gebucht: ${fmt(ok)}   Fehler: ${fmt(failed)}`);

  // ---- 4. Nachkontrolle ---------------------------------------------------------------
  const after = await db
    .select()
    .from(erpStockLevels)
    .where(eq(erpStockLevels.tenantId, tenant.id));
  const sumNow = after.reduce((a, s) => a + Number(s.quantity || 0), 0);
  console.log(`Gesamtmenge laut DB nach dem Lauf: ${fmt(sumNow)} (erwartet: ${fmt(sumAfter)})`);
  if (sumNow !== sumAfter) {
    console.error("ACHTUNG: Ist- und Erwartungswert weichen ab — bitte prüfen.");
    process.exit(1);
  }
  console.log("Nachkontrolle ok.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
