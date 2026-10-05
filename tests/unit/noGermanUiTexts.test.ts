/**
 * Keine fest deutschen Texte in der Oberflaeche: auf Englisch/Spanisch standen u. a. Raumplaner,
 * Pruefdialoge fuer Bestell-/Angebotsentwuerfe, Notfall-Passwort-Reset, 3D-Vorschau und
 * Angebotsvorschau weiter auf Deutsch (rund 240 Stellen in 29 Dateien). Neue Texte gehoeren in die
 * Sprachdateien (t("...")); der Scanner (tests/helpers/germanUiTexts.ts) findet deutsch aussehende
 * Zeichenketten und JSX-Texte ausserhalb von t()/console.*.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { germanUiTexts } from "../helpers/germanUiTexts";

/** Bewusste Ausnahmen: Datei -> erlaubte Anzahl, mit Grund */
const ALLOWED: Record<string, number> = {
  // Kundenansicht des Angebots: fuer Kunden durchgehend deutsch, auch in der internen Vorschau
  // (die genau zeigen soll, was der Kunde sieht; vgl. noFixedFormats.test.ts)
  "components/offers/OfferLandingView.tsx": 19,
  "components/offers/CpqRegalArViewer.tsx": 4,
  "components/offers/CpqRoomArViewer.tsx": 4,
  "components/offers/OfferLineItemGlbPreview.tsx": 4,
  // oeffentliche Kundenseiten (Angebotslink, Konfigurator-Link aus dem Shop)
  "pages/PublicOfferPage.tsx": 9,
  "pages/PublicCpqConfiguratorPage.tsx": 4,
  // META-CLIP-Konfigurator: eigenes DE/EN-Textpaket nach Design, auch im Shop; Kundensuche gehoert dazu
  "pages/CPQConfiguratorPage.tsx": 37,
  "components/ShopwareCustomerSearch.tsx": 5,
  // Inhalte statt Oberflaeche: Vorlagen fuer Benachrichtigungen (mit {{...}}-Platzhaltern der Regeln)
  // und die Mahn-E-Mail an Kunden
  "components/RuleBuilderDialog.tsx": 4,
  "pages/SettingsPage.tsx": 2,
  // Erkennung einer Fehlermeldung ("nicht gefunden"), Beispieladresse, Dateiname des PDF-Downloads
  "lib/commercialUnifiedDraftUpload.ts": 1,
  "pages/B2BUsersPage.tsx": 1,
  "pages/OffersPage.tsx": 1,
};

describe("fest deutsche Texte in der Oberflaeche", () => {
  const found = germanUiTexts(path.resolve(__dirname, "../.."));
  const byFile = new Map<string, string[]>();
  for (const entry of found) byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), `${entry.line}: ${entry.text}`]);

  it("nur die bewussten Ausnahmen (neue Texte bitte ueber t() und die Sprachdateien)", () => {
    const unexpected = [...byFile].filter(([file]) => !(file in ALLOWED)).map(([file, texts]) => ({ file, texts }));
    expect(unexpected).toEqual([]);
  });

  it("Ausnahmen genau gezaehlt (weniger: Zahl senken, mehr: uebersetzen)", () => {
    const counts = Object.fromEntries(Object.keys(ALLOWED).map((file) => [file, byFile.get(file)?.length ?? 0]));
    expect(counts).toEqual(ALLOWED);
  });

  it("Scanner findet deutsche Texte (Selbsttest an einer Ausnahme)", () => {
    expect(byFile.get("pages/PublicOfferPage.tsx")?.some((t) => t.includes("Ungültiger Link."))).toBe(true);
  });
});
