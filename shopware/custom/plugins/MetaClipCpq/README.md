# META CLIP CPQ (Shopware-Plugin)

Zeigt auf META-CLIP-Produktseiten den Button **„Regal konfigurieren“**. Er öffnet den
Regalplaner in METAorder (`<METAorder-URL>/konfigurator/<Token>`). Der Token ist mit
HMAC-SHA256 signiert, 30 Minuten gültig und enthält Mandant, Kunde (falls eingeloggt),
Verkaufskanal und Produkt. METAorder prüft ihn in `server/cpq/cpqHandoffToken.ts`.

Getestet mit Shopware 6.7.2 (dockware) auf MySQL. Läuft auch unter 6.6.

## Installation

Im Testshop ist die Erweiterungsverwaltung zur Laufzeit abgeschaltet. Ein Upload über
die Admin-API ist dort also nicht möglich, das Plugin muss per Deployment kommen:

```bash
# Ordner MetaClipCpq nach custom/plugins/ kopieren (oder ZIP dort entpacken), dann:
bin/console plugin:refresh
bin/console plugin:install --activate MetaClipCpq
bin/console cache:clear
```

Ein Storefront- oder Admin-Build ist nicht nötig: Der Button ist reines Twig, und das
Review-Modul im Admin bleibt ohne Build ausgeblendet.

## Konfiguration (Einstellungen → Erweiterungen → META CLIP CPQ)

| Feld | Wert |
|---|---|
| METAorder Basis-URL | Adresse des METAorder, ohne `/` am Ende |
| METAorder Mandanten-ID | ID des METAorder-Mandanten, der zu diesem Shop gehört |
| CPQ-Handoff-Secret | muss mit `CPQ_HANDOFF_SECRET` auf dem METAorder-Server übereinstimmen |
| Button nur bei Artikeln mit Namensanfang | Standard `META CLIP`, leer = alle Produktseiten |

Fehlt Basis-URL, Mandanten-ID oder Secret, wird kein Button angezeigt.

Die Lobster- und Slack-Felder braucht nur die spätere Bestellweiterleitung konfigurierter
Regale. Für den Button sind sie nicht nötig.
