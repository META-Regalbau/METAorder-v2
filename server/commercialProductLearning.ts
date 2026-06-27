import type {
  InsertCommercialProductMatchFeedback,
} from "@shared/schema";
import type { IStorage } from "./storage";

export type DraftKind = "offer" | "order";

export type CommercialProductLearningHints = {
  blockedLineKeys: string[];
  preferredIdentifierByLineKey: Record<string, string>;
};

type DraftLike = {
  extractedData?: {
    lineItems?: Array<{ extractedProductName?: string; extractedProductNumber?: string }>;
  } | null;
  matchingResults?: {
    items?: Array<{
      extractedProductName?: string;
      extractedProductNumber?: string;
      status?: string;
      matchStrategy?: string;
      bundle?: unknown;
      matchedProduct?: { id?: string; productNumber?: string } | null;
      productScreen?: { likelihood?: string } | null;
    }>;
  } | null;
};

const IDENTIFIER_SEPARATORS_RE = /[\s\u00A0\-–._/]/g;

export function normalizeLearningIdentifier(value: string | undefined | null): string | undefined {
  if (!value || typeof value !== "string") return undefined;
  const compact = value.trim().replace(IDENTIFIER_SEPARATORS_RE, "");
  if (!compact) return undefined;
  return compact.toLowerCase();
}

export function normalizeLearningLineKey(text: string | undefined | null): string {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function getLineCandidate(
  draft: DraftLike | null | undefined,
  index: number
): { lineText: string; sourceIdentifier?: string } {
  const lineFromExtracted = draft?.extractedData?.lineItems?.[index];
  const lineFromMatching = draft?.matchingResults?.items?.[index];
  const lineText =
    lineFromExtracted?.extractedProductName?.trim() ||
    lineFromMatching?.extractedProductName?.trim() ||
    "";
  const sourceIdentifier =
    lineFromExtracted?.extractedProductNumber?.trim() ||
    lineFromMatching?.extractedProductNumber?.trim() ||
    undefined;
  return { lineText, sourceIdentifier };
}

export function buildCommercialProductFeedbackRowsFromDraftUpdate(params: {
  existingDraft?: DraftLike | null;
  updatedDraft: DraftLike;
  tenantId?: string | null;
  draftKind: DraftKind;
  createdByUserId?: string | null;
}): InsertCommercialProductMatchFeedback[] {
  const { existingDraft, updatedDraft, tenantId, draftKind, createdByUserId } = params;
  const updatedItems = updatedDraft?.matchingResults?.items ?? [];
  const rows: InsertCommercialProductMatchFeedback[] = [];

  for (let i = 0; i < updatedItems.length; i++) {
    const current = updatedItems[i];
    if (!current) continue;
    const { lineText, sourceIdentifier } = getLineCandidate(updatedDraft, i);
    const lineKey = normalizeLearningLineKey(lineText);
    if (!lineKey) continue;

    const old = existingDraft?.matchingResults?.items?.[i];
    const oldMatchedId = old?.matchedProduct?.id ?? null;
    const nextMatchedId = current?.matchedProduct?.id ?? null;
    const oldStatus = old?.status ?? null;
    const nextStatus = current?.status ?? null;
    const oldLikelihood = old?.productScreen?.likelihood ?? null;
    const nextLikelihood = current?.productScreen?.likelihood ?? null;
    const changed =
      oldMatchedId !== nextMatchedId || oldStatus !== nextStatus || oldLikelihood !== nextLikelihood;
    if (!changed) continue;

    const looksNotProduct =
      nextLikelihood === "unlikely_product" ||
      (current?.status === "not_found" && !current?.matchedProduct && !current?.bundle);
    if (looksNotProduct) {
      rows.push({
        tenantId: tenantId ?? null,
        draftKind,
        outcome: "not_product",
        lineKey,
        sourceLine: lineText || null,
        sourceIdentifier: sourceIdentifier ?? null,
        selectedProductId: null,
        selectedIdentifier: null,
        selectedStrategy: null,
        createdByUserId: createdByUserId ?? null,
      });
      continue;
    }

    const matched = current?.matchedProduct;
    if (matched?.id) {
      const chosenIdentifier = normalizeLearningIdentifier(
        matched.productNumber || sourceIdentifier || null
      );
      rows.push({
        tenantId: tenantId ?? null,
        draftKind,
        outcome: "confirmed_product",
        lineKey,
        sourceLine: lineText || null,
        sourceIdentifier: sourceIdentifier ?? null,
        selectedProductId: matched.id,
        selectedIdentifier: chosenIdentifier ?? null,
        selectedStrategy: current.matchStrategy ?? null,
        createdByUserId: createdByUserId ?? null,
      });
    }
  }

  const seen = new Set<string>();
  return rows.filter((row) => {
    const k = [
      row.outcome,
      row.lineKey,
      row.selectedProductId ?? "",
      row.selectedIdentifier ?? "",
    ].join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function buildCommercialProductLearningHints(params: {
  storage: IStorage;
  tenantId?: string | null;
  lineItems: Array<{ extractedProductName: string }>;
}): Promise<CommercialProductLearningHints> {
  const { storage, tenantId, lineItems } = params;
  const lineKeys = Array.from(
    new Set(
      lineItems
        .map((line) => normalizeLearningLineKey(line?.extractedProductName))
        .filter(Boolean)
    )
  ).slice(0, 120);

  if (!lineKeys.length) {
    return { blockedLineKeys: [], preferredIdentifierByLineKey: {} };
  }

  const rows = await storage.getCommercialProductMatchFeedbackByLineKeys(lineKeys, tenantId ?? null, 600);
  if (!rows.length) {
    return { blockedLineKeys: [], preferredIdentifierByLineKey: {} };
  }

  const blockedLineKeys = new Set<string>();
  const preferredIdentifierByLineKey: Record<string, string> = {};

  for (const lineKey of lineKeys) {
    const perLine = rows.filter((r) => r.lineKey === lineKey);
    if (!perLine.length) continue;
    let notProduct = 0;
    const identifierScore = new Map<string, number>();
    for (const row of perLine) {
      if (row.outcome === "not_product") {
        notProduct += 1;
        continue;
      }
      if (row.outcome !== "confirmed_product") continue;
      const normalizedIdentifier = normalizeLearningIdentifier(row.selectedIdentifier);
      if (!normalizedIdentifier) continue;
      identifierScore.set(normalizedIdentifier, (identifierScore.get(normalizedIdentifier) ?? 0) + 1);
    }

    const top = Array.from(identifierScore.entries()).sort((a, b) => b[1] - a[1])[0];
    const topScore = top?.[1] ?? 0;

    if (!top && notProduct >= 2) {
      blockedLineKeys.add(lineKey);
      continue;
    }
    if (top && topScore >= notProduct) {
      preferredIdentifierByLineKey[lineKey] = top[0];
    }
  }

  return {
    blockedLineKeys: Array.from(blockedLineKeys),
    preferredIdentifierByLineKey,
  };
}
