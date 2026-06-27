import { webhookService } from "./webhookService";

type DraftLike = {
  id: string;
  status: string;
  shopwareCustomerId: string | null;
  matchingResults: unknown;
};

export function emitCommercialDraftWebhooks(params: {
  draft: DraftLike;
  draftKind: "offer" | "order";
  intent: string;
  intentConfidence: number;
  messageId: string | null;
  source: "email_inbound" | "manual_upload";
}): void {
  const { draft, draftKind, intent, intentConfidence, messageId, source } = params;
  const overallConfidence =
    typeof draft.matchingResults === "object" &&
    draft.matchingResults &&
    typeof (draft.matchingResults as { overallConfidence?: number }).overallConfidence === "number"
      ? (draft.matchingResults as { overallConfidence: number }).overallConfidence
      : null;
  const createdAt = new Date().toISOString();
  const base = {
    draftId: draft.id,
    draftKind,
    draftStatus: draft.status,
    intent,
    intentConfidence,
    overallConfidence,
    shopwareCustomerId: draft.shopwareCustomerId ?? null,
    messageId,
    source,
    createdAt,
  };

  try {
    webhookService.trigger("commercial.draft_created", base).catch((err) =>
      console.error("[CommercialWebhook] draft_created:", err)
    );
    if (draft.status === "review_required") {
      webhookService.trigger("commercial.draft_review_required", base).catch((err) =>
        console.error("[CommercialWebhook] draft_review_required:", err)
      );
    }
  } catch (e) {
    console.error("[CommercialWebhook] emit failed:", e);
  }
}

export function emitCommercialAutoOfferCreated(params: {
  draftId: string;
  offerId: string;
  messageId: string | null;
}): void {
  try {
    webhookService
      .trigger("commercial.auto_offer_created", {
        draftId: params.draftId,
        offerId: params.offerId,
        messageId: params.messageId,
        createdAt: new Date().toISOString(),
      })
      .catch((err) => console.error("[CommercialWebhook] auto_offer_created:", err));
  } catch (e) {
    console.error("[CommercialWebhook] auto_offer_created emit failed:", e);
  }
}

export function emitCommercialAutoOrderCreated(params: {
  draftId: string;
  orderId: string;
  messageId: string | null;
}): void {
  try {
    webhookService
      .trigger("commercial.auto_order_created", {
        draftId: params.draftId,
        orderId: params.orderId,
        messageId: params.messageId,
        createdAt: new Date().toISOString(),
      })
      .catch((err) => console.error("[CommercialWebhook] auto_order_created:", err));
  } catch (e) {
    console.error("[CommercialWebhook] auto_order_created emit failed:", e);
  }
}
