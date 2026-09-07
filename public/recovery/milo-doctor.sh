#!/usr/bin/env bash
# =============================================================================
#  milo-doctor — diagnose (and optionally repair) a MILO machine
#
#    milo-doctor              human-readable health report
#    milo-doctor --json       machine-readable (used by the Config UI)
#    milo-doctor --heal       fix what can be fixed automatically
#    milo-doctor --heal --quiet   (run every 5 minutes by milo-health.timer)
#
#  Exit code: 0 = healthy, 1 = warnings, 2 = something is broken.
# =============================================================================
set -uo pipefail

MILO_ROOT="${MILO_ROOT:-/opt/milo}"
CONFIG_FILE="${MILO_ROOT}/data/config.env"
[[ -f "$CONFIG_FILE" ]] && set -a && . "$CONFIG_FILE" 2>/dev/null && set +a

JSON=0; HEAL=0; QUIET=0
for a in "$@"; do
  case "$a" in
    --json) JSON=1 ;;
    --heal) HEAL=1 ;;
    --quiet) QUIET=1 ;;
    --help|-h) sed -n '2,12p' "$0" | sed 's/^# \?//'; exit 0 ;;
  esac
done

if [[ -t 1 && $JSON -eq 0 ]]; then
  C_RST=$'\033[0m'; C_B=$'\033[1m'; C_DIM=$'\033[2m'
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_ACC=$'\033[36m'
else
  C_RST=""; C_B=""; C_DIM=""; C_OK=""; C_WARN=""; C_ERR=""; C_ACC=""
fi

WORST=0                 # 0 ok, 1 warn, 2 fail
declare -a JSON_ROWS=()
declare -a FIXES=()

esc() { printf '%s' "${1//\"/\\\"}"; }

# check <status ok|warn|fail> <id> <label> <detail>
check() {
  local st="$1" id="$2" label="$3" detail="${4:-}"
  case "$st" in
    ok)   [[ $JSON -eq 0 && $QUIET -eq 0 ]] && printf '  %s✓%s %-26s %s%s%s\n' "$C_OK" "$C_RST" "$label" "$C_DIM" "$detail" "$C_RST" ;;
    warn) (( WORST < 1 )) && WORST=1; [[ $JSON -eq 0 && $QUIET -eq 0 ]] && printf '  %s!%s %-26s %s\n' "$C_WARN" "$C_RST" "$label" "$detail" ;;
    fail) WORST=2;                    [[ $JSON -eq 0 && $QUIET -eq 0 ]] && printf '  %s✗%s %-26s %s%s%s\n' "$C_ERR" "$C_RST" "$label" "$C_ERR" "$detail" "$C_RST" ;;
  esac
  JSON_ROWS+=("{\"id\":\"$(esc "$id")\",\"status\":\"${st}\",\"label\":\"$(esc "$label")\",\"detail\":\"$(esc "$detail")\"}")
}
section() { [[ $JSON -eq 0 && $QUIET -eq 0 ]] && printf '\n%s%s%s\n' "$C_B$C_ACC" "$1" "$C_RST"; return 0; }
note()    { FIXES+=("$1"); [[ $JSON -eq 0 && $QUIET -eq 0 ]] && printf '      %s→ %s%s\n' "$C_DIM" "$1" "$C_RST"; return 0; }

ROLE="${MILO_ROLE:-both}"
MAIN_UNIT="milo-core.service"; [[ "$ROLE" == "edge" ]] && MAIN_UNIT="milo-edge.service"

if [[ $JSON -eq 0 && $QUIET -eq 0 ]]; then
  printf '\n%sMILO health check%s  %s%s · %s%s\n' "$C_B" "$C_RST" "$C_DIM" "${MILO_MACHINE_ID:-unknown}" "$(date '+%Y-%m-%d %H:%M')" "$C_RST"
fi

# --- Installation ------------------------------------------------------------
section "Installation"
if [[ -L "${MILO_ROOT}/current" && -e "${MILO_ROOT}/current" ]]; then
  check ok version "Release" "$(basename "$(readlink -f "${MILO_ROOT}/current")")"
else
  check fail version "Release" "no active release — run the installer"
  note "sudo bash install.sh --repair"
fi
[[ -x "${MILO_ROOT}/venv/bin/python" ]] \
  && check ok venv "Python environment" "$("${MILO_ROOT}/venv/bin/python" -V 2>&1 | cut -d' ' -f2)" \
  || { check fail venv "Python environment" "missing"; note "sudo bash install.sh --repair"; }
[[ -f "$CONFIG_FILE" ]] && check ok config "Configuration" "$CONFIG_FILE" || check fail config "Configuration" "missing config.env"

# --- Services ----------------------------------------------------------------
section "Services"
svc_check() {
  local unit="$1" label="$2" critical="${3:-1}"
  if ! systemctl list-unit-files "$unit" >/dev/null 2>&1 || [[ -z "$(systemctl list-unit-files "$unit" --no-legend 2>/dev/null)" ]]; then
    [[ "$critical" == "1" ]] && check fail "svc_${unit%%.*}" "$label" "not installed" || check warn "svc_${unit%%.*}" "$label" "not installed"
    return
  fi
  if systemctl is-active --quiet "$unit"; then
    local since; since="$(systemctl show "$unit" -p ActiveEnterTimestamp --value 2>/dev/null | cut -d' ' -f2-3)"
    check ok "svc_${unit%%.*}" "$label" "active since ${since:-?}"
  else
    if [[ $HEAL -eq 1 ]]; then
      systemctl restart "$unit" >/dev/null 2>&1
      sleep 2
      if systemctl is-active --quiet "$unit"; then
        check warn "svc_${unit%%.*}" "$label" "was down — restarted automatically"
        logger -t milo-doctor "healed: restarted $unit" 2>/dev/null || true
        return
      fi
    fi
    [[ "$critical" == "1" ]] && check fail "svc_${unit%%.*}" "$label" "NOT running" || check warn "svc_${unit%%.*}" "$label" "not running"
    note "journalctl -u ${unit} -n 40"
  fi
}
svc_check "$MAIN_UNIT" "MILO application"
[[ "${MILO_MQTT_HOST:-127.0.0.1}" == "127.0.0.1" ]] && svc_check mosquitto.service "MQTT broker"
svc_check milo-config-ui.service "Repair UI" 0

for tmr in milo-update.timer milo-health.timer milo-backup.timer; do
  if systemctl is-active --quiet "$tmr"; then
    check ok "timer_${tmr%%.*}" "${tmr}" "$(systemctl show "$tmr" -p NextElapseUSecRealtime --value 2>/dev/null | cut -d' ' -f1-3)"
  else
    [[ $HEAL -eq 1 ]] && systemctl enable --now "$tmr" >/dev/null 2>&1
    systemctl is-active --quiet "$tmr" && check warn "timer_${tmr%%.*}" "${tmr}" "was off — re-enabled" \
                                       || check warn "timer_${tmr%%.*}" "${tmr}" "inactive"
  fi
done

# --- Connectivity ------------------------------------------------------------
section "Connectivity"
if command -v mosquitto_sub >/dev/null 2>&1 && [[ -n "${MILO_MQTT_PASS:-}" ]]; then
  if timeout 6 mosquitto_sub -h "${MILO_MQTT_HOST:-127.0.0.1}" -p "${MILO_MQTT_PORT:-1883}" \
       -u "${MILO_MQTT_USER:-pi_backend}" -P "${MILO_MQTT_PASS}" -t '$SYS/broker/version' -C 1 -W 5 >/dev/null 2>&1; then
    check ok mqtt "Broker login" "${MILO_MQTT_HOST:-127.0.0.1}:${MILO_MQTT_PORT:-1883}"
  else
    check fail mqtt "Broker login" "cannot authenticate — password mismatch?"
    note "sudo bash install.sh --repair   (rewrites broker passwords)"
  fi
else
  check warn mqtt "Broker login" "cannot test (mosquitto-clients or password missing)"
fi
if ping -c1 -W3 1.1.1.1 >/dev/null 2>&1; then
  check ok net "Internet" "reachable"
else
  check warn net "Internet" "offline — updates and remote dashboards unavailable"
fi
systemctl is-active --quiet cloudflared 2>/dev/null && check ok tunnel "Cloudflare tunnel" "active" || true

# --- Hardware ----------------------------------------------------------------
if [[ "$ROLE" != "core" ]]; then
  section "Hardware"
  if [[ -e /dev/hailo0 ]]; then
    if command -v hailortcli >/dev/null 2>&1; then
      ID_OUT="$(timeout 10 hailortcli fw-control identify 2>/dev/null || true)"
      DEV="$(grep -oiE 'Hailo-8L?' <<<"$ID_OUT" | head -1)"
      check ok hailo "AI accelerator" "${DEV:-present} (/dev/hailo0)"
    else
      check ok hailo "AI accelerator" "/dev/hailo0 present"
    fi
  else
    check fail hailo "AI accelerator" "/dev/hailo0 missing — HAT not detected"
    note "Check the ribbon cable, then: sudo bash install.sh --repair && sudo reboot"
  fi

  MODEL="${MILO_MODEL_PATH:-${MILO_ROOT}/models/milo.hef}"
  if [[ -s "$MODEL" ]]; then
    check ok model "AI model" "$(du -h "$MODEL" | cut -f1) — $(basename "$MODEL")"
  else
    check fail model "AI model" "missing: ${MODEL}"
    note "Re-run the installer, or copy your .hef to ${MODEL}"
  fi

  SP="${MILO_SERIAL_PORT:-/dev/ttyAMA0}"
  [[ -e "$SP" ]] && check ok serial "Serial link (Arduino)" "$SP" \
                 || { check fail serial "Serial link (Arduino)" "${SP} not found"; note "Enable UART: sudo raspi-config → Interface → Serial"; }

  if "${MILO_ROOT}/venv/bin/python" -c "import hailo, hailo_apps" >/dev/null 2>&1; then
    check ok hailopy "Hailo Python bindings" "importable"
  else
    check fail hailopy "Hailo Python bindings" "import failed"
    note "sudo apt install --reinstall hailo-all && sudo reboot"
  fi
fi

# --- Data --------------------------------------------------------------------
section "Data"
DB="${MILO_DB_PATH:-${MILO_ROOT}/data/recycling_points.db}"
if [[ -f "$DB" ]]; then
  SIZE="$(du -h "$DB" | cut -f1)"
  if command -v sqlite3 >/dev/null 2>&1; then
    INTEG="$(timeout 30 sqlite3 "$DB" 'PRAGMA quick_check;' 2>/dev/null | head -1)"
    if [[ "$INTEG" == "ok" ]]; then
      USERS="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM users;' 2>/dev/null || echo '?')"
      TX="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM user_points;' 2>/dev/null || echo '?')"
      check ok db "Database" "${SIZE} · ${USERS} users · ${TX} deposits"
    else
      check fail db "Database" "INTEGRITY CHECK FAILED"
      note "sudo milo-backup --restore-latest"
    fi
  else
    check ok db "Database" "$SIZE"
  fi
else
  check warn db "Database" "not created yet (normal on a brand-new machine)"
fi

BK_COUNT=$(find "${MILO_ROOT}/backups" -name '*.db' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$BK_COUNT" -gt 0 ]]; then
  LATEST="$(ls -1t "${MILO_ROOT}"/backups/*.db 2>/dev/null | head -1)"
  AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$LATEST" 2>/dev/null || echo 0) ) / 3600 ))
  if (( AGE_H < 48 )); then check ok backup "Backups" "${BK_COUNT} kept · newest ${AGE_H}h old"
  else check warn backup "Backups" "${BK_COUNT} kept · newest is ${AGE_H}h old"; fi
else
  check warn backup "Backups" "none yet"
  [[ $HEAL -eq 1 ]] && command -v milo-backup >/dev/null 2>&1 && milo-backup --rotate >/dev/null 2>&1 && note "created one now"
fi

# --- Resources ---------------------------------------------------------------
section "Resources"
DISK_PCT="$(df -P "${MILO_ROOT}" | awk 'NR==2 {gsub("%","",$5); print $5}')"
DISK_FREE="$(df -Ph "${MILO_ROOT}" | awk 'NR==2 {print $4}')"
if   (( DISK_PCT >= 95 )); then check fail disk "Disk space" "${DISK_PCT}% used — only ${DISK_FREE} free"; note "sudo journalctl --vacuum-size=50M"
elif (( DISK_PCT >= 85 )); then check warn disk "Disk space" "${DISK_PCT}% used (${DISK_FREE} free)"
else                            check ok   disk "Disk space" "${DISK_PCT}% used (${DISK_FREE} free)"; fi

MEM_FREE="$(free -m | awk '/^Mem:/ {print $7}')"
(( MEM_FREE < 150 )) && check warn mem "Memory" "only ${MEM_FREE} MB available" || check ok mem "Memory" "${MEM_FREE} MB available"

if command -v vcgencmd >/dev/null 2>&1; then
  TEMP="$(vcgencmd measure_temp 2>/dev/null | grep -oP '[0-9.]+' || echo '')"
  if [[ -n "$TEMP" ]]; then
    (( ${TEMP%.*} >= 80 )) && check warn temp "Temperature" "${TEMP}°C — check the fans" || check ok temp "Temperature" "${TEMP}°C"
  fi
  THROTTLE="$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2 || echo '0x0')"
  [[ "$THROTTLE" != "0x0" ]] && check warn power "Power supply" "throttling flag ${THROTTLE} — use the official 27W PSU" || true
fi
UP="$(uptime -p 2>/dev/null | sed 's/^up //')"; check ok uptime "Uptime" "${UP:-unknown}"

# --- Output ------------------------------------------------------------------
if [[ $JSON -eq 1 ]]; then
  OVERALL="ok"; (( WORST == 1 )) && OVERALL="warn"; (( WORST == 2 )) && OVERALL="fail"
  CUR_T="$(readlink -f "${MILO_ROOT}/current" 2>/dev/null || true)"
  [[ -n "$CUR_T" && -d "$CUR_T" ]] && CUR_V="$(basename "$CUR_T")" || CUR_V="unknown"
  printf '{"overall":"%s","machine_id":"%s","machine_name":"%s","role":"%s","version":"%s","generated_at":%s,"checks":[' \
    "$OVERALL" "$(esc "${MILO_MACHINE_ID:-}")" "$(esc "${MILO_MACHINE_NAME:-}")" "$(esc "$ROLE")" \
    "$(esc "$CUR_V")" "$(date +%s)"
  printf '%s' "$(IFS=,; echo "${JSON_ROWS[*]}")"
  printf ']}\n'
elif [[ $QUIET -eq 0 ]]; then
  echo
  case $WORST in
    0) printf '  %s%s✓ Everything is healthy%s\n\n' "$C_OK" "$C_B" "$C_RST" ;;
    1) printf '  %s%s! Working, with warnings above%s\n\n' "$C_WARN" "$C_B" "$C_RST" ;;
    2) printf '  %s%s✗ Something is broken — see the ✗ lines above%s\n' "$C_ERR" "$C_B" "$C_RST"
       printf '  %sMost problems are fixed by:  sudo bash install.sh --repair%s\n\n' "$C_DIM" "$C_RST" ;;
  esac
fi

exit $WORST
