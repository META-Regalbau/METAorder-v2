import crypto from "crypto";
import type { IStorage } from "./storage";
import { getAISettings } from "./aiConfig";
import { getOpenAIClientFromSettings } from "./openaiClient";

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

function createLocalEmbedding(text: string): number[] {
  const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0);
  const normalized = normalizeText(text);
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  if (tokens.length === 0) return vector;

  tokens.forEach((token) => {
    const index = hashToken(token) % VECTOR_DIMENSIONS;
    vector[index] += 1;
  });

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
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
    model: "local-hash-v1",
  };
}

export function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
