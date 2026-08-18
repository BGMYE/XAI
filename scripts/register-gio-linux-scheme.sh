#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 /absolute/path/to/image-studio-gio" >&2
  exit 1
fi

EXECUTABLE="$1"
if [ ! -x "$EXECUTABLE" ]; then
  echo "executable not found or not executable: $EXECUTABLE" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_PATH="$ROOT_DIR/gio-client/assets/image-studio-gio.desktop.in"
DESKTOP_DIR="${HOME}/.local/share/applications"
DESKTOP_FILE="${DESKTOP_DIR}/image-studio-gio.desktop"
ESCAPED_EXECUTABLE="${EXECUTABLE//\\/\\\\}"
ESCAPED_EXECUTABLE="${ESCAPED_EXECUTABLE//&/\\&}"

mkdir -p "$DESKTOP_DIR"
sed "s#__EXECUTABLE__#${ESCAPED_EXECUTABLE}#g" "$TEMPLATE_PATH" > "$DESKTOP_FILE"

if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default image-studio-gio.desktop x-scheme-handler/image-studio
  echo "registered image-studio:// with image-studio-gio.desktop"
else
  echo "desktop file written to $DESKTOP_FILE"
  echo "xdg-mime not found; please register x-scheme-handler/image-studio manually"
fi
