import type { CpqClassification } from "./contracts";

/**
 * Entscheidung nach der CPQ-Validierung - rein, ohne Speicher und Shopware, damit testbar.
 * Klasse C braucht eine technische Pruefung in METAorder; der Adapter-Transfer in den
 * Shopware-Warenkorb wird dann blockiert. Genutzt von cpqCoreRoutes.ts (submit, submit-transfer).
 */

export function deriveReviewDecision(classification: CpqClassification) {
  const requiresReview = classification === "C";
  return {
    status: requiresReview ? "review_required" : "accepted",
    requiresReview,
    reviewStatus: requiresReview ? "pending" : "not_required",
  } as const;
}

export function buildBlockedReviewTransfer() {
  return {
    status: "blocked" as const,
    reason: "review_required" as const,
    nextAction: "review_queue" as const,
    reviewHint:
      "Diese Konfiguration wurde als Klasse C eingestuft. Der Checkout bleibt gesperrt, bis die technische Pruefung in METAorder abgeschlossen ist.",
  };
}

export type CpqAdapterTransferDecision = "skipped" | "blocked" | "prepared";

/** Ohne Warenkorb uebersprungen, mit Pruefpflicht blockiert, sonst vorbereitet. */
export function decideAdapterTransfer(
  decision: { requiresReview: boolean },
  cartItemCount: number,
): CpqAdapterTransferDecision {
  if (cartItemCount === 0) return "skipped";
  return decision.requiresReview ? "blocked" : "prepared";
}
