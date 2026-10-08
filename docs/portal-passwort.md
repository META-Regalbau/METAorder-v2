# Händlerportal: Passwort-Link anfordern (/portal-zugang)

Händler fordern auf der öffentlichen Seite `/portal-zugang` mit **Kundennummer und E-Mail** einen Link zum Festlegen ihres Portal-Passworts an. Die Mail verschickt Shopware selbst über das „Passwort vergessen“ von B2Bsellers – METAorder erzeugt und verschickt kein Passwort.

## Ablauf

1. `POST /api/public/portal-password-request` mit Kundennummer und E-Mail. Die Seite meldet, ob ein Link verschickt wurde: `404 not_found` (kein Zugang zu Kundennummer + E-Mail, auch META-eigene/Vertrieb), `403 inactive`, `429 already_requested` (Link vor weniger als 15 Minuten angefordert), `502 send_failed`. Das Ergebnis steht zusätzlich im Container-Log (`[portal-password]`).
2. METAorder prüft im Shop: Kunde mit dieser Kundennummer, Mitarbeiter mit dieser E-Mail, aktive Verknüpfung. Ausgeschlossen sind META-eigene Adressen und Vertriebszugänge.
3. Bei einem Treffer ruft METAorder die Store-API von B2Bsellers auf (`POST /store-api/b2b/employee/recovery-password`, `sw-access-key` des Kanals, an den der Mitarbeiter gebunden ist – beim Händlerportal „META Händler Portal DE“).
4. B2Bsellers setzt einen Wiederherstellungs-Hash und löst den Shopware-Flow `b2b.employee.recovery.request` aus. Der Flow verschickt die Vorlage „Mitarbeiter Passwort Wiederherstellung“ mit dem Link `<Portal>/employee/recover/password?hash=…` (2 Stunden gültig).
5. Der Händler legt sein Passwort über den Link selbst fest. Bis dahin bleibt das bisherige Passwort gültig.

## Unterschied zu „Passwort vergessen“ im Portal

`https://portal.meta-online.com/account/recover` verschickt dieselbe Mail, verlangt aber nur die E-Mail. `/portal-zugang` prüft zusätzlich die Kundennummer, schließt META-eigene Zugänge aus und begrenzt die Anfragen (5 je IP und 1 je Zugang in 15 Minuten).

## Ergebnisse im Log

| `outcome` | Bedeutung |
| --- | --- |
| `sent` | Shopware hat die Anfrage angenommen und verschickt die Mail |
| `customer_not_found` / `employee_not_found` / `not_linked` | Kundennummer und E-Mail passen nicht zu einem Portalzugang |
| `link_inactive` | Zugang ist deaktiviert |
| `excluded` | META-eigene Adresse oder Vertriebszugang |
| `no_sales_channel` | Weder Mitarbeiter noch Kunde haben einen Verkaufskanal |
| `mail_failed` | Shopware hat die Anfrage abgelehnt (Fehlertext im Log) |

## Einstellungen in Shopware

- Flow „x- Employee requests new password“ (Ereignis `b2b.employee.recovery.request`) muss aktiv sein.
- Inhalt und Absender der Mail pflegt ihr in Shopware unter Einstellungen → E-Mail-Vorlagen („Mitarbeiter Passwort Wiederherstellung“).
- Shopware speichert verschickte Mails im Ereignisprotokoll – dort steht nur der zeitlich begrenzte Link, kein Passwort.

## Umgebungsvariablen

- `B2B_PORTAL_PASSWORD_TENANT` – Mandant, dessen Shop genutzt wird (Standard `Live`)
- `B2B_PORTAL_LOGIN_URL` – Portal-Adresse für den Link in der Mail (Standard `https://portal.meta-online.com`)
