#!/usr/bin/env bash
# Daily backup into backups/: Postgres (custom-format dump, kept 30 days) and the evidence
# uploads in the Docker volume acts_uploads (tar.gz, newest 7 kept; each is a full copy).
umask 077
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
out="backups/acts-$(date +%F-%H%M).dump"
docker compose exec -T db pg_dump -U acts -Fc acts > "$out" || { rm -f "$out"; echo "pg_dump failed" >&2; exit 1; }
[ -s "$out" ] || { echo "backup is empty: $out" >&2; rm -f "$out"; exit 1; }
uploads="backups/uploads-$(date +%F-%H%M).tgz"
docker run --rm -v acts_uploads:/u -v "$PWD/backups":/b alpine tar czf "/b/$(basename "$uploads")" -C /u . || { rm -f "$uploads"; echo "uploads backup failed" >&2; exit 1; }
find backups -name 'acts-*.dump' -mtime +30 -delete
ls -1t backups/uploads-*.tgz 2>/dev/null | tail -n +8 | xargs -r rm -f --
echo "$out"
echo "$uploads"
df -h backups
