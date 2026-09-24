/**
 * Interne Weiterleitungen auspacken — Unit-Tests.
 *   npm run test:forward-unwrap
 */
import assert from "node:assert/strict";
import { stripForwardSubjectPrefixes, unwrapInternalForward } from "../server/emailForwardUnwrap";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ${name}: OK`);
  } catch (error) {
    failures += 1;
    console.error(`  ${name}: FAILED\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\n=== emailForwardUnwrap Unit Tests ===\n");

const DOUBLE_FORWARD = [
  "Beispielbestellung – wie besprochen",
  "",
  "VG, Justine",
  "",
  "Von: Patrick Aetzler <PAetzler@meta-online.com<mailto:PAetzler@meta-online.com>>",
  "Gesendet: Donnerstag, 27. August 2026 07:16",
  "An: META-Bestellung <bestellung@meta-online.com<mailto:bestellung@meta-online.com>>",
  "Betreff: WG: [External] Einkaufsbeleg EB26068068 für Lieferantennummer",
  "",
  "Moin,",
  "",
  "anbei eine Bestellung",
  "",
  "Von: Behnke, Stefan <SBehnke@blumenbecker.com<mailto:SBehnke@blumenbecker.com>>",
  "Gesendet: Mittwoch, 26. August 2026 15:35",
  "An: Patrick Aetzler <PAetzler@meta-online.com<mailto:PAetzler@meta-online.com>>",
  "Betreff: WG: [External] Einkaufsbeleg EB26068068 für Lieferantennummer",
  "",
  "Sehr geehrte Damen und Herren,",
  "",
  "Bitte öffnen Sie das anliegende Dokument.",
  "i.A. Stefan Behnke",
].join("\n");

check("doppelte interne Weiterleitung → ursprüngliche Kundenmail", () => {
  const r = unwrapInternalForward({
    from: '"META-Bestellung" <bestellung@meta-online.com>',
    subject: "WG: [External] Einkaufsbeleg EB26068068 für Lieferantennummer",
    body: DOUBLE_FORWARD,
  });
  assert.equal(r.strippedForwardLevels, 2);
  assert.equal(r.fromEmail, "sbehnke@blumenbecker.com");
  assert.equal(r.from, "Behnke, Stefan <SBehnke@blumenbecker.com>");
  assert.equal(r.subject, "Einkaufsbeleg EB26068068 für Lieferantennummer");
  assert.ok(r.body.startsWith("Sehr geehrte Damen und Herren"), r.body.slice(0, 40));
  assert.ok(!/Justine|Moin|PAetzler|wie besprochen/i.test(r.body), "Weiterleitungsnotizen dürfen nicht im Text bleiben");
});

check("einfache interne Weiterleitung (Roloff)", () => {
  const r = unwrapInternalForward({
    from: "META-Bestellung <bestellung@meta-online.com>",
    subject: "WG: [External] Bestellung 112608258",
    body: [
      "Beispielbestellung – wie besprochen",
      "VG, Justine",
      "",
      "Von: Roloff GmbH <cw@roloff.com<mailto:cw@roloff.com>>",
      "Gesendet: Freitag, 28. August 2026 08:19",
      "An: META-Bestellung <bestellung@meta-online.com>",
      "Betreff: [External] Bestellung 112608258",
      "",
      "Sehr geehrter Herr Willmes,",
      "hiermit übersende ich Ihnen unsere Bestellung 112608258.",
    ].join("\n"),
  });
  assert.equal(r.strippedForwardLevels, 1);
  assert.equal(r.fromEmail, "cw@roloff.com");
  assert.equal(r.subject, "Bestellung 112608258");
  assert.ok(r.body.startsWith("Sehr geehrter Herr Willmes"));
});

check("Mail direkt vom Kunden bleibt unverändert — auch wenn ER etwas weiterleitet", () => {
  const body = "Hallo,\nsiehe unten.\n\nVon: Bauleiter <bau@kunde.de>\nGesendet: Montag\nAn: Einkauf <einkauf@kunde.de>\nBetreff: Bedarf\n\n10 Regale";
  const r = unwrapInternalForward({ from: "Einkauf <einkauf@kunde.de>", subject: "WG: Bedarf", body });
  assert.equal(r.strippedForwardLevels, 0);
  assert.equal(r.body, body);
  assert.equal(r.subject, "WG: Bedarf");
});

check("interne Mail ohne Weiterleitungsblock bleibt unverändert", () => {
  const r = unwrapInternalForward({ from: "a@meta-online.com", subject: "Test", body: "Von: nur ein Satz mit Von: am Anfang" });
  assert.equal(r.strippedForwardLevels, 0);
});

check("englischer Outlook-Block", () => {
  const r = unwrapInternalForward({
    from: "orders <bestellung@meta-online.com>",
    subject: "FW: PO 4711",
    body: "fyi\n\nFrom: Jane Buyer <jane@customer.co.uk>\nSent: Monday, 1 September 2026 09:00\nTo: orders@meta-online.com\nSubject: PO 4711\n\nPlease find our purchase order attached.",
  });
  assert.equal(r.fromEmail, "jane@customer.co.uk");
  assert.equal(r.subject, "PO 4711");
  assert.ok(r.body.startsWith("Please find"));
});

check("Betreff-Präfixe", () => {
  assert.equal(stripForwardSubjectPrefixes("WG: [External] FW: Bestellung 1"), "Bestellung 1");
  assert.equal(stripForwardSubjectPrefixes("AW: Bestellung 1"), "AW: Bestellung 1");
});

if (failures > 0) {
  console.error(`\n${failures} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log("\nAlle Tests bestanden\n");
