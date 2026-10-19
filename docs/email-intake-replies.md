# Kundenantworten aus dem E-Mail-Eingang

Entscheidung 19.10.2026: Beantwortbare Kundenmails aus dem n8n-E-Mail-Eingang werden zu Tickets „Kundenanfrage“ mit einem KI-Antwortentwurf. Verschickt wird erst nach Freigabe im Ticket, und zwar über n8n aus dem Postfach, in dem die Mail ankam (Postausgang: zweiter Schritt). Eine Automatik ohne Freigabe kommt später.

## Wann entsteht ein Ticket?

Einstellungen → Integration → E-Mail-Eingang → „Kundenantworten“. Ab Werk ist jede Mailart aus.

| Mailart | Auslöser im Eingang | Inhalt des Entwurfs |
|---|---|---|
| Lieferstatus | Sonstiges, Art „Rückfrage zu einem Vorgang“ | Status, Zahlung, Versandart, versendet ja/nein, Sendungsnummer mit Link. Der Liefertermin ist immer der Platzhalter `[Liefertermin eintragen]`. |
| Reklamation | Sonstiges, Art „Reklamation“ | Eingangsbestätigung, Bitte um Bestellnummer und Fotos, keine Zusagen, `[nächster Schritt eintragen]` |
| Kundenfrage | Sonstiges, Art „Allgemeine Nachricht“ | Fachliches nur als Platzhalter `[Antwort zur Frage eintragen]` |
| Angebotsanfrage | Angebotsentwurf entstanden | Eingangsbestätigung „Angebot folgt“, ohne Preise oder Lieferzeiten. Entfällt, wenn die automatische Eingangsbestätigung der Entwurfs-Automatik aktiv ist. |

Kein Ticket entsteht in diesen Fällen:
- Der Absender ist intern: eigene Domain, Postfach-Domain oder eine Adresse von META.
- Die Mail ist aussortiert, doppelt, eine Bestellung oder gemischt (Bestellung und Angebot).
- Die KI meint, die Mail braucht keine Antwort, z. B. bei einem reinen Dank. Das steht dann im Protokoll unter `email_intake.reply_draft` bzw. „keine Antwort nötig“.

Je Mail gibt es höchstens ein Ticket (Tabelle `email_intake_replies`, eindeutig je `message_key`). Wiederholungen von n8n legen nichts doppelt an.

## Bestelldaten

- Die Bestellnummer wird aus Betreff und Text gelesen: `MO…`, oder „Bestellnummer/Auftrag/Order“ mit Nummer.
- Die Daten kommen aus dem Bestellspiegel (`shopware_orders`). Verwendet werden sie **nur**, wenn die Bestellung zur Absenderadresse gehört. Sonst steht im Ticket „Bestellung gehört zu einer anderen E-Mail-Adresse“, und der Entwurf enthält keine Daten.
- Bei doppelten Nummern gilt die zuletzt geänderte Bestellung.
- Liefertermine aus Shopware werden bewusst nicht verwendet: Bei MO-Bestellungen steht dort das Anlagedatum, Portal-Zusagen kommen aus Dummy-Beständen. Bis SAP Lieferdaten liefert, bleibt der Termin ein Platzhalter.

## Im Ticket

- Über dem Antwortfeld steht der Kasten „KI-Antwortentwurf“ mit Empfänger, Postfach, Bestellung und Sendung. Der Entwurf steht schon im Antwortfeld.
- „Neu erstellen“ liest die Bestelldaten neu und schreibt einen neuen Entwurf (`POST /api/tickets/:id/reply-draft/regenerate`).
- Platzhalter in `[eckigen Klammern]` werden angezeigt. Mit Platzhaltern wird nicht verschickt.
- Der Gruß kommt aus der Einstellung „Gruß unter jeder Antwort“. Ist sie leer, steht `[Name eintragen]` im Text.
- Bis der Postausgang über n8n fertig ist, verschickt das Ticket bei Kundenanfragen keine Mail über den Mailversand von METAorder. Die Antwort wird nur gespeichert.

## Technik

- Der Ablauf in `server/commercial/emailIntakeReplies.ts` startet nach der Antwort an n8n im Hintergrund (`startIntakeReply` in `draftRoutes.ts`). Fehler dort berühren den Eingang nicht.
- Prompt und Regeln: `server/commercial/emailIntakeReplyDraft.ts`. Modellstufe `smart`.
- Zur Mail werden gespeichert: `internet_message_id` (`<…>`) und `mailbox`. Damit findet der n8n-Postausgang die Originalmail, auch nach dem Verschieben (die Outlook-ID ändert sich dabei).
