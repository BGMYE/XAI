#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --app PATH --output PATH [--volume-name NAME]" >&2
  exit 2
}

require_value() {
  local option="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == --* ]]; then
    echo "missing value for ${option}" >&2
    usage
  fi
}

APP_PATH=""
OUTPUT_PATH=""
VOLUME_NAME="Image Studio"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      require_value "$1" "${2:-}"
      APP_PATH="$2"
      shift 2
      ;;
    --output)
      require_value "$1" "${2:-}"
      OUTPUT_PATH="$2"
      shift 2
      ;;
    --volume-name)
      require_value "$1" "${2:-}"
      VOLUME_NAME="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      ;;
  esac
done

[[ -n "$APP_PATH" && -n "$OUTPUT_PATH" && -n "$VOLUME_NAME" ]] || usage
[[ "$OUTPUT_PATH" == *.dmg ]] || { echo "output path must end in .dmg: $OUTPUT_PATH" >&2; exit 2; }
[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS DMG packaging requires macOS (Darwin)." >&2; exit 1; }
[[ -d "$APP_PATH" ]] || { echo "app bundle not found: $APP_PATH" >&2; exit 1; }
command -v hdiutil >/dev/null 2>&1 || { echo "hdiutil not found." >&2; exit 1; }
command -v ditto >/dev/null 2>&1 || { echo "ditto not found." >&2; exit 1; }

OUTPUT_PATH="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$OUTPUT_PATH")"
OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"
OUTPUT_NAME="$(basename "$OUTPUT_PATH" .dmg)"
mkdir -p "$OUTPUT_DIR"
[[ ! -d "$OUTPUT_PATH" ]] || { echo "output path is a directory: $OUTPUT_PATH" >&2; exit 1; }

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/image-studio-dmg.XXXXXX")"
TEMP_OUTPUT_DIR="$(mktemp -d "$OUTPUT_DIR/.${OUTPUT_NAME}.XXXXXX")"
TEMP_DMG="$TEMP_OUTPUT_DIR/${OUTPUT_NAME}.dmg"
cleanup() {
  rm -rf -- "$STAGING_DIR" "$TEMP_OUTPUT_DIR"
}
trap cleanup EXIT

ditto "$APP_PATH" "$STAGING_DIR/Image Studio.app"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
  -volname "$VOLUME_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$TEMP_DMG"

hdiutil imageinfo "$TEMP_DMG" >/dev/null
mv -f -- "$TEMP_DMG" "$OUTPUT_PATH"
echo "$OUTPUT_PATH"
