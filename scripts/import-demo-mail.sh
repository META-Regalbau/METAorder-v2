#!/usr/bin/env bash
# Importiert eine Demo-.eml wie der n8n-Workflow (POST /api/commercial-drafts/upload).
#
# Usage:
#   export METAORDER_INTEGRATION_KEY="..."
#   ./scripts/import-demo-mail.sh demo-mails/01-demo-komplett.eml
#
# Optional:
#   METAORDER_BASE_URL=http://localhost:5001
#   INTENT_HINT=offer|order|unclear  (Default: aus Dateiname/Subject erraten)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

EML_FILE="${1:-}"
if [[ -z "$EML_FILE" || ! -f "$EML_FILE" ]]; then
  echo "Usage: $0 <path-to.eml>" >&2
  exit 1
fi

if [[ "$EML_FILE" != /* ]]; then
  EML_FILE="$ROOT_DIR/$EML_FILE"
fi

BASE_URL="${METAORDER_BASE_URL:-http://localhost:5001}"
KEY="${METAORDER_INTEGRATION_KEY:-}"

if [[ -z "$KEY" ]]; then
  if [[ -f "$ROOT_DIR/docker.env" ]]; then
    KEY="$(grep -E '^METAORDER_INTEGRATION_API_KEY=' "$ROOT_DIR/docker.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  fi
fi

if [[ -z "$KEY" ]]; then
  echo "METAORDER_INTEGRATION_KEY fehlt (Env oder docker.env)." >&2
  exit 1
fi

SUBJECT="$(grep -m1 '^Subject:' "$EML_FILE" | sed 's/^Subject:[[:space:]]*//' || true)"
BODY_PREVIEW="$(awk 'BEGIN{p=0} /^$/ {p=1; next} p==1 {print; if(NR>40) exit}' "$EML_FILE" | head -c 500)"

INTENT_HINT="${INTENT_HINT:-unclear}"
COMBINED="$(printf '%s\n%s' "$SUBJECT" "$BODY_PREVIEW" | tr '[:upper:]' '[:lower:]')"
if echo "$COMBINED" | grep -qE 'bestell|bestellung|purchase order|auftrag'; then
  INTENT_HINT="order"
elif echo "$COMBINED" | grep -qE 'angebot|preisanfrage|quote|rfq|kostenvoranschlag'; then
  INTENT_HINT="offer"
fi

echo "→ Upload: $(basename "$EML_FILE")"
echo "  URL: $BASE_URL/api/commercial-drafts/upload"
echo "  intentHint: $INTENT_HINT"
echo "  subject: ${SUBJECT:-—}"

HTTP_CODE="$(curl -sS -w '%{http_code}' -o /tmp/metaorder-demo-upload.json \
  -X POST "$BASE_URL/api/commercial-drafts/upload" \
  -H "X-METAORDER-Integration-Key: $KEY" \
  -F "file=@$EML_FILE;type=message/rfc822" \
  -F "subject=$SUBJECT" \
  -F "body=$BODY_PREVIEW" \
  -F "intentHint=$INTENT_HINT")"

echo "  HTTP: $HTTP_CODE"
if command -v jq >/dev/null 2>&1; then
  jq '{draftKind, draftId: .draft.id, status: .draft.status, overallConfidence: .draft.matchingResults.overallConfidence}' /tmp/metaorder-demo-upload.json 2>/dev/null || cat /tmp/metaorder-demo-upload.json
else
  cat /tmp/metaorder-demo-upload.json
fi

if [[ "$HTTP_CODE" -ge 400 ]]; then
  exit 1
fi
