import { getOpenAIClientFromSettings } from "./openaiClient";
import type { AnalyticsResult, AnalyticsInsight, AnalyticsQueryType } from "@shared/schema";
import type { IStorage } from "./storage";

/**
 * Automatic Insights Generator
 * 
 * This module analyzes analytics query results and generates natural language
 * insights in German using OpenAI. It detects trends, anomalies, patterns,
 * and comparisons to provide actionable business intelligence.
 */

const INSIGHTS_SYSTEM_PROMPT = `Du bist ein KI-Assistent für Business Intelligence und Datenanalyse.
Deine Aufgabe ist es, Analyseergebnisse zu untersuchen und aussagekräftige Insights in deutscher Sprache zu generieren.

## RICHTLINIEN FÜR INSIGHTS:

1. **Sei präzise und konkret**: Verwende konkrete Zahlen, Prozentsätze und Trends
2. **Sei handlungsorientiert**: Biete wo möglich Empfehlungen oder Handlungshinweise
3. **Sei verständlich**: Verwende klare, geschäftliche Sprache ohne zu viel Fachjargon
4. **Sei relevant**: Konzentriere dich auf die wichtigsten Erkenntnisse
5. **Verwende Deutsch**: Alle Insights müssen auf Deutsch sein

## ARTEN VON INSIGHTS:

### Trend-Insights:
- Wachstum oder Rückgang über Zeit
- Saisonale Muster
- Beschleunigung oder Verlangsamung
Beispiele:
- "Der Umsatz ist in den letzten 30 Tagen um 15% gestiegen"
- "Die Anzahl der Bestellungen zeigt einen positiven Trend mit +8% gegenüber dem Vormonat"

### Vergleichs-Insights:
- Relative Performance zwischen Produkten/Kunden/Kategorien
- Best/Worst Performer
- Marktanteil-Verteilung
Beispiele:
- "Produkt 'Regal XL' macht 35% des Gesamtumsatzes aus"
- "Die Top 3 Kunden generieren 45% des Gesamtumsatzes"

### Anomalie-Insights:
- Ungewöhnliche Spitzen oder Einbrüche
- Ausreißer in den Daten
- Unerwartete Muster
Beispiele:
- "Ungewöhnlich hohe Bestellungen am 15. März (3x Durchschnitt)"
- "Produkt X verzeichnet unerwarteten Rückgang von 40%"

### Performance-Insights:
- Effizienz-Metriken
- Zielerreichung
- KPIs und Benchmarks
Beispiele:
- "Durchschnittlicher Bestellwert liegt bei 450€, 12% über dem Ziel"
- "85% der Bestellungen werden pünktlich geliefert"

### Problem-Insights:
- Verzögerungen und Bottlenecks
- Qualitätsprobleme
- Risikobereiche
Beispiele:
- "15 Bestellungen sind überfällig und erfordern Aufmerksamkeit"
- "Zahlungsverzögerungen bei 8% der offenen Bestellungen"

## AUSGABEFORMAT:

Gib ein JSON-Array von Insight-Objekten zurück. Jedes Objekt hat:
- "text": Der Insight-Text auf Deutsch
- "type": "trend" | "anomaly" | "comparison" | "general"
- "confidence": Optional, 0-100 (wie sicher bist du bei diesem Insight)

Beispiel:
[
  {
    "text": "Der Umsatz ist in den letzten 30 Tagen um 15% gestiegen",
    "type": "trend",
    "confidence": 95
  },
  {
    "text": "Die Top 3 Produkte machen 60% des Gesamtumsatzes aus",
    "type": "comparison",
    "confidence": 100
  }
]

Generiere 3-5 aussagekräftige Insights basierend auf den bereitgestellten Daten.
Antworte NUR mit dem JSON-Array, ohne zusätzlichen Text.`;

/**
 * Generates natural language insights from analytics results
 * 
 * @param data - The analytics result data
 * @param queryType - The type of query that generated the data
 * @param storage - Storage interface to access settings
 * @returns Array of insight objects with text and metadata
 */
export async function generateInsights(
  data: AnalyticsResult,
  queryType: AnalyticsQueryType,
  storage: IStorage
): Promise<AnalyticsInsight[]> {
  console.log(`[Insights Generator] Generating insights for query type: ${queryType}`);
  console.log(`[Insights Generator] Data summary:`, JSON.stringify(data.summary, null, 2));

  // Get OpenAI client (dual integration support)
  const openaiConfig = await getOpenAIClientFromSettings(
    (key: string) => storage.getSetting(key)
  );

  if (!openaiConfig) {
    console.warn('[Insights Generator] OpenAI not configured - returning basic insights');
    return generateBasicInsights(data, queryType);
  }

  console.log(`[Insights Generator] Using OpenAI mode: ${openaiConfig.mode}`);

  try {
    // Prepare context for AI
    const context = prepareAnalyticsContext(data, queryType);
    
    console.log('[Insights Generator] Prepared context for AI:', context);

    // Call OpenAI to generate insights with timeout
    const completion = await Promise.race([
      openaiConfig.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: INSIGHTS_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: `Analysiere folgende Daten und generiere Insights:\n\nQuery-Typ: ${queryType}\n\nDaten:\n${JSON.stringify(context, null, 2)}`,
          },
        ],
        temperature: 0.3, // Slightly creative but still consistent
        response_format: { type: 'json_object' },
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), 45000)
      )
    ]) as any;

    const responseContent = completion.choices[0]?.message?.content;
    if (!responseContent) {
      throw new Error('EMPTY_RESPONSE');
    }

    console.log('[Insights Generator] OpenAI response:', responseContent);

    // Parse the JSON response
    const parsedResponse = JSON.parse(responseContent);
    
    // Handle both array and object responses
    let insights: AnalyticsInsight[] = [];
    if (Array.isArray(parsedResponse)) {
      insights = parsedResponse;
    } else if (parsedResponse.insights && Array.isArray(parsedResponse.insights)) {
      insights = parsedResponse.insights;
    } else if (parsedResponse.text && parsedResponse.type) {
      // Handle single insight object
      insights = [parsedResponse];
    } else {
      console.warn('[Insights Generator] Unexpected OpenAI response format:', parsedResponse);
      // Return empty array instead of throwing - fallback will handle it
      insights = [];
    }

    // Validate and normalize insights
    const validatedInsights = insights
      .filter(insight => insight.text && insight.type)
      .map(insight => ({
        text: insight.text,
        type: insight.type as 'trend' | 'anomaly' | 'comparison' | 'general',
        confidence: insight.confidence || undefined,
      }));

    console.log(`[Insights Generator] Generated ${validatedInsights.length} insights`);
    
    return validatedInsights;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Insights Generator] Error generating AI insights:', errorMessage);
    
    // Log specific error types for debugging
    if (errorMessage.includes('TIMEOUT')) {
      console.warn('[Insights Generator] Request timed out - falling back to basic insights');
    } else if (errorMessage.includes('rate_limit') || errorMessage.includes('429')) {
      console.warn('[Insights Generator] Rate limit exceeded - falling back to basic insights');
    } else if (errorMessage.includes('authentication') || errorMessage.includes('401') || 
               errorMessage.includes('api_key') || errorMessage.includes('Incorrect API key')) {
      console.warn('[Insights Generator] Authentication failed - falling back to basic insights');
    } else if (errorMessage.includes('EMPTY_RESPONSE')) {
      console.warn('[Insights Generator] Empty response from OpenAI - falling back to basic insights');
    }
    
    console.log('[Insights Generator] Falling back to basic insights');
    return generateBasicInsights(data, queryType);
  }
}

/**
 * Prepares analytics data context for AI processing
 */
function prepareAnalyticsContext(data: AnalyticsResult, queryType: AnalyticsQueryType): any {
  const context: any = {
    queryType,
    dataPoints: data.labels.length,
    summary: data.summary,
  };

  // Add top items for analysis
  if (Array.isArray(data.data) && data.labels.length > 0) {
    const topItems = data.labels.slice(0, 10).map((label, index) => ({
      label,
      value: Array.isArray(data.data) ? data.data[index] : data.data,
    }));
    context.topItems = topItems;
  }

  // Add metadata if available
  if (data.metadata) {
    context.metadata = data.metadata;
  }

  // Calculate some basic statistics
  if (Array.isArray(data.data) && typeof data.data[0] === 'number') {
    const numbers = data.data as number[];
    const sorted = [...numbers].sort((a, b) => a - b);
    
    context.statistics = {
      min: Math.min(...numbers),
      max: Math.max(...numbers),
      median: sorted[Math.floor(sorted.length / 2)],
      total: numbers.reduce((sum, n) => sum + n, 0),
    };

    // Calculate trend if it's time-series data
    if (numbers.length > 1) {
      const firstHalf = numbers.slice(0, Math.floor(numbers.length / 2));
      const secondHalf = numbers.slice(Math.floor(numbers.length / 2));
      const firstAvg = firstHalf.reduce((sum, n) => sum + n, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, n) => sum + n, 0) / secondHalf.length;
      const trendPercentage = ((secondAvg - firstAvg) / firstAvg) * 100;
      
      context.statistics.trend = {
        direction: trendPercentage > 0 ? 'steigend' : 'fallend',
        percentage: Math.abs(trendPercentage).toFixed(1),
      };
    }
  }

  return context;
}

/**
 * Generates basic rule-based insights when AI is not available
 */
function generateBasicInsights(data: AnalyticsResult, queryType: AnalyticsQueryType): AnalyticsInsight[] {
  console.log('[Insights Generator] Generating basic rule-based insights');
  
  const insights: AnalyticsInsight[] = [];

  // Summary insight
  if (data.summary) {
    if (data.summary.total !== undefined) {
      insights.push({
        text: `Gesamtwert: ${data.summary.total.toFixed(2)}€`,
        type: 'general',
        confidence: 100,
      });
    }

    if (data.summary.average !== undefined) {
      insights.push({
        text: `Durchschnittswert: ${data.summary.average.toFixed(2)}€`,
        type: 'general',
        confidence: 100,
      });
    }

    if (data.summary.count !== undefined) {
      insights.push({
        text: `Anzahl Datenpunkte: ${data.summary.count}`,
        type: 'general',
        confidence: 100,
      });
    }
  }

  // Query-specific insights
  switch (queryType) {
    case 'top_products':
      if (data.labels.length > 0) {
        insights.push({
          text: `Das meistverkaufte Produkt ist "${data.labels[0]}"`,
          type: 'comparison',
          confidence: 100,
        });
      }
      break;

    case 'delayed_orders':
      if (data.summary?.count) {
        insights.push({
          text: `Es gibt ${data.summary.count} verspätete Bestellungen, die Aufmerksamkeit erfordern`,
          type: 'general',
          confidence: 100,
        });
      }
      break;

    case 'revenue_trends':
    case 'order_trends':
      if (Array.isArray(data.data) && typeof data.data[0] === 'number' && data.data.length > 1) {
        const numbers = data.data as number[];
        const firstHalf = numbers.slice(0, Math.floor(numbers.length / 2));
        const secondHalf = numbers.slice(Math.floor(numbers.length / 2));
        const firstAvg = firstHalf.reduce((sum, n) => sum + n, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, n) => sum + n, 0) / secondHalf.length;
        const change = ((secondAvg - firstAvg) / firstAvg) * 100;
        
        if (change > 0) {
          insights.push({
            text: `Positiver Trend: ${change.toFixed(1)}% Wachstum im Vergleich zur ersten Hälfte des Zeitraums`,
            type: 'trend',
            confidence: 90,
          });
        } else if (change < 0) {
          insights.push({
            text: `Negativer Trend: ${Math.abs(change).toFixed(1)}% Rückgang im Vergleich zur ersten Hälfte des Zeitraums`,
            type: 'trend',
            confidence: 90,
          });
        }
      }
      break;

    case 'customer_rankings':
      if (data.labels.length >= 3 && data.summary?.total) {
        const top3Total = Array.isArray(data.data) && typeof data.data[0] === 'number'
          ? (data.data as number[]).slice(0, 3).reduce((sum, n) => sum + n, 0)
          : 0;
        const percentage = (top3Total / data.summary.total) * 100;
        
        insights.push({
          text: `Die Top 3 Kunden generieren ${percentage.toFixed(1)}% des Gesamtumsatzes`,
          type: 'comparison',
          confidence: 100,
        });
      }
      break;
  }

  console.log(`[Insights Generator] Generated ${insights.length} basic insights`);
  
  return insights;
}

/**
 * Detects anomalies in time-series data
 * 
 * @param values - Array of numeric values
 * @param threshold - Standard deviation threshold for anomaly detection
 * @returns Array of anomaly indices
 */
export function detectAnomalies(values: number[], threshold: number = 2): number[] {
  if (values.length < 3) {
    return [];
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  const anomalies: number[] = [];
  
  values.forEach((value, index) => {
    const zScore = Math.abs((value - mean) / stdDev);
    if (zScore > threshold) {
      anomalies.push(index);
    }
  });

  return anomalies;
}

/**
 * Calculates percentage change between two values
 * 
 * @param oldValue - Previous value
 * @param newValue - Current value
 * @returns Percentage change
 */
export function calculatePercentageChange(oldValue: number, newValue: number): number {
  if (oldValue === 0) {
    return newValue > 0 ? 100 : 0;
  }
  
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Detects trend direction from time-series data
 * 
 * @param values - Array of numeric values
 * @returns Trend direction: 'increasing', 'decreasing', or 'stable'
 */
export function detectTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
  if (values.length < 2) {
    return 'stable';
  }

  // Simple linear regression to detect trend
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  values.forEach((y, x) => {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

  // Threshold for considering trend as stable (adjust as needed)
  const threshold = 0.01;

  if (slope > threshold) {
    return 'increasing';
  } else if (slope < -threshold) {
    return 'decreasing';
  } else {
    return 'stable';
  }
}
