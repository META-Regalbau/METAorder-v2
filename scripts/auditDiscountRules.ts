/**
 * Prüft, welche Zusatzrabatt-Regeln in Shopware tatsächlich greifen — und warum nicht.
 *
 * Die Regeln (b2bsellers_discount_rules → rule → conditions) verknüpfen Kunden auf drei Wegen,
 * per ODER kombiniert:
 *   - customerCustomerNumber      → aktuelle Kundennummer
 *   - customerCustomField         → ein Kunden-Custom-Field, in dieser Installation
 *                                   wdu_partner_group_number (Verbandsnummer, SAP-Format HA…)
 *                                   und wdu_old_partner_group_number (Altformat 200…)
 *
 * Ausgewertet wird so, wie Shopware vergleicht: exakt, ohne Trimmen. Genau daran scheitern
 * die meisten Regeln — Leerraum, Tippfehler oder ein Wert im Format des jeweils ANDEREN Feldes.
 *
 * Der Bericht nennt je Regel die Zahl tatsächlich getroffener Kunden und, wo eine Regel leer
 * läuft, den nächstliegenden Grund samt Gegenprobe (z. B. "würde 219 Kunden treffen, wenn der
 * Wert gegen wdu_partner_group_number statt wdu_old_partner_group_number geprüft würde").
 *
 * Aufruf:
 *   DATABASE_URL=… npx tsx scripts/auditDiscountRules.ts --tenant=Live [--csv=pfad] [--all]
 *   --all  auch die Regeln auflisten, die sauber greifen
 */
import { eq } from "drizzle-orm";
import { writeFileSync } from "fs";
import { db } from "../server/db";
import { tenants } from "../shared/schema";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware";

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const fmt = (n: number) => new Intl.NumberFormat("de-DE").format(n);
/** Tabs/Zeilenumbrüche im Bericht sichtbar machen — sonst sieht der Defekt aus wie ein sauberer Wert. */
const sichtbar = (s: string) => s.replace(/\t/g, "\\t").replace(/\n/g, "\\n");

type Kunde = {
  customerNumber: string;
  company: string;
  fields: Record<string, string>;
};

async function main() {
  const tenantArg = arg("tenant") ?? "Live";
  const csvPath = arg("csv");
  const zeigeAlle = process.argv.includes("--all");

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
  const client: any = new ShopwareClient(settings);
  const base = settings.shopwareUrl.replace(/\/$/, "");

  console.log(`Mandant: ${tenant.name}   Shop: ${settings.shopwareUrl}\n`);

  // ---- 1. Alle Kunden mit Nummer und Custom-Fields --------------------------------------
  const kunden: Kunde[] = [];
  let page = 1;
  while (page <= 200) {
    const res = await client.makeAuthenticatedRequest(`${base}/api/search/customer`, {
      method: "POST",
      body: JSON.stringify({
        limit: 500,
        page,
        sort: [{ field: "id", order: "ASC" }],
        includes: { customer: ["customerNumber", "company", "customFields"] },
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
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(c.customFields ?? {})) {
        if (v == null || v === "") continue;
        fields[k] = String(v);
      }
      kunden.push({
        customerNumber: String(c.customerNumber ?? "").trim(),
        company: String(c.company ?? ""),
        fields,
      });
    }
    if (list.length < 500) break;
    page += 1;
  }
  console.log(`Kunden gelesen: ${fmt(kunden.length)}`);

  const nummerIndex = new Map<string, Kunde>();
  for (const k of kunden) if (k.customerNumber) nummerIndex.set(k.customerNumber, k);

  /** Je Custom-Field: Wert → Anzahl Kunden. Basis für Treffer und Gegenproben. */
  const feldIndex = new Map<string, Map<string, number>>();
  for (const k of kunden) {
    for (const [f, v] of Object.entries(k.fields)) {
      let m = feldIndex.get(f);
      if (!m) feldIndex.set(f, (m = new Map()));
      m.set(v, (m.get(v) ?? 0) + 1);
    }
  }

  // ---- 2. Rabattregeln mit Bedingungen ---------------------------------------------------
  const res = await client.makeAuthenticatedRequest(
    `${base}/api/search/b2bsellers-discount-rules`,
    {
      method: "POST",
      body: JSON.stringify({
        limit: 500,
        associations: { rule: { associations: { conditions: {} } } },
      }),
    },
  );
  if (!res.ok) {
    console.error(`Rabattregeln: HTTP ${res.status}`);
    process.exit(1);
  }
  const daten = await res.json();

  type Befund = {
    label: string;
    prozent: number;
    schwelle: number | null;
    nummern: string[];
    felder: Array<{ feld: string; wert: string }>;
    treffer: number;
    weg: string;
    problem: string;
    hinweis: string;
  };
  const befunde: Befund[] = [];

  for (const dr of daten.data ?? []) {
    const prozent = Number(dr.discountPercent);
    if (!Number.isFinite(prozent) || prozent <= 0) continue;

    const nummern: string[] = [];
    const felder: Array<{ feld: string; wert: string }> = [];
    let schwelle: number | null = null;

    for (const c of dr.rule?.conditions ?? []) {
      if (/customerNumber/i.test(c.type ?? "")) {
        const v = c.value?.numbers ?? c.value?.customerNumbers ?? [];
        if (Array.isArray(v)) nummern.push(...v.map(String));
      }
      if (c.type === "customerCustomField") {
        const feld = String(c.value?.renderedField?.name ?? "").trim();
        const wert = String(c.value?.renderedFieldValue ?? "").trim();
        if (feld && wert) felder.push({ feld, wert });
      }
      if (/cartGoodsPrice|cartAmount/i.test(c.type ?? "")) {
        const a = Number(c.value?.amount);
        const op = String(c.value?.operator ?? "");
        if (Number.isFinite(a) && op.startsWith(">")) schwelle = a;
      }
    }
    if (nummern.length === 0 && felder.length === 0) continue;

    // Treffer exakt wie Shopware: unveränderter Vergleich
    let treffer = 0;
    let weg = "—";
    for (const n of nummern) {
      if (nummerIndex.has(n)) {
        treffer += 1;
        weg = "Kundennummer";
      }
    }
    for (const f of felder) {
      const n = feldIndex.get(f.feld)?.get(f.wert) ?? 0;
      if (n > 0) {
        treffer += n;
        weg = weg === "—" ? f.feld : `${weg} + ${f.feld}`;
      }
    }

    // Diagnose, wenn nichts trifft
    let problem = "";
    let hinweis = "";
    if (treffer === 0) {
      const leerraum = nummern.filter((n) => n !== n.trim() && nummerIndex.has(n.trim()));
      if (leerraum.length > 0) {
        problem = "Leerraum in der Kundennummer";
        hinweis = `getrimmt träfe: ${leerraum.map((n) => n.trim()).join(", ")}`;
      } else {
        // Trifft der Wert in einem ANDEREN Custom-Field? Deckt vertauschte Feldbezüge auf.
        for (const f of felder) {
          for (const [anderesFeld, werte] of feldIndex) {
            if (anderesFeld === f.feld) continue;
            const n = werte.get(f.wert) ?? 0;
            if (n > 0) {
              problem = "Feld vertauscht";
              hinweis = `Wert "${f.wert}" steht bei ${fmt(n)} Kunden in ${anderesFeld}, geprüft wird ${f.feld}`;
              break;
            }
          }
          if (problem) break;
        }
      }
      if (!problem && felder.length > 0 && nummern.length === 0) {
        const leer = felder.filter((f) => (feldIndex.get(f.feld)?.size ?? 0) === 0);
        problem = leer.length > 0 ? "Feld bei keinem Kunden gepflegt" : "Wert trifft keinen Kunden";
        hinweis = felder.map((f) => `${f.feld}="${f.wert}"`).join("  ");
      }
      if (!problem) {
        problem = "Kundennummer existiert nicht";
        hinweis = nummern.map((n) => `[${sichtbar(n)}]`).join(" ");
      }
    }

    befunde.push({
      label: String(dr.label ?? dr.rule?.name ?? "").trim(),
      prozent,
      schwelle,
      nummern,
      felder,
      treffer,
      weg,
      problem,
      hinweis,
    });
  }

  // ---- 3. Bericht ------------------------------------------------------------------------
  const greifen = befunde.filter((b) => b.treffer > 0);
  const leer = befunde.filter((b) => b.treffer === 0);
  const kundenGesamt = new Set<string>();
  for (const b of greifen) {
    for (const n of b.nummern) if (nummerIndex.has(n)) kundenGesamt.add(n);
  }

  console.log(`Regeln mit Kundenbezug: ${fmt(befunde.length)}`);
  console.log(`  greifen:              ${fmt(greifen.length)}`);
  console.log(`  greifen NICHT:        ${fmt(leer.length)}`);
  console.log();

  const nachProblem = new Map<string, Befund[]>();
  for (const b of leer) {
    const l = nachProblem.get(b.problem) ?? [];
    l.push(b);
    nachProblem.set(b.problem, l);
  }
  for (const [problem, liste] of [...nachProblem.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`── ${problem} (${liste.length}) ${"─".repeat(Math.max(0, 46 - problem.length))}`);
    for (const b of liste) {
      console.log(
        `  ${b.label.padEnd(44).slice(0, 44)} ${String(b.prozent).padStart(3)} % ab ${String(b.schwelle ?? "?").padStart(5)}`,
      );
      if (b.hinweis) console.log(`      ${b.hinweis}`);
    }
    console.log();
  }

  if (zeigeAlle && greifen.length > 0) {
    console.log(`── greifen (${greifen.length}) ────────────────────────────────`);
    for (const b of [...greifen].sort((a, b) => b.treffer - a.treffer)) {
      console.log(
        `  ${b.label.padEnd(44).slice(0, 44)} ${String(b.prozent).padStart(3)} % ab ${String(b.schwelle ?? "?").padStart(5)}  → ${fmt(b.treffer)} Kunden  (${b.weg})`,
      );
    }
    console.log();
  }

  // Leerraum auch dort melden, wo die Regel trotzdem greift — Hygiene.
  const leerraumTrotzdem = befunde.filter(
    (b) => b.treffer > 0 && b.nummern.some((n) => n !== n.trim()),
  );
  if (leerraumTrotzdem.length > 0) {
    console.log(`── Leerraum in Nummern, Regel greift dennoch (${leerraumTrotzdem.length}) ──`);
    for (const b of leerraumTrotzdem) {
      const betroffen = b.nummern.filter((n) => n !== n.trim()).map((n) => `[${sichtbar(n)}]`);
      console.log(`  ${b.label.padEnd(44).slice(0, 44)} ${betroffen.join(" ")}`);
    }
    console.log();
  }

  if (csvPath) {
    const zeilen = [
      "regel;prozent;ab_betrag;kundennummern;custom_fields;getroffene_kunden;weg;problem;hinweis",
      ...befunde.map((b) =>
        [
          b.label.replace(/;/g, ","),
          b.prozent,
          b.schwelle ?? "",
          b.nummern.map((n) => `[${sichtbar(n)}]`).join(" "),
          b.felder.map((f) => `${f.feld}="${f.wert}"`).join(" "),
          b.treffer,
          b.weg,
          b.problem,
          b.hinweis.replace(/;/g, ","),
        ].join(";"),
      ),
    ].join("\n");
    writeFileSync(csvPath, zeilen, "utf8");
    console.log(`CSV: ${csvPath}`);
  }

  process.exit(leer.length > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
