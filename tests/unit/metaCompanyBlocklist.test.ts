/**
 * META-Blockliste – Unit-Tests.
 * Ausführung: npm test
 */
import { describe, it } from "vitest";
import { isMetaOwnCompany, META_OWN_COMPANY_NAMES } from "../../server/commercial/metaCompanyBlocklist";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

// Aus scripts/testMetaCompanyBlocklist.ts uebernommen: Pruefungen unveraendert, je Pruefung ein Vitest-Fall.
describe("MetaCompanyBlocklist", () => {
  it("triviale Falsy-Eingaben", () => {
    assert(isMetaOwnCompany("") === false, "empty string → not META");
    assert(isMetaOwnCompany("   ") === false, "whitespace → not META");
    assert(isMetaOwnCompany(null) === false, "null → not META");
    assert(isMetaOwnCompany(undefined) === false, "undefined → not META");
  });

  it("Treffer in verschiedenen Schreibweisen (Groß/klein, Leerzeichen, Zusätze)", () => {
    for (const variant of [
      "META Regalbau",
      "META  Regalbau", // doppeltes Leerzeichen
      "META Regalbau GmbH & Co. KG",
      "META-Regalbau",
      "META-Regalbau, RegalPro",
      "META Lagertechnik",
      "META Lagertechnik Ges.m.b.H.",
      "Meta Lagertechnik", // lowercase variant
      "META  Online",
      "META Online GmbH & Co. KG",
      "META Shop", // nicht offiziell, aber sicherheitshalber
      "RegalPro",
      "regalpro", // lowercase
      "Meta Regalbau GmbH",
    ]) {
      assert(isMetaOwnCompany(variant) === true, `should block: ${variant}`);
    }
  });

  it("Schutz vor Fehltreffern: echte Kunden werden nicht geblockt", () => {
    for (const real of [
      "META Mustermann GmbH",     // generischer META-Kundenname
      "Metaplast GmbH",           // META kein Whitespace dahinter
      "Metaland AG",
      "Beta Regalbau GmbH",       // nicht META
      "Regalbau Müller",          // ohne META-Prefix
      "Online Shop Müller",       // ohne META-Prefix
      "Lagertechnik Hansen",      // ohne META-Prefix
      "META Industrieservice",    // kein bekanntes Suffix
      "META Holding",             // kein bekanntes Suffix
      "Musterfirma GmbH",
      "PRO Regal AG",             // RegalPro umgekehrt — kein Match
      "Pro-Regal GmbH",           // ähnlich, aber nicht RegalPro
    ]) {
      assert(isMetaOwnCompany(real) === false, `should NOT block real customer: ${real}`);
    }
  });

  it("Trim und gemischte Groß-/Kleinschreibung", () => {
    assert(isMetaOwnCompany("  META Lagertechnik  ") === true, "trimmed match");
    assert(isMetaOwnCompany("meta-regalbau") === true, "lowercase hyphen variant");
    assert(isMetaOwnCompany("MeTa  ReGaLbAu") === true, "mixed-case match");
  });

  it("Anzeige-Konstante deckt die wichtigsten Firmen ab", () => {
    for (const name of META_OWN_COMPANY_NAMES) {
      assert(isMetaOwnCompany(name) === true, `display name should match own regex: ${name}`);
    }
  });
});
