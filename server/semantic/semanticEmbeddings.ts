import crypto from "crypto";
import type { IStorage } from "../storage";
import { getAISettings } from "../ai/aiConfig";
import { getOpenAIClientFromSettings } from "../ai/openaiClient";

const VECTOR_DIMENSIONS = 1536;
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

type EmbeddingResult = {
  embedding: number[];
  provider: "local" | "openai";
  model: string;
};

function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .toLowerCase();
}

function hashToken(token: string): number {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Zweiter, unabhaengiger Hash (FNV-1a) fuer das Vorzeichen */
function signOfToken(token: string): 1 | -1 {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash & 1 ? 1 : -1;
}

/**
 * Lokales Embedding (ohne KI-Anbieter): Woerter per Hash auf 1536 Faecher verteilt.
 * v1 zaehlte jedes Vorkommen - die EAN stand in Produkttexten doppelt (Artikelnummer = EAN), ~5.700
 * EANs belegten die Faecher, kurze Produkte gewannen per Kollision ("kragarmregal" fiel ins Fach der
 * EAN eines "KR H Profil"). v2:
 * - jedes Wort einmal
 * - Ziffernfolgen ab 6 Stellen (EAN, Artikel-/Belegnummern) nicht im Vektor - die findet die Wortsuche
 *   samt exakter Nummer (semanticRanking.ts)
 * - Vorzeichen je Wort (+1/-1), damit sich Kollisionen im Mittel aufheben
 * Andere Modellkennung -> der Suchindex rechnet vorhandene Dokumente neu (semanticIndexer.ts).
 */
export const LOCAL_EMBEDDING_MODEL = "local-hash-v2";
const LONG_NUMBER = /^\d{6,}$/;

export function createLocalEmbedding(text: string): number[] {
  const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0);
  const normalized = normalizeText(text);
  const tokens = new Set((normalized.match(/[\p{L}\p{N}]+/gu) || []).filter((token) => !LONG_NUMBER.test(token)));
  if (tokens.size === 0) return vector;

  tokens.forEach((token) => {
    const index = hashToken(token) % VECTOR_DIMENSIONS;
    vector[index] += signOfToken(token);
  });

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  // alle Woerter heben sich auf (sehr selten): kein verwertbarer Vektor
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

/** Nullvektor: kein Wort im Vektor (z. B. nur eine EAN) - Abstand dazu ist nicht definiert */
export function isZeroEmbedding(embedding: number[]): boolean {
  return !embedding.some((value) => value !== 0);
}

function trimToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export async function generateEmbedding(
  text: string,
  storage: IStorage,
  options?: { preferOpenAI?: boolean }
): Promise<EmbeddingResult> {
  const aiSettings = await getAISettings(storage);
  const maxChars = aiSettings.maxInputChars || 20000;
  const normalizedText = trimToMaxChars(text, maxChars);

  const openaiConfig = await getOpenAIClientFromSettings(storage.getSetting.bind(storage));
  const wantsOpenAI = options?.preferOpenAI || aiSettings.mode === "openai_only";

  if (wantsOpenAI && openaiConfig) {
    const response = await openaiConfig.client.embeddings.create({
      model: OPENAI_EMBEDDING_MODEL,
      input: normalizedText,
    });
    const embedding = response.data?.[0]?.embedding || [];
    return { embedding, provider: "openai", model: OPENAI_EMBEDDING_MODEL };
  }

  if (aiSettings.mode === "openai_only" && !openaiConfig) {
    throw new Error("OpenAI embeddings requested but no OpenAI configuration found.");
  }

  return {
    embedding: createLocalEmbedding(normalizedText),
    provider: "local",
    model: LOCAL_EMBEDDING_MODEL,
  };
}

export function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
