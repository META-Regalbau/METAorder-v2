# KI-Funktionen in METAorder-v2: können vs. nicht können

## Technische Basis (was überall gilt)

- **Anbieter:** ausschließlich **OpenAI** über [`server/ai/openaiClient.ts`](../server/ai/openaiClient.ts): entweder per Umgebung (`AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY`, hat Vorrang) oder **verschlüsselter API-Key** in den Einstellungen (`openai_settings`, Endpoint `POST /api/settings/ai` in [`server/routes/settingsRoutes.ts`](../server/routes/settingsRoutes.ts)).
- **Betriebsmodi** (Extraktion, Embeddings, FAQ-Verhalten): [`server/ai/aiConfig.ts`](../server/ai/aiConfig.ts) — `local_only` | `openai_optional` | `openai_only` (teilweise per `AI_MODE` / weiteren `AI_*` Umgebungsvariablen überschreibbar).
- **Schutz:** u. a. `aiRateLimiter` (60 req/min) und `semanticRateLimiter` (120 req/min) in [`server/routes.ts`](../server/routes.ts).

---

## Was das System **kann** (konkret implementiert)

### Tickets & Support

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Kategorie + Tags vorschlagen | Titel/Beschreibung → JSON mit Kategorie + Tags | `POST /api/ai/suggest-categories` in [`server/routes.ts`](../server/routes.ts) (Modell `gpt-4o-mini`) |
| Antwort-Vorschläge | 3 deutschsprachige Antwortentwürfe | `POST /api/ai/generate-replies` in [`server/routes.ts`](../server/routes.ts) (`gpt-4o-mini`) |
| Klassifikation für Regeln | Kategorie, Priorität, Sentiment (+ Confidence); ohne API **heuristischer Fallback** | [`server/tickets/ticketAi.ts`](../server/tickets/ticketAi.ts) (`gpt-4o-mini` oder Heuristik) |
| E-Mail-Routing | Klassifikation eingehender Mails (Kategorie, Priorität, Skill); ohne API **heuristisch** | [`server/email/emailClassifier.ts`](../server/email/emailClassifier.ts) |
| Automatisierung | Regel-Aktion „KI-Analyse“ und Bedingung „Stimmung“: nutzt die Ticket-Klassifikation; setzt optional die Kategorie (nur wenn noch `general`) und hebt bei negativer Stimmung niedrige/normale Priorität auf hoch | [`server/automation/actions.ts`](../server/automation/actions.ts) (`run_ai_analysis`, nutzt `ticketAi.ts`) |

### Semantische Suche & FAQ

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Embeddings | OpenAI `text-embedding-3-small` **oder** lokaler Hash-Embedding (ohne API) | [`server/semantic/semanticEmbeddings.ts`](../server/semantic/semanticEmbeddings.ts) |
| Globale semantische Suche | Dokumente über Vektor-Suche + Ranking-Einstellungen | u. a. `POST /api/semantic/search` in [`server/routes.ts`](../server/routes.ts); UI [`client/src/pages/SemanticSearchPage.tsx`](../client/src/pages/SemanticSearchPage.tsx) |
| FAQ-Antwort | Aus Treffern: **GPT-4o** mit quellengebundener JSON-Antwort, oder bei `local_only` / fehlendem Key **Text-Fallback** aus der ersten Quelle | [`server/semantic/semanticFaq.ts`](../server/semantic/semanticFaq.ts); `POST /api/semantic/faq` |
| Produkt-Suche (natürliche Sprache) | Anfrage → strukturierte Interpretation (JSON) mit **GPT-4o**, bei Fehler **Fallback-Interpretation** | [`server/semantic/semanticProductSearch.ts`](../server/semantic/semanticProductSearch.ts) — Nutzung über zugehörige Produkt-Routen/Flows in `routes.ts` (nicht jede Produktliste ist „semantic NL“) |

### Analytics & BI

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Natural Language Analytics | Freitextfrage → strukturierter Analytics-Query (JSON), Ausführung gegen Shopware-Daten; **setzt konfiguriertes OpenAI voraus** | `POST /api/analytics/nl-query` in [`server/routes.ts`](../server/routes.ts); Logik [`server/analytics/naturalLanguageAnalytics.ts`](../server/analytics/naturalLanguageAnalytics.ts) (`gpt-4o`) |
| Automatische Insights | Deutsche Kurz-Insights aus Analyseergebnissen; **ohne OpenAI:** einfachere Basis-Insights | [`server/analytics/automaticInsights.ts`](../server/analytics/automaticInsights.ts) |
| Verbesserungsvorschläge | Aus Analytics/Forecast kontextbezogene Vorschläge; **ohne OpenAI:** leere Liste | [`server/analytics/improvementSuggestions.ts`](../server/analytics/improvementSuggestions.ts) |

### Dokumente, Angebote, Buchhaltung

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Bestell-Entwurf aus Upload | PDF/Bild/Text: **GPT-4o** (Vision bei Bildern), bei `openai_optional` zuerst **lokale Extraktion**, bei schlechter Qualität OpenAI; Fallback auf lokal | [`server/extraction/orderDraftExtractor.ts`](../server/extraction/orderDraftExtractor.ts); Upload in [`server/routes.ts`](../server/routes.ts) (`POST /api/order-drafts/upload`) |
| Angebots-Entwurf aus Upload | Analog zu Order-Drafts | [`server/extraction/offerDraftExtractor.ts`](../server/extraction/offerDraftExtractor.ts); `POST /api/offer-drafts/upload` |
| Smart Pricing | Mengen-/VIP-Logik + optional **KI-Rabatt** und **Begründungstext** | [`server/products/smartPricingEngine.ts`](../server/products/smartPricingEngine.ts) (`gpt-4o-mini`) |
| Buchhaltung | Aus Buchungstexten **Hinweise** (Bestellnr., Rechnungsnr., Betrag, Datum) per **GPT-4o** | [`server/invoicing/accounting.ts`](../server/invoicing/accounting.ts) (`enrichEntriesWithAI`) |

---

## Was das System **nicht kann** bzw. wo harte Grenzen sind

1. **Kein Multi-Provider-KI:** Kein Anthropic, Google Gemini, Azure OpenAI als erstklassige, konfigurierbare Alternative im Code — nur OpenAI-Pfad in [`server/ai/openaiClient.ts`](../server/ai/openaiClient.ts).
2. **Kein „Allgemeiner App-Chat“:** Es gibt keine durchgängige freie Konversations-KI für beliebige Themen; alles ist **aufgaben- und Prompt-spezifisch** (Tickets, FAQ, Analytics, Extraktion, …).
3. **Natural Language Analytics ohne OpenAI:** Schlägt fehl mit klarer Fehlermeldung — im Gegensatz zu Ticket-Klassifikation oder semantischen Embeddings gibt es hier **keinen** echten Offline-Ersatz (siehe [`server/analytics/naturalLanguageAnalytics.ts`](../server/analytics/naturalLanguageAnalytics.ts)).
4. **Bestimmte Endpunkte ohne Key:** z. B. `POST /api/ai/suggest-categories` und `POST /api/ai/generate-replies` antworten mit **„AI features are not enabled“**, wenn kein OpenAI verfügbar ist.
5. **Semantische Produkt-Suche:** Nutzt `getOpenAIClient()` (Umgebung oder Key aus Aufrufer-Kontext). **Ohne** Integration/Key kann die KI-Interpretation ausfallen; es gibt dann **Fallback-Interpretation** im Modul — Qualität/Ergebnis sind dann nicht „volle“ KI-Suche.
6. **Cross-Selling-Vorschläge sind nicht KI:** Endpoint ist ausdrücklich **regelbasiert** (`GET /api/products/:productId/cross-selling-suggestions` in [`server/routes/productRoutes.ts`](../server/routes/productRoutes.ts)).
7. **FAQ-Antwort „ohne Halluzination“ nur im Sinne des Prompts:** Das Modell soll nur Quellen nutzen; **technisch** ist es weiterhin ein LLM — keine Garantie wie bei einem formal verifizierten System.
8. **Automatisierung E-Mail:** Die Regel-Aktion „E-Mail senden“ nutzt den konfigurierten Ausgangs-Versand (Einstellungen → E-Mail ausgehend). Ist er ausgeschaltet, schlägt die Aktion fehl und steht so in der Ausführungshistorie — keine KI-Grenze.
9. **Behoben (Oktober 2026):** Die frühere Automatisierungs-Engine fragte Kategorien wie `technical`/`billing` ab und prüfte gegen ein anderes Enum (Vorschläge landeten meist bei `general`). Die neue Engine nutzt die Ticket-Klassifikation (`classifyTicketForRules`) mit den echten Ticket-Kategorien.

---

## Kurzfassung für Stakeholder

- **Kern:** OpenAI (Chat + Embeddings + Vision für Bilder bei Extraktion), dazu **lokale** Einsparungen (Heuristiken, Hash-Embeddings, lokale Textextraktion), gesteuert über `ai_settings`.
- **Stärken:** Tickets (Vorschläge, Klassifikation), semantische Suche/FAQ, NL-Analytics + Insights, Dokument-Extraktion, Buchhaltungs-Hints, Smart-Pricing-Zusatz.
- **Grenzen:** nur OpenAI; kein universeller Chat; NL-Analytics und einige `/api/ai/*`-Routen **hart** abhängig vom Key; Cross-Selling ohne LLM; Automation-E-Mail-Versand noch nicht produktiv.
