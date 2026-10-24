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
  localTextHasZipCityLines,
} from "../../server/extraction/localExtractionQuality";
import { interpretTriageResponse } from "../../server/commercial/emailIntakeTriage";
import { repairUtf8Mojibake } from "../../server/email/mojibake";
import {
  EMAIL_DOMAIN_MATCH_MAX_CONFIDENCE,
  computeCustomerMatchConfidence,
  normZip,
  resolveShopwareCustomerForDraft,
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
  const unite = { id: "unite", company: "Unite Procurement Deutschland AG", email: "hanna.muster@mercateo.com", customerNumber: "20000042592" };
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

describe("Mailtext mit Adressblock geht an die KI", () => {
  it("PLZ-Ort-Zeile im Text, auch mit zerlegtem Umlaut aus PDF-Text", () => {
    assert.equal(localTextHasZipCityLines("Bestellung\n2 Packtisch 970 x 2000\nMercateo Deutschland AG\n06354 Ko\u0308then"), true);
    assert.equal(localTextHasZipCityLines("Bitte 2 Packtische liefern.\nDanke"), false);
  });
});

describe("Vorprüfung: tolerante KI-Antwort", () => {
  it("otherType null, Confidence in Prozent, lange Begründung", () => {
    const r = interpretTriageResponse(JSON.stringify({ category: "order", otherType: null, confidence: 95, reason: "x".repeat(900) }));
    assert.equal(r?.kind, "commercial");
    assert.equal(r?.confidence, 0.95);
    const o = interpretTriageResponse('{"category":"Other","otherType":"irgendwas","confidence":"0,8"}');
    assert.equal(o?.kind, "other");
    assert.equal(o?.otherType, "general");
    assert.equal(o?.confidence, 0.8);
  });
});

describe("Kundennummer aus dem Beleg trotz anderer PLZ", () => {
  it("Mercateo druckt 06354, im Shop steht 6366 Köthen: Ort entscheidet", async () => {
    assert.equal(normZip("06366"), normZip("6366"));
    const unite = { id: "unite", company: "Unite Procurement Deutschland AG", email: "hanna.muster@mercateo.com", customerNumber: "20000042592", zipCode: "6366", city: "Köthen" };
    const client = {
      findCustomerByEmail: async () => null,
      findCustomersByEmail: async () => [],
      searchCustomers: async (term: string) => (term === "42592" ? [unite] : []),
    } as never;
    const data: Record<string, any> = {
      customer: { email: "operations@mercateo.com" },
      billingAddress: { company: "Mercateo Deutschland AG", street: "Museumsgasse 4-5", zipCode: "06354", city: "Köthen", country: "DE" },
      documentExtraction: { buyer: { customer_number: "42592" } },
    };
    const id = await resolveShopwareCustomerForDraft(client, data as never, {});
    assert.equal(id, "unite");
  });
});
