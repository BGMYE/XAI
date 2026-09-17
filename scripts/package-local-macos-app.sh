#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/image-studio"
WAILS_CONFIG="$PROJECT_DIR/wails.json"
WAILS_META_FILE="$(mktemp "${TMPDIR:-/tmp}/image-studio.meta.XXXXXX")"
GO_COMPILER="${GO_COMPILER:-go}"

node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const appName = cfg.info?.productName || cfg.name || "Image Studio";
  const output = cfg.outputfilename || "image-studio";
  const version = cfg.info?.productVersion || "0.0.0";
  const bundleId = "top.gptcodex.imagestudio";
  const comments = cfg.info?.comments || "";
  const copyright = cfg.info?.copyright || "";
  const protocols = (cfg.info?.protocols || []).map((item) => ({
    CFBundleURLName: bundleId,
    CFBundleURLSchemes: [item.scheme],
    CFBundleTypeRole: item.role || "Editor",
  })).filter((item) => Array.isArray(item.CFBundleURLSchemes) && item.CFBundleURLSchemes[0]);
  console.log(appName);
  console.log(output);
  console.log(version);
  console.log(bundleId);
  console.log(comments);
  console.log(copyright);
  console.log(JSON.stringify(protocols));
' "$WAILS_CONFIG" >"$WAILS_META_FILE"

APP_NAME="$(sed -n '1p' "$WAILS_META_FILE")"
OUTPUT_FILENAME="$(sed -n '2p' "$WAILS_META_FILE")"
APP_PRODUCT_VERSION="$(sed -n '3p' "$WAILS_META_FILE")"
APP_VERSION="${VITE_APP_VERSION:-$APP_PRODUCT_VERSION}"
BUNDLE_ID="$(sed -n '4p' "$WAILS_META_FILE")"
APP_COMMENTS="$(sed -n '5p' "$WAILS_META_FILE")"
APP_COPYRIGHT="$(sed -n '6p' "$WAILS_META_FILE")"
APP_PROTOCOLS_JSON="$(sed -n '7p' "$WAILS_META_FILE")"
CLIENT_VERSION_LDFLAG="${CLIENT_VERSION_LDFLAG:--X github.com/yuanhua/image-gptcodex/pkg/client.Version=${APP_VERSION}}"

APP_BUNDLE="$PROJECT_DIR/build/bin/${APP_NAME}.app"
EXECUTABLE_SRC="$PROJECT_DIR/build/bin/${OUTPUT_FILENAME}"
EXECUTABLE_ARM64="$PROJECT_DIR/build/bin/${OUTPUT_FILENAME}-arm64"
EXECUTABLE_AMD64="$PROJECT_DIR/build/bin/${OUTPUT_FILENAME}-amd64"
EXECUTABLE_DST="$APP_BUNDLE/Contents/MacOS/${OUTPUT_FILENAME}"
RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
PLIST_PATH="$APP_BUNDLE/Contents/Info.plist"
ICON_SRC="$PROJECT_DIR/build/appicon.png"
ICON_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/image-studio-icns.XXXXXX")"
ICONSET_DIR="$ICON_TEMP_DIR/iconfile.iconset"

cleanup() {
  rm -f "$WAILS_META_FILE"
  rm -rf "$ICON_TEMP_DIR"
}
trap cleanup EXIT

run_with_retry() {
  local attempts="$1"
  shift
  local delay_seconds="$1"
  shift

  local try=1
  local exit_code=0
  while true; do
    if "$@"; then
      return 0
    else
      exit_code=$?
    fi
    if (( try >= attempts )); then
      return "$exit_code"
    fi
    echo "command failed (exit ${exit_code}), retrying ${try}/${attempts}: $*" >&2
    sleep "$delay_seconds"
    try=$((try + 1))
  done
}

ensure_frontend_deps() {
  if [[ -d "$PROJECT_DIR/frontend/node_modules" ]]; then
    return
  fi
  echo "frontend/node_modules missing; running npm ci" >&2
  (
    cd "$PROJECT_DIR/frontend"
    npm ci
  )
}

if [[ ! -f "$ICON_SRC" ]]; then
  echo "missing icon source: $ICON_SRC" >&2
  exit 1
fi

ensure_frontend_deps

(
  cd "$PROJECT_DIR/frontend"
  run_with_retry 3 1 npm run build:macos
)

mkdir -p "$PROJECT_DIR/build/bin"
rm -f "$EXECUTABLE_ARM64" "$EXECUTABLE_AMD64" "$EXECUTABLE_SRC"

(
  cd "$PROJECT_DIR"
  GOPATH="$ROOT_DIR/.gopath" \
  GOMODCACHE="$ROOT_DIR/.gomodcache" \
  GOCACHE="$ROOT_DIR/.gocache" \
  GOOS=darwin \
  GOARCH=arm64 \
  CGO_ENABLED=1 \
  CC='clang -arch arm64' \
  CXX='clang++ -arch arm64' \
  MACOSX_DEPLOYMENT_TARGET=12.0 \
  CGO_CFLAGS="-mmacosx-version-min=12.0" \
  CGO_CXXFLAGS="-I$PROJECT_DIR/build" \
  CGO_LDFLAGS="-framework UniformTypeIdentifiers -mmacosx-version-min=12.0" \
  "$GO_COMPILER" build -trimpath -buildvcs=false -tags production -ldflags "-w -s ${CLIENT_VERSION_LDFLAG} -extldflags=-mmacosx-version-min=12.0" -o "$EXECUTABLE_ARM64" .
)

(
  cd "$PROJECT_DIR"
  GOPATH="$ROOT_DIR/.gopath" \
  GOMODCACHE="$ROOT_DIR/.gomodcache" \
  GOCACHE="$ROOT_DIR/.gocache" \
  GOOS=darwin \
  GOARCH=amd64 \
  CGO_ENABLED=1 \
  CC='clang -arch x86_64' \
  CXX='clang++ -arch x86_64' \
  MACOSX_DEPLOYMENT_TARGET=12.0 \
  CGO_CFLAGS="-mmacosx-version-min=12.0" \
  CGO_CXXFLAGS="-I$PROJECT_DIR/build" \
  CGO_LDFLAGS="-framework UniformTypeIdentifiers -mmacosx-version-min=12.0" \
  "$GO_COMPILER" build -trimpath -buildvcs=false -tags production -ldflags "-w -s ${CLIENT_VERSION_LDFLAG} -extldflags=-mmacosx-version-min=12.0" -o "$EXECUTABLE_AMD64" .
)

/usr/bin/lipo -create -output "$EXECUTABLE_SRC" "$EXECUTABLE_ARM64" "$EXECUTABLE_AMD64"
rm -f "$EXECUTABLE_ARM64" "$EXECUTABLE_AMD64"

# Check the Mach-O load commands as well as Info.plist. Dependency cgo flags
# include older deployment targets, so the final linker flag above must win.
for architecture in arm64 x86_64; do
  minimum_version="$(/usr/bin/otool -l -arch "$architecture" "$EXECUTABLE_SRC" | awk '$1 == "cmd" { command = $2 } command == "LC_BUILD_VERSION" && $1 == "minos" { print $2 } command == "LC_VERSION_MIN_MACOSX" && $1 == "version" { print $2 }')"
  case "$minimum_version" in
    12.0|12.0.0) ;;
    *) echo "unexpected macOS minimum for ${architecture}: ${minimum_version:-missing}" >&2; exit 1 ;;
  esac
done

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$RESOURCES_DIR"
cp "$EXECUTABLE_SRC" "$EXECUTABLE_DST"

mkdir -p "$ICONSET_DIR"
for size in 16 32 128 256 512; do
  /usr/bin/sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  doubled=$((size * 2))
  /usr/bin/sips -z "$doubled" "$doubled" "$ICON_SRC" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done
/usr/bin/iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/iconfile.icns"

cat >"$PLIST_PATH" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict/>
</plist>
EOF

/usr/bin/plutil -insert CFBundlePackageType -string "APPL" "$PLIST_PATH"
/usr/bin/plutil -insert CFBundleName -string "$APP_NAME" "$PLIST_PATH"
/usr/bin/plutil -insert CFBundleExecutable -string "$OUTPUT_FILENAME" "$PLIST_PATH"
/usr/bin/plutil -insert CFBundleIdentifier -string "$BUNDLE_ID" "$PLIST_PATH"
/usr/bin/plutil -insert CFBundleVersion -string "$APP_VERSION" "$PLIST_PATH"
/usr/bin/plutil -insert CFBundleGetInfoString -string "$APP_COMMENTS" "$PLIST_PATH"
/usr/bin/plutil -insert CFBundleShortVersionString -string "$APP_VERSION" "$PLIST_PATH"
/usr/bin/plutil -insert CFBundleIconFile -string "iconfile" "$PLIST_PATH"
/usr/bin/plutil -insert LSMinimumSystemVersion -string "12.0" "$PLIST_PATH"
/usr/bin/plutil -insert NSHighResolutionCapable -bool YES "$PLIST_PATH"
/usr/bin/plutil -insert NSHumanReadableCopyright -string "$APP_COPYRIGHT" "$PLIST_PATH"
if [[ -n "$APP_PROTOCOLS_JSON" && "$APP_PROTOCOLS_JSON" != "[]" ]]; then
  /usr/bin/plutil -insert CFBundleURLTypes -json "$APP_PROTOCOLS_JSON" "$PLIST_PATH"
fi
/usr/bin/plutil -lint "$PLIST_PATH" >/dev/null

chmod +x "$EXECUTABLE_DST"
/usr/bin/xattr -rc "$APP_BUNDLE"
/usr/bin/codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_BUNDLE" >/dev/null 2>&1 || true
echo "$APP_BUNDLE"
