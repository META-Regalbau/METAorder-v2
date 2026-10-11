/**
 * Nummern-Treffer gegen die Bezeichnung prüfen (Werkzeug-Eylert 80468065, Live 11.10.2026: EAN-Spalte
 * um eine Zeile verrutscht, vier falsche Artikel mit 100 %).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  checkNumberMatches,
  compareDescriptionToProduct,
  NUMBER_CONFLICT_CONFIDENCE,
  NUMBER_REALIGNED_CONFIDENCE,
} from "../../server/commercial/draftNumberMatchCheck";
import type { MatchingResult } from "../../server/products/productMatcher";

/** Richtige Nummern-Treffer aus den Live-Entwürfen vom 11.10.2026: dürfen nicht als Widerspruch gelten */
const CORRECT_LIVE_PAIRS: Array<[string, string]> = [
  ["Ständer 120/20 5500 x 1100 vzk kpl. multipal S", "META MULTIPAL | Ständerrahmen | 5500 x 1100 mm | 120/20 | verzinkt"],
  ["Holm 4HS 155/17 x 3600 RAL 2001 kpl. Rotorange multipal", "MP HS155/17 3600 R2001 kpl"],
  ["Holm 4HS 155/17 x 2700 RAL 2001 kpl. Rotorange multipal", "MP HS155/17 2700 R2001 kpl"],
  ["U-Rammschutz kpl. schwarz/gelb RAL9004/1003 Höhe 400 mm mit Schraubankern", "META MULTIPAL | U-Rammschutz | RAL 1003"],
  ["Spanplattenboden HO 3 Tiefenauflagen B1825xT1100mm natur Trgf.1680kg META", "META MULTIPAL | Zusatzboden Spanplatte 38 mm | 1825 x 1100 mm | mit Tiefenauflage"],
  ["Kragarmregal M Grundfeld B1000xT400xH2000 mm einseitig RAL 5010 4 Arme Traglast 535kg", "META MULTISTRONG M | Kragarmregal | Grundregal | 2000 x 1000 x 400 mm | Armlast 535 kg | einseitig | 4+1 Ebenen"],
  ["Kragarmregal M Grundfeld B1000xT2x400xH2000 mm doppelseitig RAL 5010 2x4 Arme Traglast 535kg", "META MULTISTRONG M | Kragarmregal | Grundregal | 2000 x 1000 x 400 mm | Armlast 535 kg | doppelseitig | 4+1 Ebenen"],
  ["Kragarm M T400xH70 mm RAL 5010 Traglast 535kg META", "META MULTISTRONG M | Kragarm | 70/30 | 400 mm | RAL 5010"],
  ["Fußverankerung verzinkt META", "KR L M AT BSet Fußklammer vzk"],
  ["Unterlegblech verzinkt Stärke 1,5 mm META", "META MULTISTRONG L+M | Unterlegplatte 1,5 mm | verzinkt"],
  ["Abrolldorn steckbar Nutzhöhe 100 mm verzinkt META", "META MULTISTRONG L+M | Abrolldorn 170 mm | verzinkt"],
  ["Regal:Liefer Pfosten 85/20 H5500mm", "ETK MP Profil 85/20 5500 R5010"],
  ["Meta Paletten-Grundregal MULTIPAL GR 3300 x 2700 x 1100 mm 980kg vzk / RAL 2001, mit 3 Lagerebenen", "META MULTIPAL | Palettenregal | Grundregal | 3300 x 2700 x 1100 mm | Fachlast 980 kg | 3 Ebenen | 9 Paletten | verzinkt"],
  ["META-Rammschutz für Regalsysteme, Eck-Profil 175x175x400mm (LxBxH), schwarz/gelb", "META MULTIPAL | Rammschutzecke | RAL 1003"],
  ["Fachboden-Grundregal Stecksystem verzinkt, Höhenverstellbarkeit Fachböden 25 mm Lochraster, Kantenhöhe Fachboden 40 mm", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt"],
  ["Palettenregal-Ständerrahmen SR 100/20", "META MULTIPAL | Ständerrahmen | 2700 x 1100 mm | 100/20 | verzinkt"],
  ["Leichte Durchschubsicherung RAL 2001", "META MULTIPAL | Durchschubsicherung light | 2700 mm | LA 100 mm | RAL 2001"],
  ["Rammschutz Höhe 400mm inkl. Bodenanker", "META MULTIPAL | Rammschutzecke | RAL 1003"],
  ["Kragarm-Grundregal einseitig IPE120 4 Kragarme 2000x1000x500mm", "META MULTISTRONG L | Kragarmregal | Grundregal | 2000 x 1000 x 500 mm | Armlast 175 kg | einseitig | 4+1 Ebenen"],
  ["Packtisch mit Ablage 1970/970 x 2000 x 4", "META SPEED-RACK | Packtisch | 1970 x 2000 x 800 mm | 4 Ebenen | verzinkt"],
  ["Gitterrostboden 25x2 o. Holme 2700x800 500kg", "META MULTIPAL | Gitterrostboden eingelegt | 2700 x 800 mm | 500 kg/m² | feuerverzinkt"],
  ["GROSSFACH-GRUNDREGAL FL230KG 2500X1300X500MM 5 BOED.VERZINKT", "META CLIP | Fachbodenregal | Grundregal | 2500 x 1300 x 500 mm | Fachlast 230 kg | 4+1 Ebenen | verzinkt"],
  ["Unterlegblech/Ausgleichsblech Höhe 1mm f.Palettenregal", "Unterlegplatte 1,0 x 140 x 140 vzk MULTIPAL ohne Stapelnocken für Fußplatte 6 x 140 x 140"],
  ["Paletten-Grundregal 8xP 1000kg zn", "META MULTIPAL | Palettenregal | Grundregal | 3300 x 1825 x 1100 mm | Fachlast 1120 kg | 4 Ebenen | 8 Paletten | verzinkt"],
  ["Steckregal CLIP S3 150 LR, Grundfeld", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 150 kg | 5 Ebenen | Längsriegel | verzinkt"],
  ["Schwerlastregal H2200xB1825xT800mm Grundregal verzinkt silber META", "META MULTIPAL | Großfachregal | Grundregal | 2200 x 1825 x 800 mm | Fachlast 1800 kg | 3 Ebenen | Stahlpaneele | verzink"],
];

describe("Bezeichnung gegen Artikel", () => {
  it("richtige Live-Treffer: kein Widerspruch", () => {
    for (const [desc, product] of CORRECT_LIVE_PAIRS) {
      const fit = compareDescriptionToProduct(desc, product);
      assert.equal(fit.conflict, null, `${desc} ↔ ${product}: ${fit.conflict}`);
    }
  });

  it("falscher Typ oder falsches Hauptmaß: Widerspruch", () => {
    assert.match(compareDescriptionToProduct("Holm 4HS 140/15 x 3600mm RAL 2001 komplett", "MP C30/25 1505 vzk Dia1100").conflict ?? "", /Typ/);
    assert.match(compareDescriptionToProduct("Holm HN 120/20 B2700mm Fachlast 3000kg RAL 2001 Meta", "MP HS140/15 3600 R2001 kpl").conflict ?? "", /Maße: Bezeichnung 2700/);
  });
});

/** Eylert 80468065 wie live: EANs eine Zeile zu hoch */
function eylert() {
  const lineItems = [
    { extractedProductName: "Holm HN 120/20 B2700mm Fachlast 3000kg RAL 2001 Meta", extractedProductNumber: "4026212259407", quantity: 2 },
    { extractedProductName: "Holm 4HS 140/15 x 3600mm RAL 2001 komplett", extractedProductNumber: "4026212198904", quantity: 1 },
    { extractedProductName: "Diagonale für SR85/20 100/20 100/35 1100mm L1505mm", extractedProductNumber: "4026212036336", quantity: 1 },
    { extractedProductName: "Diagonalstab 1000 vzk", extractedProductNumber: "4026212198898", quantity: 1 },
    { extractedProductName: "Horizontale für Tiefe 1100mm C-Profil 30/25 1010mm vzk, multipal S und", quantity: 1 },
    { extractedProductName: "Fremdversand-Kosten", extractedProductNumber: "021198", quantity: 1 },
  ];
  const prod = (id: string, name: string) => ({ id, productNumber: id, name, price: 1, confidence: 100 });
  const matchingResults: MatchingResult = {
    overallConfidence: 80,
    items: [
      { extractedProductName: lineItems[0].extractedProductName, quantity: 2, status: "matched", confidence: 100, matchStrategy: "ean", matchedProduct: prod("4026212259407", "MP HS140/15 3600 R2001 kpl") },
      { extractedProductName: lineItems[1].extractedProductName, quantity: 1, status: "matched", confidence: 100, matchStrategy: "ean", matchedProduct: prod("4026212198904", "MP C30/25 1505 vzk Dia1100") },
      { extractedProductName: lineItems[2].extractedProductName, quantity: 1, status: "matched", confidence: 100, matchStrategy: "ean", matchedProduct: prod("4026212036336", "META CLIP | Diagonalstab | für Regalbreite 1000 mm | verzinkt") },
      { extractedProductName: lineItems[3].extractedProductName, quantity: 1, status: "matched", confidence: 100, matchStrategy: "ean", matchedProduct: prod("4026212198898", "MP C30/25 1010 vzk Hor1100") },
      { extractedProductName: lineItems[4].extractedProductName, quantity: 1, status: "not_found", confidence: 0 },
      { extractedProductName: lineItems[5].extractedProductName, quantity: 1, status: "not_found", confidence: 0 },
    ],
  };
  return { lineItems, matchingResults };
}

describe("Verrutschte Nummernspalte", () => {
  it("Eylert: Artikel rücken eine Zeile tiefer, erste Zeile wird offen", () => {
    const { lineItems, matchingResults } = eylert();
    const res = checkNumberMatches({ lineItems, matchingResults });
    assert.deepEqual(res.shift, { from: 0, to: 3, direction: "down" });
    const items = matchingResults.items;
    assert.equal(items[0].status, "not_found");
    assert.equal(items[0].numberCheck?.kind, "realigned");
    assert.equal(lineItems[0].extractedProductNumber, undefined);
    assert.deepEqual(
      items.slice(1, 5).map((i) => [i.matchedProduct?.productNumber, i.status, i.confidence]),
      [
        ["4026212259407", "uncertain", NUMBER_REALIGNED_CONFIDENCE],
        ["4026212198904", "uncertain", NUMBER_REALIGNED_CONFIDENCE],
        ["4026212036336", "uncertain", NUMBER_REALIGNED_CONFIDENCE],
        ["4026212198898", "uncertain", NUMBER_REALIGNED_CONFIDENCE],
      ],
    );
    assert.equal(lineItems[4].extractedProductNumber, "4026212198898");
    assert.match(items[1].numberCheck?.note ?? "", /eine Zeile höher/);
    assert.equal(res.conflicts, 0);
  });

  it("einzelner Widerspruch: nur herabgestuft, nichts verschoben", () => {
    const { lineItems, matchingResults } = eylert();
    // nur die zweite Zeile falsch, keine Verschiebung erkennbar
    matchingResults.items[0].matchedProduct = { id: "a", productNumber: "a", name: "META MULTIPAL | Holm | 2700 mm | HN 120/20 | RAL 2001", price: 1, confidence: 100 };
    matchingResults.items[2].matchedProduct = { id: "c", productNumber: "c", name: "MP C30/25 1505 vzk Dia1100", price: 1, confidence: 100 };
    matchingResults.items[3].matchedProduct = { id: "d", productNumber: "d", name: "META CLIP | Diagonalstab | für Regalbreite 1000 mm | verzinkt", price: 1, confidence: 100 };
    const res = checkNumberMatches({ lineItems, matchingResults });
    assert.equal(res.shift, null);
    assert.equal(res.conflicts, 1);
    assert.equal(matchingResults.items[1].status, "uncertain");
    assert.equal(matchingResults.items[1].confidence, NUMBER_CONFLICT_CONFIDENCE);
    assert.equal(matchingResults.items[1].numberCheck?.kind, "conflict");
    assert.equal(matchingResults.items[0].status, "matched");
  });

  it("Bezeichnung nur die Nummer: keine Prüfung", () => {
    const lineItems = [{ extractedProductName: "4026212202583", extractedProductNumber: "4026212202583", quantity: 5 }];
    const matchingResults: MatchingResult = {
      overallConfidence: 100,
      items: [{ extractedProductName: "4026212202583", quantity: 5, status: "matched", confidence: 100, matchStrategy: "ean", matchedProduct: { id: "x", productNumber: "x", name: "Holm 3600", price: 1, confidence: 100 } }],
    };
    assert.equal(checkNumberMatches({ lineItems, matchingResults }).conflicts, 0);
    assert.equal(matchingResults.items[0].status, "matched");
  });
});
