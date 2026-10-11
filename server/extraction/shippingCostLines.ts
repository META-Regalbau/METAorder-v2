/**
 * Fracht- und Hinweiszeilen sind keine Artikel (Live 11.10.2026: „Frachtkosten“ 52,71 € bei Bartels,
 * „Fremdversand-Kosten“ bei Werkzeug-Eylert, „Frachtkosten *** nicht Skontierfähig ***“ und
 * „Telefonisches AVIS Hausmeisterei …“ bei Heinrich & Schleyer). Sie standen als nicht gefundene
 * Artikel im Entwurf und hätten die Automatik immer blockiert.
 *
 * Sie werden aus den Positionen genommen: Fracht mit Betrag als `documentShippingCosts` und Notiz,
 * Liefer-/Avis-Hinweise als Notiz. Die Versandkosten der Bestellung setzt weiter Shopware.
 */

type Line = { extractedProductName?: string; extractedProductNumber?: string; quantity?: number; extractedPrice?: number };

const SHIPPING_RE =
  /^(?:\d+\s+)?(?:fracht(?:kosten|pauschale|anteil)?|fremdversand(?:[-\s]?kosten)?|versand(?:kosten|pauschale)?|transport(?:kosten)?|liefer(?:kosten|pauschale)|speditions?(?:kosten)?|porto|anlieferung(?:skosten)?|fracht\s*(?:und|&|\/)\s*verpackung|shipping(?:\s+costs?)?|freight(?:\s+charges?)?)\b/i;
const NOTICE_RE = /^(?:\d+\s+)?(?:telefonische[sn]?\s+avis|avisierung|avis\b|anlieferung\s+nur|neutral\s+liefern)/i;
/** Maße oder Typen im Text → doch ein Artikel („Transportwagen 1200x800“, „Versandkarton“) */
const PRODUCT_CUE_RE = /\d{3,}\s*[x×]\s*\d{3,}|wagen|karton|regal|palette\b|behälter|kiste/i;

export type DocumentShippingCost = { label: string; amountNet: number | null; articleNumber: string | null };

export function classifyNonProductLine(line: Line): "shipping" | "notice" | null {
  const name = (line.extractedProductName ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 120 || PRODUCT_CUE_RE.test(name)) return null;
  if (SHIPPING_RE.test(name)) return "shipping";
  if (NOTICE_RE.test(name)) return "notice";
  return null;
}

const euro = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Nimmt Fracht- und Hinweiszeilen aus `lineItems` (in place) und hängt eine Notiz an.
 * Gibt die entfernten Frachtzeilen zurück.
 */
export function moveShippingAndNoticeLines(
  extractedData: Record<string, unknown>,
  notesKey: "orderNotes" | "offerNotes",
): DocumentShippingCost[] {
  const lines = extractedData.lineItems as Line[] | undefined;
  if (!Array.isArray(lines) || lines.length < 2) return []; // eine einzige Zeile ist nie nur Fracht
  const shipping: DocumentShippingCost[] = [];
  const notices: string[] = [];
  const kept = lines.filter((line) => {
    const kind = classifyNonProductLine(line);
    if (!kind) return true;
    const label = (line.extractedProductName ?? "").replace(/\s+/g, " ").trim();
    if (kind === "shipping") {
      const qty = typeof line.quantity === "number" && line.quantity > 0 ? line.quantity : 1;
      const amount = typeof line.extractedPrice === "number" ? Math.round(line.extractedPrice * qty * 100) / 100 : null;
      shipping.push({ label, amountNet: amount, articleNumber: line.extractedProductNumber?.trim() || null });
    } else {
      notices.push(label);
    }
    return false;
  });
  // Nur Fracht/Hinweise und sonst nichts: lieber stehen lassen, der Bearbeiter entscheidet
  if (kept.length === 0) return [];
  if (!shipping.length && !notices.length) return [];

  extractedData.lineItems = kept;
  if (shipping.length) extractedData.documentShippingCosts = shipping;
  const parts = [
    ...shipping.map((s) => `[Fracht laut Beleg] ${s.label}${s.amountNet != null ? `: ${euro(s.amountNet)} € netto` : ""} – nicht als Artikel übernommen, Versandkosten setzt Shopware`),
    ...notices.map((n) => `[Lieferhinweis aus den Positionen] ${n}`),
  ];
  const prev = (extractedData[notesKey] as string | undefined) || "";
  extractedData[notesKey] = prev ? `${prev}\n\n${parts.join("\n")}` : parts.join("\n");
  return shipping;
}
