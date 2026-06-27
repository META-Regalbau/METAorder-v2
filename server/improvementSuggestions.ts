import crypto from "crypto";
import { chatCompletion, isChatLlmConfigured, parseLlmJsonResponse } from "./llmChat";
import type { IStorage } from "./storage";

const IMPROVEMENT_SYSTEM_PROMPT = `Du bist ein erfahrener E-Commerce Business Analyst und Berater.

Deine Aufgabe ist es, Analytics- und Prognosedaten zu analysieren und **konkrete, umsetzbare Verbesserungsvorschläge** zu generieren.

## ANFORDERUNGEN AN DIE VORSCHLÄGE:

1. **Spezifisch und umsetzbar** - Keine vagen Ratschläge wie "Marketing verbessern"
   ✓ GUTES Beispiel: "Email-Kampagne für Kunden starten, die in den letzten 90 Tagen nichts gekauft haben"
   ✗ SCHLECHTES Beispiel: "Kundenbindung verbessern"

2. **Datenbasiert** - Jeder Vorschlag muss auf konkreten Daten basieren
   - Beziehe dich auf Trends, Muster, Anomalien
   - Nutze die bereitgestellten Zahlen und Statistiken
   
3. **Priorisiert nach Impact** - Setze Prioritäten basierend auf:
   - high: Hoher erwarteter Impact (>20% Verbesserung), dringend
   - medium: Moderater Impact (5-20%), wichtig mittelfristig
   - low: Geringer Impact (<5%), nice-to-have

4. **Kategorisiert**:
   - revenue: Umsatzsteigerung
   - inventory: Lagerbestand/Beschaffung
   - marketing: Marketing & Kundenakquise
   - operations: Betriebliche Effizienz
   - customer_service: Kundenservice & -bindung
   - general: Allgemeine Verbesserungen

5. **Mit konkreten Aktionsschritten** - Mindestens 2-3 spezifische Schritte

6. **Impact-Schätzung** - Quantifizierbare Erwartung
   Beispiele: "15-20% Umsatzsteigerung möglich", "€5.000-€8.000 zusätzlicher Monatsumsatz"

7. **Realistischer Zeitrahmen**
   Beispiele: "Innerhalb von 2 Wochen umsetzbar", "Erfordert 1-2 Monate Implementierung"

## BEISPIEL-OUTPUT:

{
  "suggestions": [
    {
      "category": "revenue",
      "priority": "high",
      "title": "Saisonale Preisstrategie für Q4 implementieren",
      "description": "Die Daten zeigen eine starke Saisonalität mit 40% höheren Umsätzen im Q4. Eine gezielte Preisstrategie könnte zusätzliches Umsatzpotential von €15.000-€20.000 freisetzen.",
      "expectedImpact": "€15.000-€20.000 zusätzlicher Umsatz im Q4",
      "actionItems": [
        "Historische Q4-Verkaufsdaten der Top 10 Produkte analysieren",
        "Dynamische Preisanpassungen 2 Wochen vor Peak-Season starten",
        "Bundle-Angebote für häufig zusammen gekaufte Produkte erstellen",
        "Early-Bird-Rabatte für Vorab-Bestellungen im September/Oktober"
      ],
      "timeframe": "Vorbereitung ab sofort, Implementierung bis September",
      "confidence": 85,
      "basedOn": "Saisonale Muster zeigen 40% Umsatzsteigerung in Q4, Prognose mit 85% Genauigkeit"
    },
    {
      "category": "inventory",
      "priority": "medium",
      "title": "Lagerbestand für prognostizierte Nachfragesteigerung aufstocken",
      "description": "Die Prognose zeigt eine erwartete Nachfragesteigerung von 25% in den nächsten 3 Monaten. Aktueller Lagerbestand könnte zu Lieferengpässen führen.",
      "expectedImpact": "Vermeidung von Out-of-Stock-Situationen, ca. €8.000 entgangener Umsatz verhindert",
      "actionItems": [
        "Top 20 Produkte identifizieren die voraussichtlich stark nachgefragt werden",
        "Lagerbestand um 30% aufstocken für diese Produkte",
        "Lieferantenvereinbarungen für schnellere Nachbestellungen treffen"
      ],
      "timeframe": "Innerhalb der nächsten 4 Wochen",
      "confidence": 78,
      "basedOn": "Prognose zeigt 25% Nachfragesteigerung, Saisonale Analyse bestätigt Muster"
    }
  ]
}

## WICHTIGE HINWEISE:

- Generiere 2-5 Vorschläge (nicht mehr, nicht weniger)
- Fokussiere auf die wichtigsten Chancen und Risiken
- Sei konkret, nicht allgemein
- Nutze die Daten intelligent
- Denke wie ein Unternehmensberater, der echte Ergebnisse liefern muss

Antworte AUSSCHLIESSLICH mit einem gültigen JSON-Objekt im oben gezeigten Format.`;

function formatNumber(num: number | unknown): string {
  if (typeof num !== "number") return String(num);
  if (num > 100 && num % 1 !== 0) {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    }).format(num);
  }
  return new Intl.NumberFormat("de-DE").format(num);
}

function buildAnalyticsContext(query: any, result: any): string {
  let context = `**Query-Typ:** ${query.type}\n`;
  context += `**Benutzer-Frage:** ${query.naturalLanguageQuery}\n\n`;

  if (result.summary) {
    context += `**Zusammenfassung:**\n`;
    if (result.summary.total !== undefined) {
      context += `- Gesamt: ${formatNumber(result.summary.total)}\n`;
    }
    if (result.summary.average !== undefined) {
      context += `- Durchschnitt: ${formatNumber(result.summary.average)}\n`;
    }
    if (result.summary.min !== undefined && result.summary.max !== undefined) {
      context += `- Min/Max: ${formatNumber(result.summary.min)} / ${formatNumber(result.summary.max)}\n`;
    }
    if (result.summary.count !== undefined) {
      context += `- Anzahl Datenpunkte: ${result.summary.count}\n`;
    }
    context += "\n";
  }

  if (result.forecast) {
    context += `**Prognose-Informationen:**\n`;
    context += `- Algorithmus: ${result.forecast.algorithm}\n`;
    context += `- Genauigkeit: ${result.forecast.accuracy}%\n`;
    context += `- Saisonalität erkannt: ${result.forecast.seasonalityDetected ? "Ja" : "Nein"}\n`;
    context += `- Prognose-Perioden: ${result.forecast.periods}\n`;
    if (result.forecast.values && result.forecast.values.length > 0) {
      const avgForecast =
        result.forecast.values.reduce((a: number, b: number) => a + b, 0) /
        result.forecast.values.length;
      context += `- Durchschnittliche Prognose: ${formatNumber(avgForecast)}\n`;
    }
    context += "\n";
  }

  if (result.metadata) {
    context += `**Zusätzliche Erkenntnisse:**\n`;
    if (result.metadata.trend) {
      context += `- Trend: ${result.metadata.trend}\n`;
    }
    if (result.metadata.trendStrength !== undefined) {
      context += `- Trendstärke: ${result.metadata.trendStrength}%\n`;
    }
    if (result.metadata.seasonalityDetected !== undefined) {
      context += `- Saisonalität: ${result.metadata.seasonalityDetected ? "Ja" : "Nein"}\n`;
    }
    if (result.metadata.seasonalPeriod) {
      context += `- Saisonale Periode: ${result.metadata.seasonalPeriod} ${query.parameters.groupBy || "Perioden"}\n`;
    }
    if (result.metadata.historicalTotal && result.metadata.forecastTotal) {
      const change =
        ((result.metadata.forecastTotal - result.metadata.historicalTotal) /
          result.metadata.historicalTotal) *
        100;
      context += `- Erwartete Veränderung: ${change > 0 ? "+" : ""}${change.toFixed(1)}%\n`;
    }
    context += "\n";
  }

  if (result.labels && result.data) {
    const recentCount = Math.min(5, result.labels.length);
    context += `**Letzte ${recentCount} Datenpunkte:**\n`;
    for (
      let i = result.labels.length - recentCount;
      i < result.labels.length;
      i++
    ) {
      context += `- ${result.labels[i]}: ${formatNumber(result.data[i])}\n`;
    }
  }

  return context;
}

export async function generateImprovementSuggestions(
  query: any,
  result: any,
  storage: IStorage,
): Promise<any[]> {
  console.log(
    "[Improvement Suggestions] Generating suggestions for query type:",
    query.type,
  );

  const llmOk = await isChatLlmConfigured((key) => storage.getSetting(key));

  if (!llmOk) {
    console.log(
      "[Improvement Suggestions] Chat LLM not configured - skipping suggestions",
    );
    return [];
  }

  const context = buildAnalyticsContext(query, result);

  try {
    const responseContent = (await Promise.race([
      chatCompletion((key) => storage.getSetting(key), {
        model: "gpt-4o",
        messages: [
          { role: "system", content: IMPROVEMENT_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Analysiere diese E-Commerce Analytics-Daten und generiere konkrete Verbesserungsvorschläge:\n\n${context}`,
          },
        ],
        temperature: 0.3,
        response_json: true,
      }),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), 45_000),
      ),
    ])) as string;
    if (!responseContent) {
      console.error("[Improvement Suggestions] Empty response from LLM");
      return [];
    }

    const parsed = parseLlmJsonResponse(responseContent) as Record<string, unknown>;
    const rawList = parsed.suggestions;
    const list = Array.isArray(rawList) ? rawList : [];
    const suggestions = list.map((s: any) => ({
      id: crypto.randomUUID(),
      category: s.category || "general",
      priority: s.priority || "medium",
      title: s.title,
      description: s.description,
      expectedImpact: s.expectedImpact,
      actionItems: s.actionItems || [],
      timeframe: s.timeframe,
      confidence: s.confidence || 75,
      basedOn: s.basedOn,
    }));

    console.log(
      `[Improvement Suggestions] Generated ${suggestions.length} suggestions`,
    );
    return suggestions;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      "[Improvement Suggestions] Error generating suggestions:",
      errorMessage,
    );
    if (errorMessage.includes("TIMEOUT")) {
      console.warn("[Improvement Suggestions] Request timed out");
    } else if (
      errorMessage.includes("rate_limit") ||
      errorMessage.includes("429")
    ) {
      console.warn("[Improvement Suggestions] Rate limit exceeded");
    } else if (
      errorMessage.includes("authentication") ||
      errorMessage.includes("401") ||
      errorMessage.includes("api_key") ||
      errorMessage.includes("Incorrect API key")
    ) {
      console.warn("[Improvement Suggestions] Authentication failed");
    }
    return [];
  }
}
