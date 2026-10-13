/**
 * CLIP-Positionen ohne Artikelnummer (Live 13.10.2026, BHTronik-Angebotsanfrage): Kurzbezeichnung
 * „S3 CLIP 230 AR“ + Spalten H/B/T/Böden. Die Maße standen nur in attributes.dimensions_raw,
 * alle 8 Positionen blieben ohne Treffer.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { clipCatalog, parseClipLineSpec, pickClipSpecProduct, resolveClipSpecRows } from "../../server/commercial/draftClipSpecRows";
import { CONFIGURATOR_APPROX_CONFIDENCE, CONFIGURATOR_EXACT_CONFIDENCE } from "../../server/commercial/draftConfiguratorRows";
import { withAttributes } from "../../server/extraction/documentExtractionTranslate";
import { fillMissingOfferCatalogPrices } from "../../server/commercial/offerDraftCatalogPrices";
import type { MatchingResult } from "../../server/products/productMatcher";

/** Ausschnitt Live-Katalog (13.10.2026) */
const P = (productNumber: string, name: string, netPrice: number) => ({ id: productNumber, productNumber, name, price: netPrice * 1.19, netPrice }) as never;
const CATALOG = [
  // 2500 x 1300 x 600, 230 kg
  P("4026212011173", "META CLIP | Fachbodenregal | Anbauregal | 2500 x 1300 x 600 mm | Fachlast 230 kg | 4+1 Ebenen | verzinkt", 382),
  P("4026212305050", "META CLIP S3 | Fachbodenregal | Anbauregal | 2500 x 1300 x 600 mm | Fachlast 230 kg | 4+1 Ebenen | verzinkt", 359),
  P("4026212326062", "META CLIP S3 | Fachbodenregal | Anbauregal | 2500 x 1300 x 600 mm | Fachlast 230 kg | 5 Ebenen | Längsriegel | verzinkt", 444),
  P("4026212326390", "META CLIP S3 | Fachbodenregal | Anbauregal | 2500 x 1300 x 600 mm | Fachlast 230 kg | 5 Ebenen | Längsriegel | RAL 7035", 544),
  P("4026212439083", "META CLIP S3 | Fachbodenregal | Anbauregal | 2500 x 1300 x 600 mm | Fachlast 230 kg | 6 Ebenen | verzinkt", 396),
  P("4026212384666", "META CLIP S3 | Fachbodenregal | Anbauregal | 2500 x 1300 x 600 mm | Fachlast 150 kg | 4+1 Ebenen | verzinkt", 291),
  P("4026212326598", "META CLIP S3 | Fachbodenregal | Doppel-Anbauregal | 2500 x 1300 x 600 mm | Fachlast 230 kg | 5 Ebenen | Längsriegel | verzinkt", 891),
  // 2000 x 1700 x 500, 200 kg (nur S3)
  P("4026212323986", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1700 x 500 mm | Fachlast 200 kg | 4 Ebenen | verzinkt", 389),
  P("4026212323993", "META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1700 x 500 mm | Fachlast 200 kg | 4 Ebenen | verzinkt", 341),
  P("4026212324518", "META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1700 x 500 mm | Fachlast 200 kg | 4 Ebenen | RAL 7035", 386),
  // 2000 x 1300 x 500, 230 kg
  P("4026212011098", "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1300 x 500 mm | Fachlast 230 kg | 3+1 Ebenen | verzinkt", 261),
  P("4026212304992", "META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1300 x 500 mm | Fachlast 230 kg | 3+1 Ebenen | verzinkt", 241),
  P("4026212325782", "META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1300 x 500 mm | Fachlast 230 kg | 4 Ebenen | Längsriegel | verzinkt", 307),
  P("4026212439519", "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1300 x 500 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", 293),
  P("4026212417418", "META CLIP SPLIT | Fachbodenregal | Anbauregal | 2000 x 1300 x 500 mm | Fachlast 230 kg | 4 Ebenen | verzinkt", 215.5),
  // 2000 x 1300 x 600, 230 kg
  P("4026212305005", "META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1300 x 600 mm | Fachlast 230 kg | 3+1 Ebenen | verzinkt", 282),
  P("4026212439038", "META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1300 x 600 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", 323),
  P("4026212439526", "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1300 x 600 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", 342),
  P("4026212304886", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1300 x 600 mm | Fachlast 230 kg | 3+1 Ebenen | verzinkt", 333),
  P("4026212438819", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1300 x 600 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", 371),
  P("4026212439328", "META CLIP | Fachbodenregal | Grundregal | 2000 x 1300 x 600 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", 410),
  P("4026212438376", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1300 x 600 mm | Fachlast 150 kg | 5 Ebenen | verzinkt", 288),
  // Zusatzböden
  P("4026212309195", "META CLIP | Zusatz-Fachboden | 1700 x 500 mm | 200 kg | verzinkt", 74),
  P("4026212309294", "META CLIP | Zusatz-Fachboden | 1700 x 500 mm | 200 kg | RAL 7035", 83),
  P("4026212018417", "META CLIP | Zusatz-Fachboden | 1300 x 500 mm | 230 kg | verzinkt", 46),
  P("4026212384468", "META CLIP | Zusatz-Fachboden | 1300 x 500 mm | 150 kg | verzinkt", 37),
  P("4026212417227", "META CLIP SPLIT | Zusatz-Fachboden | 1300 x 500 mm | 230 kg | verzinkt | 2 Stück", 99),
  P("4026212004199", "META CLIP | Zusatz-Fachboden | 1000 x 500 mm | 230 kg | verzinkt | 2 Stück", 84.49),
  P("4026212018257", "META CLIP | Zusatz-Fachboden | 1000 x 500 mm | 230 kg | verzinkt", 45),
];

/** Die 8 Positionen der Anfrage, wie die strukturierte Extraktion sie lieferte */
const REQUEST = [
  { description: "Meta Steckregal CLIP S3 230 LR AR (Anbaufeld (AR))", quantity: 1, dims: "H:2500mm B:1300mm T:600mm Böden:5", want: "4026212326062" },
  { description: "Meta CLIP 200 Zusatzboden (Zusatzboden)", quantity: 2, dims: "B:1700mm T:500mm", want: "4026212309195" },
  { description: "Meta S3 Steckregal CLIP 200 AR (Anbaufeld (AR))", quantity: 1, dims: "H:2000mm B:1700mm T:500mm Böden:4", want: "4026212323993" },
  { description: "Meta S3 Steckregal CLIP 200 GR (Grundfeld (GR))", quantity: 1, dims: "H:2000mm B:1700mm T:500mm Böden:4", want: "4026212323986" },
  { description: "Meta CLIP 230 AR (Anbaufeld (AR))", quantity: 1, dims: "H:2000mm B:1300mm T:500mm Böden:4", want: "4026212011098" },
  { description: "Meta CLIP 230 Zusatzboden (Zusatzboden)", quantity: 1, dims: "B:1300mm T:500mm Böden:4", want: "4026212018417" },
  { description: "S3 CLIP 230 AR (Anbaufeld (AR))", quantity: 4, dims: "H:2000mm B:1300mm T:600mm Böden:5", want: "4026212439038" },
  { description: "S3 CLIP 230 GR (Grundfeld (GR))", quantity: 4, dims: "H:2000mm B:1300mm T:600mm Böden:5", want: "4026212438819" },
];

describe("CLIP-Kurzbezeichnung lesen", () => {
  it("Art, Fachlast, S3, Längsriegel, Maße und Böden", () => {
    assert.deepEqual(parseClipLineSpec("Meta Steckregal CLIP S3 230 LR AR (Anbaufeld (AR)) H:2500mm B:1300mm T:600mm Böden:5"), {
      kind: "Anbauregal",
      height: 2500,
      width: 1300,
      depth: 600,
      load: 230,
      levels: 5,
      s3: true,
      laengsriegel: true,
      color: null,
    });
    assert.deepEqual(parseClipLineSpec("Meta CLIP 200 Zusatzboden (Zusatzboden) | B:1700mm T:500mm"), {
      kind: "Zusatz-Fachboden",
      height: null,
      width: 1700,
      depth: 500,
      load: 200,
      levels: null,
      s3: null,
      laengsriegel: null,
      color: null,
    });
  });

  it("Maße als 2000 x 1300 x 600 mm und Fachlast ausgeschrieben", () => {
    const spec = parseClipLineSpec("CLIP Grundregal 2.000 x 1.300 x 600 mm, Fachlast 230 kg, 3+1 Ebenen, RAL 7035")!;
    assert.equal(spec.kind, "Grundregal");
    assert.deepEqual([spec.height, spec.width, spec.depth, spec.load, spec.levels, spec.color], [2000, 1300, 600, 230, 4, "RAL 7035"]);
  });

  it("ohne Maße, ohne Art, Konfigurator- und Doppelregal-Zeilen: nicht zuständig", () => {
    assert.equal(parseClipLineSpec("S3 CLIP 230 AR (Anbaufeld (AR))"), null);
    assert.equal(parseClipLineSpec("META CLIP Steckregal H:2000mm B:1300mm T:600mm"), null);
    assert.equal(parseClipLineSpec("Palettenregal AR H:3000mm B:2700mm T:1100mm"), null);
    assert.equal(parseClipLineSpec("META CLIP Doppel-Anbauregal H:2000mm B:1300mm T:600mm"), null);
    assert.equal(
      parseClipLineSpec("META CLIP Steckregal 2000 x 5080 x 800mm (HxLxT). Anzahl Felder: 5 / Höhe: 2.000 mm / Feldbreite: 1.000 mm / Anzahl Ebenen: 3"),
      null,
    );
  });
});

describe("Katalogartikel wählen", () => {
  const catalog = clipCatalog(CATALOG);

  it("alle 8 Positionen der BHTronik-Anfrage", () => {
    for (const row of REQUEST) {
      const pick = pickClipSpecProduct(catalog, parseClipLineSpec(`${row.description} ${row.dims}`)!);
      assert.equal((pick?.product as { productNumber: string } | undefined)?.productNumber, row.want, row.description);
    }
  });

  it("Abweichungen werden genannt", () => {
    const pick = pickClipSpecProduct(catalog, parseClipLineSpec("S3 CLIP 230 AR H:2500mm B:1300mm T:600mm Böden:7")!)!;
    assert.equal(pick.exact, false);
    assert.match(pick.differences.join(" "), /Anfrage 7 Böden/);
    const boden = pickClipSpecProduct(catalog, parseClipLineSpec("Meta CLIP 230 Zusatzboden B:1300mm T:500mm Böden:4")!)!;
    assert.match(boden.differences.join(" "), /Böden: 4.*Menge prüfen/);
  });

  it("ohne Fachlast: Hinweis, welche gewählt wurde; ohne passendes Maß kein Treffer", () => {
    const pick = pickClipSpecProduct(catalog, parseClipLineSpec("S3 CLIP GR H:2000mm B:1300mm T:600mm Böden:5")!)!;
    assert.match(pick.differences.join(" "), /Fachlast nicht angegeben/);
    assert.equal(pickClipSpecProduct(catalog, parseClipLineSpec("S3 CLIP 230 AR H:2000mm B:1100mm T:600mm")!), null);
  });

  it("Einzelboden vor Doppelpack", () => {
    const pick = pickClipSpecProduct(catalog, parseClipLineSpec("CLIP Zusatzboden 1000 x 500 mm 230 kg")!)!;
    assert.equal((pick.product as { productNumber: string }).productNumber, "4026212018257");
  });
});

function draftFixture() {
  const lineItems = REQUEST.map((r, i) => ({ extractedProductName: r.description, extractedPositionNumber: String(i + 1), quantity: r.quantity }));
  const extractedData: Record<string, unknown> = {
    lineItems,
    documentExtraction: {
      line_items: REQUEST.map((r, i) => ({ position: i + 1, description: r.description, quantity: r.quantity, attributes: { dimensions_raw: r.dims, color: null } })),
    },
  };
  const matchingResults = {
    overallConfidence: 0,
    items: lineItems.map((l) => ({ ...l, status: "not_found", confidence: 0, productScreen: { likelihood: "unclear", reasons: ["Kein eindeutiger Produktbezug"] } })),
  } as unknown as MatchingResult;
  return { extractedData, matchingResults };
}

describe("Entwurf zuordnen", () => {
  it("älterer Entwurf: Maße aus documentExtraction, alles Vorschlag", () => {
    const { extractedData, matchingResults } = draftFixture();
    assert.equal(resolveClipSpecRows({ extractedData, matchingResults, products: CATALOG }), 8);
    matchingResults.items.forEach((item, i) => {
      assert.equal(item.matchedProduct?.productNumber, REQUEST[i].want);
      assert.equal(item.status, "uncertain");
      assert.equal(item.matchStrategy, "clip_spec");
      assert.equal((item as { productScreen?: unknown }).productScreen, undefined);
    });
    assert.equal(matchingResults.items[0].confidence, CONFIGURATOR_EXACT_CONFIDENCE);
    // Zusatzboden mit „Böden: 4“: Hinweis
    assert.equal(matchingResults.items[5].confidence, CONFIGURATOR_APPROX_CONFIDENCE);
    // Nettopreis aus dem Katalog
    assert.equal(matchingResults.items[0].matchedProduct?.price, 444);
  });

  it("sichere und bestätigte Treffer bleiben unangetastet", () => {
    const { extractedData, matchingResults } = draftFixture();
    const kept = { id: "x", productNumber: "4026212305050", name: "anders", price: 1, confidence: 100 };
    Object.assign(matchingResults.items[0], { status: "matched", confidence: 100, matchedProduct: kept });
    Object.assign(matchingResults.items[1], { status: "uncertain", confidence: 80, matchStrategy: "learned_customer", matchedProduct: kept });
    assert.equal(resolveClipSpecRows({ extractedData, matchingResults, products: CATALOG }), 6);
    assert.equal(matchingResults.items[0].matchedProduct, kept);
    assert.equal(matchingResults.items[1].matchedProduct, kept);
  });

  it("andere Position an gleicher Stelle: keine fremden Maße", () => {
    const { extractedData, matchingResults } = draftFixture();
    (extractedData.lineItems as Array<{ extractedProductName: string }>)[0].extractedProductName = "S3 CLIP 230 AR (Anbaufeld (AR))";
    matchingResults.items[0].extractedProductName = "S3 CLIP 230 AR (Anbaufeld (AR))";
    resolveClipSpecRows({ extractedData, matchingResults, products: CATALOG });
    assert.equal(matchingResults.items[0].matchedProduct, undefined);
  });
});

describe("Maße in die Bezeichnung", () => {
  it("fehlende Maße und Farbe werden angehängt", () => {
    assert.equal(
      withAttributes("S3 CLIP 230 GR (Grundfeld (GR))", { dimensions_raw: "H:2000mm B:1300mm T:600mm Böden:5", color: null, surface: null, system: "META CLIP" }),
      "S3 CLIP 230 GR (Grundfeld (GR)) | H:2000mm B:1300mm T:600mm Böden:5",
    );
    assert.equal(withAttributes("Fachboden", { dimensions_raw: null, color: "RAL 7035", surface: null, system: null }), "Fachboden | RAL 7035");
  });

  it("schon enthaltene Maße, Text ohne Zahlen und leere Bezeichnung bleiben", () => {
    assert.equal(withAttributes("Fachboden 1000x400 mm verzinkt", { dimensions_raw: "1000 x 400 mm", color: "verzinkt", surface: null, system: null }), "Fachboden 1000x400 mm verzinkt");
    assert.equal(withAttributes("Regal", { dimensions_raw: "siehe Zeichnung", color: null, surface: null, system: null }), "Regal");
    assert.equal(withAttributes("", { dimensions_raw: "H:2000mm", color: null, surface: null, system: null }), "");
  });
});

describe("Angebot: Katalogpreis nachtragen", () => {
  it("nur wo er fehlt", () => {
    const items = [
      { matchedProduct: { price: 444 } },
      { matchedProduct: { price: 10, catalogPrice: 12 } },
      { matchedProduct: null },
      {},
    ];
    assert.equal(fillMissingOfferCatalogPrices(items), 1);
    assert.equal(items[0].matchedProduct!.catalogPrice, 444);
    assert.equal((items[1].matchedProduct as { catalogPrice: number }).catalogPrice, 12);
  });
});
