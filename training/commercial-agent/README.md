# Commercial Agent – Trainings-/Referenz-E-Mails

Dieser Ordner dokumentiert, wie **reale Angebots- und Bestell-Anfragen** (`.eml`) in die Few-Shot-Lernschicht der App einfließen.

## Wo landen die Daten?

Die Klassifikation „Angebot vs. Bestellung“ nutzt `classifyCommercialDocumentIntent` mit optionalen Einträgen in **`commercial_agent_exemplars`** (Migration `0007_commercial_agent_learning.sql`). Pro Mandant werden beim Intent-Prompt die neuesten/hochwertigsten Exemplare angehängt (`formatExemplarsForIntentPrompt`).

## Eigene Mails importieren

1. **Pfade** zu Ordnern oder einzelnen `.eml` vorbereiten (z. B. OneDrive-Ordner `Angebotsanfragen` / `Bestellanfragen`).
2. **Mandanten-UUID** aus der App kopieren.
3. Aus dem Projektordner **`METAorder-v2`**:

```bash
export DATABASE_URL="postgresql://…"
npm run commercial-agent:import-eml -- --tenant=IHRE_MANDANTEN_UUID \
  "/Pfad/…/Angebotsanfragen" \
  "/Pfad/…/Bestellanfragen"
```

- Ordnernamen **`Angebotsanfragen`** → Intent `quote_request` (Entwurf `offer`).
- Ordnernamen **`Bestellanfragen`** → Intent `purchase_order` (Entwurf `order`).
- Sonst: `--intent=quote_request` oder `--intent=purchase_order` pro Lauf setzen.

### Trockenlauf / Export ohne Datenbank

```bash
npm run commercial-agent:import-eml -- --dry-run --tenant=dummy \
  "/Pfad/Angebotsanfragen/Mail-Anhang.eml"

npm run commercial-agent:import-eml -- --export-jsonl=training/commercial-agent/exports/review.jsonl \
  "/Pfad/Angebotsanfragen"
```

## Voraussetzungen in der App

- Unter **Einstellungen → Commercial Agent** muss **Dokumenten-Lernen** aktiv sein, sonst werden Exemplare beim Intent nicht geladen (`documentLearningEnabled`).
- Es gelten die üblichen Limits (z. B. max. ca. 250 Exemplare pro Mandant; ältere können automatisch entfallen).

## Datenschutz

Nur importieren, was **rechtlich** und intern abgestimmt ist. Für Repos ohne Rohmails genügt der **JSONL-Export** zur manuellen Prüfung; sensible Signaturen vorher kürzen.
