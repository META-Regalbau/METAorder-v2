/**
 * META-Artikelnummer-Priorisierung nach der LLM-Extraktion — Unit-Tests.
 *
 *   npm run test:sku-priority
 */

import assert from "node:assert/strict";
import type { DocumentExtraction } from "../shared/documentExtractionSchema";
import {
  applyBuyerIsMetaFlag,
  applyMetaSkuPriority,
  explodeComponentSets,
  isMetaCompanyName,
} from "../server/documentExtractionSkuPriority";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ${name}: OK`);
  } catch (error) {
    failures += 1;
    console.error(`  ${name}: FAILED`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

function base(items: Array<Partial<DocumentExtraction["line_items"][number]>>, buyerCompany = "Kunde GmbH"): DocumentExtraction {
  return {
    document: { type: "purchase_order", number: "1", date: null, delivery_date: null, currency: "EUR", total_net: null, language: "de", recipient_is_meta: true },
    buyer: { company: buyerCompany, street: null, zip: null, city: null, country: "DE", vat_id: null, customer_number: null, contact_person: null, email: null, phone: null },
    delivery_address: { same_as_buyer: true, company: null, street: null, zip: null, city: null, country: null, delivery_window: null },
    terms: { incoterms: null, payment: null, partial_delivery_allowed: null, notes: null },
    line_items: items.map((it, i) => ({
      position: i + 1,
      quantity: 1,
      unit: "Stk",
      supplier_sku: null,
      buyer_sku: null,
      description: "",
      attributes: { color: null, surface: null, dimensions_raw: null, system: null },
      unit_price_net: null,
      line_total_net: null,
      confidence_warnings: [],
      ...it,
    })),
    extraction_meta: { overall_confidence: "high", warnings: [], calculated_total_net: null, total_matches_calculated: null },
  };
}

console.log("\n=== documentExtractionSkuPriority Unit Tests ===\n");

check("Delker: EAN aus dem Rohtext ersetzt Kundennummer, Kundennummer bleibt buyer_sku", () => {
  const ex = base([
    { supplier_sku: "9147455110", description: "Schwerlastregal Grundregal" },
    { supplier_sku: "9147455111", description: "Schwerlastregal Anbauregal" },
  ]);
  const raw = "Pos 1 9147455110 Schwerlastregal Ihre Artikelnr: 200188545 EAN: 4026212342529 Pos 2 9147455111 Ihre Artikelnr: 200188546 EAN: 4026212342536";
  const r = applyMetaSkuPriority(ex, raw);
  assert.equal(r.assignedFromDocument, 2);
  assert.equal(ex.line_items[0].supplier_sku, "4026212342529");
  assert.equal(ex.line_items[1].supplier_sku, "4026212342536");
  // Kundennummer bleibt buyer_sku, META-ERP-Nummer („Ihre Artikelnr") wird Alternative
  assert.equal(ex.line_items[0].buyer_sku, "9147455110");
  assert.deepEqual(ex.line_items[0].alternative_skus, ["200188545"]);
});

check("C+P: dieselbe Lieferantenartikelnummer für zwei Positionen", () => {
  const ex = base([
    { supplier_sku: "78820-62", description: "Grundregal 2000x1000x600" },
    { supplier_sku: "78820-62", description: "Grundregal 2000x1000x600" },
  ]);
  const raw = "1 78820-62 Grundregal Lieferantenartikelnummer: 4026212223842 2 78820-62 Grundregal Lieferantenartikelnummer: 4026212223842";
  applyMetaSkuPriority(ex, raw);
  assert.equal(ex.line_items[0].supplier_sku, "4026212223842");
  assert.equal(ex.line_items[1].supplier_sku, "4026212223842");
  assert.deepEqual(ex.line_items[0].alternative_skus, ["78820-62"]);
});

check("EAN in der Beschreibung gewinnt gegen Spaltennummer", () => {
  const ex = base([{ supplier_sku: "124583", description: "Ständer 85/20 3800 x 1100 vzk 4026212124583" }]);
  const r = applyMetaSkuPriority(ex, null);
  assert.equal(r.promotedFromLine, 1);
  assert.equal(ex.line_items[0].supplier_sku, "4026212124583");
  assert.deepEqual(ex.line_items[0].alternative_skus, ["124583"]);
});

check("Ohne META-EAN bleibt alles unverändert (Roloff), ERP-Nummer als Alternative", () => {
  const ex = base([{ supplier_sku: "921018001", description: "Unterlegblech 200176896" }]);
  applyMetaSkuPriority(ex, "200176896 921018001 Unterlegblech 6 Stück");
  assert.equal(ex.line_items[0].supplier_sku, "921018001");
  assert.deepEqual(ex.line_items[0].alternative_skus, ["200176896"]);
});

check("HMF: 6-stellige META-Kurznummer wandert von buyer_sku nach alternative_skus", () => {
  const ex = base([{ supplier_sku: "4026212124583", buyer_sku: "124583", description: "Ständer" }]);
  applyMetaSkuPriority(ex, null);
  assert.equal(ex.line_items[0].buyer_sku, null);
  assert.deepEqual(ex.line_items[0].alternative_skus, ["124583"]);
});

check("Delker: META-ERP-Nummer in buyer_sku wird Alternative", () => {
  const ex = base([{ supplier_sku: "4026212342529", buyer_sku: "200188545", description: "Schwerlastregal" }]);
  applyMetaSkuPriority(ex, null);
  assert.equal(ex.line_items[0].buyer_sku, null);
  assert.deepEqual(ex.line_items[0].alternative_skus, ["200188545"]);
});

check("Echte Kundennummer bleibt buyer_sku", () => {
  const ex = base([{ supplier_sku: "4026212223842", buyer_sku: "78820-62", description: "Grundregal" }]);
  applyMetaSkuPriority(ex, null);
  assert.equal(ex.line_items[0].buyer_sku, "78820-62");
});

check("Blumenbecker: 'Ihre Artikelnummer' ist die META-Nummer, Spaltennummer wird buyer_sku", () => {
  const ex = base([
    { supplier_sku: "1406791", buyer_sku: "20075063", description: "Kragarmregal M Grundfeld" },
    { supplier_sku: "116535", buyer_sku: "20074913", description: "Abrolldornaufnahme" },
  ]);
  const raw = "1 1406791 Kragarmregal M Grundfeld Ihre Artikelnummer:20075063 5 116535 Abrolldornaufnahme Ihre Artikelnummer:20074913";
  applyMetaSkuPriority(ex, raw);
  assert.equal(ex.line_items[0].supplier_sku, "20075063");
  assert.equal(ex.line_items[0].buyer_sku, "1406791");
  assert.equal(ex.line_items[1].supplier_sku, "20074913");
  assert.equal(ex.line_items[1].buyer_sku, "116535");
});

check("'Ihre Artikelnummer' vom Modell weggelassen → Zuordnung in Dokumentreihenfolge", () => {
  const ex = base([{ supplier_sku: "1406791" }, { supplier_sku: "116535" }]);
  applyMetaSkuPriority(ex, "Ihre Artikelnummer:20075063 ... Ihre Artikelnummer: 20074913");
  assert.equal(ex.line_items[0].supplier_sku, "20075063");
  assert.equal(ex.line_items[0].buyer_sku, "1406791");
  assert.equal(ex.line_items[1].supplier_sku, "20074913");
});

check("Beck & Co: Sammelposition 'bestehend aus' wird in Komponenten aufgelöst (über Seitenumbruch)", () => {
  const ex = base([
    { supplier_sku: "4026212260977", buyer_sku: "D012", quantity: 1, unit_price_net: 5550, line_total_net: 5550, description: "Regalkomponenten bestehend aus: 11 x Ständer …" },
  ]);
  const raw = [
    "1 D012 Regalkomponenten bestehend aus: 1 STK 5.550,00 1 5.550,00",
    "Ihre Artikelnummer:AN280209",
    "11 x 4026212260977 ",
    "Ständer 120/20 5500 x 1100 vzk",
    "kpl. multipal S",
    "8 x 4026212259438 ",
    "Holm 4HS 155/17 x 3600 RAL 2001",
    "kpl. Rotorange multipal",
    "8 x 4026212259414 ",
    "Übertrag . . . . . . 5.550,00",
    "Seite 2",
    "Belegnummer: EB0731590",
    "Holm 4HS 155/17 x 2700 RAL 2001",
    "kpl. Rotorange multipal",
    "80 x 4026212266184 ",
    "U-Rammschutz kpl. schwarz/gelb",
    "RAL9004/1003 Höhe 400 mm ",
    "mit Schraubankern",
    "Lieferzeit: ca. 30 Tage nach Auftragseingang.",
  ].join("\n");
  const n = explodeComponentSets(ex, raw);
  assert.equal(n, 4);
  assert.deepEqual(ex.line_items.map((i) => [i.supplier_sku, i.quantity]), [
    ["4026212260977", 11],
    ["4026212259438", 8],
    ["4026212259414", 8],
    ["4026212266184", 80],
  ]);
  assert.equal(ex.line_items[2].description, "Holm 4HS 155/17 x 2700 RAL 2001 kpl. Rotorange multipal");
  assert.equal(ex.line_items[3].description, "U-Rammschutz kpl. schwarz/gelb RAL9004/1003 Höhe 400 mm mit Schraubankern");
  assert.equal(ex.line_items[0].unit_price_net, null);
  assert.ok(ex.extraction_meta.warnings.some((w) => /Pauschalpreis 5\.550,00 EUR/.test(w)));
});

check("Keine Auflösung, wenn das Modell die Komponenten schon einzeln liefert", () => {
  const ex = base([{ supplier_sku: "4026212260977", quantity: 11 }, { supplier_sku: "4026212259438", quantity: 8 }]);
  assert.equal(explodeComponentSets(ex, "11 x 4026212260977 Ständer 8 x 4026212259438 Holm"), 0);
  assert.equal(ex.line_items.length, 2);
});

check("Ungleiche Anzahl GTINs im Rohtext → keine Zuordnung", () => {
  const ex = base([{ supplier_sku: "A" }, { supplier_sku: "B" }, { supplier_sku: "C" }]);
  const r = applyMetaSkuPriority(ex, "4026212000001 4026212000002");
  assert.equal(r.assignedFromDocument, 0);
  assert.equal(ex.line_items[0].supplier_sku, "A");
});

check("buyer_is_meta nur bei META als Käufer", () => {
  const a = base([], "META Regalbau GmbH & Co. KG");
  applyBuyerIsMetaFlag(a);
  assert.equal(a.document.buyer_is_meta, true);
  const b = base([], "Horst Maurer GmbH");
  applyBuyerIsMetaFlag(b);
  assert.equal(b.document.buyer_is_meta, false);
  assert.equal(isMetaCompanyName("Metallbau Schmidt GmbH"), false);
});

if (failures > 0) {
  console.error(`\n${failures} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log("\nAlle Tests bestanden\n");
