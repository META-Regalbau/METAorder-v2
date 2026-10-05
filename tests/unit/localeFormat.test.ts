/**
 * Statistik: Zahlen, Betraege, Prozente und Daten in der Sprache der Oberflaeche. Vorher stand
 * "de-DE" fest im Code (auf Englisch "1.234,50 €"), Prozente per toFixed waren auch auf Deutsch
 * falsch ("12.3%"), Diagramme zeigten rohe Zahlen ("12345.678") und ISO-Daten.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appLanguage, createLocaleFormatters, dateFnsLocale } from "../../client/src/lib/localeFormat";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
/**
 * Fuer den Vergleich ohne Leerzeichen: Intl setzt geschuetzte (U+00A0, U+202F), und je nach
 * ICU-Version von Node steht mal "1,2 M€", mal "1,2 M €" (CI mit neuerem Node 24 als lokal).
 */
const plain = (s: string) => s.replace(/\s+/g, "");

describe("Formate je Sprache", () => {
  const cases = {
    de: ["1.234,50 €", "1,2 Mio. €", "12.345", "3,3", "12,3 %", "4. Okt. 26", "Okt. 2026"],
    en: ["€1,234.50", "€1.2M", "12,345", "3.3", "12.3%", "Oct 4, 26", "Oct 2026"],
    es: ["1234,50 €", "1,2 M€", "12.345", "3,3", "12,3 %", "4 oct 26", "oct 2026"],
  };
  for (const [lang, expected] of Object.entries(cases)) {
    it(lang, () => {
      const f = createLocaleFormatters(lang);
      expect(
        [f.currency(1234.5), f.compactCurrency(1234567), f.integer(12345), f.decimal(3.25), f.percent(0.123), f.shortDate("2026-10-04"), f.monthYear("2026-10")].map(plain),
      ).toEqual(expected.map(plain));
    });
  }

  it("Sprache: Region und Unbekanntes", () => {
    expect([appLanguage("en-GB"), appLanguage("ES"), appLanguage("fr"), appLanguage(undefined)]).toEqual(["en", "es", "de", "de"]);
    expect(dateFnsLocale("es").code).toBe("es");
    expect(dateFnsLocale("en").code).toBe("en-US");
  });

  it("fehlende Werte bleiben leer (wie frueher x?.toLocaleString()), 0 wird gezeigt", () => {
    const f = createLocaleFormatters("de");
    expect([f.currency(undefined), f.integer(null), f.percent(Number.NaN), f.decimal(undefined), f.compactNumber("x")]).toEqual(["", "", "", "", ""]);
    expect(plain(f.currency(0))).toBe("0,00€");
    expect(f.integer(0)).toBe("0");
  });

  it("unbekannte Datumsformate bleiben stehen", () => {
    const f = createLocaleFormatters("en");
    expect(f.shortDate("KW 40")).toBe("KW 40");
    expect(f.monthYear("2026-Q3")).toBe("2026-Q3");
  });
});

describe("Statistik-Seite nutzt die Sprache", () => {
  const page = read("client/src/pages/AnalyticsPage.tsx");
  const code = page.replace(/^\s*\/\/.*$/gm, "");

  it("kein festes Deutsch mehr", () => {
    expect(code).not.toContain('"de-DE"');
    expect(code).not.toMatch(/\.toFixed\(/);
    expect(code).not.toMatch(/locale[:=]\s*\{?\s*de\b/);
    expect(code).not.toContain('from "date-fns/locale"');
    expect(code).toContain("createLocaleFormatters(i18n.language)");
    expect(code).toContain("dateFnsLocale(i18n.language)");
  });

  it("alle Diagramme formatieren Achsen und Tooltips", () => {
    expect(code).not.toMatch(/<Tooltip\s*\/>/);
    expect(code).not.toMatch(/<YAxis(\s+allowDecimals=\{false\})?\s*\/>/);
    expect(code).toContain('<XAxis dataKey="date" tickFormatter={fmt.shortDate} />');
    expect(code).toContain('formatter={(v, _name, item) => (item?.dataKey === "revenue" ? fmt.currency(v) : fmt.integer(v))}');
    expect(code).toContain("<YAxis tickFormatter={fmt.compactCurrency}");
  });

  it("Prozent-Platzhalter ohne eigenes %-Zeichen (kommt aus dem Format)", () => {
    for (const lang of ["de", "en", "es"]) {
      const text = JSON.parse(read(`client/src/i18n/locales/${lang}.json`)).analytics.offerAcceptedShareAll as string;
      expect(text, lang).toMatch(/^\{\{pct\}\} /);
    }
    expect(code).toContain("pct: fmt.percent(offerKpiTotals.acceptedOfAllRate)");
  });

  it("Lern-Insights bekommen die Sprache", () => {
    expect(code).toContain("learningInsightPairStats(t, pair, i18n.language, insight.insightType)");
  });
});
