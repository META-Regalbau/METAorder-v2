/**
 * Rabatt-Snapshot je Kunde aufbauen: Standardrabatt, individuelle Preise, effektiver
 * Preislisten-Rabatt und die Gesamtwirkung — in einer Tabelle für die Auswertung.
 *
 * Datenquellen und warum:
 *   - Standardrabatt: Kunden-customField `b2b_customer_discount_rate`. Eine eigene
 *     Rabatt-Entität gibt es in dieser Installation nicht (alle Kandidaten liefern 404).
 *     Abgerufen per Bulk-Suche über /api/search/customer mit includes — 500 Kunden je
 *     Request statt 1.064 Einzelabrufe.
 *   - Individuelle Preise: shopware_customer_price_stats (Anzahl + Fingerabdruck).
 *   - Preislisten-Rabatt: je Fingerabdruck-Gruppe EINE Stichprobe gegen die Listenpreise;
 *     das Ergebnis gilt für alle Kunden derselben Gruppe. Die 1.064 Kunden teilen sich
 *     nur 82 Listen, deshalb genügen 82 Stichproben statt 1.064 Abrufe.
 *
 * Aufruf:
 *   DATABASE_URL=… npx tsx scripts/syncCustomerDiscounts.ts --tenant=Live [--sample=250] [--apply]
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import {
  customerDiscountSnapshots,
  customerDiscountTiers,
  shopwareProducts,
  tenants,
} from "../shared/schema";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware";

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const fmt = (n: number, d = 0) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Prozentwert aus einem customField robust lesen ("12,5", "12.5 %", 12.5). */
function parsePercent(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n =
    typeof raw === "number"
      ? raw
      : Number.parseFloat(String(raw).replace("%", "").replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return null;
  return n;
}

async function main() {
  const tenantArg = arg("tenant") ?? "Live";
  const sampleSize = Math.max(Number(arg("sample") ?? "250") || 250, 25);
  const apply = process.argv.includes("--apply");

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
  const base = settings.shopwareUrl.replace(/\/$/, "");

  console.log(`Mandant: ${tenant.name}   Shop: ${settings.shopwareUrl}`);
  console.log(`Modus:   ${apply ? "APPLY" : "DRY RUN"}\n`);

  // ---- 1. Standardrabatte aller Kunden (Bulk) -----------------------------------------
  const discountByCustomer = new Map<string, number>();
  let page = 1;
  let fetched = 0;
  while (page <= 200) {
    const res = await (client as any).makeAuthenticatedRequest(`${base}/api/search/customer`, {
      method: "POST",
      body: JSON.stringify({
        limit: 500,
        page,
        includes: { customer: ["id", "customerNumber", "customFields"] },
        sort: [{ field: "id", order: "ASC" }],
      }),
    });
    if (!res.ok) {
      console.error(`Kundenabruf Seite ${page}: HTTP ${res.status}`);
      break;
    }
    const data = await res.json();
    const list = data.data ?? [];
    if (list.length === 0) break;
    for (const c of list) {
      const cf = c.customFields ?? c.attributes?.customFields ?? null;
      const pct = parsePercent(cf?.b2b_customer_discount_rate);
      if (pct != null && c.id) discountByCustomer.set(String(c.id), pct);
    }
    fetched += list.length;
    if (list.length < 500) break;
    page += 1;
  }
  console.log(`Kunden aus Shopware gelesen: ${fmt(fetched)}`);
  console.log(`davon mit Standardrabatt:    ${fmt(discountByCustomer.size)}\n`);

  // ---- 2. Preislisten-Rabatt je Gruppe --------------------------------------------------
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

  const stats = await storage.getShopwareCustomerPriceStats(tenant.id);
  const groups = new Map<string, { rep: (typeof stats)[number]; members: typeof stats }>();
  for (const s of stats) {
    const g = groups.get(s.fingerprint);
    if (g) g.members.push(s);
    else groups.set(s.fingerprint, { rep: s, members: [s] });
  }
  console.log(`Kunden mit individuellen Preisen: ${fmt(stats.length)} in ${fmt(groups.size)} Preislisten`);

  const discountByFingerprint = new Map<string, number>();
  let done = 0;
  for (const [fp, g] of groups) {
    done += 1;
    try {
      const res = await client.fetchCustomerSpecificPrices({
        customerId: g.rep.customerId,
        customerNumber: null,
        currencyIsoCode: "EUR",
        limit: sampleSize,
        page: 1,
      });
      const werte: number[] = [];
      for (const p of res.prices ?? []) {
        if ((p.currencyIsoCode || "EUR").toUpperCase() !== "EUR") continue;
        const list = listPrice.get((p.productNumber || "").trim());
        const net = Number(p.priceNet);
        if (!list || !Number.isFinite(net) || net <= 0) continue;
        werte.push(((list - net) / list) * 100);
      }
      const m = median(werte);
      if (m != null) discountByFingerprint.set(fp, m);
    } catch (e: any) {
      console.error(`  Gruppe ${done}/${groups.size}: ${e?.message || e}`);
    }
    if (done % 20 === 0) console.log(`  ${done}/${groups.size} Preislisten ausgewertet …`);
  }
  console.log(`Preislisten mit Rabattwert: ${fmt(discountByFingerprint.size)} von ${fmt(groups.size)}\n`);

  // ---- 3. Zusatzrabatt-Staffeln aus den Rabattregeln ------------------------------------
  //
  // b2bsellers_discount_rules trägt den Prozentsatz, die verknüpfte Shopware-Regel die
  // Bedingungen: customerCustomerNumber (für wen) und cartGoodsPrice (ab welchem
  // Warenkorbwert). Deshalb wird über die Kundennummer verknüpft, nicht über die ID.
  type Tier = {
    customerNumber: string;
    label: string | null;
    discountPercent: number;
    thresholdAmount: number | null;
    allowStacking: boolean;
    priority: number | null;
    ruleId: string | null;
  };
  const tiers: Tier[] = [];
  /** Kundennummern in Regeln, die durch Leerraum in Shopware wirkungslos sind. */
  const whitespaceDefekte: Array<{ label: string; roh: string }> = [];

  const drRes = await (client as any).makeAuthenticatedRequest(
    `${base}/api/search/b2bsellers-discount-rules`,
    {
      method: "POST",
      body: JSON.stringify({
        limit: 500,
        associations: { rule: { associations: { conditions: {} } } },
      }),
    },
  );
  if (drRes.ok) {
    const drData = await drRes.json();
    for (const dr of drData.data ?? []) {
      const pct = Number(dr.discountPercent);
      if (!Number.isFinite(pct) || pct <= 0) continue;

      const nummern: string[] = [];
      let schwelle: number | null = null;
      for (const c of dr.rule?.conditions ?? []) {
        if (/customerNumber/i.test(c.type ?? "")) {
          const v = c.value?.numbers ?? c.value?.customerNumbers ?? [];
          if (Array.isArray(v)) {
            for (const raw of v) {
              const roh = String(raw);
              const sauber = roh.trim();
              if (!sauber) continue;
              if (roh !== sauber) {
                // Shopware vergleicht die Kundennummer exakt. Eine Nummer mit Leerraum
                // trifft dort NIE — die Regel ist im Shop wirkungslos, obwohl sie
                // gepflegt aussieht. Hier wird getrimmt, damit die Auswertung die
                // Absicht zeigt; der Defekt wird unten gemeldet.
                whitespaceDefekte.push({ label: dr.label ?? dr.rule?.name ?? "?", roh });
              }
              nummern.push(sauber);
            }
          }
        }
        if (/cartGoodsPrice|cartAmount/i.test(c.type ?? "")) {
          const a = Number(c.value?.amount);
          if (Number.isFinite(a)) schwelle = schwelle == null ? a : Math.min(schwelle, a);
        }
      }

      for (const nr of [...new Set(nummern)]) {
        tiers.push({
          customerNumber: nr,
          label: dr.label ?? dr.rule?.name ?? null,
          discountPercent: pct,
          thresholdAmount: schwelle,
          allowStacking: Boolean(dr.allowStacking),
          priority: Number.isFinite(Number(dr.priority)) ? Number(dr.priority) : null,
          ruleId: dr.ruleId ?? null,
        });
      }
    }
  } else {
    console.error(`Rabattregeln: HTTP ${drRes.status} — Zusatzrabatte bleiben leer.`);
  }

  const tiersByNumber = new Map<string, Tier[]>();
  for (const t of tiers) {
    const l = tiersByNumber.get(t.customerNumber) ?? [];
    l.push(t);
    tiersByNumber.set(t.customerNumber, l);
  }
  console.log(`Zusatzrabatt-Staffeln: ${fmt(tiers.length)} für ${fmt(tiersByNumber.size)} Kundennummern`);
  if (whitespaceDefekte.length > 0) {
    console.log();
    console.log(`ACHTUNG: ${whitespaceDefekte.length} Kundennummer(n) in Regeln enthalten Leerraum.`);
    console.log("Shopware vergleicht exakt — diese Regeln greifen im Shop nicht:");
    for (const d of whitespaceDefekte) {
      console.log(`  "${d.label}" → [${d.roh.replace(/\t/g, "\\t")}]`);
    }
  }
  console.log();

  // ---- 4. Snapshot je Kunde zusammenführen ---------------------------------------------
  const customerMirrors = await storage.getShopwareCustomerMirrors(tenant.id);
  const statByCustomer = new Map(stats.map((s) => [s.customerId, s]));

  const rows = customerMirrors.map((c) => {
    const stat = statByCustomer.get(c.shopwareId);
    const standard = discountByCustomer.get(c.shopwareId) ?? null;
    const listDiscount = stat ? discountByFingerprint.get(stat.fingerprint) ?? null : null;

    // Preislogik laut Fachvorgabe:
    //   1. Der erweiterte Preis gibt den Katalogpreis vor.
    //   2. Darauf wirkt der prozentuale Rabatt.
    //   3. Gibt es für ein Produkt einen kundenindividuellen Preis, SCHLÄGT dieser den
    //      prozentualen Rabatt — die beiden addieren oder multiplizieren sich also nicht.
    //   4. Zusatzrabatte greifen erst ganz am Ende auf den Warenkorbwert (hier nicht
    //      enthalten, weil sie vom Bestellwert abhängen und über Regeln laufen).
    //
    // Auf Artikelebene gilt deshalb: individueller Preis, sonst Prozentrabatt.
    const effective = listDiscount ?? standard ?? null;

    return {
      tenantId: tenant.id,
      customerId: c.shopwareId,
      customerNumber: c.customerNumber ?? null,
      email: c.email ?? null,
      company: ((c.payload as any)?.company ?? null) as string | null,
      groupName: ((c.payload as any)?.groupName ?? null) as string | null,
      salesChannelId: c.salesChannelId ?? null,
      standardDiscountPercent: standard,
      individualPriceCount: stat?.priceCount ?? 0,
      priceListFingerprint: stat?.fingerprint ?? null,
      priceListDiscountPercent: listDiscount,
      effectiveDiscountPercent: effective,
    };
  });

  const mitRabatt = rows.filter((r) => r.effectiveDiscountPercent != null);
  const nurStandard = rows.filter(
    (r) => r.standardDiscountPercent != null && r.individualPriceCount === 0,
  );
  const nurPreisliste = rows.filter(
    (r) => r.standardDiscountPercent == null && r.individualPriceCount > 0,
  );
  const beides = rows.filter(
    (r) => r.standardDiscountPercent != null && r.individualPriceCount > 0,
  );

  console.log("── Übersicht ─────────────────────────────────────────────");
  console.log(`Kunden im Mirror:            ${fmt(rows.length)}`);
  console.log(`mit irgendeinem Rabatt:      ${fmt(mitRabatt.length)}`);
  console.log(`  nur Prozentrabatt:         ${fmt(nurStandard.length)}`);
  console.log(`  nur individuelle Preise:   ${fmt(nurPreisliste.length)}`);
  console.log(`  beides kombiniert:         ${fmt(beides.length)}`);
  console.log(`ohne jeden Rabatt:           ${fmt(rows.length - mitRabatt.length)}`);
  const mitStaffel = rows.filter(
    (r) => r.customerNumber && tiersByNumber.has(r.customerNumber),
  ).length;
  console.log(`mit Zusatzrabatt-Staffel:    ${fmt(mitStaffel)}`);

  const eff = mitRabatt
    .map((r) => r.effectiveDiscountPercent as number)
    .sort((a, b) => a - b);
  if (eff.length) {
    console.log();
    console.log(`Effektiver Rabatt — Median:  ${fmt(median(eff) ?? 0, 1)} %`);
    console.log(`                    Minimum: ${fmt(eff[0], 1)} %`);
    console.log(`                    Maximum: ${fmt(eff[eff.length - 1], 1)} %`);
  }

  if (!apply) {
    console.log("\nDRY RUN — nichts geschrieben. Mit --apply ausführen.");
    process.exit(0);
  }

  await db.delete(customerDiscountTiers).where(eq(customerDiscountTiers.tenantId, tenant.id));
  if (tiers.length > 0) {
    for (let i = 0; i < tiers.length; i += 500) {
      await db
        .insert(customerDiscountTiers)
        .values(tiers.slice(i, i + 500).map((t) => ({ ...t, tenantId: tenant.id })));
    }
  }

  await db.delete(customerDiscountSnapshots).where(eq(customerDiscountSnapshots.tenantId, tenant.id));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(customerDiscountSnapshots).values(rows.slice(i, i + CHUNK));
  }
  const inDb = await db
    .select({ customerId: customerDiscountSnapshots.customerId })
    .from(customerDiscountSnapshots)
    .where(eq(customerDiscountSnapshots.tenantId, tenant.id));
  console.log(`\nGeschrieben: ${fmt(rows.length)} Kunden (in der DB: ${fmt(inDb.length)})`);
  if (inDb.length !== rows.length) {
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
