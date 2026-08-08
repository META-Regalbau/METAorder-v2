# Lokale HTTPS-Tests am Handgerät (Kamera/Barcode-Scanner)

Der Barcode- und QR-Scanner (Mobile Picking, Bestand buchen, Inventur) nutzt `getUserMedia`.
Browser geben die Kamera nur in einem **secure context** frei: `localhost` gilt als sicher,
eine LAN-Adresse wie `http://192.168.2.208:5001` nicht. Am iPhone bleibt die Kamera deshalb
ohne HTTPS stumm — ohne Fehlermeldung, die das erklärt.

Dafür liegt ein Caddy-Reverse-Proxy im Stack, der TLS terminiert und an die App weiterleitet.
Er startet nur mit dem Compose-Profil `https`, `docker compose up` bleibt also unverändert.

## Einrichtung (einmalig)

```bash
brew install mkcert                 # falls noch nicht vorhanden
./scripts/local-https-certs.sh      # Zertifikat für die eigene LAN-IP erzeugen
docker compose --profile https up -d proxy
```

Das Skript ermittelt die LAN-IP selbst (`en0`/`en1`) und nimmt sie zusammen mit `localhost`,
`127.0.0.1` und dem Rechnernamen als SubjectAltName auf. iOS ignoriert den Common Name, ohne
SAN wäre das Zertifikat also wertlos.

Ohne mkcert erzeugt das Skript ein selbstsigniertes Zertifikat mit openssl. Das funktioniert,
Safari zeigt aber eine Warnung — und **iOS gibt die Kamera auf einer Domain mit manuell
akzeptiertem Zertifikat nicht zuverlässig frei**. Für den Scanner ist der mkcert-Weg deshalb
der belastbare.

## iPhone vorbereiten (einmalig)

1. `deploy/local-https/certs/rootCA.pem` auf das iPhone bringen (AirDrop oder E-Mail an sich
   selbst).
2. **Einstellungen → Allgemein → VPN & Geräteverwaltung** → Profil installieren.
3. **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen** → den
   mkcert-Root aktivieren.

Schritt 3 wird oft vergessen. Ohne ihn ist das Profil installiert, aber nicht vertraut, und
Safari zeigt weiter eine Warnung.

## Aufruf

| Zweck | Adresse |
| --- | --- |
| Desktop am Mac | `http://localhost:5001` |
| Handgerät im WLAN | `https://<LAN-IP>:5443` |
| Bestand buchen | `https://<LAN-IP>:5443/mobile/stock` |
| Picking | `https://<LAN-IP>:5443/mobile/picking` |

Mac und iPhone müssen im selben WLAN sein. Anderer Port: `HTTPS_PORT=8443 docker compose
--profile https up -d proxy`.

## Hinweise

- **Neue LAN-IP** (anderes WLAN, neuer DHCP-Lease): Skript erneut ausführen und den Proxy
  neu starten. Das Zertifikat gilt nur für die IPs, die beim Erzeugen bekannt waren.
- **Zertifikate liegen nicht im Repo** (`.gitignore`), sie sind maschinenspezifisch.
- **Session-Cookies**: `server/index.ts` hat `trust proxy` aktiv und die Session nutzt
  `secure: 'auto'`. Caddy setzt `X-Forwarded-Proto: https`, die Cookies werden hinter dem
  Proxy also korrekt als `Secure` markiert.
- **HTTP/3** ist aktiv, TCP und UDP auf 5443 sind beide freigegeben. Fehlte UDP, würde das
  iPhone die per `Alt-Svc` angekündigte h3-Verbindung erst nach einem Timeout aufgeben.
- **Nur für lokale Tests.** Echte Deployments terminieren TLS am Mittwald-Ingress, siehe
  [mittwald-deployment.md](mittwald-deployment.md).
