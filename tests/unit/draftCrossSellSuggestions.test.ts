/**
 * Crossselling im Entwurfs-Prüffenster: gemerkte Ergebnisse, geteilte Berechnung, begrenzte
 * Parallelität (Live 11.10.2026: Entwurf öffnen dauerte 6–16 s, Server-Neustart unter Last).
 *
 *   Ausführung: npm test
 */
import { beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { cachedSuggestions, clearDraftCrossSellCache, mapLimited } from "../../server/cross-selling/draftCrossSellSuggestions";

beforeEach(() => clearDraftCrossSellCache());

describe("Vorschläge merken", () => {
  it("zweiter Abruf und gleichzeitige Abrufe rechnen nicht neu", async () => {
    let calls = 0;
    const compute = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return [{ id: "x", productNumber: "x", name: "x", price: 1 }];
    };
    const [a, b] = await Promise.all([cachedSuggestions("t:1", compute), cachedSuggestions("t:1", compute)]);
    await cachedSuggestions("t:1", compute);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
  });

  it("nach 10 Minuten neu, Fehler werden nicht gemerkt", async () => {
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return [];
    };
    const t0 = 1_000_000;
    await cachedSuggestions("t:2", compute, t0);
    await cachedSuggestions("t:2", compute, t0 + 9 * 60 * 1000);
    assert.equal(calls, 1);
    await cachedSuggestions("t:2", compute, t0 + 11 * 60 * 1000);
    assert.equal(calls, 2);

    let failing = true;
    const flaky = async () => {
      if (failing) throw new Error("Shopware weg");
      return [];
    };
    await assert.rejects(cachedSuggestions("t:3", flaky));
    failing = false;
    assert.deepEqual(await cachedSuggestions("t:3", flaky), []);
  });
});

describe("Begrenzte Parallelität", () => {
  it("höchstens n gleichzeitig, Reihenfolge bleibt", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      running -= 1;
      return n * 10;
    });
    assert.equal(peak, 3);
    assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70]);
  });
});
