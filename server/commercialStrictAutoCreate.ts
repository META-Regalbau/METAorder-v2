/**
 * Strikt-Regel für vollautomatisches Anlegen in Shopware („100 %“-Pfad).
 *
 * Alle Bedingungen müssen erfüllt sein — ein einziger Verstoß → Review im UI.
 * Siehe docs/gmail-to-shopware-automation.md
 */

import type { CommercialAgentSettings } from "./aiConfig";
import type { MatchingResult } from "./productMatcher";
import type { LineItemPlausibilityEntry } from "./commercialExtractionOrchestrator";

export const COMMERCIAL_STRICT_AUTO_CREATE_VERSION = "2";

export type StrictAutoCreateIntent = {
  intent: "quote_request" | "purchase_order" | "unclear" | string;
  confidence: number;
};

/** Andere Entwürfe derselben Art mit gleicher Kunden-Belegnummer (Dublettenschutz). */
export type StrictAutoCreateSiblingDraft = {
  id: string;
  status: string;
  shopwareEntityId: string | null;
};

/**
 * Preisabgleich je Position: Stückpreis aus dem Kundendokument gegen den für den
 * Kunden in Shopware ermittelten Preis (Kundenpreis → Kundenrabatt → Liste).
 */
export type StrictAutoCreateLinePriceCheck = {
  /** Index in extractedData.lineItems / matchingResults.items */
  index: number;
  /** Netto-Stückpreis laut Kundendokument (extractedPrice); null = nicht im Dokument */
  documentUnitPriceNet: number | null;
  /** Für den Kunden ermittelter Netto-Stückpreis; null = konnte nicht ermittelt werden */
  expectedUnitPriceNet: number | null;
  /** Herkunft des erwarteten Preises */
  source?: "customer_specific" | "customer_discount" | "list" | "bundle" | "unresolved";
  /** Vom Prüfer im Entwurf gesetzter Netto-Stückpreis — überstimmt den Abgleich */
  manualUnitPriceNet?: number | null;
};

export type StrictAutoCreateEvaluation = {
  allowed: boolean;
  reasons: string[];
  version: string;
  priceChecks?: Array<StrictAutoCreateLinePriceCheck & { deviationPercent: number | null; ok: boolean }>;
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
  /**
   * An den Shopware-Kunden gebundener Verkaufskanal. Erfüllt die Kanal-Pflicht,
   * wenn weder Agent-Setting noch Env einen Kanal vorgeben (wie beim manuellen Angebot).
   */
  customerSalesChannelId?: string | null;
  /**
   * Andere Entwürfe derselben Art mit gleicher Kunden-Belegnummer. `undefined` = nicht
   * geprüft (z. B. keine Belegnummer extrahiert); `[]` = geprüft, keine Dublette.
   */
  siblingDrafts?: StrictAutoCreateSiblingDraft[] | null;
  /**
   * Preisabgleich je Position (nur für Bestellungen ausgewertet). `undefined` bei einer
   * Bestellung = Abgleich konnte nicht durchgeführt werden → Review.
   */
  linePriceChecks?: StrictAutoCreateLinePriceCheck[] | null;
}): StrictAutoCreateEvaluation {
  const {
    draftKind,
    agentSettings,
    extractedData,
    matchingResults,
    shopwareCustomerId,
    intent,
    customerSalesChannelId,
    siblingDrafts,
    linePriceChecks,
  } = params;
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

  // Verkaufskanal: für Angebot UND Bestellung Pflicht. Der Resolver würde sonst auf den
  // ersten aktiven Shopware-Kanal zurückfallen — für eine automatisch angelegte Kern-
  // Bestellung ist ein zufälliger Kanal nicht akzeptabel.
  {
    const channel =
      agentSettings.autoCreateSalesChannelId ||
      process.env.B2B_SELLERS_DEFAULT_SALES_CHANNEL ||
      process.env.COMMERCIAL_AGENT_SALES_CHANNEL_ID ||
      (customerSalesChannelId ?? "") ||
      "";
    if (!channel.trim()) {
      reasons.push("missing_sales_channel_id");
    }
  }

  // Dublettenschutz über die Kunden-Belegnummer (z. B. Bestellung zweimal gemailt).
  if (Array.isArray(siblingDrafts) && siblingDrafts.length > 0) {
    reasons.push("duplicate_buyer_document_number");
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

  // Preisabgleich — nur Bestellungen: Der Kunde bestellt zu einem Preis; weicht dieser vom
  // in Shopware hinterlegten Kundenpreis/Rabatt/Listenpreis ab, muss ein Mensch entscheiden.
  // Bei Anfragen (Angebot) ist ein Preis im Dokument nur informativ.
  let priceChecksOut: StrictAutoCreateEvaluation["priceChecks"];
  if (draftKind === "order" && lineItems?.length && matchItems?.length === lineItems.length) {
    if (!Array.isArray(linePriceChecks)) {
      reasons.push("price_check_unavailable");
    } else {
      const tolerancePercent = Math.max(0, agentSettings.strictPriceTolerancePercent ?? 1);
      const byIndex = new Map(linePriceChecks.map((c) => [c.index, c]));
      priceChecksOut = [];
      matchItems.forEach((item, index) => {
        const plaus = plausByIndex.get(index);
        if (plaus?.skipCatalogMatching) return;
        const check = byIndex.get(index);
        const n = index + 1;
        if (!check) {
          reasons.push(`line_${n}_price_unresolved`);
          priceChecksOut!.push({
            index,
            documentUnitPriceNet: null,
            expectedUnitPriceNet: null,
            source: "unresolved",
            deviationPercent: null,
            ok: false,
          });
          return;
        }
        const manual =
          typeof check.manualUnitPriceNet === "number" && Number.isFinite(check.manualUnitPriceNet)
            ? check.manualUnitPriceNet
            : null;
        const doc =
          typeof check.documentUnitPriceNet === "number" && Number.isFinite(check.documentUnitPriceNet)
            ? check.documentUnitPriceNet
            : null;
        const expected =
          typeof check.expectedUnitPriceNet === "number" && Number.isFinite(check.expectedUnitPriceNet)
            ? check.expectedUnitPriceNet
            : null;
        let ok = true;
        let deviationPercent: number | null = null;
        if (manual != null) {
          // Ein Prüfer hat den Preis bewusst gesetzt — das ist die Entscheidung, nicht der Abgleich.
          ok = true;
        } else if (doc == null) {
          reasons.push(`line_${n}_price_missing_in_document`);
          ok = false;
        } else if (expected == null) {
          reasons.push(`line_${n}_price_unresolved`);
          ok = false;
        } else {
          const diff = Math.abs(doc - expected);
          deviationPercent = expected > 0 ? Math.round((diff / expected) * 10000) / 100 : diff > 0 ? 100 : 0;
          const allowedAbs = Math.max(0.01, (expected * tolerancePercent) / 100);
          if (diff > allowedAbs) {
            reasons.push(`line_${n}_price_mismatch`);
            ok = false;
          }
        }
        priceChecksOut!.push({ ...check, deviationPercent, ok });
      });
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    version: COMMERCIAL_STRICT_AUTO_CREATE_VERSION,
    ...(priceChecksOut ? { priceChecks: priceChecksOut } : {}),
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
    ...(evaluation.priceChecks ? { priceChecks: evaluation.priceChecks } : {}),
  };
}
