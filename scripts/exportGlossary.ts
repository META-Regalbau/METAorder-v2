/**
 * Regal-Lexikon: Entwurf (HTML) und Freigabe-Excel aus server/products/glossary.ts. NUR LESEND.
 * Mit --tenant prüft das Skript zusätzlich die Preisaussagen der Vergleiche („im Shop günstiger“) gegen den
 * Produktspiegel dieses Mandanten und schreibt das Ergebnis in die Prüfliste.
 *
 * Aufruf (für --tenant im App-Container, dort liegt die Datenbank):
 *   npx tsx scripts/exportGlossary.ts <ausgabe-ordner> [--tenant <tenantId>]
 */
import { writeFileSync } from "fs";
import path from "path";
import XLSXmod from "xlsx";
import {
  GLOSSARY_COMPARISONS,
  GLOSSARY_GUIDE,
  GLOSSARY_PAGE,
  GLOSSARY_TOPICS,
  checkGlossaryPriceClaims,
  glossaryPlain,
  sortedGlossaryTerms,
  type GlossaryPriceCheck,
} from "../server/products/glossary";
import { glossaryDraftHtml } from "../server/products/glossaryPageHtml";

const XLSX: any = (XLSXmod as any).readFile ? XLSXmod : (XLSXmod as any).default;
const SHOP = "https://shop.meta-online.com";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadPriceChecks(tenantId: string): Promise<GlossaryPriceCheck[]> {
  const { db } = await import("../server/db");
  const { shopwareProducts } = await import("../shared/schema");
  const { and, eq } = await import("drizzle-orm");
  const rows = await db
    .select({ name: shopwareProducts.name, payload: shopwareProducts.payload })
    .from(shopwareProducts)
    .where(and(eq(shopwareProducts.tenantId, tenantId), eq(shopwareProducts.active, true)));
  const products = rows
    .map((r) => ({ name: r.name ?? "", priceNet: Number((r.payload as any)?.priceNet) }))
    .filter((p) => p.name && Number.isFinite(p.priceNet) && p.priceNet > 0);
  return checkGlossaryPriceClaims(products);
}

async function main(): Promise<void> {
  const outDir = process.argv[2];
  if (!outDir || outDir.startsWith("--")) {
    console.error("Usage: npx tsx scripts/exportGlossary.ts <ausgabe-ordner> [--tenant <tenantId>]");
    process.exit(1);
  }
  const asOf = new Date().toISOString().slice(0, 10);
  const tenantId = arg("--tenant");
  const priceChecks = tenantId ? await loadPriceChecks(tenantId) : [];

  const draft = path.join(outDir, `Entwurf-Regal-Lexikon.html`);
  writeFileSync(draft, glossaryDraftHtml({ pageUrl: SHOP + GLOSSARY_PAGE.url, linkBase: SHOP, sources: true, title: "Entwurf Regal-Lexikon" }));
  console.log("Entwurf:", draft);

  const topic = (k: string) => GLOSSARY_TOPICS.find((t) => t.key === k)?.label ?? k;
  const begriffe = sortedGlossaryTerms().map((t) => ({
    Begriff: t.term,
    Anker: `${GLOSSARY_PAGE.url}#${t.key}`,
    Thema: topic(t.topic),
    Erklärung: glossaryPlain(t.text),
    Beispiel: t.example ? glossaryPlain(t.example) : "",
    "Auch gesucht als": (t.aliases ?? []).join(", "),
    Link: t.link ? `${t.link.label} (${t.link.href})` : "",
    Quelle: t.src,
    Freigabe: "",
    Korrektur: "",
  }));
  const vergleiche = GLOSSARY_COMPARISONS.flatMap((c) =>
    c.sides.map((s, i) => ({
      Vergleich: c.title,
      Einleitung: i === 0 ? c.intro : "",
      Seite: s.name,
      Vorteile: s.plus.join("\n"),
      Grenzen: s.minus.join("\n"),
      "Passt, wenn": s.fit,
      Link: s.link ? `${s.link.label} (${s.link.href})` : "",
      Quelle: i === 0 ? c.src : "",
      Freigabe: "",
      Korrektur: "",
    })),
  );
  const wegweiser = GLOSSARY_GUIDE.map((g) => ({ Lagergut: g.title, System: g.system, Text: g.text, Links: g.links.map((l) => `${l.label} (${l.href})`).join("\n"), Freigabe: "", Korrektur: "" }));
  const pruef = [
    ...priceChecks.map((r) => ({
      Prüfpunkt: `Preisaussage „${r.claim.label}“ (Vergleich ${r.claim.comparison})`,
      Ergebnis: r.pairs === 0 ? "KEINE vergleichbaren Artikel" : r.violations.length ? `${r.violations.length} von ${r.pairs} Paaren widersprechen: ${r.violations.slice(0, 5).join("; ")}` : `stimmt in allen ${r.pairs} Paaren (im Schnitt ${r.avgSavingPct} % günstiger)`,
      Antwort: "",
    })),
    { Prüfpunkt: "CLIP SPLIT: Aufbau (geteilte Profile, Paketversand)? Steht nicht im Katalog – bisher nicht im Lexikon", Ergebnis: "offen bei META", Antwort: "" },
    { Prüfpunkt: "Lebensmittel-Eignung von Pulverbeschichtung und PP (Katalog-Glossar) – bewusst nicht im Lexikon", Ergebnis: "offen bei META", Antwort: "" },
    { Prüfpunkt: "„Schwerlastregal“: Gibt es eine META-Definition? Sonst bleibt der Begriff draußen", Ergebnis: "offen bei META", Antwort: "" },
    { Prüfpunkt: "5-Jahres-Qualitätsgarantie (Katalog S. 14) für Shop-Artikel? Dann Eintrag „Garantie“", Ergebnis: "offen bei META", Antwort: "" },
    { Prüfpunkt: "Reifenregal und Kabeltrommelregal: Werte aus den freigegebenen Branchenseiten übernommen", Ergebnis: "zur Kenntnis", Antwort: "" },
  ];

  const wb = XLSX.utils.book_new();
  const sheet = (rows: object[], cols: number[], name: string) => {
    const s = XLSX.utils.json_to_sheet(rows);
    s["!cols"] = cols.map((wch) => ({ wch }));
    s["!autofilter"] = { ref: s["!ref"] };
    XLSX.utils.book_append_sheet(wb, s, name);
  };
  sheet(begriffe, [28, 34, 18, 90, 70, 30, 40, 26, 10, 40], "Begriffe");
  sheet(vergleiche, [34, 50, 34, 60, 60, 44, 36, 34, 10, 40], "Vergleiche");
  sheet(wegweiser, [30, 40, 90, 50, 10, 40], "Wegweiser");
  sheet(pruef, [90, 80, 40], "Prüfliste");
  const hinweise = XLSX.utils.aoa_to_sheet([
    ["Regal-Lexikon – Texte zur Freigabe (nichts ist im Shop)"],
    [`Erstellt: ${new Date().toISOString()} aus server/products/glossary.ts${tenantId ? `, Preise aus dem Produktspiegel ${tenantId}` : ""}`],
    [`Seite: ${GLOSSARY_PAGE.url} · Titel „${GLOSSARY_PAGE.metaTitle}“`],
    [`Meta-Beschreibung: ${GLOSSARY_PAGE.metaDescription}`],
    ["Spalte „Freigabe“: ok / ändern / streichen. Änderungen bitte in „Korrektur“ eintragen – sie fließen in glossary.ts zurück."],
    ["Regel: nur belegte META-Inhalte (Bestellkatalog Lagersysteme 11/2025, Glossar S. 210, Planmaße S. 211); Quelle je Zeile."],
  ]);
  hinweise["!cols"] = [{ wch: 140 }];
  XLSX.utils.book_append_sheet(wb, hinweise, "Hinweise");
  const xlsx = path.join(outDir, `Regal-Lexikon-Texte-${asOf}.xlsx`);
  XLSX.writeFile(wb, xlsx);
  console.log("Excel:", xlsx, `(${begriffe.length} Begriffe, ${GLOSSARY_COMPARISONS.length} Vergleiche, ${wegweiser.length} Wegweiser, ${pruef.length} Prüfpunkte)`);
  for (const r of priceChecks) console.log(`Preis ${r.claim.comparison}: ${r.holds}/${r.pairs} Paare stimmen${r.violations.length ? ` – ${r.violations.length} Widersprüche` : ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
