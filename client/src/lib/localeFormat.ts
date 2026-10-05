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

/** Date, ISO-Text oder Zeitstempel -> Date; Ungueltiges -> null */
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
  if (typeof v === "string" && v.trim()) {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type LocaleFormatters = ReturnType<typeof createLocaleFormatters>;

export function createLocaleFormatters(language?: string | null) {
  const locale = appLanguage(language);
  const currencyFmt = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const compactCurrencyFmt = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 });
  const compactNumberFmt = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const integerFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const decimalFmt = (digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const percentFmt = (digits: number) => new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits });
  const numberFmt = (maxDigits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: maxDigits });
  const percentValueFmt = (maxDigits: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: maxDigits });
  const currencyWholeFmt = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const dateFmt = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  const dateTimeFmt = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const shortDateFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "2-digit" });
  const monthYearFmt = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" });

  // Fehlender Wert (laedt noch, nicht geliefert) -> "" wie frueher bei x?.toLocaleString(); wer 0 zeigen
  // will, uebergibt `wert ?? 0`
  return {
    locale,
    /** 1234.5 -> "1.234,50 €" / "€1,234.50" / "1234,50 €" (Spanisch trennt Tausender erst ab 5 Stellen) */
    currency: (v: unknown) => (isNumber(v) ? currencyFmt.format(v) : ""),
    /** Betrag ohne Cent: 1234.5 -> "1.235 €" / "€1,235" */
    currencyWhole: (v: unknown) => (isNumber(v) ? currencyWholeFmt.format(v) : ""),
    /** Betrag in anderer Waehrung (ISO-Code, z. B. aus Shopware); unbekannter Code -> Euro */
    currencyIn: (v: unknown, currencyCode?: string | null) => {
      if (!isNumber(v)) return "";
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode || "EUR" }).format(v);
      } catch {
        return currencyFmt.format(v);
      }
    },
    /** Diagrammachse: 1234567 -> "1,2 Mio. €" / "€1.2M" / "1,2 M€" (Deutsch kuerzt Tausender nicht) */
    compactCurrency: (v: unknown) => (isNumber(v) ? compactCurrencyFmt.format(v) : ""),
    /** Diagrammachse ohne Waehrung: 12345 -> "12.345" / "12.3K" / "12,3 mil" */
    compactNumber: (v: unknown) => (isNumber(v) ? compactNumberFmt.format(v) : ""),
    /** Zahl wie toLocaleString(): bis zu maxDigits Nachkommastellen, 1234.5 -> "1.234,5" / "1,234.5" */
    number: (v: unknown, maxDigits = 3) => (isNumber(v) ? numberFmt(maxDigits).format(v) : ""),
    /** Ganze Zahl mit Tausendertrennung */
    integer: (v: unknown) => (isNumber(v) ? integerFmt.format(v) : ""),
    /** Feste Nachkommastellen, z. B. Tage: 3.25 -> "3,3" */
    decimal: (v: unknown, digits = 1) => (isNumber(v) ? decimalFmt(digits).format(v) : ""),
    /** Wert schon in Prozent (12.5) -> "12,5 %" / "12.5%"; ohne erzwungene Nachkommastellen */
    percentValue: (v: unknown, maxDigits = 2) => (isNumber(v) ? percentValueFmt(maxDigits).format(v / 100) : ""),
    /** Anteil 0..1 -> "12,3 %" / "12.3%" */
    percent: (ratio: unknown, digits = 1) => (isNumber(ratio) ? percentFmt(digits).format(ratio) : ""),
    /** Datum: "04.10.2026" / "10/04/2026" / "04/10/2026" (ersetzt feste "dd.MM.yyyy") */
    date: (v: unknown) => {
      const d = toDate(v);
      return d ? dateFmt.format(d) : "";
    },
    /** Datum mit Uhrzeit: "04.10.2026, 23:15" / "10/04/2026, 11:15 PM" */
    dateTime: (v: unknown) => {
      const d = toDate(v);
      return d ? dateTimeFmt.format(d) : "";
    },
    /** Uhrzeit: "23:15" / "11:15 PM" */
    time: (v: unknown) => {
      const d = toDate(v);
      return d ? timeFmt.format(d) : "";
    },
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
