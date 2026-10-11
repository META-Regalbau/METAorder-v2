/**
 * Stückliste im Positionstext auflösen (Steinke 202659143, Live 11.10.2026).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { distributeBomPrices, lineLooksLikeBom, splitBomLines } from "../../server/commercial/draftBomSplit";
import type { MatchingResult } from "../../server/products/productMatcher";

const STEINKE =
  "META MULTIPAL Palettenregal - Einseitige Regalzeile, Beginn mit: Grundregal, Gesamttiefe: 800 mm, Gesamthöhe: 4.400 mm, Gesamtlänge: 5.760 mm, Palettenstellplätze: 24. " +
  "Abschnitt 1: Anzahl Felder 1, Ständerhöhe 4.400 mm, Feldbreite 2.700 mm, Anzahl Ebenen 5, Fachlast 2.000 kg. Konfiguriertes Zubehör: 5x Gitterrostboden aufg. 2700x800, 1000 kg/m², MW 40x60 TS 30x2 feuerverzinkt multipal; 4x Rückwandgitter QR 2700x1100 RAL 5010 multipal; 4x Befestigungsset Rückwandgitter LA 100 vzk Heavy kpl. multipal. " +
  "Abschnitt 2: Anzahl Felder 1, Konfiguriertes Zubehör: 5x Gitterrostboden aufg. 2700x800 multipal. " +
  "Zubehör: 3x U-Rammschutz kpl. schwarz/gelb RAL9004/1003, Höhe 400 mm, mit Schraubankern; 6x Unterlegblech 1,0x140x140 vzk Multipal S ohne Stapelnocken; 6x Unterlegblech 2,0x140x140 vzk Multipal S mit Stapelnocken. " +
  "Stückliste: 3x Ständer 120/20 4400x800 vzk kpl. multipal S; 20x Holm 4HS 140/15x2700 RAL 2001 kpl. Laut Angebot 291037 KAHL 31.08.2026.";

const components = [
  { quantity: 3, description: "Ständer 120/20 4400x800 vzk kpl. multipal S" },
  { quantity: 20, description: "Holm 4HS 140/15x2700 RAL 2001 kpl." },
  { quantity: 10, description: "Gitterrostboden aufg. 2700x800 feuerverzinkt multipal" },
  { quantity: 4, description: "Rückwandgitter QR 2700x1100 RAL 5010 multipal" },
];

function draft(extra: Array<{ extractedProductName: string; quantity: number; extractedPrice?: number }> = []) {
  return {
    lineItems: [
      { extractedProductName: "Fachboden 1000x400 verzinkt", quantity: 2, extractedPrice: 20 },
      { extractedProductName: STEINKE, extractedProductNumber: "ANGEBOT", quantity: 1, extractedPrice: 3889.21 },
      ...extra,
    ],
  } as Record<string, any>;
}

function matching(n = 2): MatchingResult {
  const items: MatchingResult["items"] = [
    { extractedProductName: "Fachboden", quantity: 2, confidence: 100, status: "matched", matchedProduct: { id: "boden", productNumber: "b", name: "b", price: 20, confidence: 100 } },
    { extractedProductName: STEINKE, quantity: 1, confidence: 0, status: "not_found" },
  ];
  return { overallConfidence: 50, items: items.slice(0, n) };
}

describe("Stückliste erkennen", () => {
  it("Steinke-Text ja, normale Positionen nein", () => {
    assert.equal(lineLooksLikeBom(STEINKE), true);
    assert.equal(lineLooksLikeBom("Paletten-Grundregal 8xP 1000kg H3300xB1825xT1100mm 4E zn/2001"), false);
    assert.equal(lineLooksLikeBom("2x Fachboden 1000x400"), false);
  });
});

describe("Stückliste zerlegen", () => {
  it("Teile werden Positionen, sichere Treffer bleiben, Original bleibt vermerkt", async () => {
    const data = draft();
    const m = matching();
    let prompt = "";
    const entries = await splitBomLines({
      extractedData: data,
      matchingResults: m,
      llm: async (_s, user) => {
        prompt = user;
        return JSON.stringify({ components });
      },
    });
    assert.match(prompt, /Bestellmenge: 1/);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].originalPosition, 2);
    assert.equal(entries[0].totalNet, 3889.21);
    assert.deepEqual(entries[0].componentIndices, [1, 2, 3, 4]);
    assert.equal(data.lineItems.length, 5);
    assert.equal(data.lineItems[0].extractedProductName, "Fachboden 1000x400 verzinkt");
    assert.deepEqual(data.lineItems.slice(1).map((l: any) => [l.quantity, l.extractedPositionNumber]), [[3, "2.1"], [20, "2.2"], [10, "2.3"], [4, "2.4"]]);
    assert.equal(m.items[0].matchedProduct?.id, "boden");
    assert.ok(m.items.slice(1).every((i) => i.status === "not_found"));
    assert.equal(data.bomSplit.length, 1);
  });

  it("Bestellmenge 2 verdoppelt die Teile", async () => {
    const data = draft();
    data.lineItems[1].quantity = 2;
    await splitBomLines({ extractedData: data, matchingResults: matching(), llm: async () => JSON.stringify({ components }) });
    assert.equal(data.lineItems[1].quantity, 6);
    assert.equal(data.bomSplit[0].totalNet, 7778.42);
  });

  it("KI-Fehler oder weniger als 2 Teile: nichts geändert", async () => {
    for (const llm of [async () => "kaputt", async () => JSON.stringify({ components: [components[0]] }), async () => { throw new Error("weg"); }]) {
      const data = draft();
      const entries = await splitBomLines({ extractedData: data, matchingResults: matching(), llm });
      assert.equal(entries.length, 0);
      assert.equal(data.lineItems.length, 2);
    }
  });
});

describe("Preis verteilen", () => {
  it("anteilig nach Katalogpreis, nur wenn alle Teile einen Vorschlag haben", async () => {
    const data = draft();
    const m = matching();
    await splitBomLines({ extractedData: data, matchingResults: m, llm: async () => JSON.stringify({ components }) });
    const prices: Record<string, number> = { staender: 300, holm: 80, rost: 60, gitter: 50 };
    const ids = ["staender", "holm", "rost", "gitter"];
    // erst ohne Vorschlag für das letzte Teil
    ids.slice(0, 3).forEach((id, k) => {
      m.items[k + 1].matchedProduct = { id, productNumber: id, name: id, price: prices[id], confidence: 80 };
    });
    distributeBomPrices({ extractedData: data, matchingResults: m, netPriceOf: (id) => prices[id] ?? null });
    assert.equal(data.bomSplit[0].priceDistributed, false);

    m.items[4].matchedProduct = { id: "gitter", productNumber: "gitter", name: "gitter", price: 50, confidence: 80 };
    distributeBomPrices({ extractedData: data, matchingResults: m, netPriceOf: (id) => prices[id] ?? null });
    assert.equal(data.bomSplit[0].priceDistributed, true);
    const sum = m.items.slice(1).reduce((s, i) => s + (i.matchedProduct as any).manualUnitPriceNet * i.quantity, 0);
    assert.ok(Math.abs(sum - 3889.21) < 0.5, String(sum));
    assert.equal((m.items[1].matchedProduct as any).manualPriceChangedBy, "Bestellposition 2");
    assert.equal(data.lineItems[1].extractedPrice, (m.items[1].matchedProduct as any).manualUnitPriceNet);
    // der sichere Treffer davor bleibt unberührt
    assert.equal((m.items[0].matchedProduct as any).manualUnitPriceNet, undefined);
  });
});
