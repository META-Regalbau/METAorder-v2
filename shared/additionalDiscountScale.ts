/**
 * Zusatzrabatt-Staffel des Händlers (Shopware-Kunde, Feldset „WDU Partner Daten“,
 * customFields.wdu_partner_data_additional_discount_scale), z. B. „ab 1.000 € 5%; ab 3.000 € 10%“.
 *
 * Laut Feldbeschreibung im Shop greift immer nur die höchste erreichte Stufe, die Stufen addieren
 * sich nicht. Der Rabatt wirkt zuletzt auf den Warenwert (nach Kundenpreis bzw. Händlerrabatt).
 */
export const ADDITIONAL_DISCOUNT_SCALE_FIELD = "wdu_partner_data_additional_discount_scale";

export type AdditionalDiscountTier = { fromAmount: number; percent: number };

/** „1.000“, „2.500,50“, „1000“ → Zahl */
function amount(raw: string): number {
  const s = raw.replace(/\s/g, "");
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  return Number(normalized);
}

export function parseAdditionalDiscountScale(text: unknown): AdditionalDiscountTier[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const tiers: AdditionalDiscountTier[] = [];
  const re = /(?:ab\s*)?(\d[\d.\s]*(?:,\d+)?)\s*(?:€|eur(?:o)?)?\s*[:=\-–→]?\s*(\d+(?:[.,]\d+)?)\s*%/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const fromAmount = amount(m[1]);
    const percent = Number(m[2].replace(",", "."));
    if (!Number.isFinite(fromAmount) || fromAmount < 0) continue;
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) continue;
    tiers.push({ fromAmount, percent });
  }
  return tiers.sort((a, b) => a.fromAmount - b.fromAmount);
}

/** Höchste erreichte Stufe für den Warenwert (netto); null = keine. */
export function pickAdditionalDiscount(tiers: AdditionalDiscountTier[], goodsNet: number): AdditionalDiscountTier | null {
  let hit: AdditionalDiscountTier | null = null;
  for (const t of tiers) if (goodsNet >= t.fromAmount && (!hit || t.fromAmount >= hit.fromAmount)) hit = t;
  return hit;
}
