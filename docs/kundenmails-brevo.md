# Kundenmails über Brevo (B1 Fundament)

Konzept: `Kundenmails-Brevo-Konzept-2026-10-19.html` (Entscheidungen 20.10.2026). Seite: **/admin/kundenmails** (nur Administratoren).

## Aufgabenteilung

- **METAorder** entscheidet, wer welche Mail bekommt: Rechtsgrundlage je Kontakt, Widerspruch, Bounce, Verkaufskanal, Kontaktbremse.
- **Brevo** verschickt jede Aussendung als **Kampagne** an eine eigene Liste im Ordner „METAorder“. Abmeldelink und Sperrliste von Brevo greifen dadurch automatisch. Werbung läuft nie über die Transaktions-Schnittstelle.
- Das **Brevo-Plugin im Shop** bleibt für die Newsletter-Anmeldungen zuständig. METAorder schreibt nur eigene Kontaktfelder (`MO_…`) und eigene Listen.

## Rechtsgrundlage (server/customerMails/legalBasis.ts)

| Grundlage | Quelle |
|---|---|
| Widerspruch (schlägt alles, bleibt dauerhaft) | Brevo-Abmeldung oder Spam-Meldung (Webhook), Brevo-Sperrliste (Abgleich), Newsletter-Abmeldung in Shopware (`optOut`), von Hand erfasst |
| Einwilligung | bestätigte Newsletter-Anmeldung in Shopware (`optIn` mit `confirmedAt`), von Hand bzw. vom Außendienst erfasst (mit Vermerk) |
| Bestandskunde | Bestellung **ab dem Stichtag** des Bestandskunden-Hinweises (Einstellung, B0). Ohne Stichtag ist die Regel aus. |
| keine | alles andere, auch Shopware-Status `direct` (ohne Double-Opt-in) |

Je Mailart gilt eine Liste zulässiger Grundlagen (`CUSTOMER_MAIL_TYPE_RULES` in `shared/customerMails.ts`). In B1 ist nur die **Testaussendung** an die internen Testadressen nutzbar.

## Abläufe

- **Abgleich** (stündlich, nur bei eingeschaltetem Schalter und hinterlegtem Schlüssel; auch per Knopf): Kaufdaten aus dem Bestell-Spiegel (nur MO, ohne Storno und durchgeschleuste Bestellungen), Newsletter-Empfänger aus Shopware, Brevo-Kontakte seit dem letzten Abgleich (Sperrliste). Danach gehen offene Widersprüche auf die Brevo-Sperrliste. Wenn es einen Newsletter-Eintrag gibt, wird er in Shopware auf `optOut` gesetzt (**schreibt in den Shop**).
- **Aussendung**: Entwurf mit geplanten und ausgelassenen Empfängern (mit Grund). Beim Senden prüft METAorder Widersprüche und Bounces erneut. Danach legt es in Brevo die Liste an, importiert die Kontakte mit `MO_`-Feldern, erstellt die Kampagne (Vorlage, Absender, Antwortadresse, Tag `metaorder-<art>`, UTM) und verschickt sie sofort. Ein Lauf kommt nur einmal aus „Entwurf“ bzw. „Fehler“ in den Versand.
- **Webhook** `POST /api/public/customer-mails/brevo`: Wird per Knopf in Brevo eingerichtet (Marketing: `unsubscribed`, `spam`, `hardBounce`, `click`). Brevo schickt dabei die Kopfzeilen `X-Meta-Tenant` und `X-Meta-Token` mit. Das Token liegt verschlüsselt in den Einstellungen und wird beim Neu-Einrichten erneuert.

## Kontaktfelder in Brevo

`MO_FIRMA`, `MO_NAME`, `MO_KUNDENNR`, `MO_KANAL`, `MO_GRUNDLAGE` (`einwilligung` | `bestandskunde` | `test`), `MO_LETZTE_BESTELLUNG` (Datum). Fehlende Felder legt METAorder beim ersten Senden an. Die Vorlage wählt die Fußzeile über `MO_GRUNDLAGE`, zum Beispiel:

```
{% if contact.MO_GRUNDLAGE == "bestandskunde" %} … Sie erhalten diese E-Mail, weil Sie bei META bestellt haben … {% else %} … Newsletter abonniert … {% endif %}
```

Texte der Fußzeilen: `Kundenmails-Rechtstexte-Entwurf-2026-10-20.html` (Freigabe durch den DSB offen).

## Einrichtung nach dem Deploy

1. In Brevo unter „SMTP & API“ einen eigenen API-Schlüssel für METAorder anlegen und ihn auf der Seite eintragen.
2. Testadressen und Antwortadresse eintragen, Verkaufskanäle mit Absender wählen (Shop: „META Regalbau“).
3. Webhook in Brevo einrichten (Knopf).
4. Schalter einschalten und „Jetzt abgleichen“ wählen.
5. In Brevo eine Vorlage anlegen und eine Testaussendung an die Testadressen schicken. Danach Abmeldelink, Fußzeile und Felder prüfen.
6. Den Stichtag erst eintragen, wenn die Hinweistexte aus B0 live sind.
