#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

usage() {
  echo "Usage: $0 (--app APP_PATH | --dmg DMG_PATH)" >&2
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

MODE=""
TARGET_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app|--dmg)
      [[ -z "$MODE" ]] || { echo "specify exactly one of --app or --dmg" >&2; usage; }
      require_value "$1" "${2:-}"
      MODE="${1#--}"
      TARGET_PATH="$2"
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

[[ -n "$MODE" && -n "$TARGET_PATH" ]] || usage
if [[ "$MODE" == "app" ]]; then
  [[ "$TARGET_PATH" == *.app ]] || { echo "app path must end in .app: $TARGET_PATH" >&2; exit 2; }
else
  [[ "$TARGET_PATH" == *.dmg ]] || { echo "DMG path must end in .dmg: $TARGET_PATH" >&2; exit 2; }
fi
[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS signing requires macOS (Darwin)." >&2; exit 1; }
if [[ "$MODE" == "app" ]]; then
  [[ -d "$TARGET_PATH" ]] || { echo "app bundle not found: $TARGET_PATH" >&2; exit 1; }
else
  [[ -f "$TARGET_PATH" ]] || { echo "DMG not found: $TARGET_PATH" >&2; exit 1; }
fi

required=(
  APPLE_CERTIFICATE_BASE64
  APPLE_CERTIFICATE_PASSWORD
  APPLE_SIGNING_IDENTITY
  APPLE_ID
  APPLE_TEAM_ID
  APPLE_APP_PASSWORD
)
missing=()
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || missing+=("$name")
done
if (( ${#missing[@]} > 0 )); then
  echo "::warning::macOS ${MODE} is only ad-hoc/unsigned and was not notarized; missing signing configuration: ${missing[*]}"
  exit 0
fi

for command_name in security codesign xcrun openssl; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "${command_name} not found." >&2; exit 1; }
done
if [[ "$MODE" == "app" ]]; then
  command -v ditto >/dev/null 2>&1 || { echo "ditto not found." >&2; exit 1; }
fi

WORK_DIR="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/image-studio-signing.XXXXXX")"
KEYCHAIN_PATH="$WORK_DIR/signing.keychain-db"
CERT_PATH="$WORK_DIR/certificate.p12"
NOTARY_ARCHIVE="$WORK_DIR/notary-upload.zip"
NOTARY_PROFILE="image-studio-notary-${RANDOM}-$$"
KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"
ORIGINAL_KEYCHAINS=()
KEYCHAIN_CREATED=false
SEARCH_LIST_CHANGED=false

while IFS= read -r keychain; do
  keychain="${keychain#\"}"
  keychain="${keychain%\"}"
  [[ -n "$keychain" ]] && ORIGINAL_KEYCHAINS+=("$keychain")
done < <(security list-keychains -d user | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

cleanup() {
  local exit_status=$?
  local cleanup_status=0
  if [[ "$SEARCH_LIST_CHANGED" == true ]]; then
    if (( ${#ORIGINAL_KEYCHAINS[@]} > 0 )); then
      security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || cleanup_status=$?
    else
      security list-keychains -d user -s >/dev/null 2>&1 || cleanup_status=$?
    fi
  fi
  if [[ "$KEYCHAIN_CREATED" == true ]]; then
    security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$WORK_DIR"
  if (( cleanup_status != 0 )); then
    echo "failed to restore the original user keychain search list" >&2
    if (( exit_status == 0 )); then
      exit_status=$cleanup_status
    fi
  fi
  trap - EXIT
  exit "$exit_status"
}
trap cleanup EXIT

if ! printf '%s' "$APPLE_CERTIFICATE_BASE64" | base64 --decode >"$CERT_PATH" 2>/dev/null; then
  printf '%s' "$APPLE_CERTIFICATE_BASE64" | base64 -D >"$CERT_PATH" 2>/dev/null
fi
[[ -s "$CERT_PATH" ]] || { echo "decoded Apple certificate is empty" >&2; exit 1; }

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null
KEYCHAIN_CREATED=true
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERT_PATH" -k "$KEYCHAIN_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security list-keychains -d user -s "$KEYCHAIN_PATH" "${ORIGINAL_KEYCHAINS[@]}"
SEARCH_LIST_CHANGED=true
security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null

if ! security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep -Fq -- "$APPLE_SIGNING_IDENTITY"; then
  echo "configured Apple signing identity was not found in the imported certificate" >&2
  exit 1
fi

if [[ "$MODE" == "app" ]]; then
  codesign --force --options runtime --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$TARGET_PATH"
  codesign --verify --deep --strict --verbose=2 "$TARGET_PATH"
  ditto -c -k --keepParent "$TARGET_PATH" "$NOTARY_ARCHIVE"
  NOTARY_TARGET="$NOTARY_ARCHIVE"
else
  codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$TARGET_PATH"
  codesign --verify --strict --verbose=2 "$TARGET_PATH"
  NOTARY_TARGET="$TARGET_PATH"
fi

xcrun notarytool store-credentials "$NOTARY_PROFILE" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_PASSWORD" \
  --keychain "$KEYCHAIN_PATH" >/dev/null
xcrun notarytool submit "$NOTARY_TARGET" \
  --keychain-profile "$NOTARY_PROFILE" \
  --keychain "$KEYCHAIN_PATH" \
  --wait
xcrun stapler staple "$TARGET_PATH"
xcrun stapler validate "$TARGET_PATH"
echo "Signed, notarized, and stapled $TARGET_PATH"
