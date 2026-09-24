/**
 * Nachbearbeitung der LLM-Extraktion: META-Artikelnummern haben Vorrang.
 *
 * Beobachtung aus echten Kundenbestellungen: Die META-EAN (4026212…) steht oft NICHT in
 * der Artikelnummern-Spalte, sondern als „EAN: …", „Lieferantenartikelnummer: …" oder in
 * der Positionszeile unter der Kundennummer. Das Modell übernimmt dann die kundeneigene
 * Nummer als supplier_sku und der Katalog-Match scheitert.
 *
 * Zwei deterministische Schritte:
 *   1. Je Position: steht irgendwo in supplier_sku / buyer_sku / description /
 *      alternative_skus eine META-GTIN, wird sie supplier_sku. Verdrängte Nummern
 *      wandern nach alternative_skus (META-seitig) bzw. bleiben buyer_sku.
 *   2. Fehlt Positionen die GTIN, obwohl der Rohtext des Dokuments genau so viele
 *      META-GTINs enthält wie Positionen ohne GTIN, werden sie in Dokumentreihenfolge
 *      zugeordnet (z. B. „Lieferantenartikelnummer: 4026212223842" unter jeder Position).
 */

import type { DocumentExtraction, DocumentExtractionLineItem } from "@shared/documentExtractionSchema";

export const META_GTIN_RE = /\b(40262\d{8})\b/g;
/** META-ERP-Nummern (8–9-stellig, beginnend mit 200…) — im Shop als Herstellernummer hinterlegt. */
const META_ERP_NUMBER_RE = /\b(200\d{5,6})\b/g;

/**
 * „Ihre Artikelnummer: 20075063" — der Beleg ist vom Kunden geschrieben, „Ihre" meint META.
 * Im Shop sind diese Nummern als manufacturerNumber gepflegt und matchen zu 100 %.
 */
const YOUR_ARTICLE_NUMBER_RE =
  /Ihre\s+(?:Artikel|Art\.?|Ident|Material)[\s.-]*(?:n(?:umme)?r\.?|nr\.?)\s*:?\s*([A-Za-z0-9][\w.-]{3,20})/gi;

function findYourArticleNumbers(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(YOUR_ARTICLE_NUMBER_RE)) out.push(m[1].trim());
  return out;
}

function isMetaGtin(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^40262\d{8}$/.test(value.replace(/[\s-]/g, ""));
}

function normalizeSku(value: string): string {
  return value.replace(/[\s-]/g, "").trim();
}

function uniquePush(list: string[], value: string | null | undefined): void {
  if (!value) return;
  const v = value.trim();
  if (!v) return;
  if (!list.includes(v)) list.push(v);
}

function findGtins(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(META_GTIN_RE)) out.push(m[1]);
  return out;
}

function findErpNumbers(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(META_ERP_NUMBER_RE)) uniquePush(out, m[1]);
  return out;
}

export type SkuPriorityResult = {
  promotedFromLine: number;
  assignedFromDocument: number;
};

/**
 * Schritt 1 + 2, siehe Modulkommentar. Mutiert `extraction` in place.
 * `rawDocumentText` ist der Klartext des Belegs (PDF-Textlayer / Mailtext); bei Vision-Pfad leer.
 */
export function applyMetaSkuPriority(
  extraction: DocumentExtraction,
  rawDocumentText: string | null | undefined
): SkuPriorityResult {
  const result: SkuPriorityResult = { promotedFromLine: 0, assignedFromDocument: 0 };
  const items: DocumentExtractionLineItem[] = extraction.line_items ?? [];

  for (const item of items) {
    const alternatives: string[] = Array.isArray(item.alternative_skus) ? [...item.alternative_skus] : [];
    const supplier = item.supplier_sku?.trim() || null;
    const buyer = item.buyer_sku?.trim() || null;

    if (supplier && isMetaGtin(supplier)) {
      item.supplier_sku = normalizeSku(supplier);
    } else {
      const candidates = [
        ...findGtins(supplier),
        ...findGtins(buyer),
        ...alternatives.flatMap((a) => findGtins(a)),
        ...findGtins(item.description),
      ];
      const gtin = candidates[0];
      if (gtin) {
        if (supplier && normalizeSku(supplier) !== gtin) uniquePush(alternatives, supplier);
        item.supplier_sku = gtin;
        // Die Kundennummer bleibt buyer_sku; steckte die GTIN dort, ist das Feld frei.
        if (buyer && normalizeSku(buyer) === gtin) item.buyer_sku = null;
        result.promotedFromLine += 1;
      }
    }

    // buyer_sku darf keine META-seitige Nummer sein: 6-stellige META-Kurznummer
    // (= letzte 6 Ziffern der EAN) oder META-ERP-Nummer (2001…) → alternative_skus.
    if (item.buyer_sku) {
      const b = normalizeSku(item.buyer_sku);
      const sup = item.supplier_sku ? normalizeSku(item.supplier_sku) : "";
      const isShortOfGtin = /^\d{6}$/.test(b) && isMetaGtin(sup) && sup.endsWith(b);
      const isErp = /^200\d{5,6}$/.test(b) && isMetaGtin(sup);
      if (isShortOfGtin || isErp) {
        uniquePush(alternatives, b);
        item.buyer_sku = null;
      }
    }

    // META-ERP-Nummern („Ihre Artikelnr: 200188545") als Alternative merken.
    for (const erp of [...findErpNumbers(item.description), ...findErpNumbers(buyer), ...findErpNumbers(supplier)]) {
      if (item.supplier_sku !== erp) uniquePush(alternatives, erp);
    }
    if (alternatives.length) item.alternative_skus = alternatives;
  }

  // Schritt 1b: „Ihre Artikelnummer: X" aus dem Rohtext → X ist die META-Nummer.
  // Häufigster Modellfehler: Spaltennummer (Kundennummer) als supplier_sku, X als buyer_sku.
  const yourNumbers = findYourArticleNumbers(rawDocumentText);
  if (yourNumbers.length > 0) {
    const yourSet = new Set(yourNumbers.map(normalizeSku));
    const open = items.filter((it) => !isMetaGtin(it.supplier_sku));
    let swapped = 0;
    for (const item of open) {
      const sup = item.supplier_sku ? normalizeSku(item.supplier_sku) : "";
      const buy = item.buyer_sku ? normalizeSku(item.buyer_sku) : "";
      if (sup && yourSet.has(sup)) continue; // schon richtig
      if (buy && yourSet.has(buy)) {
        item.buyer_sku = item.supplier_sku?.trim() || null;
        item.supplier_sku = buy;
        swapped += 1;
      }
    }
    // Modell hat die Nummern ganz weggelassen: in Dokumentreihenfolge zuordnen.
    const stillOpen = open.filter((it) => {
      const sup = it.supplier_sku ? normalizeSku(it.supplier_sku) : "";
      return !yourSet.has(sup);
    });
    if (swapped === 0 && stillOpen.length === open.length && yourNumbers.length === open.length) {
      open.forEach((item, idx) => {
        const prev = item.supplier_sku?.trim();
        if (prev && !item.buyer_sku) item.buyer_sku = prev;
        item.supplier_sku = normalizeSku(yourNumbers[idx]);
        swapped += 1;
      });
    }
    result.promotedFromLine += swapped;
  }

  // Schritt 2: GTINs aus dem Rohtext den Positionen ohne GTIN zuordnen.
  const missing = items.filter((it) => !isMetaGtin(it.supplier_sku));
  if (missing.length > 0 && rawDocumentText) {
    const assigned = new Set(items.map((it) => it.supplier_sku).filter((s): s is string => isMetaGtin(s)));
    const docGtins = findGtins(rawDocumentText);
    // Bereits zugeordnete GTINs aus der Dokumentliste entfernen (je ein Vorkommen pro Position).
    const remaining: string[] = [];
    const consume = new Map<string, number>();
    for (const g of assigned) consume.set(g, (consume.get(g) ?? 0) + 1);
    for (const g of docGtins) {
      const left = consume.get(g) ?? 0;
      if (left > 0) {
        consume.set(g, left - 1);
        continue;
      }
      remaining.push(g);
    }
    const distinct = new Set(remaining);
    if (remaining.length === missing.length) {
      missing.forEach((item, idx) => {
        const prev = item.supplier_sku?.trim();
        if (prev && prev !== remaining[idx]) {
          const alts = item.alternative_skus ?? [];
          uniquePush(alts, prev);
          item.alternative_skus = alts;
        }
        item.supplier_sku = remaining[idx];
        result.assignedFromDocument += 1;
      });
    } else if (distinct.size === 1 && missing.length >= 1 && remaining.length >= missing.length) {
      // Eine einzige GTIN, mehrfach genannt (z. B. je Position wiederholt) → für alle offenen Positionen.
      const only = [...distinct][0];
      for (const item of missing) {
        const prev = item.supplier_sku?.trim();
        if (prev && prev !== only) {
          const alts = item.alternative_skus ?? [];
          uniquePush(alts, prev);
          item.alternative_skus = alts;
        }
        item.supplier_sku = only;
        result.assignedFromDocument += 1;
      }
    }
  }

  return result;
}

/** META-eigene Firmierungen — als KÄUFER bedeutet das: Lieferanten-AB / interne Bestellung. */
const META_COMPANY_RE =
  /\bmeta\b[\s-]*(regalbau|lagertechnik|online|systems?)\b|\bregalpro\b|\bmeta-regalbau\b/i;

export function isMetaCompanyName(name: string | null | undefined): boolean {
  if (!name) return false;
  return META_COMPANY_RE.test(name);
}

/** Setzt `document.buyer_is_meta` deterministisch aus buyer.company. */
export function applyBuyerIsMetaFlag(extraction: DocumentExtraction): void {
  extraction.document.buyer_is_meta = isMetaCompanyName(extraction.buyer?.company ?? null);
}

/** „11 x 4026212260977" — Komponente einer Sammelposition */
const COMPONENT_RE = /(\d{1,4})\s*[x×]\s*(40262\d{8})/g;
const SET_HINT_RE = /bestehend\s+aus|besteht\s+aus|consisting\s+of|zusammengesetzt\s+aus|set\s+aus/i;
/** Seitenkopf/-fuß, der bei Seitenumbrüchen mitten in der Komponentenliste landet */
const PAGE_FURNITURE_RE =
  /(Übertrag|^Seite\s*\d|Belegnummer|Bestelldatum|Kreditorennr|^Pos\s+Artikel|Gesamtpreis|Preis\s+EUR|Netto\s+EUR|Beschreibung\s+Menge|^Fortsetzung|Steuernummer|Unsere\s+ILN|^_+$|^\*.*\*$|^\d{5,}$|Bestellung\s*-\s*Strecke)/i;
const COMPONENT_LIST_END_RE = /(Lieferzeit|Lieferung\s*:|Bitte\s|!!!|Zahlungsbedingung|Mit\s+freundlich|Wir\s+bitten)/i;

function cleanComponentDescription(chunk: string): string {
  const endIdx = chunk.search(COMPONENT_LIST_END_RE);
  const body = endIdx >= 0 ? chunk.slice(0, endIdx) : chunk;
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !PAGE_FURNITURE_RE.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 180)
    .trim();
}

/**
 * Sammelposition auflösen: Eine Belegposition „Regalkomponenten bestehend aus: 11 x <EAN> …,
 * 8 x <EAN> …" ist fachlich eine Stückliste — bestellt werden die Komponenten in den
 * angegebenen Mengen, der Preis ist ein Pauschalpreis. Ohne Auflösung entstand EINE Position
 * mit Menge 1 auf dem ersten Artikel. Mutiert `extraction` in place; liefert Anzahl erzeugter Positionen.
 */
export function explodeComponentSets(
  extraction: DocumentExtraction,
  rawDocumentText: string | null | undefined
): number {
  if (!rawDocumentText) return 0;
  const matches = [...rawDocumentText.matchAll(COMPONENT_RE)];
  if (matches.length < 2) return 0;

  const items = extraction.line_items ?? [];
  const componentGtins = matches.map((m) => m[2]);
  const represented = items.filter((it) => it.supplier_sku && componentGtins.includes(it.supplier_sku.replace(/[\s-]/g, ""))).length;
  if (represented >= componentGtins.length) return 0; // Modell hat bereits aufgelöst

  const setItems = items.filter((it) => {
    const hay = [it.description, it.supplier_sku, it.buyer_sku, ...(it.alternative_skus ?? [])].join(" ");
    return SET_HINT_RE.test(it.description ?? "") || componentGtins.some((g) => hay.includes(g));
  });
  if (setItems.length !== 1) return 0; // nur den eindeutigen Fall automatisch behandeln
  const setItem = setItems[0];
  const setQty = typeof setItem.quantity === "number" && setItem.quantity > 0 ? setItem.quantity : 1;

  const components: DocumentExtractionLineItem[] = matches.map((m, idx) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = idx + 1 < matches.length ? matches[idx + 1].index ?? rawDocumentText.length : Math.min(rawDocumentText.length, start + 600);
    return {
      position: 0,
      quantity: Number(m[1]) * setQty,
      unit: "Stk",
      supplier_sku: m[2],
      buyer_sku: null,
      alternative_skus: [],
      description: cleanComponentDescription(rawDocumentText.slice(start, end)) || m[2],
      attributes: { color: null, surface: null, dimensions_raw: null, system: null },
      unit_price_net: null,
      line_total_net: null,
      confidence_warnings: ["set_component_no_unit_price"],
    };
  });

  const out: DocumentExtractionLineItem[] = [];
  for (const it of items) {
    if (it === setItem) out.push(...components);
    else out.push(it);
  }
  out.forEach((it, i) => (it.position = i + 1));
  extraction.line_items = out;

  const label = [setItem.buyer_sku, (setItem.description ?? "").split(/[:;]/)[0]].filter(Boolean).join(" ").trim();
  const price =
    typeof setItem.line_total_net === "number"
      ? setItem.line_total_net
      : typeof setItem.unit_price_net === "number"
        ? setItem.unit_price_net * setQty
        : null;
  const priceText = price != null ? price.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR" : "ohne Preis";
  const note = `Sammelposition „${label || "Set"}" in ${components.length} Komponenten aufgelöst — Pauschalpreis ${priceText}, keine Einzelpreise im Beleg.`;
  extraction.extraction_meta.warnings = [...(extraction.extraction_meta.warnings ?? []), note];
  extraction.terms.notes = [extraction.terms.notes, note].filter(Boolean).join("\n");
  return components.length;
}
