/**
 * „Nochmal prüfen" für KI-Bestellentwürfe: wiederholt Produktabgleich und Kundenzuordnung
 * auf dem bereits extrahierten Entwurf — ohne Dokument neu hochzuladen oder neu zu extrahieren.
 *
 * Gedacht für zwei Fälle:
 *  - Stammdaten/Regeln haben sich geändert (neues Katalogfeld, korrigierte Kundenzuordnung),
 *  - Automation: Entwürfe nach einem Fix erneut durchlaufen lassen, optional mit Strikt-Auto-Create.
 *
 * Manuelle Arbeit im Review bleibt erhalten: Ein Produkt wird nur ersetzt, wenn der neue Abgleich
 * einen Treffer liefert; manuell ergänzte Positionen, Bundles und Preis-Overrides bleiben stehen.
 * Ein im Review manuell zugeordneter Kunde wird nicht angetastet.
 */
import type { IStorage } from "./storage";
import type { OrderDraft } from "@shared/schema";
import type { MatchingResult } from "./productMatcher";
import { getAISettings, getCommercialAgentSettings } from "./aiConfig";
import { matchProductsAgainstCatalog } from "./productMatcher";
import { applyProductScreeningToOfferMatching } from "./lineItemProductScreening";
import { buildCommercialProductLearningHints } from "./commercialProductLearning";
import {
  resolveShopwareCustomerForDraft,
  shouldRunShopwareCustomerResolutionForDraft,
} from "./draftCustomerEmailResolution";
import { runStrictCommercialAutoCreateIfAllowed } from "./commercialStrictAutoCreateRunner";
import { ShopwareClient } from "./shopware";

type DraftMatching = NonNullable<OrderDraft["matchingResults"]>;
type MatchItem = DraftMatching["items"][number];

export type RecheckOrderDraftResult =
  | {
      ok: true;
      draft: OrderDraft;
      summary: {
        matchedBefore: number;
        matchedAfter: number;
        lines: number;
        customerBefore: string | null;
        customerAfter: string | null;
        customerChanged: boolean;
        customerKeptManual: boolean;
        autoCreate?: { attempted: boolean; created: boolean; orderId?: string; reasons: string[]; error?: string };
      };
    }
  | { ok: false; error: string; statusCode: number };

function countMatched(items: MatchItem[] | undefined): number {
  return (items ?? []).filter((i) => i.status === "matched" && (i.matchedProduct || i.bundle)).length;
}

function overallConfidence(items: MatchItem[]): number {
  if (items.length === 0) return 0;
  return Math.round(items.reduce((sum, i) => sum + (i.confidence || 0), 0) / items.length);
}

/** Neues Ergebnis je Zeile nur übernehmen, wenn es besser ist — manuelle Wahl/Preis bleibt. */
function mergeLineMatches(previous: MatchItem[], fresh: MatchItem[], lineCount: number): MatchItem[] {
  const merged: MatchItem[] = [];
  for (let i = 0; i < lineCount; i++) {
    const old = previous[i];
    const next = fresh[i];
    if (!next) {
      if (old) merged.push(old);
      continue;
    }
    if (!old) {
      merged.push(next);
      continue;
    }
    const oldMatched = old.status === "matched" && (old.matchedProduct || old.bundle);
    const nextMatched = next.status === "matched" && next.matchedProduct;
    if (old.bundle || (oldMatched && !nextMatched)) {
      merged.push(old);
      continue;
    }
    if (nextMatched && old.matchedProduct && old.matchedProduct.id === next.matchedProduct!.id) {
      const manualNet = (old.matchedProduct as { manualUnitPriceNet?: number }).manualUnitPriceNet;
      if (typeof manualNet === "number") {
        (next.matchedProduct as { manualUnitPriceNet?: number }).manualUnitPriceNet = manualNet;
      }
    }
    merged.push(nextMatched || !oldMatched ? next : old);
  }
  // Im Review manuell hinzugefügte Positionen (ohne Gegenstück in lineItems)
  for (let i = lineCount; i < previous.length; i++) merged.push(previous[i]);
  return merged;
}

/**
 * Setzt die Kundendaten auf den Stand vor der letzten Zuordnung zurück: Die Zuordnung überschreibt
 * customer.email mit der E-Mail des gefundenen Accounts (bei Fehlgriff z. B. eines Shop-Gasts).
 * Die ursprünglichen Kandidaten stehen in emailResolution.candidatesTried.
 */
function resetCustomerResolution(extractedData: Record<string, unknown>): string | undefined {
  const customer = (extractedData.customer ?? {}) as Record<string, unknown>;
  const resolution = customer.emailResolution as { candidatesTried?: string[] } | undefined;
  const candidates = (resolution?.candidatesTried ?? []).filter((e) => typeof e === "string" && e.includes("@"));
  if (candidates.length > 0) customer.email = candidates[0];
  delete customer.emailResolution;
  delete customer.customerMatchConfidence;
  delete customer.shopwareCustomerCandidates;
  extractedData.customer = customer;
  return candidates.length > 0 ? candidates.join("\n") : undefined;
}

export async function recheckOrderDraft(
  storage: IStorage,
  draftId: string,
  options: { tenantId?: string | null; autoCreate?: boolean } = {}
): Promise<RecheckOrderDraftResult> {
  const tenantId = options.tenantId ?? null;
  const draft = await storage.getOrderDraft(draftId, tenantId);
  if (!draft) return { ok: false, error: "Order draft not found", statusCode: 404 };
  if (draft.status === "created" || draft.shopwareOrderId) {
    return { ok: false, error: "Aus diesem Entwurf wurde bereits eine Bestellung angelegt.", statusCode: 409 };
  }
  if (draft.status === "rejected") {
    return { ok: false, error: "Abgelehnte Entwürfe können nicht erneut geprüft werden.", statusCode: 400 };
  }

  const shopwareSettings = await storage.getShopwareSettings(tenantId);
  if (!shopwareSettings) return { ok: false, error: "Shopware settings not configured", statusCode: 400 };

  const agentComm = await getCommercialAgentSettings(storage);
  const extractedData = structuredClone(draft.extractedData ?? {}) as Record<string, unknown> & {
    lineItems?: Array<{ extractedProductName: string; extractedProductNumber?: string; quantity: number }>;
  };
  const previousItems = (draft.matchingResults?.items ?? []) as MatchItem[];
  const lineItems = Array.isArray(extractedData.lineItems) ? extractedData.lineItems : [];

  // 1) Produktabgleich
  let matchingResults: DraftMatching | null = draft.matchingResults ?? null;
  if (lineItems.length > 0) {
    const hints = await buildCommercialProductLearningHints({ storage, tenantId, lineItems });
    const fresh = await matchProductsAgainstCatalog(
      lineItems,
      shopwareSettings.shopwareUrl,
      shopwareSettings.apiKey,
      shopwareSettings.apiSecret,
      {
        lineItemSixDigitGtinPrefixes: agentComm.lineItemSixDigitGtinPrefixes ?? [],
        learnedBlockedLineKeys: hints.blockedLineKeys,
        learnedPreferredIdentifierByLineKey: hints.preferredIdentifierByLineKey,
      }
    );
    if (fresh?.items?.length) {
      await applyProductScreeningToOfferMatching(fresh, lineItems as never);
    }
    const items = mergeLineMatches(previousItems, (fresh?.items ?? []) as MatchItem[], lineItems.length);
    matchingResults = { ...(fresh ?? {}), items, overallConfidence: overallConfidence(items) } as DraftMatching;
  }

  // 2) Kundenzuordnung (nicht bei manueller Zuordnung im Review)
  const customerBefore = draft.shopwareCustomerId ?? null;
  const customer = (extractedData.customer ?? {}) as Record<string, unknown>;
  const customerKeptManual =
    Boolean(customerBefore) && (customer.manuallyAssigned === true || !customer.emailResolution);
  let customerAfter = customerBefore;
  if (!customerKeptManual) {
    const emailContext = resetCustomerResolution(extractedData);
    if (shouldRunShopwareCustomerResolutionForDraft(extractedData as never, emailContext)) {
      const aiSettings = await getAISettings(storage);
      const resolved = await resolveShopwareCustomerForDraft(new ShopwareClient(shopwareSettings), extractedData as never, {
        emailContext,
        // Keine LLM-Disambiguierung beim Nachprüfen: deterministisch und ohne Mailtext reproduzierbar.
        openaiClient: null,
        allowLlmDisambiguation: false,
        customerMatchAutoMinConfidence: agentComm.customerMatchAutoMinConfidence,
        customerAutoCreateMinConfidence: agentComm.customerAutoCreateMinConfidence,
        minRankedEmailScoreForAutoCreate: agentComm.minRankedEmailScoreForAutoCreate,
        allowCustomerAutoCreate: agentComm.customerAutoCreateEnabled === true && aiSettings.mode !== "local_only",
      });
      customerAfter = resolved ?? null;
    }
  }

  const status = draft.status === "approved" && countMatched(matchingResults?.items) < lineItems.length
    ? "review_required"
    : draft.status;

  let updated = await storage.updateOrderDraft(
    draftId,
    { extractedData: extractedData as never, matchingResults: matchingResults as never, shopwareCustomerId: customerAfter, status },
    tenantId
  );
  if (!updated) return { ok: false, error: "Order draft not found", statusCode: 404 };

  const summary: Extract<RecheckOrderDraftResult, { ok: true }>["summary"] = {
    matchedBefore: countMatched(previousItems),
    matchedAfter: countMatched(matchingResults?.items),
    lines: lineItems.length,
    customerBefore,
    customerAfter,
    customerChanged: customerBefore !== customerAfter,
    customerKeptManual,
  };

  // 3) Optional (Automation): Strikt-Auto-Create erneut bewerten und ggf. anlegen
  if (options.autoCreate) {
    const strict = await runStrictCommercialAutoCreateIfAllowed({
      storage,
      tenantId,
      draftId,
      draftKind: "order",
      agentSettings: agentComm,
      extractedData: structuredClone(updated.extractedData ?? {}) as Record<string, unknown>,
      matchingResults: (updated.matchingResults ?? null) as MatchingResult | null,
      shopwareCustomerId: updated.shopwareCustomerId ?? null,
      intent: {
        intent: String(extractedData.commercialIntent ?? "purchase_order"),
        confidence: Number(extractedData.commercialIntentConfidence ?? 1),
      },
    });
    summary.autoCreate = {
      attempted: strict.strictAllowed,
      created: strict.shopwareCreated,
      orderId: strict.shopwareEntityId,
      reasons: strict.strictReasons,
      error: strict.shopwareError,
    };
    updated = (await storage.getOrderDraft(draftId, tenantId)) ?? updated;
  }

  return { ok: true, draft: updated, summary };
}
