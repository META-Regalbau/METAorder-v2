/**
 * Ob ein Kunde ein Angebot über die öffentliche Seite noch annehmen/ablehnen darf.
 * Status entspricht METAorder-Normalisierung (B2BSellersClient.mapOffer).
 */
export function isOfferAlreadyAccepted(status: string): boolean {
  const s = String(status || "").toLowerCase();
  return s === "approved" || s === "accepted";
}

export function isOfferDeclinedOrRejected(status: string): boolean {
  const s = String(status || "").toLowerCase();
  return s === "rejected" || s === "declined";
}

export function isOfferExpiredStatus(status: string): boolean {
  return String(status || "").toLowerCase() === "expired";
}

export function canPublicAcceptOffer(status: string): boolean {
  const s = String(status || "").toLowerCase();
  if (isOfferAlreadyAccepted(s) || isOfferDeclinedOrRejected(s) || isOfferExpiredStatus(s) || s === "draft") {
    return false;
  }
  return s === "sent" || s === "offered" || s === "submitted";
}

export function canPublicDeclineOffer(status: string): boolean {
  return canPublicAcceptOffer(status);
}

/** Angebots-Gültigkeitsdatum (ISO) — wenn gesetzt und in der Vergangenheit, keine Aktion mehr. */
export function isExpirationDatePassed(expirationDate: string | null | undefined): boolean {
  if (!expirationDate) return false;
  const d = new Date(expirationDate);
  if (Number.isNaN(d.getTime())) return false;
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end.getTime() < Date.now();
}
