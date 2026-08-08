/**
 * Kennzahlen der individuellen Preise je Kunde aus Shopware holen und spiegeln.
 *
 * Hintergrund: ein zeilenweiser Voll-Snapshot der B2B-Preis-Entität ist bei diesem Shop
 * nicht praktikabel — 12,7 Mio. Preiszeilen über 1.064 Kunden, hochgerechnet über 50 Stunden
 * Abrufzeit. Eine einzige terms-Aggregation über customerId (mit stats über priceNet) liefert
 * dieselbe Grundlage in ~30 Sekunden: Anzahl, Summe, Min, Max, Ø je Kunde.
 *
 * Anzahl + Summe bilden den Fingerabdruck. Ändert er sich, hat der Kunde neue, geänderte oder
 * gelöschte Preise — nur dann muss seine Preisliste im Detail nachgeladen werden.
 * (updatedAt ist auf der Plugin-Entität durchgehend NULL und taugt nicht als Signal.)
 *
 * Aufruf:
 *   DATABASE_URL=… npx tsx scripts/syncCustomerPriceStats.ts --tenant=Live
 *   … mit --apply, um zu schreiben (ohne: nur Bericht).
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { tenants } from "../shared/schema";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware";

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("de-DE").format(Math.round(n));
}

/** Fingerabdruck: Anzahl + Summe auf 2 Nachkommastellen. */
export function priceFingerprint(count: number, sum: number): string {
  return `${count}:${sum.toFixed(2)}`;
}

async function main() {
  const tenantArg = arg("tenant");
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
  console.log(`Modus:   ${apply ? "APPLY" : "DRY RUN"}`);
  console.log();

  const client = new ShopwareClient(settings);
  const t0 = Date.now();
  const { entity, stats } = await client.fetchCustomerPriceStats();
  console.log(`Aggregation: ${Math.round((Date.now() - t0) / 1000)}s, Entität ${entity ?? "—"}`);

  if (stats.length === 0) {
    console.error("Keine Kennzahlen erhalten — Plugin-Entität nicht gefunden oder leer.");
    process.exit(1);
  }

  const totalRows = stats.reduce((a, s) => a + s.priceCount, 0);
  const sorted = [...stats].sort((a, b) => b.priceCount - a.priceCount);
  console.log(`Kunden mit individuellen Preisen: ${fmt(stats.length)}`);
  console.log(`Preiszeilen insgesamt:            ${fmt(totalRows)}`);
  console.log(`Größter Kunde:                    ${fmt(sorted[0].priceCount)} Preise`);
  console.log(`Median:                           ${fmt(sorted[Math.floor(sorted.length / 2)].priceCount)} Preise`);
  console.log();

  // Kundennummern aus dem Kunden-Mirror ergänzen, damit die Auswertung lesbar wird.
  const customerMirrors = await storage.getShopwareCustomerMirrors(tenant.id);
  const numberById = new Map(
    customerMirrors.map((c) => [c.shopwareId, c.customerNumber ?? null]),
  );

  const rows = stats.map((s) => ({
    customerId: s.customerId,
    customerNumber: numberById.get(s.customerId) ?? null,
    priceCount: s.priceCount,
    priceSum: s.priceSum,
    fingerprint: priceFingerprint(s.priceCount, s.priceSum),
  }));

  const unknown = rows.filter((r) => !r.customerNumber).length;
  if (unknown > 0) {
    console.log(`Hinweis: ${fmt(unknown)} Kunden ohne Eintrag im Kunden-Mirror (Nummer fehlt).`);
  }

  if (!apply) {
    const before = await storage.getShopwareCustomerPriceStats(tenant.id);
    const byId = new Map(before.map((r) => [r.customerId, r]));
    let neu = 0;
    let geaendert = 0;
    let gleich = 0;
    for (const r of rows) {
      const prev = byId.get(r.customerId);
      if (!prev) neu += 1;
      else if (prev.fingerprint !== r.fingerprint) geaendert += 1;
      else gleich += 1;
    }
    const weg = before.filter((b) => !rows.some((r) => r.customerId === b.customerId)).length;
    console.log(`Gespeichert bisher: ${fmt(before.length)}`);
    console.log(`  neu: ${fmt(neu)}   geändert: ${fmt(geaendert)}   unverändert: ${fmt(gleich)}   entfallen: ${fmt(weg)}`);
    console.log();
    console.log("DRY RUN — nichts geschrieben. Mit --apply ausführen.");
    process.exit(0);
  }

  const result = await storage.upsertShopwareCustomerPriceStats(rows, tenant.id);
  console.log(
    `Geschrieben — neu: ${fmt(result.inserted)}   geändert: ${fmt(result.changed)}   unverändert: ${fmt(result.unchanged)}   entfallen: ${fmt(result.removed)}`,
  );

  const after = await storage.getShopwareCustomerPriceStats(tenant.id);
  console.log(`Kennzahlen in der DB: ${fmt(after.length)}`);
  if (after.length !== rows.length) {
    console.error("ACHTUNG: Zeilenzahl weicht ab.");
    process.exit(1);
  }
  console.log("Nachkontrolle ok.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
