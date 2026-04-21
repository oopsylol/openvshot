#!/usr/bin/env bash
set -euo pipefail

# File summary:
# Builds the macOS CLI binary with an architecture that matches the desktop target.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
TMP_DIR="$ROOT_DIR/.build/openvshot-macos"
DEFAULT_PYTHON_BIN="${PYTHON_BIN:-python3}"

# Function summary:
# Prints a timestamped log line for build diagnostics.
log() {
  printf '[openvshot-macos] %s\n' "$*" >&2
}

# Function summary:
# Prints an error and exits immediately.
fail() {
  printf '[openvshot-macos] ERROR: %s\n' "$*" >&2
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
# Normalizes architecture aliases so the build scripts can share one format.
normalize_arch() {
  case "${1:-}" in
    x64 | x86_64 | amd64)
      printf 'x64\n'
      ;;
    arm64 | aarch64)
      printf 'arm64\n'
      ;;
    universal | universal2)
      printf 'universal\n'
      ;;
    "")
      printf '%s\n' "$(normalize_arch "$(uname -m)")"
      ;;
    *)
      fail "Unsupported macOS architecture: $1"
      ;;
  esac
}

# Function summary:
# Resolves the Python interpreter to use for a specific target architecture.
python_for_arch() {
  case "$1" in
    x64)
      printf '%s\n' "${OPENVSHOT_MAC_PYTHON_X64:-$DEFAULT_PYTHON_BIN}"
      ;;
    arm64)
      printf '%s\n' "${OPENVSHOT_MAC_PYTHON_ARM64:-$DEFAULT_PYTHON_BIN}"
      ;;
    *)
      fail "Unsupported Python target architecture: $1"
      ;;
  esac
}

# Function summary:
# Executes a command under the requested macOS architecture when cross-building is needed.
run_for_arch() {
  local target_arch="$1"
  shift

  if [[ "$HOST_ARCH" == "$target_arch" ]]; then
    "$@"
    return
  fi

  require_command arch
  case "$target_arch" in
    x64)
      arch -x86_64 "$@"
      ;;
    arm64)
      arch -arm64 "$@"
      ;;
    *)
      fail "Unsupported run target architecture: $target_arch"
      ;;
  esac
}

# Function summary:
# Ensures the selected Python interpreter is executable for the requested architecture.
assert_python_usable() {
  local target_arch="$1"
  local python_bin="$2"

  if ! run_for_arch "$target_arch" "$python_bin" -c "import platform; print(platform.machine())" >/dev/null 2>&1; then
    fail "Python interpreter '$python_bin' is not usable for architecture '$target_arch'."
  fi
}

# Function summary:
# Builds one CLI binary for a single macOS architecture and returns the output path.
build_single_arch() {
  local target_arch="$1"
  local python_bin
  local dist_path="$TMP_DIR/dist-$target_arch"
  local work_path="$TMP_DIR/work-$target_arch"
  local spec_path="$TMP_DIR/spec-$target_arch"
  local binary_path="$dist_path/vshot"

  python_bin="$(python_for_arch "$target_arch")"
  require_command "$python_bin"
  assert_python_usable "$target_arch" "$python_bin"

  rm -rf "$dist_path" "$work_path" "$spec_path"
  mkdir -p "$dist_path" "$work_path" "$spec_path"

  log "Installing Python dependencies for $target_arch via $python_bin"
  run_for_arch "$target_arch" "$python_bin" -m pip install --upgrade pip pyinstaller
  run_for_arch "$target_arch" "$python_bin" -m pip install -r "$ROOT_DIR/requirements.txt"

  log "Building CLI binary for $target_arch"
  run_for_arch "$target_arch" "$python_bin" -m PyInstaller \
    --noconfirm \
    --clean \
    --onefile \
    --name vshot \
    --distpath "$dist_path" \
    --workpath "$work_path" \
    --specpath "$spec_path" \
    "$ROOT_DIR/scu_cli.py"

  [[ -x "$binary_path" ]] || fail "CLI binary was not created for $target_arch: $binary_path"
  printf '%s\n' "$binary_path"
}

HOST_ARCH="$(normalize_arch "$(uname -m)")"
TARGET_ARCH="$(normalize_arch "${OPENVSHOT_MAC_ARCH:-${OPENVSHOT_CLI_ARCH:-$HOST_ARCH}}")"

require_command uname
require_command file

cd "$ROOT_DIR"
rm -rf "$TMP_DIR"
mkdir -p "$DIST_DIR"

if [[ "$TARGET_ARCH" == "universal" ]]; then
  require_command lipo
  x64_binary="$(build_single_arch x64)"
  arm64_binary="$(build_single_arch arm64)"

  log "Merging x64 and arm64 binaries into a universal build"
  lipo -create -output "$DIST_DIR/vshot" "$x64_binary" "$arm64_binary"
  chmod +x "$DIST_DIR/vshot"
  lipo -info "$DIST_DIR/vshot"
else
  single_binary="$(build_single_arch "$TARGET_ARCH")"
  cp "$single_binary" "$DIST_DIR/vshot"
  chmod +x "$DIST_DIR/vshot"
  file "$DIST_DIR/vshot"
fi

log "Build done"
printf '  %s\n' "$DIST_DIR/vshot"
