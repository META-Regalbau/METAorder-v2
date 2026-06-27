#!/usr/bin/env bash
# Einmal-Setup: DATABASE_URL in GitHub + Deploy ausloesen.
# DB-Init laeuft danach automatisch beim Container-Start (container-db-init).
#
# Voraussetzungen:
#   gh auth login   (einmalig)
#   Brew/npm: optional mw fuer manuellen Fallback
#
# Usage:
#   ./scripts/mittwald-one-shot-setup.sh
#   ./scripts/mittwald-one-shot-setup.sh --exec-on-container   # zusaetzlich mw exec (falls mw installiert)

set -euo pipefail

REPO="META-Regalbau/METAorder-v2"
DB_USER="${DB_USER:-oliver-steiling}"
DB_NAME="${DB_NAME:-MetaPGDB}"
DB_HOST="${DB_HOST:-postgresql}"
DB_PORT="${DB_PORT:-5432}"
APP_CONTAINER="${APP_CONTAINER:-metaorder-app}"

urlencode() {
  python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI fehlt. Installieren: brew install gh && gh auth login" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Bitte zuerst: gh auth login" >&2
  exit 1
fi

echo "=== METAorder Mittwald Einmal-Setup ==="
echo "Repo: $REPO"
echo "DB:   postgresql://${DB_USER}:****@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo ""
echo "Passwort fuer PostgreSQL-User '${DB_USER}' (Eingabe verborgen):"
read -rs DB_PASS
echo ""

if [[ -z "${DB_PASS}" ]]; then
  echo "Leeres Passwort abgebrochen." >&2
  exit 1
fi

ENC_PASS="$(urlencode "${DB_PASS}")"
DATABASE_URL="postgresql://${DB_USER}:${ENC_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

echo "Setze GitHub Secret DATABASE_URL ..."
gh secret set DATABASE_URL --repo "${REPO}" --body "${DATABASE_URL}"

echo "Starte Deploy-Workflow (main) ..."
gh workflow run deploy-mittwald.yml --repo "${REPO}" --ref main

echo ""
echo "Deploy gestartet. DB-Init laeuft beim Container-Start automatisch."
echo "Logs: https://github.com/${REPO}/actions"
echo ""
echo "Nach erfolgreichem Deploy: https://p-bbpye5.project.space/healthz (oder eure Domain)"
echo ""
echo "Passwort danach in PostgreSQL rotieren und Secret erneut setzen."

if [[ "${1:-}" == "--exec-on-container" ]]; then
  if ! command -v mw >/dev/null 2>&1; then
    echo "mw CLI nicht gefunden — Container-Exec uebersprungen." >&2
    echo "Install: https://developer.mittwald.de/docs/v2/cli/usage/intro/" >&2
    exit 0
  fi
  echo "Warte 90s auf Deploy, dann manueller Init-Fallback ..."
  sleep 90
  mw container exec "${APP_CONTAINER}" /app/scripts/mittwald-db-init.sh
fi
