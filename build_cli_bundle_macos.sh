#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_ROOT="${OUTPUT_ROOT:-$ROOT_DIR/release}"

# Function summary:
# Normalizes architecture aliases so archive names match the produced CLI binary.
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
      printf '%s\n' "$1"
      ;;
  esac
}

ARCH_NAME="$(normalize_arch "${OPENVSHOT_CLI_ARCH:-${OPENVSHOT_MAC_ARCH:-$(uname -m)}}")"
BIN_PATH="$ROOT_DIR/dist/vshot"
BUNDLE_DIR="$OUTPUT_ROOT/cli-macos-$ARCH_NAME"
ARCHIVE_PATH="$OUTPUT_ROOT/openvshot-cli-macos-$ARCH_NAME.tar.gz"
STANDALONE_BIN_PATH="$OUTPUT_ROOT/openvshot-cli-macos-$ARCH_NAME"

if [[ ! -x "$BIN_PATH" ]]; then
  bash "$ROOT_DIR/build_openvshot_macos.sh"
fi

rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

cp "$BIN_PATH" "$BUNDLE_DIR/vshot"
chmod +x "$BUNDLE_DIR/vshot"
cp "$BIN_PATH" "$STANDALONE_BIN_PATH"
chmod +x "$STANDALONE_BIN_PATH"

cat > "$BUNDLE_DIR/README.txt" <<'EOF'
OpenVshot CLI (macOS)

Quick start:
1. chmod +x vshot
2. Move it into a directory on your PATH, or run it directly
3. ./vshot --help
EOF

tar -czf "$ARCHIVE_PATH" -C "$BUNDLE_DIR" .

echo
echo "CLI bundle created:"
echo "  $ARCHIVE_PATH"
echo "  $STANDALONE_BIN_PATH"
