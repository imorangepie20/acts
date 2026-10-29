#!/usr/bin/env bash
# Daily backup into backups/, keep 30 days: Postgres (custom-format dump) and the evidence
# uploads in the Docker volume acts_uploads (tar.gz).
umask 077
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
out="backups/acts-$(date +%F-%H%M).dump"
docker compose exec -T db pg_dump -U acts -Fc acts > "$out" || { rm -f "$out"; echo "pg_dump failed" >&2; exit 1; }
[ -s "$out" ] || { echo "backup is empty: $out" >&2; rm -f "$out"; exit 1; }
uploads="backups/uploads-$(date +%F).tgz"
docker run --rm -v acts_uploads:/u -v "$PWD/backups":/b alpine tar czf "/b/$(basename "$uploads")" -C /u . || { rm -f "$uploads"; echo "uploads backup failed" >&2; exit 1; }
find backups -name 'acts-*.dump' -mtime +30 -delete
find backups -name 'uploads-*.tgz' -mtime +30 -delete
echo "$out"
echo "$uploads"
