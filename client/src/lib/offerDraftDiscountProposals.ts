/**
 * Rabattvorschläge im Angebots-Prüffenster (seit 14.10.2026): Der Preis startet beim Preis des
 * Kunden (Kundenpreis, Händlerrabatt, Liste des Kanals); der vorgeschlagene Mengenrabatt gilt erst
 * nach „Übernehmen“ (Server: POST /api/offer-drafts/:id/accept-discounts).
 */

type ProposalItem = {
  quantity?: number | null;
  bundle?: unknown;
  matchedProduct?: {
    suggestedDiscount?: number | null;
    manualUnitPriceNet?: number | null;
    basePriceNet?: number | null;
    acceptedDiscountPercent?: number | null;
  } | null;
};

type PricedLine = { unitPriceNet: number | null; priceSource: string };

export type DiscountProposal = {
  index: number;
  quantity: number;
  discountPercent: number;
  basePriceNet: number;
  proposedPriceNet: number;
  accepted: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildDiscountProposals(items: ProposalItem[], lineByIndex: Map<number, PricedLine>): Map<number, DiscountProposal> {
  const out = new Map<number, DiscountProposal>();
  items.forEach((item, index) => {
    const product = item.matchedProduct;
    if (!product || item.bundle) return;
    const quantity = item.quantity ?? 1;
    const manual = product.manualUnitPriceNet;
    const accepted = typeof product.acceptedDiscountPercent === "number" && typeof manual === "number";
    if (accepted) {
      const base = product.basePriceNet ?? manual;
      out.set(index, { index, quantity, discountPercent: product.acceptedDiscountPercent!, basePriceNet: base, proposedPriceNet: manual, accepted: true });
      return;
    }
    // Von Hand gesetzter Preis: kein Vorschlag mehr
    if (typeof manual === "number") return;
    const discount = product.suggestedDiscount ?? 0;
    const line = lineByIndex.get(index);
    const base = line && line.priceSource !== "manual" ? line.unitPriceNet : null;
    if (!(discount > 0 && discount < 100) || !base || base <= 0) return;
    out.set(index, { index, quantity, discountPercent: discount, basePriceNet: base, proposedPriceNet: round2(base * (1 - discount / 100)), accepted: false });
  });
  return out;
}

/** Summen der noch offenen Vorschläge (für „Alle Rabatte übernehmen“) */
export function summarizeOpenProposals(proposals: Map<number, DiscountProposal>): { count: number; baseTotal: number; proposedTotal: number; discountPercent: number } {
  let count = 0;
  let baseTotal = 0;
  let proposedTotal = 0;
  for (const p of proposals.values()) {
    if (p.accepted) continue;
    count++;
    baseTotal += p.basePriceNet * p.quantity;
    proposedTotal += p.proposedPriceNet * p.quantity;
  }
  baseTotal = round2(baseTotal);
  proposedTotal = round2(proposedTotal);
  const discountPercent = baseTotal > 0 ? Math.round((1 - proposedTotal / baseTotal) * 1000) / 10 : 0;
  return { count, baseTotal, proposedTotal, discountPercent };
}
