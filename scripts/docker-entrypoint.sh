#!/bin/sh
set -e
cd /app

# Muss mit UPLOADS_DIR / Node uploadsRoot.ts übereinstimmen (Compose: Volume auf /app/uploads)
UPLOADS="${UPLOADS_DIR:-/app/uploads}"
mkdir -p \
  "$UPLOADS/installment-agreements" \
  "$UPLOADS/dunning" \
  "$UPLOADS/ticket-attachments" \
  "$UPLOADS/order-drafts" \
  "$UPLOADS/offer-drafts" \
  "$UPLOADS/commercial-agent-incoming" \
  2>/dev/null || true

if [ -n "$DATABASE_URL" ]; then
  echo "[docker-entrypoint] Database init (pgvector, schema, SQL migrations)..."
  node scripts/container-db-init.mjs
else
  echo "[docker-entrypoint] DATABASE_URL not set, skipping database init"
fi

exec node dist/index.js
