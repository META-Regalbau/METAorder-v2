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
  type StrictAutoCreateLinePriceCheck,
  type StrictAutoCreateSiblingDraft,
} from "./commercialStrictAutoCreate";
import { ensureDraftShopwareCustomerId, executeCreateOfferFromDraft, executeCreateOrderFromDraft } from "./commercialDraftShopware";
import { fetchCustomerBoundSalesChannelId, resolveOfferSalesChannelId } from "./offerSalesChannelResolver";
import { extractBuyerDocumentNumber } from "./commercialOrderAcknowledgement";
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

/**
 * Sammelt die Kontextdaten, die die Strikt-Regel über den Entwurf hinaus braucht:
 * kundengebundener Verkaufskanal, Dubletten über die Kunden-Belegnummer und der
 * Preisabgleich je Position (Kundenpreis/Rabatt/Liste aus Shopware).
 * Alle Teilschritte sind fehlertolerant: ein Fehler führt zu `undefined` und damit
 * in der Regel zu Review — nie zu einer stillen Auto-Anlage.
 */
async function collectStrictAutoCreateContext(params: {
  storage: IStorage;
  tenantId?: string | null;
  draftId: string;
  draftKind: "offer" | "order";
  extractedData: Record<string, unknown>;
  matchingResults?: MatchingResult | null;
  shopwareCustomerId?: string | null;
}): Promise<{
  customerSalesChannelId: string | null;
  siblingDrafts: StrictAutoCreateSiblingDraft[] | undefined;
  linePriceChecks: StrictAutoCreateLinePriceCheck[] | undefined;
}> {
  const { storage, tenantId, draftId, draftKind, extractedData, matchingResults } = params;

  // Veraltete Kunden-ID vor der Kanalwahl reparieren (Portal-Kunde → Händler-Portal-Kanal).
  const ensuredCustomer = params.shopwareCustomerId
    ? await ensureDraftShopwareCustomerId(storage, { kind: draftKind, draftId, tenantId })
    : null;
  const shopwareCustomerId =
    ensuredCustomer && ensuredCustomer.ok ? ensuredCustomer.customerId : params.shopwareCustomerId;

  const customerSalesChannelId = await fetchCustomerBoundSalesChannelId(storage, tenantId, shopwareCustomerId);

  let siblingDrafts: StrictAutoCreateSiblingDraft[] | undefined;
  const buyerDocumentNumber = extractBuyerDocumentNumber(extractedData);
  if (shopwareCustomerId && buyerDocumentNumber) {
    try {
      siblingDrafts = await storage.findSiblingDraftsByBuyerDocumentNumber({
        tenantId: tenantId ?? null,
        draftKind,
        excludeDraftId: draftId,
        shopwareCustomerId,
        buyerDocumentNumber,
      });
    } catch (error) {
      console.warn("[StrictAutoCreate] Dublettenprüfung fehlgeschlagen:", error instanceof Error ? error.message : error);
      siblingDrafts = undefined;
    }
  }

  let linePriceChecks: StrictAutoCreateLinePriceCheck[] | undefined;
  const items = matchingResults?.items ?? [];
  if (draftKind === "order" && shopwareCustomerId && items.length > 0) {
    try {
      const settings = await storage.getShopwareSettings(tenantId ?? null);
      const channel = await resolveOfferSalesChannelId(storage, {
        tenantId: tenantId ?? null,
        customerChannelId: customerSalesChannelId,
        allowedChannelIds: null,
      });
      if (settings && channel.ok) {
        const { ShopwareClient } = await import("./shopware");
        const { fetchSalesChannelOfferDefaults, toShopwareUuid } = await import("./b2bOfferCreateContext");
        const { resolveCustomerUnitPrices } = await import("./commercialCustomerPricing");
        const client = new ShopwareClient(settings);
        const channelDefaults = await fetchSalesChannelOfferDefaults(client, channel.salesChannelId);
        const priceItems = items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.matchedProduct && !(item as { bundle?: unknown }).bundle)
          .map(({ item, index }) => ({
            index,
            productId: toShopwareUuid(item.matchedProduct!.id),
            productNumber: item.matchedProduct!.productNumber ?? null,
            quantity: item.quantity,
          }));
        const resolved = await resolveCustomerUnitPrices(client, {
          customerId: shopwareCustomerId,
          currencyId: channelDefaults.currencyId,
          items: priceItems,
        });
        const extractedLines = Array.isArray(extractedData.lineItems)
          ? (extractedData.lineItems as Array<{ extractedPrice?: number }>)
          : [];
        linePriceChecks = items.map((item, index) => {
          const docPrice = extractedLines[index]?.extractedPrice;
          const manual = (item.matchedProduct as { manualUnitPriceNet?: number } | undefined)?.manualUnitPriceNet;
          const base = {
            index,
            documentUnitPriceNet:
              typeof docPrice === "number" && Number.isFinite(docPrice) && docPrice > 0 ? docPrice : null,
            manualUnitPriceNet: typeof manual === "number" && Number.isFinite(manual) ? manual : null,
          };
          if ((item as { bundle?: unknown }).bundle) {
            return { ...base, expectedUnitPriceNet: null, source: "bundle" as const };
          }
          if (!item.matchedProduct) {
            return { ...base, expectedUnitPriceNet: null, source: "unresolved" as const };
          }
          const price = resolved.prices.get(toShopwareUuid(item.matchedProduct.id));
          return price
            ? { ...base, expectedUnitPriceNet: price.net, source: price.source }
            : { ...base, expectedUnitPriceNet: null, source: "unresolved" as const };
        });
      }
    } catch (error) {
      console.warn("[StrictAutoCreate] Preisabgleich fehlgeschlagen:", error instanceof Error ? error.message : error);
      linePriceChecks = undefined;
    }
  }

  return { customerSalesChannelId, siblingDrafts, linePriceChecks };
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

  const context = await collectStrictAutoCreateContext({
    storage,
    tenantId,
    draftId,
    draftKind,
    extractedData,
    matchingResults,
    shopwareCustomerId,
  });

  const evaluation = evaluateStrictAutoCreate({
    draftKind,
    agentSettings,
    extractedData,
    matchingResults,
    shopwareCustomerId,
    intent,
    customerSalesChannelId: context.customerSalesChannelId,
    siblingDrafts: context.siblingDrafts,
    linePriceChecks: context.linePriceChecks,
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
      customerChannelId: context.customerSalesChannelId,
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

  const orderChannelResult = await resolveOfferSalesChannelId(storage, {
    tenantId: tenantId ?? null,
    customerChannelId: context.customerSalesChannelId,
    allowedChannelIds: null,
  });
  if (!orderChannelResult.ok) {
    attachShopwareFailureToTrace(extractedData, orderChannelResult.error);
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
      shopwareError: orderChannelResult.error,
    };
  }

  const result = await executeCreateOrderFromDraft(storage, draftId, {
    salesChannelId: orderChannelResult.salesChannelId,
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
