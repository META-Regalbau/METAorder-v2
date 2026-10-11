/**
 * Stückliste im Positionstext auflösen (Entscheidung 11.10.2026, nach „Angebot nachschlagen“).
 *
 * Händler bestellen konfigurierte Anlagen als EINE Position mit Gesamtpreis und Stückliste im Text
 * (Steinke: „… Konfiguriertes Zubehör: 5x Gitterrostboden …; Zubehör: 3x U-Rammschutz …;
 * Stückliste: 3x Ständer 120/20 4400x800 …; 20x Holm 4HS 140/15x2700 RAL 2001“). Gibt es das Angebot
 * nicht in Shopware, zerlegt die KI den Text in Einzelteile; jedes Teil wird eine eigene Position, die
 * der KI-Abgleich (draftLineAiMatch) Katalogartikeln zuordnet. Danach wird der Gesamtpreis der
 * Originalposition anteilig nach Katalogpreis auf die Teile verteilt – nur wenn alle Teile einen
 * Vorschlag haben. Alles bleibt Vorschlag (status „uncertain“), die Automatik legt nichts an.
 */
import { z } from "zod";
import type { Product } from "@shared/schema";
import type { LineItemMatch, MatchingResult } from "../products/productMatcher";
import { parseLlmJsonResponse } from "../ai/llmChat";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/draftBomSplit" });

const MAX_COMPONENTS = 40;

type Line = {
  extractedProductName: string;
  extractedProductNumber?: string;
  extractedPositionNumber?: string;
  quantity: number;
  extractedPrice?: number;
};

export type DraftBomSplitEntry = {
  /** Positionsnummer der Originalzeile (1-basiert) */
  originalPosition: number;
  originalLine: Line;
  componentCount: number;
  /** Gesamtpreis der Originalposition netto (Stückpreis × Menge) */
  totalNet: number | null;
  /** Preis auf die Teile verteilt (alle Teile hatten einen Vorschlag mit Katalogpreis) */
  priceDistributed: boolean;
  /** Indizes der Teile in lineItems */
  componentIndices: number[];
};

const ITEM_COUNT_RE = /(?:^|[;:,.]\s*|\s)(\d{1,4})\s*[x×]\s+[A-Za-zÄÖÜäöü]/g;
const BOM_KEYWORD_RE = /\b(stückliste|stueckliste|zubehör|zubehoer|bestehend aus|bom|parts list)\b/i;

/** Enthält der Positionstext eine Stückliste? (Schlüsselwort und mind. 2 Mengenangaben, oder mind. 4) */
export function lineLooksLikeBom(text: string): boolean {
  const counts = [...(text || "").matchAll(ITEM_COUNT_RE)].length;
  return (BOM_KEYWORD_RE.test(text) && counts >= 2) || counts >= 4;
}

const componentsSchema = z.object({
  components: z
    .array(
      z.object({
        quantity: z.number().positive(),
        description: z.string().min(2).max(300),
      }),
    )
    .max(MAX_COMPONENTS),
});

export type BomLlm = (system: string, user: string) => Promise<string>;

const BOM_SYSTEM = `Du zerlegst eine Bestellposition für eine konfigurierte Regalanlage in ihre Einzelteile.
Liste nur körperliche Teile mit Stückzahl auf (Ständer, Holme, Böden, Gitterroste, Rückwandgitter, Befestigungssets, Rammschutz, Unterlegbleche usw.).
Keine Kenngrößen wie Gesamthöhe, Anzahl Felder, Fachlast, Flächenpressung.
Gleiche Teile aus mehreren Abschnitten zusammenzählen (z. B. „Abschnitt 1: 5x Gitterrost …“ und „Abschnitt 2: 5x Gitterrost …“ = 10).
Die Stückzahlen gelten für EINE Anlage. Beschreibung so übernehmen, wie sie im Text steht (mit Maßen, Farbe, Oberfläche).
Antworte NUR mit JSON, ohne Text davor oder danach: {"components":[{"quantity":3,"description":"Ständer 120/20 4400x800 vzk kpl. multipal S"}]}`;

/**
 * Zerlegt Stücklisten-Positionen (in place: lineItems, matchingResults.items, extractedData.bomSplit).
 * Nur Positionen ohne sicheren Treffer. Gibt die aufgelösten Gruppen zurück.
 */
export async function splitBomLines(params: {
  extractedData: Record<string, unknown>;
  matchingResults: MatchingResult | null;
  llm: BomLlm | null;
}): Promise<DraftBomSplitEntry[]> {
  const { extractedData, matchingResults, llm } = params;
  const lines = (extractedData.lineItems as Line[] | undefined) ?? [];
  if (!llm || !matchingResults?.items?.length || lines.length !== matchingResults.items.length) return [];

  const candidates = lines
    .map((line, index) => ({ line, index, item: matchingResults.items[index] }))
    .filter(({ line, item }) => !(item.status === "matched" && item.confidence >= 90) && !item.catalogMatchSkipped && lineLooksLikeBom(line.extractedProductName));
  if (!candidates.length) return [];

  const replacements = new Map<number, { lines: Line[]; entry: Omit<DraftBomSplitEntry, "componentIndices"> }>();
  for (const { line, index } of candidates) {
    let components: Array<{ quantity: number; description: string }> = [];
    try {
      const raw = await llm(BOM_SYSTEM, `Bestellmenge: ${line.quantity}\nPositionstext:\n${line.extractedProductName.slice(0, 6000)}`);
      const parsed = componentsSchema.safeParse(parseLlmJsonResponse(raw));
      components = parsed.success ? parsed.data.components : [];
      if (!parsed.success) log.warn({ index, rawSnippet: String(raw ?? "").slice(0, 400) }, "[DraftBomSplit] KI-Antwort unbrauchbar");
    } catch (err) {
      log.warn({ err, index }, "[DraftBomSplit] Stückliste nicht zerlegt");
    }
    if (components.length < 2) continue;
    const factor = line.quantity > 0 ? line.quantity : 1;
    replacements.set(index, {
      lines: components.map((c, k) => ({
        extractedProductName: c.description.trim(),
        extractedPositionNumber: `${line.extractedPositionNumber ?? index + 1}.${k + 1}`,
        quantity: Math.round(c.quantity * factor * 1000) / 1000,
      })),
      entry: {
        originalPosition: index + 1,
        originalLine: { ...line },
        componentCount: components.length,
        totalNet: typeof line.extractedPrice === "number" ? Math.round(line.extractedPrice * factor * 100) / 100 : null,
        priceDistributed: false,
      },
    });
  }
  if (!replacements.size) return [];

  const newLines: Line[] = [];
  const newItems: LineItemMatch[] = [];
  const entries: DraftBomSplitEntry[] = [];
  lines.forEach((line, index) => {
    const rep = replacements.get(index);
    if (!rep) {
      newLines.push(line);
      newItems.push(matchingResults.items[index]);
      return;
    }
    const componentIndices: number[] = [];
    for (const component of rep.lines) {
      componentIndices.push(newLines.length);
      newLines.push(component);
      newItems.push({ extractedProductName: component.extractedProductName, extractedPositionNumber: component.extractedPositionNumber, quantity: component.quantity, confidence: 0, status: "not_found" });
    }
    entries.push({ ...rep.entry, componentIndices });
  });

  extractedData.lineItems = newLines;
  extractedData.lineItemPlausibility = newLines.map((_, i) => ({ index: i, skipCatalogMatching: false, quantityWasZero: false }));
  matchingResults.items = newItems;
  extractedData.bomSplit = entries;
  log.info(
    { event: "draft_bom_split", groups: entries.length, components: entries.reduce((s, e) => s + e.componentCount, 0) },
    `[DraftBomSplit] ${entries.length} Stückliste(n) in ${entries.reduce((s, e) => s + e.componentCount, 0)} Teile zerlegt`,
  );
  return entries;
}

/**
 * Nach dem KI-Abgleich: Gesamtpreis der Originalposition anteilig nach Katalogpreis auf die Teile.
 * Nur wenn jedes Teil einen Vorschlag mit Katalogpreis hat; sonst bleibt der Preis offen.
 */
export function distributeBomPrices(params: {
  extractedData: Record<string, unknown>;
  matchingResults: MatchingResult | null;
  netPriceOf: (productId: string) => number | null;
}): void {
  const entries = params.extractedData.bomSplit as DraftBomSplitEntry[] | undefined;
  const items = params.matchingResults?.items;
  const lines = params.extractedData.lineItems as Line[] | undefined;
  if (!entries?.length || !items || !lines) return;
  for (const entry of entries) {
    if (entry.totalNet == null || entry.totalNet <= 0) continue;
    const parts = entry.componentIndices.map((i) => {
      const product = items[i]?.matchedProduct;
      return { i, product, net: product ? params.netPriceOf(product.id) : null };
    });
    if (parts.some((p) => !p.product || p.net == null || p.net <= 0)) continue;
    const catalogSum = parts.reduce((s, p) => s + p.net! * (items[p.i].quantity || 0), 0);
    if (catalogSum <= 0) continue;
    const factor = entry.totalNet / catalogSum;
    for (const p of parts) {
      const unit = Math.round(p.net! * factor * 100) / 100;
      Object.assign(p.product!, { manualUnitPriceNet: unit, manualPriceChangedBy: `Bestellposition ${entry.originalPosition}` });
      lines[p.i] = { ...lines[p.i], extractedPrice: unit };
    }
    entry.priceDistributed = true;
  }
}

/** Pipeline: Stücklisten zerlegen (vor dem KI-Abgleich). */
export async function runDraftBomSplitStep(params: {
  storage: { getSetting: (key: string) => Promise<any> };
  enabled: boolean;
  aiMode: string;
  extractedData: Record<string, unknown>;
  matchingResults: MatchingResult | null;
}): Promise<DraftBomSplitEntry[]> {
  if (!params.enabled || params.aiMode === "local_only") return [];
  const lines = (params.extractedData.lineItems as Line[] | undefined) ?? [];
  if (!lines.some((l) => lineLooksLikeBom(l.extractedProductName))) return [];
  try {
    const { chatCompletion, isChatLlmConfigured } = await import("../ai/llmChat");
    const getSetting = params.storage.getSetting.bind(params.storage);
    if (!(await isChatLlmConfigured(getSetting))) return [];
    const llm: BomLlm = (system, user) =>
      chatCompletion(getSetting, {
        tier: "smart",
        temperature: 0,
        response_json: true,
        max_tokens: 2000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
    return await splitBomLines({ extractedData: params.extractedData, matchingResults: params.matchingResults, llm });
  } catch (err) {
    log.warn({ err }, "[DraftBomSplit] Schritt übersprungen");
    return [];
  }
}

/** Pipeline: nach dem KI-Abgleich den Preis verteilen (Katalog-Nettopreise aus dem Produkt-Cache). */
export async function runDraftBomPriceStep(params: {
  extractedData: Record<string, unknown>;
  matchingResults: MatchingResult | null;
}): Promise<void> {
  if (!(params.extractedData.bomSplit as unknown[] | undefined)?.length) return;
  const { productCache } = await import("../products/productCache");
  distributeBomPrices({
    extractedData: params.extractedData,
    matchingResults: params.matchingResults,
    netPriceOf: (id) => {
      const p = productCache.getProductById(id) as (Product & { netPrice?: number }) | undefined;
      const net = typeof p?.netPrice === "number" && p.netPrice > 0 ? p.netPrice : typeof p?.price === "number" ? p.price : null;
      return net ?? null;
    },
  });
}
