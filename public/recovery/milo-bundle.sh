#!/usr/bin/env bash
# =============================================================================
#  milo-bundle — build a self-contained recovery bundle
#
#  Produces ONE .tar.gz that can rebuild a machine with no internet at all:
#  application code, the deploy kit, the .hef AI model and (optionally) the
#  Python wheels. Copy it to a USB stick, your website, or Google Drive.
#
#    milo-bundle                       bundle from the running install
#    milo-bundle --from ./src          bundle from a source directory
#    milo-bundle --with-wheels         also embed pip dependencies (bigger)
#    milo-bundle --out /media/usb      choose where to write it
#
#  Restore on any machine:
#    sudo bash install.sh --source local --file milo-kit-YYYYMMDD.tar.gz
# =============================================================================
set -Eeuo pipefail

MILO_ROOT="${MILO_ROOT:-/opt/milo}"
SRC=""; OUT="."; WHEELS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) SRC="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --with-wheels) WHEELS=1; shift ;;
    --help|-h) sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# Default source: the release this machine is running.
[[ -n "$SRC" ]] || SRC="$(readlink -f "${MILO_ROOT}/current" 2>/dev/null || true)"
[[ -n "$SRC" && -f "${SRC}/milo-detect.py" ]] || { echo "Could not find MILO source. Use --from <dir>." >&2; exit 1; }

VERSION="$(grep -oP "BACKEND_BUILD\s*=\s*'\K[^']+" "${SRC}/milo-detect.py" 2>/dev/null || date +%Y-%m-%d)"
STAMP="$(date +%Y%m%d-%H%M)"
NAME="milo-kit-${VERSION}-${STAMP}.tar.gz"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PKG="${STAGE}/milo-kit"
mkdir -p "$PKG"

echo "Building recovery bundle for ${VERSION}"

# 1. Application code (no caches, no local databases)
rsync -a --exclude='__pycache__' --exclude='*.pyc' --exclude='*.db' --exclude='.git' \
      "${SRC}/" "${PKG}/" 2>/dev/null || cp -a "${SRC}/." "${PKG}/"
find "$PKG" -name '*.db' -delete 2>/dev/null || true
echo "  ✓ application code"

# 2. AI model, so the kit works with no model server
MODEL="${MILO_ROOT}/models/milo.hef"
if [[ -s "$MODEL" ]]; then
  cp "$MODEL" "${PKG}/milo.hef"
  echo "  ✓ AI model ($(du -h "$MODEL" | cut -f1))"
else
  echo "  ! no .hef model found — the bundle will need to download one"
fi

# 3. Python wheels for fully offline pip installs
if [[ $WHEELS -eq 1 ]]; then
  mkdir -p "${PKG}/wheels"
  PY="${MILO_ROOT}/venv/bin/python"; [[ -x "$PY" ]] || PY=python3
  if "$PY" -m pip download -q -d "${PKG}/wheels" paho-mqtt bcrypt pyserial pywebpush 2>/dev/null; then
    echo "  ✓ python wheels ($(du -sh "${PKG}/wheels" | cut -f1))"
  else
    echo "  ! could not download wheels (needs internet once)"
  fi
fi

# 4. Provenance + checksums so a technician can verify what they received
{
  echo "MILO recovery bundle"
  echo "version:   ${VERSION}"
  echo "built:     $(date -Is)"
  echo "built_on:  $(hostname) (${MILO_MACHINE_ID:-unknown})"
  echo "wheels:    $([[ $WHEELS -eq 1 ]] && echo yes || echo no)"
} > "${PKG}/BUNDLE-INFO.txt"
( cd "$PKG" && find . -type f ! -name SHA256SUMS -exec sha256sum {} + > SHA256SUMS 2>/dev/null ) || true

mkdir -p "$OUT"
tar -czf "${OUT}/${NAME}" -C "$STAGE" milo-kit
sha256sum "${OUT}/${NAME}" > "${OUT}/${NAME}.sha256" 2>/dev/null || true

echo
echo "  Bundle: ${OUT}/${NAME}  ($(du -h "${OUT}/${NAME}" | cut -f1))"
echo
echo "  Restore on any machine with:"
echo "    sudo bash install.sh --source local --file ${NAME}"
echo
