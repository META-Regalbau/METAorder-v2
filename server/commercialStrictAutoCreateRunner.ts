/**
 * Führt Strikt-Auto-Create aus (Shopware Angebot/Bestellung), wenn evaluateStrictAutoCreate
 * erlaubt. Wird von E-Mail-Inbound und API-Upload (n8n/Gmail) genutzt.
 */

import type { IStorage } from "./storage";
import type { CommercialAgentSettings } from "./aiConfig";
import type { MatchingResult } from "./productMatcher";
import {
  attachStrictAutoCreateTraceToExtractedData,
  evaluateStrictAutoCreate,
  type StrictAutoCreateIntent,
} from "./commercialStrictAutoCreate";
import { executeCreateOfferFromDraft, executeCreateOrderFromDraft } from "./commercialDraftShopware";
import { resolveOfferSalesChannelId } from "./offerSalesChannelResolver";
import {
  emitCommercialAutoOfferCreated,
  emitCommercialAutoOrderCreated,
} from "./commercialWebhookNotifications";

export type StrictAutoCreateRunResult = {
  strictAllowed: boolean;
  strictReasons: string[];
  shopwareCreated: boolean;
  shopwareEntityId?: string;
  shopwareError?: string;
};

function attachShopwareFailureToTrace(extractedData: Record<string, unknown>, error: string): void {
  const trace = extractedData.strictAutoCreateTrace;
  if (!trace || typeof trace !== "object") return;
  (trace as Record<string, unknown>).shopwareError = error;
  (trace as Record<string, unknown>).shopwareAttemptAt = new Date().toISOString();
}

async function persistDraftExtractedData(
  storage: IStorage,
  draftKind: "offer" | "order",
  draftId: string,
  tenantId: string | null | undefined,
  extractedData: Record<string, unknown>
): Promise<void> {
  if (draftKind === "offer") {
    await storage.updateOfferDraft(
      draftId,
      { extractedData: extractedData as never },
      tenantId ?? null
    );
  } else {
    await storage.updateOrderDraft(
      draftId,
      { extractedData: extractedData as never },
      tenantId ?? null
    );
  }
}

export async function runStrictCommercialAutoCreateIfAllowed(params: {
  storage: IStorage;
  tenantId?: string | null;
  draftId: string;
  draftKind: "offer" | "order";
  agentSettings: CommercialAgentSettings;
  extractedData: Record<string, unknown>;
  matchingResults?: MatchingResult | null;
  shopwareCustomerId?: string | null;
  intent: StrictAutoCreateIntent;
  messageId?: string | null;
  /** Wenn false: nur evaluieren + Trace, kein Shopware-Call */
  executeShopware?: boolean;
}): Promise<StrictAutoCreateRunResult> {
  const {
    storage,
    tenantId,
    draftId,
    draftKind,
    agentSettings,
    extractedData,
    matchingResults,
    shopwareCustomerId,
    intent,
    messageId,
    executeShopware = true,
  } = params;

  const evaluation = evaluateStrictAutoCreate({
    draftKind,
    agentSettings,
    extractedData,
    matchingResults,
    shopwareCustomerId,
    intent,
  });

  attachStrictAutoCreateTraceToExtractedData(extractedData, evaluation);

  if (!evaluation.allowed) {
    if (draftKind === "offer") {
      await storage.updateOfferDraft(
        draftId,
        {
          extractedData: extractedData as never,
          status: "review_required",
        },
        tenantId ?? null
      );
    } else {
      await storage.updateOrderDraft(
        draftId,
        {
          extractedData: extractedData as never,
          status: "review_required",
        },
        tenantId ?? null
      );
    }
    return {
      strictAllowed: false,
      strictReasons: evaluation.reasons,
      shopwareCreated: false,
    };
  }

  if (!executeShopware) {
    await persistDraftExtractedData(storage, draftKind, draftId, tenantId, extractedData);
    return {
      strictAllowed: true,
      strictReasons: [],
      shopwareCreated: false,
    };
  }

  // Trace persistieren, Status unverändert lassen bis Shopware erfolgreich war.
  await persistDraftExtractedData(storage, draftKind, draftId, tenantId, extractedData);

  if (draftKind === "offer") {
    const channelResult = await resolveOfferSalesChannelId(storage, {
      tenantId: tenantId ?? null,
      allowedChannelIds: null,
    });
    if (!channelResult.ok) {
      attachShopwareFailureToTrace(extractedData, channelResult.error);
      await storage.updateOfferDraft(
        draftId,
        {
          extractedData: extractedData as never,
          status: "review_required",
        },
        tenantId ?? null
      );
      return {
        strictAllowed: true,
        strictReasons: [],
        shopwareCreated: false,
        shopwareError: channelResult.error,
      };
    }
    const result = await executeCreateOfferFromDraft(storage, draftId, {
      salesChannelId: channelResult.salesChannelId,
      tenantId: tenantId ?? null,
    });
    if (result.ok) {
      emitCommercialAutoOfferCreated({
        draftId,
        offerId: result.offerId,
        messageId: messageId ?? null,
      });
      return {
        strictAllowed: true,
        strictReasons: [],
        shopwareCreated: true,
        shopwareEntityId: result.offerId,
      };
    }
    attachShopwareFailureToTrace(extractedData, result.error);
    await storage.updateOfferDraft(
      draftId,
      {
        extractedData: extractedData as never,
        status: "review_required",
      },
      tenantId ?? null
    );
    return {
      strictAllowed: true,
      strictReasons: [],
      shopwareCreated: false,
      shopwareError: result.error,
    };
  }

  const result = await executeCreateOrderFromDraft(storage, draftId, {
    tenantId: tenantId ?? null,
  });
  if (result.ok) {
    emitCommercialAutoOrderCreated({
      draftId,
      orderId: result.orderId,
      messageId: messageId ?? null,
    });
    return {
      strictAllowed: true,
      strictReasons: [],
      shopwareCreated: true,
      shopwareEntityId: result.orderId,
    };
  }
  attachShopwareFailureToTrace(extractedData, result.error);
  await storage.updateOrderDraft(
    draftId,
    {
      extractedData: extractedData as never,
      status: "review_required",
    },
    tenantId ?? null
  );
  return {
    strictAllowed: true,
    strictReasons: [],
    shopwareCreated: false,
    shopwareError: result.error,
  };
}
