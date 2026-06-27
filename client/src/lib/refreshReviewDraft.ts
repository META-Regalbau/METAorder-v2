import { apiRequest } from "@/lib/queryClient";

export async function fetchOfferDraftForReview(draftId: string) {
  const res = await apiRequest("GET", `/api/offer-drafts/${draftId}`);
  return res.json();
}

export async function fetchOrderDraftForReview(draftId: string) {
  const res = await apiRequest("GET", `/api/order-drafts/${draftId}`);
  return res.json();
}
