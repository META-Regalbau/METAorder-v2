#!/bin/sh
# Einmalige DB-Initialisierung im laufenden Mittwald-Container:
#   mw container exec metaorder-app /app/scripts/mittwald-db-init.sh
set -e
cd /app
exec node scripts/container-db-init.mjs
