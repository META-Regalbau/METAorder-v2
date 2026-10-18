# META Warenkorb-Signal (Shopware-Plugin) – Übergabe an wirduzen

Version 1.0.0 · Shopware 6.6 / 6.7 · PHP ≥ 8.2 · keine eigenen Tabellen, kein Storefront- oder Admin-Build

## Wozu

METAorder (Shop-Puls, „B2B-Warenkorb-Alarm“) soll den zuständigen Außendienst informieren, wenn ein
angemeldeter Geschäftskunde einen großen Warenkorb anlegt und nicht bestellt. Shopware gibt Warenkörbe
über die Admin-API nicht heraus. Darum meldet dieses Plugin gespeicherte Warenkörbe an METAorder.

Das Plugin liest nur und schickt eine Meldung. Es ändert nichts im Shop, schreibt keine Kunden an und
blockiert den Kauf nie.

## Installation

```bash
# ZIP MetaCartSignal-1.0.0.zip nach custom/plugins/ entpacken (Ordner MetaCartSignal), dann:
bin/console plugin:refresh
bin/console plugin:install --activate MetaCartSignal
bin/console cache:clear
```

Danach in der Plugin-Konfiguration zuerst die Werte eintragen und **„Aktiv“ erst einschalten, wenn METAorder
Bescheid gibt** (Freigabe durch den Datenschutzbeauftragten von META).

## Konfiguration (Einstellungen → Erweiterungen → META Warenkorb-Signal)

| Feld | Wert |
|---|---|
| Aktiv | Standard aus. Einschalten erst nach Freigabe durch META. |
| METAorder-Adresse | bekommt ihr von META (Live: `https://p-bbpye5.project.space`), ohne `/` am Ende, nur https |
| METAorder-Mandanten-ID | steht in METAorder unter Shop-Puls → Warenkorb-Alarm |
| Geheimer Schlüssel | erzeugt META in METAorder (Shop-Puls → Warenkorb-Alarm) und übergibt ihn auf sicherem Weg |
| Nur Warenkörbe ab (netto, €) | Standard 500. Kleinere Warenkörbe werden gar nicht gesendet. |
| Versand | **Message Queue** (Standard, empfohlen; braucht den laufenden Worker `messenger:consume async`, wie für Mails und Indexierung) oder **Nach dem Ausliefern der Seite** (`kernel.terminate`; nur unter PHP-FPM ohne Wartezeit für den Kunden, sonst wartet die Anfrage bis zum Timeout) |
| Timeout (Sekunden) | Standard 3 (0,5–10). Kein Wiederholen. |
| Zusatzfeld B2B-Kennzeichen | Standard `wdu_b2b_dealer` |

Fehlt Adresse, Mandanten-ID oder Schlüssel, ist „Aktiv“ aus oder ist die Adresse nicht https, sendet das
Plugin nichts.

## Wann gesendet wird

- **Warenkorb gespeichert** (`CartSavedEvent`): nur angemeldete Kunden (keine Gäste), nur Geschäftskunden
  (Firma am Kunden oder in der Rechnungsadresse, oder Zusatzfeld B2B-Kennzeichen wahr), nur ab dem
  Mindestwert netto.
- **Bestellung abgeschlossen** (`CheckoutOrderPlacedEvent`): derselbe Personenkreis. METAorder legt dann für
  diesen Kunden keinen Alarm mehr an.

Gesendet wird nie im Kaufablauf selbst: über die Message Queue oder nach dem Ausliefern der Antwort, mit
kurzem Timeout. Jeder Fehler wird nur ins Shopware-Log geschrieben („META Warenkorb-Signal: …“). Speichert Shopware
denselben Warenkorb in einer Anfrage mehrfach, geht er nur einmal raus.

Getestet in einer frischen Shopware 6.7.2.2 (dockware): Installation, Konfiguration per
`system:config:set`, Geschäftskunde registriert, Warenkorb und Bestellung über die Store-API. Mit nicht
erreichbarem METAorder dauerte der ganze Ablauf im Queue-Modus 0,7 s (Kauf unbeeinträchtigt, Fehler nur im
Log); im Modus `kernel.terminate` unter Apache ohne PHP-FPM wartete jede Anfrage den Timeout ab.

## Was gesendet wird

`POST <METAorder-Adresse>/api/public/shop-pulse/cart-signal`, JSON, Header:

- `X-Meta-Tenant`: Mandanten-ID
- `X-Meta-Timestamp`: Unix-Zeit in Sekunden (METAorder lehnt mehr als 5 Minuten Abweichung ab)
- `X-Meta-Signature`: `sha256=` + HMAC-SHA256 über `<Zeitstempel>.<Body>` mit dem geheimen Schlüssel

Inhalt (nur Kennzahlen und Ansprechpartner; keine Adressen, keine Zahlungsdaten, kein Warenkorb-Token):

```json
{
  "version": 1,
  "event": "cart.saved",
  "occurredAt": "2026-10-18T10:00:00+02:00",
  "salesChannelId": "…",
  "customer": { "id": "…", "customerNumber": "20001", "company": "Muster GmbH",
                "contactName": "Erika Muster", "email": "erika@example.org", "phone": null },
  "cart": { "netTotal": 1250.5, "currency": "EUR", "positionCount": 1,
            "positions": [ { "productNumber": "SW10001", "label": "Fachbodenregal", "quantity": 5, "netTotal": 1250.5 } ] }
}
```

Bei `order.placed` steht statt `cart` nur `"order": { "orderNumber": "MO…" }`. Höchstens 50 Positionen je
Meldung. METAorder antwortet `202`; `401` heißt Schlüssel, Mandant oder Uhrzeit passen nicht.

## Prüfen

1. In METAorder unter Shop-Puls → Warenkorb-Alarm steht nach dem ersten Warenkorb „Letzte Meldung: …“
   (auch solange der Alarm in METAorder noch aus ist; gespeichert wird dann nichts).
2. Im Shopware-Log gibt es keine Einträge „META Warenkorb-Signal: nicht gesendet“.

## Entwicklung

Unit-Tests ohne Shopware (Signatur, Inhalt, Versand mit simuliertem HTTP-Client):

```bash
composer require --dev phpunit/phpunit:^10.5 symfony/http-client psr/log   # oder META_TEST_AUTOLOAD=<autoload.php>
vendor/bin/phpunit
```

Die Signatur-Vorlage `tests/Fixtures/signature.json` prüft auch METAorder (`tests/unit/shopPulseCartAlarm.test.ts`).
ZIP bauen: `./build-zip.sh` (legt `MetaCartSignal-<Version>.zip` in `shopware/dist/` ab).
