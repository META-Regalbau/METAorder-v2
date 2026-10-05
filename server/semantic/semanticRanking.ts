import { nameWords, productRelevance, SCORE_WHOLE_WORD, searchTokens } from "../products/productSearchRanking";

/**
 * Reihenfolge der semantischen Suche (Suchseite, FAQ). Vorher kamen die Kandidaten nur aus der
 * Vektorsuche; mit lokalen Embeddings (Wortzaehlung per Hash, keine Bedeutung) waren das bei kurzen
 * Anfragen oft Zufallstreffer - "Fachboden" lieferte zuerst "KR H Profil ...". Jetzt:
 * - Kandidaten aus Vektor- UND Wortsuche (dbStorage.searchSemanticDocuments)
 * - Wortanteil wie in der Produktsuche: ganzes Wort im Titel > Teil eines Worts > nur im Inhalt
 * - bei lokalem Anfrage-Embedding zaehlt der Vektor weniger (LOCAL_VECTOR_FACTOR)
 * - exakte Nummer (Artikelnummer, EAN, Angebots-/Ticketnummer) steht vorn
 * Die Gewichte aus den Einstellungen ("semantic_ranking") gelten weiter.
 */

export const SEMANTIC_RANKING_DEFAULTS = {
  vectorWeight: 0.65,
  textWeight: 0.25,
  metadataWeight: 0.1,
  feedbackWeight: 0.12,
  metadataExactBoost: 0.15,
  metadataPartialBoost: 0.08,
  titleTokenBoost: 0.06,
};

/** Lokale Embeddings zaehlen nur Woerter (mit Hash-Kollisionen) - der Vektor zaehlt dann ein Viertel */
export const LOCAL_VECTOR_FACTOR = 0.25;

export type SemanticCandidate = {
  sourceType: string;
  sourceId: string;
  title: string | null;
  content: string | null;
  metadata: any;
  distance: number;
  textRank: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const numberOr = (value: any, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const normalizeQuery = (value: string) => value.trim().toLowerCase();

/** Wortanteil 0..1: alle Suchwoerter als ganze Woerter im Titel = 1, nur im Inhalt = 0.1 je Wort */
export function lexicalScore(title: string | null | undefined, content: string | null | undefined, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const score = productRelevance(title, tokens, { extraText: content });
  return Math.min(1, score / (SCORE_WHOLE_WORD * tokens.length));
}

function numberFields(metadata: any): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  return [metadata.productNumber, metadata.manufacturerNumber, metadata.ean, metadata.offerNumber, metadata.ticketNumber]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function metadataFields(metadata: any): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  return [...numberFields(metadata), metadata.customerName, metadata.customerEmail, metadata.categories]
    .flat()
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

export function rankSemanticCandidates<T extends SemanticCandidate>(
  candidates: T[],
  context: { query?: string; rankingSettings?: any; feedbackEntries?: any; localQueryEmbedding?: boolean },
): Array<T & { hybridScore: number }> {
  const settings = context.rankingSettings && typeof context.rankingSettings === "object" ? context.rankingSettings : {};
  const weight = (key: keyof typeof SEMANTIC_RANKING_DEFAULTS) =>
    clamp(numberOr(settings[key], SEMANTIC_RANKING_DEFAULTS[key]), 0, 1);
  const vectorWeight = weight("vectorWeight") * (context.localQueryEmbedding ? LOCAL_VECTOR_FACTOR : 1);
  const textWeight = weight("textWeight");
  const metadataWeight = weight("metadataWeight");
  const feedbackWeight = weight("feedbackWeight");
  const weightSum = vectorWeight + textWeight + metadataWeight + feedbackWeight || 1;
  const metadataExactBoost = weight("metadataExactBoost");
  const metadataPartialBoost = weight("metadataPartialBoost");
  const titleTokenBoost = weight("titleTokenBoost");

  const query = normalizeQuery(context.query ?? "");
  const tokens = searchTokens(query);

  const feedbackCounts = new Map<string, number>();
  if (query && Array.isArray(context.feedbackEntries)) {
    for (const entry of context.feedbackEntries) {
      if (!entry || typeof entry.query !== "string" || normalizeQuery(entry.query) !== query) continue;
      if (!entry.sourceType || !entry.sourceId) continue;
      const key = `${entry.sourceType}:${entry.sourceId}`;
      feedbackCounts.set(key, (feedbackCounts.get(key) || 0) + 1);
    }
  }
  const maxFeedbackCount = Math.max(0, ...Array.from(feedbackCounts.values()));

  const metadataBoost = (entry: T) => {
    const fields = metadataFields(entry.metadata);
    const titleWords = nameWords(entry.title);
    let boost = 0;
    for (const token of tokens) {
      if (fields.some((field) => field === token)) boost = Math.max(boost, metadataExactBoost);
      else if (fields.some((field) => field.includes(token))) boost = Math.max(boost, metadataPartialBoost);
    }
    // Titelbonus nur fuer ganze Woerter ("Fachboden" nicht in "Fachbodentraeger")
    if (tokens.some((token) => titleWords.includes(token))) boost = Math.max(boost, titleTokenBoost);
    return boost;
  };

  const scored = candidates.map((entry) => {
    const vectorScore = Math.max(0, 1 - Number(entry.distance ?? 0));
    const rank = Number(entry.textRank ?? 0);
    const textScore = Math.max(rank > 0 ? rank / (rank + 1) : 0, lexicalScore(entry.title, entry.content, tokens));
    const feedbackScore = maxFeedbackCount
      ? (feedbackCounts.get(`${entry.sourceType}:${entry.sourceId}`) || 0) / maxFeedbackCount
      : 0;
    const hybridScore =
      (vectorScore * vectorWeight +
        textScore * textWeight +
        (tokens.length ? metadataBoost(entry) : 0) * metadataWeight +
        feedbackScore * feedbackWeight) /
      weightSum;
    const exact = Boolean(query) && numberFields(entry.metadata).includes(query);
    return { entry: { ...entry, hybridScore }, exact };
  });

  if (!query) return scored.map((s) => s.entry).sort((a, b) => a.distance - b.distance);
  return scored
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.entry.hybridScore - a.entry.hybridScore || a.entry.distance - b.entry.distance)
    .map((s) => s.entry);
}
