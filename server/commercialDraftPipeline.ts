import fs from "fs/promises";
import type { IStorage } from "./storage";
import type { OfferDraft, OrderDraft } from "@shared/schema";
import { getAISettings, getCommercialAgentSettings } from "./aiConfig";
import { extractOrderDataFromDocument } from "./orderDraftExtractor";
import { extractOfferDataFromDocument } from "./offerDraftExtractor";
import { matchProductsAgainstCatalog } from "./productMatcher";
import { generateSmartPricing } from "./smartPricingEngine";
import { applyProductScreeningToOfferMatching } from "./lineItemProductScreening";
import {
  resolveShopwareCustomerForDraft,
  shouldRunShopwareCustomerResolutionForDraft,
} from "./draftCustomerEmailResolution";
import { maybeEnrichExtractedDataFromSignatureImages } from "./signatureCompanyVision";
import { enrichExtractedDataWithWebDomainVerification } from "./domainWebVerification";
import { enrichExtractedDataWithCompanyHeuristic } from "./companyNameAgent";
import { ensureLegacyBuyerContactMapping } from "./buyerContactFieldUtils";
import {
  refreshCommercialAddressReviewHints,
  runCommercialExtractionNormalizeSteps,
  runCommercialExtractionPlausibilitySteps,
  type ExtractionAgentTraceEntry,
} from "./commercialExtractionOrchestrator";
import { maybeRunCommercialExtractionRefinement } from "./commercialExtractionRefinement";
import { buildCommercialProductLearningHints } from "./commercialProductLearning";
import { mergeSuspectedSplitTableLineItemsInto } from "./commercialLineItemTableMerge";
import {
  extractPlainTextForDraft,
  normalizeMimeTypeForDraft,
} from "./documentTextExtraction";

export type DraftPipelineTimings = Record<string, number>;

async function resolvePipelinePrimaryDocumentText(params: {
  primaryDocumentText?: string | null;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  ocrEnabled: boolean;
}): Promise<string | null> {
  const preset = params.primaryDocumentText?.trim();
  if (preset) return preset;
  try {
    const text = await extractPlainTextForDraft({
      fileBuffer: params.fileBuffer,
      mimeType: normalizeMimeTypeForDraft(params.fileName, params.mimeType),
      fileName: params.fileName,
      ocrEnabled: params.ocrEnabled,
    });
    return text?.trim() || null;
  } catch (e) {
    console.warn("[Commercial Draft Pipeline] primary document text extraction failed:", e);
    return null;
  }
}

function runCompanyNameHeuristicStep(
  extractedData: Record<string, unknown>,
  input: {
    primaryDocumentText?: string | null;
    emailContext?: string;
    siblingPdfExcerpts?: string;
  }
): void {
  enrichExtractedDataWithCompanyHeuristic({
    extractedData,
    primaryDocumentText: input.primaryDocumentText,
    emailContext: input.emailContext,
    siblingPdfExcerpts: input.siblingPdfExcerpts,
  });
}

function buyerContactFieldsIncomplete(extractedData: Record<string, unknown>): boolean {
  const bill = extractedData.billingAddress as Record<string, string | undefined> | undefined;
  const cust = extractedData.customer as Record<string, string | undefined> | undefined;
  const hasCompany = Boolean(bill?.company?.trim() || cust?.company?.trim());
  const hasStreet = Boolean(bill?.street?.trim());
  const hasCity = Boolean(bill?.city?.trim());
  return !hasCompany || !hasStreet || !hasCity;
}

async function resolveOpenAIClient(storage: IStorage) {
  const aiSettings = await getAISettings(storage);
  if (aiSettings.mode === "local_only") {
    return { aiSettings, openaiClient: null as import("openai").default | null };
  }
  try {
    const openaiSettings = await storage.getSetting("openai_settings");
    const { getOpenAIClient } = await import("./openaiClient");
    const openaiConfig = getOpenAIClient(openaiSettings?.apiKey);
    return { aiSettings, openaiClient: openaiConfig.client };
  } catch {
    return { aiSettings, openaiClient: null as import("openai").default | null };
  }
}

function normalizeLineItems<T extends { lineItems?: unknown }>(extractedData: T) {
  if (extractedData.lineItems && !Array.isArray(extractedData.lineItems)) {
    (extractedData as any).lineItems = Object.values(extractedData.lineItems as object);
  }
}

export type RunOfferDraftPipelineParams = {
  storage: IStorage;
  tenantId?: string | null;
  filePath: string;
  originalFileName: string;
  mimeType: string;
  createdByUserId: string;
  /** Commercial Agent: Betreff + E-Mail-Text derselben Nachricht */
  emailContext?: string;
  /** Commercial Agent: kombinierter Text weiterer Anhänge derselben Mail */
  siblingPdfExcerpts?: string;
  /** Optional: Hauptdokument-Text ohne erneute Dateiextraktion */
  primaryDocumentText?: string | null;
  /** Klassifikation Angebot vs. Bestellung (Commercial Agent / manueller Unified-Upload) */
  commercialIntentMetadata?: CommercialIntentPipelineMetadata | null;
  /** Optional: kleine Bilder aus derselben E-Mail (Signatur) für Firmenname per Vision */
  signatureImageBuffers?: Array<{ buffer: Buffer; mimeType: string }>;
};

export type CommercialIntentPipelineMetadata = {
  intent: "quote_request" | "purchase_order" | "unclear";
  confidence: number;
  rationale?: string;
  intentRoutedAsOfferDueToPermission?: boolean;
  /** Abgleich mit fester Upload-Route (Angebots- vs. Bestell-Upload) */
  uploadExpectedPipeline?: "offer" | "order";
  /** Vorschlag von n8n (Gmail Quick-Classifier), nur informativ + leichter Intent-Boost */
  uploadHint?: "offer" | "order" | "unclear";
};

function applyCommercialIntentToExtractedData(
  extractedData: Record<string, unknown>,
  meta?: CommercialIntentPipelineMetadata | null
) {
  if (!meta) return;
  extractedData.commercialIntent = meta.intent;
  extractedData.commercialIntentConfidence = meta.confidence;
  if (meta.rationale) extractedData.commercialIntentRationale = meta.rationale;
  if (meta.intentRoutedAsOfferDueToPermission) {
    extractedData.commercialIntentRoutedAsOfferDueToPermission = true;
  }
  if (meta.uploadExpectedPipeline === "order" && meta.intent === "quote_request" && meta.confidence >= 0.55) {
    extractedData.commercialIntentVsUploadMismatch = true;
  }
  if (meta.uploadExpectedPipeline === "offer" && meta.intent === "purchase_order" && meta.confidence >= 0.55) {
    extractedData.commercialIntentVsUploadMismatch = true;
  }
  if (meta.uploadHint) {
    extractedData.commercialIntentUploadHint = meta.uploadHint;
  }
}

export async function runOfferDraftPipeline(
  params: RunOfferDraftPipelineParams
): Promise<{ draft: OfferDraft; timings: DraftPipelineTimings }> {
  const {
    storage,
    tenantId,
    filePath,
    originalFileName,
    mimeType,
    createdByUserId,
    emailContext,
    siblingPdfExcerpts,
    primaryDocumentText,
    commercialIntentMetadata,
    signatureImageBuffers,
  } = params;
  const shopwareSettings = await storage.getShopwareSettings(tenantId ?? null);
  if (!shopwareSettings) {
    throw new Error("Shopware settings not configured");
  }

  const agentComm = await getCommercialAgentSettings(storage);

  const { aiSettings, openaiClient } = await resolveOpenAIClient(storage);
  if (aiSettings.mode === "openai_only" && !openaiClient) {
    throw new Error("OpenAI integration not available");
  }

  const requestStart = Date.now();
  const timings: DraftPipelineTimings = {};
  const stepStart = () => Date.now();

  const fileBuffer = await fs.readFile(filePath);
  const resolvedPrimaryDocumentText = await resolvePipelinePrimaryDocumentText({
    primaryDocumentText,
    fileBuffer,
    fileName: originalFileName,
    mimeType,
    ocrEnabled: aiSettings.ocrEnabled,
  });

  const extractionStart = stepStart();
  const extractedData = await extractOfferDataFromDocument(fileBuffer, originalFileName, mimeType, {
    mode: aiSettings.mode,
    openaiClient,
    redactPromptPII: aiSettings.redactPII,
    debugStore: aiSettings.debugStore,
    maxInputChars: aiSettings.maxInputChars,
    ocrEnabled: aiSettings.ocrEnabled,
    emailContext,
    siblingPdfExcerpts,
    primaryDocumentText: resolvedPrimaryDocumentText,
  });
  timings.extractionMs = Date.now() - extractionStart;
  normalizeLineItems(extractedData);
  mergeSuspectedSplitTableLineItemsInto(extractedData);

  // Deterministische Firmenname-Heuristik VOR den Normalize-Steps:
  // - läuft offline (Regex auf Footer-Marker + Rechtsform-Suffixe)
  // - befüllt nur leere `customer.company` / `billingAddress.company`
  // - das nachfolgende `blockMetaOwnCompaniesFromBuyer` bleibt aktiv und
  //   würde einen META-eigenen Heuristik-Treffer ohnehin wieder entfernen.
  if (agentComm.companyNameHeuristicEnabled !== false) {
    const chStart = stepStart();
    try {
      runCompanyNameHeuristicStep(extractedData as Record<string, unknown>, {
        primaryDocumentText: resolvedPrimaryDocumentText,
        emailContext,
        siblingPdfExcerpts,
      });
    } catch (e) {
      console.warn("[Offer Draft Pipeline] companyNameHeuristic failed:", e);
    }
    timings.companyNameHeuristicMs = Date.now() - chStart;
  }

  const extractionTrace: ExtractionAgentTraceEntry[] = [];
  const orchMeta = runCommercialExtractionNormalizeSteps(extractedData as Record<string, unknown>, {
    kind: "offer",
    timings,
    trace: extractionTrace,
    lineItemSixDigitGtinPrefixes: agentComm.lineItemSixDigitGtinPrefixes ?? [],
  });
  applyCommercialIntentToExtractedData(extractedData as Record<string, unknown>, commercialIntentMetadata ?? null);

  if (agentComm.webDomainVerifyEnabled) {
    const wStart = stepStart();
    try {
      await enrichExtractedDataWithWebDomainVerification(extractedData as Record<string, unknown>, {
        emailContext,
        siblingPdfExcerpts,
        enabled: true,
      });
    } catch (e) {
      console.warn("[Offer Draft Pipeline] webDomainVerification failed:", e);
    }
    timings.webDomainVerifyMs = Date.now() - wStart;
  }

  runCommercialExtractionPlausibilitySteps(extractedData as Record<string, unknown>, {
    timings,
    trace: extractionTrace,
    qtyZeroLineIndices: orchMeta.qtyZeroLineIndices,
  });
  await maybeRunCommercialExtractionRefinement({
    extractedData: extractedData as Record<string, unknown>,
    openai: openaiClient,
    enabled: Boolean(agentComm.extractionRefinementSubAgentsEnabled),
    aiMode: aiSettings.mode,
    emailContext,
    siblingPdfExcerpts,
    timings,
  });
  refreshCommercialAddressReviewHints(extractedData as Record<string, unknown>);
  ensureLegacyBuyerContactMapping(extractedData as Record<string, unknown>);

  if (
    agentComm.companyNameHeuristicEnabled !== false &&
    buyerContactFieldsIncomplete(extractedData as Record<string, unknown>)
  ) {
    try {
      runCompanyNameHeuristicStep(extractedData as Record<string, unknown>, {
        primaryDocumentText: resolvedPrimaryDocumentText,
        emailContext,
        siblingPdfExcerpts,
      });
      ensureLegacyBuyerContactMapping(extractedData as Record<string, unknown>);
    } catch (e) {
      console.warn("[Offer Draft Pipeline] companyNameHeuristic retry failed:", e);
    }
  }

  if (
    signatureImageBuffers?.length &&
    agentComm.signatureCompanyVisionEnabled &&
    aiSettings.mode !== "local_only" &&
    openaiClient
  ) {
    const vStart = stepStart();
    try {
      await maybeEnrichExtractedDataFromSignatureImages({
        openai: openaiClient,
        images: signatureImageBuffers,
        extractedData: extractedData as Record<string, unknown>,
      });
    } catch (e) {
      console.warn("[Offer Draft Pipeline] signatureCompanyVision failed:", e);
    }
    timings.signatureCompanyVisionMs = Date.now() - vStart;
  }
  ensureLegacyBuyerContactMapping(extractedData as Record<string, unknown>);

  let matchingResults: Awaited<ReturnType<typeof matchProductsAgainstCatalog>> | Record<string, unknown> | null =
    null;
  const offerLearningHints =
    extractedData.lineItems && extractedData.lineItems.length > 0
      ? await buildCommercialProductLearningHints({
          storage,
          tenantId: tenantId ?? null,
          lineItems: extractedData.lineItems,
        })
      : { blockedLineKeys: [], preferredIdentifierByLineKey: {} };
  if (extractedData.lineItems && Array.isArray(extractedData.lineItems) && extractedData.lineItems.length > 0) {
    const matchingStart = stepStart();
    let baseMatching = await matchProductsAgainstCatalog(
      extractedData.lineItems,
      shopwareSettings.shopwareUrl,
      shopwareSettings.apiKey,
      shopwareSettings.apiSecret,
      {
        lineItemSixDigitGtinPrefixes: agentComm.lineItemSixDigitGtinPrefixes ?? [],
        learnedBlockedLineKeys: offerLearningHints.blockedLineKeys,
        learnedPreferredIdentifierByLineKey: offerLearningHints.preferredIdentifierByLineKey,
      }
    );
    timings.matchingMs = Date.now() - matchingStart;

    if (baseMatching?.items?.length && extractedData.lineItems) {
      const screenStart = stepStart();
      await applyProductScreeningToOfferMatching(baseMatching, extractedData.lineItems);
      timings.productScreeningMs = Date.now() - screenStart;
    }

    if (baseMatching?.items?.length) {
      try {
        const { ShopwareClient } = await import("./shopware");
        const shopwareClient = new ShopwareClient({
          shopwareUrl: shopwareSettings.shopwareUrl,
          apiKey: shopwareSettings.apiKey,
          apiSecret: shopwareSettings.apiSecret,
        });
        const useOpenAIForPricing =
          aiSettings.mode !== "local_only" &&
          openaiClient &&
          baseMatching.overallConfidence < aiSettings.lowConfidenceThreshold;
        const pricingClient = useOpenAIForPricing ? openaiClient ?? undefined : undefined;
        const pricingStart = stepStart();
        const pricingData = await generateSmartPricing(
          baseMatching.items,
          extractedData.customer?.email,
          pricingClient,
          shopwareClient
        );
        timings.pricingMs = Date.now() - pricingStart;
        matchingResults = {
          ...baseMatching,
          items: pricingData.items,
          pricingRecommendations: pricingData.pricingRecommendations,
        };
      } catch (pricingError) {
        console.warn(`[Offer Draft Pipeline] Smart pricing failed:`, pricingError);
        matchingResults = baseMatching;
      }
    } else if (baseMatching) {
      matchingResults = baseMatching;
    }
  }

  let shopwareCustomerId: string | null = null;
  if (shouldRunShopwareCustomerResolutionForDraft(extractedData, emailContext, siblingPdfExcerpts)) {
    try {
      const { ShopwareClient } = await import("./shopware");
      const shopwareClient = new ShopwareClient({
        shopwareUrl: shopwareSettings.shopwareUrl,
        apiKey: shopwareSettings.apiKey,
        apiSecret: shopwareSettings.apiSecret,
      });
      const allowLlm = aiSettings.mode !== "local_only" && !!openaiClient;
      shopwareCustomerId = await resolveShopwareCustomerForDraft(shopwareClient, extractedData, {
        emailContext,
        siblingPdfExcerpts,
        openaiClient: allowLlm ? openaiClient : null,
        allowLlmDisambiguation: allowLlm,
        customerMatchAutoMinConfidence: agentComm.customerMatchAutoMinConfidence,
        customerAutoCreateMinConfidence: agentComm.customerAutoCreateMinConfidence,
        minRankedEmailScoreForAutoCreate: agentComm.minRankedEmailScoreForAutoCreate,
      });
    } catch (e) {
      console.error(`[Offer Draft Pipeline] Customer error:`, e);
    }
  }
  ensureLegacyBuyerContactMapping(extractedData as Record<string, unknown>);

  let status = "pending";
  const offerOverall =
    matchingResults && typeof (matchingResults as { overallConfidence?: number }).overallConfidence === "number"
      ? (matchingResults as { overallConfidence: number }).overallConfidence
      : undefined;
  if (offerOverall !== undefined) {
    if (offerOverall >= 90) status = "approved";
    else if (offerOverall >= 60) status = "review_required";
    else status = "review_required";
  }

  const minIntentReview = agentComm.intentReviewMinConfidence ?? 0.6;
  if (commercialIntentMetadata) {
    const m = commercialIntentMetadata;
    const lowIntent = m.confidence < minIntentReview || m.intent === "unclear";
    const mismatch = Boolean((extractedData as { commercialIntentVsUploadMismatch?: boolean }).commercialIntentVsUploadMismatch);
    if (lowIntent || m.intentRoutedAsOfferDueToPermission || mismatch) {
      status = "review_required";
    }
  }

  const draft = await storage.createOfferDraft(
    {
      status,
      originalFileName,
      originalFilePath: filePath,
      extractedData,
      matchingResults: matchingResults as OfferDraft["matchingResults"],
      shopwareCustomerId,
      shopwareOfferId: null,
      createdByUserId,
    },
    tenantId ?? null
  );

  timings.totalMs = Date.now() - requestStart;
  return { draft, timings };
}

export type RunOrderDraftPipelineParams = RunOfferDraftPipelineParams;

export async function runOrderDraftPipeline(
  params: RunOfferDraftPipelineParams
): Promise<{ draft: OrderDraft; timings: DraftPipelineTimings }> {
  const {
    storage,
    tenantId,
    filePath,
    originalFileName,
    mimeType,
    createdByUserId,
    emailContext,
    siblingPdfExcerpts,
    primaryDocumentText,
    commercialIntentMetadata,
    signatureImageBuffers,
  } = params;
  const shopwareSettings = await storage.getShopwareSettings(tenantId ?? null);
  if (!shopwareSettings) {
    throw new Error("Shopware settings not configured");
  }

  const agentComm = await getCommercialAgentSettings(storage);

  const { aiSettings, openaiClient } = await resolveOpenAIClient(storage);
  if (aiSettings.mode === "openai_only" && !openaiClient) {
    throw new Error("OpenAI integration not available");
  }

  const requestStart = Date.now();
  const timings: DraftPipelineTimings = {};
  const stepStart = () => Date.now();

  const fileBuffer = await fs.readFile(filePath);
  const resolvedPrimaryDocumentText = await resolvePipelinePrimaryDocumentText({
    primaryDocumentText,
    fileBuffer,
    fileName: originalFileName,
    mimeType,
    ocrEnabled: aiSettings.ocrEnabled,
  });

  const extractionStart = stepStart();
  const extractedData = await extractOrderDataFromDocument(fileBuffer, originalFileName, mimeType, {
    mode: aiSettings.mode,
    openaiClient,
    redactPromptPII: aiSettings.redactPII,
    debugStore: aiSettings.debugStore,
    maxInputChars: aiSettings.maxInputChars,
    ocrEnabled: aiSettings.ocrEnabled,
    emailContext,
    siblingPdfExcerpts,
    primaryDocumentText: resolvedPrimaryDocumentText,
  });
  timings.extractionMs = Date.now() - extractionStart;
  normalizeLineItems(extractedData);
  mergeSuspectedSplitTableLineItemsInto(extractedData);

  // Deterministische Firmenname-Heuristik (gleiche Konvention wie in der
  // Offer-Pipeline) — siehe ausführlichen Kommentar dort.
  if (agentComm.companyNameHeuristicEnabled !== false) {
    const chStart = stepStart();
    try {
      runCompanyNameHeuristicStep(extractedData as Record<string, unknown>, {
        primaryDocumentText: resolvedPrimaryDocumentText,
        emailContext,
        siblingPdfExcerpts,
      });
    } catch (e) {
      console.warn("[Order Draft Pipeline] companyNameHeuristic failed:", e);
    }
    timings.companyNameHeuristicMs = Date.now() - chStart;
  }

  const orderExtractionTrace: ExtractionAgentTraceEntry[] = [];
  const orderOrchMeta = runCommercialExtractionNormalizeSteps(extractedData as Record<string, unknown>, {
    kind: "order",
    timings,
    trace: orderExtractionTrace,
    lineItemSixDigitGtinPrefixes: agentComm.lineItemSixDigitGtinPrefixes ?? [],
  });
  applyCommercialIntentToExtractedData(extractedData as Record<string, unknown>, commercialIntentMetadata ?? null);

  if (agentComm.webDomainVerifyEnabled) {
    const wStart = stepStart();
    try {
      await enrichExtractedDataWithWebDomainVerification(extractedData as Record<string, unknown>, {
        emailContext,
        siblingPdfExcerpts,
        enabled: true,
      });
    } catch (e) {
      console.warn("[Order Draft Pipeline] webDomainVerification failed:", e);
    }
    timings.webDomainVerifyMs = Date.now() - wStart;
  }

  runCommercialExtractionPlausibilitySteps(extractedData as Record<string, unknown>, {
    timings,
    trace: orderExtractionTrace,
    qtyZeroLineIndices: orderOrchMeta.qtyZeroLineIndices,
  });
  await maybeRunCommercialExtractionRefinement({
    extractedData: extractedData as Record<string, unknown>,
    openai: openaiClient,
    enabled: Boolean(agentComm.extractionRefinementSubAgentsEnabled),
    aiMode: aiSettings.mode,
    emailContext,
    siblingPdfExcerpts,
    timings,
  });
  refreshCommercialAddressReviewHints(extractedData as Record<string, unknown>);
  ensureLegacyBuyerContactMapping(extractedData as Record<string, unknown>);

  if (
    agentComm.companyNameHeuristicEnabled !== false &&
    buyerContactFieldsIncomplete(extractedData as Record<string, unknown>)
  ) {
    try {
      runCompanyNameHeuristicStep(extractedData as Record<string, unknown>, {
        primaryDocumentText: resolvedPrimaryDocumentText,
        emailContext,
        siblingPdfExcerpts,
      });
      ensureLegacyBuyerContactMapping(extractedData as Record<string, unknown>);
    } catch (e) {
      console.warn("[Order Draft Pipeline] companyNameHeuristic retry failed:", e);
    }
  }

  if (
    signatureImageBuffers?.length &&
    agentComm.signatureCompanyVisionEnabled &&
    aiSettings.mode !== "local_only" &&
    openaiClient
  ) {
    const vStartOrder = stepStart();
    try {
      await maybeEnrichExtractedDataFromSignatureImages({
        openai: openaiClient,
        images: signatureImageBuffers,
        extractedData: extractedData as Record<string, unknown>,
      });
    } catch (e) {
      console.warn("[Order Draft Pipeline] signatureCompanyVision failed:", e);
    }
    timings.signatureCompanyVisionMs = Date.now() - vStartOrder;
  }
  ensureLegacyBuyerContactMapping(extractedData as Record<string, unknown>);

  let matchingResults = null as Awaited<ReturnType<typeof matchProductsAgainstCatalog>> | null;
  const orderLearningHints =
    extractedData.lineItems && extractedData.lineItems.length > 0
      ? await buildCommercialProductLearningHints({
          storage,
          tenantId: tenantId ?? null,
          lineItems: extractedData.lineItems,
        })
      : { blockedLineKeys: [], preferredIdentifierByLineKey: {} };
  if (extractedData.lineItems && Array.isArray(extractedData.lineItems) && extractedData.lineItems.length > 0) {
    const matchingStart = stepStart();
    matchingResults = await matchProductsAgainstCatalog(
      extractedData.lineItems,
      shopwareSettings.shopwareUrl,
      shopwareSettings.apiKey,
      shopwareSettings.apiSecret,
      {
        lineItemSixDigitGtinPrefixes: agentComm.lineItemSixDigitGtinPrefixes ?? [],
        learnedBlockedLineKeys: orderLearningHints.blockedLineKeys,
        learnedPreferredIdentifierByLineKey: orderLearningHints.preferredIdentifierByLineKey,
      }
    );
    timings.matchingMs = Date.now() - matchingStart;

    if (matchingResults?.items?.length && extractedData.lineItems) {
      const screenStart = stepStart();
      await applyProductScreeningToOfferMatching(matchingResults, extractedData.lineItems);
      timings.productScreeningMs = (timings.productScreeningMs ?? 0) + (Date.now() - screenStart);
    }
  }

  let shopwareCustomerId: string | null = null;
  if (shouldRunShopwareCustomerResolutionForDraft(extractedData, emailContext, siblingPdfExcerpts)) {
    try {
      const { ShopwareClient } = await import("./shopware");
      const shopwareClient = new ShopwareClient({
        shopwareUrl: shopwareSettings.shopwareUrl,
        apiKey: shopwareSettings.apiKey,
        apiSecret: shopwareSettings.apiSecret,
      });
      const allowLlmOrder = aiSettings.mode !== "local_only" && !!openaiClient;
      shopwareCustomerId = await resolveShopwareCustomerForDraft(shopwareClient, extractedData, {
        emailContext,
        siblingPdfExcerpts,
        openaiClient: allowLlmOrder ? openaiClient : null,
        allowLlmDisambiguation: allowLlmOrder,
        customerMatchAutoMinConfidence: agentComm.customerMatchAutoMinConfidence,
        customerAutoCreateMinConfidence: agentComm.customerAutoCreateMinConfidence,
        minRankedEmailScoreForAutoCreate: agentComm.minRankedEmailScoreForAutoCreate,
      });
    } catch (e) {
      console.error(`[Order Draft Pipeline] Customer error:`, e);
    }
  }
  ensureLegacyBuyerContactMapping(extractedData as Record<string, unknown>);

  let status = "pending";
  if (matchingResults) {
    if (matchingResults.overallConfidence >= 90) status = "approved";
    else if (matchingResults.overallConfidence >= 60) status = "review_required";
    else status = "review_required";
  }

  const minIntentReviewOrder = agentComm.intentReviewMinConfidence ?? 0.6;
  if (commercialIntentMetadata) {
    const m = commercialIntentMetadata;
    const lowIntent = m.confidence < minIntentReviewOrder || m.intent === "unclear";
    const mismatch = Boolean((extractedData as { commercialIntentVsUploadMismatch?: boolean }).commercialIntentVsUploadMismatch);
    if (lowIntent || m.intentRoutedAsOfferDueToPermission || mismatch) {
      status = "review_required";
    }
  }

  const draft = await storage.createOrderDraft(
    {
      status,
      originalFileName,
      originalFilePath: filePath,
      extractedData,
      matchingResults,
      shopwareCustomerId,
      shopwareOrderId: null,
      createdByUserId,
    },
    tenantId ?? null
  );

  timings.totalMs = Date.now() - requestStart;
  return { draft, timings };
}
