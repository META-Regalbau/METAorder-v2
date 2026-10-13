/**
 * KI-Abgleich für Positionen ohne sicheren Katalogtreffer (Entscheidung 11.10.2026).
 *
 * Händler schicken eigene Artikelnummern und Bezeichnungen (Roloff: „921027516 Paletten-Grundregal
 * 8xP 1000kg H3300xB1825xT1100mm 4E“, „Unterlegblech/Ausgleichsblech 1mm“). Der Regelabgleich findet
 * dafür nichts, obwohl es die Artikel gibt („META MULTIPAL | Palettenregal | Grundregal | 3300 x 1825 x
 * 1100 mm …“, „Unterlegplatte 1,0 x 140 x 140 MULTIPAL“).
 *
 * Ablauf je Entwurf, nach der Kundenzuordnung:
 *   1. Gelernt pro Kunde: Diese Kunden-Artikelnummer wurde schon einmal bestätigt → sicherer Treffer.
 *   2. KI: je offener Position eine Vorauswahl (~25 Katalogartikel nach Stichworten, Synonymen und Maßen),
 *      ein Aufruf für alle Positionen. Ein KI-Treffer ist nur ein Vorschlag (status „uncertain“,
 *      höchstens 89 %): die strenge Automatik legt damit nichts an, ein Mensch bestätigt.
 * Wird der Entwurf angelegt oder im Prüffenster korrigiert, lernt commercialProductLearning die
 * Zuordnung samt Kunde – beim nächsten Mal greift Schritt 1.
 */
import { z } from "zod";
import type { Product } from "@shared/schema";
import type { IStorage } from "../storage";
import type { LineItemMatch, MatchingResult, ProductMatch } from "../products/productMatcher";
import { extractDimensions } from "../products/productPropertyExtractor";
import { recomputeOfferOverallConfidence, type ProductScreenMeta } from "../extraction/lineItemProductScreening";
import { normalizeLearningIdentifier } from "./commercialProductLearning";
import { parseLlmJsonResponse } from "../ai/llmChat";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/draftLineAiMatch" });

/** KI-Treffer bleiben unter der Strikt-Schwelle (100) und unter „matched“ (90) */
export const AI_MATCH_MAX_CONFIDENCE = 89;
/** Darunter wird die KI-Wahl nicht übernommen, nur als Alternative gezeigt */
export const AI_MATCH_MIN_CONFIDENCE = 60;
const SHORTLIST_SIZE = 25;
const MAX_LINES_PER_CALL = 15;

export type DraftLineAiInfo = NonNullable<LineItemMatch["aiMatch"]>;

type Line = {
  extractedProductName: string;
  extractedProductNumber?: string;
  quantity: number;
  extractedPrice?: number;
};

/** Händler- und META-Wörter, die dasselbe meinen. Schlüssel und Werte werden beide gesucht. */
const SYNONYMS: Record<string, string[]> = {
  unterlegblech: ["unterlegplatte"],
  ausgleichsblech: ["unterlegplatte"],
  ausgleichsplatte: ["unterlegplatte"],
  unterlegscheibe: ["unterlegplatte"],
  grundregal: ["gr"],
  anbauregal: ["ar"],
  palettenregal: ["multipal"],
  paletten: ["palettenregal", "multipal"],
  fachbodenregal: ["clip"],
  kragarmregal: ["multistrong"],
  weitspannregal: ["multiplus"],
  traverse: ["holm", "holmebene"],
  traversen: ["holm", "holmebene"],
  holm: ["holmebene"],
  rahmen: ["staender", "staenderrahmen"],
  stirnrahmen: ["staender", "staenderrahmen"],
  staender: ["staenderrahmen"],
  rammschutz: ["rammschutzwand", "anfahrschutz"],
  gitterrost: ["gitterrostboden"],
  verzinkt: ["vzk"],
  zn: ["vzk", "verzinkt"],
  fachboden: ["boden"],
};

const STOPWORDS = new Set(["mit", "und", "für", "fuer", "f", "der", "die", "das", "von", "bis", "inkl", "kpl", "stk", "stück", "stueck", "mm", "kg"]);

export function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    // „4400x800“ → 4400 800, „hn140“ → hn 140, „4hs“ → 4 hs: Maße und Typen vergleichbar machen
    .replace(/(\d)\s*[x×*]\s*(?=\d)/g, "$1 ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function expandTokens(tokens: string[]): Set<string> {
  const out = new Set(tokens);
  for (const t of tokens) {
    for (const syn of SYNONYMS[t] ?? []) out.add(syn.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue"));
  }
  return out;
}

/** Vorauswahl je Position: Stichwort-Treffer (mit Synonymen) + gleiche Maße + bisherige Vorschläge. */
export function buildCandidateShortlist(
  line: Line,
  products: Product[],
  previousAlternatives: ProductMatch[] = [],
  size = SHORTLIST_SIZE,
): Product[] {
  const lineTokens = expandTokens(tokenize(line.extractedProductName)).values();
  const wordTokens = [...lineTokens].filter((t) => !/^\d+$/.test(t));
  const numberTokens = tokenize(line.extractedProductName).filter((t) => /^\d{2,}$/.test(t));
  const lineDims = extractDimensions({ id: "", productNumber: "", name: line.extractedProductName } as Product);
  const dimValues = [lineDims.width, lineDims.height, lineDims.depth].filter((v): v is number => typeof v === "number");
  const previous = new Set(previousAlternatives.map((a) => a.id));

  const scored: Array<{ product: Product; score: number }> = [];
  for (const product of products) {
    if (product.available === false) continue;
    const nameTokens = new Set(tokenize(product.name));
    let score = 0;
    for (const t of wordTokens) if (nameTokens.has(t)) score += t.length >= 5 ? 3 : 1;
    for (const n of numberTokens) if (nameTokens.has(n)) score += 1;
    if (dimValues.length >= 2) {
      const pd = extractDimensions(product);
      const productDims = [pd.width, pd.height, pd.depth, pd.length].filter((v): v is number => typeof v === "number");
      const same = dimValues.filter((v) => productDims.includes(v)).length;
      if (same === dimValues.length) score += 8;
      else score += same * 2;
    }
    if (previous.has(product.id)) score += 2;
    if (score >= 3) scored.push({ product, score });
  }
  scored.sort((a, b) => b.score - a.score || a.product.name.length - b.product.name.length);
  return scored.slice(0, size).map((s) => s.product);
}

const aiLineSchema = z.object({
  line: z.coerce.number().int(),
  candidate: z.coerce.number().int().nullable().optional(),
  confidence: z.coerce.number().min(0).max(100),
  reason: z.string().optional(),
});
type AiLine = z.infer<typeof aiLineSchema>;

/** Je Zeile prüfen: eine kaputte Zeile verwirft nicht die ganze Antwort; „0“ heißt kein Kandidat. */
export function parseAiLines(raw: string): AiLine[] | null {
  const parsed = parseLlmJsonResponse(raw) as unknown;
  // {"lines":[…]}, ein anderer Schlüssel mit der Liste oder gleich die Liste
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (Array.isArray((parsed as { lines?: unknown }).lines)
          ? (parsed as { lines: unknown[] }).lines
          : Object.values(parsed as Record<string, unknown>).find((v) => Array.isArray(v)))
      : undefined;
  if (!Array.isArray(list)) return null;
  const out: AiLine[] = [];
  for (const entry of list) {
    const safe = aiLineSchema.safeParse(entry);
    if (!safe.success) continue;
    out.push({
      ...safe.data,
      candidate: safe.data.candidate && safe.data.candidate > 0 ? safe.data.candidate : null,
      reason: (safe.data.reason ?? "").slice(0, 400),
    });
  }
  return out;
}

export type AiMatchLlm = (system: string, user: string) => Promise<string>;

const AI_SYSTEM = `Du ordnest Bestellpositionen eines Händlers Artikeln aus dem Katalog des Herstellers META (Regalsysteme) zu.
Die Händler benutzen eigene Artikelnummern und Bezeichnungen. Maßangaben: H = Höhe, B = Breite, T = Tiefe; META-Namen nennen Maße als Höhe x Breite x Tiefe.
Abkürzungen der Händler: „8xP“ = 8 Palettenplätze, „4E“ = 4 Ebenen, „zn“ = verzinkt, „/2001“ = RAL 2001, „GR“ = Grundregal, „AR“ = Anbauregal.
Wähle je Position genau einen Kandidaten oder null, wenn keiner wirklich passt. Rate nicht: Maße, Regaltyp (Grund-/Anbauregal), Anzahl Ebenen/Palettenplätze und Stärke müssen stimmen.
Gibt es eine Ausführung nicht genau (z. B. Profil 120/20 bestellt, im Katalog nur 100/20), darfst du die nächstliegende wählen, dann confidence höchstens 70 und die Abweichung in der Begründung nennen.
Ständer heißen bei META „Ständerrahmen“. Holme werden als „Holmebene“ (Paar = 2 Holme) verkauft: für bestellte Holme die passende Holmebene wählen.
Verpackungseinheiten beachten: Steht im Artikelnamen z. B. „10 Stück“, nenne das in der Begründung („VE 10 Stück – Menge prüfen“), weil die bestellte Menge sich auf Einzelteile beziehen kann.
confidence: 90–100 nur bei eindeutiger Übereinstimmung aller Angaben, 60–89 wenn sehr wahrscheinlich, darunter unsicher.
Begründung kurz halten (höchstens 150 Zeichen). Antworte NUR mit JSON, ohne Text davor oder danach:
{"lines":[{"line":1,"candidate":3,"confidence":85,"reason":"kurz, deutsch"}]}`;

function buildAiPrompt(entries: Array<{ lineNo: number; line: Line; candidates: Product[] }>): string {
  return entries
    .map(({ lineNo, line, candidates }) => {
      const head = [
        `Position ${lineNo}: ${line.quantity} x „${line.extractedProductName}“`,
        line.extractedProductNumber ? `Händler-Artikelnr. ${line.extractedProductNumber}` : "",
        typeof line.extractedPrice === "number" ? `Händler-Preis ${line.extractedPrice} €` : "",
      ]
        .filter(Boolean)
        .join(" | ");
      const list = candidates.map((p, i) => `  [${i + 1}] ${p.productNumber} | ${p.name} | ${p.price ?? "?"} €`).join("\n");
      return `${head}\nKandidaten:\n${list}`;
    })
    .join("\n\n");
}

function toProductMatch(product: Product, confidence: number, reasoning?: string): ProductMatch {
  return { id: product.id, productNumber: product.productNumber, name: product.name, price: product.price, confidence, reasoning };
}

/** Holme bestellt, Holmebene (Paar) gewählt: Menge halbieren – wie der Regelabgleich (convertHolmToHolmebene). */
export function applyHolmebeneConversion(item: LineItemMatch, line: Line, product: Product): void {
  const ordered = line.extractedProductName.toLowerCase();
  if (!/\bholm/.test(ordered) || /holmebene/.test(ordered) || !/holmebene/i.test(product.name)) return;
  if (item.originalQuantity !== undefined) return;
  item.originalQuantity = line.quantity;
  item.convertedQuantity = Math.ceil(line.quantity / 2);
  item.quantity = item.convertedQuantity;
  item.conversionNote = "1 Holmebene = 2 Holme";
}

function lineNeedsHelp(item: LineItemMatch & { bundle?: unknown; productScreen?: { likelihood?: string } }): boolean {
  if (item.catalogMatchSkipped || item.bundle) return false;
  if (item.productScreen?.likelihood === "unlikely_product") return false;
  // Zurechtgerückte Nummer (verrutschte Spalte): Artikel steht fest, nur die Zeile war falsch
  if (item.numberCheck?.kind === "realigned" && item.matchedProduct) return false;
  // Aus dem Konfigurator-Text zerlegt: Artikel per Maß/Fachlast gewählt, nicht von der KI überschreiben
  if (item.matchStrategy === "configurator" && item.matchedProduct) return false;
  // CLIP-Kurzbezeichnung + Maße (draftClipSpecRows): Artikel per Maß/Fachlast gewählt
  if (item.matchStrategy === "clip_spec" && item.matchedProduct) return false;
  return !(item.status === "matched" && item.confidence >= 90 && item.matchedProduct);
}

export type DraftLineAiMatchResult = { learned: number; ai: number; considered: number };

/**
 * Ergänzt matchingResults in place. Fehler (KI weg, Antwort kaputt) lassen die Positionen unverändert.
 */
export async function refineUnmatchedDraftLines(params: {
  storage: IStorage;
  tenantId: string | null;
  lineItems: Line[];
  matchingResults: MatchingResult | null;
  shopwareCustomerId: string | null;
  products: Product[];
  llm: AiMatchLlm | null;
}): Promise<DraftLineAiMatchResult> {
  const { matchingResults, products } = params;
  const result: DraftLineAiMatchResult = { learned: 0, ai: 0, considered: 0 };
  if (!matchingResults?.items?.length || products.length === 0) return result;
  const byId = new Map(products.map((p) => [p.id, p]));

  const open = matchingResults.items
    .map((item, index) => ({ item, index, line: params.lineItems[index] }))
    .filter((e) => e.line && lineNeedsHelp(e.item));
  result.considered = open.length;
  if (!open.length) return result;

  // 1. Gelernt pro Kunde (Kunden-Artikelnummer → bestätigtes Produkt)
  if (params.shopwareCustomerId) {
    const identifiers = open.map((e) => e.line.extractedProductNumber?.trim()).filter((v): v is string => Boolean(v));
    if (identifiers.length) {
      const rows = await params.storage
        .getCommercialProductFeedbackForCustomer(params.shopwareCustomerId, identifiers, params.tenantId)
        .catch((err) => {
          log.warn({ err }, "[DraftLineAiMatch] Gelernte Kundenzuordnungen nicht geladen");
          return [];
        });
      for (const entry of open) {
        const ident = normalizeLearningIdentifier(entry.line.extractedProductNumber);
        if (!ident) continue;
        const rowsForIdent = rows.filter((r) => normalizeLearningIdentifier(r.sourceIdentifier) === ident);
        // jüngste Entscheidung zählt; „kein Produkt“ hebt eine frühere Zuordnung auf
        const latest = rowsForIdent[0];
        if (!latest || latest.outcome !== "confirmed_product" || !latest.selectedProductId) continue;
        const product = byId.get(latest.selectedProductId);
        if (!product) continue;
        entry.item.matchedProduct = toProductMatch(product, 100, "Für diesen Kunden schon bestätigt");
        entry.item.confidence = 100;
        entry.item.status = "matched";
        entry.item.matchStrategy = "learned_customer";
        entry.item.learningHint = { type: "preferred_identifier", identifier: entry.line.extractedProductNumber };
        result.learned += 1;
      }
    }
  }

  // 2. KI für den Rest
  const remaining = open.filter((e) => lineNeedsHelp(e.item)).slice(0, MAX_LINES_PER_CALL);
  if (!params.llm || !remaining.length) {
    if (result.learned) recomputeOverall(matchingResults);
    return result;
  }
  const entries = remaining
    .map((e) => ({ ...e, candidates: buildCandidateShortlist(e.line, products, e.item.alternativeMatches ?? []) }))
    .filter((e) => e.candidates.length > 0)
    .map((e, i) => ({ ...e, lineNo: i + 1 }));
  if (!entries.length) {
    if (result.learned) recomputeOverall(matchingResults);
    return result;
  }

  let parsed: AiLine[] | null = null;
  try {
    const raw = await params.llm(AI_SYSTEM, buildAiPrompt(entries));
    parsed = parseAiLines(raw);
    // Ausschnitt ins Protokoll: nur Positionen und Katalogartikel, keine Kundendaten
    if (!parsed) log.warn({ rawSnippet: String(raw ?? "").slice(0, 400), rawLength: String(raw ?? "").length }, "[DraftLineAiMatch] KI-Antwort unbrauchbar");
  } catch (err) {
    log.warn({ err }, "[DraftLineAiMatch] KI-Abgleich fehlgeschlagen");
  }
  if (parsed) {
    for (const answer of parsed) {
      const entry = entries.find((e) => e.lineNo === answer.line);
      if (!entry || answer.candidate == null) continue;
      const product = entry.candidates[answer.candidate - 1];
      if (!product) continue;
      const reason = (answer.reason ?? "").trim();
      const shown = Math.min(AI_MATCH_MAX_CONFIDENCE, Math.round(answer.confidence));
      const suggestion = toProductMatch(product, shown, reason ? `KI: ${reason}` : "KI-Vorschlag");
      const others = (entry.item.alternativeMatches ?? []).filter((a) => a.id !== product.id);
      if (answer.confidence >= AI_MATCH_MIN_CONFIDENCE && shown > (entry.item.confidence ?? 0)) {
        // Bisheriger (schwacher) Treffer wandert zu den Alternativen
        const previous = entry.item.matchedProduct && entry.item.matchedProduct.id !== product.id ? [entry.item.matchedProduct] : [];
        entry.item.matchedProduct = suggestion;
        entry.item.confidence = shown;
        entry.item.status = "uncertain";
        entry.item.matchStrategy = "ai";
        entry.item.alternativeMatches = [...previous, ...others].slice(0, 8);
        entry.item.aiMatch = { confidence: Math.round(answer.confidence), reason, candidateCount: entry.candidates.length };
        applyHolmebeneConversion(entry.item, entry.line, product);
        result.ai += 1;
      } else {
        entry.item.alternativeMatches = [suggestion, ...others].slice(0, 8);
      }
    }
  }
  recomputeOverall(matchingResults);
  log.info(
    { event: "draft_line_ai_match", considered: result.considered, learned: result.learned, ai: result.ai },
    `[DraftLineAiMatch] ${result.learned} gelernt, ${result.ai} KI-Vorschläge von ${result.considered} offenen Positionen`,
  );
  return result;
}

function recomputeOverall(matchingResults: MatchingResult): void {
  // wie nach dem Screening: Zeilen „kein Produkt“ zählen nicht mit
  matchingResults.overallConfidence = recomputeOfferOverallConfidence(
    matchingResults.items as Array<{ confidence: number; productScreen?: ProductScreenMeta }>,
  );
}

/** Pipeline-Schritt (Bestellung und Angebot): nach der Kundenzuordnung, vor dem Speichern des Entwurfs. */
export async function runDraftLineAiMatchStep(params: {
  storage: IStorage;
  tenantId: string | null;
  enabled: boolean;
  aiMode: string;
  lineItems: Line[] | undefined;
  matchingResults: MatchingResult | null;
  shopwareCustomerId: string | null;
}): Promise<DraftLineAiMatchResult | null> {
  if (!params.enabled || !params.lineItems?.length || !params.matchingResults?.items?.length) return null;
  try {
    const { productCache } = await import("../products/productCache");
    const { chatCompletion, isChatLlmConfigured } = await import("../ai/llmChat");
    const getSetting = params.storage.getSetting.bind(params.storage);
    const llm: AiMatchLlm | null =
      params.aiMode !== "local_only" && (await isChatLlmConfigured(getSetting))
        ? (system, user) =>
            chatCompletion(getSetting, {
              tier: "smart",
              temperature: 0,
              response_json: true,
              max_tokens: 3000,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            })
        : null;
    return await refineUnmatchedDraftLines({
      storage: params.storage,
      tenantId: params.tenantId,
      lineItems: params.lineItems,
      matchingResults: params.matchingResults,
      shopwareCustomerId: params.shopwareCustomerId,
      products: productCache.getProducts(),
      llm,
    });
  } catch (err) {
    log.warn({ err }, "[DraftLineAiMatch] Schritt übersprungen");
    return null;
  }
}
