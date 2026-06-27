# n8n und Commercial Automation (Angebote / Bestellungen)

Diese Seite beschreibt, wie METAorder mit **n8n** oder anderen Automatisierungen gekoppelt wird: Authentifizierung, zentrale API-Schritte, **ausgehende Webhooks** und der Umgang mit **internem Auto-Create** vs. n8n.

## Authentifizierung

### Variante A: JWT (technischer Benutzer)

1. Benutzer mit Rechten **`manageOffers`** und/oder **`manageOrderDrafts`** (und für den einheitlichen Upload mindestens eines von beiden, siehe `requireManageCommercialDraftUpload`).
2. `POST /api/auth/login` mit `username` / `password` → Antwort enthält ein **JWT**.
3. Folge-Requests: `Authorization: Bearer <JWT>`.
4. **Tenant:** Es gilt die `activeTenantId` des Benutzers. Der Integrations-Account sollte genau einem Tenant zugeordnet sein oder eine fest gesetzte aktive Tenant-Auswahl haben (wie bei normalem UI-Login).

### Variante B: Integrations-API-Key (ohne Token-Rotation)

Wenn `METAORDER_INTEGRATION_API_KEY` gesetzt ist:

- Header: **`X-METAORDER-Integration-Key: <gleicher Wert>`**
- Identität: Standardbenutzer **`n8n-service`** (Seed mit `N8N_SERVICE_PASSWORD`), oder ein expliziter User über **`METAORDER_INTEGRATION_USER_ID`** (UUID).

Details und Docker: [`docker.md`](docker.md).

## Happy Path API (n8n als Orchestrator)

1. **`POST /api/commercial-drafts/upload`**  
   - **Multipart** Feldname **`file`** (PDF/DOCX/.eml o. ä.), optional `subject`, `body` (Text), **`intentHint`** (`offer` | `order` | `unclear`, Vorschlag von n8n).  
   - Auth: JWT **oder** Integrations-Key (siehe oben).  
   - Antwort u. a.: **`draft`**, **`draftKind`**: `"offer"` | `"order"`, Intent-Metadaten, optional **`strictAutoCreate`** (Ergebnis der Strikt-Regel).

2. Optional: Entwurf in der UI oder per **`PATCH`** auf die jeweiligen Draft-Routen anpassen (wie in der allgemeinen API-Doku).

3. Finalisierung in Shopware:  
   - Angebot: **`POST /api/offer-drafts/:id/create-offer`** (Body optional `sales_channel_id`).  
   - Bestellung: **`POST /api/order-drafts/:id/create-order`**.  
   - Beide Endpunkte: **`requireAuthOrIntegrationKey`** (JWT oder Integrations-Key).

**Hinweise**

- **`uploadRateLimiter`:** bei Massenlast Retries/Backoff in n8n einplanen.  
- **OpenAI / KI:** Upload-Pipeline braucht konfigurierte KI- und Shopware-Einstellungen wie in der App.

## Ausgehende Webhooks (METAorder → n8n)

Unter **Einstellungen → Webhooks** (oder `GET/PATCH /api/settings/webhooks`) können URLs pro Eventtyp gesetzt werden.

Neue **Commercial-Events:**

| Eventtyp | Bedeutung |
|----------|-----------|
| `commercial.draft_created` | Entwurf angelegt (E-Mail-Inbound oder manueller/API-Upload). |
| `commercial.draft_review_required` | Zusätzlich, wenn der Entwurf Status `review_required` hat. |
| `commercial.auto_offer_created` | Nach erfolgreichem **internen** Auto-Create eines Angebots. |
| `commercial.auto_order_created` | Nach erfolgreichem **internen** Auto-Create einer Bestellung. |

Typischer Payload (Auszug) für Draft-Events: `draftId`, `draftKind`, `draftStatus`, `intent`, `intentConfidence`, `overallConfidence`, `shopwareCustomerId`, `messageId`, `source` (`email_inbound` | `manual_upload`), `createdAt`.  
Auto-Events enthalten u. a. `draftId`, `offerId` bzw. `orderId`, `messageId`, `createdAt`.

Tests: `POST /api/webhooks/test` mit `eventType`. Zustellprotokoll: `/api/webhooks/logs`.

## Internes Auto-Create vs. n8n

Der Commercial Agent kann nach der Pipeline **ohne UI** direkt Shopware-Angebote/-Bestellungen anlegen (`server/aiConfig.ts`, `COMMERCIAL_AGENT_*`, UI „Commercial Agent“).

### Strikt-Regel (Default, „100 %-Pfad“)

Mit **`strictAutoCreateOnly: true`** (Default, Env `COMMERCIAL_AGENT_STRICT_AUTO_CREATE`) gilt nur noch die Strikt-Regel in `server/commercialStrictAutoCreate.ts` — nicht die älteren weichen Schwellen (Intent 0,85 / Match 90).

Auto-Create nur wenn u. a.: alle Pflicht-Adressfelder, Kunde per Match (≥ 95, nicht Auto-Create), jede Position mit Katalog-**confidence = 100**, Intent ≥ 0,95. Sonst `review_required` + `strictAutoCreateTrace.reasons[]`.

Details und Gmail-Setup: [`gmail-to-shopware-automation.md`](gmail-to-shopware-automation.md).

### Betriebsmodi

- **Nur METAorder (empfohlen mit Gmail-Workflow):** Upload via n8n; Strikt-Regel entscheidet; Webhooks für Benachrichtigung.  
- **Nur n8n für Finalisierung:** `COMMERCIAL_AGENT_STRICT_AUTO_CREATE=false` und weiche Schwellen deaktivieren; n8n ruft `create-offer` / `create-order` manuell auf.

## Beispiel-Workflows

| Datei | Zweck |
|-------|--------|
| [`n8n-workflows/gmail-to-metaorder.json`](../n8n-workflows/gmail-to-metaorder.json) | Gmail Trigger + Quick-Classifier + Upload + Mark Read |
| [`n8n-commercial-workflow.example.json`](n8n-commercial-workflow.example.json) | Manueller Start, Upload, optional create-offer/order |
| [`n8n-workflows/metaorder-auto-create-webhook.json`](../n8n-workflows/metaorder-auto-create-webhook.json) | Webhook-Empfang für Auto-Create-Events |
