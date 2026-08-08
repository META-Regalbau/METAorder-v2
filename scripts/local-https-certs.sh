#!/usr/bin/env bash
#
# Erzeugt ein TLS-Zertifikat für den lokalen HTTPS-Proxy (deploy/local-https).
#
# Warum überhaupt HTTPS lokal: Safari/Chrome geben getUserMedia (Kamera → Barcode-Scanner)
# nur in einem "secure context" frei. localhost gilt als sicher, eine LAN-IP wie
# http://192.168.2.208:5001 nicht — am iPhone bleibt die Kamera deshalb ohne HTTPS stumm.
#
# Zwei Wege:
#   mkcert  → lokal vertrauenswürdige CA, am iPhone einmal das Root-Profil installieren,
#             danach keine Warnungen. Empfohlen.
#   openssl → selbstsigniert, Safari zeigt eine Warnung, die man bestätigen muss.
#
# Aufruf:  ./scripts/local-https-certs.sh [weitere-hosts...]
# Die LAN-IP wird automatisch ermittelt und immer mit aufgenommen.

set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy/local-https/certs"
mkdir -p "$CERT_DIR"

# LAN-IP des Macs — darüber erreicht das iPhone den Rechner.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then
  echo "Keine LAN-IP gefunden (en0/en1). Bitte als Argument übergeben:" >&2
  echo "  ./scripts/local-https-certs.sh 192.168.x.y" >&2
  exit 1
fi

HOSTS=("$LAN_IP" "localhost" "127.0.0.1" "$(hostname)" "$(hostname -s).local" "$@")

# Duplikate entfernen, Leereinträge verwerfen
UNIQUE_HOSTS=()
for h in "${HOSTS[@]}"; do
  [ -z "$h" ] && continue
  skip=""
  for u in ${UNIQUE_HOSTS[@]+"${UNIQUE_HOSTS[@]}"}; do
    [ "$u" = "$h" ] && skip=1 && break
  done
  [ -z "$skip" ] && UNIQUE_HOSTS+=("$h")
done

echo "Zertifikat für: ${UNIQUE_HOSTS[*]}"
echo "Ablage: $CERT_DIR"
echo

if command -v mkcert >/dev/null 2>&1; then
  echo "→ mkcert gefunden (lokal vertrauenswürdige CA)"
  # Absichtlich ohne `mkcert -install`: das würde die CA in den System-Keychain des Macs
  # legen und dafür das Admin-Passwort verlangen. Für das iPhone genügt rootCA.pem als
  # Profil. Wer auch am Mac warnungsfrei testen will, führt `mkcert -install` selbst aus.
  mkcert -cert-file "$CERT_DIR/cert.pem" -key-file "$CERT_DIR/key.pem" "${UNIQUE_HOSTS[@]}"
  CA_ROOT="$(mkcert -CAROOT)"
  cp "$CA_ROOT/rootCA.pem" "$CERT_DIR/rootCA.pem"
  echo
  echo "Fertig. Am iPhone einmalig einrichten:"
  echo "  1. rootCA.pem auf das iPhone bringen (AirDrop / E-Mail an sich selbst):"
  echo "     $CERT_DIR/rootCA.pem"
  echo "  2. Einstellungen → Allgemein → VPN & Geräteverwaltung → Profil installieren"
  echo "  3. Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen →"
  echo "     mkcert-Root aktivieren (voller Vertrauensstatus)"
  echo
  echo "Danach https://$LAN_IP:5443 ohne Warnung, Kamera funktioniert."
  echo "Optional für den Mac selbst: mkcert -install (fragt das Admin-Passwort)"
else
  echo "→ mkcert nicht installiert, erzeuge selbstsigniertes Zertifikat mit openssl."
  echo "  Für einen warnungsfreien Zugang stattdessen: brew install mkcert && $0"
  echo

  SAN=""
  for h in "${UNIQUE_HOSTS[@]}"; do
    if [[ "$h" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      SAN="${SAN}IP:${h},"
    else
      SAN="${SAN}DNS:${h},"
    fi
  done
  SAN="${SAN%,}"

  # iOS verlangt SubjectAltName (CN allein wird ignoriert), serverAuth als
  # extendedKeyUsage und höchstens 825 Tage Laufzeit.
  openssl req -x509 -newkey rsa:2048 -sha256 -days 800 -nodes \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -subj "/CN=METAorder lokal ($LAN_IP)" \
    -addext "subjectAltName=$SAN" \
    -addext "extendedKeyUsage=serverAuth" \
    -addext "basicConstraints=critical,CA:FALSE"

  echo
  echo "Fertig. Am iPhone https://$LAN_IP:5443 öffnen und die Zertifikatswarnung"
  echo "bestätigen (Details → Website besuchen)."
fi

chmod 600 "$CERT_DIR/key.pem"
echo
echo "Proxy starten:  docker compose --profile https up -d proxy"
