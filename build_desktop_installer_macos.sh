#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
ENV_FILE="${OPENVSHOT_MAC_ENV_FILE:-$ROOT_DIR/.mac-signing.env}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "This script must run on macOS."
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  echo "Loading env file: $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1"
    exit 1
  fi
}

require_command "$PYTHON_BIN"
require_command npm
require_command xcode-select
require_command xcrun
require_command sips
require_command iconutil
require_command codesign
require_command spctl

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Xcode Command Line Tools are required."
  exit 1
fi

if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  echo "Notarization mode: App Store Connect API key"
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  echo "Notarization mode: Apple ID + app-specific password"
elif [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" && -n "${APPLE_KEYCHAIN:-}" ]]; then
  echo "Notarization mode: notarytool keychain profile"
else
  echo "Notarization credentials not found. Build will continue, but signed distribution may be incomplete."
fi

if [[ "${OPENVSHOT_SKIP_DEP_INSTALL:-0}" != "1" ]]; then
  "$PYTHON_BIN" -m pip install -r "$ROOT_DIR/requirements.txt"
  (
    cd "$DESKTOP_DIR"
    npm install
  )
fi

BUILD_ARGS=()
case "${OPENVSHOT_MAC_ARCH:-}" in
  "")
    ;;
  x64)
    BUILD_ARGS+=(--x64)
    ;;
  arm64)
    BUILD_ARGS+=(--arm64)
    ;;
  universal)
    BUILD_ARGS+=(--universal)
    ;;
  *)
    echo "Unsupported OPENVSHOT_MAC_ARCH: ${OPENVSHOT_MAC_ARCH}"
    exit 1
    ;;
esac

if [[ ${#BUILD_ARGS[@]} -gt 0 ]]; then
  (
    cd "$DESKTOP_DIR"
    npm run dist:mac -- "${BUILD_ARGS[@]}"
  )
else
  (
    cd "$DESKTOP_DIR"
    npm run dist:mac
  )
fi

APP_BUNDLE="$(find "$DESKTOP_DIR/release" -type d -name "OpenVshot.app" | head -n 1 || true)"
DMG_FILE="$(find "$DESKTOP_DIR/release" -type f -name "*.dmg" | head -n 1 || true)"

if [[ -n "$APP_BUNDLE" ]]; then
  echo
  echo "Verifying app signature:"
  codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"
  spctl -a -vvv "$APP_BUNDLE" || true
fi

if [[ -n "$DMG_FILE" ]] && command -v xcrun >/dev/null 2>&1; then
  echo
  echo "Checking notarization ticket:"
  xcrun stapler validate "$DMG_FILE" || true
fi

echo
echo "Build artifacts:"
echo "  $DESKTOP_DIR/release"
