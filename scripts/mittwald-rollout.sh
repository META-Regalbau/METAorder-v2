#!/usr/bin/env bash
# Manuelles Deploy: bevorzugt GitHub Actions (mittwald/deploy-container-action).
# Dieses Skript aktualisiert nur das Container-Image per mw CLI (Legacy).
set -euo pipefail

usage() {
  cat <<'EOF'
Nutzung:
  scripts/mittwald-rollout.sh <image-reference>

Beispiel:
  scripts/mittwald-rollout.sh ghcr.io/about-design/metaorder-v2:abc1234

Rollt ein neues Container-Image auf Mittwald mStudio aus (mw CLI).

Optionale Umgebungsvariablen:
  MITTWALD_API_TOKEN     API-Token (alternativ: mw login)
  MITTWALD_PROJECT_ID    Projekt-ID oder Short-ID
  MITTWALD_CONTAINER_ID  Container-ID oder Short-ID
  PREVIOUS_IMAGE         Image fuer Rollback bei fehlgeschlagenem Healthcheck
  HEALTHCHECK_URL        z. B. https://metaorder.example.de/healthz
  HEALTHCHECK_TRIES      Default: 20
  HEALTHCHECK_DELAY      Default: 3 (Sekunden)
  SKIP_ROLLBACK          true|false, Default: false
  MW_BIN                 Default: mw
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
MW_BIN="${MW_BIN:-mw}"
PROJECT_ID="${MITTWALD_PROJECT_ID:-}"
CONTAINER_ID="${MITTWALD_CONTAINER_ID:-}"
HEALTHCHECK_TRIES="${HEALTHCHECK_TRIES:-20}"
HEALTHCHECK_DELAY="${HEALTHCHECK_DELAY:-3}"
SKIP_ROLLBACK="${SKIP_ROLLBACK:-false}"
PREVIOUS_IMAGE="${PREVIOUS_IMAGE:-}"

if [[ -z "$PROJECT_ID" || -z "$CONTAINER_ID" ]]; then
  echo "MITTWALD_PROJECT_ID und MITTWALD_CONTAINER_ID muessen gesetzt sein." >&2
  exit 1
fi

if ! command -v "$MW_BIN" >/dev/null 2>&1; then
  echo "mw CLI nicht gefunden. Installiere: https://developer.mittwald.de/docs/v2/cli/" >&2
  exit 1
fi

mw_args=(--project-id "$PROJECT_ID")

echo "==> Rollout starte mit $TARGET_IMAGE"
"$MW_BIN" container update \
  --image "$TARGET_IMAGE" \
  --recreate \
  "${mw_args[@]}" \
  "$CONTAINER_ID"

if [[ -z "${HEALTHCHECK_URL:-}" ]]; then
  echo "==> Kein HEALTHCHECK_URL gesetzt — Container-Recreate abgeschlossen."
  exit 0
fi

echo "==> Pruefe ${HEALTHCHECK_URL}"
for attempt in $(seq 1 "$HEALTHCHECK_TRIES"); do
  if curl -fsS "$HEALTHCHECK_URL" >/dev/null; then
    echo "==> Rollout erfolgreich (Versuch ${attempt}/${HEALTHCHECK_TRIES})"
    exit 0
  fi
  sleep "$HEALTHCHECK_DELAY"
done

echo "==> Healthcheck fehlgeschlagen."
if [[ "$SKIP_ROLLBACK" == "true" || -z "$PREVIOUS_IMAGE" ]]; then
  echo "Setze PREVIOUS_IMAGE fuer automatischen Rollback oder fuehre manuell erneut aus." >&2
  exit 1
fi

echo "==> Rollback auf $PREVIOUS_IMAGE"
"$MW_BIN" container update \
  --image "$PREVIOUS_IMAGE" \
  --recreate \
  "${mw_args[@]}" \
  "$CONTAINER_ID"

exit 1
