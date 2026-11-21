#!/usr/bin/env bash
# Kast backup — consistent SQLite snapshot + config, with daily/weekly rotation.
#
# Backs up:
#   kast.db     mounts, playlists, schedules, users, API keys (from kast_data volume)
#   kast.toml   generated config incl. api_key / jwt_secret (from kast_config volume)
#   optional:   ./data/music mirrored with rsync (INCLUDE_MUSIC=true)
#
# Usage (on the VPS, from cron):
#   0 3 * * * KAST_DIR=/opt/kast /opt/kast/scripts/backup.sh >> /var/log/kast-backup.log 2>&1
#
# Env:
#   KAST_DIR       dir containing docker-compose.prod.yml  (default: script's parent dir)
#   BACKUP_DIR     where archives go                        (default: /var/backups/kast)
#   KEEP_DAILY     daily archives to keep                   (default: 7)
#   KEEP_WEEKLY    weekly archives to keep (Sundays)        (default: 4)
#   INCLUDE_MUSIC  also rsync ./data/music                  (default: false)
set -euo pipefail

KAST_DIR="${KAST_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/kast}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
INCLUDE_MUSIC="${INCLUDE_MUSIC:-false}"

cd "$KAST_DIR"
CID="$(docker compose -f docker-compose.prod.yml ps -q server)"
if [ -z "$CID" ]; then
  echo "$(date -Is) ERROR: kast server container is not running" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

# Snapshot in a throwaway container that shares the server's volumes.
# VACUUM INTO is safe while the server is writing (WAL mode) and produces a
# compact, self-contained .db file with no -wal/-shm sidecars.
docker run --rm -i --volumes-from "$CID" -v "$WORK:/backup" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" alpine:3.20 sh -es <<'EOF'
apk add --no-cache -q sqlite >/dev/null
sqlite3 /app/data/kast.db "VACUUM INTO '/backup/kast.db'"
result="$(sqlite3 /backup/kast.db 'PRAGMA integrity_check')"
[ "$result" = "ok" ] || { echo "integrity_check failed: $result" >&2; exit 1; }
cp /app/config/kast.toml /backup/kast.toml 2>/dev/null || true
chown -R "$HOST_UID:$HOST_GID" /backup
EOF

ARCHIVE="$BACKUP_DIR/daily/kast-$STAMP.tar.gz"
tar -C "$WORK" -czf "$ARCHIVE" .
chmod 600 "$ARCHIVE"   # contains api_key / jwt_secret / password hashes
echo "$(date -Is) created $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Sunday → keep a weekly copy too.
if [ "$(date +%u)" = "7" ]; then
  cp "$ARCHIVE" "$BACKUP_DIR/weekly/"
fi

# Rotation: keep newest N in each tier.
prune() { ls -1t "$1"/kast-*.tar.gz 2>/dev/null | tail -n +"$(( $2 + 1 ))" | xargs -r rm -f --; }
prune "$BACKUP_DIR/daily"  "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

# Music is large and rarely changes — mirror it instead of archiving per run.
if [ "$INCLUDE_MUSIC" = "true" ] && [ -d "$KAST_DIR/data/music" ]; then
  rsync -a --delete "$KAST_DIR/data/music/" "$BACKUP_DIR/music/"
  echo "$(date -Is) music mirrored to $BACKUP_DIR/music"
fi
