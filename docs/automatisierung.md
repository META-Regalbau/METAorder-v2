# Automatisierungsregeln

Unter **Automatisierung** lassen sich Regeln anlegen: *Wenn* ein Auslöser eintritt *und* alle Bedingungen zutreffen, *dann* werden die Aktionen der Reihe nach ausgeführt. Jede Ausführung steht in der **Ausführungshistorie** der Regel.

## Verfügbar

**Auslöser**
- **Ticket erstellt** – egal auf welchem Weg (manuell, Kundenportal, E-Mail-Eingang, Webhook).
- **Ticket-Status geändert** – mit Zugriff auf den vorherigen Status.
- **Bestellung erstellt**, **Bestellstatus geändert**, **Zahlungsstatus geändert** – siehe „Bestell-Auslöser“ unten.
- **Zeitgesteuert: Bestellungen prüfen** – siehe unten.

**Bedingungen** (alle müssen zutreffen; ohne Bedingung greift die Regel immer)
- Ticket: Priorität, Kategorie, Status, vorheriger Status, Titel, Beschreibung, Kunden-E-Mail, Kundenname, Bestellnummer, zugewiesen (ja/nein), aus E-Mail entstanden (ja/nein)
- Ticket: **Stimmung (KI)** – wird nur ermittelt, wenn eine Regel sie braucht; ohne KI-Konfiguration per Stichwort-Heuristik.
- Bestellung: Status, Zahlungsstatus (bei den Änderungs-Auslösern auch der jeweils **vorherige** Wert), Tage seit Bestellung, **Tage über spätestem Lieferdatum** (ohne Lieferdatum: seit Bestelldatum – wie die Ansicht „Verspätete Bestellungen“), Gesamtbetrag, Bestellnummer, Kunde, Zahl-/Versandart, Verkaufskanal.

**Aktionen**
- Ticket zuweisen · Priorität setzen · KI-Analyse (Kategorie setzen solange „Allgemein“, negative Stimmung → Priorität „Hoch“)
- Benachrichtigung an einen Benutzer · E-Mail senden (über den E-Mail-Ausgang aus den Einstellungen) · Ticket anlegen
- Texte können **Platzhalter** enthalten, z. B. `{{ticket.ticketNumber}}`, `{{ticket.title}}`, `{{ticket.customerName}}`, `{{ticket.customerEmail}}` (auch als E-Mail-Empfänger), bei Bestellungen `{{order.orderNumber}}`, `{{order.customerName}}`, `{{order.daysPastDeliveryDate}}`, `{{order.previousStatus}}` u. a.
- Ticket-Aktionen (zuweisen, Priorität, KI-Analyse) gibt es nur bei Ticket-Auslösern. Ein von einer Bestellregel angelegtes Ticket ist mit der Bestellung verknüpft.

## Bestell-Auslöser

**Bestellung erstellt**, **Bestellstatus geändert** und **Zahlungsstatus geändert** erkennt der **Shopware-Spiegel** beim Abgleich (etwa alle 3 Minuten) – die Regel läuft also mit kurzer Verzögerung und erfasst Änderungen egal woher (Shop, Shopware-Admin, SAP, METAorder). Ist der Spiegel abgeschaltet (`SHOPWARE_SYNC_ENABLED=false`), lösen sie nicht aus.

Sicherungen gegen Massen-Ausführung:
- Der **erste Abgleich** eines Mandanten (leerer Spiegel) löst nichts aus.
- Gemeldet werden nur Änderungen der **letzten 48 Stunden** (Shopware-Änderungszeitpunkt). Stand der Abgleich länger still, lösen nachgeholte ältere Änderungen nichts mehr aus.
- „Erstellt“ nur für Bestellungen, die selbst höchstens 48 Stunden alt sind – eine ältere Bestellung, die im Spiegel bloß fehlte, gilt nicht als neu. Beim Nachladen fehlender Bestellungen (Abgleich) wird ohnehin nichts gemeldet.
- Gemeldet wird erst, nachdem der Spiegel den neuen Stand gespeichert hat; jede Änderung also einmal. Die Ereignisse eines Abgleichs werden nacheinander abgearbeitet.
- Ändert sich in Shopware mehrmals etwas zwischen zwei Abgleichen, zählt nur der Stand beim Abgleich (z. B. offen → bezahlt → erstattet wird als offen → erstattet gemeldet).

## Zeitgesteuerte Regeln (Bestellungen)

Laufen regelmäßig (Standard: stündlich, erster Lauf 3 Minuten nach dem Start) über die Bestellungen aus dem **Shopware-Spiegel** – nicht live aus Shopware. Ist der Spiegel abgeschaltet (`SHOPWARE_SYNC_ENABLED=false`), finden sie nichts.

Sicherungen gegen Massen-Ausführung:
- nur Bestellungen der **letzten 60 Tage** (ältere „hängende“ Bestellungen bleiben unberührt);
- **jede Bestellung höchstens einmal pro Regel** (Fehlversuche werden bis zu dreimal wiederholt);
- höchstens **25 Ausführungen je Regel und Lauf**, älteste Bestellungen zuerst;
- mindestens **eine Bedingung** ist Pflicht.

Die **Vorschau** im Editor zeigt vor dem Speichern, auf wie viele Bestellungen die Regel gerade zutrifft, wie viele schon erledigt sind und was der nächste Lauf täte (mit Beispielen). Abschalten: `AUTOMATION_SCHEDULER_ENABLED=false`; Intervall: `AUTOMATION_SCHEDULE_INTERVAL_MINUTES` (mindestens 5).

## Verhalten

- **Mandanten:** Regeln gelten nur für Tickets und Bestellungen ihres Mandanten; zuweisen/benachrichtigen nur an Benutzer dieses Mandanten.
- **Reihenfolge:** höhere Priorität zuerst, bei Gleichstand die ältere Regel. Bedingungen beziehen sich auf den Stand beim Auslösen.
- **Kein Endlos-Kreislauf:** Änderungen, die eine Regel selbst vornimmt (z. B. ein von einer Regel angelegtes Ticket), lösen keine weiteren Regeln aus.
- **Fehler:** Eine fehlgeschlagene Aktion stoppt die folgenden nicht; die Ausführung wird als fehlgeschlagen mit Meldung protokolliert.
- **Asynchron:** Regeln laufen kurz nach dem Ereignis, die auslösende Aktion (z. B. Ticket speichern) wartet nicht darauf.
- **Unvollständige Regeln** (z. B. aus der früheren Oberfläche) werden nicht ausgeführt und lassen sich erst nach dem Vervollständigen aktivieren.

## Technik

Katalog (Auslöser, Felder, Operatoren, Aktionen, Prüfung): `shared/automation.ts` · Engine: `server/automation/` · Auslöser: `server/lib/domainEvents.ts` (gemeldet von `storage.createTicket/updateTicket` bzw. vom Spiegel-Abgleich über `server/shopware/orderChangeEvents.ts`) · Zeitsteuerung und Vorschau: `server/automation/scheduler.ts` · Tests: `tests/unit/automation.test.ts`, `tests/unit/automationScheduled.test.ts`, `tests/unit/automationOrderEvents.test.ts`.
