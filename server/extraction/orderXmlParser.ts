/**
 * Bestell-XML aus Mail-Anhängen lesen (Mercateo/Unite und andere Beschaffungsplattformen, Live 11.10.2026).
 *
 * Plattformen schicken die Bestellung zusätzlich als XML mit. Darin stehen Positionen, Mengen,
 * Preise und Adressen eindeutig – ohne KI und ohne Zeilen-Raten (Mercateo-Mailtext: „06354 Köthen“
 * wurde zur Position mit Menge 6354). Bekannte Formate:
 *  - openTRANS 1.0 (ORDER / ARTICLE_ID / SUPPLIER_AID, Parteien als BUYER_PARTY, DELIVERY_PARTY …)
 *  - openTRANS 2.x (PRODUCT_ID / SUPPLIER_PID, Parteien mit PARTY_ROLE, bmecat:-Präfixe)
 *  - cXML OrderRequest (ItemOut / SupplierPartID, ShipTo / BillTo)
 * Jeweils auch die Anfrage-Variante (openTRANS RFQ). Unbekanntes XML wird als lesbarer Text an die
 * normale Extraktion gegeben.
 *
 * Bewusst ein kleiner, toleranter Parser statt einer XML-Bibliothek (wie obxParser.ts).
 */
import type {
  DocumentExtraction,
  DocumentExtractionBuyer,
  DocumentExtractionLineItem,
} from "@shared/documentExtractionSchema";
import { EMPTY_DOCUMENT_EXTRACTION_REFERENCES } from "@shared/documentExtractionSchema";
import { repairUtf8Mojibake } from "../email/mojibake";
import {
  applyDocumentExtractionDeterministicSteps,
  applyExtractionPostValidation,
  normalizeDocumentExtractionInPlace,
  translateDocumentExtractionToLegacy,
  type LegacyExtractedDocument,
} from "./documentExtractionTranslate";

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

export type OrderXmlFormat = "opentrans" | "cxml";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Buffer → Text nach BOM bzw. encoding-Angabe der XML-Deklaration (Standard UTF-8). */
export function decodeXmlBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  const head = buffer.subarray(0, 200).toString("latin1");
  const enc = head.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "utf-8";
  let label = "utf-8";
  if (/^(iso-8859-1|latin-?1|iso-8859-15)$/.test(enc)) label = "latin1";
  else if (/^(windows|cp)-?1252$/.test(enc)) label = "windows-1252";
  // Mercateo (Live 11.10.2026): Deklaration ISO-8859-1, Inhalt UTF-8 → „RudolphstraÃ\u009fe“.
  // Gültiges UTF-8 mit Umlauten ist als Latin-1-Text praktisch ausgeschlossen, also gewinnt UTF-8.
  if (label !== "utf-8" && buffer.some((b) => b >= 0x80)) {
    try {
      return repairUtf8Mojibake(new TextDecoder("utf-8", { fatal: true }).decode(buffer)).replace(/^﻿/, "");
    } catch {
      /* echtes Latin-1 */
    }
  }
  try {
    return repairUtf8Mojibake(new TextDecoder(label).decode(buffer)).replace(/^﻿/, "");
  } catch {
    return buffer.toString("utf-8").replace(/^﻿/, "");
  }
}

function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

const TOKEN_RE =
  /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR_RE = /([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Grenzen gegen präparierte Mail-Anhänge: Bestell-XML (openTRANS/cXML) ist weit kleiner und flacher.
 * Größere Dokumente gelten nicht als Bestell-XML; tiefer verschachtelte Knoten hängen flach am letzten offenen Knoten.
 */
export const MAX_XML_CHARS = 5_000_000;
export const MAX_XML_DEPTH = 200;

/**
 * Kleiner toleranter XML-Parser: Namensraum-Präfixe fallen weg, falsch geschlossene Tags werden verziehen.
 * Laufzeit linear: Ein schließendes Tag sucht nur, wenn ein gleichnamiges Tag offen ist, und was es dabei
 * durchläuft, wird geschlossen (früher quadratisch – ein 1-MB-Anhang blockierte den Server minutenlang).
 */
export function parseXml(src: string): XmlNode | null {
  if (src.length > MAX_XML_CHARS) return null;
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  // Anzahl offener Tags je Name (ohne #root)
  const open = new Map<string, number>();
  const closeFrom = (idx: number) => {
    for (let i = idx; i < stack.length; i++) open.set(stack[i].name, (open.get(stack[i].name) ?? 1) - 1);
    stack.length = idx;
  };
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.text += m[1];
    } else if (m[3] !== undefined) {
      const name = localName(m[3]);
      if (m[2] === "/") {
        if (!open.get(name)) continue;
        let idx = stack.length - 1;
        while (idx > 0 && stack[idx].name !== name) idx--;
        if (idx > 0) closeFrom(idx);
        continue;
      }
      const attrs: Record<string, string> = {};
      let a: RegExpExecArray | null;
      ATTR_RE.lastIndex = 0;
      while ((a = ATTR_RE.exec(m[4] ?? "")) !== null) attrs[localName(a[1])] = decodeEntities(a[2] ?? a[3] ?? "");
      const node: XmlNode = { name, attrs, children: [], text: "" };
      top.children.push(node);
      if (m[5] !== "/" && stack.length <= MAX_XML_DEPTH) {
        stack.push(node);
        open.set(name, (open.get(name) ?? 0) + 1);
      }
    } else if (m[6] !== undefined) {
      top.text += decodeEntities(m[6]);
    }
  }
  return root.children.find((c) => c.name) ?? null;
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function child(node: XmlNode | null | undefined, ...names: string[]): XmlNode | null {
  if (!node) return null;
  for (const name of names) {
    const hit = node.children.find((c) => eq(c.name, name));
    if (hit) return hit;
  }
  return null;
}

function childrenNamed(node: XmlNode | null | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => eq(c.name, name)) : [];
}

function find(node: XmlNode | null | undefined, name: string): XmlNode | null {
  if (!node) return null;
  for (const c of node.children) {
    if (eq(c.name, name)) return c;
    const deep = find(c, name);
    if (deep) return deep;
  }
  return null;
}

function findAll(node: XmlNode | null | undefined, name: string, out: XmlNode[] = []): XmlNode[] {
  if (!node) return out;
  for (const c of node.children) {
    if (eq(c.name, name)) out.push(c);
    else findAll(c, name, out);
  }
  return out;
}

/** Text eines Knotens inkl. Unterknoten, Leerraum zusammengefasst. */
function textOf(node: XmlNode | null | undefined): string {
  if (!node) return "";
  const parts = [node.text, ...node.children.map(textOf)];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function str(node: XmlNode | null | undefined): string | null {
  const t = textOf(node);
  return t ? t : null;
}

/** „1.234,50“, „1234.50“, „1,5“ → Zahl */
function num(value: string | null | undefined): number | null {
  if (!value) return null;
  let s = value.replace(/[^\d,.\-]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function detectOrderXmlFormat(root: XmlNode | null): { format: OrderXmlFormat; type: "purchase_order" | "quote_request" } | null {
  if (!root) return null;
  const name = root.name.toUpperCase();
  if (name === "ORDER" && (child(root, "ORDER_ITEM_LIST") || child(root, "ORDER_HEADER"))) return { format: "opentrans", type: "purchase_order" };
  if (name === "RFQ" && (child(root, "RFQ_ITEM_LIST") || child(root, "RFQ_HEADER"))) return { format: "opentrans", type: "quote_request" };
  if (name === "CXML" && find(root, "OrderRequest")) return { format: "cxml", type: "purchase_order" };
  return null;
}

/** Schnelltest auf Buffer-Ebene (Anhangsfilter): XML-Datei mit bekanntem Bestell-Wurzelelement? */
export function looksLikeOrderXml(buffer: Buffer): boolean {
  const head = decodeXmlBuffer(buffer.subarray(0, 4000));
  return /<(?:[\w-]+:)?(ORDER|RFQ)[\s>]/.test(head) || (/<cXML[\s>]/i.test(head) && /<OrderRequest[\s>]/.test(head));
}

const NOT_AN_ORDER_ROOT_RE = /response|confirmation|invoice|rechnung|despatch|dispatch|desadv|lieferschein|catalog|bmecat/i;
const ORDER_ROOT_RE = /order|bestell|purchase|rfq|anfrage|request/i;

/**
 * Soll ein XML-Anhang ausgewertet werden? Bekannte Bestellformate ja; sonst nur, wenn das
 * Wurzelelement nach Bestellung/Anfrage aussieht (XRechnung, Lieferavis, Kataloge bleiben draußen).
 */
export function isOrderRelevantXml(buffer: Buffer): boolean {
  if (looksLikeOrderXml(buffer)) return true;
  const head = decodeXmlBuffer(buffer.subarray(0, 4000)).replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, "");
  const root = head.match(/<([A-Za-z_][\w:.-]*)/)?.[1];
  if (!root) return false;
  const name = localName(root);
  return ORDER_ROOT_RE.test(name) && !NOT_AN_ORDER_ROOT_RE.test(name);
}

export function isXmlAttachment(fileName: string, contentType: string): boolean {
  const fn = fileName.toLowerCase();
  const ct = contentType.toLowerCase();
  return fn.endsWith(".xml") || ct === "application/xml" || ct === "text/xml" || ct.endsWith("+xml");
}

// ---------------------------------------------------------------------------
// openTRANS
// ---------------------------------------------------------------------------

type PartyInfo = {
  ids: Array<{ type: string; value: string }>;
  roles: string[];
  company: string | null;
  extraNames: string[];
  contact: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
};

function readOpenTransParty(party: XmlNode): PartyInfo {
  const address = child(party, "ADDRESS");
  const names = ["NAME", "NAME2", "NAME3", "DEPARTMENT"].map((n) => str(child(address, n))).filter((v): v is string => Boolean(v));
  const contactNode = child(address, "CONTACT", "CONTACT_DETAILS");
  const contact =
    str(child(contactNode, "CONTACT_NAME")) ??
    ([str(child(contactNode, "FIRST_NAME")), str(child(contactNode, "CONTACT_SURNAME", "SURNAME"))].filter(Boolean).join(" ") || null);
  const email = str(child(address, "EMAIL")) ?? str(find(contactNode, "EMAIL")) ?? str(find(address, "EMAIL"));
  const phone = str(child(address, "PHONE")) ?? str(find(contactNode, "PHONE")) ?? str(find(address, "PHONE"));
  const street = [str(child(address, "STREET")), str(child(address, "BOXNO"))].filter(Boolean).join(" ") || null;
  return {
    ids: childrenNamed(party, "PARTY_ID").map((n) => ({ type: (n.attrs.type ?? "").toLowerCase(), value: textOf(n) })).filter((x) => x.value),
    roles: childrenNamed(party, "PARTY_ROLE").map((n) => textOf(n).toLowerCase()),
    company: names[0] ?? null,
    extraNames: names.slice(1),
    contact,
    street,
    zip: str(child(address, "ZIP")),
    city: str(child(address, "CITY")),
    country: str(child(address, "COUNTRY_CODED")) ?? str(child(address, "COUNTRY")),
    email,
    phone,
  };
}

/** Parteien nach Rolle: openTRANS 1.0 (BUYER_PARTY/…) und 2.x (PARTY_ROLE bzw. *_IDREF). */
function collectOpenTransParties(header: XmlNode | null): Record<"buyer" | "invoice" | "delivery", PartyInfo | null> {
  // 1.0: ORDER_PARTIES mit BUYER_PARTY …; 2.x: PARTIES mit PARTY_ROLE und ORDER_PARTIES_REFERENCE
  const partiesNode = find(header, "ORDER_PARTIES") ?? find(header, "PARTIES") ?? find(header, "RFQ_PARTIES");
  const out: Record<"buyer" | "invoice" | "delivery", PartyInfo | null> = { buyer: null, invoice: null, delivery: null };
  if (!partiesNode) return out;

  const wrapped: Array<[keyof typeof out, string]> = [
    ["buyer", "BUYER_PARTY"],
    ["invoice", "INVOICE_PARTY"],
    ["delivery", "DELIVERY_PARTY"],
  ];
  for (const [role, wrapper] of wrapped) {
    const party = child(find(partiesNode, wrapper), "PARTY");
    if (party) out[role] = readOpenTransParty(party);
  }

  const parties = childrenNamed(partiesNode, "PARTY").map(readOpenTransParty);
  const byId = (idref: string | null) => (idref ? parties.find((p) => p.ids.some((i) => i.value === idref)) ?? null : null);
  const refs = find(header, "ORDER_PARTIES_REFERENCE") ?? find(header, "RFQ_PARTIES_REFERENCE");
  out.buyer ??= byId(str(find(refs, "BUYER_IDREF"))) ?? parties.find((p) => p.roles.includes("buyer")) ?? null;
  out.invoice ??= byId(str(find(refs, "INVOICE_RECIPIENT_IDREF"))) ?? parties.find((p) => p.roles.includes("invoice_recipient") || p.roles.includes("invoice_issuer_buyer")) ?? null;
  out.delivery ??= byId(str(find(refs, "DELIVERY_IDREF"))) ?? parties.find((p) => p.roles.includes("delivery")) ?? null;
  return out;
}

/** Kundennummer beim Lieferanten: PARTY_ID type="supplier_specific" (bzw. „customer_number“). */
function supplierSpecificId(...parties: Array<PartyInfo | null>): string | null {
  for (const p of parties) {
    const hit = p?.ids.find((i) => /supplier_specific|customer_number/.test(i.type));
    if (hit) return hit.value;
  }
  return null;
}

function isMetaGtin(v: string | null): boolean {
  return Boolean(v && /^4026212\d{6}$/.test(v.replace(/\s/g, "")));
}

function readOpenTransItem(item: XmlNode, index: number, taxFallback: number | null): DocumentExtractionLineItem {
  const pid = child(item, "ARTICLE_ID", "PRODUCT_ID");
  const supplierNr = str(child(pid, "SUPPLIER_AID", "SUPPLIER_PID"));
  const buyerNr = str(child(pid, "BUYER_AID", "BUYER_PID"));
  const gtin =
    str(child(pid, "EAN")) ??
    str(childrenNamed(pid, "INTERNATIONAL_PID").find((n) => /gtin|ean/i.test(n.attrs.type ?? "")) ?? child(pid, "INTERNATIONAL_PID"));
  const manufacturerNr = str(child(pid, "MANUFACTURER_AID", "MANUFACTURER_PID"));
  const short = str(child(pid, "DESCRIPTION_SHORT"));
  const long = str(child(pid, "DESCRIPTION_LONG"));
  let description = short ?? long ?? "";
  if (short && long && !short.includes(long) && !long.includes(short)) description = `${short} – ${long}`;
  else if (short && long && long.length > short.length && long.includes(short)) description = long;
  description = description.slice(0, 500);

  const quantity = num(str(child(item, "QUANTITY"))) ?? 0;
  const priceNode = child(item, "ARTICLE_PRICE", "PRODUCT_PRICE_FIX");
  const priceQuantity = num(str(child(priceNode, "PRICE_QUANTITY"))) ?? 1;
  let unitPrice = num(str(child(priceNode, "PRICE_AMOUNT")));
  if (unitPrice != null && priceQuantity > 0 && priceQuantity !== 1) unitPrice = unitPrice / priceQuantity;
  const priceType = (priceNode?.attrs.type ?? "").toLowerCase();
  const tax = num(str(find(priceNode, "TAX"))) ?? taxFallback;
  if (unitPrice != null && priceType.startsWith("gros") && tax != null && tax > 0 && tax < 1) unitPrice = unitPrice / (1 + tax);
  const lineTotal = num(str(child(item, "PRICE_LINE_AMOUNT") ?? child(priceNode, "PRICE_LINE_AMOUNT")));

  const numbers = [supplierNr, gtin, manufacturerNr].filter((v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i);
  const supplierSku = isMetaGtin(gtin) ? gtin : supplierNr ?? gtin ?? null;
  const remark = str(child(item, "REMARK"));
  return {
    position: num(str(child(item, "LINE_ITEM_ID"))) ?? index + 1,
    quantity,
    unit: str(child(item, "ORDER_UNIT")) ?? "Stk",
    supplier_sku: supplierSku,
    buyer_sku: buyerNr,
    alternative_skus: numbers.filter((n) => n !== supplierSku),
    description,
    attributes: { color: null, surface: null, dimensions_raw: null, system: null },
    unit_price_net: unitPrice != null ? round2(unitPrice) : null,
    line_total_net: lineTotal != null ? round2(lineTotal) : null,
    confidence_warnings: remark ? [`Bemerkung: ${remark.slice(0, 200)}`] : [],
  };
}

/** REMARK type → Beschriftung in den Notizen ("" = ohne Präfix) */
const REMARK_LABELS: Record<string, string> = {
  order: "",
  general: "",
  delivery: "Lieferung",
  deliverynote: "Lieferschein",
  delivery_note: "Lieferschein",
  invoice: "Rechnung",
  transport: "Transport",
  packing: "Verpackung",
};

function remarksOf(node: XmlNode | null): string[] {
  return findAll(node, "REMARK")
    .map((r) => {
      const t = textOf(r);
      const label = REMARK_LABELS[(r.attrs.type ?? "").toLowerCase()];
      const type = label === undefined ? (r.attrs.type ? `${r.attrs.type}: ` : "") : label ? `${label}: ` : "";
      return t ? `${type}${t}` : "";
    })
    .filter(Boolean);
}

function emptyBuyer(): DocumentExtractionBuyer {
  return { company: null, street: null, zip: null, city: null, country: null, vat_id: null, customer_number: null, contact_person: null, email: null, phone: null };
}

function openTransToExtraction(root: XmlNode, type: "purchase_order" | "quote_request"): DocumentExtraction {
  const isRfq = type === "quote_request";
  const header = child(root, isRfq ? "RFQ_HEADER" : "ORDER_HEADER");
  const info = child(header, isRfq ? "RFQ_INFO" : "ORDER_INFO") ?? header;
  const parties = collectOpenTransParties(header);
  // Rechnungsempfänger ist der Vertragspartner (bei Mercateo/Unite die Plattform), sonst der Besteller
  const billingParty = parties.invoice ?? parties.buyer;
  const buyerParty = parties.buyer ?? parties.invoice;

  const buyer: DocumentExtractionBuyer = {
    ...emptyBuyer(),
    company: billingParty?.company ?? null,
    street: billingParty?.street ?? null,
    zip: billingParty?.zip ?? null,
    city: billingParty?.city ?? null,
    country: billingParty?.country ?? null,
    customer_number: supplierSpecificId(billingParty, buyerParty),
    contact_person: buyerParty?.contact ?? billingParty?.contact ?? null,
    email: buyerParty?.email ?? billingParty?.email ?? null,
    phone: buyerParty?.phone ?? billingParty?.phone ?? null,
  };
  const vat = str(find(header, "VAT_ID"));
  if (vat) buyer.vat_id = vat;

  const delivery = parties.delivery;
  const sameAsBuyer =
    !delivery ||
    (delivery.street === buyer.street && delivery.zip === buyer.zip && (delivery.company ?? "") === (buyer.company ?? ""));
  const deliveryDate = find(info, "DELIVERY_DATE");
  const items = findAll(child(root, isRfq ? "RFQ_ITEM_LIST" : "ORDER_ITEM_LIST"), isRfq ? "RFQ_ITEM" : "ORDER_ITEM");
  const taxFallback = num(str(find(child(root, "ORDER_SUMMARY"), "TAX")));
  const lineItems = items.map((it, i) => readOpenTransItem(it, i, taxFallback));

  const summary = child(root, isRfq ? "RFQ_SUMMARY" : "ORDER_SUMMARY");
  const totalNet = num(str(child(summary, "TOTAL_AMOUNT")));
  const notes = [
    ...remarksOf(info),
    delivery && delivery.extraNames.length ? `Lieferadresse Zusatz: ${delivery.extraNames.join(", ")}` : "",
    billingParty && billingParty.extraNames.length ? `Rechnungsadresse Zusatz: ${billingParty.extraNames.join(", ")}` : "",
  ].filter(Boolean);
  const orderId = str(find(info, isRfq ? "RFQ_ID" : "ORDER_ID"));

  return {
    document: {
      type,
      number: orderId,
      date: str(find(info, isRfq ? "RFQ_DATE" : "ORDER_DATE"))?.slice(0, 10) ?? null,
      delivery_date: (str(find(deliveryDate, "DELIVERY_END_DATE")) ?? str(find(deliveryDate, "DELIVERY_START_DATE")))?.slice(0, 10) ?? null,
      currency: str(find(info, "PRICE_CURRENCY")) ?? str(find(info, "CURRENCY")) ?? "EUR",
      total_net: totalNet,
      language: (str(find(info, "LANGUAGE")) ?? "de").slice(0, 2).toLowerCase(),
      recipient_is_meta: true,
    },
    buyer,
    delivery_address: {
      same_as_buyer: sameAsBuyer,
      company: sameAsBuyer ? null : delivery?.company ?? null,
      street: sameAsBuyer ? null : delivery?.street ?? null,
      zip: sameAsBuyer ? null : delivery?.zip ?? null,
      city: sameAsBuyer ? null : delivery?.city ?? null,
      country: sameAsBuyer ? null : delivery?.country ?? null,
      delivery_window: null,
    },
    terms: {
      incoterms: null,
      payment: str(find(info, "PAYMENT_TERMS")) ?? null,
      partial_delivery_allowed: (() => {
        const v = str(find(info, "PARTIAL_SHIPMENT_ALLOWED"))?.toLowerCase();
        return v === "true" ? true : v === "false" ? false : null;
      })(),
      notes: notes.length ? notes.join("\n").slice(0, 2000) : null,
    },
    references: {
      ...EMPTY_DOCUMENT_EXTRACTION_REFERENCES,
      customer_reference: orderId,
      supplier_offer_number: str(find(root, "QUOTATION_ID")) ?? str(find(root, "SUPPLIER_ORDER_ID")) ?? null,
      delivery_contact_name: delivery?.contact ?? (delivery?.extraNames.find((n) => !/\d/.test(n)) ?? null),
      delivery_contact_phone: delivery?.phone ?? null,
      delivery_contact_email: delivery?.email ?? null,
      invoice_email: parties.invoice?.email ?? null,
    },
    line_items: lineItems,
    extraction_meta: { overall_confidence: "high", warnings: [], calculated_total_net: null, total_matches_calculated: null },
  };
}

// ---------------------------------------------------------------------------
// cXML
// ---------------------------------------------------------------------------

function readCxmlAddress(node: XmlNode | null): PartyInfo | null {
  const address = child(node, "Address") ?? (node && eq(node.name, "Address") ? node : null);
  if (!address) return null;
  const postal = child(address, "PostalAddress");
  const deliverTo = childrenNamed(postal, "DeliverTo").map(textOf).filter(Boolean);
  const phoneNode = find(address, "TelephoneNumber");
  const phone = phoneNode
    ? [str(child(phoneNode, "CountryCode")), str(child(phoneNode, "AreaOrCityCode")), str(child(phoneNode, "Number"))].filter(Boolean).join(" ") || null
    : null;
  const countryNode = child(postal, "Country");
  return {
    ids: address.attrs.addressID ? [{ type: "address_id", value: address.attrs.addressID }] : [],
    roles: [],
    company: str(child(address, "Name")),
    extraNames: deliverTo,
    contact: deliverTo.find((d) => !/\d/.test(d)) ?? null,
    street: childrenNamed(postal, "Street").map(textOf).filter(Boolean).join(" ") || null,
    zip: str(child(postal, "PostalCode")),
    city: str(child(postal, "City")),
    country: countryNode?.attrs.isoCountryCode ?? str(countryNode),
    email: str(find(address, "Email")),
    phone,
  };
}

function cxmlToExtraction(root: XmlNode): DocumentExtraction {
  const request = find(root, "OrderRequest")!;
  const header = child(request, "OrderRequestHeader");
  const ship = readCxmlAddress(child(header, "ShipTo"));
  const bill = readCxmlAddress(child(header, "BillTo"));
  const buyerContact = childrenNamed(header, "Contact").find((c) => /buyer|purchasing|enduser/i.test(c.attrs.role ?? "")) ?? child(header, "Contact");
  const contactName = str(child(buyerContact, "Name"));
  const contactEmail = str(find(buyerContact, "Email"));
  const billing = bill ?? ship;

  const items = childrenNamed(request, "ItemOut").map((item, i): DocumentExtractionLineItem => {
    const id = child(item, "ItemID");
    const detail = child(item, "ItemDetail");
    const supplierNr = str(child(id, "SupplierPartID"));
    const aux = str(child(id, "SupplierPartAuxiliaryID"));
    const buyerNr = str(child(id, "BuyerPartID"));
    const manufacturerNr = str(child(detail, "ManufacturerPartID"));
    const descNode = child(detail, "Description");
    const shortName = str(child(descNode, "ShortName"));
    const description = (descNode ? (descNode.text.replace(/\s+/g, " ").trim() || shortName || "") : "").slice(0, 500);
    const unitPrice = num(str(find(child(detail, "UnitPrice"), "Money")));
    const quantity = num(item.attrs.quantity) ?? 0;
    const numbers = [supplierNr, manufacturerNr, aux].filter((v, k, arr): v is string => Boolean(v) && arr.indexOf(v) === k);
    return {
      position: num(item.attrs.lineNumber) ?? i + 1,
      quantity,
      unit: str(child(detail, "UnitOfMeasure")) ?? "Stk",
      supplier_sku: supplierNr,
      buyer_sku: buyerNr,
      alternative_skus: numbers.filter((n) => n !== supplierNr),
      description: description || shortName || "",
      attributes: { color: null, surface: null, dimensions_raw: null, system: null },
      unit_price_net: unitPrice != null ? round2(unitPrice) : null,
      line_total_net: unitPrice != null ? round2(unitPrice * quantity) : null,
      confidence_warnings: [],
    };
  });

  const sameAsBuyer = !ship || (ship.street === billing?.street && ship.zip === billing?.zip);
  const comments = str(child(header, "Comments"));
  return {
    document: {
      type: "purchase_order",
      number: header?.attrs.orderID ?? null,
      date: header?.attrs.orderDate?.slice(0, 10) ?? null,
      delivery_date: childrenNamed(request, "ItemOut")[0]?.attrs.requestedDeliveryDate?.slice(0, 10) ?? null,
      currency: find(child(header, "Total"), "Money")?.attrs.currency ?? "EUR",
      total_net: num(str(find(child(header, "Total"), "Money"))),
      language: "de",
      recipient_is_meta: true,
    },
    buyer: {
      ...emptyBuyer(),
      company: billing?.company ?? null,
      street: billing?.street ?? null,
      zip: billing?.zip ?? null,
      city: billing?.city ?? null,
      country: billing?.country ?? null,
      contact_person: contactName,
      email: contactEmail ?? billing?.email ?? null,
      phone: billing?.phone ?? null,
    },
    delivery_address: {
      same_as_buyer: sameAsBuyer,
      company: sameAsBuyer ? null : ship?.company ?? null,
      street: sameAsBuyer ? null : ship?.street ?? null,
      zip: sameAsBuyer ? null : ship?.zip ?? null,
      city: sameAsBuyer ? null : ship?.city ?? null,
      country: sameAsBuyer ? null : ship?.country ?? null,
      delivery_window: null,
    },
    terms: { incoterms: null, payment: null, partial_delivery_allowed: null, notes: comments ? comments.slice(0, 2000) : null },
    references: {
      ...EMPTY_DOCUMENT_EXTRACTION_REFERENCES,
      customer_reference: header?.attrs.orderID ?? null,
      delivery_contact_name: ship?.contact ?? null,
      delivery_contact_phone: ship?.phone ?? null,
      delivery_contact_email: ship?.email ?? null,
    },
    line_items: items,
    extraction_meta: { overall_confidence: "high", warnings: [], calculated_total_net: null, total_matches_calculated: null },
  };
}

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

export type ParsedOrderXml = { format: OrderXmlFormat; extraction: DocumentExtraction };

/** Bestell-XML (openTRANS / cXML) → kanonisches Extraktionsschema; null bei unbekanntem Format oder ohne Positionen. */
export function parseOrderXml(buffer: Buffer): ParsedOrderXml | null {
  let root: XmlNode | null;
  try {
    root = parseXml(decodeXmlBuffer(buffer));
  } catch {
    return null;
  }
  const detected = detectOrderXmlFormat(root);
  if (!root || !detected) return null;
  const extraction = detected.format === "cxml" ? cxmlToExtraction(root) : openTransToExtraction(root, detected.type);
  if (!extraction.line_items.length) return null;
  return { format: detected.format, extraction };
}

/**
 * Extraktoren (Bestellung/Angebot): Bestell-XML direkt übernehmen, ohne KI und ohne Zeilen-Parser.
 * null = kein bekanntes Format → normale Extraktion über den Text.
 */
export function extractLegacyFromOrderXml(buffer: Buffer): (LegacyExtractedDocument & { orderXmlFormat: OrderXmlFormat }) | null {
  const parsed = parseOrderXml(buffer);
  if (!parsed) return null;
  const { extraction } = parsed;
  normalizeDocumentExtractionInPlace(extraction);
  applyDocumentExtractionDeterministicSteps(extraction, orderXmlToReadableText(parsed));
  applyExtractionPostValidation(extraction);
  return { ...translateDocumentExtractionToLegacy(extraction), orderXmlFormat: parsed.format };
}

/** Lesbarer Text einer Bestell-XML (für Vorprüfung, Klassifikation und Anzeige). */
export function orderXmlToReadableText(parsed: ParsedOrderXml): string {
  const e = parsed.extraction;
  const addr = (a: { company?: string | null; street?: string | null; zip?: string | null; city?: string | null; country?: string | null }) =>
    [a.company, a.street, [a.zip, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
  const lines = [
    `${e.document.type === "quote_request" ? "Anfrage" : "Bestellung"} ${e.document.number ?? ""} (${parsed.format === "cxml" ? "cXML" : "openTRANS"})`.trim(),
    e.document.date ? `Datum: ${e.document.date}` : "",
    `Besteller/Rechnung: ${addr(e.buyer)}`,
    e.buyer.customer_number ? `Kundennummer: ${e.buyer.customer_number}` : "",
    e.buyer.contact_person || e.buyer.email ? `Ansprechpartner: ${[e.buyer.contact_person, e.buyer.email, e.buyer.phone].filter(Boolean).join(", ")}` : "",
    e.delivery_address.same_as_buyer ? "" : `Lieferadresse: ${addr(e.delivery_address)}`,
    e.document.delivery_date ? `Liefertermin: ${e.document.delivery_date}` : "",
    "",
    "Positionen:",
    ...e.line_items.map(
      (it) =>
        `${it.position}. ${it.quantity} ${it.unit} ${[it.supplier_sku, ...(it.alternative_skus ?? [])].filter(Boolean).join(" / ")} ${it.description}` +
        (it.unit_price_net != null ? ` à ${it.unit_price_net.toFixed(2)} ${e.document.currency}` : ""),
    ),
    e.document.total_net != null ? `Summe netto: ${e.document.total_net.toFixed(2)} ${e.document.currency}` : "",
    e.terms.notes ? `\nBemerkungen:\n${e.terms.notes}` : "",
  ];
  return lines.filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== "")).join("\n").trim();
}

/** Unbekanntes XML als „Pfad: Wert“-Zeilen, damit die normale (KI-)Extraktion etwas lesen kann. */
export function xmlToPlainText(buffer: Buffer, maxLines = 1500): string {
  const root = parseXml(decodeXmlBuffer(buffer));
  if (!root) return "";
  const out: string[] = [];
  const walk = (node: XmlNode, path: string) => {
    if (out.length >= maxLines) return;
    const here = path ? `${path}/${node.name}` : node.name;
    const attrs = Object.entries(node.attrs)
      .filter(([k]) => !/^(xmlns|schemaLocation|version)$/i.test(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    const text = node.text.replace(/\s+/g, " ").trim();
    if (text || attrs) out.push(`${here.split("/").slice(-3).join("/")}${attrs ? ` [${attrs}]` : ""}: ${text}`);
    for (const c of node.children) walk(c, here);
  };
  walk(root, "");
  return out.join("\n");
}
