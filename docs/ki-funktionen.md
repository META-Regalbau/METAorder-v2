# KI-Funktionen in METAorder-v2: können vs. nicht können

## Technische Basis (was überall gilt)

- **Anbieter:** ausschließlich **OpenAI** über [`server/openaiClient.ts`](../server/openaiClient.ts): entweder Replit-Integration (`AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY`) oder **verschlüsselter API-Key** in den Einstellungen (`openai_settings`, Endpoint `POST /api/settings/ai` in [`server/routes.ts`](../server/routes.ts)).
- **Betriebsmodi** (Extraktion, Embeddings, FAQ-Verhalten): [`server/aiConfig.ts`](../server/aiConfig.ts) — `local_only` | `openai_optional` | `openai_only` (teilweise per `AI_MODE` / weiteren `AI_*` Umgebungsvariablen überschreibbar).
- **Schutz:** u. a. `aiRateLimiter` (60 req/min) und `semanticRateLimiter` (120 req/min) in [`server/routes.ts`](../server/routes.ts).

---

## Was das System **kann** (konkret implementiert)

### Tickets & Support

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Kategorie + Tags vorschlagen | Titel/Beschreibung → JSON mit Kategorie + Tags | `POST /api/ai/suggest-categories` in [`server/routes.ts`](../server/routes.ts) (Modell `gpt-4o-mini`) |
| Antwort-Vorschläge | 3 deutschsprachige Antwortentwürfe | `POST /api/ai/generate-replies` in [`server/routes.ts`](../server/routes.ts) (`gpt-4o-mini`) |
| Klassifikation für Regeln | Kategorie, Priorität, Sentiment (+ Confidence); ohne API **heuristischer Fallback** | [`server/ticketAi.ts`](../server/ticketAi.ts) (`gpt-4o-mini` oder Heuristik) |
| E-Mail-Routing | Klassifikation eingehender Mails (Kategorie, Priorität, Skill); ohne API **heuristisch** | [`server/emailClassifier.ts`](../server/emailClassifier.ts) |
| Automatisierung | Optional: Sentiment-Analyse, Eskalation bei negativem Sentiment + niedriger Priorität; optional Kategorie-Vorschlag | [`server/automationEngine.ts`](../server/automationEngine.ts) (`runAIAnalysisAction`) |

### Semantische Suche & FAQ

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Embeddings | OpenAI `text-embedding-3-small` **oder** lokaler Hash-Embedding (ohne API) | [`server/semanticEmbeddings.ts`](../server/semanticEmbeddings.ts) |
| Globale semantische Suche | Dokumente über Vektor-Suche + Ranking-Einstellungen | u. a. `POST /api/semantic/search` in [`server/routes.ts`](../server/routes.ts); UI [`client/src/pages/SemanticSearchPage.tsx`](../client/src/pages/SemanticSearchPage.tsx) |
| FAQ-Antwort | Aus Treffern: **GPT-4o** mit quellengebundener JSON-Antwort, oder bei `local_only` / fehlendem Key **Text-Fallback** aus der ersten Quelle | [`server/semanticFaq.ts`](../server/semanticFaq.ts); `POST /api/semantic/faq` |
| Produkt-Suche (natürliche Sprache) | Anfrage → strukturierte Interpretation (JSON) mit **GPT-4o**, bei Fehler **Fallback-Interpretation** | [`server/semanticProductSearch.ts`](../server/semanticProductSearch.ts) — Nutzung über zugehörige Produkt-Routen/Flows in `routes.ts` (nicht jede Produktliste ist „semantic NL“) |

### Analytics & BI

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Natural Language Analytics | Freitextfrage → strukturierter Analytics-Query (JSON), Ausführung gegen Shopware-Daten; **setzt konfiguriertes OpenAI voraus** | `POST /api/analytics/nl-query` in [`server/routes.ts`](../server/routes.ts); Logik [`server/naturalLanguageAnalytics.ts`](../server/naturalLanguageAnalytics.ts) (`gpt-4o`) |
| Automatische Insights | Deutsche Kurz-Insights aus Analyseergebnissen; **ohne OpenAI:** einfachere Basis-Insights | [`server/automaticInsights.ts`](../server/automaticInsights.ts) |
| Verbesserungsvorschläge | Aus Analytics/Forecast kontextbezogene Vorschläge; **ohne OpenAI:** leere Liste | [`server/improvementSuggestions.ts`](../server/improvementSuggestions.ts) |

### Dokumente, Angebote, Buchhaltung

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Bestell-Entwurf aus Upload | PDF/Bild/Text: **GPT-4o** (Vision bei Bildern), bei `openai_optional` zuerst **lokale Extraktion**, bei schlechter Qualität OpenAI; Fallback auf lokal | [`server/orderDraftExtractor.ts`](../server/orderDraftExtractor.ts); Upload in [`server/routes.ts`](../server/routes.ts) (`POST /api/order-drafts/upload`) |
| Angebots-Entwurf aus Upload | Analog zu Order-Drafts | [`server/offerDraftExtractor.ts`](../server/offerDraftExtractor.ts); `POST /api/offer-drafts/upload` |
| Smart Pricing | Mengen-/VIP-Logik + optional **KI-Rabatt** und **Begründungstext** | [`server/smartPricingEngine.ts`](../server/smartPricingEngine.ts) (`gpt-4o-mini`) |
| Buchhaltung | Aus Buchungstexten **Hinweise** (Bestellnr., Rechnungsnr., Betrag, Datum) per **GPT-4o** | [`server/accounting.ts`](../server/accounting.ts) (`enrichEntriesWithAI`) |

---

## Was das System **nicht kann** bzw. wo harte Grenzen sind

1. **Kein Multi-Provider-KI:** Kein Anthropic, Google Gemini, Azure OpenAI als erstklassige, konfigurierbare Alternative im Code — nur OpenAI-Pfad in [`server/openaiClient.ts`](../server/openaiClient.ts).
2. **Kein „Allgemeiner App-Chat“:** Es gibt keine durchgängige freie Konversations-KI für beliebige Themen; alles ist **aufgaben- und Prompt-spezifisch** (Tickets, FAQ, Analytics, Extraktion, …).
3. **Natural Language Analytics ohne OpenAI:** Schlägt fehl mit klarer Fehlermeldung — im Gegensatz zu Ticket-Klassifikation oder semantischen Embeddings gibt es hier **keinen** echten Offline-Ersatz (siehe [`server/naturalLanguageAnalytics.ts`](../server/naturalLanguageAnalytics.ts)).
4. **Bestimmte Endpunkte ohne Key:** z. B. `POST /api/ai/suggest-categories` und `POST /api/ai/generate-replies` antworten mit **„AI features are not enabled“**, wenn kein OpenAI verfügbar ist.
5. **Semantische Produkt-Suche:** Nutzt `getOpenAIClient()` (Replit oder Key aus Aufrufer-Kontext). **Ohne** Integration/Key kann die KI-Interpretation ausfallen; es gibt dann **Fallback-Interpretation** im Modul — Qualität/Ergebnis sind dann nicht „volle“ KI-Suche.
6. **Cross-Selling-Vorschläge sind nicht KI:** Endpoint ist ausdrücklich **regelbasiert** (`GET /api/products/:productId/cross-selling-suggestions` in [`server/routes.ts`](../server/routes.ts)).
7. **FAQ-Antwort „ohne Halluzination“ nur im Sinne des Prompts:** Das Modell soll nur Quellen nutzen; **technisch** ist es weiterhin ein LLM — keine Garantie wie bei einem formal verifizierten System.
8. **Automatisierung E-Mail:** `sendEmailAction` ist **nicht** an einen Versand angebunden (aktuell Log/TODO in [`server/automationEngine.ts`](../server/automationEngine.ts)) — das ist keine KI-Grenze, aber oft mit „Automatisierung“ verwechselt.
9. **Bekannte Inkonsistenz (Automation vs. Ticket-Schema):** In `runAIAnalysisAction` fordert der Prompt Kategorien wie `technical`, `billing`, …; die Zuordnung zu DB-Kategorien prüft gegen ein **anderes** Enum — in der Praxis landen viele Vorschläge fälschlich bei `general` ([`server/automationEngine.ts`](../server/automationEngine.ts), Zeilen um 386–420). Das ist eher ein **Qualitäts-/Bug-Thema** als „fehlende KI“.

---

## Kurzfassung für Stakeholder

- **Kern:** OpenAI (Chat + Embeddings + Vision für Bilder bei Extraktion), dazu **lokale** Einsparungen (Heuristiken, Hash-Embeddings, lokale Textextraktion), gesteuert über `ai_settings`.
- **Stärken:** Tickets (Vorschläge, Klassifikation), semantische Suche/FAQ, NL-Analytics + Insights, Dokument-Extraktion, Buchhaltungs-Hints, Smart-Pricing-Zusatz.
- **Grenzen:** nur OpenAI; kein universeller Chat; NL-Analytics und einige `/api/ai/*`-Routen **hart** abhängig vom Key; Cross-Selling ohne LLM; Automation-E-Mail-Versand noch nicht produktiv.
