import type { IStorage } from "./storage";

export type AIMode = "local_only" | "openai_optional" | "openai_only";

export type AISettings = {
  mode: AIMode;
  redactPII: boolean;
  debugStore: boolean;
  maxInputChars: number;
  lowConfidenceThreshold: number;
  ocrEnabled: boolean;
};

const DEFAULT_SETTINGS: AISettings = {
  mode: "openai_optional",
  redactPII: false,
  debugStore: false,
  maxInputChars: 20000,
  lowConfidenceThreshold: 60,
  ocrEnabled: true,
};

function parseMode(value?: string | null): AIMode | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "local" || normalized === "local_only") return "local_only";
  if (normalized === "openai" || normalized === "openai_only") return "openai_only";
  if (normalized === "openai_optional" || normalized === "optional") return "openai_optional";
  return null;
}

export async function getAISettings(storage: IStorage): Promise<AISettings> {
  const envMode = parseMode(process.env.AI_MODE);
  const settings = (await storage.getSetting("ai_settings")) || {};
  const storedMode = parseMode(settings.mode);
  const envRedact = process.env.AI_REDACT_PII === "true";
  const envDebug = process.env.AI_DEBUG_STORE === "true";
  const envMaxChars = process.env.AI_MAX_INPUT_CHARS ? Number(process.env.AI_MAX_INPUT_CHARS) : undefined;
  const envLowConfidence = process.env.AI_LOW_CONFIDENCE_THRESHOLD
    ? Number(process.env.AI_LOW_CONFIDENCE_THRESHOLD)
    : undefined;
  const envOcr = process.env.AI_OCR_ENABLED === "false" ? false : undefined;

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    mode: envMode || storedMode || DEFAULT_SETTINGS.mode,
    redactPII: envRedact || settings.redactPII || DEFAULT_SETTINGS.redactPII,
    debugStore: envDebug || settings.debugStore || DEFAULT_SETTINGS.debugStore,
    maxInputChars: envMaxChars || settings.maxInputChars || DEFAULT_SETTINGS.maxInputChars,
    lowConfidenceThreshold: envLowConfidence || settings.lowConfidenceThreshold || DEFAULT_SETTINGS.lowConfidenceThreshold,
    ocrEnabled: envOcr ?? settings.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled,
  } as AISettings;
}

/** E-Mail/PDF Commercial Agent: Intent + Auto-Create in Shopware */
export type CommercialAgentSettings = {
  enabled: boolean;
  /** 0–1, min. Intent-Konfidenz für Auto-Create */
  autoCreateMinIntentConfidence: number;
  /** 0–100, min. Produkt-Match-Gesamtkonfidenz (wie matchingResults.overallConfidence) */
  autoCreateMinMatchConfidence: number;
  autoCreateOffersEnabled: boolean;
  /** Separater Kill-Switch für automatische Shopware-Bestellungen */
  autoCreateOrdersEnabled: boolean;
  /** B2B-Angebot: Sales Channel wenn nicht aus Request */
  autoCreateSalesChannelId: string;
  /** Few-Shot aus gespeicherten Exemplaren in den Intent-Prompt */
  documentLearningEnabled?: boolean;
  /** Sub-Agent (PDF-Fokus) bei unsicherem Intent */
  subAgentsEnabled?: boolean;
  /** Max. Anzahl Exemplare im Prompt */
  exemplarsInPromptMax?: number;
  /** Intent-Konfidenz unterhalb = Entwurf mindestens „Review“ (0–1) */
  intentReviewMinConfidence?: number;
  /** Mindest-Score Kundenzuordnung (0–100) für Auto-Angebot/-Bestellung nach Shopware-Zuordnung oder -Anlage */
  customerMatchAutoMinConfidence?: number;
  /** Mindest-Score (0–100) für automatische Shopware-Kundenanlage bei fehlendem Match — getrennt von Anzeige-Confidence */
  customerAutoCreateMinConfidence?: number;
  /** Mindest-Ranking-Score der Top-E-Mail (Heuristik) für automatische Kundenanlage */
  minRankedEmailScoreForAutoCreate?: number;
  /** Firmenname aus Signatur-Grafik per Vision (OpenAI), nur wenn Firma noch leer */
  signatureCompanyVisionEnabled?: boolean;
  /** HTTPS-Abfrage Firmen-Domain (Impressum/Kontakt) zur Plausibilisierung — kein automatisches Überschreiben */
  webDomainVerifyEnabled?: boolean;
  /** Nach Extraktion: optional kleine LLM-Runde nur für leere Adressfelder (getrennt von Intent-Sub-Agents) */
  extractionRefinementSubAgentsEnabled?: boolean;
  /**
   * Deterministische Firmenname-Heuristik (Regex auf Suffixe wie GmbH, AG,
   * e.K., S.r.l. … + Footer-Bonus + Domain-Match). Läuft offline, ohne
   * OpenAI-Kosten, und befüllt nur leere `company`-Felder.
   */
  companyNameHeuristicEnabled?: boolean;
  /**
   * Nur Strikt-Regel für Auto-Create (kein „weicher“ Intent/Match-Schwellen-Pfad).
   * Default true — siehe commercialStrictAutoCreate.ts
   */
  strictAutoCreateOnly?: boolean;
  /** Mindest-Intent-Konfidenz für Strikt-Auto-Create (0–1). Default 0.95 */
  strictMinIntentConfidence?: number;
  /** Mindest-Kunden-Match-Score (0–100) für Strikt-Auto-Create. Default 95 */
  strictMinCustomerMatchConfidence?: number;
  /**
   * Präfixe für 6-stellige Positionsnummern → synthetische GTIN (Prefix + 6 Ziffern), z. B. ["4026212"].
   * Leer = nur Herstellerartikelnummer / direkte EAN ohne Erweiterung.
   */
  lineItemSixDigitGtinPrefixes?: string[];
};

export const DEFAULT_COMMERCIAL_AGENT: CommercialAgentSettings = {
  enabled: false,
  autoCreateMinIntentConfidence: 0.85,
  autoCreateMinMatchConfidence: 90,
  autoCreateOffersEnabled: true,
  autoCreateOrdersEnabled: false,
  autoCreateSalesChannelId: "",
  documentLearningEnabled: true,
  subAgentsEnabled: true,
  exemplarsInPromptMax: 5,
  intentReviewMinConfidence: 0.6,
  customerMatchAutoMinConfidence: 72,
  /** Nur bei mehreren E-Mail-Kandidaten ohne klaren Abstand relevant (siehe draftCustomerEmailResolution). */
  customerAutoCreateMinConfidence: 40,
  minRankedEmailScoreForAutoCreate: 12,
  signatureCompanyVisionEnabled: false,
  webDomainVerifyEnabled: false,
  extractionRefinementSubAgentsEnabled: false,
  companyNameHeuristicEnabled: true,
  strictAutoCreateOnly: true,
  strictMinIntentConfidence: 0.95,
  strictMinCustomerMatchConfidence: 95,
  lineItemSixDigitGtinPrefixes: [],
};

export async function getCommercialAgentSettings(storage: IStorage): Promise<CommercialAgentSettings> {
  const stored = (await storage.getSetting("commercial_agent_settings")) || {};
  const envEnabled = process.env.COMMERCIAL_AGENT_ENABLED === "true";
  const envOffers = process.env.COMMERCIAL_AGENT_AUTO_OFFERS === "false" ? false : undefined;
  const envOrders = process.env.COMMERCIAL_AGENT_AUTO_ORDERS === "true" ? true : undefined;
  const envIntent = process.env.COMMERCIAL_AGENT_MIN_INTENT_CONFIDENCE
    ? Number(process.env.COMMERCIAL_AGENT_MIN_INTENT_CONFIDENCE)
    : undefined;
  const envMatch = process.env.COMMERCIAL_AGENT_MIN_MATCH_CONFIDENCE
    ? Number(process.env.COMMERCIAL_AGENT_MIN_MATCH_CONFIDENCE)
    : undefined;
  const envChannel = process.env.B2B_SELLERS_DEFAULT_SALES_CHANNEL || process.env.COMMERCIAL_AGENT_SALES_CHANNEL_ID;
  const envLearnOff = process.env.COMMERCIAL_AGENT_LEARNING === "false";
  const envSubOff = process.env.COMMERCIAL_AGENT_SUBAGENTS === "false";
  const envMaxEx = process.env.COMMERCIAL_AGENT_EXEMPLARS_MAX
    ? Number(process.env.COMMERCIAL_AGENT_EXEMPLARS_MAX)
    : undefined;
  const envIntentReview = process.env.COMMERCIAL_AGENT_INTENT_REVIEW_MIN_CONFIDENCE
    ? Number(process.env.COMMERCIAL_AGENT_INTENT_REVIEW_MIN_CONFIDENCE)
    : undefined;
  const envCustMatch = process.env.COMMERCIAL_AGENT_CUSTOMER_MATCH_AUTO_MIN
    ? Number(process.env.COMMERCIAL_AGENT_CUSTOMER_MATCH_AUTO_MIN)
    : undefined;
  const envCustAutoCreate = process.env.COMMERCIAL_AGENT_CUSTOMER_AUTO_CREATE_MIN
    ? Number(process.env.COMMERCIAL_AGENT_CUSTOMER_AUTO_CREATE_MIN)
    : undefined;
  const envMinRankedEmail = process.env.COMMERCIAL_AGENT_MIN_RANKED_EMAIL_SCORE
    ? Number(process.env.COMMERCIAL_AGENT_MIN_RANKED_EMAIL_SCORE)
    : undefined;
  const envSigVision = process.env.COMMERCIAL_AGENT_SIGNATURE_VISION;
  const envSigVisionBool =
    envSigVision === "true" ? true : envSigVision === "false" ? false : undefined;
  const envWebVerify = process.env.COMMERCIAL_AGENT_WEB_VERIFY;
  const envWebVerifyBool =
    envWebVerify === "true" ? true : envWebVerify === "false" ? false : undefined;
  const envExtractionRefinement = process.env.COMMERCIAL_AGENT_EXTRACTION_REFINEMENT;
  const envExtractionRefinementBool =
    envExtractionRefinement === "true" ? true : envExtractionRefinement === "false" ? false : undefined;
  const envCompanyHeuristic = process.env.COMMERCIAL_AGENT_COMPANY_NAME_HEURISTIC;
  const envCompanyHeuristicBool =
    envCompanyHeuristic === "true" ? true : envCompanyHeuristic === "false" ? false : undefined;
  const envStrictOnly = process.env.COMMERCIAL_AGENT_STRICT_AUTO_CREATE;
  const envStrictOnlyBool =
    envStrictOnly === "true" ? true : envStrictOnly === "false" ? false : undefined;
  const envStrictIntent = process.env.COMMERCIAL_AGENT_STRICT_MIN_INTENT
    ? Number(process.env.COMMERCIAL_AGENT_STRICT_MIN_INTENT)
    : undefined;
  const envStrictCustomer = process.env.COMMERCIAL_AGENT_STRICT_MIN_CUSTOMER
    ? Number(process.env.COMMERCIAL_AGENT_STRICT_MIN_CUSTOMER)
    : undefined;
  const envSixDigitPrefixes = process.env.COMMERCIAL_AGENT_SIX_DIGIT_GTIN_PREFIXES;

  return {
    ...DEFAULT_COMMERCIAL_AGENT,
    ...stored,
    enabled: envEnabled || Boolean(stored.enabled),
    autoCreateOffersEnabled: envOffers ?? stored.autoCreateOffersEnabled ?? DEFAULT_COMMERCIAL_AGENT.autoCreateOffersEnabled,
    autoCreateOrdersEnabled: envOrders ?? stored.autoCreateOrdersEnabled ?? DEFAULT_COMMERCIAL_AGENT.autoCreateOrdersEnabled,
    autoCreateMinIntentConfidence:
      (Number.isFinite(envIntent) ? envIntent : undefined) ??
      stored.autoCreateMinIntentConfidence ??
      DEFAULT_COMMERCIAL_AGENT.autoCreateMinIntentConfidence,
    autoCreateMinMatchConfidence:
      (Number.isFinite(envMatch) ? envMatch : undefined) ??
      stored.autoCreateMinMatchConfidence ??
      DEFAULT_COMMERCIAL_AGENT.autoCreateMinMatchConfidence,
    autoCreateSalesChannelId:
      (typeof stored.autoCreateSalesChannelId === "string" ? stored.autoCreateSalesChannelId : "") ||
      (envChannel as string) ||
      "",
    documentLearningEnabled: envLearnOff
      ? false
      : stored.documentLearningEnabled ?? DEFAULT_COMMERCIAL_AGENT.documentLearningEnabled,
    subAgentsEnabled: envSubOff ? false : stored.subAgentsEnabled ?? DEFAULT_COMMERCIAL_AGENT.subAgentsEnabled,
    exemplarsInPromptMax:
      (Number.isFinite(envMaxEx) && envMaxEx! > 0 ? Math.min(12, Math.floor(envMaxEx!)) : undefined) ??
      (typeof stored.exemplarsInPromptMax === "number" && stored.exemplarsInPromptMax > 0
        ? Math.min(12, Math.floor(stored.exemplarsInPromptMax))
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.exemplarsInPromptMax,
    intentReviewMinConfidence:
      (Number.isFinite(envIntentReview) && envIntentReview! >= 0 && envIntentReview! <= 1
        ? envIntentReview
        : undefined) ??
      (typeof stored.intentReviewMinConfidence === "number"
        ? stored.intentReviewMinConfidence
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.intentReviewMinConfidence,
    customerMatchAutoMinConfidence:
      (Number.isFinite(envCustMatch) && envCustMatch! >= 0 && envCustMatch! <= 100
        ? envCustMatch
        : undefined) ??
      (typeof stored.customerMatchAutoMinConfidence === "number"
        ? stored.customerMatchAutoMinConfidence
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.customerMatchAutoMinConfidence,
    customerAutoCreateMinConfidence:
      (Number.isFinite(envCustAutoCreate) &&
      envCustAutoCreate! >= 0 &&
      envCustAutoCreate! <= 100
        ? envCustAutoCreate
        : undefined) ??
      (typeof stored.customerAutoCreateMinConfidence === "number"
        ? stored.customerAutoCreateMinConfidence
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.customerAutoCreateMinConfidence,
    minRankedEmailScoreForAutoCreate:
      (Number.isFinite(envMinRankedEmail) && envMinRankedEmail! >= 0 && envMinRankedEmail! <= 200
        ? envMinRankedEmail
        : undefined) ??
      (typeof stored.minRankedEmailScoreForAutoCreate === "number"
        ? stored.minRankedEmailScoreForAutoCreate
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.minRankedEmailScoreForAutoCreate,
    signatureCompanyVisionEnabled:
      envSigVisionBool ??
      (typeof stored.signatureCompanyVisionEnabled === "boolean"
        ? stored.signatureCompanyVisionEnabled
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.signatureCompanyVisionEnabled,
    webDomainVerifyEnabled:
      envWebVerifyBool ??
      (typeof stored.webDomainVerifyEnabled === "boolean"
        ? stored.webDomainVerifyEnabled
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.webDomainVerifyEnabled,
    extractionRefinementSubAgentsEnabled:
      envExtractionRefinementBool ??
      (typeof stored.extractionRefinementSubAgentsEnabled === "boolean"
        ? stored.extractionRefinementSubAgentsEnabled
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.extractionRefinementSubAgentsEnabled,
    companyNameHeuristicEnabled:
      envCompanyHeuristicBool ??
      (typeof stored.companyNameHeuristicEnabled === "boolean"
        ? stored.companyNameHeuristicEnabled
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.companyNameHeuristicEnabled,
    strictAutoCreateOnly:
      envStrictOnlyBool ??
      (typeof stored.strictAutoCreateOnly === "boolean"
        ? stored.strictAutoCreateOnly
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.strictAutoCreateOnly,
    strictMinIntentConfidence:
      (Number.isFinite(envStrictIntent) && envStrictIntent! >= 0 && envStrictIntent! <= 1
        ? envStrictIntent
        : undefined) ??
      (typeof stored.strictMinIntentConfidence === "number"
        ? stored.strictMinIntentConfidence
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.strictMinIntentConfidence,
    strictMinCustomerMatchConfidence:
      (Number.isFinite(envStrictCustomer) &&
      envStrictCustomer! >= 0 &&
      envStrictCustomer! <= 100
        ? envStrictCustomer
        : undefined) ??
      (typeof stored.strictMinCustomerMatchConfidence === "number"
        ? stored.strictMinCustomerMatchConfidence
        : undefined) ??
      DEFAULT_COMMERCIAL_AGENT.strictMinCustomerMatchConfidence,
    lineItemSixDigitGtinPrefixes: parseSixDigitGtinPrefixes(
      envSixDigitPrefixes,
      stored.lineItemSixDigitGtinPrefixes
    ),
  };
}

function parseSixDigitGtinPrefixes(
  envVal: string | undefined,
  stored: unknown
): string[] {
  if (typeof envVal === "string" && envVal.trim()) {
    return envVal
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(stored)) {
    return stored.map((s) => String(s).trim()).filter(Boolean);
  }
  return DEFAULT_COMMERCIAL_AGENT.lineItemSixDigitGtinPrefixes ?? [];
}
