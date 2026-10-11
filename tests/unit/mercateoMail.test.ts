/**
 * Mercateo-Bestellmail (Live 11.10.2026): „06354 Köthen“ wurde zur Position mit Menge 6354,
 * „RudolphstraÃŸe“, kein Kunde gefunden (Shop-Konto heißt „Unite Procurement Deutschland AG“).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  isLowQualityLocalExtraction,
  localLineIsZipCity,
  localLinesHaveImplausibleQuantity,
} from "../../server/extraction/localExtractionQuality";
import { repairUtf8Mojibake } from "../../server/email/mojibake";
import {
  EMAIL_DOMAIN_MATCH_MAX_CONFIDENCE,
  computeCustomerMatchConfidence,
  tryResolveCustomerByEmailDomain,
} from "../../server/commercial/draftCustomerEmailResolution";

describe("PLZ + Ort ist keine Position", () => {
  it("führende Null oder fünf Ziffern vor einem Ortsnamen", () => {
    for (const line of ["06354 Köthen", "34821 Gudensberg", "59759 Arnsberg", "60311 Frankfurt am Main", "D-06366 Köthen (Anhalt)", "01067 Dresden"]) {
      assert.equal(localLineIsZipCity(line), true, line);
    }
  });

  it("echte Positionen bleiben", () => {
    for (const line of ["2 Packtisch 970 x 2000 x 800", "10 Fachboden 1000x400", "1000 Kabelbinder", "12 St Schrauben M8", "20097108 Packtisch mit Ablage", "5 x Gitterrost"]) {
      assert.equal(localLineIsZipCity(line), false, line);
    }
  });

  it("Menge ab 1000 vor reinem Text: lieber die KI", () => {
    const lines = [
      { extractedProductName: "Köthen", quantity: 6354 },
      { extractedProductName: "20097108 Packtisch mit Ablage", extractedProductNumber: "20097108", quantity: 1 },
    ];
    assert.equal(localLinesHaveImplausibleQuantity(lines), true);
    assert.equal(
      isLowQualityLocalExtraction({ lineItems: lines, customer: { email: "operations@mercateo.com" }, billingAddress: { street: "Rudolphstraße 1", zipCode: "34821", city: "Gudensberg" } }),
      true,
    );
    assert.equal(localLinesHaveImplausibleQuantity([{ extractedProductName: "Schraube M8x20", quantity: 5000 }]), false);
  });
});

describe("Umlaute reparieren", () => {
  it("doppelt kodiertes UTF-8 wird lesbar, echter Text bleibt", () => {
    assert.equal(repairUtf8Mojibake("RudolphstraÃŸe 1"), "Rudolphstraße 1");
    assert.equal(repairUtf8Mojibake("KÃ¶then, GrÃ¼ÃŸe, Ã„nderung"), "Köthen, Grüße, Änderung");
    assert.equal(repairUtf8Mojibake("Preis 12 â‚¬"), "Preis 12 €");
    assert.equal(repairUtf8Mojibake("Straße 1, Köthen"), "Straße 1, Köthen");
    assert.equal(repairUtf8Mojibake("SÃO PAULO"), "SÃO PAULO");
  });
});

describe("Kunde über die Mail-Domain", () => {
  const unite = { id: "unite", company: "Unite Procurement Deutschland AG", email: "heike.eichler@mercateo.com", customerNumber: "20000042592" };
  const shop = (hits: Array<typeof unite>) => ({ searchCustomers: async () => hits });

  it("genau ein Konto mit der Domain: Vorschlag mit begrenzter Sicherheit", async () => {
    const res = await tryResolveCustomerByEmailDomain(shop([unite, { id: "x", company: "Anders", email: "info@mercateo-fan.de", customerNumber: "1" }]), [
      "operations@mercateo.com",
    ]);
    assert.equal(res.match?.id, "unite");
    assert.equal(res.candidates[0].reason, "email_domain");
    const confidence = computeCustomerMatchConfidence({ ranked: [{ email: "operations@mercateo.com", score: 40 }], shopwareCustomerId: "unite", usedLlm: false, emailDomainMatch: true });
    assert.equal(confidence, EMAIL_DOMAIN_MATCH_MAX_CONFIDENCE);
    assert.ok(confidence < 72);
  });

  it("mehrere Konten: nur zur Auswahl; Freemail und eigene Domain nie", async () => {
    const two = await tryResolveCustomerByEmailDomain(shop([unite, { ...unite, id: "unite2", email: "einkauf@mercateo.com" }]), ["operations@mercateo.com"]);
    assert.equal(two.match, null);
    assert.equal(two.candidates.length, 2);
    let searched = false;
    const none = await tryResolveCustomerByEmailDomain(
      {
        searchCustomers: async () => {
          searched = true;
          return [unite];
        },
      },
      ["max@gmail.com", "osteiling@meta-online.com"],
    );
    assert.equal(none.match, null);
    assert.equal(searched, false);
  });
});
