/**
 * Titel und Beschreibung der Lern-Insights (Angebote, Cross-Selling) in der Oberflaechensprache.
 * Der Server speichert sie beim Lernlauf auf Deutsch; uebersetzt wird ueber den insightType
 * (insights.<typ>.title/description). Unbekannte Typen zeigen weiter den gespeicherten Text.
 */
import { createLocaleFormatters } from "./localeFormat";

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
 * Paare eines Cross-Selling-Insights: data.pairs; aeltere Laeufe legten "Upsell-Potenzial" unter
 * data.recommendations ab (die Karte blieb deshalb leer) - bis zum naechsten Lernlauf auch die lesen.
 */
export function learningInsightPairs(data: unknown): Array<Record<string, unknown>> {
  const record = (data ?? {}) as { pairs?: unknown; recommendations?: unknown };
  const list = Array.isArray(record.pairs) ? record.pairs : Array.isArray(record.recommendations) ? record.recommendations : [];
  return list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
}

/** Artikel eines Paars: "Name (Nummer)", ohne gespeicherten Namen nur die Nummer */
export function learningInsightProductLabel(number: unknown, name: unknown): string {
  const num = typeof number === "string" ? number : String(number ?? "");
  return typeof name === "string" && name.trim() ? `${name.trim()} (${num})` : num;
}

/**
 * Kennzahlen eines Paars aus den Cross-Selling-Insights: Warenkorb-Paare (top_pairs) haben Support
 * und Lift, Upsell-Paare die Kaufwahrscheinlichkeit (wer A kauft, nimmt B dazu), Funnel-Paare
 * (top_quality_pairs, low_quality_pairs) Add-Rate und Impressions.
 * Zahlen in der Sprache der Oberflaeche (language = i18n.language).
 */
export function learningInsightPairStats(
  t: Translate,
  pair: Record<string, unknown>,
  language?: string,
  insightType?: string,
): string {
  const fmt = createLocaleFormatters(language);
  if (insightType === "upsell_opportunities" && typeof pair.confidence === "number" && typeof pair.lift === "number") {
    return t("insights.upsell_opportunities.pairStats", {
      defaultValue: "{{confidence}} Kaufwahrscheinlichkeit · Lift {{lift}}",
      confidence: fmt.percent(pair.confidence, 0),
      lift: fmt.decimal(pair.lift, 2),
    } as { defaultValue: string });
  }
  if (typeof pair.support === "number" && typeof pair.lift === "number") {
    return `${fmt.percent(pair.support)} · ${fmt.decimal(pair.lift, 2)}`;
  }
  if (typeof pair.addRatePct === "number") {
    const impressions = typeof pair.impressions === "number" ? pair.impressions : 0;
    return `${fmt.percent(pair.addRatePct / 100)} / ${fmt.integer(impressions)} ${t("insights.impressionsShort", { defaultValue: "Imp." })}`;
  }
  return "";
}
