/**
 * Firmenname-Heuristik – Unit-Tests.
 * Ausführung: npx tsx scripts/testCompanyNameHeuristics.ts
 */

import {
  pickCompanyFromTextSources,
  extractDomainSlugsFromTextLike,
  parsePlzCityCountryFromLine,
  parseStreetLine,
  extractPhoneNumbers,
  extractEmails,
} from "../server/companyNameHeuristics";
import { enrichExtractedDataWithCompanyHeuristic } from "../server/companyNameAgent";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}
function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

console.log("=== companyNameHeuristics Unit Tests ===\n");

// --- 1. GROHE-Footer (das konkrete Beispiel des Nutzers) ---
{
  const emailContext = `Von: Thomas Bacher
Gesendet: Montag, 16. Februar 2026 08:47
An: Pamela Köck
Betreff: [External] Angebotsanfrage AL - 2026 - 352

Hallo Frau Köck,
Können Sie uns da bitte ein Angebot zukommen lassen.
Es geht nicht im Kalkulator zu machen.
Mit freundlichen Grüßen,
Thomas Bacher

Thomas Bacher
Einkauf - Werkzeuge

+39.0474.547221
Thomas.Bacher@groheshop.com

www.groheshop.com
Grohe GmbH, J.-G.-Mahlstraße 11, I-39031 Bruneck (BZ)`;

  const r = pickCompanyFromTextSources({
    sources: [{ source: "emailContext", text: emailContext }],
  });
  assert(!!r.top, "GROHE: Top-Kandidat muss existieren");
  assertEq(r.top!.display, "Grohe GmbH", "GROHE: Top-Kandidat == 'Grohe GmbH'");
  assert(r.top!.inFooter, "GROHE: muss inFooter=true sein");
  assert(r.top!.matchesEmailDomain, "GROHE: muss matchesEmailDomain=true sein (groheshop)");
  assert(r.top!.score >= 12, `GROHE: Score sollte >= 12 sein, war ${r.top!.score}`);
  console.log("  GROHE footer + domain match: OK");
}

// --- 2. Domain-Slug-Extraktion ---
{
  const slugs = extractDomainSlugsFromTextLike(
    "Bitte an info@grohegmbh.de und thomas.bacher@groheshop.com cc max@gmail.com"
  );
  assert(slugs.includes("grohegmbh"), `domain slugs: erwarte 'grohegmbh' in ${JSON.stringify(slugs)}`);
  assert(slugs.includes("groheshop"), `domain slugs: erwarte 'groheshop' in ${JSON.stringify(slugs)}`);
  assert(!slugs.includes("gmail"), "domain slugs: generische Provider müssen rausgefiltert werden");
  console.log("  domain slug extraction (skipping generic providers): OK");
}

// --- 3. Mehrere Suffix-Treffer in einem Text: stärkster gewinnt ---
{
  const text = `Lieferadresse: Musterfirma Co. KG
Auftraggeber: ACME Industries GmbH & Co. KG, Hauptstraße 1, 12345 Berlin
Tel: 030/1234567`;
  const r = pickCompanyFromTextSources({ sources: [{ source: "doc", text }] });
  assert(!!r.top, "multi-suffix: Top-Kandidat muss existieren");
  assertEq(
    r.top!.display,
    "ACME Industries GmbH & Co. KG",
    "multi-suffix: stärkstes (zusammengesetztes) Suffix muss gewinnen"
  );
  console.log("  multi-suffix scoring (compound wins): OK");
}

// --- 4. Italienisches Suffix (S.r.l.) ---
{
  const text = `Spettabile cliente,
in allegato il preventivo richiesto.
Cordiali saluti,
Marco Bianchi
ACME Tools S.r.l., Via Roma 12, 39100 Bolzano (BZ)
info@acme-tools.it`;
  const r = pickCompanyFromTextSources({ sources: [{ source: "it", text }] });
  assert(!!r.top, "S.r.l.: Top-Kandidat muss existieren");
  assert(/ACME Tools/i.test(r.top!.display), `S.r.l.: erwarte 'ACME Tools …', war '${r.top!.display}'`);
  console.log("  Italian S.r.l. + Cordiali saluti footer: OK");
}

// --- 5. Englisches Inc. ---
{
  const text = `Best regards,
John Doe
Procurement Lead
Globex Inc., 350 Fifth Avenue, New York, NY 10118
john@globex.com`;
  const r = pickCompanyFromTextSources({ sources: [{ source: "en", text }] });
  assert(!!r.top, "Inc.: Top-Kandidat muss existieren");
  assert(/Globex Inc/i.test(r.top!.display), `Inc.: erwarte 'Globex Inc.', war '${r.top!.display}'`);
  console.log("  English Inc. + Best regards footer: OK");
}

// --- 6. META-eigene Firma im Footer wird NIE als Buyer akzeptiert ---
{
  const text = `Mit freundlichen Grüßen,
Max Mustermann
META Regalbau GmbH & Co. KG
Industriestraße 1, 59757 Arnsberg`;
  const r = pickCompanyFromTextSources({ sources: [{ source: "meta-own", text }] });
  assert(
    !r.top || !/META Regalbau/i.test(r.top.display),
    `META-Blocklist: 'META Regalbau …' darf NICHT als top zurückkommen, war ${r.top?.display}`
  );
  console.log("  META blocklist filters its own footers: OK");
}

// --- 7. Schwacher Treffer ohne Footer & ohne Domain liefert KEIN top ---
{
  const text = `Hallo, anbei eine kurze Bestellung. Bitte 5x Stk Schraube M8 liefern.`;
  const r = pickCompanyFromTextSources({ sources: [{ source: "thin", text }] });
  // weder Suffix noch Footer → kein Treffer
  assert(r.top === null, "thin text: darf keinen Top-Kandidaten haben");
  console.log("  no footer + no suffix → no candidate: OK");
}

// --- 8. Suffix mitten in Wort darf nicht matchen (Lookbehind) ---
{
  // "Lager" enthält "Ag" als Substring — darf nicht als AG matchen.
  // "Tagebuch" enthält "AG" am Wortanfang — darf nicht als AG matchen.
  const text = `Wir liefern aus dem zentralen Lager nach München.
Tagebuch der Bestellung vom 12.03.`;
  const r = pickCompanyFromTextSources({ sources: [{ source: "noise", text }] });
  assert(r.top === null, `noise text: dürfte kein Top haben, war ${r.top?.display}`);
  console.log("  substring inside words is ignored: OK");
}

// --- 9. Subagent: fill-only-Policy für die Firma (überschreibt nie) ---
{
  const extractedData: Record<string, unknown> = {
    customer: { company: "Existing GmbH" },
    billingAddress: {
      company: "Existing GmbH",
      street: "Bestehende Straße 1",
      zipCode: "10115",
      city: "Berlin",
      country: "DE",
    },
  };
  enrichExtractedDataWithCompanyHeuristic({
    extractedData,
    emailContext: `Mit freundlichen Grüßen,
Thomas Bacher
Grohe GmbH, Mahlstraße 11, 39031 Bruneck`,
  });
  const cust = extractedData.customer as Record<string, string>;
  const bill = extractedData.billingAddress as Record<string, string>;
  assertEq(cust.company, "Existing GmbH", "fill-only: customer.company unverändert");
  assertEq(bill.company, "Existing GmbH", "fill-only: billingAddress.company unverändert");
  assertEq(bill.street, "Bestehende Straße 1", "fill-only: street unverändert");
  assertEq(bill.zipCode, "10115", "fill-only: zipCode unverändert");
  assertEq(bill.city, "Berlin", "fill-only: city unverändert");
  assertEq(bill.country, "DE", "fill-only: country unverändert");
  console.log("  fill-only policy (no overwrite for already-filled fields): OK");
}

// --- 10. Subagent: leere Felder werden befüllt + Trace landet in extractedData ---
{
  const extractedData: Record<string, unknown> = {
    customer: { firstName: "Thomas", lastName: "Bacher" },
    billingAddress: { city: "Bruneck" },
  };
  const trace = enrichExtractedDataWithCompanyHeuristic({
    extractedData,
    emailContext: `Mit freundlichen Grüßen,
Thomas Bacher
Grohe GmbH, J.-G.-Mahlstraße 11, I-39031 Bruneck (BZ)
Thomas.Bacher@groheshop.com`,
    senderEmailAddress: "Thomas.Bacher@groheshop.com",
  });
  const cust = extractedData.customer as Record<string, string>;
  const bill = extractedData.billingAddress as Record<string, string>;
  assertEq(cust.company, "Grohe GmbH", "subagent fill: customer.company = 'Grohe GmbH'");
  assertEq(bill.company, "Grohe GmbH", "subagent fill: billingAddress.company = 'Grohe GmbH'");
  assertEq(bill.zipCode, "39031", "subagent fill: zipCode = '39031'");
  assertEq(bill.country, "IT", "subagent fill: country = 'IT' (aus I-Präfix)");
  assertEq(bill.city, "Bruneck", "subagent fill: city unverändert ('Bruneck')");
  assertEq(trace.applied, true, "subagent fill: applied=true");
  assert(trace.appliedTo.includes("customer.company"), "subagent fill: appliedTo enthält customer.company");
  assert(trace.appliedTo.includes("billingAddress.company"), "subagent fill: appliedTo enthält billingAddress.company");
  assert(!!(extractedData as Record<string, unknown>).companyNameHeuristic, "subagent fill: Trace gespeichert");
  console.log("  fill empty + trace persisted on extractedData: OK");
}

// --- 11. Subagent: 'n/a' wird wie leer behandelt (sanfte Aufwertung) ---
{
  const extractedData: Record<string, unknown> = {
    customer: { company: "n/a" },
    billingAddress: { company: "-" },
  };
  enrichExtractedDataWithCompanyHeuristic({
    extractedData,
    emailContext: `Mit freundlichen Grüßen,
Marco
ACME Tools S.r.l., Via Roma 12
info@acme-tools.it`,
  });
  const cust = extractedData.customer as Record<string, string>;
  const bill = extractedData.billingAddress as Record<string, string>;
  assert(/ACME Tools/i.test(cust.company), `n/a treated as empty: customer.company was '${cust.company}'`);
  assert(/ACME Tools/i.test(bill.company), `'-' treated as empty: billingAddress.company was '${bill.company}'`);
  console.log("  treats 'n/a' / '-' as empty: OK");
}

// --- 12. PDF-Footer: Impressum-Zeile mit USt-IdNr. wird erkannt ---
{
  const text = `Hirsch & Co. GmbH
Hauptstraße 1
12345 Musterstadt
www.hirsch-co.de · info@hirsch-co.de
USt-IdNr. DE123456789 · HRB 12345 Berlin · Geschäftsführer: Max Hirsch`;
  const r = pickCompanyFromTextSources({ sources: [{ source: "pdf-footer", text }] });
  assert(!!r.top, "PDF footer: Top-Kandidat muss existieren");
  assert(/Hirsch.*GmbH/i.test(r.top!.display), `PDF footer: erwarte 'Hirsch & Co. GmbH', war '${r.top!.display}'`);
  assertEq(r.address.street, "Hauptstraße 1", "PDF footer: street = 'Hauptstraße 1'");
  assertEq(r.address.zipCode, "12345", "PDF footer: zipCode = '12345'");
  assertEq(r.address.city, "Musterstadt", "PDF footer: city = 'Musterstadt'");
  assertEq(r.address.email, "info@hirsch-co.de", "PDF footer: email = 'info@hirsch-co.de'");
  console.log("  PDF footer (Impressum-Zeile + USt-IdNr.): OK");
}

// --- 13. parsePlzCityCountryFromLine: internationale Präfixe ---
{
  const it = parsePlzCityCountryFromLine("J.-G.-Mahlstraße 11, I-39031 Bruneck (BZ)");
  assert(!!it, "PLZ/Country: italienische Zeile muss parsen");
  assertEq(it!.zipCode, "39031", "PLZ/Country: zip = 39031");
  assertEq(it!.city, "Bruneck (BZ)", "PLZ/Country: city = 'Bruneck (BZ)'");
  assertEq(it!.country, "IT", "PLZ/Country: country = 'IT'");
  const at = parsePlzCityCountryFromLine("Stephansplatz 4, A-1010 Wien");
  assertEq(at!.country, "AT", "PLZ/Country: AT-Präfix");
  const de = parsePlzCityCountryFromLine("Hauptstraße 5, 12345 Berlin, Deutschland");
  assertEq(de!.country, "DE", "PLZ/Country: 'Deutschland' Fallback");
  const ch = parsePlzCityCountryFromLine("Bahnhofstrasse 1, CH-8001 Zürich");
  assertEq(ch!.country, "CH", "PLZ/Country: CH-Präfix");
  console.log("  parsePlzCityCountryFromLine (DE/AT/CH/IT): OK");
}

// --- 14. parseStreetLine: Straße + Hausnummer aus diversen Mustern ---
{
  assertEq(parseStreetLine("J.-G.-Mahlstraße 11"), "J.-G.-Mahlstraße 11", "Street: J.-G.-Mahlstraße 11");
  assertEq(parseStreetLine("Industriestr. 5a"), "Industriestr. 5a", "Street: Industriestr. 5a");
  assertEq(parseStreetLine("Via Roma 12"), "Via Roma 12", "Street: Via Roma 12");
  assertEq(parseStreetLine("Rue de la Paix 42"), "Rue de la Paix 42", "Street: Rue de la Paix 42");
  assertEq(
    parseStreetLine("Industriestraße 5, 39031 Bruneck (BZ)"),
    "Industriestraße 5",
    "Street: cut off PLZ in same line"
  );
  assert(parseStreetLine("USt-IdNr. DE123456789") === null, "Street: USt-IdNr-Zeile ist KEINE Straße");
  console.log("  parseStreetLine (multiple street markers, cut at PLZ): OK");
}

// --- 15. extractPhoneNumbers: internationale + nationale + Trenner ---
{
  const phones = extractPhoneNumbers(
    `Telefon: +49 (0) 30 12345-67
Fax: +49 30 12345-99
Mobil +43 664 1234567
Tel. 030/9876543
EAN 4026212123456`
  );
  assert(phones.some((p) => p.includes("+49")), `phones: erwarte +49-Match, war ${JSON.stringify(phones)}`);
  assert(
    phones.some((p) => p.includes("+43")),
    `phones: erwarte österreichische Mobilnummer, war ${JSON.stringify(phones)}`
  );
  assert(
    !phones.some((p) => p === "4026212123456"),
    `phones: 13-stellige EAN darf NICHT als Telefonnummer durchgehen, war ${JSON.stringify(phones)}`
  );
  console.log("  extractPhoneNumbers (intl + national, ignore EAN): OK");
}

// --- 16. extractEmails ---
{
  const emails = extractEmails("Kontakt: thomas.bacher@groheshop.com oder info@example.it");
  assert(emails.includes("thomas.bacher@groheshop.com"), "emails: thomas.bacher@groheshop.com");
  assert(emails.includes("info@example.it"), "emails: info@example.it");
  console.log("  extractEmails: OK");
}

// --- 17. GROHE Komplettblock: alle Adressfelder aus dem Footer-Beispiel ---
{
  const emailContext = `Mit freundlichen Grüßen,
Thomas Bacher

Thomas Bacher
Einkauf - Werkzeuge

+39.0474.547221
Thomas.Bacher@groheshop.com

www.groheshop.com
Grohe GmbH, J.-G.-Mahlstraße 11, I-39031 Bruneck (BZ)`;

  const extractedData: Record<string, unknown> = {};
  enrichExtractedDataWithCompanyHeuristic({
    extractedData,
    emailContext,
    senderEmailAddress: "Thomas.Bacher@groheshop.com",
  });
  const bill = extractedData.billingAddress as Record<string, string>;
  const cust = extractedData.customer as Record<string, string>;
  assertEq(bill.company, "Grohe GmbH", "GROHE-Block: company");
  assertEq(bill.street, "J.-G.-Mahlstraße 11", "GROHE-Block: street");
  assertEq(bill.zipCode, "39031", "GROHE-Block: zipCode");
  assertEq(bill.city, "Bruneck (BZ)", "GROHE-Block: city");
  assertEq(bill.country, "IT", "GROHE-Block: country");
  assertEq(cust.email, "Thomas.Bacher@groheshop.com", "GROHE-Block: email");
  assert(typeof cust.phone === "string" && cust.phone.includes("+39"), `GROHE-Block: phone enthält +39, war '${cust.phone}'`);
  // Tokens müssen für Line-Item-Schutz gesammelt sein
  const trace = (extractedData as Record<string, unknown>).companyNameHeuristic as {
    collectedAddressTokens: string[];
  };
  assert(
    trace.collectedAddressTokens.some((t) => /Mahlstraße/.test(t)),
    `tokens: erwarte Straße in collectedAddressTokens, war ${JSON.stringify(trace.collectedAddressTokens)}`
  );
  assert(
    trace.collectedAddressTokens.some((t) => /Bruneck/.test(t)),
    `tokens: erwarte 'Bruneck' in collectedAddressTokens, war ${JSON.stringify(trace.collectedAddressTokens)}`
  );
  console.log("  GROHE full address block (street, zip, city, country, phone, email): OK");
}

// --- 18. Line-Item-Schutz: identische Adress-Zeile wird aus lineItems entfernt ---
{
  // Simuliert den Pipeline-Pfad: erst Heuristik, dann
  // runCommercialExtractionNormalizeSteps mit Token-basierter Filterung.
  const { runCommercialExtractionNormalizeSteps } = await import(
    "../server/commercialExtractionOrchestrator"
  );
  const extractedData: Record<string, unknown> = {
    customer: {},
    billingAddress: {},
    lineItems: [
      { extractedProductName: "Schraube M8 verzinkt", quantity: 100 },
      { extractedProductName: "Grohe GmbH, J.-G.-Mahlstraße 11, I-39031 Bruneck (BZ)", quantity: 1 },
      { extractedProductName: "Thomas.Bacher@groheshop.com", quantity: 1 },
    ],
  };
  enrichExtractedDataWithCompanyHeuristic({
    extractedData,
    emailContext: `Mit freundlichen Grüßen,
Thomas Bacher
Grohe GmbH, J.-G.-Mahlstraße 11, I-39031 Bruneck (BZ)
Thomas.Bacher@groheshop.com`,
  });
  runCommercialExtractionNormalizeSteps(extractedData, { kind: "offer", timings: {} });
  const items = extractedData.lineItems as Array<{ extractedProductName: string }>;
  assertEq(items.length, 1, "line-item filter: nur das Produkt bleibt übrig");
  assertEq(items[0].extractedProductName, "Schraube M8 verzinkt", "line-item filter: Schraube bleibt");
  const notes = extractedData.offerNotes as string;
  assert(/Automatisch entfernt/.test(notes), "line-item filter: Notiz wurde angehängt");
  assert(/Grohe GmbH/.test(notes), "line-item filter: Adress-Zeile in Notiz");
  console.log("  line-item filter (signature tokens removed from items): OK");
}

console.log("\nAll tests passed.\n");
