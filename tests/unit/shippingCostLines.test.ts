/**
 * Fracht- und Hinweiszeilen sind keine Artikel (Live 11.10.2026: Bartels „Frachtkosten“, Eylert
 * „Fremdversand-Kosten“, Heinrich & Schleyer „Frachtkosten *** nicht Skontierfähig ***“ und
 * „Telefonisches AVIS Hausmeisterei …“).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { classifyNonProductLine, moveShippingAndNoticeLines } from "../../server/extraction/shippingCostLines";

describe("Fracht erkennen", () => {
  it("Live-Zeilen und Varianten", () => {
    for (const name of ["Frachtkosten", "Fremdversand-Kosten", "Frachtkosten *** nicht Skontierfähig ***", "Frachtkosten (nicht Skontierfähig)", "Versandkosten", "Fracht/Verpackung", "Transportkosten Spedition", "Porto"]) {
      assert.equal(classifyNonProductLine({ extractedProductName: name }), "shipping", name);
    }
    assert.equal(classifyNonProductLine({ extractedProductName: "Telefonisches AVIS Hausmeisterei Tel:08151/366-140" }), "notice");
  });

  it("Artikel mit ähnlichen Wörtern bleiben Artikel", () => {
    for (const name of ["Transportwagen 1200x800 verzinkt", "Versandkarton 600x400x400", "Palettenregal-Ständerrahmen SR 100/20", "Holm 4HS 140/15 x 3600mm", "Frachtgutregal 2000x1000"]) {
      assert.equal(classifyNonProductLine({ extractedProductName: name }), null, name);
    }
  });
});

describe("Aus den Positionen nehmen", () => {
  it("Bartels: Fracht mit Betrag in die Notizen, Artikel bleibt", () => {
    const data: Record<string, any> = {
      orderNotes: "Zahlung: 30 Tage netto",
      lineItems: [
        { extractedProductName: "Fachboden-Grundregal Stecksystem verzinkt", extractedProductNumber: "4026212260236", quantity: 5, extractedPrice: 117.15 },
        { extractedProductName: "Frachtkosten", extractedProductNumber: "610.100", quantity: 1, extractedPrice: 52.71 },
      ],
    };
    const shipping = moveShippingAndNoticeLines(data, "orderNotes");
    assert.deepEqual(shipping, [{ label: "Frachtkosten", amountNet: 52.71, articleNumber: "610.100" }]);
    assert.equal(data.lineItems.length, 1);
    assert.equal(data.documentShippingCosts.length, 1);
    assert.match(data.orderNotes, /^Zahlung: 30 Tage netto\n\n\[Fracht laut Beleg\] Frachtkosten: 52,71 € netto/);
  });

  it("Avis-Hinweis wird Notiz", () => {
    const data: Record<string, any> = {
      lineItems: [
        { extractedProductName: "Regalaussteifung mit Längsriegel verzinkt", quantity: 20 },
        { extractedProductName: "Telefonisches AVIS Hausmeisterei Tel:08151/366-140", extractedProductNumber: "IN34", quantity: 1 },
        { extractedProductName: "Frachtkosten *** nicht Skontierfähig ***", extractedProductNumber: "IN01", quantity: 1, extractedPrice: 29.2 },
      ],
    };
    moveShippingAndNoticeLines(data, "offerNotes");
    assert.equal(data.lineItems.length, 1);
    assert.match(data.offerNotes, /\[Lieferhinweis aus den Positionen\] Telefonisches AVIS/);
    assert.match(data.offerNotes, /29,20 € netto/);
  });

  it("nur Fracht im Beleg: nichts entfernt", () => {
    const data: Record<string, any> = { lineItems: [{ extractedProductName: "Frachtkosten", quantity: 1 }, { extractedProductName: "Versandkosten", quantity: 1 }] };
    assert.deepEqual(moveShippingAndNoticeLines(data, "orderNotes"), []);
    assert.equal(data.lineItems.length, 2);
    assert.equal(data.orderNotes, undefined);
  });
});
