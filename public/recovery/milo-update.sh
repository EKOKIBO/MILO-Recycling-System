#!/usr/bin/env bash
# =============================================================================
#  milo-update — over-the-air updates with automatic rollback
#
#    milo-update              check and install if something is newer
#    milo-update --check      only report what is available (no changes)
#    milo-update --auto       same as plain run, but silent unless it acts
#                             (this is what milo-update.timer calls)
#    milo-update --force      reinstall the latest even if versions match
#    milo-update --rollback   go back to the previous release right now
#    milo-update --json       machine-readable status (used by the Config UI)
#
#  Safety model:
#    1. the running release is never modified in place
#    2. the database is backed up before the swap
#    3. after the swap the machine must pass a health check within 60 s
#    4. if it does not, the previous release is restored automatically
# =============================================================================
set -Eeuo pipefail

MILO_ROOT="${MILO_ROOT:-/opt/milo}"
CONFIG_FILE="${MILO_ROOT}/data/config.env"
[[ -f "$CONFIG_FILE" ]] && set -a && . "$CONFIG_FILE" 2>/dev/null && set +a

REPO="${MILO_REPO:-milo-robotics/milo}"
BRANCH="${MILO_BRANCH:-main}"
CHANNEL="${MILO_CHANNEL:-stable}"
STATE_FILE="${MILO_ROOT}/data/installed.json"
LOG_FILE="${MILO_ROOT}/logs/update.log"
RELEASES_DIR="${MILO_ROOT}/releases"
CURRENT_LINK="${MILO_ROOT}/current"

MODE="run"
for a in "$@"; do
  case "$a" in
    --check) MODE="check" ;;
    --auto) MODE="auto" ;;
    --force) MODE="force" ;;
    --rollback) MODE="rollback" ;;
    --json) MODE="json" ;;
    --help|-h) sed -n '2,20p' "$0" | sed 's/^# \?//'; exit 0 ;;
  esac
done

mkdir -p "${MILO_ROOT}/logs"
say() { [[ "$MODE" == "auto" || "$MODE" == "json" ]] || printf '%s\n' "$*"; printf '[%s] %s\n' "$(date -Is)" "$*" >> "$LOG_FILE"; }
fail() { say "ERROR: $*"; [[ "$MODE" == "json" ]] && printf '{"status":"error","message":"%s"}\n' "${*//\"/\\\"}"; exit 1; }

ROLE="${MILO_ROLE:-both}"
MAIN_UNIT="milo-core.service"; [[ "$ROLE" == "edge" ]] && MAIN_UNIT="milo-edge.service"

# Private repositories: a read-only GitHub token from config.env.
GH_AUTH=()
[[ -n "${MILO_GITHUB_TOKEN:-}" ]] && GH_AUTH=(-H "Authorization: Bearer ${MILO_GITHUB_TOKEN}")

installed_ref() { [[ -f "$STATE_FILE" ]] && grep -oP '"ref"\s*:\s*"\K[^"]+' "$STATE_FILE" 2>/dev/null | head -1 || true; }
current_version() {
  local t; t="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  [[ -n "$t" && -d "$t" ]] && basename "$t" || echo "unknown"
}

# --- What is available upstream? --------------------------------------------
# stable -> newest GitHub release tag; beta -> newest commit on the branch.
discover() {
  local api ref="" url="" name=""
  if [[ "$CHANNEL" == "stable" ]]; then
    api="https://api.github.com/repos/${REPO}/releases/latest"
    local body; body="$(curl -fsSL --max-time 25 -H 'Accept: application/vnd.github+json' "${GH_AUTH[@]}" "$api" 2>/dev/null || true)"
    if [[ -n "$body" ]]; then
      ref="$(grep -oP '"tag_name"\s*:\s*"\K[^"]+' <<<"$body" | head -1)"
      name="$ref"
      if [[ -n "$ref" ]]; then
        if [[ -n "${MILO_GITHUB_TOKEN:-}" ]]; then url="https://api.github.com/repos/${REPO}/tarball/${ref}"
        else url="https://codeload.github.com/${REPO}/tar.gz/refs/tags/${ref}"; fi
      fi
    fi
  fi
  if [[ -z "$ref" ]]; then   # beta, or no releases published yet
    api="https://api.github.com/repos/${REPO}/commits/${BRANCH}"
    local body; body="$(curl -fsSL --max-time 25 -H 'Accept: application/vnd.github+json' "${GH_AUTH[@]}" "$api" 2>/dev/null || true)"
    [[ -n "$body" ]] || return 1
    ref="$(grep -oP '"sha"\s*:\s*"\K[^"]+' <<<"$body" | head -1)"
    [[ -n "$ref" ]] || return 1
    name="${BRANCH}@${ref:0:7}"
    if [[ -n "${MILO_GITHUB_TOKEN:-}" ]]; then url="https://api.github.com/repos/${REPO}/tarball/${ref}"
    else url="https://codeload.github.com/${REPO}/tar.gz/${ref}"; fi
  fi
  printf '%s\t%s\t%s\n' "$ref" "$url" "$name"
}

# --- Read-only modes ---------------------------------------------------------
if [[ "$MODE" == "json" ]]; then
  INST="$(installed_ref)"
  if AVAIL="$(discover)"; then
    IFS=$'\t' read -r REF URL NAME <<<"$AVAIL"
    UPD="false"; [[ "$REF" != "$INST" ]] && UPD="true"
    printf '{"status":"ok","channel":"%s","repo":"%s","current_version":"%s","installed_ref":"%s","available_ref":"%s","available_name":"%s","update_available":%s,"auto_update":%s,"last_check":%s}\n' \
      "$CHANNEL" "$REPO" "$(current_version)" "${INST:0:12}" "${REF:0:12}" "$NAME" "$UPD" \
      "$([[ "${MILO_UPDATE_ENABLED:-1}" == "1" ]] && echo true || echo false)" "$(date +%s)"
  else
    printf '{"status":"offline","channel":"%s","repo":"%s","current_version":"%s","update_available":false,"auto_update":%s,"last_check":%s}\n' \
      "$CHANNEL" "$REPO" "$(current_version)" \
      "$([[ "${MILO_UPDATE_ENABLED:-1}" == "1" ]] && echo true || echo false)" "$(date +%s)"
  fi
  exit 0
fi

# --- Rollback ----------------------------------------------------------------
if [[ "$MODE" == "rollback" ]]; then
  CUR="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  PREV="$(ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | grep -v "^${CUR}/$" | head -1 || true)"
  [[ -n "$PREV" ]] || fail "No previous release to roll back to"
  say "Rolling back to $(basename "$PREV")"
  ln -sfn "${PREV%/}" "${CURRENT_LINK}.tmp" && mv -Tf "${CURRENT_LINK}.tmp" "$CURRENT_LINK"
  systemctl restart "$MAIN_UNIT" || true
  say "Rolled back. Active release: $(current_version)"
  exit 0
fi

[[ "${MILO_UPDATE_ENABLED:-1}" == "1" || "$MODE" == "force" ]] || { say "Automatic updates are disabled (MILO_UPDATE_ENABLED=0)"; exit 0; }

# --- Check -------------------------------------------------------------------
say "Checking for updates (${CHANNEL} channel, ${REPO})"
AVAIL="$(discover)" || { say "Could not reach GitHub — will retry on the next timer run"; exit 0; }
IFS=$'\t' read -r REF URL NAME <<<"$AVAIL"
INST="$(installed_ref)"

if [[ "$MODE" == "check" ]]; then
  if [[ "$REF" == "$INST" ]]; then
    say "Up to date (${NAME})"
  else
    SHORT="${INST:0:7}"; [[ -n "$SHORT" ]] || SHORT="none"
    say "Update available: ${NAME}  (installed: ${SHORT})"
  fi
  exit 0
fi

if [[ "$REF" == "$INST" && "$MODE" != "force" ]]; then
  say "Already up to date (${NAME})"
  exit 0
fi

say "Updating to ${NAME}"

# --- Download & stage --------------------------------------------------------
STAGE="$(mktemp -d /tmp/milo-update.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT
curl -fsSL --retry 3 --max-time 300 "${GH_AUTH[@]}" "$URL" -o "${STAGE}/p.tar.gz" || fail "Download failed"
mkdir -p "${STAGE}/x"
tar -xzf "${STAGE}/p.tar.gz" -C "${STAGE}/x" || fail "Downloaded archive is corrupt"

PAYLOAD="$(dirname "$(find "${STAGE}/x" -name 'milo-detect.py' -print -quit 2>/dev/null || true)")"
[[ -n "$PAYLOAD" && -d "$PAYLOAD" ]] || fail "Archive does not contain the MILO backend"

# Refuse to install code that cannot even be parsed — cheap, catches truncation.
PY="${MILO_ROOT}/venv/bin/python"
[[ -x "$PY" ]] || PY="python3"
"$PY" -c "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())" "${PAYLOAD}/milo-detect.py" \
  || fail "New code failed a syntax check — update aborted, nothing changed"

NEW_VER="$(grep -oP "BACKEND_BUILD\s*=\s*'\K[^']+" "${PAYLOAD}/milo-detect.py" 2>/dev/null || date +%Y-%m-%d.%H%M)"
NEW_DIR="${RELEASES_DIR}/${NEW_VER}"
PREV_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

# --- Back up the database before swapping ------------------------------------
if command -v milo-backup >/dev/null 2>&1; then
  milo-backup --tag "pre-update-${NEW_VER}" >/dev/null 2>&1 || say "WARNING: pre-update backup failed"
fi

rm -rf "${NEW_DIR}.new"; mkdir -p "${NEW_DIR}.new"
cp -a "${PAYLOAD}/." "${NEW_DIR}.new/"
rm -rf "$NEW_DIR"; mv "${NEW_DIR}.new" "$NEW_DIR"

# Helper scripts may have changed with the release.
for s in milo-doctor.sh milo-update.sh milo-backup.sh; do
  [[ -f "${NEW_DIR}/deploy/${s}" ]] && install -m 755 "${NEW_DIR}/deploy/${s}" "/usr/local/bin/${s%.sh}" 2>/dev/null || true
done
[[ -f "${NEW_DIR}/deploy/milo" ]] && install -m 755 "${NEW_DIR}/deploy/milo" /usr/local/bin/milo 2>/dev/null || true

# --- Swap & verify -----------------------------------------------------------
say "Activating ${NEW_VER}"
ln -sfn "$NEW_DIR" "${CURRENT_LINK}.tmp" && mv -Tf "${CURRENT_LINK}.tmp" "$CURRENT_LINK"
systemctl restart "$MAIN_UNIT" || true
systemctl restart milo-config-ui.service >/dev/null 2>&1 || true

HEALTHY=0
for i in {1..12}; do            # up to ~60 s to come up and stay up
  sleep 5
  if systemctl is-active --quiet "$MAIN_UNIT"; then
    # Must still be alive a moment later: a crash-loop reports "active"
    # briefly between restarts, and that must not count as success.
    sleep 3
    systemctl is-active --quiet "$MAIN_UNIT" && { HEALTHY=1; break; }
  fi
done

if [[ $HEALTHY -eq 1 ]]; then
  printf '{"ref":"%s","name":"%s","version":"%s","installed_at":%s,"channel":"%s"}\n' \
    "$REF" "$NAME" "$NEW_VER" "$(date +%s)" "$CHANNEL" > "$STATE_FILE"
  say "SUCCESS: now running ${NEW_VER} (${NAME})"
  # Keep three releases so rollback always has somewhere to go.
  mapfile -t OLD < <(ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | tail -n +4 || true)
  for d in "${OLD[@]:-}"; do [[ -n "$d" && "$(readlink -f "$d")" != "$(readlink -f "$CURRENT_LINK")" ]] && rm -rf "$d"; done
  logger -t milo-update "updated to ${NEW_VER}" 2>/dev/null || true
  exit 0
fi

# --- Rollback ----------------------------------------------------------------
say "New release failed to start — ROLLING BACK"
if [[ -n "$PREV_TARGET" && -d "$PREV_TARGET" ]]; then
  ln -sfn "$PREV_TARGET" "${CURRENT_LINK}.tmp" && mv -Tf "${CURRENT_LINK}.tmp" "$CURRENT_LINK"
  systemctl restart "$MAIN_UNIT" || true
  sleep 5
  systemctl is-active --quiet "$MAIN_UNIT" \
    && say "Rolled back successfully to $(current_version) — the machine is running the previous version" \
    || say "CRITICAL: rollback did not start either. Run: sudo bash install.sh --repair"
  rm -rf "$NEW_DIR"
else
  say "CRITICAL: no previous release available. Run: sudo bash install.sh --repair"
fi
logger -t milo-update "update to ${NEW_VER} FAILED, rolled back" 2>/dev/null || true
exit 1
