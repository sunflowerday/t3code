#!/usr/bin/env bash
# Run the UI tests against the already-installed Release app on the wired iPhone.
# Does not build Kuca. Does not use iPhone mirroring.
set -euo pipefail

DEVICE_ID="${KUCA_DEVICE_ID:-00008140-000659361E42801C}"
COREDEVICE_ID="${KUCA_COREDEVICE_ID:-5A9C0D2B-9897-5985-A55C-5E565653764B}"
RESULT_BUNDLE="${KUCA_UI_RESULT_BUNDLE:-/tmp/kuca-ui.xcresult}"
RESULT_JSON="${KUCA_UI_RESULT_JSON:-/tmp/kuca-ui-result.json}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${SCRIPT_DIR}/KucaUITests.xcodeproj"
DERIVED="${HOME}/.cache/kuca-ios-uitest-dd"

echo "device=${DEVICE_ID}"
echo "coredevice=${COREDEVICE_ID}"

xcrun devicectl device info details --device "${COREDEVICE_ID}" \
  --json-output /tmp/kuca-device.json
python3 - <<'PY'
import json, sys
data = json.load(open("/tmp/kuca-device.json"))
props = data.get("result", data)
conn = props.get("connectionProperties") or props.get("deviceProperties") or {}
# Walk a couple of known shapes; fail closed if transport is still localNetwork.
blob = json.dumps(data)
if '"transportType" : "localNetwork"' in blob or '"transportType": "localNetwork"' in blob:
    print("error: transportType is still localNetwork — USB is not up", file=sys.stderr)
    sys.exit(1)
print("device json written; transport is not localNetwork")
PY

if [[ -z "$(idevice_id -l | grep -F "${DEVICE_ID}" || true)" ]]; then
  echo "error: idevice_id does not list ${DEVICE_ID} — usbmuxd cannot see the phone" >&2
  exit 1
fi

rm -rf "${RESULT_BUNDLE}"
xcodebuild \
  -project "${PROJECT}" \
  -scheme KucaUITests \
  -configuration Release \
  -destination "platform=iOS,id=${DEVICE_ID}" \
  -derivedDataPath "${DERIVED}" \
  -resultBundlePath "${RESULT_BUNDLE}" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=B537AN89U9 \
  CODE_SIGN_STYLE=Automatic \
  test

python3 "${SCRIPT_DIR}/extract-xcresult.py" "${RESULT_BUNDLE}" --out "${RESULT_JSON}"
echo "result_json=${RESULT_JSON}"
