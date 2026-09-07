#!/usr/bin/env bash
# =============================================================================
#  MILO Recovery & Install Kit — master installer
#
#  One command rebuilds a MILO machine from a blank Raspberry Pi OS image:
#
#      curl -fsSL <your-site>/recovery/install.sh | sudo bash
#
#  Your repository/site addresses live in kit.conf next to this script —
#  that is the ONLY file to edit when adopting this kit.
#
#  It is IDEMPOTENT and SAFE TO RE-RUN: existing data, secrets and machine
#  identity are preserved. Use --repair to force every step to re-verify and
#  self-heal a machine that boots but misbehaves.
#
#  Layout it creates (mutable state lives OUTSIDE the code, so reinstalling or
#  updating the code can never destroy points, users or configuration):
#
#      /opt/milo/releases/<version>/   code for one release
#      /opt/milo/current  ->          symlink to the live release
#      /opt/milo/venv/                python environment
#      /opt/milo/models/              .hef AI models
#      /opt/milo/data/                database, config.env, secrets   <-- precious
#      /opt/milo/backups/             rotated database snapshots      <-- precious
#      /opt/milo/logs/                install & update logs
#
#  Run  install.sh --help  for all options.
# =============================================================================
set -Eeuo pipefail

MILO_KIT_VERSION="1.0.0"

# --- Deployment settings -----------------------------------------------------
# kit.conf sits next to this script and holds YOUR repo/site/model addresses.
# Edit that one file rather than hunting through the scripts. Values already
# present in the environment always win, so flags and `MILO_REPO=... bash
# install.sh` still override it.
KIT_CONF="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/kit.conf"
if [[ -f "$KIT_CONF" ]]; then
  # shellcheck disable=SC1090
  . "$KIT_CONF"
fi

# --- Defaults (override with flags or environment) ---------------------------
MILO_ROOT="${MILO_ROOT:-/opt/milo}"
MILO_REPO="${MILO_REPO:-milo-robotics/milo}"          # GitHub owner/repo
MILO_BRANCH="${MILO_BRANCH:-main}"
MILO_CHANNEL="${MILO_CHANNEL:-stable}"                 # stable | beta
MILO_SITE="${MILO_SITE:-}"                             # empty = app uses its own origin
# Only derive a model host from the site if a site was actually configured,
# otherwise leave it empty so the installer adopts a local .hef instead of
# trying to download from a nonsensical URL.
if [[ -z "${MILO_MODEL_BASE:-}" && -n "$MILO_SITE" ]]; then MILO_MODEL_BASE="${MILO_SITE}/models"; fi
MILO_MODEL_BASE="${MILO_MODEL_BASE:-}"
MILO_VAPID_SUBJECT="${MILO_VAPID_SUBJECT:-mailto:admin@example.org}"
SOURCE_MODE="github"                                   # github | url | local
SOURCE_URL=""
SOURCE_FILE=""
ROLE="both"                                            # both | core | edge
DO_HAILO=1
DO_MOSQUITTO=1
UNATTENDED=0
REPAIR=0
UNINSTALL=0
RESTORE_FROM=""
SKIP_APT=0

MACHINE_ID_ARG=""
MACHINE_NAME_ARG=""
MACHINE_ENV_ARG=""

# --- Pretty output -----------------------------------------------------------
if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
  C_RST=$'\033[0m'; C_B=$'\033[1m'; C_DIM=$'\033[2m'
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_ACC=$'\033[36m'
else
  C_RST=""; C_B=""; C_DIM=""; C_OK=""; C_WARN=""; C_ERR=""; C_ACC=""
fi

LOG_FILE=""
log()   { printf '%s\n' "$*" | tee -a "${LOG_FILE:-/dev/null}" >&2; }
step()  { log ""; log "${C_ACC}${C_B}==>${C_RST} ${C_B}$*${C_RST}"; }
ok()    { log "  ${C_OK}✓${C_RST} $*"; }
warn()  { log "  ${C_WARN}!${C_RST} $*"; }
info()  { log "  ${C_DIM}·${C_RST} $*"; }
die()   { log ""; log "${C_ERR}${C_B}✗ FAILED:${C_RST} $*"; log ""; log "Full log: ${LOG_FILE:-<none>}"; log "Ask a technician, or re-run with:  sudo bash install.sh --repair"; exit 1; }

trap 'die "unexpected error on line $LINENO (command: ${BASH_COMMAND})"' ERR

banner() {
  cat >&2 <<'EOF'

  ███╗   ███╗██╗██╗      ██████╗
  ████╗ ████║██║██║     ██╔═══██╗    Recovery & Install Kit
  ██╔████╔██║██║██║     ██║   ██║    Smart Recycling
  ██║╚██╔╝██║██║██║     ██║   ██║
  ██║ ╚═╝ ██║██║███████╗╚██████╔╝
  ╚═╝     ╚═╝╚═╝╚══════╝ ╚═════╝

EOF
}

usage() {
  cat <<EOF
MILO Recovery & Install Kit v${MILO_KIT_VERSION}

USAGE
  sudo bash install.sh [options]

COMMON
  --repair                 Re-verify and self-heal an existing install (keeps all data)
  --unattended             Never prompt; accept safe defaults (for scripts/imaging)
  --uninstall              Remove services and code (data + backups are KEPT)
  --help                   Show this help

WHERE THE CODE COMES FROM
  --source github          Download from GitHub (default)
  --repo OWNER/REPO        GitHub repo (default: ${MILO_REPO})
  --branch NAME            Branch or tag (default: ${MILO_BRANCH})
  --source url --url URL   Download a .tar.gz from any URL (your website, Google Drive…)
  --source local --file F  Install from a local .tar.gz (USB stick / offline recovery)
  --github-token TOKEN     Read-only token for a PRIVATE repo (saved for updates)

WHAT THIS MACHINE IS
  --role both              Fleet core + this machine's hardware (default, single machine)
  --role core              Brain only, no camera/serial (server or laptop)
  --role edge              Extra machine that reports to a remote core
  --machine-id ID          e.g. school-1   (default: keeps existing, else milo-<serial>)
  --machine-name "NAME"    Display name shown in the app
  --machine-env ENV        office | school | city  (drives the app's theme)

HARDWARE / DEPENDENCIES
  --no-hailo               Skip the Hailo AI HAT+ stack (core-only hosts)
  --no-mosquitto           Skip MQTT broker setup (machine uses a remote broker)
  --skip-apt               Skip apt installs (offline; assumes deps already present)

DATA
  --restore FILE.db        Restore a database backup after installing

EXAMPLES
  # Bare-metal rebuild of a school machine
  curl -fsSL ${MILO_SITE}/recovery/install.sh | sudo bash -s -- \\
       --machine-id school-1 --machine-name "MILO School" --machine-env school

  # Offline recovery from a USB stick
  sudo bash install.sh --source local --file /media/usb/milo-kit.tar.gz

  # Fix a machine that boots but misbehaves
  sudo bash install.sh --repair
EOF
}

# --- Argument parsing --------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)        SOURCE_MODE="${2:-}"; shift 2 ;;
    --url)           SOURCE_URL="${2:-}"; SOURCE_MODE="url"; shift 2 ;;
    --file)          SOURCE_FILE="${2:-}"; SOURCE_MODE="local"; shift 2 ;;
    --repo)          MILO_REPO="${2:-}"; shift 2 ;;
    --branch)        MILO_BRANCH="${2:-}"; shift 2 ;;
    --github-token)  MILO_GITHUB_TOKEN="${2:-}"; shift 2 ;;
    --channel)       MILO_CHANNEL="${2:-}"; shift 2 ;;
    --role)          ROLE="${2:-}"; shift 2 ;;
    --machine-id)    MACHINE_ID_ARG="${2:-}"; shift 2 ;;
    --machine-name)  MACHINE_NAME_ARG="${2:-}"; shift 2 ;;
    --machine-env)   MACHINE_ENV_ARG="${2:-}"; shift 2 ;;
    --no-hailo)      DO_HAILO=0; shift ;;
    --no-mosquitto)  DO_MOSQUITTO=0; shift ;;
    --skip-apt)      SKIP_APT=1; shift ;;
    --unattended)    UNATTENDED=1; shift ;;
    --repair)        REPAIR=1; shift ;;
    --uninstall)     UNINSTALL=1; shift ;;
    --restore)       RESTORE_FROM="${2:-}"; shift 2 ;;
    --help|-h)       usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$ROLE" =~ ^(both|core|edge)$ ]] || { echo "--role must be both|core|edge" >&2; exit 2; }
[[ "$ROLE" == "core" ]] && DO_HAILO=0   # a brain-only host has no camera

# --- Preflight ---------------------------------------------------------------
[[ ${EUID} -eq 0 ]] || { echo "This installer must run as root:  sudo bash install.sh" >&2; exit 1; }

mkdir -p "${MILO_ROOT}/logs"
LOG_FILE="${MILO_ROOT}/logs/install-$(date +%Y%m%d-%H%M%S).log"
touch "$LOG_FILE"

banner
log "${C_DIM}Kit v${MILO_KIT_VERSION} · $(date -Is) · log: ${LOG_FILE}${C_RST}"

# Service account: prefer the human who ran sudo, so hardware group membership
# and manual debugging both work naturally on a Pi.
MILO_USER="${MILO_USER:-${SUDO_USER:-pi}}"
id -u "$MILO_USER" >/dev/null 2>&1 || MILO_USER="root"
info "Service user: ${MILO_USER}"

DATA_DIR="${MILO_ROOT}/data"
MODELS_DIR="${MILO_ROOT}/models"
RELEASES_DIR="${MILO_ROOT}/releases"
BACKUP_DIR="${MILO_ROOT}/backups"
CURRENT_LINK="${MILO_ROOT}/current"
VENV_DIR="${MILO_ROOT}/venv"
CONFIG_FILE="${DATA_DIR}/config.env"

# =============================================================================
#  Uninstall
# =============================================================================
if [[ $UNINSTALL -eq 1 ]]; then
  step "Uninstalling MILO (data and backups are preserved)"
  for u in milo-core milo-edge milo-config-ui milo-update.timer milo-health.timer milo-backup.timer; do
    systemctl disable --now "$u" >/dev/null 2>&1 || true
  done
  rm -f /etc/systemd/system/milo-*.service /etc/systemd/system/milo-*.timer
  systemctl daemon-reload
  rm -rf "${RELEASES_DIR}" "${CURRENT_LINK}" "${VENV_DIR}"
  rm -f /usr/local/bin/milo /usr/local/bin/milo-doctor /usr/local/bin/milo-update
  ok "Services and code removed"
  ok "Kept: ${DATA_DIR} and ${BACKUP_DIR}"
  log ""
  exit 0
fi

# =============================================================================
#  1. System detection
# =============================================================================
step "Checking the system"

OS_NAME="unknown"; OS_VER=""
if [[ -r /etc/os-release ]]; then . /etc/os-release; OS_NAME="${ID:-unknown}"; OS_VER="${VERSION_CODENAME:-}"; fi
ARCH="$(uname -m)"
PI_MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo 'unknown')"

info "Model: ${PI_MODEL}"
info "OS:    ${OS_NAME} ${OS_VER} (${ARCH})"

case "$PI_MODEL" in
  *"Raspberry Pi 5"*) ok "Raspberry Pi 5 detected" ;;
  *"Raspberry Pi"*)   warn "This kit targets the Pi 5; the AI HAT+ needs Pi 5 PCIe. Continuing." ;;
  *)                  warn "Not a Raspberry Pi — installing in ${ROLE} mode without hardware assumptions."
                      [[ "$ROLE" == "both" ]] && { ROLE="core"; DO_HAILO=0; warn "Switched --role to 'core'."; } ;;
esac

if [[ "$ARCH" != "aarch64" && "$DO_HAILO" -eq 1 ]]; then
  warn "HailoRT needs 64-bit OS (aarch64); found ${ARCH}. Disabling Hailo steps."
  DO_HAILO=0
fi

# Disk space guard: a full SD card is a very common cause of "it broke".
AVAIL_MB=$(df -Pm "${MILO_ROOT}" | awk 'NR==2 {print $4}')
info "Free space: ${AVAIL_MB} MB"
(( AVAIL_MB > 900 )) || die "Not enough free disk space (${AVAIL_MB} MB). Free up space and re-run."

mkdir -p "$DATA_DIR" "$MODELS_DIR" "$RELEASES_DIR" "$BACKUP_DIR"
chmod 750 "$DATA_DIR"

# =============================================================================
#  2. Safety: back up the database BEFORE touching anything
# =============================================================================
if [[ -f "${DATA_DIR}/recycling_points.db" ]]; then
  step "Backing up the existing database first"
  SNAP="${BACKUP_DIR}/pre-install-$(date +%Y%m%d-%H%M%S).db"
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "${DATA_DIR}/recycling_points.db" ".backup '${SNAP}'" && ok "Snapshot: ${SNAP}"
  else
    cp -a "${DATA_DIR}/recycling_points.db" "$SNAP" && ok "Snapshot (copy): ${SNAP}"
  fi
else
  # First install on a machine that has been running MILO "the old way":
  # the database sits next to wherever milo-detect.py was started from.
  # Adopting it here is what keeps every user, point and badge across the
  # move to /opt/milo — without this the machine would silently start empty.
  step "Looking for an existing MILO database to adopt"
  LEGACY=""; LEGACY_SIZE=0
  while IFS= read -r cand; do
    [[ -f "$cand" ]] || continue
    [[ "$cand" == "${MILO_ROOT}/"* ]] && continue          # ours, not legacy
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$cand" 'SELECT 1 FROM users LIMIT 1;' >/dev/null 2>&1 || continue
    fi
    SZ=$(stat -c %s "$cand" 2>/dev/null || echo 0)
    if (( SZ > LEGACY_SIZE )); then LEGACY="$cand"; LEGACY_SIZE=$SZ; fi
  done < <(find /home /root /srv /opt -maxdepth 6 -name 'recycling_points.db' -type f 2>/dev/null)

  if [[ -n "$LEGACY" ]]; then
    ROWS="$(sqlite3 "$LEGACY" 'SELECT COUNT(*) FROM user_points;' 2>/dev/null || echo '?')"
    USERS="$(sqlite3 "$LEGACY" 'SELECT COUNT(*) FROM users;' 2>/dev/null || echo '?')"
    info "Found: ${LEGACY}"
    info "Contains ${USERS} users and ${ROWS} deposits ($(du -h "$LEGACY" | cut -f1))"
    ADOPT=1
    if [[ $UNATTENDED -eq 0 && -t 0 ]]; then
      read -r -p "  Import this database into ${DATA_DIR}? [Y/n] " ans
      [[ "${ans,,}" == "n" ]] && ADOPT=0
    fi
    if [[ $ADOPT -eq 1 ]]; then
      if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "$LEGACY" ".backup '${DATA_DIR}/recycling_points.db'"
      else
        cp -a "$LEGACY" "${DATA_DIR}/recycling_points.db"
      fi
      cp -a "${DATA_DIR}/recycling_points.db" "${BACKUP_DIR}/adopted-$(date +%Y%m%d-%H%M%S).db"
      ok "Imported — all users and points carried over"
      info "The original is untouched at ${LEGACY}"
    else
      warn "Skipped — this machine will start with an empty database"
    fi
  else
    info "None found — starting fresh (normal for a brand-new machine)"
  fi
fi

# =============================================================================
#  3. System packages
# =============================================================================
if [[ $SKIP_APT -eq 0 ]]; then
  step "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  APT_PKGS=(python3 python3-venv python3-pip git curl ca-certificates jq sqlite3 tar)
  [[ $DO_MOSQUITTO -eq 1 ]] && APT_PKGS+=(mosquitto mosquitto-clients)
  [[ "$ROLE" != "core" ]] && APT_PKGS+=(python3-gi python3-gi-cairo gir1.2-gstreamer-1.0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-tools)

  apt-get update -qq >>"$LOG_FILE" 2>&1 || warn "apt-get update had warnings (see log)"
  if apt-get install -y -qq "${APT_PKGS[@]}" >>"$LOG_FILE" 2>&1; then
    ok "Installed: ${APT_PKGS[*]}"
  else
    warn "Some packages failed; retrying individually"
    for p in "${APT_PKGS[@]}"; do
      apt-get install -y -qq "$p" >>"$LOG_FILE" 2>&1 && info "ok: $p" || warn "MISSING: $p"
    done
  fi
else
  step "Skipping apt (--skip-apt)"
fi

# =============================================================================
#  4. Hailo AI HAT+ stack (HailoRT, driver, python bindings)
# =============================================================================
HAILO_ARCH=""
if [[ $DO_HAILO -eq 1 ]]; then
  step "Setting up the Hailo AI HAT+"

  # 4a. PCIe must be enabled for the HAT to appear at all.
  BOOT_CFG=/boot/firmware/config.txt
  [[ -f $BOOT_CFG ]] || BOOT_CFG=/boot/config.txt
  NEEDS_REBOOT=0
  if [[ -f $BOOT_CFG ]]; then
    if ! grep -qE '^\s*dtparam=pciex1\b' "$BOOT_CFG"; then
      cp -a "$BOOT_CFG" "${BOOT_CFG}.milo-backup-$(date +%s)"
      printf '\n# Added by MILO installer — required by the AI HAT+\ndtparam=pciex1\ndtparam=pciex1_gen=3\n' >> "$BOOT_CFG"
      NEEDS_REBOOT=1
      warn "Enabled PCIe in ${BOOT_CFG} — a REBOOT is required for the AI HAT+"
    else
      ok "PCIe already enabled in ${BOOT_CFG}"
    fi
  fi

  # 4b. HailoRT + driver + tappas. On Pi OS this is the one-shot metapackage.
  if [[ $SKIP_APT -eq 0 ]]; then
    if dpkg -s hailo-all >/dev/null 2>&1; then
      ok "hailo-all already installed"
    else
      info "Installing hailo-all (HailoRT, PCIe driver, TAPPAS)… this takes a few minutes"
      if apt-get install -y -qq hailo-all >>"$LOG_FILE" 2>&1; then
        ok "hailo-all installed"
        NEEDS_REBOOT=1
      else
        warn "hailo-all not available from apt. Update Pi OS (sudo apt full-upgrade) and re-run,"
        warn "or install HailoRT manually from https://hailo.ai/developer-zone/"
      fi
    fi
  fi

  # 4c. Is the device actually present?
  if [[ -e /dev/hailo0 ]]; then
    ok "Hailo device present: /dev/hailo0"
    if command -v hailortcli >/dev/null 2>&1; then
      IDENT="$(hailortcli fw-control identify 2>/dev/null || true)"
      if grep -qi 'Hailo-8L' <<<"$IDENT"; then HAILO_ARCH="hailo8l"; ok "Accelerator: Hailo-8L (13 TOPS)"
      elif grep -qi 'Hailo-8'  <<<"$IDENT"; then HAILO_ARCH="hailo8";  ok "Accelerator: Hailo-8 (26 TOPS)"
      else warn "Could not identify the accelerator; defaulting model to hailo8"; fi
      RT_VER="$(hailortcli --version 2>/dev/null | head -1 || true)"
      [[ -n "$RT_VER" ]] && info "HailoRT: ${RT_VER}"
    fi
  else
    if [[ $NEEDS_REBOOT -eq 1 ]]; then
      warn "/dev/hailo0 not present yet — expected, because a reboot is pending."
    else
      warn "/dev/hailo0 NOT found. Check the HAT's ribbon cable seating and PCIe settings."
    fi
  fi
  [[ -z "$HAILO_ARCH" ]] && HAILO_ARCH="hailo8"

  # 4d. Groups so the service user can reach the accelerator, camera and UART.
  for g in video render dialout gpio i2c spi; do
    getent group "$g" >/dev/null 2>&1 && usermod -aG "$g" "$MILO_USER" 2>/dev/null || true
  done
  ok "Granted ${MILO_USER} access to hardware groups"
fi

# =============================================================================
#  5. Fetch the application code
# =============================================================================
step "Fetching the MILO application"

STAGE="$(mktemp -d /tmp/milo-stage.XXXXXX)"
cleanup_stage() { rm -rf "$STAGE"; }
trap 'cleanup_stage' EXIT

# Download helper that also survives Google Drive's confirmation interstitial.
fetch_url() {
  local url="$1" out="$2"
  if [[ "$url" == *"drive.google.com"* ]]; then
    local id=""
    [[ "$url" =~ /d/([a-zA-Z0-9_-]+) ]] && id="${BASH_REMATCH[1]}"
    [[ -z "$id" && "$url" =~ id=([a-zA-Z0-9_-]+) ]] && id="${BASH_REMATCH[1]}"
    if [[ -n "$id" ]]; then
      info "Google Drive file id: ${id}"
      local cj; cj="$(mktemp)"
      curl -fsSL -c "$cj" "https://drive.usercontent.google.com/download?id=${id}&export=download" -o "$out" 2>>"$LOG_FILE" || true
      # Large files return an HTML confirmation page instead of the payload.
      if head -c 512 "$out" 2>/dev/null | grep -qi '<html'; then
        info "Handling Drive's large-file confirmation…"
        curl -fsSL -b "$cj" "https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t" -o "$out" 2>>"$LOG_FILE" || true
      fi
      rm -f "$cj"
      [[ -s "$out" ]] && ! head -c 512 "$out" | grep -qi '<html' && return 0
      return 1
    fi
  fi
  # Private GitHub repositories: authenticate with a read-only token.
  local -a auth=()
  if [[ -n "${MILO_GITHUB_TOKEN:-}" && "$url" == *"github"* ]]; then
    auth=(-H "Authorization: Bearer ${MILO_GITHUB_TOKEN}")
  fi
  curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 "${auth[@]}" "$url" -o "$out" 2>>"$LOG_FILE"
}

TARBALL="${STAGE}/payload.tar.gz"
case "$SOURCE_MODE" in
  github)
    if [[ -n "${MILO_GITHUB_TOKEN:-}" ]]; then
      # Private repos: the API tarball endpoint honours the token and redirects
      # to a signed codeload URL. Plain codeload links do not accept tokens.
      URL="https://api.github.com/repos/${MILO_REPO}/tarball/${MILO_BRANCH}"
      info "GitHub (private): ${MILO_REPO}@${MILO_BRANCH}"
    else
      URL="https://codeload.github.com/${MILO_REPO}/tar.gz/refs/heads/${MILO_BRANCH}"
      info "GitHub: ${MILO_REPO}@${MILO_BRANCH}"
    fi
    fetch_url "$URL" "$TARBALL" || die "Could not download from GitHub (${MILO_REPO}@${MILO_BRANCH}).
      · private repo?  add --github-token <token>
      · no internet?   use --source local --file <bundle.tar.gz>
      · wrong name?    check MILO_REPO in kit.conf"
    ;;
  url)
    [[ -n "$SOURCE_URL" ]] || die "--source url requires --url <address>"
    info "URL: ${SOURCE_URL}"
    fetch_url "$SOURCE_URL" "$TARBALL" || die "Download failed: ${SOURCE_URL}"
    ;;
  local)
    [[ -f "$SOURCE_FILE" ]] || die "File not found: ${SOURCE_FILE}"
    info "Local file: ${SOURCE_FILE}"
    cp "$SOURCE_FILE" "$TARBALL"
    ;;
  *) die "--source must be github, url or local" ;;
esac

[[ -s "$TARBALL" ]] || die "Downloaded package is empty"
ok "Package: $(du -h "$TARBALL" | cut -f1)"

mkdir -p "${STAGE}/x"
tar -xzf "$TARBALL" -C "${STAGE}/x" 2>>"$LOG_FILE" || die "Package is not a valid .tar.gz archive"

# Find the directory that actually holds the backend, wherever it sits.
PAYLOAD_DIR="$(dirname "$(find "${STAGE}/x" -name 'milo-detect.py' -print -quit 2>/dev/null || true)")"
[[ -n "$PAYLOAD_DIR" && -d "$PAYLOAD_DIR" ]] || die "milo-detect.py not found inside the package — wrong archive?"
ok "Found application code"

# Version: prefer the code's own build string so the app and kit agree.
VERSION="$(grep -oP "BACKEND_BUILD\s*=\s*'\K[^']+" "${PAYLOAD_DIR}/milo-detect.py" 2>/dev/null || true)"
[[ -n "$VERSION" ]] || VERSION="$(date +%Y-%m-%d.%H%M)"
RELEASE_DIR="${RELEASES_DIR}/${VERSION}"
info "Release version: ${VERSION}"

# Install the release beside the others, then swap the symlink atomically.
rm -rf "${RELEASE_DIR}.new"
mkdir -p "${RELEASE_DIR}.new"
cp -a "${PAYLOAD_DIR}/." "${RELEASE_DIR}.new/"
rm -rf "${RELEASE_DIR}"
mv "${RELEASE_DIR}.new" "${RELEASE_DIR}"
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}.tmp"
mv -Tf "${CURRENT_LINK}.tmp" "${CURRENT_LINK}"
ok "Installed to ${RELEASE_DIR}"

# Keep the last 3 releases so an update can always roll back.
mapfile -t OLD < <(ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | tail -n +4 || true)
for d in "${OLD[@]:-}"; do [[ -n "$d" ]] && rm -rf "$d" && info "Pruned old release: $(basename "$d")"; done

# =============================================================================
#  6. Python environment
# =============================================================================
step "Building the Python environment"

# --system-site-packages is REQUIRED: the Hailo python bindings (hailo,
# hailo_apps) are installed system-wide by apt and cannot be pip-installed.
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  python3 -m venv --system-site-packages "$VENV_DIR" >>"$LOG_FILE" 2>&1 || die "Could not create the Python virtual environment"
  ok "Created ${VENV_DIR}"
else
  ok "Reusing ${VENV_DIR}"
fi

PY="${VENV_DIR}/bin/python"
"$PY" -m pip install --quiet --upgrade pip >>"$LOG_FILE" 2>&1 || warn "pip self-upgrade failed (continuing)"

PIP_PKGS=(paho-mqtt bcrypt pyserial pywebpush)
[[ "$ROLE" != "core" ]] && PIP_PKGS+=(opencv-python-headless numpy)
info "Installing: ${PIP_PKGS[*]}"
if "$PY" -m pip install --quiet "${PIP_PKGS[@]}" >>"$LOG_FILE" 2>&1; then
  ok "Python dependencies installed"
else
  warn "Bulk install failed; retrying one by one"
  for p in "${PIP_PKGS[@]}"; do
    "$PY" -m pip install --quiet "$p" >>"$LOG_FILE" 2>&1 && info "ok: $p" || warn "MISSING: $p"
  done
fi

if [[ "$ROLE" != "core" ]]; then
  "$PY" -c "import hailo" >/dev/null 2>&1 && ok "Hailo python bindings reachable" \
    || warn "'import hailo' failed — install hailo-all and reboot, then re-run --repair"
  "$PY" -c "import hailo_apps" >/dev/null 2>&1 && ok "hailo_apps reachable" \
    || warn "'import hailo_apps' failed — install hailo-apps-infra (see RECOVERY.md)"
fi

# =============================================================================
#  7. AI model (.hef)
# =============================================================================
if [[ "$ROLE" != "core" ]]; then
  step "Installing the AI model"
  HEF_TARGET="${MODELS_DIR}/milo.hef"
  if [[ -s "$HEF_TARGET" && $REPAIR -eq 0 ]]; then
    ok "Model already present: ${HEF_TARGET} ($(du -h "$HEF_TARGET" | cut -f1))"
  else
    # 1) A model shipped inside the package always wins — known-compatible.
    BUNDLED="$(find "${RELEASE_DIR}" -maxdepth 2 -name "*${HAILO_ARCH}*.hef" -print -quit 2>/dev/null || true)"
    [[ -z "$BUNDLED" ]] && BUNDLED="$(find "${RELEASE_DIR}" -maxdepth 2 -name '*.hef' -print -quit 2>/dev/null || true)"

    # 2) Otherwise adopt a model already on this machine. A Pi that has been
    #    running MILO already has a working .hef; reusing it means the kit
    #    needs no model server at all.
    EXISTING=""
    if [[ -z "$BUNDLED" ]]; then
      while IFS= read -r cand; do
        [[ -f "$cand" ]] || continue
        [[ "$cand" == "${MODELS_DIR}/"* ]] && continue
        EXISTING="$cand"; break
      done < <(find /home /root /usr/share/hailo* /opt -maxdepth 6 -name '*.hef' -type f 2>/dev/null \
               | grep -iE 'milo|recycl' || true)
    fi

    if [[ -n "$BUNDLED" ]]; then
      cp "$BUNDLED" "$HEF_TARGET"; ok "Installed bundled model ($(basename "$BUNDLED"))"
    elif [[ -n "$EXISTING" ]]; then
      cp "$EXISTING" "$HEF_TARGET"
      ok "Adopted the model already on this machine"
      info "From: ${EXISTING} ($(du -h "$HEF_TARGET" | cut -f1))"
    elif [[ -n "${MILO_MODEL_BASE:-}" ]]; then
      MODEL_URL="${MILO_MODEL_BASE}/milo-${HAILO_ARCH}.hef"
      info "Downloading ${MODEL_URL}"
      if fetch_url "$MODEL_URL" "${HEF_TARGET}.part"; then
        mv "${HEF_TARGET}.part" "$HEF_TARGET"; ok "Model downloaded for ${HAILO_ARCH}"
        if fetch_url "${MODEL_URL}.sha256" "${STAGE}/hef.sha256" 2>/dev/null; then
          EXPECT="$(awk '{print $1}' "${STAGE}/hef.sha256")"
          ACTUAL="$(sha256sum "$HEF_TARGET" | awk '{print $1}')"
          [[ "$EXPECT" == "$ACTUAL" ]] && ok "Model checksum verified" || warn "Model CHECKSUM MISMATCH — re-download before trusting detections"
        fi
      else
        rm -f "${HEF_TARGET}.part"
        warn "Could not download the model."
        warn "Copy your .hef to ${HEF_TARGET}, then: sudo milo restart"
      fi
    else
      warn "No model found and no model host configured (MILO_MODEL_BASE)."
      warn "Copy your .hef to ${HEF_TARGET}, then: sudo milo restart"
    fi
  fi
fi

# =============================================================================
#  8. Configuration & secrets (never overwritten once created)
# =============================================================================
step "Writing configuration"

gen_secret() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 24; }
cfg_get() { [[ -f "$CONFIG_FILE" ]] && grep -oP "^${1}=\K.*" "$CONFIG_FILE" 2>/dev/null | tail -1 | tr -d '"' || true; }

EX_ID="$(cfg_get MILO_MACHINE_ID)"
EX_NAME="$(cfg_get MILO_MACHINE_NAME)"
EX_ENV="$(cfg_get MILO_MACHINE_ENV)"
EX_MQTT_PASS="$(cfg_get MILO_MQTT_PASS)"
EX_BROWSER_PASS="$(cfg_get MILO_BROWSER_PASS)"
EX_EDGE_PASS="$(cfg_get MILO_EDGE_PASS)"
EX_UI_PIN="$(cfg_get MILO_UI_PIN)"
EX_VAPID_PUB="$(cfg_get MILO_VAPID_PUBLIC_KEY)"
EX_VAPID_PRIV="$(cfg_get MILO_VAPID_PRIVATE_KEY)"
EX_HOST="$(cfg_get MILO_MQTT_HOST)"
# A token supplied once must survive later --repair runs that omit the flag.
EX_TOKEN="$(cfg_get MILO_GITHUB_TOKEN)"
MILO_GITHUB_TOKEN="${MILO_GITHUB_TOKEN:-$EX_TOKEN}"

# Identity: flag > existing > derived from the Pi's serial (stable across reinstalls)
SERIAL_SUFFIX="$(awk '/Serial/ {print substr($3, length($3)-5)}' /proc/cpuinfo 2>/dev/null || true)"
[[ -z "$SERIAL_SUFFIX" ]] && SERIAL_SUFFIX="$(date +%s | tail -c 5)"
MACHINE_ID="${MACHINE_ID_ARG:-${EX_ID:-milo-${SERIAL_SUFFIX}}}"
MACHINE_ID="$(tr -cd 'A-Za-z0-9_-' <<<"$MACHINE_ID")"
MACHINE_NAME="${MACHINE_NAME_ARG:-${EX_NAME:-MILO ${MACHINE_ID}}}"
MACHINE_ENV="${MACHINE_ENV_ARG:-${EX_ENV:-}}"

MQTT_PASS="${EX_MQTT_PASS:-$(gen_secret)}"
BROWSER_PASS="${EX_BROWSER_PASS:-$(gen_secret)}"
EDGE_PASS="${EX_EDGE_PASS:-$(gen_secret)}"
UI_PIN="${EX_UI_PIN:-$(shuf -i 100000-999999 -n 1 2>/dev/null || echo $((RANDOM % 900000 + 100000)))}"
MQTT_HOST_CFG="${EX_HOST:-127.0.0.1}"

# Web-push keys: generate once if npx is available; otherwise notifications
# simply stay off until an admin supplies keys (the app degrades gracefully).
if [[ -z "$EX_VAPID_PUB" ]] && command -v npx >/dev/null 2>&1; then
  VAPID_OUT="$(npx --yes web-push generate-vapid-keys --json 2>/dev/null || true)"
  if [[ -n "$VAPID_OUT" ]] && command -v jq >/dev/null 2>&1; then
    EX_VAPID_PUB="$(jq -r '.publicKey // empty' <<<"$VAPID_OUT")"
    EX_VAPID_PRIV="$(jq -r '.privateKey // empty' <<<"$VAPID_OUT")"
    [[ -n "$EX_VAPID_PUB" ]] && ok "Generated web-push (VAPID) keys"
  fi
fi

umask 027
cat > "$CONFIG_FILE" <<EOF
# MILO configuration — edit with:  sudo milo config   (or the Config UI)
# Generated by install.sh v${MILO_KIT_VERSION}. Secrets: keep this file private.

# --- Identity -------------------------------------------------------------
MILO_MACHINE_ID=${MACHINE_ID}
MILO_MACHINE_NAME=${MACHINE_NAME}
MILO_MACHINE_ENV=${MACHINE_ENV}
MILO_ROLE=${ROLE}

# --- Storage (outside the code tree, so updates never touch it) -----------
MILO_DB_PATH=${DATA_DIR}/recycling_points.db
MILO_MODEL_PATH=${MODELS_DIR}/milo.hef

# --- Broker ---------------------------------------------------------------
MILO_MQTT_HOST=${MQTT_HOST_CFG}
MILO_MQTT_PORT=1883
MILO_MQTT_USER=pi_backend
MILO_MQTT_PASS=${MQTT_PASS}
MILO_BROWSER_PASS=${BROWSER_PASS}
MILO_EDGE_PASS=${EDGE_PASS}

# --- Hardware -------------------------------------------------------------
MILO_SERIAL_PORT=/dev/ttyAMA0
MILO_BAUD_RATE=115200

# --- Web push (optional) --------------------------------------------------
MILO_VAPID_PUBLIC_KEY=${EX_VAPID_PUB}
MILO_VAPID_PRIVATE_KEY=${EX_VAPID_PRIV}
MILO_VAPID_SUBJECT=${MILO_VAPID_SUBJECT}

# --- Updates --------------------------------------------------------------
MILO_REPO=${MILO_REPO}
MILO_BRANCH=${MILO_BRANCH}
MILO_CHANNEL=${MILO_CHANNEL}
MILO_UPDATE_ENABLED=1
MILO_SITE=${MILO_SITE}
MILO_MODEL_BASE=${MILO_MODEL_BASE}
# Optional: GitHub token for a PRIVATE repository (a fine-grained token with
# read-only "Contents" access is enough). Leave empty for public repos.
MILO_GITHUB_TOKEN=${MILO_GITHUB_TOKEN:-}

# --- Local Config UI ------------------------------------------------------
MILO_UI_PORT=8088
MILO_UI_PIN=${UI_PIN}
EOF
chmod 640 "$CONFIG_FILE"
chown "$MILO_USER": "$CONFIG_FILE" 2>/dev/null || true
ok "Config: ${CONFIG_FILE}"
info "Machine: ${MACHINE_ID} (${MACHINE_NAME}${MACHINE_ENV:+, ${MACHINE_ENV}})"

# =============================================================================
#  9. MQTT broker
# =============================================================================
if [[ $DO_MOSQUITTO -eq 1 ]] && command -v mosquitto >/dev/null 2>&1; then
  step "Configuring the MQTT broker"
  PWFILE=/etc/mosquitto/milo_passwd
  ACLFILE=/etc/mosquitto/milo_acl

  # Passwords are rewritten from config.env every run, so the broker and the
  # app can never drift apart (a classic "everything looks fine but nothing
  # works" failure).
  rm -f "$PWFILE"; touch "$PWFILE"; chmod 600 "$PWFILE"
  mosquitto_passwd -b "$PWFILE" pi_backend "$MQTT_PASS" 2>>"$LOG_FILE"
  mosquitto_passwd -b "$PWFILE" browser   "$BROWSER_PASS" 2>>"$LOG_FILE"
  mosquitto_passwd -b "$PWFILE" edge      "$EDGE_PASS" 2>>"$LOG_FILE"
  ok "Broker users: pi_backend, browser, edge"

  if [[ -f "${RELEASE_DIR}/mosquitto_aclfile_2" ]]; then
    install -m 644 "${RELEASE_DIR}/mosquitto_aclfile_2" "$ACLFILE"
    ok "ACL installed from the release"
  else
    warn "mosquitto_aclfile_2 missing from the package — broker ACL not updated"
  fi

  cat > /etc/mosquitto/conf.d/milo.conf <<EOF
# Managed by the MILO installer — do not edit by hand.
per_listener_settings false
allow_anonymous false
password_file ${PWFILE}
acl_file ${ACLFILE}

listener 1883 127.0.0.1
listener 9001 127.0.0.1
protocol websockets

max_packet_size 1048576
message_size_limit 1048576
persistence true
persistence_location /var/lib/mosquitto/
EOF
  ok "Broker listens on 127.0.0.1 (1883 MQTT, 9001 websockets)"
  info "Browsers reach it through the cloudflared tunnel, as before"

  systemctl enable mosquitto >>"$LOG_FILE" 2>&1 || true
  systemctl restart mosquitto >>"$LOG_FILE" 2>&1 && ok "mosquitto restarted" || warn "mosquitto failed to restart — see: journalctl -u mosquitto"
fi

# =============================================================================
#  10. Helper commands + systemd units
# =============================================================================
step "Installing services"

for s in milo-doctor.sh milo-update.sh milo-backup.sh; do
  [[ -f "${RELEASE_DIR}/deploy/${s}" ]] && install -m 755 "${RELEASE_DIR}/deploy/${s}" "/usr/local/bin/${s%.sh}"
done
[[ -f "${RELEASE_DIR}/deploy/milo" ]] && install -m 755 "${RELEASE_DIR}/deploy/milo" /usr/local/bin/milo
ok "Commands: milo, milo-doctor, milo-update, milo-backup"

write_unit() { cat > "/etc/systemd/system/$1"; }

COMMON_UNIT="Restart=always
RestartSec=5
StartLimitBurst=0
User=${MILO_USER}
SupplementaryGroups=video render dialout gpio
EnvironmentFile=${CONFIG_FILE}
WorkingDirectory=${CURRENT_LINK}
StandardOutput=journal
StandardError=journal"

if [[ "$ROLE" == "core" || "$ROLE" == "both" ]]; then
  CORE_ENV=""; CORE_ARGS=""
  if [[ "$ROLE" == "core" ]]; then
    CORE_ENV="Environment=MILO_CORE_ONLY=1"
  else
    CORE_ARGS=" --hef-path ${MODELS_DIR}/milo.hef"
  fi
  write_unit milo-core.service <<EOF
[Unit]
Description=MILO core (fleet brain${ROLE:+ / ${ROLE}})
Documentation=${MILO_SITE}/recovery
After=network-online.target mosquitto.service
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
${CORE_ENV}
ExecStart=${VENV_DIR}/bin/python ${CURRENT_LINK}/milo-detect.py${CORE_ARGS}
${COMMON_UNIT}

[Install]
WantedBy=multi-user.target
EOF
  ok "milo-core.service"
fi

if [[ "$ROLE" == "edge" ]]; then
  write_unit milo-edge.service <<EOF
[Unit]
Description=MILO edge machine (reports to the fleet core)
Documentation=${MILO_SITE}/recovery
After=network-online.target mosquitto.service
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=${VENV_DIR}/bin/python ${CURRENT_LINK}/milo_edge.py --hef-path ${MODELS_DIR}/milo.hef
${COMMON_UNIT}

[Install]
WantedBy=multi-user.target
EOF
  ok "milo-edge.service"
fi

# Local repair/config web UI, styled like the MILO app.
write_unit milo-config-ui.service <<EOF
[Unit]
Description=MILO Config & Repair UI (local web interface)
After=network.target

[Service]
Type=simple
ExecStart=${VENV_DIR}/bin/python ${CURRENT_LINK}/deploy/milo-config-ui.py
Restart=always
RestartSec=5
User=root
EnvironmentFile=${CONFIG_FILE}
Environment=MILO_ROOT=${MILO_ROOT}
WorkingDirectory=${CURRENT_LINK}

[Install]
WantedBy=multi-user.target
EOF
ok "milo-config-ui.service"

# OTA updates: a timer, not a daemon — nothing to crash between checks.
write_unit milo-update.service <<EOF
[Unit]
Description=MILO over-the-air update check
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=${CONFIG_FILE}
Environment=MILO_ROOT=${MILO_ROOT}
ExecStart=/usr/local/bin/milo-update --auto
EOF
write_unit milo-update.timer <<'EOF'
[Unit]
Description=Check for MILO updates twice a day

[Timer]
OnBootSec=10min
OnUnitActiveSec=12h
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF
ok "milo-update.timer (every 12h, randomized)"

# Self-healing watchdog for hangs that Restart=always cannot catch.
write_unit milo-health.service <<EOF
[Unit]
Description=MILO health check and self-heal

[Service]
Type=oneshot
EnvironmentFile=${CONFIG_FILE}
Environment=MILO_ROOT=${MILO_ROOT}
ExecStart=/usr/local/bin/milo-doctor --heal --quiet
EOF
write_unit milo-health.timer <<'EOF'
[Unit]
Description=Run the MILO health check every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
ok "milo-health.timer (every 5 min)"

# Daily database backups — the answer to "the SD card died".
write_unit milo-backup.service <<EOF
[Unit]
Description=MILO database backup

[Service]
Type=oneshot
EnvironmentFile=${CONFIG_FILE}
Environment=MILO_ROOT=${MILO_ROOT}
ExecStart=/usr/local/bin/milo-backup --rotate
EOF
write_unit milo-backup.timer <<'EOF'
[Unit]
Description=Back up the MILO database daily

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
ok "milo-backup.timer (daily)"

# Keep the journal from ever filling the SD card.
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/milo.conf <<'EOF'
[Journal]
SystemMaxUse=200M
SystemMaxFileSize=20M
MaxRetentionSec=1month
EOF
systemctl restart systemd-journald >>"$LOG_FILE" 2>&1 || true
ok "Log size capped at 200 MB"

chown -R "$MILO_USER": "$MILO_ROOT" 2>/dev/null || true
chmod 640 "$CONFIG_FILE"

systemctl daemon-reload
for u in milo-config-ui.service milo-update.timer milo-health.timer milo-backup.timer; do
  systemctl enable "$u" >>"$LOG_FILE" 2>&1 || warn "Could not enable $u"
done
[[ "$ROLE" == "core" || "$ROLE" == "both" ]] && systemctl enable milo-core.service >>"$LOG_FILE" 2>&1
[[ "$ROLE" == "edge" ]] && systemctl enable milo-edge.service >>"$LOG_FILE" 2>&1
ok "Services enabled — MILO now starts automatically on every boot"

# =============================================================================
#  11. Optional restore
# =============================================================================
if [[ -n "$RESTORE_FROM" ]]; then
  step "Restoring the database"
  [[ -f "$RESTORE_FROM" ]] || die "Backup not found: ${RESTORE_FROM}"
  systemctl stop milo-core.service milo-edge.service >/dev/null 2>&1 || true
  cp -a "$RESTORE_FROM" "${DATA_DIR}/recycling_points.db"
  chown "$MILO_USER": "${DATA_DIR}/recycling_points.db" 2>/dev/null || true
  ok "Restored from ${RESTORE_FROM}"
fi

# =============================================================================
#  12. Start & verify
# =============================================================================
step "Starting MILO"
systemctl restart milo-config-ui.service >>"$LOG_FILE" 2>&1 || warn "Config UI did not start"
for u in milo-update.timer milo-health.timer milo-backup.timer; do systemctl start "$u" >>"$LOG_FILE" 2>&1 || true; done

MAIN_UNIT="milo-core.service"; [[ "$ROLE" == "edge" ]] && MAIN_UNIT="milo-edge.service"
systemctl restart "$MAIN_UNIT" >>"$LOG_FILE" 2>&1 || true
sleep 4

if systemctl is-active --quiet "$MAIN_UNIT"; then
  ok "${MAIN_UNIT} is running"
else
  warn "${MAIN_UNIT} is not running yet"
  journalctl -u "$MAIN_UNIT" -n 15 --no-pager >>"$LOG_FILE" 2>&1 || true
  if [[ ${NEEDS_REBOOT:-0} -eq 1 ]]; then
    warn "This is expected while a reboot is pending (the AI HAT+ is not active yet)."
  else
    warn "Recent errors:"; journalctl -u "$MAIN_UNIT" -n 8 --no-pager 2>/dev/null | sed 's/^/      /' >&2 || true
  fi
fi

IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"; IP_ADDR="${IP_ADDR:-<pi-ip>}"
UI_PORT="$(cfg_get MILO_UI_PORT)"; UI_PORT="${UI_PORT:-8088}"

log ""
log "${C_OK}${C_B}  ✓ MILO installation complete${C_RST}"
log ""
log "  ${C_B}Machine${C_RST}      ${MACHINE_ID}  (${MACHINE_NAME})"
log "  ${C_B}Version${C_RST}      ${VERSION}"
log "  ${C_B}Role${C_RST}         ${ROLE}"
log "  ${C_B}Data${C_RST}         ${DATA_DIR}   ${C_DIM}(survives updates & reinstalls)${C_RST}"
log ""
log "  ${C_B}Repair UI${C_RST}    ${C_ACC}http://${IP_ADDR}:${UI_PORT}${C_RST}   PIN: ${C_B}${UI_PIN}${C_RST}"
log "  ${C_B}Commands${C_RST}     milo status · milo doctor · milo update · milo logs"
log ""
if [[ ${NEEDS_REBOOT:-0} -eq 1 ]]; then
  log "  ${C_WARN}${C_B}A REBOOT IS REQUIRED${C_RST} to activate the AI HAT+:  ${C_B}sudo reboot${C_RST}"
  log ""
fi
log "  ${C_DIM}Browser password for the web app: ${BROWSER_PASS}${C_RST}"
log "  ${C_DIM}(set VITE_MQTT_PASS in the frontend .env to match)${C_RST}"
log ""

exit 0
