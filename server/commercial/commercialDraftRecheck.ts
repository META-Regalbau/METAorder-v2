/**
 * „Nochmal prüfen" für KI-Bestell- und Angebotsentwürfe: wiederholt Produktabgleich und Kundenzuordnung
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
import type { IStorage } from "../storage";
import type { OfferDraft, OrderDraft } from "@shared/schema";
import type { MatchingResult } from "../products/productMatcher";
import { getAISettings, getCommercialAgentSettings } from "../ai/aiConfig";
import { matchProductsAgainstCatalog } from "../products/productMatcher";
import { applyProductScreeningToOfferMatching } from "../extraction/lineItemProductScreening";
import { buildCommercialProductLearningHints } from "./commercialProductLearning";
import {
  resolveShopwareCustomerForDraft,
  shouldRunShopwareCustomerResolutionForDraft,
} from "./draftCustomerEmailResolution";
import { runStrictCommercialAutoCreateIfAllowed } from "./commercialStrictAutoCreateRunner";
import { ShopwareClient } from "../shopware/shopware";
import { runDraftClipSpecRowsStep } from "./draftClipSpecRows";
import { fillMissingOfferCatalogPrices } from "./offerDraftCatalogPrices";

type DraftMatching = NonNullable<OrderDraft["matchingResults"]>;
type MatchItem = DraftMatching["items"][number];

export type RecheckDraftKind = "order" | "offer";

export type RecheckOrderDraftResult<D = OrderDraft> =
  | {
      ok: true;
      draft: D;
      summary: {
        matchedBefore: number;
        matchedAfter: number;
        /** Positionen mit Artikelvorschlag, noch nicht bestätigt (KI, Konfigurator, CLIP-Maße) */
        suggestedAfter: number;
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

function countSuggested(items: MatchItem[] | undefined): number {
  return (items ?? []).filter((i) => i.status !== "matched" && i.matchedProduct).length;
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
    if (next.matchedProduct && old.matchedProduct && old.matchedProduct.id === next.matchedProduct.id) {
      // Gleicher Artikel: manueller Preis und (Angebot) Katalog-/Vorschlagspreis bleiben
      const from = old.matchedProduct as Record<string, unknown>;
      const to = next.matchedProduct as Record<string, unknown>;
      for (const key of ["manualUnitPriceNet", "manualPriceChangedBy", "manualPriceChangedAt", "catalogPrice", "suggestedPrice", "suggestedDiscount"]) {
        if (from[key] !== undefined && to[key] === undefined) to[key] = from[key];
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

type RecheckOptions = { tenantId?: string | null; autoCreate?: boolean };

export function recheckOrderDraft(storage: IStorage, draftId: string, options: RecheckOptions = {}) {
  return recheckDraft<OrderDraft>(storage, "order", draftId, options);
}

export function recheckOfferDraft(storage: IStorage, draftId: string, options: RecheckOptions = {}) {
  return recheckDraft<OfferDraft>(storage, "offer", draftId, options);
}

async function recheckDraft<D extends OrderDraft | OfferDraft>(
  storage: IStorage,
  kind: RecheckDraftKind,
  draftId: string,
  options: RecheckOptions
): Promise<RecheckOrderDraftResult<D>> {
  const tenantId = options.tenantId ?? null;
  const load = async () =>
    (kind === "order" ? await storage.getOrderDraft(draftId, tenantId) : await storage.getOfferDraft(draftId, tenantId)) as D | undefined;
  const draft = await load();
  if (!draft) return { ok: false, error: kind === "order" ? "Order draft not found" : "Offer draft not found", statusCode: 404 };
  const createdId = kind === "order" ? (draft as OrderDraft).shopwareOrderId : (draft as OfferDraft).shopwareOfferId;
  if (draft.status === "created" || createdId) {
    return {
      ok: false,
      error: kind === "order" ? "Aus diesem Entwurf wurde bereits eine Bestellung angelegt." : "Aus diesem Entwurf wurde bereits ein Angebot angelegt.",
      statusCode: 409,
    };
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
  const previousItems = ((draft.matchingResults as DraftMatching | null)?.items ?? []) as MatchItem[];
  const lineItems = Array.isArray(extractedData.lineItems) ? extractedData.lineItems : [];

  // 1) Produktabgleich
  let matchingResults = (draft.matchingResults ?? null) as DraftMatching | null;
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
    matchingResults = { ...(fresh ?? {}), items } as DraftMatching;
    // CLIP-Kurzbezeichnungen + Maße (auch aus documentExtraction älterer Entwürfe)
    await runDraftClipSpecRowsStep({ extractedData, matchingResults: matchingResults as unknown as MatchingResult });
    if (kind === "offer") fillMissingOfferCatalogPrices(matchingResults.items as never);
    matchingResults.overallConfidence = overallConfidence(matchingResults.items as MatchItem[]);
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

  const updates = { extractedData: extractedData as never, matchingResults: matchingResults as never, shopwareCustomerId: customerAfter, status };
  let updated = (kind === "order"
    ? await storage.updateOrderDraft(draftId, updates, tenantId)
    : await storage.updateOfferDraft(draftId, updates, tenantId)) as D | undefined;
  if (!updated) return { ok: false, error: kind === "order" ? "Order draft not found" : "Offer draft not found", statusCode: 404 };

  const summary: Extract<RecheckOrderDraftResult<D>, { ok: true }>["summary"] = {
    matchedBefore: countMatched(previousItems),
    matchedAfter: countMatched(matchingResults?.items),
    suggestedAfter: countSuggested(matchingResults?.items),
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
      draftKind: kind,
      agentSettings: agentComm,
      extractedData: structuredClone(updated.extractedData ?? {}) as Record<string, unknown>,
      matchingResults: (updated.matchingResults ?? null) as MatchingResult | null,
      shopwareCustomerId: updated.shopwareCustomerId ?? null,
      intent: {
        intent: String(extractedData.commercialIntent ?? (kind === "order" ? "purchase_order" : "quote_request")),
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
    updated = (await load()) ?? updated;
  }

  return { ok: true, draft: updated, summary };
}
