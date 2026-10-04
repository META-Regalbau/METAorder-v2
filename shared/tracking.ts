/**
 * Sendungsnummern und Links zur Sendungsverfolgung (Versandangaben einer Bestellung).
 * Server (Mapping, Rueckschreiben nach Shopware) und Oberflaeche nutzen dieselben Regeln.
 */

/**
 * Sendungsnummern aus einer Eingabe: getrennt durch Komma, Semikolon oder Zeilenumbruch - so zeigt
 * die App mehrere Nummern an ("A, B"). Leerzeichen gehoeren zur Nummer (z. B. "JJD 0001 2345").
 * Leere und doppelte Eintraege fallen weg, die Reihenfolge bleibt.
 */
export function parseTrackingCodes(input: string | null | undefined): string[] {
  const codes: string[] = [];
  for (const part of String(input ?? "").split(/[,;\r\n]+/)) {
    const code = part.trim();
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/**
 * Link zur Sendungsverfolgung aus der Tracking-URL der Shopware-Versandart (Platzhalter %s, z. B.
 * "https://tracking.dpd.de/parcelstatus?query=%s"). Ohne Platzhalter oder ohne http(s) kein Link.
 */
export function trackingLinkFor(template: string | null | undefined, code: string): string | null {
  const t = String(template ?? "").trim();
  if (!t.includes("%s") || !/^https?:\/\//i.test(t)) return null;
  return t.split("%s").join(encodeURIComponent(code));
}

export type TrackingLink = { code: string; url: string };
