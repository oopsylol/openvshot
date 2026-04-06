#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${1:-OpenVshotNotary}"

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "This script must run on macOS."
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "Missing command: xcrun"
  exit 1
fi

: "${APPLE_ID:?Please set APPLE_ID first.}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?Please set APPLE_APP_SPECIFIC_PASSWORD first.}"
: "${APPLE_TEAM_ID:?Please set APPLE_TEAM_ID first.}"

xcrun notarytool store-credentials "$PROFILE_NAME" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"

DEFAULT_KEYCHAIN="$(security default-keychain -d user | sed 's/[",]//g' | xargs)"

echo
echo "Credentials saved."
echo "Add these exports before packaging:"
echo "  export APPLE_KEYCHAIN_PROFILE=\"$PROFILE_NAME\""
echo "  export APPLE_KEYCHAIN=\"$DEFAULT_KEYCHAIN\""
