# KI-Funktionen in METAorder-v2: können vs. nicht können

Stand: Oktober 2026.

## Technische Basis (was überall gilt)

- **Chat-Anbieter je Mandant:** OpenAI, Anthropic (Claude) oder Google (Gemini) über [`server/ai/llmChat.ts`](../server/ai/llmChat.ts) (`chatCompletion`, `isChatLlmConfigured`). Zwei Stufen:
  - `fast` für die Masse, Standard `gpt-4o-mini` / `claude-haiku-4-5-20251001` / `gemini-2.0-flash`;
  - `smart` für schwierige Aufgaben, Standard `gpt-4o` / `claude-sonnet-5` / `gemini-2.5-pro`.

  Anbieter und Modell je Stufe stehen unter Einstellungen → KI ([`server/ai/llmClient.ts`](../server/ai/llmClient.ts)). Die API-Keys sind dort verschlüsselt gespeichert. OpenAI kann alternativ per Umgebung kommen (`AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY`, hat Vorrang).
- **Nur OpenAI** (direkt über [`server/ai/openaiClient.ts`](../server/ai/openaiClient.ts)):
  - Bilderkennung bei der Beleg-Extraktion;
  - Embeddings;
  - Smart Pricing;
  - Buchhaltungs-Hinweise;
  - Teile der Commercial-Pipeline (Signatur-/Firmenerkennung, Nachbearbeitung der Extraktion, Kunden-E-Mail-Zuordnung).
- **Betriebsmodi** (Extraktion, Embeddings, FAQ-Verhalten): [`server/ai/aiConfig.ts`](../server/ai/aiConfig.ts) — `local_only` | `openai_optional` | `openai_only` (teilweise per `AI_MODE` / weiteren `AI_*` Umgebungsvariablen überschreibbar).
- **Schutz vor Kosten und Überlast:**
  - `aiRateLimiter` (60 Anfragen/min) und `semanticRateLimiter` (120 Anfragen/min) in [`server/routes/aiRoutes.ts`](../server/routes/aiRoutes.ts);
  - KI-Antwort der FAQ höchstens 5 je Nutzer und Minute;
  - KI-Auslegung der Produktsuche höchstens 10 je Nutzer und Minute;
  - Natürliche Sprache: Tages- und Minutenlimits (siehe unten).
- **Fehlermeldungen:** Der Server antwortet mit festen Texten. Die Oberfläche zeigt sie in ihrer Sprache an (Katalog `apiErrors` in den Sprachdateien, [`client/src/lib/apiError.ts`](../client/src/lib/apiError.ts)).

---

## Was das System **kann** (konkret implementiert)

### Tickets & Support

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Kategorie + Tags vorschlagen | Titel/Beschreibung → JSON mit Kategorie + Tags | `POST /api/ai/suggest-categories` in [`server/routes/aiRoutes.ts`](../server/routes/aiRoutes.ts) |
| Antwort-Vorschläge | 3 deutschsprachige Antwortentwürfe | `POST /api/ai/generate-replies` in [`server/routes/aiRoutes.ts`](../server/routes/aiRoutes.ts) |
| Klassifikation für Regeln | Kategorie, Priorität, Sentiment (+ Confidence); ohne Anbieter **heuristischer Fallback** | [`server/tickets/ticketAi.ts`](../server/tickets/ticketAi.ts) |
| E-Mail-Routing | Klassifikation eingehender Mails (Kategorie, Priorität, Skill); ohne Anbieter **heuristisch** | [`server/email/emailClassifier.ts`](../server/email/emailClassifier.ts) |
| Automatisierung | Regel-Aktion „KI-Analyse“ und Bedingung „Stimmung“: nutzt die Ticket-Klassifikation; setzt optional die Kategorie (nur wenn noch `general`) und hebt bei negativer Stimmung niedrige/normale Priorität auf hoch | [`server/automation/actions.ts`](../server/automation/actions.ts) (`run_ai_analysis`, nutzt `ticketAi.ts`) |

### Suche & FAQ

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Produktseite | Wortsuche im Produkt-Spiegel: Jedes Wort muss vorkommen, Reihenfolge egal. Sortiert nach Relevanz: ganzes Wort im Namen vor Wortteil, exakte Artikelnummer/EAN zuerst. **Keine KI.** | [`server/products/productSearchRanking.ts`](../server/products/productSearchRanking.ts), `getShopwareProductMirrors` in [`server/dbStorage.ts`](../server/dbStorage.ts) |
| „Mit KI auslegen“ (Produktseite) | Eine Anfrage wie „Fachbodenregal 2 m hoch, 1 m breit“ wird per KI in Produkttyp und Abmessungen zerlegt. Daraus werden Suchwort und Breite/Höhe/Tiefe der Filter; die Treffer liefert die normale Produktsuche. Ein KI-Aufruf je Klick; ohne Anbieter einfache Wortzerlegung. | `POST /api/products/semantic-search` mit `interpretOnly` in [`server/routes/productRoutes.ts`](../server/routes/productRoutes.ts); [`server/semantic/semanticProductSearch.ts`](../server/semantic/semanticProductSearch.ts); UI [`client/src/lib/productAiSearch.ts`](../client/src/lib/productAiSearch.ts) |
| Suchindex | Produkte, Angebote, Angebots-/Bestellentwürfe, Tickets und Ticket-Vorlagen je Mandant in `semantic_documents`. Der Index wird inkrementell aktualisiert (nur geänderte Dokumente oder ein neues Embedding-Verfahren). Er läuft automatisch etwa 2 Minuten nach dem Start und dann alle 6 Stunden (`SEMANTIC_INDEX_ENABLED`, `SEMANTIC_INDEX_INTERVAL_HOURS`); manuell unter Einstellungen → KI. | [`server/semantic/semanticIndexer.ts`](../server/semantic/semanticIndexer.ts); `POST /api/semantic/index` |
| Embeddings | OpenAI `text-embedding-3-small` **oder** lokal ohne API (`local-hash-v2`: Wörter per Hash auf 1.536 Fächer, jedes Wort einmal, lange Nummern wie EANs nicht im Vektor) | [`server/semantic/semanticEmbeddings.ts`](../server/semantic/semanticEmbeddings.ts) |
| Globale semantische Suche | Kandidaten aus Vektor- **und** Wortsuche, Reihenfolge aus Vektor, Wortanteil, Metadaten und Rückmeldungen (Gewichte unter Einstellungen → Semantisches Ranking). Bei lokalem Embedding zählt der Vektor ein Viertel; eine exakte Nummer steht vorn. | `POST /api/semantic/search` in [`server/routes/aiRoutes.ts`](../server/routes/aiRoutes.ts); [`server/semantic/semanticRanking.ts`](../server/semantic/semanticRanking.ts); UI [`client/src/pages/SemanticSearchPage.tsx`](../client/src/pages/SemanticSearchPage.tsx) und Suchfeld in der Kopfzeile |
| FAQ-Antwort | Standard: bester Treffer als Antwort, ohne KI-Aufruf. Auf Knopfdruck „KI-Antwort erzeugen“ erzeugt die KI eine quellengebundene JSON-Antwort. Bei `local_only` oder ohne Anbieter bleibt es beim besten Treffer. | [`server/semantic/semanticFaq.ts`](../server/semantic/semanticFaq.ts); `POST /api/semantic/faq` (`aiAnswer`) |

### Analytics & BI

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Natürliche Sprache (Statistik) | Freitextfrage → strukturierter Analytics-Query (JSON), Ausführung gegen die Bestelldaten. **Setzt einen Chat-Anbieter voraus.** Limits: 30 Fragen je Nutzer und Tag, 300 je Mandant und Tag, 5 je Minute (einstellbar). | `POST /api/analytics/nl-query` in [`server/routes/analyticsRoutes.ts`](../server/routes/analyticsRoutes.ts); Logik [`server/analytics/naturalLanguageAnalytics.ts`](../server/analytics/naturalLanguageAnalytics.ts), Limits [`server/analytics/nlQueryLimit.ts`](../server/analytics/nlQueryLimit.ts) |
| Automatische Insights | Deutsche Kurz-Insights aus Analyseergebnissen; **ohne Anbieter:** einfachere Basis-Insights | [`server/analytics/automaticInsights.ts`](../server/analytics/automaticInsights.ts) |
| Verbesserungsvorschläge | Aus Analytics/Forecast kontextbezogene Vorschläge; **ohne Anbieter:** leere Liste | [`server/analytics/improvementSuggestions.ts`](../server/analytics/improvementSuggestions.ts) |

### Dokumente, Angebote, Buchhaltung

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Bestell-Entwurf aus Upload | PDF/Bild/Text. Bei `openai_optional` zuerst **lokale Extraktion**, bei schlechter Qualität KI. Text über den Chat-Anbieter, Bilder über OpenAI-Vision; Fallback auf lokal. | [`server/extraction/orderDraftExtractor.ts`](../server/extraction/orderDraftExtractor.ts), [`server/extraction/documentExtractionChatLlm.ts`](../server/extraction/documentExtractionChatLlm.ts); `POST /api/order-drafts/upload` in [`server/routes/draftRoutes.ts`](../server/routes/draftRoutes.ts) |
| Angebots-Entwurf aus Upload | Analog zu Bestell-Entwürfen | [`server/extraction/offerDraftExtractor.ts`](../server/extraction/offerDraftExtractor.ts); `POST /api/offer-drafts/upload` |
| Smart Pricing | Mengen-/VIP-Logik + optional **KI-Rabatt** und **Begründungstext** (OpenAI) | [`server/products/smartPricingEngine.ts`](../server/products/smartPricingEngine.ts) |
| Buchhaltung | Aus Buchungstexten **Hinweise** (Bestellnr., Rechnungsnr., Betrag, Datum, OpenAI) | [`server/invoicing/accounting.ts`](../server/invoicing/accounting.ts) (`enrichEntriesWithAI`) |

### Cross-Selling

| Bereich | Kurzbeschreibung | Wo |
| --- | --- | --- |
| Vorschläge | Kandidaten aus manuellen Regeln und gelernten Regeln (Warenkorb-Analyse). Die besten Kandidaten werden optional per KI neu sortiert (`CROSS_SELL_LLM_RERANK_ENABLED`, `…_TOPK`, `…_TTL_HOURS`, mit Cache). | [`server/cross-selling/ruleEngine.ts`](../server/cross-selling/ruleEngine.ts), [`server/cross-selling/crossSellLlmRerank.ts`](../server/cross-selling/crossSellLlmRerank.ts) |
| Lernlauf | Statistische Warenkorb-Analyse (Support, Kaufwahrscheinlichkeit, Lift; **keine KI**). Liefert Regeln, Empfehlungen und die Statistik-Karten „Top kombinierte Artikel“ und „Upsell-Potenzial“. | [`server/cross-selling/crossSellLearning.ts`](../server/cross-selling/crossSellLearning.ts) |

---

### KI-Abgleich für Positionen ohne Katalogtreffer (seit 11.10.2026)

Händler schicken eigene Artikelnummern und Bezeichnungen. Ein Beispiel ist Roloff mit „921027516 Paletten-Grundregal 8xP 1000kg H3300xB1825xT1100mm 4E“ oder „Unterlegblech 1 mm“. Der Regelabgleich (EAN, Artikelnummer, Namensähnlichkeit) findet dafür nichts. Für solche Positionen gibt es nach der Kundenzuordnung zwei Schritte (`server/commercial/draftLineAiMatch.ts`):

1. **Gelernt pro Kunde:** Wurde diese Kunden-Artikelnummer bei diesem Kunden schon einmal bestätigt, ist das ein sicherer Treffer (100 %, „Für diesen Kunden gelernt“). Als Bestätigung zählt die Anlage in Shopware oder eine Korrektur im Prüffenster (`commercial_product_match_feedback.shopware_customer_id`, Migration 0050).
2. **KI-Vorschlag:**
   - METAorder wählt je Position etwa 25 Katalogartikel vor: Stichworte mit Synonymen (Unterlegblech → Unterlegplatte, GR/AR, zn → vzk), gleiche Maße (auch „H…xB…xT…“) und die bisherigen Vorschläge.
   - Die KI (Stufe `smart`, ein Aufruf je Entwurf) wählt daraus und begründet die Wahl. Sie nennt auch Verpackungseinheiten („10 Stück“).
   - Das Ergebnis ist immer nur ein **Vorschlag**: Status „unsicher“, höchstens 89 %. Die strenge Automatik legt damit nichts an.
   - Unter 60 % KI-Sicherheit erscheint die Wahl nur als Alternative.

Abschaltbar über `commercial_agent_settings.aiCatalogMatchEnabled` oder die Umgebungsvariable `COMMERCIAL_AGENT_AI_CATALOG_MATCH=false`. Im Testshop mit den vier Roloff-Positionen hat die KI alle richtig gewählt, in rund 5 s.

### Bestellung „laut Angebot …“ (seit 11.10.2026)

Verweist eine Bestellung auf ein META-Angebot (`references.supplier_offer_number` oder Text wie „Laut Angebot 1632“), sucht METAorder das Angebot über B2Bsellers (`server/commercial/draftOfferReference.ts`, vor dem KI-Abgleich).

- **Wann übernommen wird:** Gehört das Angebot zum zugeordneten Kunden und ist noch nicht alles sicher zugeordnet, werden die Angebotspositionen zu den Entwurfspositionen (Treffer 100 %, Strategie `offer`).
  - Konfigurationen werden in ihre Stückliste aufgelöst, optionale Positionen weggelassen.
  - Fehlt auch nur ein Teil im Katalog, wird nichts übernommen.
- **Preis:**
  - Normale Angebotspositionen behalten ihren Angebotspreis.
  - Bei Konfigurationen wird der Gesamtpreis im Verhältnis der Katalogpreise auf die Teile verteilt.
  - Der Preis steht als `manualUnitPriceNet` an der Position („geändert von Angebot 1632“), die Anlage in Shopware übernimmt ihn.
- **Im Prüffenster:** ein Hinweis mit Bestell- und Angebotswert und den Originalzeilen der Bestellung.
- **Nicht übernommen:** Bei einem fremden Kunden, einem nicht gefundenen Angebot oder einem fehlenden Teil bleibt die Bestellung unverändert; der Grund steht als Hinweis da.

### Stückliste im Positionstext auflösen (seit 11.10.2026)

Ein Händler bestellt eine konfigurierte Anlage als **eine** Position und schreibt die Stückliste in den Text (Steinke: „… Zubehör: 3x U-Rammschutz …; Stückliste: 3x Ständer …; 20x Holm …“). Konnte kein Angebot übernommen werden, greift `server/commercial/draftBomSplit.ts`:

1. **Erkennen:** Schlüsselwort (Stückliste, Zubehör, bestehend aus) plus mindestens 2 Mengenangaben, oder mindestens 4 Mengenangaben.
2. **Zerlegen:** Die KI (Stufe `smart`) zerlegt den Text in körperliche Teile mit Stückzahl. Gleiche Teile aus mehreren Abschnitten werden zusammengezählt; Kenngrößen wie Fachlast oder Gesamthöhe fallen weg. Die Teile werden eigene Positionen (Nummern „2.1“, „2.2“ …).
3. **Zuordnen:** Der KI-Abgleich ordnet die Teile Katalogartikeln zu. Dabei versteht er „Ständer“ als „Ständerrahmen“ und zerlegt Maße und Typen wie „4400x800“ oder „HN140/15“. Wird für Holme eine Holmebene gewählt, halbiert er die Menge.
4. **Preis:** Haben alle Teile einen Vorschlag mit Katalogpreis, wird der Gesamtpreis der Originalposition anteilig nach Katalogpreis verteilt („geändert von Bestellposition 2“).

Alles bleibt Vorschlag (status `uncertain`). Im Prüffenster steht ein Hinweis mit der Originalposition. Abschalten zusammen mit dem KI-Abgleich (`aiCatalogMatchEnabled`). Mit der Steinke-Stückliste im Testshop: 8 Teile, alle 8 richtig zugeordnet, Summe nach Verteilung 3.889,14 € statt 3.889,21 € (Rundung), etwa 20 s.

## Was das System **nicht kann** bzw. wo harte Grenzen sind

1. **Mehrere Anbieter nur für Chat:** Bilderkennung, Embeddings, Smart Pricing, Buchhaltungs-Hinweise und Teile der Commercial-Pipeline laufen nur über OpenAI. Ohne OpenAI-Key fallen sie weg bzw. nutzen lokale Verfahren (z. B. lokale Embeddings).
2. **Kein „Allgemeiner App-Chat“:** Es gibt keine durchgängige freie Konversations-KI für beliebige Themen. Alles ist **aufgaben- und Prompt-spezifisch** (Tickets, FAQ, Analytics, Extraktion, …).
3. **Natürliche Sprache ohne Anbieter:** Schlägt mit klarer Fehlermeldung fehl. Anders als bei Ticket-Klassifikation oder Embeddings gibt es hier **keinen** Offline-Ersatz (siehe [`server/analytics/naturalLanguageAnalytics.ts`](../server/analytics/naturalLanguageAnalytics.ts)).
4. **Bestimmte Endpunkte ohne Anbieter:** z. B. `POST /api/ai/suggest-categories` und `POST /api/ai/generate-replies` antworten mit „AI features are not enabled“. Die Oberfläche zeigt das übersetzt an.
5. **Lokale Embeddings sind keine Bedeutungssuche:** Ohne OpenAI zählt der „Vektor“ nur gemeinsame Wörter (Hash). Synonyme („Schwerlastregal“ ↔ „Palettenregal“) findet die Suche dann nicht. Die Wortsuche und das Ranking gleichen das für Produktnamen und Nummern aus.
6. **„Mit KI auslegen“ ist eine Auslegung, keine eigene Trefferliste:** Die KI setzt Suchwort und Abmessungen. Was dazu nicht passt (z. B. Traglast, Farbe), filtert die Produktseite nicht.
7. **FAQ-Antwort „ohne Halluzination“ nur im Sinne des Prompts:** Das Modell soll nur Quellen nutzen. **Technisch** ist es weiterhin ein Sprachmodell, ohne Garantie wie bei einem formal verifizierten System.
8. **Automatisierung E-Mail:** Die Regel-Aktion „E-Mail senden“ nutzt den konfigurierten Ausgangs-Versand (Einstellungen → E-Mail ausgehend). Ist er ausgeschaltet, schlägt die Aktion fehl und steht so in der Ausführungshistorie; das ist keine KI-Grenze.

---

## Kurzfassung für Stakeholder

- **Kern:**
  - Chat-KI je Mandant wählbar: OpenAI, Claude oder Gemini, jeweils in zwei Stufen „schnell“ und „gründlich“.
  - OpenAI zusätzlich für Bilder, Embeddings, Smart Pricing und Buchhaltung.
  - Lokale Verfahren ohne API: Heuristiken, Hash-Embeddings, lokale Textextraktion.
- **Stärken:** Tickets (Vorschläge, Klassifikation), Suche und FAQ, KI-Auslegung der Produktsuche, Natürliche Sprache und Insights in der Statistik, Beleg-Extraktion, Buchhaltungs-Hinweise, Smart Pricing, Neusortierung beim Cross-Selling.
- **Kostenkontrolle:** KI-Aufrufe in Suche und FAQ nur auf Knopfdruck; Limits je Nutzer, Minute und Tag.
- **Grenzen:** Mehrere Anbieter nur für Chat; kein universeller Chat; Natürliche Sprache und einige `/api/ai/*`-Routen **hart** abhängig von einem Anbieter; lokale Embeddings ohne Bedeutungsverständnis.
