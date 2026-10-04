# Automatisierungsregeln

Unter **Automatisierung** lassen sich Regeln anlegen: *Wenn* ein Auslöser eintritt *und* alle Bedingungen zutreffen, *dann* werden die Aktionen der Reihe nach ausgeführt. Jede Ausführung steht in der **Ausführungshistorie** der Regel.

## Verfügbar (Ausbaustufe 1)

**Auslöser**
- **Ticket erstellt** – egal auf welchem Weg (manuell, Kundenportal, E-Mail-Eingang, Webhook).
- **Ticket-Status geändert** – mit Zugriff auf den vorherigen Status.

**Bedingungen** (alle müssen zutreffen; ohne Bedingung greift die Regel immer)
- Ticket: Priorität, Kategorie, Status, vorheriger Status, Titel, Beschreibung, Kunden-E-Mail, Kundenname, Bestellnummer, zugewiesen (ja/nein), aus E-Mail entstanden (ja/nein)
- Ticket: **Stimmung (KI)** – wird nur ermittelt, wenn eine Regel sie braucht; ohne KI-Konfiguration per Stichwort-Heuristik.

**Aktionen**
- Ticket zuweisen · Priorität setzen · KI-Analyse (Kategorie setzen solange „Allgemein“, negative Stimmung → Priorität „Hoch“)
- Benachrichtigung an einen Benutzer · E-Mail senden (über den E-Mail-Ausgang aus den Einstellungen) · Ticket anlegen
- Texte können **Platzhalter** enthalten, z. B. `{{ticket.ticketNumber}}`, `{{ticket.title}}`, `{{ticket.customerName}}`, `{{ticket.customerEmail}}` (auch als E-Mail-Empfänger).

## Verhalten

- **Mandanten:** Regeln gelten nur für Tickets ihres Mandanten; zuweisen/benachrichtigen nur an Benutzer dieses Mandanten.
- **Reihenfolge:** höhere Priorität zuerst, bei Gleichstand die ältere Regel. Bedingungen beziehen sich auf den Stand beim Auslösen.
- **Kein Endlos-Kreislauf:** Änderungen, die eine Regel selbst vornimmt (z. B. ein von einer Regel angelegtes Ticket), lösen keine weiteren Regeln aus.
- **Fehler:** Eine fehlgeschlagene Aktion stoppt die folgenden nicht; die Ausführung wird als fehlgeschlagen mit Meldung protokolliert.
- **Asynchron:** Regeln laufen kurz nach dem Ereignis, die auslösende Aktion (z. B. Ticket speichern) wartet nicht darauf.
- **Unvollständige Regeln** (z. B. aus der früheren Oberfläche) werden nicht ausgeführt und lassen sich erst nach dem Vervollständigen aktivieren.

## Folgt

- **Zeitgesteuert:** verzögerte Bestellungen (ohne Mehrfachausführung pro Bestellung)
- **Bestellungen:** erstellt, Status geändert, Zahlungsstatus geändert (über die Änderungserkennung des Shopware-Spiegels)

## Technik

Katalog (Auslöser, Felder, Operatoren, Aktionen, Prüfung): `shared/automation.ts` · Engine: `server/automation/` · Auslöser: `server/lib/domainEvents.ts` (gemeldet von `storage.createTicket/updateTicket`) · Tests: `tests/unit/automation.test.ts`.
