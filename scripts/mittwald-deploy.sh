#!/usr/bin/env bash
# DEPRECATED: Nutze scripts/mittwald-rollout.sh fuer Mittwald mStudio (mw CLI).
# Dieses Skript setzt docker compose auf einem SSH-Host voraus und ist nicht
# mit mStudio Container-Hosting kompatibel.
set -euo pipefail

usage() {
  cat <<'EOF'
DEPRECATED — bitte scripts/mittwald-rollout.sh verwenden.

Nutzung:
  scripts/mittwald-deploy.sh <image-reference>

Beispiel:
  scripts/mittwald-deploy.sh docker.io/acme/metaorder-v2:20260502-a1b2c3d

Optionale Umgebungsvariablen:
  STACK_DIR       Default: aktuelles Verzeichnis
  COMPOSE_FILE    Default: ${STACK_DIR}/docker-compose.mittwald.yml
  ENV_FILE        Default: ${STACK_DIR}/app.env
  SERVICE_NAME    Default: metaorder-app
  HEALTHCHECK_TRIES   Default: 20
  HEALTHCHECK_DELAY   Default: 3 (Sekunden)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

TARGET_IMAGE="$1"
STACK_DIR="${STACK_DIR:-$(pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-${STACK_DIR}/docker-compose.mittwald.yml}"
ENV_FILE="${ENV_FILE:-${STACK_DIR}/app.env}"
SERVICE_NAME="${SERVICE_NAME:-metaorder-app}"
HEALTHCHECK_TRIES="${HEALTHCHECK_TRIES:-20}"
HEALTHCHECK_DELAY="${HEALTHCHECK_DELAY:-3}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose-Datei nicht gefunden: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env-Datei nicht gefunden: $ENV_FILE" >&2
  exit 1
fi

cd "$STACK_DIR"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

PREVIOUS_IMAGE=""
if CONTAINER_ID="$(compose ps -q "$SERVICE_NAME" 2>/dev/null)" && [[ -n "$CONTAINER_ID" ]]; then
  PREVIOUS_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER_ID" 2>/dev/null || true)"
fi

echo "==> Deployment starte mit $TARGET_IMAGE"

APP_IMAGE="$TARGET_IMAGE" compose pull "$SERVICE_NAME"
APP_IMAGE="$TARGET_IMAGE" compose up -d --remove-orphans "$SERVICE_NAME"

echo "==> Pruefe Healthcheck /healthz"
for attempt in $(seq 1 "$HEALTHCHECK_TRIES"); do
  if compose exec -T "$SERVICE_NAME" node -e "const http=require('http');const req=http.get('http://127.0.0.1:5000/healthz',(res)=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));"; then
    echo "==> Deployment erfolgreich (Versuch ${attempt}/${HEALTHCHECK_TRIES})"
    exit 0
  fi
  sleep "$HEALTHCHECK_DELAY"
done

echo "==> Healthcheck fehlgeschlagen."
if [[ -n "$PREVIOUS_IMAGE" ]]; then
  echo "==> Rollback auf vorheriges Image: $PREVIOUS_IMAGE"
  APP_IMAGE="$PREVIOUS_IMAGE" compose up -d "$SERVICE_NAME"
fi

exit 1
