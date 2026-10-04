/**
 * OBX-Parser
 *
 * OBX-Dateien (META / OFML "cutBuffer") sind XML-Dateien mit einer Liste von
 * Artikeln (`<bskArticle>`). Pro Artikel interessiert uns:
 *  - die Artikelnummer `<artNr type="base">…</artNr>`
 *  - die Beschreibung `<text lang="de">…</text>` (nur zur Anzeige)
 *  - die Menge `<quantity count="…" />` (nur informativ)
 *
 * Es wird bewusst ein toleranter Regex-Parser verwendet (statt einer XML-Lib),
 * weil das Format flach und stabil ist und keine zusätzliche Abhängigkeit nötig sein soll.
 */

export interface ObxArticle {
  /** Artikelnummer exakt wie in der OBX-Datei (z. B. "2001364"). */
  artNr: string;
  /** Beschreibung (Langtext) – nur zur Anzeige. */
  description?: string;
  /** Menge laut OBX – nur informativ. */
  quantity?: number;
}

/** Adressblock im OBX-Header (oneTimeAddress / customerContact). */
export interface ObxAddress {
  name1?: string;
  name2?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

/**
 * Optionaler Header-Block einer OBX-Datei mit Kunden-/Lieferinfos.
 * Wird nur befüllt, wenn die Datei ein `<header>`-Element enthält
 * (META-/Export-Erweiterung, nicht in jeder OBX-Datei vorhanden).
 */
export interface ObxHeader {
  orderDate?: string;
  customerNo?: string;
  iln?: string;
  consignmentNumber?: string;
  oneTimeAddress?: ObxAddress;
  customerContact?: ObxAddress;
}

export interface ParsedObxFile {
  fileName: string;
  /** Header mit Kundeninfos, falls in der Datei vorhanden. */
  header?: ObxHeader;
  /** Alle Artikel in Reihenfolge der Datei (kann Duplikate enthalten). */
  articles: ObxArticle[];
}

const ARTICLE_BLOCK_RE = /<bskArticle\b[^>]*>([\s\S]*?)<\/bskArticle>/gi;
const ART_NR_RE = /<artNr\b[^>]*>([\s\S]*?)<\/artNr>/i;
const DESCRIPTION_TEXT_RE = /<text\b[^>]*>([\s\S]*?)<\/text>/i;
const QUANTITY_RE = /<quantity\b[^>]*\bcount\s*=\s*"([^"]*)"/i;
/** Fallback: alle artNr im Dokument, falls keine bskArticle-Blöcke vorhanden sind. */
const STANDALONE_ART_NR_RE = /<artNr\b[^>]*>([\s\S]*?)<\/artNr>/gi;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    // &amp; zuletzt, damit z. B. "&amp;lt;" nicht doppelt dekodiert wird
    .replace(/&amp;/g, "&");
}

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const decoded = decodeXmlEntities(value).replace(/\s+/g, " ").trim();
  return decoded || undefined;
}

function parseArticleBlock(block: string): ObxArticle | null {
  const artNrMatch = block.match(ART_NR_RE);
  const rawArtNr = artNrMatch ? cleanText(artNrMatch[1]) : undefined;
  if (!rawArtNr) return null;

  const descriptionMatch = block.match(DESCRIPTION_TEXT_RE);
  const description = descriptionMatch ? cleanText(descriptionMatch[1]) : undefined;

  const quantityMatch = block.match(QUANTITY_RE);
  let quantity: number | undefined;
  if (quantityMatch) {
    const parsed = Number(quantityMatch[1]);
    if (Number.isFinite(parsed)) quantity = parsed;
  }

  return { artNr: rawArtNr, description, quantity };
}

const HEADER_BLOCK_RE = /<header\b[^>]*>([\s\S]*?)<\/header>/i;
const ONE_TIME_ADDRESS_RE = /<oneTimeAddress\b[^>]*>([\s\S]*?)<\/oneTimeAddress>/i;
const CUSTOMER_CONTACT_RE = /<customerContact\b[^>]*>([\s\S]*?)<\/customerContact>/i;

/** Extrahiert den (bereinigten) Inhalt eines einfachen Tags innerhalb eines Scopes. */
function extractTag(scope: string, tagName: string): string | undefined {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = scope.match(re);
  return match ? cleanText(match[1]) : undefined;
}

function parseAddressBlock(block: string): ObxAddress | undefined {
  const address: ObxAddress = {
    name1: extractTag(block, "name1"),
    name2: extractTag(block, "name2"),
    street: extractTag(block, "street"),
    city: extractTag(block, "city"),
    postalCode: extractTag(block, "postalCode"),
    country: extractTag(block, "country"),
  };
  const hasAny = Object.values(address).some((v) => v != null && v !== "");
  return hasAny ? address : undefined;
}

/** Parst den optionalen `<header>`-Block. Liefert nur einen Header, wenn relevante Felder vorhanden sind. */
function parseHeader(content: string): ObxHeader | undefined {
  const headerMatch = content.match(HEADER_BLOCK_RE);
  if (!headerMatch) return undefined;
  const block = headerMatch[1];

  const oneTimeMatch = block.match(ONE_TIME_ADDRESS_RE);
  const contactMatch = block.match(CUSTOMER_CONTACT_RE);

  const header: ObxHeader = {
    orderDate: extractTag(block, "orderDate"),
    customerNo: extractTag(block, "customerNo"),
    iln: extractTag(block, "ILN"),
    consignmentNumber: extractTag(block, "consignmentNumber"),
    oneTimeAddress: oneTimeMatch ? parseAddressBlock(oneTimeMatch[1]) : undefined,
    customerContact: contactMatch ? parseAddressBlock(contactMatch[1]) : undefined,
  };

  const hasAny = Object.values(header).some((v) => v != null && v !== "");
  return hasAny ? header : undefined;
}

/**
 * Prüft, ob ein Header tatsächlich Kunden-/Lieferinfos enthält (für Anzeige eines Indikators).
 */
export function hasCustomerInfo(header?: ObxHeader): boolean {
  if (!header) return false;
  return Boolean(
    header.customerNo ||
      header.iln ||
      header.consignmentNumber ||
      header.oneTimeAddress ||
      header.customerContact,
  );
}

/**
 * Parst den Inhalt einer OBX-Datei und liefert die enthaltenen Artikel.
 */
export function parseObxContent(content: string, fileName: string): ParsedObxFile {
  const articles: ObxArticle[] = [];

  let blockMatch: RegExpExecArray | null;
  ARTICLE_BLOCK_RE.lastIndex = 0;
  while ((blockMatch = ARTICLE_BLOCK_RE.exec(content)) !== null) {
    const article = parseArticleBlock(blockMatch[1]);
    if (article) articles.push(article);
  }

  // Fallback: keine bskArticle-Blöcke gefunden -> direkt nach artNr-Tags suchen
  if (articles.length === 0) {
    let artNrMatch: RegExpExecArray | null;
    STANDALONE_ART_NR_RE.lastIndex = 0;
    while ((artNrMatch = STANDALONE_ART_NR_RE.exec(content)) !== null) {
      const artNr = cleanText(artNrMatch[1]);
      if (artNr) articles.push({ artNr });
    }
  }

  const header = parseHeader(content);

  return { fileName, header, articles };
}
