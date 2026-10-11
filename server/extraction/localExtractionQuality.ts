/**
 * Reicht das Ergebnis des lokalen Regel-Parsers (ohne KI), oder soll die KI extrahieren?
 *
 * Bei Mails läuft der lokale Parser zuerst. Früher galt sein Ergebnis schon als gut, wenn
 * irgendeine E-Mail-Adresse oder irgendeine Straße drinstand. Live-Befund 11.10.2026: Positionen
 * richtig (EANs), Adresse Unsinn (Straße „Hallo zusammen“, PLZ aus der EAN, Ort = halber Mailtext),
 * und die KI kam gar nicht erst dran. Jetzt muss eine vorhandene Adresse auch plausibel sein.
 */

type LocalAddress = { street?: string; zipCode?: string; city?: string } | undefined;
type LocalLine = { extractedProductNumber?: string; extractedProductName?: string; quantity?: number };

/** Plausible Postadresse: Straße mit Hausnummer, PLZ 4–5 Ziffern (nicht aus einer Artikelnummer), kurzer Ort ohne Ziffern. */
export function localAddressLooksPlausible(address: LocalAddress, lineItems: LocalLine[] = []): boolean {
  if (!address) return false;
  const street = (address.street ?? "").trim();
  const zip = (address.zipCode ?? "").trim();
  const city = (address.city ?? "").trim();

  if (street && !(/[A-Za-zÄÖÜäöüß]{3,}/.test(street) && /\d/.test(street) && street.length <= 60)) return false;
  if (zip) {
    if (!/^\d{4,5}$/.test(zip)) return false;
    const fromArticle = lineItems.some((l) =>
      [l.extractedProductNumber, l.extractedProductName].some((v) => typeof v === "string" && v.replace(/\D/g, "").includes(zip) && v.replace(/\D/g, "").length > zip.length),
    );
    if (fromArticle) return false;
  }
  if (city && (city.length > 40 || /\d/.test(city))) return false;
  return Boolean(street || zip || city);
}

const NAME_STARTS_WITH_QUANTITY_RE = /^\s*\d+([.,]\d+)?\s*(x|st|stk|stck|stück|stueck|pcs|pc|pack|ve)\b\.?/i;
const NAME_ENDS_WITH_PRICE_RE = /\s\d{1,6},\d{2}\s*(€|eur)?\s*$/i;

/**
 * Hat der Parser die Tabellenspalten nicht getrennt? „6 St 921018001 Unterlegblech … 0,33“ als Name,
 * Menge aus „1mm“ gelesen (lokaler Test 11.10.2026). Dann stimmt auch die Menge nicht.
 */
export function localLineColumnsLookMerged(lineItems: LocalLine[] = []): boolean {
  return lineItems.some((l) => {
    const name = l.extractedProductName ?? "";
    return NAME_STARTS_WITH_QUANTITY_RE.test(name) || NAME_ENDS_WITH_PRICE_RE.test(name);
  });
}

const CITY_ONLY_RE = /^[A-ZÄÖÜ][a-zäöüß]+(?:[\s-]+(?:an der|am|im|in|bei|ob der|[A-ZÄÖÜ][a-zäöüß]+\.?|\(\w+\)))*$/;

/**
 * „06354 Köthen“, „34821 Gudensberg“: PLZ + Ort aus Signatur oder Adressblock, keine Position
 * (Mercateo-Mail, Live 11.10.2026: zwei Positionen „Köthen“ mit Menge 6354). Führende Null oder
 * fünf Ziffern vor einem reinen Ortsnamen – eine Menge schreibt niemand so.
 */
export function localLineIsZipCity(line: string): boolean {
  // NFC: PDF-Text liefert Umlaute oft zerlegt („o“ + Trema)
  const m = line.normalize("NFC").trim().match(/^(?:D-|A-|CH-)?(\d{4,5})\s+(.+)$/);
  if (!m) return false;
  const [, digits, rest] = m;
  if (!(digits.startsWith("0") || digits.length === 5 || /^(?:D|A|CH)-/.test(line.trim()))) return false;
  const words = rest.trim().split(/\s+/);
  return words.length <= 4 && CITY_ONLY_RE.test(rest.trim());
}

/**
 * Enthält der Text PLZ-Ort-Zeilen (Adressblock, Signatur)? Dann stehen Adressen zwischen den
 * Positionen; Rechnungs- vs. Lieferadresse und Kundennummer trennt nur die KI sauber
 * (Mercateo: Plattform in Köthen, Lieferung nach Gudensberg, „Kundennummer 42592“).
 */
export function localTextHasZipCityLines(text: string): boolean {
  return text.split(/\r?\n/).some((line) => localLineIsZipCity(line));
}

/** Menge ab 1000 vor einem Text ohne jede Ziffer: eher PLZ/Hausnummer als Bestellmenge. */
export function localLinesHaveImplausibleQuantity(lineItems: LocalLine[] = []): boolean {
  return lineItems.some((l) => (l.quantity ?? 0) >= 1000 && !/\d/.test(l.extractedProductName ?? "") && !l.extractedProductNumber);
}

/** true: lieber die KI extrahieren lassen. */
export function isLowQualityLocalExtraction(data: {
  lineItems?: LocalLine[];
  customer?: { email?: string };
  billingAddress?: LocalAddress;
}): boolean {
  if (!data.lineItems || data.lineItems.length === 0) return true;
  if (localLineColumnsLookMerged(data.lineItems)) return true;
  if (localLinesHaveImplausibleQuantity(data.lineItems)) return true;
  const billing = data.billingAddress;
  const hasAddressFields = Boolean(billing && (billing.street || billing.zipCode || billing.city));
  // Eine erkannte, aber unsinnige Adresse wäre schlimmer als keine: dann die KI
  if (hasAddressFields && !localAddressLooksPlausible(billing, data.lineItems)) return true;
  const hasAnyEmail = Boolean(data.customer?.email);
  return !hasAnyEmail && !hasAddressFields;
}
