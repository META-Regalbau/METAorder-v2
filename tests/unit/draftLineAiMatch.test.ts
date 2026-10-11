/**
 * KI-Abgleich für Positionen ohne sicheren Treffer (Roloff-Bestellung, Live 11.10.2026).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  AI_MATCH_MAX_CONFIDENCE,
  buildCandidateShortlist,
  refineUnmatchedDraftLines,
} from "../../server/commercial/draftLineAiMatch";
import type { MatchingResult } from "../../server/products/productMatcher";

const product = (id: string, name: string, price = 100) =>
  ({ id, productNumber: id, name, price, netPrice: price, currency: "EUR", taxRate: 19, stock: 10, available: true, categoryNames: ["Palettenregale"] }) as never;

// Auszug aus dem Live-Katalog plus ähnliche, falsche Kandidaten
const catalog = [
  product("4026212283785", "Unterlegplatte 1,0 x 140 x 140 vzk MULTIPAL ohne Stapelnocken für Fußplatte 6 x 140 x 140", 0.9),
  product("4026212283778", "Unterlegplatte 2,0 x 140 x 140 vzk MULTIPAL mit Stapelnocken für Fußplatte 6 x 140 x 140", 1.2),
  product("4026212010503", "Unterlegplatte für Klemmdoppelfuß vzk CLIP", 0.5),
  product("4026212348316", "META MULTIPAL | Palettenregal | Grundregal | 3300 x 1825 x 1100 mm | Fachlast 1120 kg | 4 Ebenen | 8 Paletten | verzinkt", 420),
  product("4026212348187", "META MULTIPAL | Palettenregal | Grundregal | 3300 x 1825 x 1100 mm | Fachlast 1100 kg | 3 Ebenen | 6 Paletten | verzinkt", 380),
  product("4026212136043", "META multipal GR 3300 x 2700 x 800 bis 1000 kg vzk / RAL 2001 kpl. S", 1115),
  product("4026212323856", "META MULTIPAL | Palettenregal | Anbauregal | 3300 x 2700 x 1100 mm | Fachlast 980 kg | 4 Ebenen | 12 Paletten | verzinkt", 400),
  product("4026212072242", "META CLIP | Schubladen-Trennblech | 100 x 51 mm | verzinkt", 3),
];

const lines = [
  { extractedProductName: "Unterlegblech/Ausgleichsblech Höhe 1mm f.Palettenregal", extractedProductNumber: "921018001", quantity: 6, extractedPrice: 0.33 },
  { extractedProductName: "Paletten-Grundregal 8xP 1000kg H3300xB1825xT1100mm 4E zn/2001", extractedProductNumber: "921027516", quantity: 1, extractedPrice: 360.12 },
];

function notFound(): MatchingResult {
  return {
    overallConfidence: 0,
    items: lines.map((l) => ({ extractedProductName: l.extractedProductName, extractedProductNumber: l.extractedProductNumber, quantity: l.quantity, confidence: 0, status: "not_found" as const })),
  };
}

function storageWith(feedback: Array<Record<string, unknown>> = []) {
  return { getCommercialProductFeedbackForCustomer: async () => feedback } as never;
}

describe("Vorauswahl", () => {
  it("Synonyme und Maße bringen die richtigen Artikel nach vorn", () => {
    const blech = buildCandidateShortlist(lines[0], catalog).map((p) => p.productNumber);
    assert.ok(blech.includes("4026212283785"), blech.join(","));
    assert.ok(!blech.includes("4026212072242"), "Schubladen-Trennblech passt nicht");
    const regal = buildCandidateShortlist(lines[1], catalog).map((p) => p.productNumber);
    assert.equal(regal[0], "4026212348316", regal.join(","));
  });
});

describe("KI-Abgleich", () => {
  it("KI-Wahl wird Vorschlag (uncertain, höchstens 89 %), mit Begründung", async () => {
    const matching = notFound();
    let prompt = "";
    const res = await refineUnmatchedDraftLines({
      storage: storageWith(),
      tenantId: "t1",
      lineItems: lines,
      matchingResults: matching,
      shopwareCustomerId: "roloff",
      products: catalog,
      llm: async (_system, user) => {
        prompt = user;
        // Kandidat-Nummern aus dem Prompt lesen, wie die KI es täte
        const pick = (pos: number, nr: string) => {
          const block = user.split("\n\n")[pos - 1];
          const m = block.match(new RegExp(`\\[(\\d+)\\] ${nr}`));
          return m ? Number(m[1]) : null;
        };
        return JSON.stringify({
          lines: [
            { line: 1, candidate: pick(1, "4026212283785"), confidence: 92, reason: "Unterlegplatte 1,0 mm für MULTIPAL" },
            { line: 2, candidate: pick(2, "4026212348316"), confidence: 95, reason: "Grundregal 3300x1825x1100, 4 Ebenen, 8 Paletten" },
          ],
        });
      },
    });
    assert.match(prompt, /Händler-Artikelnr\. 921027516/);
    assert.deepEqual(res, { learned: 0, ai: 2, considered: 2 });
    const [a, b] = matching.items;
    assert.equal(a.matchedProduct?.productNumber, "4026212283785");
    assert.equal(b.matchedProduct?.productNumber, "4026212348316");
    for (const item of matching.items) {
      assert.equal(item.status, "uncertain");
      assert.equal(item.matchStrategy, "ai");
      assert.ok(item.confidence <= AI_MATCH_MAX_CONFIDENCE);
    }
    assert.equal(b.aiMatch?.confidence, 95);
    assert.match(b.aiMatch?.reason ?? "", /4 Ebenen/);
  });

  it("unsichere KI-Wahl nur als Alternative, kaputte Antwort ändert nichts", async () => {
    const low = notFound();
    await refineUnmatchedDraftLines({
      storage: storageWith(),
      tenantId: "t1",
      lineItems: lines,
      matchingResults: low,
      shopwareCustomerId: null,
      products: catalog,
      llm: async () => JSON.stringify({ lines: [{ line: 1, candidate: 1, confidence: 40, reason: "unsicher" }] }),
    });
    assert.equal(low.items[0].matchedProduct, undefined);
    assert.equal(low.items[0].status, "not_found");
    assert.equal(low.items[0].alternativeMatches?.length, 1);

    const broken = notFound();
    await refineUnmatchedDraftLines({
      storage: storageWith(),
      tenantId: "t1",
      lineItems: lines,
      matchingResults: broken,
      shopwareCustomerId: null,
      products: catalog,
      llm: async () => "Ich weiß es nicht",
    });
    assert.ok(broken.items.every((i) => i.status === "not_found" && !i.matchedProduct));
  });

  it("gelernt pro Kunde: bestätigte Kunden-Artikelnummer ist sicherer Treffer, ohne KI", async () => {
    const matching = notFound();
    let llmCalls = 0;
    const res = await refineUnmatchedDraftLines({
      storage: storageWith([
        { outcome: "confirmed_product", sourceIdentifier: "921027516", selectedProductId: "4026212348316", createdAt: new Date() },
        { outcome: "confirmed_product", sourceIdentifier: "921018001", selectedProductId: "4026212283785", createdAt: new Date() },
      ]),
      tenantId: "t1",
      lineItems: lines,
      matchingResults: matching,
      shopwareCustomerId: "roloff",
      products: catalog,
      llm: async () => {
        llmCalls += 1;
        return "{}";
      },
    });
    assert.equal(res.learned, 2);
    assert.equal(llmCalls, 0, "alles gelernt: kein KI-Aufruf");
    assert.equal(matching.items[1].status, "matched");
    assert.equal(matching.items[1].confidence, 100);
    assert.equal(matching.items[1].matchStrategy, "learned_customer");
    assert.equal(matching.overallConfidence, 100);
  });

  it("jüngste Entscheidung „kein Produkt“ hebt eine frühere Zuordnung auf", async () => {
    const matching = notFound();
    await refineUnmatchedDraftLines({
      storage: storageWith([
        { outcome: "not_product", sourceIdentifier: "921027516", selectedProductId: null, createdAt: new Date() },
        { outcome: "confirmed_product", sourceIdentifier: "921027516", selectedProductId: "4026212348316", createdAt: new Date(Date.now() - 1000) },
      ]),
      tenantId: "t1",
      lineItems: lines,
      matchingResults: matching,
      shopwareCustomerId: "roloff",
      products: catalog,
      llm: null,
    });
    assert.equal(matching.items[1].status, "not_found");
  });

  it("sichere Treffer und übersprungene Zeilen fasst der Abgleich nicht an", async () => {
    const matching: MatchingResult = {
      overallConfidence: 100,
      items: [
        { extractedProductName: "x", quantity: 1, confidence: 100, status: "matched", matchedProduct: { id: "p", productNumber: "p", name: "p", price: 1, confidence: 100 } },
        { extractedProductName: "Mit freundlichen Grüßen", quantity: 1, confidence: 0, status: "not_found", catalogMatchSkipped: true },
      ],
    };
    const res = await refineUnmatchedDraftLines({
      storage: storageWith(),
      tenantId: "t1",
      lineItems: [{ extractedProductName: "x", quantity: 1 }, { extractedProductName: "Mit freundlichen Grüßen", quantity: 1 }],
      matchingResults: matching,
      shopwareCustomerId: null,
      products: catalog,
      llm: async () => {
        throw new Error("darf nicht aufgerufen werden");
      },
    });
    assert.equal(res.considered, 0);
  });
});
