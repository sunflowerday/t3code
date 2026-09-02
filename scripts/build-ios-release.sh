#!/usr/bin/env bash
# Frozen local iOS Release. Same argv every run so Xcode's command-line
# override fingerprint stays stable — a one-flag drift rebuilds ~75 Pods.
#
# Official sources this script follows:
#   https://reactnative.dev/docs/build-speed          (ccache + Xcode setup)
#   expo-build-properties ios.ccacheEnabled           (writes apple.ccacheEnabled)
#   Expo/RN Bundle React Native phase                 (alwaysOutOfDate=1)
#
# The Bundle React Native phase ships with only .xcode.env inputs and empty
# outputs. Enabling "Based on dependency analysis" without a complete JS
# input graph produces a stale main.jsbundle. This script does not flip that
# switch. Metro's own FileStore is the official incremental for that step.
#
# usage:
#   scripts/build-ios-release.sh
#   scripts/build-ios-release.sh --clean-derived-data
#   scripts/build-ios-release.sh --expect-js 'probe-string'
#   scripts/build-ios-release.sh --print-command
#   scripts/build-ios-release.sh --verify-app /path/to/Kuca.app --expect-js 'probe'
set -euo pipefail

export PATH="${HOME}/.bun/bin:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:${PATH}"

readonly DEVELOPMENT_TEAM="B537AN89U9"
readonly CODE_SIGN_STYLE="Automatic"
readonly SCHEME="Kuca"
readonly CONFIGURATION="Release"
readonly DESTINATION="generic/platform=iOS"
readonly DERIVED_DATA="${HOME}/.cache/kuca-ios-dd"
readonly CCACHE_DIR_DEFAULT="${HOME}/Library/Caches/ccache"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ios_dir="${repo_root}/apps/mobile/ios"
workspace="${ios_dir}/Kuca.xcworkspace"
app_path="${DERIVED_DATA}/Build/Products/${CONFIGURATION}-iphoneos/${SCHEME}.app"

clean_derived_data=0
print_command=0
verify_only=0
expect_js=""
verify_app=""

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean-derived-data)
      clean_derived_data=1
      shift
      ;;
    --print-command)
      print_command=1
      shift
      ;;
    --expect-js)
      expect_js="${2:-}"
      if [[ -z "${expect_js}" ]]; then
        echo "error: --expect-js needs a non-empty string" >&2
        exit 2
      fi
      shift 2
      ;;
    --verify-app)
      verify_app="${2:-}"
      verify_only=1
      if [[ -z "${verify_app}" ]]; then
        echo "error: --verify-app needs a path" >&2
        exit 2
      fi
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

xcodebuild_args=(
  -workspace "${workspace}"
  -scheme "${SCHEME}"
  -configuration "${CONFIGURATION}"
  -destination "${DESTINATION}"
  -derivedDataPath "${DERIVED_DATA}"
  "DEVELOPMENT_TEAM=${DEVELOPMENT_TEAM}"
  "CODE_SIGN_STYLE=${CODE_SIGN_STYLE}"
  # 2026-09-02: Xcode's compilation cache grew past 25 GB inside one build
  # (CompilationCache.noindex v8.data/v8.index) and starved the host disk.
  # ccache already covers the C/ObjC/Swift hot path; the Xcode cache is off.
  "COMPILATION_CACHE_ENABLE_CACHING=NO"
  build
)

print_xcodebuild() {
  printf 'xcodebuild'
  local arg
  for arg in "${xcodebuild_args[@]}"; do
    printf ' %q' "${arg}"
  done
  printf '\n'
}

verify_jsbundle() {
  local app="$1"
  local needle="$2"
  local bundle="${app}/main.jsbundle"
  if [[ ! -d "${app}" ]]; then
    echo "error: app not found: ${app}" >&2
    exit 1
  fi
  if [[ ! -f "${bundle}" ]]; then
    echo "error: main.jsbundle missing in ${app}" >&2
    exit 1
  fi
  if [[ -n "${needle}" ]]; then
    if ! grep -F -q -- "${needle}" "${bundle}"; then
      echo "error: main.jsbundle does not contain expected JS: ${needle}" >&2
      echo "       app=${app}" >&2
      exit 1
    fi
    echo "probe ok: main.jsbundle contains ${needle}"
  fi
  echo "app=${app}"
  echo "jsbundle=${bundle}"
}

if [[ "${verify_only}" -eq 1 ]]; then
  if [[ -z "${expect_js}" ]]; then
    echo "error: --verify-app requires --expect-js" >&2
    exit 2
  fi
  verify_jsbundle "${verify_app}" "${expect_js}"
  exit 0
fi

if [[ "${print_command}" -eq 1 ]]; then
  print_xcodebuild
  exit 0
fi

if [[ ! -d "${ios_dir}" || ! -d "${workspace}" ]]; then
  echo "error: ${workspace} is missing — generate ios/ with expo prebuild first" >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null; then
  echo "error: xcodebuild not on PATH" >&2
  exit 1
fi

if ! command -v ccache >/dev/null; then
  echo "error: ccache not on PATH. Official RN setup: brew install ccache" >&2
  exit 1
fi

export USE_CCACHE=1
export CCACHE_DIR="${CCACHE_DIR:-${CCACHE_DIR_DEFAULT}}"
mkdir -p "${CCACHE_DIR}" "${DERIVED_DATA}"

# Existing unique writer for NODE_BINARY + ENTERPRISE_REPOSITORY.
"${repo_root}/scripts/kuca-mobile-ios-env.sh"

python3 - "${ios_dir}/Podfile.properties.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text()) if path.exists() else {}
if data.get("apple.ccacheEnabled") == "true":
    raise SystemExit(0)
data["apple.ccacheEnabled"] = "true"
path.write_text(json.dumps(data, indent=2) + "\n")
print(f"wrote apple.ccacheEnabled=true -> {path}")
PY

pods_project="${ios_dir}/Pods/Pods.xcodeproj/project.pbxproj"
if [[ ! -f "${pods_project}" ]] || ! grep -F -q "CCACHE_BINARY" "${pods_project}"; then
  echo "ccache wrappers missing from Pods project; running pod install (official RN wire-up)"
  (
    cd "${ios_dir}"
    USE_CCACHE=1 pod install --deployment
  )
fi

if [[ "${clean_derived_data}" -eq 1 ]]; then
  echo "removing ${DERIVED_DATA}"
  rm -rf "${DERIVED_DATA}"
  mkdir -p "${DERIVED_DATA}"
fi

load="$(sysctl -n vm.loadavg | awk '{ print $2 }')"
echo "loadavg.1m=${load}"
echo "derivedData=${DERIVED_DATA}"
echo "ccache=$(command -v ccache)"
ccache --zero-stats >/dev/null
print_xcodebuild

started="$(python3 -c 'import time; print(time.time())')"
(
  cd "${ios_dir}"
  xcodebuild "${xcodebuild_args[@]}"
)
ended="$(python3 -c 'import time; print(time.time())')"
python3 - "${started}" "${ended}" <<'PY'
import sys
started = float(sys.argv[1])
ended = float(sys.argv[2])
print(f"elapsed_sec={ended - started:.1f}")
PY

echo "----- ccache -s -----"
ccache -s
echo "----- end ccache -----"

verify_jsbundle "${app_path}" "${expect_js}"
