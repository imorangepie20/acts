#!/usr/bin/env bash
# Daily Postgres backup: custom-format dump into backups/, keep 30 days.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
out="backups/acts-$(date +%F-%H%M).dump"
docker compose exec -T db pg_dump -U acts -Fc acts > "$out"
[ -s "$out" ] || { echo "backup is empty: $out" >&2; rm -f "$out"; exit 1; }
find backups -name 'acts-*.dump' -mtime +30 -delete
echo "$out"
