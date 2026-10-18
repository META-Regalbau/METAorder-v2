#!/bin/sh
# ZIP für die Installation (Ordner MetaCartSignal mit composer.json, src, README); ohne Tests und vendor/
set -e
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' MetaCartSignal/composer.json | head -1)
OUT="../../dist/MetaCartSignal-$VERSION.zip"
mkdir -p ../../dist
rm -f "$OUT"
zip -q -r -X "$OUT" MetaCartSignal/composer.json MetaCartSignal/README.md MetaCartSignal/src
echo "$OUT"
