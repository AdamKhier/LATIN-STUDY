#!/usr/bin/env bash
# Snapshot the synced progress store so a dead SD card cannot wipe it.
#
#   ./scripts/backup-sync.sh                      # app dir is the parent of this script
#   APP_DIR=/srv/pronomen KEEP=60 ./scripts/backup-sync.sh
#
# Writes ~/backups/pronomen/sync-<UTC stamp>.tar.gz, repoints latest.tar.gz at
# the newest archive, and deletes archives older than KEEP days. Every archive is
# verified before it counts, so a truncated file fails the run instead of quietly
# sitting there looking like a backup.
set -euo pipefail

HOME="${HOME:-/home/adam}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEST="${DEST:-$HOME/backups/pronomen}"
KEEP="${KEEP:-30}"
SRC="$APP_DIR/.sync"

if [ ! -d "$SRC" ]; then
  echo "No sync store at $SRC — nothing to back up." >&2
  exit 1
fi

mkdir -p "$DEST"
out="$DEST/sync-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"

tar -czf "$out" -C "$APP_DIR" .sync
gzip -t "$out"              # catches a truncated archive
tar -tzf "$out" >/dev/null  # catches a corrupt one

ln -sfn "$(basename "$out")" "$DEST/latest.tar.gz"
find "$DEST" -maxdepth 1 -name 'sync-*.tar.gz' -type f -mtime +"$KEEP" -delete

records=$(tar -tzf "$out" | grep -c '\.json$' || true)
printf '%s wrote %s (%s bytes, %s record file(s))\n' \
  "$(date -Is)" "$out" "$(stat -c %s "$out")" "$records"
