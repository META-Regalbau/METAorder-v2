# Kundenmails über Brevo (B1 Fundament)

Konzept: `Kundenmails-Brevo-Konzept-2026-10-19.html` (Entscheidungen 20.10.2026). Seite: **/admin/kundenmails** (nur Administratoren).

## Aufgabenteilung

- **METAorder** entscheidet, wer welche Mail bekommt: Rechtsgrundlage je Kontakt, Widerspruch, Bounce, Verkaufskanal, Kontaktbremse.
- **Brevo** verschickt jede Aussendung als **Kampagne** an eine eigene Liste im Ordner „METAorder“. Abmeldelink und Sperrliste von Brevo greifen dadurch automatisch. Werbung läuft nie über die Transaktions-Schnittstelle.
- Das **Brevo-Plugin im Shop** bleibt für die Newsletter-Anmeldungen zuständig. METAorder schreibt nur eigene Kontaktfelder (`MO_…`) und eigene Listen.

## Rechtsgrundlage (server/customerMails/legalBasis.ts)

| Grundlage | Quelle |
|---|---|
| Widerspruch (schlägt alles, bleibt dauerhaft) | Brevo-Abmeldung über den Link oder Spam-Meldung (Webhook bzw. Verlauf je gesperrtem Kontakt), Newsletter-Abmeldung in Shopware (`optOut`), von Hand erfasst. **Nicht**: bloße Brevo-Sperre (das Shop-Plugin sperrt jeden ohne Newsletter-Anmeldung, Live-Befund 20.10.2026) |
| Einwilligung | bestätigte Newsletter-Anmeldung in Shopware (`optIn` mit `confirmedAt`), von Hand bzw. vom Außendienst erfasst (mit Vermerk) |
| Bestandskunde | Bestellung **ab dem Stichtag** des Bestandskunden-Hinweises (Einstellung, B0). Ohne Stichtag ist die Regel aus. |
| keine | alles andere, auch Shopware-Status `direct` (ohne Double-Opt-in) |

Je Mailart gilt eine Liste zulässiger Grundlagen (`CUSTOMER_MAIL_TYPE_RULES` in `shared/customerMails.ts`). In B1 ist nur die **Testaussendung** an die internen Testadressen nutzbar.

## Abläufe

- **Abgleich** (stündlich, nur bei eingeschaltetem Schalter und hinterlegtem Schlüssel; auch per Knopf): Kaufdaten aus dem Bestell-Spiegel (nur MO, ohne Storno und durchgeschleuste Bestellungen), Newsletter-Empfänger aus Shopware, Brevo-Kontakte seit dem letzten Abgleich (Sperrkennzeichen). Für gesperrte Kontakte liest METAorder je Abgleich bis zu 300 Verläufe nach (Käufer zuerst): Abmeldelink oder Spam-Meldung → Widerspruch, harter Bounce → unzustellbar, sonst „von Admin/Plugin gesperrt“. In Brevo gesperrte Kontakte werden bei Aussendungen ausgelassen (`brevoBlocked`); ob und wen METAorder für Bestandskunden-Mails in Brevo entsperrt, entscheidet B2. Danach gehen offene Widersprüche auf die Brevo-Sperrliste. Wenn es einen Newsletter-Eintrag gibt, wird er in Shopware auf `optOut` gesetzt (**schreibt in den Shop**).
- **Aussendung**: Entwurf mit geplanten und ausgelassenen Empfängern (mit Grund). Beim Senden prüft METAorder Widersprüche und Bounces erneut. Danach legt es in Brevo die Liste an, importiert die Kontakte mit `MO_`-Feldern, erstellt die Kampagne (Vorlage, Absender, Antwortadresse, UTM; kein Tag, das lehnt der Brevo-Tarif ab) und verschickt sie sofort. Ein Lauf kommt nur einmal aus „Entwurf“ bzw. „Fehler“ in den Versand.
- **Webhook** `POST /api/public/customer-mails/brevo`: Wird per Knopf in Brevo eingerichtet (Marketing: `unsubscribed`, `spam`, `hardBounce`, `click`). Brevo schickt dabei die Kopfzeilen `X-Meta-Tenant` und `X-Meta-Token` mit. Das Token liegt verschlüsselt in den Einstellungen und wird beim Neu-Einrichten erneuert.

## B2 Stammkunden-Brief

- **Kandidaten:** Kunden mit mindestens 2 Bestelltagen (MO, 730 Tage). Lokal mit Live-Spiegel am 20.10.2026: 256 Kunden, 254 mit kaufbaren Stammartikeln, 98 mit Zubehör.
- **Inhalt:**
  - Bis zu 3 Stammartikel. Zuerst die, die an mehreren Tagen gekauft wurden, dann nach Umsatz. Service-Artikel (SW…) sind ausgenommen.
  - Je Artikel der **Listenpreis netto**, die Lieferzeit und der Link. Die Daten kommen live aus dem Shop (DE-Kanal, unter der Shop-Sperre). Nicht aktive Artikel und Artikel ohne Preis fallen weg.
  - Bis zu 3 Zubehörartikel aus im Shop aktiven Crossselling-Paaren (`cross_sell_pair_state.status = applied`), ohne bereits gekaufte Artikel.
- **Ausschlüsse:** offene Reklamation (Ticket-Kategorie `complaint`, nicht erledigt) und überfällige Zahlung (`isPaymentOverdue` bei noch offener Zahlung).
- **Vorschau:** Echte Briefe von Beispielkunden gehen an die Testadressen, abwechselnd mit beiden Fußzeilen. Bevorzugt werden Kunden mit Zubehör.
- **Kundenversand:** Ab Werk aus. Der Schalter „Stammkunden-Brief an Kunden erlauben“ in den Einstellungen schaltet ihn frei. Senden prüft das noch einmal.
- **Startvorlage:** Ein Knopf legt sie in Brevo an (`regularLetterTemplate.ts`). Danach lässt sie sich in Brevo gestalten.
- **Hinweis:** Das Brevo-Plugin sperrt alle Kunden ohne Newsletter. Diese werden ausgelassen (`brevoBlocked`). METAorder entsperrt sie nie selbst, denn das Plugin würde sie wieder sperren und gleicht den Status in beide Richtungen ab.
- **Offen:** Portal-Kunden brauchen Portalpreise und den Außendienst als Absender. Der Stammkundenrabatt ist nicht abgebildet.

## Weitere Mailarten (B2b–B5)

Alle Mailarten laufen über denselben Weg (`server/customerMails/mailTypeRuns.ts`):
- Startvorlage per Knopf (`mailTemplates.ts`)
- „Vorschau an Testadressen“ mit echten Inhalten von Beispielkunden
- „Entwurf für Kunden“ nur, wenn die Mailart unter Einstellungen → Kundenversand freigeschaltet ist

| Mailart | Wer | Inhalt | Weg |
|---|---|---|---|
| Überfällig-Erinnerung (`regularOverdue`) | Von der Stammkunden-Wache gemeldet (Zustand „gemeldet“), Meldung ≥ 7 Tage alt, seither kein CRM-Anruf (Interaktion „call“), keine Preis- oder Lieferzeit-Ursache, höchstens alle 90 Tage | wie der Stammkunden-Brief, zusätzlich `MO_TAGE_SEIT` | Kampagne |
| Newsletter (`newsletter`) | alle mit Einwilligung | Block „Neu im Shop“ (`MO_NEU_1..4_*`, neueste kaufbare Artikel der letzten 45 Tage laut Shopware-Anlagedatum), sonst Text der Vorlage | Kampagne |
| Service nach dem Versand (`afterSalesService`) | Bestellungen 3–10 Tage nach dem Versand (`shippingInfo.shippedDate`), je Bestellung einmal | `MO_BESTELLNR`, Datum, Sendungsverfolgung, bis 5 Positionen mit Link | **Transaktionsweg** (einzeln, `{{ params.… }}`, ohne Werbung und ohne Abmeldelink; die Plugin-Sperre gilt hier nicht) |
| Zubehör nach dem Kauf (`afterSalesAccessories`) | Bestellungen 30–45 Tage nach dem Versand, je Bestellung einmal, nur mit passendem Zubehör | `MO_BESTELLNR`, `MO_ZUB_1..3_*` | Kampagne |
| Reaktivierung (`reactivation`) | Einmalkäufer (1 Bestelltag in 730 Tagen), letzte Bestellung vor 180–365 Tagen, je Adresse einmal; 20 % feste Kontrollgruppe (`controlGroup`) | damalige Artikel + Zubehör | Kampagne |

- **Platzhalter-Sperre:** Steht in der Brevo-Vorlage noch `⟦`, verweigert METAorder den Kundenversand. Die Newsletter-Startvorlage hat bewusst so einen Absatz.
- **Gleichzeitige Läufe:** Kampagnen lesen die Kontaktfelder beim Versand. Zwei Aussendungen verschiedener Arten deshalb nacheinander senden, nicht gleichzeitig.

## Wirkung (B6)

- **Je Aussendung** (Knopf „Empfänger“ bei verschickten Läufen): Brevo-Zahlen (zugestellt, geöffnet, geklickt, abgemeldet, unzustellbar), Klicks aus dem Webhook und Bestellungen der Empfänger in 14 Tagen nach dem Versand (MO, netto). Bei der Reaktivierung kommt der Vergleich mit der Kontrollgruppe dazu.
- **Shop-Puls-Wochenbericht:** Abschnitt „Kundenmails der Woche“ (Aussendungen, Empfänger, Bestellungen danach, Abmeldungen).

## Einwilligung über den Außendienst

„Einwilligung erfassen“ mit Quelle Außendienst/CRM löst im Shop die Newsletter-Anmeldung mit Bestätigungsmail aus (Store-API `newsletter/subscribe`, Kanal META Regalbau DE). Der Vermerk und `doi_requested_at` stehen am Kontakt. Die Einwilligung setzt erst der Abgleich, sobald die Anmeldung bestätigt ist. Danach hebt auch das Brevo-Plugin die Sperre auf. Die Quelle „von Hand“ setzt die Einwilligung direkt (etwa bei schriftlicher Einwilligung) und gehört zu Frage 3 an den DSB.

## B0 vorbereitet

Der Hinweis für Kasse und Registrierung ist als Storefront-Baustein angelegt (`shopware/storefront-snippets/email-notice.js`, Einspielen mit `scripts/writeEmailNotice.ts`).
- **Nicht eingespielt**, erst nach Freigabe durch den DSB.
- Der Tag des Live-Einspielens ist der Stichtag.
- Danach `EMAIL_NOTICE_SNIPPET` in `STOREFRONT_SNIPPETS` übernehmen, damit der Shop-Wächter ihn prüft.

## Kontaktfelder in Brevo

`MO_FIRMA`, `MO_NAME`, `MO_KUNDENNR`, `MO_KANAL`, `MO_GRUNDLAGE` (`einwilligung` | `bestandskunde` | `test`), `MO_LETZTE_BESTELLUNG` (Datum). Stammkunden-Brief: `MO_STAMM_ANZAHL`, `MO_STAMM_{1..3}_NAME|NR|PREIS|LIEFERZEIT|URL`, `MO_ZUB_ANZAHL`, `MO_ZUB_{1..3}_NAME|PREIS|URL`. Fehlende Felder legt METAorder beim ersten Senden an. Die Vorlage wählt die Fußzeile über `MO_GRUNDLAGE`, zum Beispiel:

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
