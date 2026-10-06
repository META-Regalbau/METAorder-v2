# Händlerportal-Passwort: Mailversand über n8n

Die öffentliche Seite `/portal-zugang` verschickt das neue Händlerportal-Passwort. METAorder bindet M365 nicht direkt an; die Mail geht deshalb über einen n8n-Webhook, und n8n verschickt sie mit seinem Outlook-Konto.

## Ablauf

1. Händler gibt Kundennummer und E-Mail ein (`POST /api/public/portal-password-request`).
2. Passen beide zu einem aktiven Portal-Mitarbeiter, prüft METAorder zuerst, ob ein Versandweg eingerichtet ist. Ohne Versandweg bleibt das Passwort unverändert (Log: `mail_disabled`).
3. METAorder setzt das neue Passwort und schickt die fertige Mail (Betreff, Text, HTML) an den Webhook **„Händlerportal: Passwort angefordert“** (`b2b.portal_password_requested`).
4. n8n prüft den API-Key (Header `X-API-Key`), verschickt die Mail über Outlook und antwortet mit 200.
5. Antwortet n8n nicht mit 2xx, steht im Log `mail_failed`, Details unter *Webhook-Logs*.

Ist der Webhook nicht aktiv, nutzt METAorder den Mailversand aus den E-Mail-Einstellungen des Mandanten (falls eingerichtet).

## Einrichtung

**n8n**

1. Workflow `n8n-workflows/metaorder-portal-password-mail.json` importieren.
2. Im Webhook-Knoten eine Credential vom Typ *Header Auth* anlegen: Name `X-API-Key`, Wert = langer Zufallswert (z. B. `openssl rand -hex 32`).
3. Im Knoten „Outlook Mail senden“ die vorhandene Outlook-Credential auswählen. Absender ist das Postfach dieser Credential.
4. Workflow aktivieren und die **Production-URL** des Webhooks kopieren.

**METAorder** (Mandant „Live“, Einstellungen → Webhooks)

1. Eintrag „Händlerportal: Passwort angefordert (Mail über n8n)“: URL = Production-URL aus n8n, API-Key = Wert aus der Header-Auth-Credential, aktivieren, speichern.
2. „Test“ drücken: Der Testaufruf trägt `metadata.test = true`, n8n antwortet dann ohne Mail zu verschicken.

## Datenschutz

- Die Mail enthält das Passwort im Klartext. METAorder speichert im Webhook-Log nur Ereignis und Zeitpunkt, nicht den Inhalt.
- Der Workflow speichert erfolgreiche Ausführungen nicht (`saveDataSuccessExecution: none`). Fehlgeschlagene Ausführungen enthalten die Daten und sollten nach der Fehlersuche gelöscht werden.

## Umgebungsvariablen

- `B2B_PORTAL_PASSWORD_TENANT` – Mandant für Shop, Webhook und Mailversand (Standard `Live`)
- `B2B_PORTAL_LOGIN_URL` – Portal-Link in der Mail (Standard `https://portal.meta-online.com`)
