/**
 * Konfigurator-Regalzeilen auflösen (Live 11.10.2026: Heinrich & Schleyer BE730041, WOCKEN BE26-31016).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseClipConfiguratorRow, resolveConfiguratorRows, CONFIGURATOR_APPROX_CONFIDENCE } from "../../server/commercial/draftConfiguratorRows";
import { distributeBomPrices } from "../../server/commercial/draftBomSplit";
import type { MatchingResult } from "../../server/products/productMatcher";

const HS =
  "META CLIP Steckregal - Einseitige Regalzeile, Beginn mit: Grundregal. Gesamttiefe: 536 mm, Fachbodentiefe: 500 mm, Gesamthöhe: 2.000 mm, Gesamtlänge: 5.080 mm, Oberfläche Rahmen: Verzinkt, Oberfläche Fachböden: Verzinkt, Rahmentyp: Rahmen offen S3 (zerlegter Rahmen), Aussteifungsart: rückseitige Diagonalverstrebung. Abschnitt 1: Anzahl Felder 5, Höhe 2.000 mm, Feldbreite 1.000 mm, Feldlast 600 kg, Anzahl Ebenen 4, Tragkraft Fachboden 150 kg. Zubehör: 12 x Unterlegplatte für Klemmfuß vzk (für CLIP Einfachklemmfuß) 76 x 58 x 2 mm";
const WOCKEN =
  "META CLIP Steckregal 2000 x 5080 x 800mm (HxLxT). Anzahl Felder: 5 / Höhe: 2.000 mm / Feldbreite: 1.000 mm / Feldlast: 660 kg / Anzahl Ebenen: 3 / Tragkraft Fachboden: 230 kg / Tragkraft Abdeckboden: max. 200 kg. Zubehör: 12 x Unterlegplatte für Klemmfuß vzk (für CLIP Einfachklemmfuß) 76 x 58 x 2 mm. Beschaffungsartikel: Bei Rückgabe können Wiedereinlagerungsgebühren anfallen.";

/** Ausschnitt Live-Katalog (Shop 11.10.2026) */
const P = (productNumber: string, name: string, netPrice: number) => ({ id: productNumber, productNumber, name, price: netPrice * 1.19, netPrice }) as never;
const CATALOG = [
  P("4026212260236", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt", 255),
  P("4026212260243", "META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt", 207),
  P("4026212281514", "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt", 295),
  P("4026212271836", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | RAL 7035", 302),
  P("4026212324259", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | Längsriegel | verzinkt", 286),
  P("4026212259971", "META CLIP SET | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 4 Ebenen | verzinkt", 234),
  P("4026212300345", "META CLIP S3 | Fachbodenregal | Doppel-Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt", 522),
  P("4026212016246", "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 800 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", 441),
  P("4026212016376", "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1000 x 800 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", 366),
  P("4026212224078", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 800 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", 400),
  P("4026212224085", "META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1000 x 800 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", 345),
  P("4026212010534", "Unterlegplatte für Klemmfuß vzk CLIP", 2),
];

describe("Konfigurator-Text lesen", () => {
  it("Heinrich & Schleyer: Abschnitt, Fachbodentiefe, S3, Zubehör", () => {
    const spec = parseClipConfiguratorRow(HS)!;
    assert.deepEqual(spec.sections, [{ fields: 5, height: 2000, fieldWidth: 1000, levels: 4, shelfLoad: 150 }]);
    assert.equal(spec.depth, 500);
    assert.equal(spec.s3, true);
    assert.equal(spec.topShelf, false);
    assert.equal(spec.laengsriegel, false);
    assert.equal(spec.color, "verzinkt");
    assert.deepEqual(spec.accessories, [{ quantity: 12, description: "Unterlegplatte für Klemmfuß vzk (für CLIP Einfachklemmfuß) 76 x 58 x 2 mm" }]);
  });

  it("WOCKEN: HxLxT, Abdeckboden, ohne Abschnitte", () => {
    const spec = parseClipConfiguratorRow(WOCKEN)!;
    assert.deepEqual(spec.sections, [{ fields: 5, height: 2000, fieldWidth: 1000, levels: 3, shelfLoad: 230 }]);
    assert.equal(spec.depth, 800);
    assert.equal(spec.topShelf, true);
    assert.equal(spec.s3, null);
    assert.equal(spec.accessories[0].quantity, 12);
  });

  it("andere Positionen sind keine Konfigurator-Zeilen", () => {
    assert.equal(parseClipConfiguratorRow("META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm"), null);
    assert.equal(parseClipConfiguratorRow("Palettenregal-Ständerrahmen SR 100/20"), null);
  });
});

function draft(text: string, qty: number, price: number) {
  const data: Record<string, any> = {
    lineItems: [
      { extractedProductName: "Fachboden 1000x400 verzinkt", quantity: 2, extractedPrice: 20 },
      { extractedProductName: text, extractedProductNumber: "X875100WMA", quantity: qty, extractedPrice: price },
    ],
  };
  const matching: MatchingResult = {
    overallConfidence: 50,
    items: [
      { extractedProductName: "Fachboden", quantity: 2, confidence: 100, status: "matched", matchStrategy: "ean", matchedProduct: { id: "boden", productNumber: "boden", name: "boden", price: 20, confidence: 100 } },
      { extractedProductName: text, quantity: qty, confidence: 65, status: "uncertain", matchStrategy: "ai", matchedProduct: { id: "x", productNumber: "x", name: "Grundregal 1300", price: 1, confidence: 65 } },
    ],
  };
  return { data, matching };
}

describe("Regalzeile zerlegen", () => {
  it("Heinrich & Schleyer: 3 Zeilen → 3 Grundregale S3 + 12 Anbauregale S3 + 36 Unterlegplatten, Abweichung 4/5 Ebenen", () => {
    const { data, matching } = draft(HS, 3, 411.45);
    const rows = resolveConfiguratorRows({ extractedData: data, matchingResults: matching, products: CATALOG });
    assert.equal(rows.length, 1);
    assert.deepEqual(
      matching.items.slice(1).map((i) => [i.quantity, i.matchedProduct?.productNumber ?? null, i.status, i.matchStrategy ?? null]),
      [
        [3, "4026212260236", "uncertain", "configurator"],
        [12, "4026212260243", "uncertain", "configurator"],
        [36, null, "not_found", null],
      ],
    );
    assert.equal(matching.items[1].confidence, CONFIGURATOR_APPROX_CONFIDENCE);
    assert.deepEqual(rows[0].differences, ["Konfiguration 4 Ebenen, Katalogartikel 5 Ebenen"]);
    assert.equal(data.lineItems[0].extractedProductName, "Fachboden 1000x400 verzinkt");
    assert.equal(data.bomSplit[0].source, "configurator");
    assert.equal(data.bomSplit[0].totalNet, 1234.35);
    assert.deepEqual(data.bomSplit[0].componentIndices, [1, 2, 3]);
  });

  it("WOCKEN: ohne S3-Angabe Standard-CLIP, Tiefe 800, Abdeckboden als 3+1", () => {
    const { data, matching } = draft(WOCKEN, 1, 620.126);
    const rows = resolveConfiguratorRows({ extractedData: data, matchingResults: matching, products: CATALOG });
    assert.deepEqual(matching.items.slice(1, 3).map((i) => [i.quantity, i.matchedProduct?.productNumber]), [
      [1, "4026212016246"],
      [4, "4026212016376"],
    ]);
    assert.deepEqual(rows[0].differences, ["Konfiguration 3+1 Ebenen, Katalogartikel 5 Ebenen"]);
  });

  it("Preis verteilt, sobald das Zubehör einen Vorschlag hat", () => {
    const { data, matching } = draft(HS, 3, 411.45);
    resolveConfiguratorRows({ extractedData: data, matchingResults: matching, products: CATALOG });
    const net = (id: string) => (CATALOG as Array<{ id: string; netPrice: number }>).find((p) => p.id === id)?.netPrice ?? null;
    distributeBomPrices({ extractedData: data, matchingResults: matching, netPriceOf: net });
    assert.equal(data.bomSplit[0].priceDistributed, false);
    matching.items[3].matchedProduct = { id: "4026212010534", productNumber: "4026212010534", name: "Unterlegplatte", price: 2, confidence: 80 };
    distributeBomPrices({ extractedData: data, matchingResults: matching, netPriceOf: net });
    assert.equal(data.bomSplit[0].priceDistributed, true);
    const sum = matching.items.slice(1).reduce((s, i) => s + ((i.matchedProduct as any).manualUnitPriceNet ?? 0) * i.quantity, 0);
    assert.ok(Math.abs(sum - 1234.35) < 1, String(sum));
  });

  it("Regal nicht im Katalog: Position bleibt stehen", () => {
    const { data, matching } = draft(HS.replace("Feldbreite 1.000 mm", "Feldbreite 1.250 mm"), 1, 100);
    assert.deepEqual(resolveConfiguratorRows({ extractedData: data, matchingResults: matching, products: CATALOG }), []);
    assert.equal(data.lineItems.length, 2);
  });
});
