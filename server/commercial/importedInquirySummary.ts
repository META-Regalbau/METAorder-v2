import type { OfferDraft, OrderDraft } from "@shared/schema";

export type ImportedInquiryKind = "offer" | "order";

export type ImportedInquirySummary = {
  id: string;
  kind: ImportedInquiryKind;
  createdAt: string;
  status: string;
  originalFileName: string;
  company: string | null;
  contactName: string | null;
  email: string | null;
  lineItemCount: number;
  matchedLineItemCount: number;
  overallConfidence: number | null;
  commercialIntent: "quote_request" | "purchase_order" | "unclear" | null;
};

type DraftExtracted = NonNullable<OrderDraft["extractedData"] | OfferDraft["extractedData"]>;

function summarizeCustomer(extracted: DraftExtracted | null | undefined) {
  const customer = extracted?.customer;
  const billing = extracted?.billingAddress;
  const company = (customer?.company ?? billing?.company)?.trim() || null;
  const first = customer?.firstName?.trim() ?? billing?.firstName?.trim() ?? "";
  const last = customer?.lastName?.trim() ?? billing?.lastName?.trim() ?? "";
  const contactName = [first, last].filter(Boolean).join(" ") || null;
  const email = customer?.email?.trim() || null;
  return { company, contactName, email };
}

function summarizeMatching(draft: OrderDraft | OfferDraft) {
  const lineItemCount = draft.extractedData?.lineItems?.length ?? 0;
  const items = draft.matchingResults?.items ?? [];
  const matchedLineItemCount = items.filter((i) => i.status === "matched").length;
  const overallConfidence =
    typeof draft.matchingResults?.overallConfidence === "number"
      ? draft.matchingResults.overallConfidence
      : null;
  return { lineItemCount, matchedLineItemCount, overallConfidence };
}

export function toImportedInquirySummary(
  draft: OrderDraft | OfferDraft,
  kind: ImportedInquiryKind
): ImportedInquirySummary {
  const { company, contactName, email } = summarizeCustomer(draft.extractedData);
  const { lineItemCount, matchedLineItemCount, overallConfidence } = summarizeMatching(draft);
  const intent = draft.extractedData?.commercialIntent ?? null;

  return {
    id: draft.id,
    kind,
    createdAt: draft.createdAt instanceof Date ? draft.createdAt.toISOString() : String(draft.createdAt),
    status: draft.status,
    originalFileName: draft.originalFileName,
    company,
    contactName,
    email,
    lineItemCount,
    matchedLineItemCount,
    overallConfidence,
    commercialIntent: intent,
  };
}

export function mergeImportedInquiries(
  orders: OrderDraft[],
  offers: OfferDraft[],
  limit: number
): ImportedInquirySummary[] {
  const combined = [
    ...orders.map((d) => toImportedInquirySummary(d, "order")),
    ...offers.map((d) => toImportedInquirySummary(d, "offer")),
  ];
  combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return combined.slice(0, Math.max(1, limit));
}
