#!/usr/bin/env bash
set -euo pipefail

# File summary:
# Builds the macOS desktop installer and keeps the bundled CLI architecture aligned.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
ENV_FILE="${OPENVSHOT_MAC_ENV_FILE:-$ROOT_DIR/.mac-signing.env}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
REQUIRE_SIGNED_RELEASE="${OPENVSHOT_REQUIRE_SIGNED_RELEASE:-0}"
DIRECT_DISTRIBUTION="${OPENVSHOT_MAC_DIRECT_DISTRIBUTION:-0}"

# Function summary:
# Prints an error and exits immediately.
fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# Function summary:
# Verifies that a required command exists before the build continues.
require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing command: $1"
  fi
}

# Function summary:
# Normalizes architecture aliases so Electron Builder and the CLI builder use the same values.
normalize_arch() {
  case "${1:-}" in
    "")
      printf '%s\n' "$(normalize_arch "$(uname -m)")"
      ;;
    x64 | x86_64 | amd64)
      printf 'x64\n'
      ;;
    arm64 | aarch64)
      printf 'arm64\n'
      ;;
    universal | universal2)
      printf 'universal\n'
      ;;
    *)
      fail "Unsupported OPENVSHOT_MAC_ARCH: ${1:-}"
      ;;
  esac
}

if [[ "${OSTYPE:-}" != darwin* ]]; then
  fail "This script must run on macOS."
fi

if [[ -f "$ENV_FILE" ]]; then
  echo "Loading env file: $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

require_command "$PYTHON_BIN"
require_command npm
require_command xcode-select
require_command xcrun
require_command sips
require_command iconutil
require_command codesign
require_command spctl

if ! xcode-select -p >/dev/null 2>&1; then
  fail "Xcode Command Line Tools are required."
fi

HAS_SIGNING_IDENTITY=0
if [[ -n "${CSC_NAME:-}" || -n "${CSC_LINK:-}" || -n "${BUILD_CERTIFICATE_BASE64:-}" ]]; then
  HAS_SIGNING_IDENTITY=1
fi

HAS_NOTARIZATION_CREDENTIALS=0
if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  HAS_NOTARIZATION_CREDENTIALS=1
  echo "Notarization mode: App Store Connect API key"
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  HAS_NOTARIZATION_CREDENTIALS=1
  echo "Notarization mode: Apple ID + app-specific password"
elif [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" && -n "${APPLE_KEYCHAIN:-}" ]]; then
  HAS_NOTARIZATION_CREDENTIALS=1
  echo "Notarization mode: notarytool keychain profile"
else
  echo "Notarization credentials not found. Build will continue, but signed distribution may be incomplete."
fi

if [[ "$HAS_SIGNING_IDENTITY" -eq 1 ]]; then
  echo "Signing mode: enabled"
else
  echo "Signing mode: unsigned build"
fi

if [[ "$DIRECT_DISTRIBUTION" == "1" ]]; then
  echo "Distribution mode: direct open-source release"
else
  echo "Distribution mode: Apple signed release"
fi

if [[ "$REQUIRE_SIGNED_RELEASE" == "1" ]]; then
  if [[ "$HAS_SIGNING_IDENTITY" -ne 1 ]]; then
    fail "Formal macOS distribution requires a signing identity. Configure CSC_NAME or BUILD_CERTIFICATE_BASE64."
  fi
  if [[ "$HAS_NOTARIZATION_CREDENTIALS" -ne 1 ]]; then
    fail "Formal macOS distribution requires notarization credentials."
  fi
fi

OPENVSHOT_MAC_ARCH="$(normalize_arch "${OPENVSHOT_MAC_ARCH:-}")"
export OPENVSHOT_MAC_ARCH
echo "Target macOS architecture: $OPENVSHOT_MAC_ARCH"

if [[ "${OPENVSHOT_SKIP_DEP_INSTALL:-0}" != "1" ]]; then
  (
    cd "$DESKTOP_DIR"
    npm install
  )
fi

BUILD_ARGS=()
case "${OPENVSHOT_MAC_ARCH}" in
  x64)
    BUILD_ARGS+=(--x64)
    ;;
  arm64)
    BUILD_ARGS+=(--arm64)
    ;;
  universal)
    BUILD_ARGS+=(--universal)
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
ZIP_FILE="$(find "$DESKTOP_DIR/release" -type f -name "*.zip" | head -n 1 || true)"

if [[ -n "$APP_BUNDLE" ]]; then
  echo
  if [[ "$HAS_SIGNING_IDENTITY" -eq 1 ]]; then
    echo "Verifying app signature:"
    codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"
    if [[ "$REQUIRE_SIGNED_RELEASE" == "1" ]]; then
      spctl -a -vvv "$APP_BUNDLE"
    else
      spctl -a -vvv "$APP_BUNDLE" || true
    fi
  else
    echo "Skipping signature verification for unsigned build."
  fi
elif [[ "$REQUIRE_SIGNED_RELEASE" == "1" ]]; then
  fail "OpenVshot.app was not generated."
fi

if [[ "$DIRECT_DISTRIBUTION" == "1" ]]; then
  if [[ -z "$ZIP_FILE" ]]; then
    fail "Direct macOS distribution requires a ZIP artifact."
  fi
  if [[ -z "$DMG_FILE" ]]; then
    fail "Direct macOS distribution requires a DMG artifact."
  fi
  echo
  echo "Direct distribution DMG:"
  echo "  $DMG_FILE"
  echo
  echo "Direct distribution ZIP:"
  echo "  $ZIP_FILE"
elif [[ -n "$DMG_FILE" ]] && command -v xcrun >/dev/null 2>&1; then
  echo
  if [[ "$HAS_SIGNING_IDENTITY" -eq 1 && "$HAS_NOTARIZATION_CREDENTIALS" -eq 1 ]]; then
    echo "Checking notarization ticket:"
    if [[ "$REQUIRE_SIGNED_RELEASE" == "1" ]]; then
      xcrun stapler validate "$DMG_FILE"
    else
      xcrun stapler validate "$DMG_FILE" || true
    fi
  else
    echo "Skipping notarization ticket validation."
  fi
elif [[ "$REQUIRE_SIGNED_RELEASE" == "1" ]]; then
  fail "Signed DMG artifact was not generated."
fi

echo
echo "Build artifacts:"
echo "  $DESKTOP_DIR/release"
