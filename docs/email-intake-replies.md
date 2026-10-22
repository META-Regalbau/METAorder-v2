# Kundenantworten aus dem E-Mail-Eingang

Entscheidung 19.10.2026: Beantwortbare Kundenmails aus dem n8n-E-Mail-Eingang werden zu Tickets „Kundenanfrage“ mit einem KI-Antwortentwurf. Verschickt wird erst nach Freigabe im Ticket, und zwar über n8n aus dem Postfach, in dem die Mail ankam. Eine Automatik ohne Freigabe kommt später.

## Wann entsteht ein Ticket?

Einstellungen → Integration → E-Mail-Eingang → „Kundenantworten“. Ab Werk ist jede Mailart aus.

| Mailart | Auslöser im Eingang | Inhalt des Entwurfs |
|---|---|---|
| Lieferstatus | Sonstiges, Art „Rückfrage zu einem Vorgang“ | Status, Zahlung, Versandart, versendet ja/nein, Sendungsnummer mit Link. Der Liefertermin ist immer der Platzhalter `[Liefertermin eintragen]`. Bei stornierten Bestellungen gibt es keine Versandangaben, und Test-Sendungsnummern wie „1234567890“ werden nicht verwendet. |
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
- Fehlt die Anrede im KI-Text, setzt METAorder „Guten Tag,“ davor.
- Der Gruß kommt aus der Einstellung „Gruß unter jeder Antwort“. Ist sie leer, steht `[Name eintragen]` im Text.

## Versand („Freigeben & senden“)

1. **Freigeben & senden** im Ticket. Mit Platzhaltern oder ohne Text ist der Knopf gesperrt, und der Server lehnt ab. Der Text wird als öffentliche Antwort im Ticket gespeichert, das Ticket wechselt auf „Wartet auf Kunde“, und die Antwort geht in den Postausgang (`status = queued`).
2. Der n8n-Workflow **„METAorder Kundenantworten → Microsoft 365“** (`n8n-workflows/m365-customer-replies.json`) holt alle 2 Minuten ab (`GET /api/email-intake/replies/outbox`, höchstens 10).
3. Je Antwort sucht er die Originalmail im Postfach über die Message-ID (`$filter=internetMessageId eq '…'`, über alle Ordner). Gefunden: `createReply` → unseren Text vor das Zitat setzen (`PATCH`) → `send`. So geht die Antwort im Mailverlauf raus und landet in „Gesendete Elemente“ des Postfachs.
   Der `PATCH` setzt den Empfänger fest auf die Kundenadresse aus METAorder (`to`), CC bleibt leer. Sonst nähme Graph den Absender der Originalmail, bei internen Weiterleitungen (Kollege, Verteilpostfach wie digital-service@) also den Weiterleitenden.
4. Originalmail nicht gefunden (gelöscht) oder keine Message-ID: neue Mail mit „Re: Betreff“ (`sendMail`). Das Ticket bekommt dazu eine interne Notiz.
5. Scheitert das Einsetzen des Textes, wird **nicht** gesendet, sonst ginge nur das Zitat raus. Der leere Entwurf bleibt im Ordner „Entwürfe“ des Postfachs.
6. Rückmeldung an METAorder (`POST …/outbox/:id/ack`): verschickt → `sent`. Fehler → erneuter Versuch beim nächsten Lauf. Nach 3 Fehlversuchen `failed`: interne Notiz im Ticket, Ticket auf „Wartet auf intern“, und im Ticket erscheint „Erneut senden“. Nicht quittierte Antworten holt n8n nach 15 Minuten erneut.

**Einrichtung in n8n:** Vorlage importieren. Den Knoten „METAorder: …“ das Credential „METAorder Integration-Key“ zuordnen, den Graph-Knoten „Microsoft Outlook account“. Dann aktivieren. Der Benutzer `n8n` braucht „Tickets verwalten“ (hat er). Das Outlook-Konto braucht Zugriff auf das Postfach, für freigegebene Postfächer „Vollzugriff“ und „Senden als“.

## Technik

- Der Ablauf in `server/commercial/emailIntakeReplies.ts` startet nach der Antwort an n8n im Hintergrund (`startIntakeReply` in `draftRoutes.ts`). Fehler dort berühren den Eingang nicht.
- Prompt und Regeln: `server/commercial/emailIntakeReplyDraft.ts`. Modellstufe `smart`.
- Zur Mail werden gespeichert: `internet_message_id` (`<…>`) und `mailbox`. Damit findet der n8n-Postausgang die Originalmail, auch nach dem Verschieben (die Outlook-ID ändert sich dabei).
