# Rückmelde-API für Kunden-ERP (Auftragsbestätigung)

Kunden, die aus ihrem eigenen ERP bestellen, fragen hierüber den Status ihrer Bestellung ab —
fachlich eine **EDI-ORDRSP**: positionsweise „bestätigt / Menge geändert / Klärung nötig".

Der Kunde fragt mit **seiner** Belegnummer und bekommt **seine** Positions- und
Artikelnummern zurück. Er muss keine META-IDs speichern.

## Endpunkt

```
GET /api/public/commercial/orders/{buyer_document_number}
Authorization: Bearer moc_…
```

Alternativ zum Bearer-Header: `X-METAORDER-Customer-Token`.
Query-Parameter werden bewusst **nicht** unterstützt (Server-, Proxy- und Browser-Logs).

### Antwort

```jsonc
{
  "buyer_document_number": "PO-4711",
  "count": 1,
  "documents": [
    {
      "buyer_document_number": "PO-4711",
      "document_type": "purchase_order",   // oder quote_request
      "received_at": "2026-08-14T09:12:00.000Z",
      "updated_at":  "2026-08-14T09:14:22.000Z",
      "status": "confirmed",               // in_review | confirmed | rejected
      "supplier_order_number": "SW-10023", // erst bei confirmed
      "currency": "EUR",
      "total_confirmed_net": 258,
      "line_items": [
        {
          "position": 10,
          "buyer_sku": "KD-88231",          // Artikelnummer des Kunden
          "supplier_sku": "4026212260212",  // unsere
          "description": "Holm 1000 mm",
          "quantity_ordered": 12,
          "quantity_confirmed": 6,
          "unit": "Stk",
          "unit_price_ordered_net": 21.5,
          "unit_price_confirmed_net": 43,
          "line_total_confirmed_net": 258,
          "status": "quantity_changed",
          "note": "1 Holmebene = 2 Holme"
        }
      ]
    }
  ]
}
```

`documents` ist eine Liste, weil zu einer Belegnummer mehrere Vorgänge gehören können
(Mail mit mehreren Anhängen, Nachsendung). Neuester zuerst.

### Statuscodes

| Code | Bedeutung |
|------|-----------|
| 200 | Vorgang gefunden |
| 400 | Belegnummer fehlt oder ist zu lang |
| 401 | Token fehlt, unbekannt, widerrufen oder abgelaufen |
| 404 | Zu dieser Belegnummer liegt kein Vorgang des Kunden vor |
| 429 | Mehr als 60 Anfragen pro Minute |

401 nennt bewusst nicht den Grund — sonst ließe sich prüfen, ob ein Token existiert.

## Statusabbildung

Interne Entwurfsstatus werden **nicht** durchgereicht ([`commercialOrderAcknowledgement.ts`](../server/commercialOrderAcknowledgement.ts)):

| intern | extern | warum |
|--------|--------|-------|
| `pending`, `review_required`, `approved` | `in_review` | `approved` heißt intern nur „Extraktion sauber", nicht „wir liefern" |
| `created` **+** Shopware-Beleg | `confirmed` | verbindlich ist ausschließlich die angelegte Bestellung |
| `rejected` | `rejected` | |

Positionsstatus:

| Wert | Bedeutung |
|------|-----------|
| `confirmed` | zugeordnet, Menge unverändert |
| `quantity_changed` | zugeordnet, Menge weicht ab — `note` erklärt warum |
| `clarification_required` | nicht zugeordnet; `quantity_confirmed` ist dann `null` |

**`quantity_changed` ist der praktisch wichtigste Fall.** Der Matcher rechnet z. B. Holme in
Holmebenen um (2 Holme = 1 Holmebene). Ohne Rückmeldung merkt der Kunde das erst beim
Wareneingang, und Bestellung und Lieferung passen nicht zusammen.

## Preise

- `unit_price_ordered_net` — was der Kunde in **seinem** Beleg genannt hat. Gespiegelt,
  damit er prüfen kann, ob wir richtig gelesen haben.
- `unit_price_confirmed_net` / `line_total_confirmed_net` / `total_confirmed_net` — aus der
  **Shopware-Bestellung**, also mit den Konditionen des Kunden gerechnet.

Solange der Vorgang `in_review` ist, sind alle `*_confirmed_*`-Felder `null`. Es wird
bewusst kein Preis als bestätigt ausgewiesen, der noch nicht verbindlich ist.

## Token verwalten

Ein Token gilt für **genau einen** Kunden (`shopwareCustomerId`) und wird nur als
SHA-256-Hash gespeichert. Der Klartext erscheint einmalig in der Antwort auf `POST`.

```bash
# Ausstellen
curl -X POST https://<host>/api/settings/commercial-customer-tokens \
  -H 'Content-Type: application/json' \
  -d '{"shopwareCustomerId":"<id>","name":"ERP Mustermann Logistik"}'

# Auflisten (ohne Klartext)
curl https://<host>/api/settings/commercial-customer-tokens

# Widerrufen
curl -X DELETE https://<host>/api/settings/commercial-customer-tokens/<id>
```

Alle drei erfordern Anmeldung und `manageSettings`.

> **Nicht** die mandantenweiten Integration-Keys an Kunden geben — die sehen alle Vorgänge
> aller Kunden. Die Token hier sind genau dafür getrennt gebaut.

## Woher die Belegnummer kommt

Aus der Extraktion (`documentExtraction.document.number`) und beim Anlegen des Entwurfs
denormalisiert in die Spalte `buyer_document_number` (Migration
[`0038_commercial_order_acknowledgement.sql`](../migrations/0038_commercial_order_acknowledgement.sql),
inklusive Nachzug für Bestandsdaten). Ein JSONB-Pfad wäre nicht indizierbar.

Findet die Extraktion keine Belegnummer, ist der Vorgang über diesen Endpunkt nicht
auffindbar — er erscheint dann nur intern in der Entwurfsliste.

## Eingangsbestätigung per E-Mail

Ergänzend zur API: Sobald eine Bestellung oder Anfrage per Mail eingeht, kann METAorder dem
Absender automatisch eine Eingangsbestätigung schicken — mit den erkannten Positionen, damit
Erfassungsfehler dem Kunden sofort auffallen statt erst beim Wareneingang.

Einschalten unter **Einstellungen → KI → Commercial Agent → „Eingangsbestätigung an Kunden
senden"** (Standard **aus**) oder per `COMMERCIAL_AGENT_INBOUND_ACK=true`.

Sperren, die immer greifen ([`commercialInboundAcknowledgementMail.ts`](../server/commercialInboundAcknowledgementMail.ts)):

- nur im **E-Mail-Eingang**, nicht bei manuellen Uploads durch Mitarbeiter
- **einmal je Vorgang** (Marker `inboundAcknowledgementSentAt` im Entwurf, gesetzt erst nach
  erfolgreichem Versand — ein fehlgeschlagener Versand darf erneut versucht werden)
- nie an `noreply`, `mailer-daemon`, `postmaster` u. Ä. (Mailschleifen)
- nie an eigene Domains (`COMMERCIAL_AGENT_INBOUND_ACK_OWN_DOMAINS`, kommagetrennt) oder an
  META-eigene Absenderfirmen
- **keine Preise** im Text: Zum Eingangszeitpunkt gibt es keinen verbindlichen Preis
- **keine Zusage**: Der Text stellt ausdrücklich klar, dass dies noch keine
  Auftragsbestätigung ist

Sprache folgt `document.language` (deutsch/englisch).

## Tests

```bash
npm run test:order-acknowledgement   # Aufbau der Bestätigung
npm run test:customer-api-token      # Token und Rate-Limit
npm run test:inbound-ack             # Sperren und Text der Eingangsbestätigung
```
