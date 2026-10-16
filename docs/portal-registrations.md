# Portal-Registrierungen

Anmeldungen für das Händlerportal kommen – meist von Kollegen weitergeleitet – in ein eigenes
Postfach. n8n holt sie ab und schickt sie an METAorder. METAorder legt **keine Kunden** an, sondern
nur den Admin-Mitarbeiter eines Kunden, den es im Portal schon gibt.

Seite: **B2B → Portal-Registrierungen** (`/b2b/registrations`), Recht „B2B sehen“ zum Lesen,
„B2B verwalten“ zum Ausführen und für die Einstellungen.

## Ablauf je Mail

1. **Auslesen** (`server/b2b/portalRegistrationExtraction.ts`): Die KI (Stufe `smart`) liest Firma,
   Kundennummer, USt-IdNr., Adresse, Ansprechpartner und ob der Regalplaner-Expertenmodus (bzw.
   Adminmodus) gewünscht ist. Feste Regeln ergänzen Kundennummer, USt-IdNr., E-Mail und Expertenmodus
   (auch „kein Expertenmodus“). META-Adressen sind nie der Ansprechpartner. Ist die Mail laut KI
   sicher keine Anmeldung (≥ 70 %), wird sie verworfen.
2. **Abgleich** (`portalRegistrationMatch.ts`): gesucht wird über Kundennummer, E-Mail (als Kunde
   oder als B2B-Mitarbeiter), USt-IdNr., Firmenname, PLZ und Firmen-Domain. Nur Kunden in einem
   Kanal mit „Portal“ im Namen zählen; Onlineshop-Konten sind nur ein Hinweis, interne
   META-Konten (`b2b_sales_representative`) nie ein Treffer. Sicher (≥ 95) ist nur Kundennummer,
   E-Mail oder USt-IdNr. – und nur ohne zweiten gleich guten Portal-Kunden und wenn die Firma zur
   Kundennummer passt.
3. **Plan** (`portalRegistrationPlan.ts`): Admin-Mitarbeiter anlegen (oder vorhandenen übernehmen),
   Verknüpfung mit `admin: true, active: true`, Expertenmodus (`wdu_allow_expert_mode`) nur
   einschalten, nie ausschalten. Am Kunden: inaktiv → aktiv, `b2b_platform_access` an; je nach
   Einstellung leere Felder (USt-IdNr., Telefon) ergänzen. Firmenname und Adresse bleiben immer.
   Ein Mitarbeiter, der schon an einem **anderen** Kunden hängt, wird nie umgehängt
   (`ensureEmployeeCustomerLink` würde dessen übrige Verknüpfungen löschen) → Prüfung.
4. **Ausführen**: neu anlegen mit Zufallspasswort und ohne Shopware-Flow, danach die
   B2Bsellers-Passwort-Mail (Store-API `b2b/employee/recovery-password`, Link 2 Stunden gültig).
   Mit „Automatisch ausführen“ passiert das bei sicheren Treffern sofort, sonst klickt ein
   Bearbeiter. Von Hand gewählte Kunden laufen nie automatisch.
5. **Außendienst**: Steht die Kundennummer in der Zuordnungsliste (Reiter „Außendienst-Zuordnung“,
   Excel/CSV mit Kundennummer, Name, E-Mail), geht eine Info-Mail an den Außendienst.
6. **Nicht im Portal**: Mail an das Kundenstamm-Team mit den Daten, ähnlichen Kunden und der
   Originalmail im Anhang. Die Anmeldung wartet und wird alle `recheckHours` Stunden neu geprüft
   (beim Konfigurationsabruf von n8n) oder über „Neu prüfen“.

Alle Schritte stehen im Verlauf der Registrierung und im Systemprotokoll (Bereich B2B,
Ereignisse `portal_registration.*`).

## Mails

METAorder darf Microsoft 365 nicht direkt anbinden. Mails an Kundenstamm und Außendienst liegen
deshalb im Postausgang (`portal_registration_outbox`); n8n holt sie ab, verschickt sie per Graph
`sendMail` aus dem Registrierungs-Postfach und meldet das Ergebnis. Nach 3 Fehlversuchen gilt eine
Mail als gescheitert und kann im Prüffenster erneut eingereiht werden. Der weiterleitende Kollege
steht (einstellbar) in CC.

## Einrichtung

1. Migration `0053_portal_registrations.sql` (läuft beim Start automatisch).
2. In METAorder → Portal-Registrierungen → Einstellungen: Postfach, Kundenstamm-Adresse, Startdatum
   eintragen, Eingang einschalten. „Automatisch ausführen“ erst nach ein paar geprüften Anmeldungen.
3. Außendienst-Liste importieren.
4. n8n: `n8n-workflows/m365-portal-registrations.json` importieren, Credentials „Microsoft Outlook
   account“ und „METAorder Integration-Key“ zuordnen, METAorder-Adresse im Knoten „Einstellungen“
   prüfen, aktivieren (alle 5 Minuten). Der METAorder-Benutzer, an den der Schlüssel gebunden ist,
   braucht das Recht **„B2B verwalten“**; das Outlook-Konto braucht Zugriff auf das Postfach und
   das Recht, daraus zu senden.

## Endpunkte für n8n

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/b2b/registrations/n8n/config` | an/aus, Postfach, Ordner, `$filter`; stößt die Neuprüfung wartender Anmeldungen an |
| POST | `/api/b2b/registrations/n8n/intake` | Mail als `.eml` (`file`, `graph_message_id`, `mailbox`, `subject`); Antwort `intake` mit Kategorien und `move` |
| GET | `/api/b2b/registrations/n8n/outbox` | offene Mails als fertige Graph-Nachrichten |
| POST | `/api/b2b/registrations/n8n/outbox/:id/ack` | `{ ok, statusCode, error }` |

Outlook-Kategorien: „METAorder: Registrierung“, „… Registrierung prüfen“, „… an Kundenstamm“,
„… keine Registrierung“, „… Fehler“. Mails mit einer dieser Kategorien holt der Workflow nicht erneut.
