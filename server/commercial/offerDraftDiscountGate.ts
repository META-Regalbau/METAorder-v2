/**
 * Rabatt-Ampel (CPQ-Rabattstufen) bei der Anlage eines Angebots aus einem Entwurf — auf dem Server,
 * damit n8n und die Automatik sie nicht umgehen:
 * - Stufe "blocked": keine Anlage.
 * - Stufe mit Freigabe (Abteilungsleitung/Geschäftsführung): Anlage nur mit Begründung, wenn die
 *   Stufe eine verlangt; danach wird der Freigabe-Eintrag (Quote-Log) angelegt.
 *   Automatische Anlagen haben keine Begründung und gehen deshalb in die Prüfung.
 */
import {
  computeOfferDraftDiscountTotals,
  type OfferDraftDiscountItem,
  type OfferDraftDiscountTotals,
} from "@shared/offerDraftDiscount";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/offerDraftDiscountGate" });

const APPROVAL_TYPES = new Set(["department_lead", "management"]);

export type OfferDiscountApproval = {
  levelId: string;
  approvalType: string;
  totals: OfferDraftDiscountTotals;
};

type DiscountLevelLike = { levelId: string; approvalType: string; justificationRequired: boolean } | null;

/** Reine Entscheidung aus Stufe und Begründung (testbar ohne Datenbank). */
export function decideOfferDiscount(
  level: DiscountLevelLike,
  totals: OfferDraftDiscountTotals,
  justification: string | null | undefined,
):
  | { ok: true; approval: OfferDiscountApproval | null }
  | { ok: false; error: string; statusCode: number; code: string } {
  if (!level || totals.discountPercent <= 0) return { ok: true, approval: null };
  if (level.approvalType === "blocked") {
    return {
      ok: false,
      statusCode: 409,
      code: "discount_blocked",
      error: `Rabatt von ${String(totals.discountPercent).replace(".", ",")} % ist nicht erlaubt`,
    };
  }
  if (!APPROVAL_TYPES.has(level.approvalType)) return { ok: true, approval: null };
  if (level.justificationRequired && !justification?.trim()) {
    return {
      ok: false,
      statusCode: 409,
      code: "discount_justification_required",
      error: "Rabatt braucht eine Freigabe: bitte eine Begründung angeben",
    };
  }
  return { ok: true, approval: { levelId: level.levelId, approvalType: level.approvalType, totals } };
}

export async function checkOfferDraftDiscount(params: {
  items: OfferDraftDiscountItem[];
  tenantId: string | null;
  justification?: string | null;
}): Promise<ReturnType<typeof decideOfferDiscount>> {
  const totals = computeOfferDraftDiscountTotals(params.items);
  if (totals.discountPercent <= 0) return { ok: true, approval: null };
  try {
    const { evaluateDiscountLevel } = await import("../cpq/discountEvaluator");
    const level = await evaluateDiscountLevel(
      totals.discountPercent,
      { orderValue: totals.totalOfferValue },
      params.tenantId,
    );
    return decideOfferDiscount(level, totals, params.justification);
  } catch (error) {
    // Stufen nicht lesbar: wie bisher im Prüffenster nicht sperren, aber protokollieren
    log.warn({ err: error, discountPercent: totals.discountPercent }, "[OfferDiscount] Rabattstufen nicht auswertbar");
    return { ok: true, approval: null };
  }
}

/** Freigabe-Eintrag nach der Anlage (vorher im Prüffenster über /api/cpq/offers/:id/request-approval). */
export async function recordOfferDiscountApproval(params: {
  offerId: string;
  approval: OfferDiscountApproval;
  justification?: string | null;
  userId?: string | null;
  tenantId: string | null;
}): Promise<void> {
  try {
    const { cpqStorage } = await import("../cpq/cpqStorage");
    const { totals } = params.approval;
    await cpqStorage.createQuoteLog(
      {
        offerId: params.offerId,
        userId: params.userId || "system",
        discountPercent: String(totals.discountPercent),
        discountLevelId: params.approval.levelId,
        listPrice: String(totals.totalCatalogValue),
        discountedPrice: String(totals.totalOfferValue),
        revenueLoss: String(totals.totalCatalogValue - totals.totalOfferValue),
        justification: params.justification?.trim() || null,
        approvalType: params.approval.approvalType,
        approvalStatus: "pending",
      },
      params.tenantId,
    );
  } catch (error) {
    log.error({ err: error, offerId: params.offerId }, "[OfferDiscount] Freigabe-Eintrag nicht angelegt");
  }
}
