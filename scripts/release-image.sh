#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Nutzung:
  scripts/release-image.sh <image-repository> [tag]

Beispiele:
  scripts/release-image.sh ghcr.io/meta-regalbau/metaorder-v2
  scripts/release-image.sh ghcr.io/meta-regalbau/metaorder-v2 2026-05-02-abc1234

Optionale Umgebungsvariablen:
  TARGET_PLATFORM   Default: linux/amd64
  PUSH_LATEST       true|false, Default: true
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 1
fi

IMAGE_REPO="$1"
TAG="${2:-$(date +%Y%m%d)-$(git rev-parse --short HEAD)}"
TARGET_PLATFORM="${TARGET_PLATFORM:-linux/amd64}"
PUSH_LATEST="${PUSH_LATEST:-true}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"

echo "==> Baue Image ${IMAGE_REPO}:${TAG} fuer ${TARGET_PLATFORM}"
docker build --platform "$TARGET_PLATFORM" -t "${IMAGE_REPO}:${TAG}" .

echo "==> Push ${IMAGE_REPO}:${TAG}"
docker push "${IMAGE_REPO}:${TAG}"

if [[ "$PUSH_LATEST" == "true" ]]; then
  echo "==> Aktualisiere ${IMAGE_REPO}:latest"
  docker tag "${IMAGE_REPO}:${TAG}" "${IMAGE_REPO}:latest"
  docker push "${IMAGE_REPO}:latest"
fi

echo "==> Fertig"
echo "Tag: ${TAG}"
