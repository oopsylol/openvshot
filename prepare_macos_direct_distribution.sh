#!/usr/bin/env bash
set -euo pipefail

# File summary:
# Generates helper assets for unsigned macOS direct distribution releases.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_RELEASE_DIR="${DESKTOP_RELEASE_DIR:-$ROOT_DIR/apps/desktop/release}"
OUTPUT_ROOT="${OUTPUT_ROOT:-$ROOT_DIR/release}"
SUPPORT_DIR="$OUTPUT_ROOT/macos-direct-support"
SUPPORT_ARCHIVE="$OUTPUT_ROOT/openvshot-macos-direct-support.zip"
README_PATH="$SUPPORT_DIR/OpenVshot-macos-direct-distribution.txt"
FIRST_RUN_PATH="$SUPPORT_DIR/OpenVshot-First-Run.command"

# Function summary:
# Prints an error and exits when the expected release artifact is missing.
fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# Function summary:
# Creates a clean directory for regenerated support assets.
prepare_directory() {
  local directory_path="$1"
  rm -rf "$directory_path"
  mkdir -p "$directory_path"
}

ZIP_FILE="$(find "$DESKTOP_RELEASE_DIR" -type f -name "*.zip" | head -n 1 || true)"
if [[ -z "$ZIP_FILE" ]]; then
  fail "No macOS ZIP artifact was found in $DESKTOP_RELEASE_DIR"
fi

prepare_directory "$SUPPORT_DIR"

cat >"$README_PATH" <<'EOF'
OpenVshot macOS direct distribution

This build is distributed as unsigned open-source software.
macOS may block the first launch because the app was downloaded from the internet.

Recommended steps:
1. Unzip the OpenVshot archive.
2. Move OpenVshot.app into /Applications.
3. Run OpenVshot-First-Run.command once.
4. If macOS still shows a warning, right-click OpenVshot.app and choose Open.

The helper command removes the quarantine attribute and launches the app.
You can also run this manually:
  xattr -dr com.apple.quarantine /Applications/OpenVshot.app
  open /Applications/OpenVshot.app
EOF

cat >"$FIRST_RUN_PATH" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

# File summary:
# Removes the quarantine attribute from OpenVshot.app and launches it once on macOS.

# Function summary:
# Prints an error and stops when the target app bundle cannot be found.
fail() {
  echo "ERROR: $*" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_APP="${1:-}"

if [[ -z "$TARGET_APP" && -d "/Applications/OpenVshot.app" ]]; then
  TARGET_APP="/Applications/OpenVshot.app"
fi

if [[ -z "$TARGET_APP" && -d "$SCRIPT_DIR/OpenVshot.app" ]]; then
  TARGET_APP="$SCRIPT_DIR/OpenVshot.app"
fi

if [[ -z "$TARGET_APP" ]]; then
  fail "OpenVshot.app was not found. Move it to /Applications or drag the app onto this command file."
fi

if [[ ! -d "$TARGET_APP" ]]; then
  fail "Target app bundle does not exist: $TARGET_APP"
fi

echo "Removing quarantine attribute from:"
echo "  $TARGET_APP"
xattr -dr com.apple.quarantine "$TARGET_APP"

echo
echo "Launching OpenVshot..."
open "$TARGET_APP"
EOF

chmod +x "$FIRST_RUN_PATH"
(cd "$OUTPUT_ROOT" && zip -rq "$(basename "$SUPPORT_ARCHIVE")" "$(basename "$SUPPORT_DIR")")

echo
echo "Direct distribution support assets created:"
echo "  $SUPPORT_ARCHIVE"
