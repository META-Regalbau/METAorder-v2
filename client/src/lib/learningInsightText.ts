/**
 * Titel und Beschreibung der Lern-Insights (Angebote, Cross-Selling) in der Oberflaechensprache.
 * Der Server speichert sie beim Lernlauf auf Deutsch; uebersetzt wird ueber den insightType
 * (insights.<typ>.title/description). Unbekannte Typen zeigen weiter den gespeicherten Text.
 */
type Translate = (key: string, options: { defaultValue: string }) => string;

type InsightText = { insightType: string; title: string; description?: string | null };

export function learningInsightTitle(t: Translate, insight: InsightText): string {
  return t(`insights.${insight.insightType}.title`, { defaultValue: insight.title });
}

export function learningInsightDescription(t: Translate, insight: InsightText): string {
  return t(`insights.${insight.insightType}.description`, { defaultValue: insight.description ?? "" });
}

/** Angebotsstatus aus den Insights (Werte der B2B-Statuszuordnung, sonst "unknown"). */
export function offerStatusLabel(t: Translate, status: string): string {
  if (status === "unknown") return t("common.unknown", { defaultValue: status });
  return t(`offers.status.${status}`, { defaultValue: status });
}

/**
 * Kennzahlen eines Paars aus den Cross-Selling-Insights: Warenkorb-Paare (top_pairs) haben Support
 * und Lift, Funnel-Paare (top_quality_pairs, low_quality_pairs) Add-Rate und Impressions.
 */
export function learningInsightPairStats(t: Translate, pair: Record<string, unknown>): string {
  if (typeof pair.support === "number" && typeof pair.lift === "number") {
    return `${(pair.support * 100).toFixed(1)}% · ${pair.lift.toFixed(2)}`;
  }
  if (typeof pair.addRatePct === "number") {
    return `${pair.addRatePct}% / ${pair.impressions ?? 0} ${t("insights.impressionsShort", { defaultValue: "Imp." })}`;
  }
  return "";
}
