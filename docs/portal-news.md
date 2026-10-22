# Portal-Neuigkeiten

Interne Seite „Neuigkeiten“ im Händlerportal: Was sich in Shop, Portal und Systemen geändert hat. Quelle
sind die Changelog-Mails der Shop-Entwickler (Carolin, Sebastian). Eine Outlook-Regel verschiebt sie in
einen Ordner im Postfach, n8n holt sie dort ab, die KI schreibt daraus einen Beitrag, METAorder schreibt
alle veröffentlichten Beiträge auf eine Erlebniswelt im Shop.

Seite: **B2B → Portal-Neuigkeiten** (`/b2b/news`), Recht „B2B sehen“ zum Lesen, „B2B verwalten“ zum
Bearbeiten und für die Einstellungen.

## Ablauf je Mail

1. **Eingang** (`n8n-workflows/m365-portal-news.json`, alle 5 Minuten): liest den Unterordner des
   Posteingangs aus den Einstellungen (legt ihn an, falls er fehlt), nur Mails ab „Mails ab“ und ohne
   METAorder-Kategorie, schickt die Mail als `.eml` an `/api/b2b/news/n8n/intake` und setzt danach eine
   Kategorie (`METAorder: Neuigkeit veröffentlicht`, `… prüfen`, `METAorder: Fehler`). Die Mail bleibt im
   Ordner. Ohne 2xx (409, 503, METAorder weg) bekommt sie keine Kategorie und kommt im nächsten Lauf
   wieder; Duplikate erkennt METAorder an der Message-ID.
2. **Umschreiben** (`server/b2b/portalNewsExtraction.ts`, KI-Stufe `smart`): Überschrift, Kurzfassung,
   Abschnitte (Neu / Verbessert / Behoben oder nach Bereich), Bereiche als Schlagwörter. Nur Inhalte aus
   der Mail, auch weitergeleitete Teile und mehrere Changelogs in einer Mail (je System eigene Abschnitte); Ticketlisten ohne Nummern umgeschrieben, „noch nicht enthalten“ fällt weg; Ticket- und Versionsnummern, Plugin-/Klassennamen, Deployments, Rechnungen fallen weg.
   Datum = Eingangstag (deutsche Zeit), außer die Mail nennt ausdrücklich ein Release-Datum (± 60 Tage).
3. **Veröffentlichen**: mit „Automatisch veröffentlichen“ sofort, wenn die KI sicher ist (Changelog,
   ≥ 60 %). Entwurf bleibt es bei Automatik aus, unsicherer KI, „kein Changelog“ und ohne KI (dann nur
   grob gegliedert: Betreff als Titel, Aufzählungszeilen bis zur Signatur).

**Ohne Outlook-Regel – aus dem E-Mail-Eingang** (`startPortalNewsFromIntake`, Einstellung „Auch aus dem
E-Mail-Eingang übernehmen“): Nach jeder Mail, die der normale E-Mail-Eingang verarbeitet hat, prüft METAorder im
Hintergrund (n8n wartet nicht): Absender im Mailkopf steht in der Absender-Liste (Standard Carolin und Sebastian),
kein Termin-Betreff („Abgesagt:“, „Einladung:“ …) und ein Changelog-Hinweis im Text (Release, Version, behoben,
Tickets …). Dann läuft dieselbe Verarbeitung wie aus dem Ordner – nur entsteht ohne sicheres „Changelog“ der KI
(oder ohne KI) **kein** Beitrag, auch kein Entwurf. Die Einordnung des E-Mail-Eingangs (Outlook-Kategorie) bleibt
unverändert. Liegt dieselbe Mail auch im Ordner, verhindert die Message-ID einen zweiten Beitrag.

Ohne n8n: **Text einfügen** macht aus eingefügtem Mailtext einen Entwurf.

## Die Seite im Shop

`server/b2b/portalNewsShop.ts`: eine Erlebniswelt **„METAorder Portal – Neuigkeiten“** (Typ Shopseite,
feste IDs aus `portalNewsEntityId`) mit einem HTML-Block. Angelegt beim ersten Veröffentlichen, danach
wird nur der Inhalt des HTML-Felds ersetzt (`PATCH cms-slot`). Die Seite wird **nie gelöscht**, damit die
Zuordnung bleibt: Die Seite einer Portal-Kategorie zuordnen (und die Sichtbarkeit für interne Konten
regeln) macht der Admin von Hand im Shop, weil B2Bsellers das im Standard nicht abbildet. Wurde der Block
im Admin gelöscht, hängt METAorder den eigenen Abschnitt wieder ein.

Neu geschrieben wird bei: Veröffentlichen, Bearbeiten eines veröffentlichten Beitrags, Ausblenden,
Löschen, geänderter Überschrift/Einleitung und über „Seite neu schreiben“. Je Mandant läuft das
nacheinander. Ein Shop-Fehler macht den Beitrag nicht ungeschehen: Er steht im Seitenstand (oben auf der
Seite in METAorder) und im Verlauf des Beitrags; „Seite neu schreiben“ holt es nach.

HTML: `server/b2b/portalNewsPageHtml.ts`, alle Texte maskiert, CSS in px unter `.mon`. Die neuesten
8 Beiträge stehen offen da, ältere unter „Ältere Neuigkeiten“.

## Einrichten

1. Outlook-Regel: Changelog-Mails von Carolin und Sebastian in den Ordner (Standard
   „METAorder Neuigkeiten“) verschieben.
2. n8n: Vorlage importieren, Outlook-Zugang mit Zugriff auf das Postfach und den METAorder-Zugang
   (Benutzer mit „B2B verwalten“) zuordnen, aktivieren.
3. METAorder → Portal-Neuigkeiten → Einstellungen: Postfach, „Mails ab“, „Mails abholen“ an.
4. Nach dem ersten Beitrag im Shop-Admin die Erlebniswelt der Portal-Kategorie zuordnen.

Tabelle `portal_news_posts` (`migrations/0069_portal_news.sql`), Einstellungen unter
`portal_news_settings`, Seitenstand unter `portal_news_page_state`.
