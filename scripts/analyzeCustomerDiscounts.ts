/**
 * Rabattüberblick über alle Kunden mit individuellen Preisen.
 *
 * Vorgehen: Die 1.064 Kunden teilen sich nur 82 verschiedene Preislisten (erkennbar am
 * Fingerabdruck aus shopware_customer_price_stats). Statt 12,7 Mio. Preiszeilen zu laden,
 * wird je Gruppe EIN Kunde stellvertretend abgefragt und daraus eine Stichprobe gegen die
 * Listenpreise aus dem Produkt-Mirror gerechnet. 82 Requests statt ~50.000.
 *
 * Ist der Rabatt je Gruppe ein glatter Prozentsatz — was bei kopierten Preislisten der
 * Normalfall ist —, ist die Stichprobe exakt; die Streuung im Bericht zeigt, ob das gilt.
 *
 * Aufruf:
 *   DATABASE_URL=… npx tsx scripts/analyzeCustomerDiscounts.ts --tenant=Live [--sample=250] [--csv=pfad]
 */
import { eq } from "drizzle-orm";
import { writeFileSync } from "fs";
import { db } from "../server/db";
import { shopwareProducts, tenants } from "../shared/schema";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware";

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const fmt = (n: number, d = 0) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

async function main() {
  const tenantArg = arg("tenant") ?? "Live";
  const sampleSize = Math.max(Number(arg("sample") ?? "250") || 250, 25);
  const csvPath = arg("csv");

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
    console.error("Keine Shopware-Konfiguration.");
    process.exit(1);
  }
  const client = new ShopwareClient(settings);

  // Listenpreise direkt aus dem Produkt-Mirror (payload.priceNet)
  const productRows = await db
    .select({ productNumber: shopwareProducts.productNumber, payload: shopwareProducts.payload })
    .from(shopwareProducts)
    .where(eq(shopwareProducts.tenantId, tenant.id));
  const listPrice = new Map<string, number>();
  for (const p of productRows) {
    const pn = (p.productNumber || "").trim();
    const net = Number((p.payload as any)?.priceNet);
    if (pn && Number.isFinite(net) && net > 0) listPrice.set(pn, net);
  }
  console.log(`Listenpreise im Produkt-Mirror: ${fmt(listPrice.size)}`);

  const stats = await storage.getShopwareCustomerPriceStats(tenant.id);
  if (stats.length === 0) {
    console.error("Keine Kennzahlen — erst scripts/syncCustomerPriceStats.ts --apply laufen lassen.");
    process.exit(1);
  }

  // Je Fingerabdruck ein Stellvertreter
  const groups = new Map<string, { rep: (typeof stats)[number]; members: typeof stats }>();
  for (const s of stats) {
    const g = groups.get(s.fingerprint);
    if (g) g.members.push(s);
    else groups.set(s.fingerprint, { rep: s, members: [s] });
  }
  console.log(`Kunden: ${fmt(stats.length)} — verschiedene Preislisten: ${fmt(groups.size)}`);
  console.log(`Stichprobe je Gruppe: bis zu ${fmt(sampleSize)} Positionen\n`);

  type Row = {
    gruppe: number;
    kunden: number;
    positionen: number;
    verglichen: number;
    median: number;
    p25: number;
    p75: number;
    min: number;
    max: number;
    einheitlich: boolean;
    kundennummern: string;
  };
  const rows: Row[] = [];

  const ordered = [...groups.values()].sort((a, b) => b.members.length - a.members.length);
  let i = 0;
  for (const g of ordered) {
    i += 1;
    let prices: any[] = [];
    try {
      // Bewusst nur die erste Seite: fetchAllCustomerSpecificPrices würde bei einem
      // Kunden mit 28.000 Positionen 113 Requests auslösen. Für die Rabatthöhe genügt
      // eine Stichprobe — die Streuung im Bericht zeigt, ob das trägt.
      const res = await client.fetchCustomerSpecificPrices({
        customerId: g.rep.customerId,
        customerNumber: null,
        currencyIsoCode: "EUR",
        limit: sampleSize,
        page: 1,
      });
      prices = res.prices ?? [];
    } catch (e: any) {
      console.error(`  Gruppe ${i}: Abruf fehlgeschlagen — ${e?.message || e}`);
      continue;
    }

    const rabatte: number[] = [];
    for (const p of prices.slice(0, sampleSize)) {
      const iso = (p.currencyIsoCode || "EUR").toUpperCase();
      if (iso !== "EUR") continue; // Fremdwährung ist nicht gegen EUR-Listenpreise vergleichbar
      const list = listPrice.get((p.productNumber || "").trim());
      const net = Number(p.priceNet);
      if (!list || !Number.isFinite(net) || net <= 0) continue;
      rabatte.push(((list - net) / list) * 100);
    }

    if (rabatte.length === 0) {
      console.log(`Gruppe ${String(i).padStart(2)}: ${String(g.members.length).padStart(4)} Kunden — kein Vergleich möglich`);
      continue;
    }

    rabatte.sort((a, b) => a - b);
    const median = quantile(rabatte, 0.5);
    const p25 = quantile(rabatte, 0.25);
    const p75 = quantile(rabatte, 0.75);
    const einheitlich = p75 - p25 < 0.5;

    rows.push({
      gruppe: i,
      kunden: g.members.length,
      positionen: g.rep.priceCount,
      verglichen: rabatte.length,
      median,
      p25,
      p75,
      min: rabatte[0],
      max: rabatte[rabatte.length - 1],
      einheitlich,
      kundennummern: g.members
        .map((m) => m.customerNumber ?? "?")
        .slice(0, 5)
        .join(" "),
    });

    console.log(
      `Gruppe ${String(i).padStart(2)}: ${String(g.members.length).padStart(4)} Kunden  ` +
        `${String(g.rep.priceCount).padStart(6)} Pos.  Rabatt Median ${fmt(median, 1).padStart(6)} %  ` +
        `Spanne ${fmt(rabatte[0], 1)}–${fmt(rabatte[rabatte.length - 1], 1)} %  ` +
        `${einheitlich ? "einheitlich" : "gestreut"}  (n=${rabatte.length})`,
    );
  }

  // Gesamtbild, gewichtet nach Kundenzahl
  const kundenGesamt = rows.reduce((a, r) => a + r.kunden, 0);
  const gewichtet = rows.reduce((a, r) => a + r.median * r.kunden, 0) / (kundenGesamt || 1);
  const nachMedian = [...rows].sort((a, b) => a.median - b.median);

  console.log();
  console.log("── Gesamtbild ────────────────────────────────────────────");
  console.log(`Ausgewertete Gruppen:            ${fmt(rows.length)} von ${fmt(groups.size)}`);
  console.log(`Erfasste Kunden:                 ${fmt(kundenGesamt)}`);
  console.log(`Ø Rabatt (nach Kunden gewichtet): ${fmt(gewichtet, 1)} %`);
  console.log(`Niedrigster Gruppen-Median:      ${fmt(nachMedian[0]?.median ?? 0, 1)} % (${fmt(nachMedian[0]?.kunden ?? 0)} Kunden)`);
  console.log(`Höchster Gruppen-Median:         ${fmt(nachMedian[nachMedian.length - 1]?.median ?? 0, 1)} % (${fmt(nachMedian[nachMedian.length - 1]?.kunden ?? 0)} Kunden)`);
  console.log(`Gruppen mit einheitlichem Satz:  ${fmt(rows.filter((r) => r.einheitlich).length)} von ${fmt(rows.length)}`);

  const stufen = new Map<string, number>();
  for (const r of rows) {
    const key = `${Math.round(r.median / 5) * 5} %`;
    stufen.set(key, (stufen.get(key) ?? 0) + r.kunden);
  }
  console.log();
  console.log("── Kunden je Rabattstufe (5-%-Raster) ────────────────────");
  for (const [stufe, kunden] of [...stufen.entries()].sort(
    (a, b) => Number.parseFloat(a[0]) - Number.parseFloat(b[0]),
  )) {
    const balken = "█".repeat(Math.max(1, Math.round((kunden / kundenGesamt) * 50)));
    console.log(`${stufe.padStart(6)}  ${String(kunden).padStart(4)} Kunden  ${balken}`);
  }

  if (csvPath) {
    const csv = [
      "gruppe;kunden;positionen;verglichen;median_rabatt;p25;p75;min;max;einheitlich;beispiel_kundennummern",
      ...rows.map((r) =>
        [
          r.gruppe, r.kunden, r.positionen, r.verglichen,
          r.median.toFixed(2), r.p25.toFixed(2), r.p75.toFixed(2),
          r.min.toFixed(2), r.max.toFixed(2),
          r.einheitlich ? "ja" : "nein", r.kundennummern,
        ].join(";"),
      ),
    ].join("\n");
    writeFileSync(csvPath, csv, "utf8");
    console.log(`\nCSV: ${csvPath}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
