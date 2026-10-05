/**
 * Zahlen, Betraege und Daten folgen der Sprache der Oberflaeche (lib/localeFormat.ts,
 * hooks/useLocaleFormat.ts). Vorher standen ~180 feste Formate im Client: "de-DE" (auf Englisch
 * "1.234,50 €"), "€{x.toFixed(2)}" (auch auf Deutsch falsch: "€1234.50"), toLocaleString() ohne
 * Sprache (Browser statt App), feste "dd.MM.yyyy"-Muster, Kalender immer englisch.
 * Statische Pruefung des Client-Codes; Ausnahmen stehen unten mit Grund.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const CLIENT = path.join(ROOT, "client/src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "examples" ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Kommentare entfernen (Zeilen bleiben), damit Beispiele in Kommentaren nicht zaehlen. */
const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, (m, p) => p + " ".repeat(m.length - p.length));

const RULES: Record<string, RegExp> = {
  "festes de-DE": /["']de-DE["']/g,
  "toLocale…() ohne Sprache (Browser statt App)": /\.toLocale(?:String|DateString|TimeString)\((?:\)|undefined)/g,
  "Intl ohne Sprache (Browser statt App)": /Intl\.(?:NumberFormat|DateTimeFormat)\((?:\)|undefined)/g,
  "festes Datumsmuster dd.MM.": /["']dd\.MM\./g,
  "date-fns fest deutsch": /locale(?::\s*|=\{)de\b/g,
  "€ vor toFixed": /€\$?\{[^}]*\.toFixed\(/g,
  "toFixed mit %/KB/MB dahinter": /\.toFixed\(\d\)\s*\}?\s*(?:%|KB|MB)/g,
  "Dezimalkomma per replace": /\.replace\(["']\.["'],\s*["'],["']\)/g,
};

/**
 * Bewusste Ausnahmen: Datei -> Regel -> erlaubte Anzahl, mit Grund.
 * - localeFormat.ts: die Formate selbst
 * - META-CLIP-Konfigurator: eigene Sprachwahl DE/EN (metaClipCpq.ts, metaClip/*)
 * - Oeffentliche Angebotsseite: fuer Kunden, Texte durchgehend deutsch
 * - Ausgleichsbetrag im Bestell-Detail: Eingabefeld mit deutschem Parser (parseGermanAmountInput)
 */
const ALLOWED: Record<string, Record<string, number>> = {
  "client/src/lib/metaClipCpq.ts": { "festes de-DE": 1 },
  "client/src/pages/metaClip/regalDimensions.ts": { "festes de-DE": 1 },
  "client/src/components/offers/OfferLandingView.tsx": { "festes de-DE": 1, "date-fns fest deutsch": 3 },
  "client/src/components/OrderDetailModal.tsx": { "festes de-DE": 1 },
};

describe("keine festen Formate im Client", () => {
  const found: string[] = [];
  for (const file of sourceFiles(CLIENT)) {
    const rel = path.relative(ROOT, file);
    if (rel === "client/src/lib/localeFormat.ts") continue;
    const src = withoutComments(fs.readFileSync(file, "utf8"));
    for (const [rule, re] of Object.entries(RULES)) {
      const count = (src.match(re) ?? []).length;
      const allowed = ALLOWED[rel]?.[rule] ?? 0;
      if (count !== allowed) found.push(`${rel}: ${rule} (${count}, erlaubt ${allowed})`);
    }
  }

  it("Funde ausserhalb der Ausnahmen", () => {
    expect(found).toEqual([]);
  });

  it("Ausnahmen sind noch noetig (sonst aus der Liste streichen)", () => {
    for (const rel of Object.keys(ALLOWED)) expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
  });
});

describe("Verdrahtung", () => {
  it("Hook und Kalender in der Sprache", () => {
    expect(fs.readFileSync(path.join(CLIENT, "hooks/useLocaleFormat.ts"), "utf8")).toContain("createLocaleFormatters(i18n.language)");
    expect(fs.readFileSync(path.join(CLIENT, "components/ui/date-picker.tsx"), "utf8")).toContain("locale={dateFnsLocale(i18n.language)}");
  });

  it("CPQ-Verwaltung (seit der Uebersetzung) und Zaehlliste formatieren in der Sprache der Oberflaeche", () => {
    for (const f of ["pages/CPQAdminPage.tsx", "pages/CPQReviewQueuePage.tsx", "components/cpq/CpqApprovalPanel.tsx", "components/cpq/DiscountTrafficLight.tsx", "components/cpq/CpqTableView.tsx", "components/cpq/CpqDetailPanel.tsx"]) {
      const src = fs.readFileSync(path.join(CLIENT, f), "utf8");
      expect(src, f).toContain("useLocaleFormat()");
      expect(src, f).not.toMatch(/createLocaleFormatters\(["']de["']\)/);
    }
    expect(fs.readFileSync(path.join(CLIENT, "lib/labels/stockCountSheet.ts"), "utf8")).toContain("createLocaleFormatters(opts.locale)");
    expect(fs.readFileSync(path.join(CLIENT, "pages/WarehousePage.tsx"), "utf8")).toContain("locale: fmt.locale,");
  });
});
