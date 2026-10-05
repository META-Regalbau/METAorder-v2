import { de, enUS, es, type Locale } from "date-fns/locale";

/**
 * Zahlen, Betraege, Prozente und Datumsangaben in der Sprache der Oberflaeche (de/en/es).
 * Vorher stand in der Statistik "de-DE" fest im Code: auf Englisch "1.234,56 €" statt "€1,234.56";
 * Prozente per toFixed waren dafuer auch auf Deutsch falsch ("12.3%" statt "12,3 %").
 * Waehrung bleibt Euro - nur die Schreibweise folgt der Sprache.
 */
const SUPPORTED = ["de", "en", "es"] as const;
type AppLanguage = (typeof SUPPORTED)[number];

/** "en-GB", "de" oder unbekannt -> eine der App-Sprachen (Standard Deutsch) */
export function appLanguage(language?: string | null): AppLanguage {
  const base = String(language || "").toLowerCase().split("-")[0];
  return (SUPPORTED as readonly string[]).includes(base) ? (base as AppLanguage) : "de";
}

const DATE_FNS_LOCALES: Record<AppLanguage, Locale> = { de, en: enUS, es };

/** date-fns-Locale fuer format(..., { locale }) und den Kalender */
export function dateFnsLocale(language?: string | null): Locale {
  return DATE_FNS_LOCALES[appLanguage(language)];
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type LocaleFormatters = ReturnType<typeof createLocaleFormatters>;

export function createLocaleFormatters(language?: string | null) {
  const locale = appLanguage(language);
  const currencyFmt = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const compactCurrencyFmt = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 });
  const compactNumberFmt = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const integerFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const decimalFmt = (digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const percentFmt = (digits: number) => new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits });
  const shortDateFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "2-digit" });
  const monthYearFmt = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" });

  // Fehlender Wert (laedt noch, nicht geliefert) -> "" wie frueher bei x?.toLocaleString(); wer 0 zeigen
  // will, uebergibt `wert ?? 0`
  return {
    locale,
    /** 1234.5 -> "1.234,50 €" / "€1,234.50" / "1234,50 €" (Spanisch trennt Tausender erst ab 5 Stellen) */
    currency: (v: unknown) => (isNumber(v) ? currencyFmt.format(v) : ""),
    /** Diagrammachse: 1234567 -> "1,2 Mio. €" / "€1.2M" / "1,2 M€" (Deutsch kuerzt Tausender nicht) */
    compactCurrency: (v: unknown) => (isNumber(v) ? compactCurrencyFmt.format(v) : ""),
    /** Diagrammachse ohne Waehrung: 12345 -> "12.345" / "12.3K" / "12,3 mil" */
    compactNumber: (v: unknown) => (isNumber(v) ? compactNumberFmt.format(v) : ""),
    /** Ganze Zahl mit Tausendertrennung */
    integer: (v: unknown) => (isNumber(v) ? integerFmt.format(v) : ""),
    /** Feste Nachkommastellen, z. B. Tage: 3.25 -> "3,3" */
    decimal: (v: unknown, digits = 1) => (isNumber(v) ? decimalFmt(digits).format(v) : ""),
    /** Anteil 0..1 -> "12,3 %" / "12.3%" */
    percent: (ratio: unknown, digits = 1) => (isNumber(ratio) ? percentFmt(digits).format(ratio) : ""),
    /** "2026-10-04" -> "4. Okt. 26" / "Oct 4, 26" / "4 oct 26"; unbekanntes Format bleibt */
    shortDate: (isoDate: string) => {
      // nur ISO-Daten: new Date() liest sonst auch "KW 40" (als Jahr 40)
      if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(isoDate)) return isoDate;
      const d = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00` : isoDate);
      return Number.isNaN(d.getTime()) ? isoDate : shortDateFmt.format(d);
    },
    /** "2026-10" -> "Okt. 2026" / "Oct 2026" / "oct 2026"; unbekanntes Format bleibt */
    monthYear: (yearMonth: string) => {
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) return yearMonth;
      const d = new Date(`${yearMonth}-01T00:00:00`);
      return Number.isNaN(d.getTime()) ? yearMonth : monthYearFmt.format(d);
    },
  };
}
