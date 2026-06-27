#!/bin/bash
echo "=== Watching app logs for offer-related errors ==="
echo "=== Please open the Offers page in your browser now ==="
echo ""
docker compose logs app --tail=0 --follow | grep --line-buffered -i -A 10 -B 2 "offer\|error\|Error\|failed\|Failed"
