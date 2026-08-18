#!/usr/bin/env bash

set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "usage: $0 [base-version]" >&2
  exit 1
fi

base_version="${1:-${BASE_VERSION:-}}"

if [[ -z "${base_version}" ]]; then
  latest_tag="$(git tag --list --sort=-version:refname 'v*' | head -n 1 || true)"
  if [[ "${latest_tag}" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
    base_version="${BASH_REMATCH[1]}"
  elif [[ -f "image-studio/wails.json" ]]; then
    base_version="$(ruby -rjson -e 'print JSON.parse(File.read("image-studio/wails.json")).dig("info", "productVersion")')"
  else
    echo "base version not provided and no git tag/image-studio/wails.json version found" >&2
    exit 1
  fi
fi

if [[ ! "${base_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "base version must be semver core (x.y.z), got: ${base_version}" >&2
  exit 1
fi

ref_name="${GITHUB_REF_NAME:-}"
sha_value="${GITHUB_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || echo "unknown")}"
short_sha="${sha_value:0:12}"
run_number="${GITHUB_RUN_NUMBER:-0}"
run_attempt="${GITHUB_RUN_ATTEMPT:-1}"

product_version="${base_version}"
app_version="${base_version}"
android_version_name="${base_version}"
channel="release"

if [[ -n "${ref_name}" && "${ref_name}" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  product_version="${BASH_REMATCH[1]}"
  app_version="${product_version}"
  android_version_name="${product_version}"
else
  channel="ci"
  build_suffix="ci.${run_number}.${run_attempt}+${short_sha}"
  app_version="${base_version}-${build_suffix}"
  android_version_name="${app_version}"
fi

IFS=. read -r major minor patch <<< "${product_version}"
android_build_fragment=$(( (run_number % 100) * 10 + run_attempt ))
android_version_code=$(( major * 10000000 + minor * 100000 + patch * 1000 + android_build_fragment ))

cat <<EOF
BASE_VERSION=${base_version}
PRODUCT_VERSION=${product_version}
APP_VERSION=${app_version}
FRONTEND_VERSION=${app_version}
ANDROID_VERSION_NAME=${android_version_name}
ANDROID_VERSION_CODE=${android_version_code}
VERSION_CHANNEL=${channel}
VERSION_REF=${ref_name}
VERSION_SHA=${short_sha}
EOF
