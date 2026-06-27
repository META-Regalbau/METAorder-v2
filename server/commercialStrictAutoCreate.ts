/**
 * Strikt-Regel für vollautomatisches Anlegen in Shopware („100 %“-Pfad).
 *
 * Alle Bedingungen müssen erfüllt sein — ein einziger Verstoß → Review im UI.
 * Siehe docs/gmail-to-shopware-automation.md
 */

import type { CommercialAgentSettings } from "./aiConfig";
import type { MatchingResult } from "./productMatcher";
import type { LineItemPlausibilityEntry } from "./commercialExtractionOrchestrator";

export const COMMERCIAL_STRICT_AUTO_CREATE_VERSION = "1";

export type StrictAutoCreateIntent = {
  intent: "quote_request" | "purchase_order" | "unclear" | string;
  confidence: number;
};

export type StrictAutoCreateEvaluation = {
  allowed: boolean;
  reasons: string[];
  version: string;
};

function isEmptyField(v: unknown): boolean {
  if (typeof v !== "string") return v == null;
  const s = v.trim();
  if (!s) return true;
  if (/^[-–—.•·]+$/.test(s)) return true;
  if (/^(n\/?a|na|none|unbekannt|unknown)$/i.test(s)) return true;
  return false;
}

function readStr(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Bewertet, ob ein Draft den Strikt-„100 %“-Pfad für Auto-Create erfüllt.
 */
export function evaluateStrictAutoCreate(params: {
  draftKind: "offer" | "order";
  agentSettings: CommercialAgentSettings;
  extractedData: Record<string, unknown>;
  matchingResults?: MatchingResult | null;
  shopwareCustomerId?: string | null;
  intent: StrictAutoCreateIntent;
}): StrictAutoCreateEvaluation {
  const { draftKind, agentSettings, extractedData, matchingResults, shopwareCustomerId, intent } =
    params;
  const reasons: string[] = [];

  if (!agentSettings.enabled) {
    reasons.push("commercial_agent_disabled");
  }

  if (draftKind === "offer" && !agentSettings.autoCreateOffersEnabled) {
    reasons.push("auto_create_offers_disabled");
  }
  if (draftKind === "order" && !agentSettings.autoCreateOrdersEnabled) {
    reasons.push("auto_create_orders_disabled");
  }

  const minIntent = agentSettings.strictMinIntentConfidence ?? 0.95;
  if (intent.intent === "unclear") {
    reasons.push("intent_unclear");
  }
  if (intent.confidence < minIntent) {
    reasons.push(`intent_confidence_below_${minIntent}`);
  }

  const customer = extractedData.customer as Record<string, unknown> | undefined;
  const billing = extractedData.billingAddress as Record<string, unknown> | undefined;

  for (const [label, val] of [
    ["billing.company", readStr(billing, "company")],
    ["billing.street", readStr(billing, "street")],
    ["billing.zipCode", readStr(billing, "zipCode")],
    ["billing.city", readStr(billing, "city")],
    ["billing.country", readStr(billing, "country")],
  ] as const) {
    if (isEmptyField(val)) reasons.push(`missing_${label.replace(".", "_")}`);
  }

  const email = readStr(customer, "email") ?? readStr(billing, "email");
  const phone = readStr(customer, "phone") ?? readStr(billing, "phone");
  if (isEmptyField(email) && isEmptyField(phone)) {
    reasons.push("missing_contact_email_or_phone");
  }

  if (!shopwareCustomerId) {
    reasons.push("missing_shopware_customer_id");
  } else {
    const custConf = customer?.customerMatchConfidence;
    const minCust = agentSettings.strictMinCustomerMatchConfidence ?? 95;
    if (typeof custConf !== "number" || custConf < minCust) {
      reasons.push(`customer_match_confidence_below_${minCust}`);
    }
    if (customer?.shopwareCustomerAutoCreated === true) {
      reasons.push("customer_was_auto_created_not_matched");
    }
  }

  if (draftKind === "offer") {
    const channel =
      agentSettings.autoCreateSalesChannelId ||
      process.env.B2B_SELLERS_DEFAULT_SALES_CHANNEL ||
      "";
    if (!channel.trim()) {
      reasons.push("missing_sales_channel_id");
    }
  }

  const addressHints = extractedData.addressReviewHints;
  if (Array.isArray(addressHints) && addressHints.length > 0) {
    reasons.push("address_review_hints_present");
  }
  if (extractedData.commercialIntentVsUploadMismatch === true) {
    reasons.push("intent_vs_upload_mismatch");
  }

  const companyHeuristic = extractedData.companyNameHeuristic as
    | { skippedReason?: string; heuristic?: { top?: unknown } }
    | undefined;
  if (
    companyHeuristic?.skippedReason === "low_score" ||
    companyHeuristic?.skippedReason === "no_candidate"
  ) {
    reasons.push(`company_heuristic_${companyHeuristic.skippedReason}`);
  }

  const lineItems = extractedData.lineItems as
    | Array<{ extractedProductName?: string; quantity?: number }>
    | undefined;
  const matchItems = matchingResults?.items;
  const plausibility = extractedData.lineItemPlausibility as LineItemPlausibilityEntry[] | undefined;
  const plausByIndex = new Map(
    (plausibility ?? []).map((p) => [p.index, p])
  );

  if (!lineItems?.length) {
    reasons.push("no_line_items");
  } else if (!matchItems?.length) {
    reasons.push("no_matching_results");
  } else if (matchItems.length !== lineItems.length) {
    reasons.push("line_item_count_mismatch");
  } else {
    matchItems.forEach((item, index) => {
      const plaus = plausByIndex.get(index);
      if (plaus?.skipCatalogMatching) {
        reasons.push(`line_${index + 1}_catalog_matching_skipped`);
        return;
      }
      if (item.status !== "matched" || !item.matchedProduct) {
        reasons.push(`line_${index + 1}_not_matched`);
        return;
      }
      if (item.confidence < 100) {
        reasons.push(`line_${index + 1}_confidence_below_100`);
      }
    });
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    version: COMMERCIAL_STRICT_AUTO_CREATE_VERSION,
  };
}

/** Schreibt Trace in extractedData (für Draft-Persistenz). */
export function attachStrictAutoCreateTraceToExtractedData(
  extractedData: Record<string, unknown>,
  evaluation: StrictAutoCreateEvaluation
): void {
  extractedData.strictAutoCreateTrace = {
    allowed: evaluation.allowed,
    reasons: evaluation.reasons,
    version: evaluation.version,
    evaluatedAt: new Date().toISOString(),
  };
}
