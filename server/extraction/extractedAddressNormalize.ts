/**
 * Normalisiert vom LLM oft zusammengeklebte Adressen: Straße, PLZ und Ort getrennt.
 * Entfernt Adress-Reste aus lineItems (False Positives bei Produkten).
 */

export type LooseAddress = {
  firstName?: string;
  lastName?: string;
  company?: string;
  street?: string;
  zipCode?: string;
  city?: string;
  country?: string;
};

const DE_AT_CH_PLZ_LINE = /^(\d{4,5})\s+(.+)$/;
/** Straße + PLZ + Ort in einer Zeile (Komma oder Leerzeichen vor PLZ) */
const STREET_THEN_PLZ_CITY =
  /^(.*?)[,\s]+(\d{4,5})\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s\-'.()]+)$/;

/** Zeile wirkt wie „nur PLZ Ort“ */
export const PLZ_CITY_LINE_RE = /^\d{4,5}\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s\-'.()]{1,60}$/;

/** Produkt-/Positions-Signale: dann keine Adress-Heuristik */
const STRONG_PRODUCT_LINE_CUE =
  /\b(gtin|ean|art\.?\s*nr\.?|artikelnummer|stk\.?|stück|stueck|pcs\b|mm\b|cm\b|kg\b|kragarm|fachboden|querträger|quertraeger|holme?\b|regalsystem|tragkraft|traglast|paletten|lfm\b)\b|\d{8,14}/i;

function hasStreetLikeToken(text: string): boolean {
  return /(straße|strasse|str\.|street)/i.test(text);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePlzCityFromLine(line: string): { zipCode: string; city: string } | null {
  const m = line.trim().match(DE_AT_CH_PLZ_LINE);
  if (!m) return null;
  return { zipCode: m[1], city: m[2].trim() };
}

/** Aus mehreren Signatur-Zeilen die Zeile wählen, die am ehesten Straße+Hausnr. ist (nicht Firmenname). */
function pickBestStreetLine(candidates: string[]): string {
  if (candidates.length === 0) return "";
  if (candidates.length === 1) return candidates[0].trim();
  const scored = candidates.map((raw) => {
    const t = raw.trim();
    let score = 0;
    if (/\d/.test(t)) score += 2;
    if (/(straße|strasse|str\.|weg|allee|platz|ring|damm|gasse)/i.test(t)) score += 3;
    if (/@/.test(t)) score -= 4;
    if (/\b(gmbh|ag|kg|ohg|limited|ltd|e\.?\s*k\.?|ug\b|gbr)\b/i.test(t)) score -= 2;
    if (t.length > 85) score -= 1;
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  if (scored[0].score >= 2) return scored[0].t;
  return candidates.map((c) => c.trim()).filter(Boolean).join(", ");
}

/** Nur Ziffern der PLZ (LLM liefert manchmal „D-12345“) */
function canonicalPlz(z: string | undefined): string | undefined {
  if (!z) return undefined;
  const m = z.replace(/\s/g, "").match(/(\d{4,5})/);
  return m ? m[1] : undefined;
}

const COUNTRY_SUFFIX_RE =
  /,?\s*(deutschland|germany|österreich|austria|schweiz|switzerland|d\.?a\.?ch\.?)\s*$/i;

const KNOWN_COUNTRY_ALIASES: Array<{ re: RegExp; canonical: string }> = [
  { re: /^(de|deu|d\.?|deutschland|germany|bundesrepublik\s+deutschland|brd)$/i, canonical: "Deutschland" },
  { re: /^(at|aut|österreich|oesterreich|austria)$/i, canonical: "Österreich" },
  { re: /^(ch|che|schweiz|switzerland|suisse|svizzera)$/i, canonical: "Schweiz" },
  { re: /^(nl|niederlande|netherlands)$/i, canonical: "Niederlande" },
  { re: /^(be|belgien|belgium)$/i, canonical: "Belgien" },
  { re: /^(fr|frankreich|france)$/i, canonical: "Frankreich" },
  { re: /^(pl|polen|poland)$/i, canonical: "Polen" },
  { re: /^(cz|tschechien|czechia|czech\s+republic)$/i, canonical: "Tschechien" },
  { re: /^(it|italien|italy|italia)$/i, canonical: "Italien" },
  { re: /^(es|spanien|spain)$/i, canonical: "Spanien" },
  { re: /^(gb|uk|vereinigtes\s+königreich|united\s+kingdom|great\s+britain)$/i, canonical: "Vereinigtes Königreich" },
  { re: /^(us|usa|united\s+states|america)$/i, canonical: "USA" },
];

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Nur Staatsname — keine PLZ, kein Ort, keine Straße im Land-Feld.
 */
export function sanitizeCountryField(
  raw: string | undefined,
  ctx: { zipCode?: string; city?: string }
): string | undefined {
  if (!raw?.trim()) return undefined;
  let s = collapseWs(raw);
  s = s.replace(/^land\s*:\s*/i, "").trim();

  const z = ctx.zipCode?.replace(/\D/g, "").match(/(\d{4,5})/)?.[1];
  const cityNorm = ctx.city ? collapseWs(ctx.city).toLowerCase() : "";

  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(COUNTRY_SUFFIX_RE, "").trim();
    if (z) {
      s = s.replace(new RegExp(`\\b${z}\\b`, "g"), " ").trim();
      s = collapseWs(s);
    }
    if (cityNorm && cityNorm.length >= 3) {
      const reCity = new RegExp(
        `[,\s]+${cityNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "gi"
      );
      s = s.replace(reCity, " ").trim();
      s = collapseWs(s);
    }
    s = s.replace(/\b\d{4,5}\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s\-'.()]{0,55}\b/g, " ").trim();
    s = collapseWs(s);
    s = s.replace(/[,\s]*\b(plz|postleitzahl)\s*[.:]?\s*\d{4,5}\b/gi, " ").trim();
    s = collapseWs(s);
    if (s === before) break;
  }

  s = s.replace(/^[,\s\-–]+|[,\s\-–]+$/g, "").trim();
  const parts = s.split(/[,;]/).map((p) => collapseWs(p)).filter(Boolean);
  let candidate = parts.length > 0 ? parts[parts.length - 1] : s;
  candidate = collapseWs(candidate);

  for (const { re, canonical } of KNOWN_COUNTRY_ALIASES) {
    if (re.test(candidate.trim())) return canonical;
  }

  if (candidate.length > 55) return undefined;
  const digitRatio = (candidate.match(/\d/g) || []).length / Math.max(candidate.length, 1);
  if (digitRatio > 0.2 && candidate.length > 8) return undefined;
  if (/(straße|strasse|str\.|weg\s*\d|allee\s*\d)/i.test(candidate)) return undefined;

  return candidate || undefined;
}

/**
 * Konsolidiert Firmennamen zwischen Kunde und Rechnungsadresse (B2B).
 */
export function mergeCompanyCustomerAndBilling(data: {
  customer?: { company?: string };
  billingAddress?: { company?: string };
  shippingAddress?: { company?: string };
}): void {
  let c = data.customer?.company?.trim();
  let b = data.billingAddress?.company?.trim();
  if (c && !b && data.billingAddress) {
    data.billingAddress.company = c;
    b = c;
  } else if (b && !c && data.customer) {
    data.customer.company = b;
    c = b;
  }
  const co = b || c;
  if (co && data.shippingAddress && !data.shippingAddress.company?.trim()) {
    data.shippingAddress.company = co;
  }
}

/** Ort darf kein Straßenmuster enthalten (z. B. komplette Adresse fälschlich in city) */
const STREET_SHAPE_IN_TEXT =
  /\d{1,4}\s*[a-zäöüß]*\s*(straße|strasse|str\.)\b|[\wäöüß.-]+\s*(straße|strasse|str\.)\s+\d/i;

/**
 * Entfernt aus street alles, was zu PLZ/Ort gehört (auch wenn zip/city schon separat gesetzt sind).
 */
function stripZipCityFromStreetEnd(
  street: string,
  zipCode: string | undefined,
  city: string | undefined
): string {
  let s = street.replace(/\s+/g, " ").trim();
  const z = canonicalPlz(zipCode);
  const cRaw = city?.trim();
  if (!s) return s;

  if (z && cRaw) {
    const c = cRaw.replace(COUNTRY_SUFFIX_RE, "").trim();
    const zEsc = escapeRegExp(z);
    const cEsc = escapeRegExp(c);
    const patterns = [
      new RegExp(`[,\s]+${zEsc}\\s+${cEsc}\\s*$`, "i"),
      new RegExp(`[,\s]+${cEsc}\\s+${zEsc}\\s*$`, "i"),
      new RegExp(`[,\s]+${zEsc}\\s*$`, "i"),
      new RegExp(`[,\s]+${cEsc}\\s*$`, "i"),
    ];
    for (const re of patterns) {
      const next = s.replace(re, "").trim().replace(/,\s*$/, "");
      if (next !== s) s = next;
    }
    s = s.replace(COUNTRY_SUFFIX_RE, "").trim();
  } else if (z) {
    s = s
      .replace(new RegExp(`[,\s]+${escapeRegExp(z)}(?:\\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s\-'.]+)?\\s*$`, "i"), "")
      .trim()
      .replace(/,\s*$/, "");
  } else if (cRaw) {
    const c = cRaw.replace(COUNTRY_SUFFIX_RE, "").trim();
    if (c.length >= 2) {
      s = s.replace(new RegExp(`[,\s]+${escapeRegExp(c)}\\s*$`, "i"), "").trim().replace(/,\s*$/, "");
    }
  }

  const tailPlzCity = s.match(STREET_THEN_PLZ_CITY);
  if (tailPlzCity) {
    s = tailPlzCity[1].trim().replace(/,\s*$/, "");
  }

  s = s.replace(COUNTRY_SUFFIX_RE, "").trim();
  return s.replace(/\s+/g, " ").trim();
}

/** Wenn der Ortsname nochmal am Ende der Straße steht (ohne PLZ), entfernen. */
function stripTrailingCityFromStreet(street: string, city: string | undefined): string {
  if (!street || !city) return street;
  const c = city.replace(COUNTRY_SUFFIX_RE, "").trim();
  if (c.length < 4) return street;
  const re = new RegExp(`[,\s]+${escapeRegExp(c)}\\s*$`, "i");
  return street.replace(re, "").trim().replace(/,\s*$/, "");
}

/**
 * city: nur Ortsname — keine PLZ vorne, kein Land hinten, keine komplette Straße.
 */
function sanitizeCityField(
  city: string | undefined,
  zipCode: string | undefined
): string | undefined {
  if (!city) return undefined;
  let c = city.replace(/\s+/g, " ").trim();
  c = c.replace(COUNTRY_SUFFIX_RE, "").trim();

  const lead = c.match(/^(\d{4,5})\s+(.+)$/);
  if (lead) {
    const z = canonicalPlz(lead[1]);
    const rest = lead[2].trim().replace(COUNTRY_SUFFIX_RE, "").trim();
    const zKnown = canonicalPlz(zipCode);
    if (z && (!zKnown || zKnown === z)) {
      c = rest;
    }
  }

  if (STREET_SHAPE_IN_TEXT.test(c) && c.length > 35) {
    const commaParts = c.split(",").map((p) => p.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
      const last = commaParts[commaParts.length - 1];
      if (!STREET_SHAPE_IN_TEXT.test(last) && last.length <= 50) {
        c = last.replace(COUNTRY_SUFFIX_RE, "").trim();
      }
    }
  }

  return c || undefined;
}

/**
 * street: nur Straße + Hausnummer — keine zweite Adresszeile mit Ort.
 */
function sanitizeStreetField(street: string | undefined, city: string | undefined): string | undefined {
  if (!street) return undefined;
  let s = street.replace(/\s+/g, " ").trim();
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && city) {
    const cityLower = city.toLowerCase();
    const filtered = parts.filter((p) => {
      if (p.toLowerCase() === cityLower) return false;
      if (PLZ_CITY_LINE_RE.test(p)) return false;
      if (canonicalPlz(p)) return false;
      return true;
    });
    if (filtered.length > 0) {
      const joined = filtered.join(", ");
      if (joined.length < s.length) s = joined;
    }
  }
  return s || undefined;
}

/**
 * Trennt mehrzeilige Adressblöcke und „Musterstr. 1, 12345 Ort“ in street / zipCode / city.
 */
export function normalizeStructuredAddress<T extends LooseAddress>(addr: T | undefined): T | undefined {
  if (!addr) return undefined;

  let street = addr.street?.trim();
  let zipCode = addr.zipCode?.trim();
  let city = addr.city?.trim();

  zipCode = canonicalPlz(zipCode) ?? zipCode;

  if (city) {
    const cLine = city.replace(/\s+/g, " ").trim();
    const pc = parsePlzCityFromLine(cLine);
    if (pc && PLZ_CITY_LINE_RE.test(cLine)) {
      const zKnown = canonicalPlz(zipCode);
      if (!zKnown || zKnown === pc.zipCode) {
        zipCode = zipCode || pc.zipCode;
        city = pc.city;
      }
    }
  }

  if (street) {
    const lines = street.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const plzCityLines: string[] = [];
      const streetish: string[] = [];

      for (const line of lines) {
        if (/^(deutschland|germany|österreich|austria|schweiz|switzerland|d\.?a\.?ch\.?)$/i.test(line)) {
          continue;
        }
        const pc = parsePlzCityFromLine(line);
        if (pc && PLZ_CITY_LINE_RE.test(line)) {
          plzCityLines.push(line);
          continue;
        }
        streetish.push(line);
      }

      if (plzCityLines.length > 0 && (!zipCode || !city)) {
        const first = parsePlzCityFromLine(plzCityLines[0]);
        if (first) {
          zipCode = zipCode || first.zipCode;
          city = city || first.city;
        }
      }

      const joinedStreet = pickBestStreetLine(streetish);
      if (joinedStreet) {
        street = joinedStreet;
      } else if (plzCityLines.length) {
        street = undefined;
      }
    }

    const oneLine = street?.replace(/\s+/g, " ").trim() || "";
    const scm = oneLine.match(STREET_THEN_PLZ_CITY);
    if (scm) {
      const sPart = scm[1].trim().replace(/,\s*$/, "");
      const z = scm[2];
      const c = scm[3].trim().replace(COUNTRY_SUFFIX_RE, "").trim();
      if (sPart) {
        street = sPart;
        zipCode = zipCode || z;
        // Ort stammt hier aus derselben Quellzeile wie die Straße — zuverlässiger als oft vermischte LLM-Felder
        city = c;
      }
    }
  }

  zipCode = canonicalPlz(zipCode) ?? zipCode;

  if (street) {
    street = stripZipCityFromStreetEnd(street, zipCode, city);
  }

  city = sanitizeCityField(city, zipCode);

  if (street) {
    street = stripZipCityFromStreetEnd(street, zipCode, city);
    street = sanitizeStreetField(street, city);
    if (street) {
      street = stripTrailingCityFromStreet(street, city);
    }
  }

  if (street) {
    street = street.replace(COUNTRY_SUFFIX_RE, "").trim();
  }

  const countryClean = sanitizeCountryField(addr.country, { zipCode, city });

  const next = { ...addr } as T;
  if (street) (next as LooseAddress).street = street;
  else delete (next as LooseAddress).street;
  if (zipCode) (next as LooseAddress).zipCode = zipCode;
  else delete (next as LooseAddress).zipCode;
  if (city) (next as LooseAddress).city = city;
  else delete (next as LooseAddress).city;
  if (countryClean) (next as LooseAddress).country = countryClean;
  else delete (next as LooseAddress).country;

  return next;
}

/**
 * True, wenn der Text eher eine Postadresse/Signatur als ein Produkt ist.
 */
export function lineItemTextLooksLikePostalAddress(name: string): boolean {
  const n = name.replace(/\r\n/g, "\n").trim();
  if (!n) return false;
  if (STRONG_PRODUCT_LINE_CUE.test(n)) return false;

  const lines = n.split("\n").map((l) => l.trim()).filter(Boolean);
  const hasPlzCityLine = lines.some((l) => PLZ_CITY_LINE_RE.test(l));
  const streetCue = hasStreetLikeToken(n);
  const manyLines = lines.length >= 2;

  if (manyLines && hasPlzCityLine && streetCue) return true;

  const oneLine = n.replace(/\s+/g, " ").trim();
  if (STREET_THEN_PLZ_CITY.test(oneLine) && streetCue) return true;

  if (lines.length >= 3 && hasPlzCityLine) {
    const emailLines = lines.filter((l) => /@/.test(l)).length;
    const phoneish = lines.filter((l) => /^[\s+]*\+?\d[\d\s().\/-]{5,}\d\s*$/.test(l)).length;
    if (emailLines + phoneish >= 1 && streetCue) return true;
  }

  return false;
}
