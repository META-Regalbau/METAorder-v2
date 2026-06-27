import { getOpenAIClientFromSettings } from "./openaiClient";
import type { AnalyticsQuery, AnalyticsQueryType } from "@shared/schema";
import type { IStorage } from "./storage";

/**
 * Natural Language Analytics Query Processor
 * 
 * This module processes natural language questions (German/English) about orders,
 * products, and customers, converting them into structured analytics queries.
 * 
 * Uses OpenAI GPT-4o to understand the user's intent and extract relevant parameters.
 */

/**
 * Generate the analytics system prompt with current date examples
 */
function generateAnalyticsSystemPrompt(): string {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
  const ninetyDaysAgo = new Date(Date.now() - 90*86400000).toISOString().split('T')[0];
  
  return `Du bist ein intelligenter Analytics-Assistent für ein Shopware E-Commerce System.
Deine Aufgabe ist es, natürlichsprachige Fragen in strukturierte Datenbank-Abfragen zu konvertieren.

## VERFÜGBARE DATENQUELLEN:

### Orders (Bestellungen):
- id: Eindeutige Bestell-ID
- orderNumber: Bestellnummer (z.B. "10001")
- customerName: Kundenname
- customerEmail: Kunden-Email
- orderDate: Bestelldatum (ISO 8601 Format)
- deliveryDateEarliest: Frühestes Lieferdatum
- deliveryDateLatest: Spätestes Lieferdatum
- totalAmount: Bruttogesamtbetrag (mit MwSt)
- netTotalAmount: Nettogesamtbetrag (ohne MwSt)
- status: Bestellstatus ("open", "in_progress", "completed", "cancelled")
- paymentStatus: Zahlungsstatus ("open", "paid", "partially_paid", "refunded", "cancelled", "reminded", "failed")
- paymentMethod: Zahlungsart (z.B. "Rechnung", "PayPal", "Kreditkarte")
- shippingMethod: Versandart (z.B. "DHL Standard", "Express")
- salesChannelId: Verkaufskanal-ID
- salesChannelName: Verkaufskanal-Name
- items: Array von Bestellpositionen mit:
  - name: Produktname
  - quantity: Anzahl
  - price: Bruttopreis
  - netPrice: Nettopreis
  - total: Bruttosumme
  - netTotal: Nettosumme
  - taxRate: Steuersatz
  - categoryNames: Kategorien des Produkts
- discount: Rabattinformationen (amount, percentage)

### Products (Produkte - über Shopware API):
- id: Produkt-ID
- productNumber: Artikelnummer
- name: Produktname
- price: Bruttopreis
- netPrice: Nettopreis
- stock: Lagerbestand
- available: Verfügbarkeit
- manufacturerName: Hersteller
- categoryNames: Kategorien

### Customers (Kunden - über Shopware API):
- Zugriff über customerName und customerEmail aus Orders

## UNTERSTÜTZTE QUERY-TYPEN:

1. **top_products** - Top-verkaufte Produkte
   Parameter: limit (Anzahl), dateFrom, dateTo, salesChannelId
   
2. **delayed_orders** - Verspätete/verzögerte Bestellungen
   Parameter: dateFrom, dateTo, status
   
3. **order_trends** - Bestelltrends über Zeit
   Parameter: dateFrom, dateTo, groupBy (day/week/month/year)
   
4. **revenue_trends** - Umsatztrends über Zeit
   Parameter: dateFrom, dateTo, groupBy (day/week/month/year)
   
5. **customer_analysis** - Kundenanalyse
   Parameter: dateFrom, dateTo, limit
   
6. **customer_rankings** - Kunden-Rangliste nach Bestellwert
   Parameter: limit, dateFrom, dateTo
   
7. **product_performance** - Produktperformance
   Parameter: productId, dateFrom, dateTo
   
8. **category_performance** - Kategorie-Performance
   Parameter: categoryName, dateFrom, dateTo
   
9. **payment_analysis** - Zahlungsanalyse
   Parameter: dateFrom, dateTo, paymentStatus
   
10. **sales_channel_analysis** - Verkaufskanal-Analyse
    Parameter: salesChannelId, dateFrom, dateTo
    
11. **order_status_distribution** - Verteilung der Bestellstatus
    Parameter: dateFrom, dateTo
    
12. **general_statistics** - Allgemeine Statistiken
    Parameter: dateFrom, dateTo
    
13. **revenue_forecast** - Umsatzprognose für zukünftige Perioden
    Parameter: forecastPeriods (Anzahl Perioden), forecastUnit (day/week/month/quarter/year), 
              dateFrom (historische Daten), dateTo, algorithm (linear/exponential/seasonal/auto),
              includeSeasonality (true/false)
    
14. **product_demand_forecast** - Absatzprognose für Produkte
    Parameter: productId (optional, für spezifisches Produkt), forecastPeriods, forecastUnit,
              dateFrom, dateTo, algorithm
    
15. **seasonal_analysis** - Saisonale Muster-Analyse
    Parameter: dateFrom, dateTo, groupBy (zur Identifizierung von Mustern)
    
16. **trend_forecast** - Allgemeine Trend-Prognose
    Parameter: forecastPeriods, forecastUnit, dateFrom, dateTo, algorithm
    
17. **weight_analysis** - Gewichtsanalyse für Bestellungen
    Parameter: dateFrom, dateTo, salesChannelId
    Berechnet: Durchschnittsgewicht pro Bestellung, Gesamtgewicht, Gewichtsverteilung

18. **item_count_analysis** - Analyse der Artikelanzahl pro Bestellung
    Parameter: dateFrom, dateTo, salesChannelId
    Berechnet: Durchschnittliche Artikelanzahl pro Bestellung, Gesamtanzahl Artikel, Verteilung der Artikelanzahl

## BEISPIEL-FRAGEN UND ERWARTETE AUSGABE:

Frage: "Top 10 Produkte vom letzten Monat"
→ {
  "type": "top_products",
  "parameters": {
    "limit": 10,
    "dateFrom": "<1 Monat zurück>",
    "dateTo": "<heute>"
  }
}

Frage: "Bestellungen mit Verzögerungen"
→ {
  "type": "delayed_orders",
  "parameters": {}
}

Frage: "Umsatz-Trend der letzten 90 Tage"
→ {
  "type": "revenue_trends",
  "parameters": {
    "dateFrom": "<90 Tage zurück>",
    "dateTo": "<heute>",
    "groupBy": "week"
  }
}

Frage: "Beste 20 Kunden nach Bestellwert"
→ {
  "type": "customer_rankings",
  "parameters": {
    "limit": 20,
    "sortBy": "totalAmount",
    "sortOrder": "desc"
  }
}

Frage: "Wie viele Bestellungen wurden heute erstellt?"
→ {
  "type": "general_statistics",
  "parameters": {
    "dateFrom": "<heute 00:00>",
    "dateTo": "<jetzt>"
  }
}

Frage: "Umsatzprognose für nächstes Jahr"
→ {
  "type": "revenue_forecast",
  "parameters": {
    "dateFrom": "${ninetyDaysAgo}",
    "dateTo": "${today}",
    "forecastPeriods": 12,
    "forecastUnit": "month",
    "algorithm": "auto",
    "includeSeasonality": true
  }
}

Frage: "Welche Produkte werden im Dezember stark nachgefragt?"
→ {
  "type": "product_demand_forecast",
  "parameters": {
    "dateFrom": "${ninetyDaysAgo}",
    "dateTo": "${today}",
    "forecastPeriods": 2,
    "forecastUnit": "month",
    "algorithm": "seasonal"
  }
}

Frage: "Gibt es saisonale Muster in den Bestellungen?"
→ {
  "type": "seasonal_analysis",
  "parameters": {
    "dateFrom": "${ninetyDaysAgo}",
    "dateTo": "${today}",
    "groupBy": "week"
  }
}

Frage: "Wie entwickelt sich der Umsatz in den nächsten 6 Monaten?"
→ {
  "type": "trend_forecast",
  "parameters": {
    "dateFrom": "${ninetyDaysAgo}",
    "dateTo": "${today}",
    "forecastPeriods": 6,
    "forecastUnit": "month",
    "algorithm": "auto"
  }
}

Frage: "Was ist das Durchschnittsgewicht der Bestellungen?"
→ {
  "type": "weight_analysis",
  "parameters": {}
}

Frage: "Wie viel wiegen die Bestellungen vom letzten Monat im Durchschnitt?"
→ {
  "type": "weight_analysis",
  "parameters": {
    "dateFrom": "${thirtyDaysAgo}",
    "dateTo": "${today}"
  }
}

Frage: "Wie viele Artikel haben die Bestellungen im Durchschnitt?"
→ {
  "type": "item_count_analysis",
  "parameters": {}
}

Frage: "Durchschnittliche Artikelanzahl pro Bestellung im letzten Monat"
→ {
  "type": "item_count_analysis",
  "parameters": {
    "dateFrom": "${thirtyDaysAgo}",
    "dateTo": "${today}"
  }
}

## ANWEISUNGEN:

WICHTIG: Berechne ALLE Datumswerte basierend auf dem heutigen Datum (${today}) und gib sie als ISO 8601 Strings zurück!

1. Analysiere die Frage und bestimme den passenden Query-Typ
2. Extrahiere alle relevanten Parameter (Zeiträume, Limits, Filter)
3. Konvertiere relative Zeitangaben in KONKRETE ISO 8601 Datumswerte:
   - "heute" → ${today}
   - "gestern" → ${yesterday}
   - "letzte Woche" (7 Tage zurück) → ${sevenDaysAgo}
   - "letzter Monat" (30 Tage zurück) → ${thirtyDaysAgo}
   - "letzte 90 Tage" → dateFrom: ${ninetyDaysAgo}, dateTo: ${today}
4. Setze sinnvolle Standardwerte:
   - limit: 10 (wenn nicht anders angegeben)
   - groupBy: "day" für Zeiträume < 30 Tage, "week" für < 90 Tage, "month" für längere
5. Antworte NUR mit einem gültigen JSON-Objekt im folgenden Format:

{
  "type": "<query_type>",
  "parameters": {
    "limit": <number>,
    "dateFrom": "<ISO 8601 date>",
    "dateTo": "<ISO 8601 date>",
    "groupBy": "<day|week|month|year>",
    ...weitere Parameter je nach Query-Typ
  },
  "sqlHints": ["<optionale Hinweise für SQL-Optimierung>"]
}

Antworte AUSSCHLIESSLICH mit dem JSON-Objekt, ohne zusätzlichen Text.`;
}

/**
 * Processes a natural language query and converts it to a structured analytics query
 * 
 * @param question - The natural language question (German or English)
 * @param userId - The user ID making the request
 * @param storage - Storage interface to access settings
 * @returns Structured analytics query object
 */
export async function processNaturalLanguageQuery(
  question: string,
  userId: string,
  storage: IStorage
): Promise<AnalyticsQuery> {
  console.log(`[NL Analytics] Processing query from user ${userId}: "${question}"`);

  // Get OpenAI client (dual integration support)
  const openaiConfig = await getOpenAIClientFromSettings(
    (key: string) => storage.getSetting(key)
  );

  if (!openaiConfig) {
    console.error('[NL Analytics] OpenAI not configured - neither Replit integration nor API key available');
    throw new Error('OpenAI integration not available. Please configure API key in settings.');
  }

  console.log(`[NL Analytics] Using OpenAI mode: ${openaiConfig.mode}`);

  try {
    // Call OpenAI to process the natural language query with timeout
    const completion = await Promise.race([
      openaiConfig.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: generateAnalyticsSystemPrompt(),
          },
          {
            role: 'user',
            content: question,
          },
        ],
        temperature: 0.1, // Low temperature for consistent, deterministic results
        response_format: { type: 'json_object' }, // Enforce JSON response
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('KI-Anfrage hat zu lange gedauert - bitte versuchen Sie es erneut')), 45000)
      )
    ]) as any;

    const responseContent = completion.choices[0]?.message?.content;
    if (!responseContent) {
      throw new Error('Leere Antwort von KI-Service erhalten');
    }

    console.log('[NL Analytics] OpenAI response:', responseContent);

    // Parse the JSON response
    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(responseContent);
    } catch (parseError) {
      console.error('[NL Analytics] JSON parse error:', parseError);
      console.error('[NL Analytics] Raw response that failed to parse:', responseContent);
      throw new Error('KI-Antwort konnte nicht verarbeitet werden - ungültiges JSON-Format');
    }

    console.log('[NL Analytics] Parsed response structure:', JSON.stringify(parsedResponse, null, 2));

    // Validate the response structure
    if (!parsedResponse.type || !parsedResponse.parameters) {
      console.error('[NL Analytics] Invalid response structure - missing type or parameters');
      console.error('[NL Analytics] Response has keys:', Object.keys(parsedResponse));
      console.error('[NL Analytics] type value:', parsedResponse.type);
      console.error('[NL Analytics] parameters value:', parsedResponse.parameters);
      throw new Error(`Ungültige Antwortstruktur von KI-Service - erwartet 'type' und 'parameters', erhalten: ${Object.keys(parsedResponse).join(', ')}`);
    }

    console.log('[NL Analytics] Parsed parameters BEFORE conversion:', JSON.stringify(parsedResponse.parameters, null, 2));

    // Construct the final AnalyticsQuery object
    const analyticsQuery: AnalyticsQuery = {
      type: parsedResponse.type as AnalyticsQueryType,
      parameters: parsedResponse.parameters || {},
      sqlHints: parsedResponse.sqlHints || [],
      naturalLanguageQuery: question,
    };

    // Convert any relative date placeholders to actual ISO dates
    convertRelativeDates(analyticsQuery.parameters);
    
    console.log('[NL Analytics] Parsed parameters AFTER conversion:', JSON.stringify(analyticsQuery.parameters, null, 2));

    console.log('[NL Analytics] Structured query:', JSON.stringify(analyticsQuery, null, 2));

    return analyticsQuery;
  } catch (error) {
    console.error('[NL Analytics] Error processing query:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unbekannter Fehler';
    
    // If already a German error message, throw it directly
    if (errorMessage.includes('KI-Anfrage') || errorMessage.includes('KI-Service') || 
        errorMessage.includes('Ungültige') || errorMessage.includes('Leere')) {
      throw error;
    }
    
    // Handle specific error types
    if (error instanceof SyntaxError) {
      throw new Error('KI-Antwort konnte nicht verarbeitet werden - ungültiges Format');
    }
    
    // Check for rate limit errors
    if (errorMessage.includes('rate_limit') || errorMessage.includes('429')) {
      throw new Error('KI-Service ist derzeit überlastet - bitte versuchen Sie es in ein paar Minuten erneut');
    }
    
    // Check for authentication errors
    if (errorMessage.includes('authentication') || errorMessage.includes('401') || 
        errorMessage.includes('api_key') || errorMessage.includes('Incorrect API key')) {
      throw new Error('KI-Service Authentifizierung fehlgeschlagen - bitte überprüfen Sie die API-Konfiguration');
    }
    
    // Generic error
    throw new Error(`Fehler bei der Verarbeitung der Anfrage: ${errorMessage}`);
  }
}

/**
 * Validates if a query type is supported
 * 
 * @param type - The query type to validate
 * @returns True if supported, false otherwise
 */
export function isSupportedQueryType(type: string): boolean {
  const supportedTypes: AnalyticsQueryType[] = [
    'top_products',
    'delayed_orders',
    'order_trends',
    'revenue_trends',
    'customer_analysis',
    'customer_rankings',
    'product_performance',
    'category_performance',
    'payment_analysis',
    'sales_channel_analysis',
    'order_status_distribution',
    'general_statistics',
    'revenue_forecast',
    'product_demand_forecast',
    'seasonal_analysis',
    'trend_forecast',
    'weight_analysis',
    'item_count_analysis',
  ];

  return supportedTypes.includes(type as AnalyticsQueryType);
}

/**
 * Convert relative date placeholders in query parameters to actual ISO date strings
 * Handles placeholders like "<heute>", "<90 Tage zurück>", etc.
 */
function convertRelativeDates(parameters: Record<string, any>): void {
  const now = new Date();
  
  // Helper function to parse relative date strings
  const parseRelativeDate = (dateStr: string): string | null => {
    if (!dateStr || typeof dateStr !== 'string') {
      return null;
    }
    
    // Remove angle brackets if present
    const cleanStr = dateStr.replace(/[<>]/g, '').trim().toLowerCase();
    
    // Handle "heute" / "today"
    if (cleanStr === 'heute' || cleanStr === 'today') {
      return now.toISOString().split('T')[0];
    }
    
    // Handle "X Tage zurück" / "X days ago" / "X Tage in der Zukunft"
    const daysAgoMatch = cleanStr.match(/(\d+)\s*(tage?|days?)\s*(zurück|ago|in der zukunft|from now)/i);
    if (daysAgoMatch) {
      const days = parseInt(daysAgoMatch[1]);
      const isFuture = cleanStr.includes('zukunft') || cleanStr.includes('from now');
      const date = new Date(now);
      date.setDate(date.getDate() + (isFuture ? days : -days));
      return date.toISOString().split('T')[0];
    }
    
    // Handle "X Monate zurück" / "X months ago"
    const monthsAgoMatch = cleanStr.match(/(\d+)\s*(monat|months?)\s*(zurück|ago)/i);
    if (monthsAgoMatch) {
      const months = parseInt(monthsAgoMatch[1]);
      const date = new Date(now);
      date.setMonth(date.getMonth() - months);
      return date.toISOString().split('T')[0];
    }
    
    // Handle "X Jahre zurück" / "X years ago"
    const yearsAgoMatch = cleanStr.match(/(\d+)\s*(jahre?|years?)\s*(zurück|ago)/i);
    if (yearsAgoMatch) {
      const years = parseInt(yearsAgoMatch[1]);
      const date = new Date(now);
      date.setFullYear(date.getFullYear() - years);
      return date.toISOString().split('T')[0];
    }
    
    // If already a valid ISO date, return as-is
    const isoDateMatch = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
    if (isoDateMatch) {
      return dateStr;
    }
    
    console.log(`[convertRelativeDates] Could not parse date string: "${dateStr}"`);
    return null;
  };
  
  // Convert dateFrom if present
  if (parameters.dateFrom) {
    const converted = parseRelativeDate(parameters.dateFrom);
    if (converted) {
      console.log(`[convertRelativeDates] Converted dateFrom: "${parameters.dateFrom}" → "${converted}"`);
      parameters.dateFrom = converted;
    }
  }
  
  // Convert dateTo if present
  if (parameters.dateTo) {
    const converted = parseRelativeDate(parameters.dateTo);
    if (converted) {
      console.log(`[convertRelativeDates] Converted dateTo: "${parameters.dateTo}" → "${converted}"`);
      parameters.dateTo = converted;
    }
  }
}

/**
 * Helper function to calculate date range from relative time expressions
 * This is a fallback in case OpenAI doesn't convert dates properly
 * 
 * @param expression - Relative time expression (e.g., "last 30 days")
 * @returns Object with dateFrom and dateTo in ISO format
 */
export function parseDateRange(expression: string): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const patterns = [
    { regex: /last (\d+) days?|letzten? (\d+) Tage?/i, days: true },
    { regex: /last month|letzten? Monat/i, days: 30 },
    { regex: /last week|letzte Woche/i, days: 7 },
    { regex: /today|heute/i, days: 0 },
    { regex: /yesterday|gestern/i, days: 1 },
    { regex: /this year|dieses Jahr/i, yearStart: true },
  ];

  for (const pattern of patterns) {
    const match = expression.match(pattern.regex);
    if (match) {
      let dateFrom: Date;
      const dateTo = now.toISOString();

      if (pattern.yearStart) {
        dateFrom = new Date(now.getFullYear(), 0, 1);
      } else if (pattern.days === true && match[1]) {
        const daysAgo = parseInt(match[1] || match[2], 10);
        dateFrom = new Date(today);
        dateFrom.setDate(dateFrom.getDate() - daysAgo);
      } else if (typeof pattern.days === 'number') {
        dateFrom = new Date(today);
        dateFrom.setDate(dateFrom.getDate() - pattern.days);
      } else {
        dateFrom = today;
      }

      return {
        dateFrom: dateFrom.toISOString(),
        dateTo,
      };
    }
  }

  // Default: last 30 days
  const dateFrom = new Date(today);
  dateFrom.setDate(dateFrom.getDate() - 30);
  
  return {
    dateFrom: dateFrom.toISOString(),
    dateTo: now.toISOString(),
  };
}
