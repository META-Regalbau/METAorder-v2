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

   **E-Mail-Container (`.eml` / `.msg`)** werden ausgepackt statt als ein Dokument behandelt —
   siehe [`server/commercialEmailUploadIngest.ts`](../server/commercialEmailUploadIngest.ts):

   - **ein Entwurf je handelsrelevantem Anhang** (wie beim internen Postfach-Abruf);
     ohne solchen Anhang wird die Nachricht selbst ausgewertet
   - dadurch greifen **PDF-Vision** bei gescannten Bestellungen, die
     **Signaturbild-Erkennung** für den Firmennamen und getrennte `siblingPdfExcerpts`
   - Signatur-/Logobilder erzeugen **keinen** eigenen Entwurf
   - **Dedupe über die `Message-ID`** der Mail: ein n8n-Retry derselben Nachricht legt
     keinen zweiten Entwurf an (Antwort dann `draftCount: 0`, `deduplicated: true` mit **HTTP 200**,
     damit der Workflow die Mail trotzdem als gelesen markieren kann)
   - zusätzliche Antwortfelder: `source: "email_container"`, `drafts[]`, `draftCount`,
     `attachmentsProcessed`, `usedEmailOnlyFallback`. Die Felder `draft`/`draftKind`/Intent
     beschreiben weiterhin den **ersten** Entwurf (rückwärtskompatibel).
   - Voraussetzung: Commercial Agent aktiv **und** der aufrufende Benutzer hat
     `manageOrderDrafts` **und** `manageOffers` (der Seed-Benutzer `n8n-service` hat beides).
     Fehlt eines, greift das bisherige Einzeldokument-Verhalten inklusive
     Downgrade Bestellung → Angebot.

2. Optional: Entwurf in der UI oder per **`PATCH`** auf die jeweiligen Draft-Routen anpassen (wie in der allgemeinen API-Doku). Auch diese `PATCH`-Routen akzeptieren **`requireAuthOrIntegrationKey`** (JWT oder Integrations-Key).

3. Finalisierung in Shopware:  
   - Angebot: **`POST /api/offer-drafts/:id/create-offer`** (Body optional `sales_channel_id`).  
   - Bestellung: **`POST /api/order-drafts/:id/create-order`**.  
   - Beide Endpunkte: **`requireAuthOrIntegrationKey`** (JWT oder Integrations-Key).
   - **Wichtig:** Ein frischer Entwurf steht auf Status `pending` — beide Endpunkte lehnen das mit `400 "Please approve it first"` ab. Erst per `PATCH .../:id` mit `{"status": "approved"}` freigeben (die Review-Modal-UI macht das beim Klick auf "Angebot/Bestellung erstellen" automatisch mit), dann `create-offer`/`create-order` aufrufen. Siehe [`n8n-commercial-workflow.example.json`](n8n-commercial-workflow.example.json) für den vollständigen Ablauf.

**Hinweise**

- **`uploadRateLimiter`:** bei Massenlast Retries/Backoff in n8n einplanen.  
- **OpenAI / KI:** Upload-Pipeline braucht konfigurierte KI- und Shopware-Einstellungen wie in der App.

## Interne Weiterleitungen zählen nicht

Erreicht eine Kundenbestellung das Bestellpostfach über Kollegen („WG: …", „Moin, anbei eine
Bestellung"), wertet der Commercial Agent ausschließlich die **ursprüngliche Kundenmail** aus
([`emailForwardUnwrap.ts`](../server/emailForwardUnwrap.ts)): Ist der Kopf-Absender eine eigene
Domain, wird die Weiterleitungskette (Outlook-Blöcke „Von/Gesendet/An/Betreff" bzw.
„From/Sent/To/Subject") bis zum ersten externen Absender abgelaufen. Dessen Absender, Betreff
(ohne „WG:"/„FW:"/„[External]") und Text gehen in Intent, Extraktion und Kundenzuordnung —
Weiterleitungs-Notizen und interne Adressen nicht. Leitet ein **Kunde** selbst etwas weiter,
bleibt die Mail unverändert. Eigene Domains: META-Defaults plus `COMMERCIAL_AGENT_OWN_DOMAINS`
bzw. `COMMERCIAL_AGENT_INBOUND_ACK_OWN_DOMAINS` (kommagetrennt). Adressen dieser Domains werden
zudem nie als Kunden-E-Mail gewählt.

## Beilagen: Lieferschein, AB, Rechnung → Entwurf, nicht zweite Bestellung

Kunden schicken neben der Bestellung oft weitere Belege mit — typisch den **eigenen
Lieferschein**, der der Sendung beizulegen ist. Jeder Anhang wird deshalb vor der
Extraktion klassifiziert ([`commercialAttachmentClassifier.ts`](../server/commercialAttachmentClassifier.ts)):

| Belegart | Verhalten |
|----------|-----------|
| `purchase_order`, `unknown` | Extraktion → Bestell-/Angebotsentwurf (wie bisher) |
| `delivery_note`, `order_confirmation`, `invoice`, `other` | **kein** Entwurf; Datei wird unter `uploads/commercial-agent-incoming/` abgelegt und an alle Entwürfe derselben Mail gehängt (`attachments`) |

Die Erkennung ist deterministisch (Titelbegriffe wie „Lieferschein", „LS-Nr.", „Packstücke",
„Rechnungs-Nr.", „Auftragsbestätigung"; Dateiname als Zusatzsignal). Ohne verwertbaren Text
(Scan ohne OCR) bleibt der Anhang Bestell-Kandidat. Im Review-Modal erscheint der Block
„Beigefügte Dokumente" mit Belegart, Kennnummern (LS-Nr., Bestell-Nr., Kommission) und
Archiv-Status.

### Übergabe an das DMS (Lobster → d.3)

```
GET   /api/order-drafts/:id/attachments                    Liste (ohne Dateipfad)
GET   /api/order-drafts/:id/attachments/:attachmentId/file Datei (inline, Original-MIME)
PATCH /api/order-drafts/:id/attachments/:attachmentId      { "exportStatus": "exported", "exportReference": "d3:…" }
```

Dieselben Endpunkte gibt es unter `/api/offer-drafts/…`. Auth: Session oder Integrations-API-Key
(`X-METAORDER-Integration-Key`), Recht `manageOrderDrafts` bzw. `manageOffers`. Ein Anhang trägt
`exportStatus` `pending` → Lobster holt die Datei, schreibt sie mit `buyerDocumentNumber`
(Kundenbestellnummer) und `references` als Index ins d.3 und setzt `exported`. Die Liste enthält
außerdem `shopwareOrderId`, sobald die Bestellung angelegt wurde.

Beispiel-Antwort der Liste:

```json
{
  "draftId": "…", "draftKind": "order", "buyerDocumentNumber": "381345/000", "shopwareOrderId": null,
  "attachments": [{
    "id": "…", "documentKind": "delivery_note", "documentKindLabel": "Lieferschein",
    "fileName": "381345_000.pdf", "mimeType": "application/pdf", "size": 53677,
    "references": { "deliveryNoteNumber": "1433099", "orderNumber": "8054002 /1174415", "commission": null },
    "classification": { "confidence": 0.9, "signals": ["title_lieferschein", "ls_number_label"] },
    "exportStatus": "pending", "createdAt": "2026-09-16T08:00:00.000Z"
  }]
}
```

### Push-Variante: SFTP-Upload an Lobster (Einstellungen → Integration → SFTP-Server)

Alternativ oder zusätzlich zum Abholen per REST schiebt METAorder die Beilagen selbst per SFTP
zu Lobster. Je Mandant können beliebig viele Server hinterlegt werden (Passwort oder SSH-Key,
optional Host-Key-Fingerprint; Zugangsdaten liegen AES-GCM-verschlüsselt in `sftp_servers`).

Ablauf: Sobald aus einem Bestellentwurf eine Shopware-Bestellung entsteht (manuell im Review-Modal
oder automatisch durch den Commercial Agent), werden alle Beilagen mit passender Belegart
(Standard: nur `delivery_note`) an jeden aktiven Server mit „Automatisch bei Bestellanlage"
hochgeladen — asynchron, die Bestellanlage wartet nicht darauf. Erfolgreiche Beilagen erhalten
`exportStatus = exported` und `exportReference = sftp:<Server>:<Pfad>`. Im Review-Modal gibt es
zusätzlich „Per SFTP übergeben" (erneuter Upload, auch bereits exportierter Beilagen).

Je Datei landet im Zielordner:

```
<Dateiname>            z. B. 10042_delivery_note_381345_000.pdf   (Schema konfigurierbar)
<Dateiname>.json       Sidecar mit Zuordnungsdaten (abschaltbar)
```

Uploads erfolgen als `<Dateiname>.part` und werden erst nach vollständiger Übertragung umbenannt —
Lobster sieht nie halbe Dateien; die JSON-Datei wird nach der PDF geschrieben, ein Lobster-Profil
kann also auf `*.json` triggern. Platzhalter für das Dateinamen-Schema: `{orderNumber}`,
`{customerNumber}`, `{buyerDocumentNumber}`, `{deliveryNoteNumber}`, `{invoiceNumber}`,
`{commission}`, `{customerReference}`, `{documentKind}`, `{date}`, `{originalName}`, `{draftId}`,
`{attachmentId}`.

Beispiel-Sidecar:

```json
{
  "type": "metaorder.draft_attachment", "version": 1, "uploadedAt": "2026-09-22T08:00:00.000Z",
  "draft": { "id": "…", "kind": "order", "status": "created", "buyerDocumentNumber": "381345/000" },
  "order": { "shopwareOrderId": "…", "orderNumber": "10042", "customerNumber": "K10001", "customerName": "Müller GmbH" },
  "document": {
    "attachmentId": "…", "kind": "delivery_note", "kindLabel": "Lieferschein",
    "fileName": "10042_delivery_note_381345_000.pdf", "originalFileName": "381345_000.pdf",
    "references": { "deliveryNoteNumber": "1433099", "orderNumber": "8054002 /1174415", "commission": null }
  },
  "documentReferences": { "customerReference": "…", "commission": "…", "supplierOfferNumber": "…" }
}
```

Wiederholungen bei Verbindungs-/Übertragungsfehlern mit exponentiellem Backoff (je Server
konfigurierbar, Standard 3 Versuche). Jeder Versuch steht im Upload-Protokoll (`sftp_upload_logs`,
sichtbar unter dem Server-Abschnitt in den Einstellungen; API: `GET /api/settings/sftp-servers/logs`).

```
GET    /api/settings/sftp-servers              POST /api/settings/sftp-servers
PATCH  /api/settings/sftp-servers/:id          DELETE /api/settings/sftp-servers/:id
POST   /api/settings/sftp-servers/:id/test     POST /api/settings/sftp-servers/test   (Verbindungstest)
POST   /api/order-drafts/:id/attachments/sftp-upload   { serverIds?, attachmentIds?, force? }
```

### Referenzen & Lieferhinweise

Die Extraktion liefert zusätzlich `documentExtraction.references` (Kundenreferenz / „Nummer beim
Kunden", Kommission, Ansprechpartner am Lieferort, Lieferschein-Hinweise, AB- und
Rechnungsadresse) — im Entwurf als `extractedData.documentReferences`. Bei der Bestellanlage
landen sie mit festen Labels im Kundenkommentar der Shopware-Bestellung
(`Kundenreferenz: …`, `Kommission: …`, `Lieferkontakt: …`, `Lieferschein/Anlieferung: …`).

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
