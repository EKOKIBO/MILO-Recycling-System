#!/usr/bin/env bash
# =============================================================================
#  milo-backup — database snapshots, rotation and restore
#
#    milo-backup                    take a snapshot now
#    milo-backup --rotate           snapshot + prune old ones (daily timer)
#    milo-backup --tag NAME         snapshot with a label in the filename
#    milo-backup --list             list available snapshots
#    milo-backup --restore FILE     restore a specific snapshot
#    milo-backup --restore-latest   restore the newest snapshot
#    milo-backup --export DEST      copy the newest snapshot somewhere (USB…)
#
#  Snapshots use SQLite's online backup API, so they are consistent even while
#  MILO is running and writing.
# =============================================================================
set -Eeuo pipefail

MILO_ROOT="${MILO_ROOT:-/opt/milo}"
CONFIG_FILE="${MILO_ROOT}/data/config.env"
[[ -f "$CONFIG_FILE" ]] && set -a && . "$CONFIG_FILE" 2>/dev/null && set +a

DB="${MILO_DB_PATH:-${MILO_ROOT}/data/recycling_points.db}"
BACKUP_DIR="${MILO_ROOT}/backups"
KEEP_DAILY="${MILO_BACKUP_KEEP:-14}"
ROLE="${MILO_ROLE:-both}"
MAIN_UNIT="milo-core.service"; [[ "$ROLE" == "edge" ]] && MAIN_UNIT="milo-edge.service"

mkdir -p "$BACKUP_DIR"
TAG=""; ACTION="snapshot"; TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rotate) ACTION="rotate"; shift ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    --list) ACTION="list"; shift ;;
    --restore) ACTION="restore"; TARGET="${2:-}"; shift 2 ;;
    --restore-latest) ACTION="restore-latest"; shift ;;
    --export) ACTION="export"; TARGET="${2:-}"; shift 2 ;;
    --help|-h) sed -n '2,16p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

snapshot() {
  [[ -f "$DB" ]] || { echo "No database yet at ${DB} — nothing to back up."; exit 0; }
  local name="milo-$(date +%Y%m%d-%H%M%S)${TAG:+-${TAG}}.db"
  local out="${BACKUP_DIR}/${name}"
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB" ".backup '${out}'" || { echo "Backup failed" >&2; exit 1; }
  else
    cp -a "$DB" "$out"
  fi
  gzip -f "$out" 2>/dev/null && out="${out}.gz"
  chmod 600 "$out" 2>/dev/null || true
  echo "Backup created: ${out} ($(du -h "$out" | cut -f1))"
}

case "$ACTION" in
  snapshot) snapshot ;;

  rotate)
    snapshot
    # Keep the most recent N, plus the pre-install/pre-update safety copies.
    mapfile -t OLD < <(ls -1t "${BACKUP_DIR}"/milo-*.db* 2>/dev/null | tail -n +$((KEEP_DAILY + 1)) || true)
    for f in "${OLD[@]:-}"; do [[ -n "$f" ]] && rm -f "$f" && echo "Pruned $(basename "$f")"; done
    # Safety copies older than 30 days are no longer useful.
    find "$BACKUP_DIR" -name 'pre-*' -mtime +30 -delete 2>/dev/null || true
    ;;

  list)
    echo "Backups in ${BACKUP_DIR}:"
    ls -1t "${BACKUP_DIR}"/*.db* 2>/dev/null | while read -r f; do
      printf '  %-52s %6s  %s\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)" "$(date -r "$f" '+%Y-%m-%d %H:%M')"
    done || echo "  (none)"
    ;;

  export)
    [[ -n "$TARGET" ]] || { echo "--export needs a destination" >&2; exit 2; }
    LATEST="$(ls -1t "${BACKUP_DIR}"/*.db* 2>/dev/null | head -1)"
    [[ -n "$LATEST" ]] || { echo "No backups to export" >&2; exit 1; }
    cp -a "$LATEST" "$TARGET" && echo "Exported $(basename "$LATEST") -> ${TARGET}"
    ;;

  restore|restore-latest)
    if [[ "$ACTION" == "restore-latest" ]]; then
      TARGET="$(ls -1t "${BACKUP_DIR}"/*.db* 2>/dev/null | head -1)"
      [[ -n "$TARGET" ]] || { echo "No backups available" >&2; exit 1; }
    fi
    [[ -f "$TARGET" ]] || { echo "Backup not found: ${TARGET}" >&2; exit 1; }

    echo "Restoring ${TARGET}"
    echo "  -> ${DB}"
    systemctl stop "$MAIN_UNIT" >/dev/null 2>&1 || true

    # The database being replaced is itself preserved first — restoring the
    # wrong file should never be the end of the story.
    [[ -f "$DB" ]] && cp -a "$DB" "${BACKUP_DIR}/pre-restore-$(date +%Y%m%d-%H%M%S).db"

    TMP="$(mktemp)"
    if [[ "$TARGET" == *.gz ]]; then gunzip -c "$TARGET" > "$TMP"; else cp -a "$TARGET" "$TMP"; fi

    if command -v sqlite3 >/dev/null 2>&1; then
      [[ "$(sqlite3 "$TMP" 'PRAGMA quick_check;' 2>/dev/null | head -1)" == "ok" ]] \
        || { rm -f "$TMP"; echo "Refusing to restore: that backup is itself corrupt." >&2; systemctl start "$MAIN_UNIT" >/dev/null 2>&1 || true; exit 1; }
    fi

    # Remove stale WAL/journal siblings so SQLite cannot mix old and new state.
    rm -f "${DB}-wal" "${DB}-shm" 2>/dev/null || true
    mv -f "$TMP" "$DB"
    chown "${SUDO_USER:-root}": "$DB" 2>/dev/null || true
    chmod 640 "$DB" 2>/dev/null || true

    systemctl start "$MAIN_UNIT" >/dev/null 2>&1 || true
    echo "Restore complete. Service restarted."
    ;;
esac
