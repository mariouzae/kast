#!/usr/bin/env bash
# Kast restore — replace kast.db (and kast.toml if present) from a backup archive.
#
# Usage: scripts/restore.sh /var/backups/kast/daily/kast-20261121-030000.tar.gz
#
# The current database is kept as kast.db.pre-restore-<timestamp> inside the volume.
set -euo pipefail

ARCHIVE="${1:?usage: restore.sh <backup.tar.gz>}"
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
KAST_DIR="${KAST_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$KAST_DIR"
COMPOSE="docker compose -f docker-compose.prod.yml"

# Make sure the container exists (creates volumes on a fresh VPS), then stop it.
$COMPOSE up -d --no-start server
CID="$($COMPOSE ps -aq server)"
$COMPOSE stop server

docker run --rm -i --volumes-from "$CID" -v "$ARCHIVE:/restore.tar.gz:ro" \
  alpine:3.20 sh -es <<'EOF'
mkdir -p /tmp/r && tar -xzf /restore.tar.gz -C /tmp/r
[ -f /tmp/r/kast.db ] || { echo "archive has no kast.db" >&2; exit 1; }
ts="$(date +%Y%m%d-%H%M%S)"
[ -f /app/data/kast.db ] && mv /app/data/kast.db "/app/data/kast.db.pre-restore-$ts"
rm -f /app/data/kast.db-wal /app/data/kast.db-shm
cp /tmp/r/kast.db /app/data/kast.db
[ -f /tmp/r/kast.toml ] && cp /tmp/r/kast.toml /app/config/kast.toml
echo "restored kast.db$( [ -f /tmp/r/kast.toml ] && echo ' + kast.toml')"
EOF

$COMPOSE start server   # entrypoint re-applies ownership/permissions
echo "done — check: $COMPOSE logs -f server"
